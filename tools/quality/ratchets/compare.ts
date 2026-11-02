/**
 * Shared ratchet types + failure reporting.
 * Compare CLI lives in compare.py (language-neutral; bash Hosts have no Node).
 */

export type Finding = {
	id: string;
	/** Present for scored findings; compared for regressions. */
	score?: number;
};

export type BaselineFinding = Finding & {
	note?: string;
	issue?: number;
};

export type BaselineFile = {
	version: 1;
	/** Default "higher" (complexity). Coverage uses "lower". */
	worseWhen?: "higher" | "lower";
	/** Absolute minimum score when worseWhen is "lower" (coverage). */
	floor?: number;
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
	belowFloor?: Array<{ id: string; floor: number; current: number }>;
};

export function isCiEnv(env: NodeJS.ProcessEnv = process.env): boolean {
	const v = env.CI;
	return (
		v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false"
	);
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
	if (result.belowFloor && result.belowFloor.length > 0) {
		console.error("Below configured floor:");
		for (const r of result.belowFloor) {
			console.error(`  v ${r.id}  floor=${r.floor} current=${r.current}`);
		}
	}
}
