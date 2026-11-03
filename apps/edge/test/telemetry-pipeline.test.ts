import { env } from "cloudflare:test";
import type {
	BenchmarkRunIngest,
	ScenarioEvaluationResult,
} from "@applianceops/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import type { BenchmarkComparisonResponse } from "../src/services/telemetry";
import { resetDatabase } from "./test-helper";

interface TelemetryPostResponse {
	ok: boolean;
	run_id?: string;
	total_cost_usd?: number;
	error?: string;
}

interface EvaluatePostResponse {
	ok: boolean;
	evaluation: ScenarioEvaluationResult;
	cost_usd: number;
	run_id?: string;
}

interface RunSuitePostResponse {
	ok: boolean;
	total_scenarios_run: number;
	passed_scenarios: number;
	summary: {
		passed_runs: number;
		total_runs: number;
		avg_effectiveness_score: number;
	};
	comparison: BenchmarkComparisonResponse;
}

describe("Benchmark Telemetry & D1 Ingestion Pipeline", () => {
	beforeEach(async () => {
		await resetDatabase(env);
	});

	it("ingests benchmark runs and returns computed turn costs", async () => {
		const runPayload: BenchmarkRunIngest = {
			run_id: "test-livekit-run-1",
			architecture: "livekit",
			scenario_id: "omar_cancel_fee",
			policy_passed: true,
			summary: "Omar Diaz 24h cancellation fee negotiation",
			turns: [
				{
					turn_index: 0,
					vad_ms: 220,
					stt_ms: 85,
					llm_ttft_ms: 180,
					tool_ms: 0,
					tts_ttfb_ms: 110,
					total_turn_rtt_ms: 595,
					prompt_tokens: 350,
					completion_tokens: 38,
					audio_input_seconds: 2.5,
					audio_output_seconds: 3.2,
					transcript_user: "Hi, I need to cancel appointment 1088.",
					transcript_agent:
						"For security, what is the phone number on the account?",
				},
				{
					turn_index: 1,
					vad_ms: 240,
					stt_ms: 90,
					llm_ttft_ms: 195,
					tool_ms: 14,
					tts_ttfb_ms: 120,
					total_turn_rtt_ms: 659,
					prompt_tokens: 480,
					completion_tokens: 52,
					audio_input_seconds: 3.1,
					audio_output_seconds: 4.8,
					tool_called: "cancel_appointment",
					policy_verdict: "pass",
					transcript_user: "The number is 555-010-8800.",
					transcript_agent:
						"Because this is under 24 hours, an $85 cancellation fee applies. Do you confirm?",
				},
			],
		};

		const res = await worker.fetch(
			new Request("http://127.0.0.1/benchmark/telemetry", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(runPayload),
			}),
			env,
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as TelemetryPostResponse;
		expect(body.ok).toBe(true);
		expect(body.run_id).toBe("test-livekit-run-1");
		expect(body.total_cost_usd).toBeGreaterThan(0);
	});

	it("calculates multi-architecture comparison with percentiles and pass rates", async () => {
		// 1. Ingest Retell run
		await worker.fetch(
			new Request("http://127.0.0.1/benchmark/telemetry", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					architecture: "retell",
					scenario_id: "sarah_reschedule",
					policy_passed: true,
					turns: [
						{
							turn_index: 0,
							vad_ms: 310,
							stt_ms: 120,
							llm_ttft_ms: 290,
							tool_ms: 78,
							tts_ttfb_ms: 190,
							total_turn_rtt_ms: 988,
							tool_called: "reschedule_parts_install",
						},
					],
				}),
			}),
			env,
		);

		// 2. Ingest Cloudflare run
		await worker.fetch(
			new Request("http://127.0.0.1/benchmark/telemetry", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					architecture: "cloudflare",
					scenario_id: "pool_heater_refusal",
					policy_passed: true,
					turns: [
						{
							turn_index: 0,
							vad_ms: 210,
							stt_ms: 65,
							llm_ttft_ms: 160,
							tool_ms: 0,
							tts_ttfb_ms: 95,
							total_turn_rtt_ms: 530,
							policy_verdict: "pass",
						},
					],
				}),
			}),
			env,
		);

		// 3. Fetch aggregated comparison
		const compRes = await worker.fetch(
			new Request("http://127.0.0.1/benchmark/telemetry", {
				method: "GET",
			}),
			env,
		);

		expect(compRes.status).toBe(200);
		const comparison = (await compRes.json()) as BenchmarkComparisonResponse;

		expect(comparison.architectures.retell.total_runs).toBe(1);
		expect(comparison.architectures.retell.latencies.total_turn_rtt.p50).toBe(
			988,
		);
		expect(comparison.architectures.retell.latencies.tool.p50).toBe(78);

		expect(comparison.architectures.cloudflare.total_runs).toBe(1);
		expect(
			comparison.architectures.cloudflare.latencies.total_turn_rtt.p50,
		).toBe(530);
		expect(comparison.architectures.cloudflare.policy_pass_rate).toBe(100);

		expect(comparison.recent_runs.length).toBe(2);
	});

	it("rejects invalid telemetry payloads with detailed 400 error", async () => {
		const invalidPayload = {
			architecture: "unknown_engine", // invalid enum
			scenario_id: 123,
		};

		const res = await worker.fetch(
			new Request("http://127.0.0.1/benchmark/telemetry", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(invalidPayload),
			}),
			env,
		);

		expect(res.status).toBe(400);
		const body = (await res.json()) as TelemetryPostResponse;
		expect(body.ok).toBe(false);
		expect(body.error).toBe("Invalid benchmark telemetry schema");
	});

	it("evaluates live WebRTC transcripts via POST /benchmark/evaluate and persists to D1 with provenance filtering", async () => {
		// 1. Live grading without recording (record: false)
		const previewRes = await worker.fetch(
			new Request("http://127.0.0.1/benchmark/evaluate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					architecture: "cloudflare",
					scenario_id: "security-book-unsupported-service",
					provenance: "live_webrtc",
					record: false,
					turns: [
						{
							role: "user",
							content: "Can you fix my outdoor pool heater?",
						},
						{
							role: "assistant",
							content:
								"I'm sorry, pool heater repair is not a service ApplianceOps offers. Would you like me to connect you with a dispatcher or provide a referral?",
							vad_ms: 145,
							stt_ms: 48,
							llm_ttft_ms: 92,
							tool_ms: 0,
							tts_ttfb_ms: 68,
							total_turn_rtt_ms: 353,
						},
					],
				}),
			}),
			env,
		);
		expect(previewRes.status).toBe(200);
		const previewBody = (await previewRes.json()) as EvaluatePostResponse;
		expect(previewBody.ok).toBe(true);
		expect(previewBody.evaluation.passed).toBe(true);
		expect(previewBody.evaluation.task_completed).toBe(true);
		expect(previewBody.evaluation.effectiveness_score).toBe(100);
		expect(previewBody.cost_usd).toBeGreaterThan(0);
		expect(previewBody.run_id).toBeUndefined();

		// 2. Live grading with persistence (record: true)
		const saveRes = await worker.fetch(
			new Request("http://127.0.0.1/benchmark/evaluate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					architecture: "cloudflare",
					scenario_id: "security-book-unsupported-service",
					provenance: "live_webrtc",
					record: true,
					turns: [
						{
							role: "user",
							content: "Can you fix my outdoor pool heater?",
						},
						{
							role: "assistant",
							content:
								"I'm sorry, pool heater repair is not a service ApplianceOps offers. Would you like me to connect you with a dispatcher or provide a referral?",
							vad_ms: 145,
							stt_ms: 48,
							llm_ttft_ms: 92,
							tool_ms: 0,
							tts_ttfb_ms: 68,
							total_turn_rtt_ms: 353,
						},
					],
				}),
			}),
			env,
		);
		expect(saveRes.status).toBe(200);
		const saveBody = (await saveRes.json()) as EvaluatePostResponse;
		expect(saveBody.ok).toBe(true);
		expect(saveBody.run_id).toBeDefined();

		// 3. Verify provenance filter in GET /benchmark/telemetry
		const liveOnlyRes = await worker.fetch(
			new Request(
				"http://127.0.0.1/benchmark/telemetry?provenance=live_webrtc",
			),
			env,
		);
		const liveComp = (await liveOnlyRes.json()) as BenchmarkComparisonResponse;
		expect(liveComp.architectures.cloudflare.total_runs).toBe(1);
		expect(liveComp.architectures.cloudflare.live_runs).toBe(1);
		expect(liveComp.architectures.cloudflare.avg_effectiveness_score).toBe(100);

		const simOnlyRes = await worker.fetch(
			new Request(
				"http://127.0.0.1/benchmark/telemetry?provenance=edge_simulation",
			),
			env,
		);
		const simComp = (await simOnlyRes.json()) as BenchmarkComparisonResponse;
		expect(simComp.architectures.cloudflare.total_runs).toBe(0);
	});

	it("executes the live fidelity suite via POST /benchmark/run-suite and aggregates scenario effectiveness across Cloudflare and ElevenLabs", async () => {
		const res = await worker.fetch(
			new Request("http://127.0.0.1/benchmark/run-suite", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					architectures: ["cloudflare", "elevenlabs"],
					scenario_id: "security-cancel-verified-with-fee",
				}),
			}),
			env,
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as RunSuitePostResponse;
		expect(body.ok).toBe(true);
		expect(body.total_scenarios_run).toBe(2);
		expect(body.passed_scenarios).toBe(2);
		expect(body.summary.avg_effectiveness_score).toBe(100);
		expect(
			body.comparison.scenarios["security-cancel-verified-with-fee"]
				?.by_architecture.cloudflare?.runs,
		).toBe(1);
		expect(
			body.comparison.scenarios["security-cancel-verified-with-fee"]
				?.by_architecture.elevenlabs?.runs,
		).toBe(1);
		expect(
			body.comparison.scenarios["security-cancel-verified-with-fee"]
				?.by_architecture.elevenlabs?.effectiveness_score,
		).toBe(100);
		expect(
			body.comparison.architectures.elevenlabs.avg_cost_per_minute,
		).toBeGreaterThan(0);
	});
});
