/**
 * Push ApplianceOps ElevenLabs Conversational AI Agent config from the repo:
 *   apps/agent-elevenlabs/agent-prompt.md
 *   apps/agent-elevenlabs/webhook-tools.json
 *   apps/agent-elevenlabs/agent.config.json
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... pnpm elevenlabs:sync
 *   pnpm elevenlabs:sync:dry
 *
 * Optional env:
 *   ELEVENLABS_AGENT_ID — update existing ElevenLabs agent (or read from .sync-state.json)
 *   ELEVENLABS_VOICE_ID — override agent.config.json voice_id
 *   EDGE_PUBLIC_URL     — base URL for webhook tools (default: https://applianceops-edge.23p.workers.dev)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentDir = join(__dirname, "..");
const repoRoot = join(__dirname, "../../..");
const statePath = join(agentDir, ".sync-state.json");

loadEnv({ path: join(repoRoot, ".env") });
loadEnv({ path: join(repoRoot, "apps", "edge", ".dev.vars") });

interface WebhookToolFile {
	tools: Array<{
		name: string;
		description: string;
		endpoint: string;
		method?: string;
		parameters: {
			type: "object";
			required?: string[];
			properties: Record<string, unknown>;
		};
	}>;
}

interface ElevenLabsAgentConfig {
	agent_name: string;
	version_description?: string;
	voice_id: string;
	voice_name?: string;
	tts_model_id: string;
	tts_stability?: number;
	tts_similarity_boost?: number;
	tts_speed?: number;
	language: string;
	llm_model: string;
	llm_temperature?: number;
	turn_timeout_seconds?: number;
	turn_eagerness?: string;
	max_duration_seconds?: number;
	first_message: string;
	dispatcher_phone_number?: string;
	default_dynamic_variables?: Record<string, string>;
}

interface SyncState {
	agent_id?: string;
	updated_at?: string;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function buildWebhookToolsPayload(
	toolsFile: WebhookToolFile,
	edgeBaseUrl: string,
	authToken: string,
): Array<Record<string, unknown>> {
	return toolsFile.tools.map((tool) => ({
		type: "webhook",
		name: tool.name,
		description: tool.description,
		api_schema: {
			url: `${edgeBaseUrl}${tool.endpoint}`,
			method: tool.method || "POST",
			request_headers: {
				"Content-Type": "application/json",
				"x-demo-token": authToken,
			},
			request_body_schema: tool.parameters,
		},
	}));
}

function buildAgentRequestBody(
	cfg: ElevenLabsAgentConfig,
	prompt: string,
	toolsFile: WebhookToolFile,
	voiceId: string,
	edgeBaseUrl: string,
	authToken: string,
): Record<string, unknown> {
	const webhookTools = buildWebhookToolsPayload(
		toolsFile,
		edgeBaseUrl,
		authToken,
	);

	return {
		name: cfg.agent_name,
		conversation_config: {
			agent: {
				first_message: cfg.first_message,
				language: cfg.language || "en",
				dynamic_variables: {
					dynamic_variable_placeholders: cfg.default_dynamic_variables || {},
				},
				prompt: {
					prompt,
					llm: cfg.llm_model || "gemini-2.5-flash",
					temperature: cfg.llm_temperature ?? 0.15,
					tools: webhookTools,
					built_in_tools: {
						end_call: {
							type: "system",
							name: "end_call",
							description:
								"End the phone call politely once the caller's request is resolved or they say goodbye.",
						},
					},
				},
			},
			tts: {
				model_id: cfg.tts_model_id || "eleven_flash_v2_5",
				voice_id: voiceId,
				stability: cfg.tts_stability ?? 0.55,
				similarity_boost: cfg.tts_similarity_boost ?? 0.8,
				speed: cfg.tts_speed ?? 1.04,
			},
			turn: {
				turn_timeout: cfg.turn_timeout_seconds ?? 7,
				turn_eagerness: cfg.turn_eagerness || "normal",
			},
			conversation: {
				max_duration_seconds: cfg.max_duration_seconds ?? 600,
			},
		},
	};
}

async function pushToElevenLabsApi(
	apiKey: string,
	existingAgentId: string | undefined,
	payload: Record<string, unknown>,
): Promise<string> {
	const isUpdate = Boolean(existingAgentId);
	const endpoint = isUpdate
		? `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(existingAgentId ?? "")}`
		: "https://api.elevenlabs.io/v1/convai/agents/create";
	const method = isUpdate ? "PATCH" : "POST";

	const response = await fetch(endpoint, {
		method,
		headers: {
			"Content-Type": "application/json",
			"xi-api-key": apiKey,
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(
			`ElevenLabs API ${method} ${endpoint} failed (HTTP ${response.status}): ${errText}`,
		);
	}

	const data = (await response.json()) as { agent_id?: string };
	return data.agent_id || existingAgentId || "";
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const dryRun = argv.includes("--dry-run");
	const forceCreate = argv.includes("--create");

	const apiKey = process.env.ELEVENLABS_API_KEY || "";
	if (!apiKey && !dryRun) {
		throw new Error(
			"ELEVENLABS_API_KEY is required. Set it in .env or apps/edge/.dev.vars (or run with --dry-run).",
		);
	}

	const prompt = readFileSync(join(agentDir, "agent-prompt.md"), "utf8").trim();
	const toolsFile = readJson<WebhookToolFile>(
		join(agentDir, "webhook-tools.json"),
	);
	const cfg = readJson<ElevenLabsAgentConfig>(
		join(agentDir, "agent.config.json"),
	);
	const state: SyncState = existsSync(statePath) ? readJson(statePath) : {};

	const voiceId = process.env.ELEVENLABS_VOICE_ID || cfg.voice_id;
	const edgeBaseUrl = (
		process.env.EDGE_PUBLIC_URL || "https://applianceops-edge.23p.workers.dev"
	).replace(/\/$/, "");
	const authToken =
		process.env.DEMO_VOICE_TOKEN || process.env.SEED_TOKEN || "dev-seed-token";

	const payload = buildAgentRequestBody(
		cfg,
		prompt,
		toolsFile,
		voiceId,
		edgeBaseUrl,
		authToken,
	);

	if (dryRun) {
		process.stdout.write(
			`${JSON.stringify({ mode: "dry-run", payload }, null, 2)}\n`,
		);
		return;
	}

	const targetAgentId = forceCreate
		? undefined
		: process.env.ELEVENLABS_AGENT_ID || state.agent_id;
	const syncedId = await pushToElevenLabsApi(apiKey, targetAgentId, payload);

	writeFileSync(
		statePath,
		`${JSON.stringify(
			{
				agent_id: syncedId,
				updated_at: new Date().toISOString(),
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	process.stdout.write(
		`Synced ElevenLabs Conversational AI Agent: ${syncedId}\n`,
	);
}

void main();
