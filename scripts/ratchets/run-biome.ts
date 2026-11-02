/**
 * Biome diagnostics ratchet: the gate's `lint` step.
 * Every diagnostic (error, warning or info) fails unless baselined in
 * baselines/biome-diagnostics.json. Greenfield baseline is empty: zero diagnostics.
 * Finding ID: file|rule, score = occurrences of that rule in that file.
 *
 * Only lint rules can be baselined. Format, assist (organize imports) and
 * parse diagnostics always fail; `pnpm fix` clears the safe-fixable ones.
 */

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import type {
	CompareResult,
	Finding,
} from "../../tools/quality/ratchets/compare";
import { runRatchetTool } from "../../tools/quality/ratchets/run-tool";

type BiomeDiagnostic = {
	severity: string;
	message: string;
	category?: string;
	location: {
		path: string;
		start: { line: number; column: number };
	};
};

type BiomeReport = {
	diagnostics: BiomeDiagnostic[];
};

const FIX_HINT = [
	"Fix: run `pnpm fix` (safe fixes, repo-wide), then re-run `pnpm gate:fast`.",
	"Fix what remains by hand. Never silence a diagnostic (biome-ignore, rule off/downgrade, baseline --update) to get a pass.",
].join("\n");

function findingId(d: BiomeDiagnostic): string {
	return `${d.location.path}|${d.category}`;
}

function isLintRule(d: BiomeDiagnostic): boolean {
	return d.category?.startsWith("lint/") ?? false;
}

function biomeDiagnosticsToFindings(diagnostics: BiomeDiagnostic[]): Finding[] {
	const counts = new Map<string, number>();
	for (const d of diagnostics.filter(isLintRule)) {
		const id = findingId(d);
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return [...counts]
		.map(([id, score]) => ({ id, score }))
		.sort((a, b) => a.id.localeCompare(b.id));
}

function describe(d: BiomeDiagnostic): string {
	const { path, start } = d.location;
	return `  ${path}:${start.line}:${start.column}  ${d.category ?? "(uncategorized)"}  ${d.message}`;
}

function runBiomeCheck(): BiomeDiagnostic[] {
	const result = spawnSync(
		"pnpm",
		[
			"exec",
			"biome",
			"check",
			"--reporter=json",
			"--max-diagnostics=none",
			"--diagnostic-level=info",
			".",
		],
		{ encoding: "utf8" },
	);
	if (result.error) throw result.error;
	const stdout = result.stdout?.trim() ?? "";
	const start = stdout.indexOf("{");
	if (start === -1) {
		console.error(result.stderr);
		throw new Error("biome produced no JSON report");
	}
	return (JSON.parse(stdout.slice(start)) as BiomeReport).diagnostics;
}

let diagnostics: BiomeDiagnostic[] = [];

function collectBiomeFindings(): Finding[] {
	diagnostics = runBiomeCheck();
	const unbaselinable = diagnostics.filter((d) => !isLintRule(d));
	if (unbaselinable.length > 0) {
		console.error("Biome diagnostics that cannot be baselined:");
		for (const d of unbaselinable) console.error(describe(d));
		console.error(FIX_HINT);
		process.exit(1);
	}
	return biomeDiagnosticsToFindings(diagnostics);
}

function explainFailure(result: CompareResult): void {
	const failing = new Set([
		...result.novel,
		...result.regressions.map((r) => r.id),
	]);
	if (failing.size > 0) {
		console.error("Biome diagnostics:");
		for (const d of diagnostics.filter(
			(d) => isLintRule(d) && failing.has(findingId(d)),
		)) {
			console.error(describe(d));
		}
		console.error(FIX_HINT);
	}
	if (result.stale.length > 0) {
		console.error(
			"Prune fixed rows locally: `pnpm lint -- --update` (refused under CI).",
		);
	}
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	void runRatchetTool({
		name: "biome",
		baselinePath: "baselines/biome-diagnostics.json",
		collect: collectBiomeFindings,
		onFailure: explainFailure,
	});
}
