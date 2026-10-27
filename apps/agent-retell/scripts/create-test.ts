/**
 * Push the LLM simulation test cases in `retell/tests/*.test-case.json` to Retell,
 * optionally running a batch and printing the graded transcripts.
 *
 * Each file is one `create-test-case-definition` payload. Cases are upserted by
 * `name` against the response engine, so re-running updates instead of duplicating.
 *
 * Usage:
 *   npm run retell:test -- --dry-run          # print payloads, no API calls
 *   npm run retell:test                       # create or update every case
 *   npm run retell:test -- --run              # upsert, then run a batch and wait
 *   npm run retell:test -- --only=fridge      # filter by name substring
 *
 * Optional env / flags:
 *   RETELL_API_KEY                 — required unless --dry-run
 *   RETELL_CONVERSATION_FLOW_ID    — response engine id (or --flow-id=<id>)
 *
 * The flow id is on the agent's Simulation tab URL, or from
 * GET https://api.retellai.com/get-agent?agent_id=... → response_engine.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import Retell from "retell-sdk";
import type { TestCreateTestCaseDefinitionParams } from "retell-sdk/resources/tests";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testsDir = join(__dirname, "..", "tests");
const repoRoot = join(__dirname, "../../..");

loadEnv({ path: join(repoRoot, ".env") });
loadEnv({ path: join(repoRoot, "apps", "edge", ".dev.vars") });

type ToolMock = {
	tool_name: string;
	input_match_rule: { type: "any" } | { type: "partial_match"; args: unknown };
	output: string;
};

type TestCaseFile = {
	name: string;
	user_prompt: string;
	metrics: string[];
	dynamic_variables?: Record<string, string>;
	tool_mocks?: ToolMock[];
	llm_model?: NonNullable<TestCreateTestCaseDefinitionParams["llm_model"]>;
};

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000; // simulation runs stop at 10 minutes

function parseArgs(argv: string[]) {
	const flag = (name: string) =>
		argv
			.find((a) => a.startsWith(`--${name}=`))
			?.split("=")
			.slice(1)
			.join("=");
	return {
		dryRun: argv.includes("--dry-run"),
		run: argv.includes("--run"),
		only: flag("only"),
		flowId: flag("flow-id") ?? process.env.RETELL_CONVERSATION_FLOW_ID,
	};
}

function readCases(only?: string): TestCaseFile[] {
	const files = readdirSync(testsDir).filter((f: string) =>
		f.endsWith(".test-case.json"),
	);
	if (files.length === 0) {
		throw new Error(`No *.test-case.json files in ${testsDir}`);
	}

	return files
		.flatMap((file: string) => {
			const path = join(testsDir, file);
			const parsed = JSON.parse(readFileSync(path, "utf8")) as
				| TestCaseFile
				| TestCaseFile[];
			// Files are arrays to match the dashboard's Import/Export shape; a bare
			// object is still accepted so one case can be kept on its own.
			const cases = Array.isArray(parsed) ? parsed : [parsed];

			return cases.map((tc: TestCaseFile) => {
				for (const field of ["name", "user_prompt", "metrics"] as const) {
					if (
						!tc[field] ||
						(Array.isArray(tc[field]) && tc[field].length === 0)
					) {
						throw new Error(`${file}: missing required field "${field}"`);
					}
				}

				// A mock whose output isn't JSON is skipped by Retell and the real tool
				// runs against production, so fail loudly here instead.
				for (const mock of tc.tool_mocks ?? []) {
					if (!mock.output?.trim()) {
						throw new Error(
							`${file}: mock for ${mock.tool_name} has empty output`,
						);
					}
					try {
						JSON.parse(mock.output);
					} catch {
						throw new Error(
							`${file}: mock output for ${mock.tool_name} is not valid JSON`,
						);
					}
				}

				return tc;
			});
		})
		.filter((tc: TestCaseFile) => !only || tc.name.includes(only));
}

async function listCaseIds(client: Retell, flowId: string) {
	const byName = new Map<string, string>();
	let pagination_key: string | undefined;

	do {
		const page = await client.tests.listTestCaseDefinitions({
			type: "conversation-flow",
			conversation_flow_id: flowId,
			limit: 100,
			...(pagination_key ? { pagination_key } : {}),
		});
		for (const item of page.items)
			byName.set(item.name, item.test_case_definition_id);
		pagination_key = page.has_more ? page.pagination_key : undefined;
	} while (pagination_key);

	return byName;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const cases = readCases(args.only);
	if (cases.length === 0) {
		throw new Error(
			`No test cases matched${args.only ? ` --only=${args.only}` : ""} in ${testsDir}`,
		);
	}

	if (args.dryRun) {
		for (const tc of cases) {
			const payload = {
				...tc,
				response_engine: {
					type: "conversation-flow",
					conversation_flow_id: args.flowId || "<RETELL_CONVERSATION_FLOW_ID>",
				},
			};
			console.log(`\n--- ${tc.name} ---`);
			console.log(JSON.stringify(payload, null, 2));
		}
		console.log(`\nDry run: ${cases.length} case(s), no API calls made.`);
		return;
	}

	const apiKey = process.env.RETELL_API_KEY;
	if (!apiKey)
		throw new Error("Set RETELL_API_KEY in .env (or pass --dry-run).");
	if (!args.flowId) {
		throw new Error(
			"Set RETELL_CONVERSATION_FLOW_ID or pass --flow-id=<conversation_flow_id>.",
		);
	}

	const client = new Retell({ apiKey });
	const existing = await listCaseIds(client, args.flowId);
	const response_engine = {
		type: "conversation-flow" as const,
		conversation_flow_id: args.flowId,
	};

	const caseIds: string[] = [];
	for (const tc of cases) {
		const body = { ...tc, response_engine };
		const id = existing.get(tc.name);
		if (id) {
			await client.tests.updateTestCaseDefinition(id, body);
			caseIds.push(id);
			console.log(`Updated ${tc.name} (${id})`);
		} else {
			const created = await client.tests.createTestCaseDefinition(body);
			caseIds.push(created.test_case_definition_id);
			console.log(`Created ${tc.name} (${created.test_case_definition_id})`);
		}
	}

	if (!args.run) {
		console.log(
			`\n${caseIds.length} case(s) synced. Re-run with --run to execute a batch.`,
		);
		return;
	}

	const batch = await client.tests.createBatchTest({
		response_engine,
		test_case_definition_ids: caseIds,
	});
	console.log(
		`\nBatch ${batch.test_case_batch_job_id} queued (${batch.status})…`,
	);

	const deadline = Date.now() + POLL_TIMEOUT_MS;
	let latest = batch;
	while (latest.status !== "complete" && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
		latest = await client.tests.getBatchTest(batch.test_case_batch_job_id);
	}

	if (latest.status !== "complete") {
		throw new Error(
			`Batch ${batch.test_case_batch_job_id} still ${latest.status} after ${
				POLL_TIMEOUT_MS / 1000
			}s — check Batch Testing History in the dashboard.`,
		);
	}

	console.log(
		`\n${latest.pass_count} passed, ${latest.fail_count} failed, ${latest.error_count} errored of ${latest.total_count}`,
	);

	const runs = await client.tests.listTestRuns(batch.test_case_batch_job_id, {
		limit: 100,
	});
	for (const run of runs.items) {
		console.log(`\n[${run.status}] ${run.test_case_definition_id}`);
		if (run.result_explanation) {
			console.log(`  ${run.result_explanation.slice(0, 600)}`);
		}
	}

	console.log(
		`\nFull transcripts: https://dashboard.retellai.com/agents (Simulation → Batch Testing History)`,
	);

	if (latest.fail_count || latest.error_count) process.exitCode = 1;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
