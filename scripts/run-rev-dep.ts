/**
 * Wrapper around `rev-dep config run`.
 * Refuses --update-snapshot when CI=true (same contract as complexity ratchet).
 */

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function isCiEnv(env: NodeJS.ProcessEnv = process.env): boolean {
	const v = env.CI;
	return (
		v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false"
	);
}

function main(): void {
	// pnpm run … -- --update-snapshot may leave a literal "--" in argv; strip it.
	const argv = process.argv.slice(2).filter((a) => a !== "--");
	const updating = argv.includes("--update-snapshot");
	if (updating && isCiEnv()) {
		console.error(
			"Refusing rev-dep --update-snapshot under CI=true. Baseline growth is a conscious human act.",
		);
		process.exit(2);
	}

	const result = spawnSync(
		"pnpm",
		["exec", "rev-dep", "config", "run", ...argv],
		{
			encoding: "utf8",
			stdio: "inherit",
		},
	);
	if (result.error) throw result.error;
	process.exit(result.status ?? 1);
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main();
}
