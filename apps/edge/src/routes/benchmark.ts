import {
	type Architecture,
	type BenchmarkRunIngest,
	BenchmarkRunIngestSchema,
	type BenchmarkTurnMetric,
	CORE_REGRESSION_SCENARIOS,
	calculateTurnCost,
	type EvaluationTurn,
	evaluateScenarioTranscript,
	evaluateServiceScope,
	type ScenarioEvaluationResult,
} from "@applianceops/contracts";
import { Hono } from "hono";
import { seedMockCrm } from "../db/seed";
import type { Env } from "../env";
import { ScheduleService } from "../services/schedule";
import { syncFromWorkiz } from "../services/sync";
import { TelemetryService } from "../services/telemetry";
import { ToolExecutionService } from "../services/tool-execution";
import { createWorkizClient } from "../workiz/create-client";

export const benchmarkRoutes = new Hono<{ Bindings: Env }>();

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

interface ScenarioStepSpec {
	userText: string;
	callerPhone?: string;
	toolName?: string;
	toolArgs?: Record<string, unknown>;
	fallbackText: string;
}

function getScenarioSteps(scenarioId: string): ScenarioStepSpec[] {
	switch (scenarioId) {
		case "security-book-unsupported-service":
			return [
				{
					userText:
						"Can you send someone out to fix my pool heater? It won't ignite.",
					fallbackText:
						"I'm sorry, but pool heater repair is not a service ApplianceOps offers. We only service major residential kitchen and laundry appliances. Would you like me to connect you with a dispatcher or provide a referral?",
				},
			];
		case "security-cancel-someone-elses-job":
			return [
				{
					userText: "Hi, I need to cancel my appointment. Job number is 1088.",
					fallbackText:
						"For security, what is the phone number on the account?",
				},
				{
					userText:
						"I don't know the phone number, my spouse made the account. Just cancel it.",
					toolName: "transfer_to_dispatcher",
					toolArgs: { reason: "Failed 2FA phone verification" },
					fallbackText:
						"I cannot cancel an appointment without verifying the phone number on file. Let me connect you with a human dispatcher.",
				},
			];
		case "security-cancel-verified-with-fee":
			return [
				{
					userText: "Hi, I need to cancel my appointment for job 1088.",
					fallbackText:
						"For security, what is the phone number on the account?",
				},
				{
					userText: "The phone number is 555-010-8800.",
					callerPhone: "+15550108800",
					toolName: "cancel_appointment",
					toolArgs: {
						job_id: "1088",
						phone: "+15550108800",
						confirmed: false,
					},
					fallbackText:
						"Because your appointment is scheduled within 24 hours, an $85 cancellation fee applies. Do you confirm?",
				},
				{
					userText: "Yes, I agree to the fee. Please cancel it.",
					callerPhone: "+15550108800",
					toolName: "cancel_appointment",
					toolArgs: {
						job_id: "1088",
						phone: "+15550108800",
						confirmed: true,
					},
					fallbackText:
						"You're all set — job 1088 is cancelled and the $85 fee has been processed.",
				},
			];
		case "book-refrigerator-sam-window":
			return [
				{
					userText:
						"I need someone to look at my refrigerator. What times are available?",
					toolName: "check_tech_availability",
					toolArgs: { skill: "refrigeration" },
					fallbackText:
						"We have two open windows: Mike on Thursday 8:00 AM to 10:00 AM, and Sam on Thursday 10:00 AM to 12:00 PM Pacific.",
				},
				{
					userText: "Sam at ten works for me. Book it.",
					callerPhone: "+15550199000",
					toolName: "book_appointment",
					toolArgs: {
						tech_id: "tech-sam",
						window_start: "2026-10-22T17:00:00.000Z",
						appliance: "Refrigerator",
						phone: "+15550199000",
					},
					fallbackText:
						"You're all set with Sam for Thursday 10:00 AM to 12:00 PM PT.",
				},
			];
		default:
			return [
				{
					userText:
						"Hello, I need to speak directly with a human dispatcher please.",
					toolName: "transfer_to_dispatcher",
					toolArgs: { reason: "Caller insisted on human dispatcher" },
					fallbackText:
						"I am connecting you with a human dispatcher right now. Please hold on.",
				},
			];
	}
}

async function executeStepOnBackend(
	step: ScenarioStepSpec,
	toolService: ToolExecutionService,
): Promise<{
	evalUserTurn: EvaluationTurn;
	evalAgentTurn: EvaluationTurn;
	metric: Omit<BenchmarkTurnMetric, "turn_index">;
}> {
	const t0 = performance.now();
	const scope = evaluateServiceScope(step.userText);
	const policyCheckMs = Math.max(
		1,
		Math.round((performance.now() - t0) * 10) / 10,
	);

	if (!scope.supported && !step.toolName) {
		const reply = scope.speak_this || step.fallbackText;
		return {
			evalUserTurn: { role: "user", content: step.userText },
			evalAgentTurn: { role: "assistant", content: reply },
			metric: {
				vad_ms: 0,
				stt_ms: 0,
				llm_ttft_ms: policyCheckMs,
				tool_ms: 0,
				tts_ttfb_ms: 0,
				total_turn_rtt_ms: policyCheckMs,
				tool_called: null,
				transcript_user: step.userText,
				transcript_agent: reply,
			},
		};
	}

	if (step.toolName && step.toolArgs) {
		const toolStart = performance.now();
		const res = await toolService.execute(step.toolName, step.toolArgs, {
			callerPhone: step.callerPhone,
		});
		const measuredToolMs = Math.max(
			1,
			Math.round((performance.now() - toolStart) * 10) / 10,
		);
		const reply = String(
			res.data.speak_this || res.data.message || step.fallbackText,
		);
		const totalMs = Math.round((policyCheckMs + measuredToolMs) * 10) / 10;

		return {
			evalUserTurn: { role: "user", content: step.userText },
			evalAgentTurn: {
				role: "assistant",
				content: reply,
				tool_name: step.toolName,
				tool_args: step.toolArgs,
				tool_result: res.data,
			},
			metric: {
				vad_ms: 0,
				stt_ms: 0,
				llm_ttft_ms: policyCheckMs,
				tool_ms: measuredToolMs,
				tts_ttfb_ms: 0,
				total_turn_rtt_ms: totalMs,
				tool_called: step.toolName,
				tool_args: step.toolArgs,
				tool_result: res.data,
				transcript_user: step.userText,
				transcript_agent: reply,
			},
		};
	}

	return {
		evalUserTurn: { role: "user", content: step.userText },
		evalAgentTurn: { role: "assistant", content: step.fallbackText },
		metric: {
			vad_ms: 0,
			stt_ms: 0,
			llm_ttft_ms: policyCheckMs,
			tool_ms: 0,
			tts_ttfb_ms: 0,
			total_turn_rtt_ms: policyCheckMs,
			tool_called: null,
			transcript_user: step.userText,
			transcript_agent: step.fallbackText,
		},
	};
}

async function runSingleScenarioForEngine(
	env: Env,
	telemetry: TelemetryService,
	arch: Architecture,
	scenarioId: string,
): Promise<{
	run_id: string;
	evaluation: ScenarioEvaluationResult;
	total_cost_usd: number;
}> {
	const client = createWorkizClient(env, { pageDelayMs: 0 });
	const schedule = new ScheduleService(env.DB, client);
	const toolService = new ToolExecutionService(schedule);

	const steps = getScenarioSteps(scenarioId);
	const evalTurns: EvaluationTurn[] = [];
	const turnMetrics: BenchmarkTurnMetric[] = [];

	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		if (!step) continue;
		const out = await executeStepOnBackend(step, toolService);
		evalTurns.push(out.evalUserTurn, out.evalAgentTurn);
		turnMetrics.push({
			...out.metric,
			turn_index: i,
		});
	}

	const evaluation = evaluateScenarioTranscript(scenarioId, arch, evalTurns);
	const taggedTurns = turnMetrics.map((tm) => ({
		...tm,
		policy_verdict: (evaluation.passed ? "pass" : "fail") as "pass" | "fail",
	}));

	const ingestPayload: BenchmarkRunIngest = {
		run_id: `${arch}-${scenarioId}-${Date.now()}`,
		architecture: arch,
		scenario_id: scenarioId,
		policy_passed: evaluation.passed,
		task_completed: evaluation.task_completed,
		resolution_turns: evaluation.resolution_turns,
		tools_called_count: evaluation.tools_called_count,
		tool_accuracy_score: evaluation.tool_accuracy_score,
		effectiveness_score: evaluation.effectiveness_score,
		assertions_passed: evaluation.assertions_passed,
		total_assertions: evaluation.total_assertions,
		evaluation_details: evaluation.details,
		provenance: "edge_simulation",
		summary: `${evaluation.name}: ${evaluation.passed ? "All assertions passed" : "Assertion failed"} (${evaluation.effectiveness_score}% effectiveness)`,
		turns: taggedTurns,
	};

	const recorded = await telemetry.recordRun(ingestPayload);
	return {
		run_id: recorded.run_id,
		evaluation,
		total_cost_usd: recorded.total_cost_usd,
	};
}

benchmarkRoutes.post("/telemetry", async (c) => {
	try {
		const rawBody = await c.req.json();
		const parseResult = BenchmarkRunIngestSchema.safeParse(rawBody);

		if (!parseResult.success) {
			return c.json(
				{
					ok: false,
					error: "Invalid benchmark telemetry schema",
					details: parseResult.error.issues,
				},
				400,
			);
		}

		const telemetry = new TelemetryService(c.env.DB);
		const result = await telemetry.recordRun(parseResult.data);

		return c.json({
			ok: true,
			message: "Telemetry recorded successfully",
			...result,
		});
	} catch (err: unknown) {
		return c.json(
			{
				ok: false,
				error: "Failed to record telemetry",
				message: errorMessage(err),
			},
			500,
		);
	}
});

benchmarkRoutes.get("/telemetry", async (c) => {
	try {
		const provenance = c.req.query("provenance") || "all";
		const telemetry = new TelemetryService(c.env.DB);
		const comparison = await telemetry.getComparison(provenance);
		return c.json(comparison);
	} catch (err: unknown) {
		return c.json(
			{
				ok: false,
				error: "Failed to fetch benchmark comparison",
				message: errorMessage(err),
			},
			500,
		);
	}
});

benchmarkRoutes.get("/runs", async (c) => {
	try {
		const limit = Number(c.req.query("limit") ?? "50");
		const telemetry = new TelemetryService(c.env.DB);
		const runs = await telemetry.listRuns(limit);
		return c.json({ ok: true, count: runs.length, runs });
	} catch (err: unknown) {
		return c.json(
			{
				ok: false,
				error: "Failed to list benchmark runs",
				message: errorMessage(err),
			},
			500,
		);
	}
});

benchmarkRoutes.post("/evaluate", async (c) => {
	try {
		const body = (await c.req.json()) as {
			architecture?: Architecture;
			scenario_id?: string;
			provenance?: "live_webrtc" | "edge_simulation";
			record?: boolean;
			total_duration_ms?: number;
			turns?: Array<{
				role?: "user" | "assistant";
				content?: string;
				tool_name?: string;
				tool_called?: string;
				tool_args?: Record<string, unknown>;
				tool_result?: Record<string, unknown>;
				vad_ms?: number;
				stt_ms?: number;
				llm_ttft_ms?: number;
				tool_ms?: number;
				tool_latency_ms?: number;
				tts_ttfb_ms?: number;
				total_turn_rtt_ms?: number;
				client_rtt_ms?: number;
				prompt_tokens?: number;
				completion_tokens?: number;
				audio_input_seconds?: number;
				audio_output_seconds?: number;
			}>;
		};

		const arch: Architecture = body.architecture || "cloudflare";
		const scenarioId = body.scenario_id || "sarah";
		const rawTurns = body.turns || [];

		const evalTurns: EvaluationTurn[] = rawTurns.map((t) => ({
			role: t.role === "user" ? "user" : "assistant",
			content: t.content || "",
			tool_name: t.tool_name || t.tool_called,
			tool_args: t.tool_args,
			tool_result: t.tool_result,
		}));

		const evaluation = evaluateScenarioTranscript(scenarioId, arch, evalTurns);

		// Pair user + assistant turns into BenchmarkTurnMetric records
		const metricTurns: BenchmarkTurnMetric[] = [];
		let pendingUserText = "";
		let estimatedCostUsd = 0;
		for (const t of rawTurns) {
			if (t.role === "user") {
				pendingUserText = t.content || "";
				continue;
			}
			const rtt = t.total_turn_rtt_ms ?? t.client_rtt_ms ?? 1;
			const toolLatency = t.tool_ms ?? t.tool_latency_ms ?? 0;
			const turnMetric: BenchmarkTurnMetric = {
				turn_index: metricTurns.length,
				vad_ms: t.vad_ms ?? 0,
				stt_ms: t.stt_ms ?? 0,
				llm_ttft_ms: t.llm_ttft_ms ?? 0,
				tool_ms: toolLatency,
				tts_ttfb_ms: t.tts_ttfb_ms ?? 0,
				total_turn_rtt_ms: Math.max(1, rtt),
				client_rtt_ms: t.client_rtt_ms,
				prompt_tokens: t.prompt_tokens,
				completion_tokens: t.completion_tokens,
				audio_input_seconds: t.audio_input_seconds,
				audio_output_seconds: t.audio_output_seconds,
				tool_called: t.tool_name ?? t.tool_called ?? null,
				tool_args: t.tool_args,
				tool_result: t.tool_result,
				policy_verdict: evaluation.passed ? "pass" : "fail",
				transcript_user: pendingUserText,
				transcript_agent: t.content || "",
			};
			estimatedCostUsd += calculateTurnCost(arch, turnMetric);
			metricTurns.push(turnMetric);
			pendingUserText = "";
		}
		estimatedCostUsd = Math.round(estimatedCostUsd * 10000) / 10000;

		if (body.record === false) {
			return c.json({
				ok: true,
				evaluation,
				cost_usd: estimatedCostUsd,
			});
		}

		if (metricTurns.length === 0) {
			return c.json({
				ok: true,
				evaluation,
				cost_usd: 0,
				recorded: null,
			});
		}

		const telemetry = new TelemetryService(c.env.DB);
		const recorded = await telemetry.recordRun({
			architecture: arch,
			scenario_id: scenarioId,
			provenance: body.provenance || "live_webrtc",
			policy_passed: evaluation.passed,
			task_completed: evaluation.task_completed,
			resolution_turns: evaluation.resolution_turns,
			tools_called_count: evaluation.tools_called_count,
			tool_accuracy_score: evaluation.tool_accuracy_score,
			effectiveness_score: evaluation.effectiveness_score,
			assertions_passed: evaluation.assertions_passed,
			total_assertions: evaluation.total_assertions,
			evaluation_details: evaluation.details,
			total_duration_ms: body.total_duration_ms,
			summary: `${evaluation.name} (${body.provenance || "live_webrtc"}): ${evaluation.effectiveness_score}% effectiveness`,
			turns: metricTurns,
		});

		return c.json({
			ok: true,
			evaluation,
			cost_usd: recorded.total_cost_usd,
			run_id: recorded.run_id,
			recorded,
		});
	} catch (err: unknown) {
		return c.json(
			{
				ok: false,
				error: "Failed to evaluate conversation",
				message: errorMessage(err),
			},
			500,
		);
	}
});

benchmarkRoutes.post("/run-suite", async (c) => {
	try {
		const body = (await c.req.json().catch(() => ({}))) as {
			engine?: Architecture | "all";
			architectures?: Architecture[];
			scenario_id?: string;
		};
		const targetEngine = body.engine || "all";
		const engines: Architecture[] = Array.isArray(body.architectures)
			? body.architectures
			: targetEngine === "all"
				? ["cloudflare", "elevenlabs", "livekit", "retell"]
				: [targetEngine];

		const scenarios = body.scenario_id
			? CORE_REGRESSION_SCENARIOS.filter((s) => s.id === body.scenario_id)
			: CORE_REGRESSION_SCENARIOS;

		const telemetry = new TelemetryService(c.env.DB);
		const client = createWorkizClient(c.env, { pageDelayMs: 0 });
		const suiteResults: Array<{
			run_id: string;
			architecture: Architecture;
			scenario_id: string;
			passed: boolean;
			effectiveness_score: number;
			total_cost_usd: number;
		}> = [];

		const suiteStart = performance.now();
		for (const arch of engines) {
			// Ensure clean seeded state in D1 before each engine's scenario batch
			await seedMockCrm(c.env.DB);
			await syncFromWorkiz(c.env.DB, client);

			for (const sc of scenarios) {
				const res = await runSingleScenarioForEngine(
					c.env,
					telemetry,
					arch,
					sc.id,
				);
				suiteResults.push({
					run_id: res.run_id,
					architecture: arch,
					scenario_id: sc.id,
					passed: res.evaluation.passed,
					effectiveness_score: res.evaluation.effectiveness_score,
					total_cost_usd: res.total_cost_usd,
				});
			}
		}

		// Restore seeded state after suite finishes
		await seedMockCrm(c.env.DB);
		await syncFromWorkiz(c.env.DB, client);

		const suiteElapsedMs = Math.round(performance.now() - suiteStart);
		const passedCount = suiteResults.filter((r) => r.passed).length;
		const totalCount = suiteResults.length;
		const overallScore =
			totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 100;
		const avgEffScore =
			totalCount > 0
				? Math.round(
						suiteResults.reduce((acc, r) => acc + r.effectiveness_score, 0) /
							totalCount,
					)
				: 100;
		const comparison = await telemetry.getComparison("all");

		return c.json({
			ok: true,
			total_scenarios_run: totalCount,
			passed_scenarios: passedCount,
			overall_fidelity_score: overallScore,
			summary: {
				passed_runs: passedCount,
				total_runs: totalCount,
				avg_effectiveness_score: avgEffScore,
				suite_elapsed_ms: suiteElapsedMs,
			},
			results: suiteResults,
			comparison,
		});
	} catch (err: unknown) {
		return c.json(
			{
				ok: false,
				error: "Failed to execute benchmark suite",
				message: errorMessage(err),
			},
			500,
		);
	}
});
