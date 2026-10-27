/**
 * Shared shrink-only ratchet compare.
 *
 * Contract:
 * - novelty: finding IDs absent from the baseline fail
 * - stale prune: baseline rows that no longer reproduce fail
 * - score regression: same ID with a higher score than baseline fails
 * - --update rewrites the baseline to current findings, refused when CI=true
 *
 * Public seam for contract tests: this CLI. Tool runners call the same helpers.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type Finding = {
	id: string;
	/** Present for cognitive-complexity findings; compared for regressions. */
	score?: number;
};

export type BaselineFinding = Finding & {
	note?: string;
	issue?: number;
};

export type BaselineFile = {
	version: 1;
	findings: BaselineFinding[];
};

export type FindingsFile = {
	findings: Finding[];
};

export type CompareResult = {
	ok: boolean;
	novel: string[];
	stale: string[];
	regressions: Array<{ id: string; baseline: number; current: number }>;
};

export function compareFindings(
	baseline: BaselineFile,
	current: Finding[],
): CompareResult {
	const baselineById = new Map(baseline.findings.map((f) => [f.id, f]));
	const currentById = new Map(current.map((f) => [f.id, f]));

	const novel = [...currentById.keys()]
		.filter((id) => !baselineById.has(id))
		.sort();
	const stale = [...baselineById.keys()]
		.filter((id) => !currentById.has(id))
		.sort();

	const regressions: CompareResult["regressions"] = [];
	for (const [id, cur] of currentById) {
		const base = baselineById.get(id);
		if (
			base &&
			typeof base.score === "number" &&
			typeof cur.score === "number" &&
			cur.score > base.score
		) {
			regressions.push({ id, baseline: base.score, current: cur.score });
		}
	}
	regressions.sort((a, b) => a.id.localeCompare(b.id));

	return {
		ok: novel.length === 0 && stale.length === 0 && regressions.length === 0,
		novel,
		stale,
		regressions,
	};
}

/** Rewrite baseline to current IDs, preserving notes/issues when IDs survive. */
export function rewriteBaseline(
	previous: BaselineFile,
	current: Finding[],
): BaselineFile {
	const prevById = new Map(previous.findings.map((f) => [f.id, f]));
	const findings: BaselineFinding[] = [...current]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((f) => {
			const prev = prevById.get(f.id);
			const row: BaselineFinding = { id: f.id };
			if (typeof f.score === "number") row.score = f.score;
			else if (typeof prev?.score === "number") row.score = prev.score;
			row.note =
				prev?.note ?? "Added via --update; replace with owning issue note.";
			if (typeof prev?.issue === "number") row.issue = prev.issue;
			return row;
		});
	return { version: 1, findings };
}

export function isCiEnv(env: NodeJS.ProcessEnv = process.env): boolean {
	const v = env.CI;
	return (
		v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false"
	);
}

function usage(): never {
	console.error(
		"Usage: tsx scripts/ratchets/compare.ts --baseline <path> --findings <path> [--update]",
	);
	process.exit(2);
}

function parseArgs(argv: string[]): {
	baselinePath: string;
	findingsPath: string;
	update: boolean;
} {
	let baselinePath: string | undefined;
	let findingsPath: string | undefined;
	let update = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--baseline") baselinePath = argv[++i];
		else if (arg === "--findings") findingsPath = argv[++i];
		else if (arg === "--update") update = true;
		else usage();
	}
	if (!baselinePath || !findingsPath) usage();
	return { baselinePath, findingsPath, update };
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function reportFailure(result: CompareResult): void {
	if (result.novel.length > 0) {
		console.error("Novel findings (not in baseline):");
		for (const id of result.novel) console.error(`  + ${id}`);
	}
	if (result.stale.length > 0) {
		console.error(
			"Stale baseline rows (finding gone — prune the baseline entry):",
		);
		for (const id of result.stale) console.error(`  - ${id}`);
	}
	if (result.regressions.length > 0) {
		console.error("Score regressions (worse than baseline):");
		for (const r of result.regressions) {
			console.error(`  ^ ${r.id}  baseline=${r.baseline} current=${r.current}`);
		}
	}
}

function main(): void {
	const { baselinePath, findingsPath, update } = parseArgs(
		process.argv.slice(2),
	);
	const baseline = readJson<BaselineFile>(baselinePath);
	const findingsFile = readJson<FindingsFile>(findingsPath);

	if (update) {
		if (isCiEnv()) {
			console.error(
				"Refusing baseline --update under CI=true. Baseline growth is a conscious human act.",
			);
			process.exit(2);
		}
		const next = rewriteBaseline(baseline, findingsFile.findings);
		writeFileSync(baselinePath, `${JSON.stringify(next, null, "\t")}\n`);
		console.log(
			`Updated baseline ${baselinePath} (${next.findings.length} findings).`,
		);
		process.exit(0);
	}

	const result = compareFindings(baseline, findingsFile.findings);
	if (!result.ok) {
		reportFailure(result);
		process.exit(1);
	}
	console.log(
		`Ratchet OK (${findingsFile.findings.length} findings match baseline).`,
	);
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main();
}
