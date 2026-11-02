/**
 * Shared entry scaffolding for tool-specific ratchets.
 * Collect findings → compare against committed baseline via compare.py → optional --update.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CompareResult, type Finding, reportFailure } from "./compare";

export type CollectFindings = () => Finding[] | Promise<Finding[]>;

function parseUpdateFlag(argv: string[]): boolean {
	return argv.includes("--update");
}

function comparePy(): string {
	return join(process.cwd(), "tools/quality/ratchets/compare.py");
}

export async function runRatchetTool(options: {
	name: string;
	baselinePath: string;
	collect: CollectFindings;
	argv?: string[];
	/** Extra guidance printed after a failed compare (locations, fix command). */
	onFailure?: (result: CompareResult) => void;
}): Promise<void> {
	const update = parseUpdateFlag(options.argv ?? process.argv.slice(2));
	const findings = await options.collect();
	const dir = mkdtempSync(join(tmpdir(), "quality-kit-ratchet-"));
	const findingsPath = join(dir, "findings.json");
	const resultPath = join(dir, "result.json");
	try {
		writeFileSync(
			findingsPath,
			`${JSON.stringify({ findings }, null, "\t")}\n`,
		);
		const args = [
			comparePy(),
			"--baseline",
			options.baselinePath,
			"--findings",
			findingsPath,
		];
		if (update) args.push("--update");
		else args.push("--result-json", resultPath);

		const res = spawnSync("python3", args, {
			encoding: "utf8",
			cwd: process.cwd(),
		});
		if (res.stdout) process.stdout.write(res.stdout);
		if (res.stderr) process.stderr.write(res.stderr);

		if (update) {
			process.exit(res.status ?? 1);
		}

		if ((res.status ?? 1) === 0) {
			console.log(
				`${options.name} ratchet OK (${findings.length} findings match baseline).`,
			);
			process.exit(0);
		}

		let result: CompareResult = {
			ok: false,
			novel: [],
			stale: [],
			regressions: [],
		};
		try {
			result = JSON.parse(readFileSync(resultPath, "utf8")) as CompareResult;
		} catch {
			/* Python already printed; keep empty structured result */
		}
		console.error(`${options.name} ratchet failed:`);
		reportFailure(result);
		options.onFailure?.(result);
		process.exit(res.status ?? 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
