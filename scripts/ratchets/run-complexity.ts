/**
 * Biome cognitive-complexity ratchet.
 * Overlay config: biome.complexity.json. Main biome.json stays clean.
 * Finding ID: file|functionName, with start line appended to disambiguate.
 *
 * Scan roots: edit COMPLEXITY_ROOTS (default ["src"]). Must align with
 * biome.complexity.json files.includes.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Finding } from "./compare";
import { runRatchetTool } from "./run-tool";

/** Roots walked for biome-ignore bans and passed to biome check. */
const COMPLEXITY_ROOTS = [
	"apps/edge/src",
	"apps/agent-cloudflare/src",
	"apps/agent-livekit/src",
	"apps/agent-retell/scripts",
	"apps/benchmark/scripts",
	"packages/contracts/src",
	"packages/schedule-store/src",
	"scripts",
];

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

const RULE = "lint/complexity/noExcessiveCognitiveComplexity";

function identifierAt(filePath: string, line: number, column: number): string {
	const text = readFileSync(filePath, "utf8");
	const row = text.split(/\n/)[line - 1] ?? "";
	const from = row.slice(column - 1);
	const match = from.match(/^[A-Za-z_$][\w$]*/);
	return match?.[0] ?? "(anonymous)";
}

function parseScore(message: string): number {
	const match = message.match(/complexity of (\d+)/i);
	if (!match) throw new Error(`unparseable complexity message: ${message}`);
	return Number(match[1]);
}

export function complexityDiagnosticsToFindings(
	diagnostics: BiomeDiagnostic[],
): Finding[] {
	const raw = diagnostics
		.filter((d) => d.category === RULE)
		.map((d) => {
			const name = identifierAt(
				d.location.path,
				d.location.start.line,
				d.location.start.column,
			);
			const line = d.location.start.line;
			return {
				file: d.location.path,
				name,
				line,
				score: parseScore(d.message),
			};
		});

	const nameCounts = new Map<string, number>();
	for (const r of raw) {
		const key = `${r.file}|${r.name}`;
		nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
	}

	const findings: Finding[] = raw.map((r) => {
		const key = `${r.file}|${r.name}`;
		const needsLine =
			r.name === "(anonymous)" || (nameCounts.get(key) ?? 0) > 1;
		const id = needsLine ? `${key}|${r.line}` : key;
		return { id, score: r.score };
	});

	findings.sort((a, b) => a.id.localeCompare(b.id));
	return findings;
}

/** Fail the gate when agents silence complexity instead of extracting helpers. */
export function detectComplexityIgnores(paths: string[]): string[] {
	const hits: string[] = [];
	for (const path of paths) {
		const text = readFileSync(path, "utf8");
		const lines = text.split(/\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			if (
				line.includes("biome-ignore") &&
				line.includes("noExcessiveCognitiveComplexity")
			) {
				hits.push(`${path}:${i + 1}`);
			}
		}
	}
	return hits;
}

function listSourceFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry);
			const st = statSync(path);
			if (st.isDirectory()) walk(path);
			else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
		}
	};
	walk(root);
	return out;
}

function collectComplexityFindings(): Finding[] {
	const roots = COMPLEXITY_ROOTS.filter((r) => existsSync(r));
	if (roots.length === 0) {
		console.log("complexity ratchet: no scan roots present; skipping.");
		return [];
	}

	const result = spawnSync(
		"pnpm",
		[
			"exec",
			"biome",
			"check",
			"--config-path=biome.complexity.json",
			"--reporter=json",
			"--max-diagnostics=none",
			...roots,
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
	const report = JSON.parse(stdout.slice(start)) as BiomeReport;

	const sourceFiles = roots.flatMap((r) => listSourceFiles(r));
	const ignores = detectComplexityIgnores(sourceFiles);
	if (ignores.length > 0) {
		console.error(
			"Silencing cognitive complexity via biome ignore comments is not an allowed ratchet strategy:",
		);
		for (const hit of ignores) console.error(`  ! ${hit}`);
		process.exit(1);
	}

	return complexityDiagnosticsToFindings(report.diagnostics);
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	void runRatchetTool({
		name: "complexity",
		baselinePath: "baselines/complexity.json",
		collect: collectComplexityFindings,
	});
}
