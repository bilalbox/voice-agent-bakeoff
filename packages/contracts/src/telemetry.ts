import { z } from "zod";

export const ArchitectureSchema = z.enum([
	"retell",
	"livekit",
	"cloudflare",
	"elevenlabs",
]);
export type Architecture = z.infer<typeof ArchitectureSchema>;

export const PolicyVerdictSchema = z.enum(["pass", "fail", "neutral"]);
export type PolicyVerdict = z.infer<typeof PolicyVerdictSchema>;

export const ProvenanceSchema = z.enum(["live_webrtc", "edge_simulation"]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const BenchmarkTurnMetricSchema = z.object({
	turn_index: z.number().int().nonnegative(),
	vad_ms: z
		.number()
		.nonnegative()
		.optional()
		.describe("Speech detection / End-of-Utterance latency in ms"),
	stt_ms: z
		.number()
		.nonnegative()
		.optional()
		.describe("Speech-to-text transcription latency in ms"),
	llm_ttft_ms: z
		.number()
		.nonnegative()
		.optional()
		.describe("LLM Time-to-First-Token in ms"),
	tool_ms: z
		.number()
		.nonnegative()
		.optional()
		.describe("Mid-call tool execution latency in ms"),
	tts_ttfb_ms: z
		.number()
		.nonnegative()
		.optional()
		.describe("TTS Time-to-First-Byte in ms"),
	total_turn_rtt_ms: z
		.number()
		.nonnegative()
		.describe("Total ear-to-mouth turn latency in ms"),
	client_rtt_ms: z
		.number()
		.nonnegative()
		.optional()
		.describe("Client-observed ear-to-mouth or request RTT in ms"),
	prompt_tokens: z.number().int().nonnegative().optional(),
	completion_tokens: z.number().int().nonnegative().optional(),
	audio_input_seconds: z.number().nonnegative().optional(),
	audio_output_seconds: z.number().nonnegative().optional(),
	cost_usd: z
		.number()
		.nonnegative()
		.optional()
		.describe("Calculated cost in USD for this turn"),
	tool_called: z.string().nullable().optional(),
	tool_args: z.record(z.unknown()).optional(),
	tool_result: z.record(z.unknown()).optional(),
	policy_verdict: PolicyVerdictSchema.optional(),
	transcript_user: z.string().optional(),
	transcript_agent: z.string().optional(),
});

export type BenchmarkTurnMetric = z.infer<typeof BenchmarkTurnMetricSchema>;

export const EvaluationDetailSchema = z.object({
	id: z.string(),
	description: z.string(),
	passed: z.boolean(),
	reason: z.string(),
});

export type EvaluationDetail = z.infer<typeof EvaluationDetailSchema>;

export const BenchmarkRunIngestSchema = z.object({
	run_id: z.string().optional(),
	architecture: ArchitectureSchema,
	scenario_id: z
		.string()
		.describe(
			"Scenario identifier, e.g. sarah_reschedule, omar_cancel_fee, pool_heater_decline",
		),
	summary: z.string().optional(),
	policy_passed: z
		.boolean()
		.describe("Whether all policy checks passed in this run"),
	task_completed: z
		.boolean()
		.optional()
		.describe(
			"Whether the caller's primary task or scenario objective was resolved",
		),
	resolution_turns: z
		.number()
		.int()
		.nonnegative()
		.optional()
		.describe("Number of assistant turns taken to reach resolution"),
	tools_called_count: z
		.number()
		.int()
		.nonnegative()
		.optional()
		.describe("Total number of backend CRM tools invoked"),
	tool_accuracy_score: z
		.number()
		.min(0)
		.max(100)
		.optional()
		.describe("Accuracy score (0-100) for tool selection and arguments"),
	effectiveness_score: z
		.number()
		.min(0)
		.max(100)
		.optional()
		.describe(
			"Composite agent effectiveness score (0-100) combining policy fidelity, task resolution, tool accuracy, and turn efficiency",
		),
	assertions_passed: z.number().int().nonnegative().optional(),
	total_assertions: z.number().int().nonnegative().optional(),
	evaluation_details: z.array(EvaluationDetailSchema).optional(),
	total_duration_ms: z.number().nonnegative().optional(),
	provenance: ProvenanceSchema.optional(),
	turns: z.array(BenchmarkTurnMetricSchema),
});

export type BenchmarkRunIngest = z.infer<typeof BenchmarkRunIngestSchema>;

/**
 * Cost modeling constants based on measured 2026 provider pricing
 */
export const ARCHITECTURE_COST_RATES = {
	retell: {
		base_per_audio_minute: 0.09,
		per_tool_execution: 0.005,
	},
	livekit: {
		stt_nova3_per_min: 0.005,
		tts_inworld_flash_per_1k_chars: 0.024,
		llm_gemini_flash_lite_prompt_per_1m: 0.25,
		llm_gemini_flash_lite_completion_per_1m: 1.5,
		livekit_cloud_per_min: 0.004,
		avg_per_minute: 0.054,
	},
	cloudflare: {
		stt_flux_per_min: 0.007,
		tts_aura2_per_1k_chars: 0.025,
		llm_deepseek_flash_prompt_per_1m: 0.14,
		llm_deepseek_flash_completion_per_1m: 0.28,
		durable_object_gb_sec: 0.0000125,
		avg_per_minute: 0.024,
	},
	elevenlabs: {
		platform_convai_per_min: 0.08,
		llm_gemini_flash_lite_prompt_per_1m: 0.25,
		llm_gemini_flash_lite_completion_per_1m: 1.5,
		avg_per_minute: 0.083,
	},
} as const;

export function estimateTurnTokensAndAudio(
	turn: Partial<BenchmarkTurnMetric>,
): {
	prompt_tokens: number;
	completion_tokens: number;
	audio_input_seconds: number;
	audio_output_seconds: number;
} {
	const userText = (turn.transcript_user ?? "").trim();
	const agentText = (turn.transcript_agent ?? "").trim();

	const userWords = userText ? userText.split(/\s+/).length : 0;
	const agentWords = agentText ? agentText.split(/\s+/).length : 0;

	const prompt_tokens =
		turn.prompt_tokens ??
		(userText ? Math.max(1, Math.ceil(userText.length / 4)) + 220 : 250);
	const completion_tokens =
		turn.completion_tokens ??
		(agentText ? Math.max(1, Math.ceil(agentText.length / 4)) : 45);
	const audio_input_seconds =
		turn.audio_input_seconds ??
		(userWords > 0
			? Math.max(0.8, Math.round((userWords / 2.5) * 10) / 10)
			: 3.0);
	const audio_output_seconds =
		turn.audio_output_seconds ??
		(agentWords > 0
			? Math.max(1.0, Math.round((agentWords / 2.8) * 10) / 10)
			: 4.0);

	return {
		prompt_tokens,
		completion_tokens,
		audio_input_seconds,
		audio_output_seconds,
	};
}

export function calculateTurnCost(
	arch: Architecture,
	turn: Partial<BenchmarkTurnMetric>,
): number {
	const derived = estimateTurnTokensAndAudio(turn);
	const inSec = derived.audio_input_seconds;
	const outSec = derived.audio_output_seconds;
	const totalMin = (inSec + outSec) / 60.0;
	const promptTok = derived.prompt_tokens;
	const compTok = derived.completion_tokens;

	if (arch === "retell") {
		const base =
			totalMin * ARCHITECTURE_COST_RATES.retell.base_per_audio_minute;
		const toolFee = turn.tool_called
			? ARCHITECTURE_COST_RATES.retell.per_tool_execution
			: 0;
		return Math.round((base + toolFee) * 100000) / 100000;
	}

	if (arch === "livekit") {
		const stt =
			(inSec / 60.0) * ARCHITECTURE_COST_RATES.livekit.stt_nova3_per_min;
		const charEstimate = compTok * 4;
		const tts =
			(charEstimate / 1000.0) *
			ARCHITECTURE_COST_RATES.livekit.tts_inworld_flash_per_1k_chars;
		const llm =
			(promptTok / 1_000_000.0) *
				ARCHITECTURE_COST_RATES.livekit.llm_gemini_flash_lite_prompt_per_1m +
			(compTok / 1_000_000.0) *
				ARCHITECTURE_COST_RATES.livekit.llm_gemini_flash_lite_completion_per_1m;
		const lk = totalMin * ARCHITECTURE_COST_RATES.livekit.livekit_cloud_per_min;
		return Math.round((stt + tts + llm + lk) * 100000) / 100000;
	}

	if (arch === "cloudflare") {
		const stt =
			(inSec / 60.0) * ARCHITECTURE_COST_RATES.cloudflare.stt_flux_per_min;
		const charEstimate = compTok * 4;
		const tts =
			(charEstimate / 1000.0) *
			ARCHITECTURE_COST_RATES.cloudflare.tts_aura2_per_1k_chars;
		const llm =
			(promptTok / 1_000_000.0) *
				ARCHITECTURE_COST_RATES.cloudflare.llm_deepseek_flash_prompt_per_1m +
			(compTok / 1_000_000.0) *
				ARCHITECTURE_COST_RATES.cloudflare.llm_deepseek_flash_completion_per_1m;
		const doCost =
			(inSec + outSec) *
			0.125 *
			ARCHITECTURE_COST_RATES.cloudflare.durable_object_gb_sec;
		return Math.round((stt + tts + llm + doCost) * 100000) / 100000;
	}

	if (arch === "elevenlabs") {
		const platformCost =
			totalMin * ARCHITECTURE_COST_RATES.elevenlabs.platform_convai_per_min;
		const llmCost =
			(promptTok / 1_000_000.0) *
				ARCHITECTURE_COST_RATES.elevenlabs.llm_gemini_flash_lite_prompt_per_1m +
			(compTok / 1_000_000.0) *
				ARCHITECTURE_COST_RATES.elevenlabs
					.llm_gemini_flash_lite_completion_per_1m;
		return Math.round((platformCost + llmCost) * 100000) / 100000;
	}

	return 0.001;
}
