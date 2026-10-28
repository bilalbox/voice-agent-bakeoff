/**
 * Wrapper around Betterleaks v1 secret scanning.
 *
 * Usage:
 *   tsx scripts/run-secret-scan.ts [--staged] [--verbose]
 *
 * Modes:
 *   - Pre-commit (--staged): `betterleaks git --staged`
 *   - Local gate / gate:fast: `betterleaks dir .` (working tree + untracked)
 *   - CI (CI=true): `betterleaks git --log-opts=origin/main..HEAD` when available,
 *     otherwise full `betterleaks git`
 *
 * Pin Betterleaks to 1.x until v2 is stable. Prefers `betterleaks-v1` on PATH
 * (Homebrew versioned cask) over `betterleaks` when the latter is not 1.x.
 *
 * Always passes -c / -i when .betterleaks.toml / .betterleaksignore exist
 * (v1 does not auto-load target configs without --unsafe-auto-load-config).
 * Does not enable --validation (keeps scans offline).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Pinned major line for quality-kit until Betterleaks v2 is adopted. */
const BETTERLEAKS_MAJOR = "1";

function isCiEnv(env: NodeJS.ProcessEnv = process.env): boolean {
	const v = env.CI;
	return (
		v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false"
	);
}

function versionMajor(versionOut: string): string | undefined {
	const m = versionOut.trim().match(/^v?(\d+)\./);
	return m?.[1];
}

function tryBin(cmd: string): { cmd: string; version: string } | undefined {
	const check = spawnSync(cmd, ["version"], {
		encoding: "utf8",
		stdio: "pipe",
	});
	if (check.status !== 0) return undefined;
	const version = (check.stdout || check.stderr || "").trim();
	return { cmd, version };
}

function resolveBetterleaksBin(): string {
	const v1 = tryBin("betterleaks-v1");
	if (v1 && versionMajor(v1.version) === BETTERLEAKS_MAJOR) {
		return v1.cmd;
	}

	const plain = tryBin("betterleaks");
	if (plain && versionMajor(plain.version) === BETTERLEAKS_MAJOR) {
		return plain.cmd;
	}

	if (plain) {
		console.error(
			`Error: found betterleaks ${plain.version}, but quality-kit pins 1.x until v2 is stable.\n` +
				"Install v1 (e.g. brew install --cask betterleaks/tap/betterleaks@1 → betterleaks-v1)\n" +
				"or see https://github.com/betterleaks/betterleaks/releases/tag/v1.9.0",
		);
		process.exit(2);
	}

	console.error(
		"Error: betterleaks 1.x executable not found on PATH.\n" +
			"Install v1.9.0+:\n" +
			"  macOS:  brew install --cask betterleaks/tap/betterleaks@1\n" +
			"  Linux:  download from https://github.com/betterleaks/betterleaks/releases/tag/v1.9.0\n" +
			"  Docker: ghcr.io/betterleaks/betterleaks:v1",
	);
	process.exit(2);
}

function main(): void {
	const rawArgv = process.argv.slice(2).filter((a) => a !== "--");
	const isStaged = rawArgv.includes("--staged");
	const isVerbose = rawArgv.includes("--verbose") || !isCiEnv();
	const isCi = isCiEnv();

	const bin = resolveBetterleaksBin();

	const configPath = resolve(process.cwd(), ".betterleaks.toml");
	const ignorePath = resolve(process.cwd(), ".betterleaksignore");

	const args: string[] = [];

	if (isStaged) {
		args.push("git", "--staged");
	} else if (isCi) {
		const hasOriginMain =
			spawnSync("git", ["rev-parse", "--verify", "origin/main"], {
				stdio: "pipe",
			}).status === 0;

		if (hasOriginMain) {
			args.push("git", "--log-opts=origin/main..HEAD");
		} else {
			args.push("git");
		}
	} else {
		args.push("dir", ".");
	}

	args.push("--no-banner", "--redact");
	if (isVerbose) {
		args.push("--verbose");
	}

	if (existsSync(configPath)) {
		args.push("-c", configPath);
	}
	if (existsSync(ignorePath)) {
		args.push("-i", ignorePath);
	}

	for (const arg of rawArgv) {
		if (arg !== "--staged" && arg !== "--verbose") {
			args.push(arg);
		}
	}

	const result = spawnSync(bin, args, {
		encoding: "utf8",
		stdio: "inherit",
	});

	if (result.error) throw result.error;
	process.exit(result.status ?? 1);
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main();
}
