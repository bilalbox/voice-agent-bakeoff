import { z } from "zod";

export const ArchitectureSchema = z.enum(["retell", "livekit", "cloudflare"]);
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
	policy_verdict: PolicyVerdictSchema.optional(),
	transcript_user: z.string().optional(),
	transcript_agent: z.string().optional(),
});

export type BenchmarkTurnMetric = z.infer<typeof BenchmarkTurnMetricSchema>;

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
		base_per_audio_minute: 0.095,
		per_tool_execution: 0.005,
	},
	livekit: {
		stt_nova3_per_min: 0.005,
		tts_inworld_flash_per_1k_chars: 0.024,
		llm_gpt6_luna_prompt_per_1m: 0.3,
		llm_gpt6_luna_completion_per_1m: 1.2,
		livekit_cloud_per_min: 0.004,
		avg_per_minute: 0.061,
	},
	cloudflare: {
		stt_flux_per_min: 0.007,
		tts_aura2_per_1k_chars: 0.025,
		llm_deepseek_flash_prompt_per_1m: 0.14,
		llm_deepseek_flash_completion_per_1m: 0.28,
		durable_object_gb_sec: 0.0000125,
		avg_per_minute: 0.024,
	},
} as const;

export function calculateTurnCost(
	arch: Architecture,
	turn: Partial<BenchmarkTurnMetric>,
): number {
	const inSec = turn.audio_input_seconds ?? 3.0;
	const outSec = turn.audio_output_seconds ?? 4.0;
	const totalMin = (inSec + outSec) / 60.0;
	const promptTok = turn.prompt_tokens ?? 250;
	const compTok = turn.completion_tokens ?? 45;

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
				ARCHITECTURE_COST_RATES.livekit.llm_gpt6_luna_prompt_per_1m +
			(compTok / 1_000_000.0) *
				ARCHITECTURE_COST_RATES.livekit.llm_gpt6_luna_completion_per_1m;
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

	return 0.001;
}
