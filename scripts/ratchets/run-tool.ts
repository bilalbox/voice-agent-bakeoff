/**
 * Shared entry scaffolding for tool-specific ratchets.
 * Collect findings → compare against committed baseline → optional --update.
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
	type BaselineFile,
	compareFindings,
	type Finding,
	isCiEnv,
	reportFailure,
	rewriteBaseline,
} from "./compare";

export type CollectFindings = () => Finding[] | Promise<Finding[]>;

function parseUpdateFlag(argv: string[]): boolean {
	return argv.includes("--update");
}

export async function runRatchetTool(options: {
	name: string;
	baselinePath: string;
	collect: CollectFindings;
	argv?: string[];
}): Promise<void> {
	const update = parseUpdateFlag(options.argv ?? process.argv.slice(2));
	const findings = await options.collect();
	const baseline = JSON.parse(
		readFileSync(options.baselinePath, "utf8"),
	) as BaselineFile;

	if (update) {
		if (isCiEnv()) {
			console.error(
				"Refusing baseline --update under CI=true. Baseline growth is a conscious human act.",
			);
			process.exit(2);
		}
		const next = rewriteBaseline(baseline, findings);
		writeFileSync(
			options.baselinePath,
			`${JSON.stringify(next, null, "\t")}\n`,
		);
		console.log(
			`Updated ${options.name} baseline ${options.baselinePath} (${next.findings.length} findings).`,
		);
		process.exit(0);
	}

	const result = compareFindings(baseline, findings);
	if (!result.ok) {
		console.error(`${options.name} ratchet failed:`);
		reportFailure(result);
		process.exit(1);
	}
	console.log(
		`${options.name} ratchet OK (${findings.length} findings match baseline).`,
	);
}
