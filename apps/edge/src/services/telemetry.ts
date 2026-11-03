import {
	type Architecture,
	type BenchmarkRunIngest,
	type BenchmarkTurnMetric,
	calculateTurnCost,
	type EvaluationDetail,
	type EvaluationTurn,
	estimateTurnTokensAndAudio,
	evaluateScenarioTranscript,
	resolveScenarioDefinition,
} from "@applianceops/contracts";

export interface ComponentMetricStats {
	p50: number;
	p95: number;
	mean: number;
	min: number;
	max: number;
}

export interface ArchitectureLatencyBreakdown {
	vad: ComponentMetricStats;
	stt: ComponentMetricStats;
	llm_ttft: ComponentMetricStats;
	tool: ComponentMetricStats;
	tts_ttfb: ComponentMetricStats;
	total_turn_rtt: ComponentMetricStats;
}

export interface ArchitectureSummary {
	architecture: Architecture;
	total_runs: number;
	live_runs: number;
	sim_runs: number;
	total_turns: number;
	policy_pass_rate: number;
	task_completion_rate: number;
	tool_accuracy_rate: number;
	avg_effectiveness_score: number;
	avg_turns_to_resolution: number;
	avg_cost_per_minute: number;
	avg_cost_per_resolved_call: number;
	total_cost_usd: number;
	latencies: ArchitectureLatencyBreakdown;
}

export interface RecordedTurnView {
	turn_index: number;
	vad_ms: number | null;
	stt_ms: number | null;
	llm_ttft_ms: number | null;
	tool_ms: number | null;
	tts_ttfb_ms: number | null;
	total_turn_rtt_ms: number;
	client_rtt_ms: number | null;
	tool_called: string | null;
	policy_verdict: string | null;
	transcript_user: string | null;
	transcript_agent: string | null;
	cost_usd: number;
}

export interface ScenarioArchitectureTelemetry {
	runs: number;
	passed: number;
	pass_rate: number;
	effectiveness_score: number;
	latencies: {
		vad: number;
		stt: number;
		llm: number;
		tool: number;
		tts: number;
		total: number;
		p95_total: number;
	};
	latest_turns: RecordedTurnView[];
	evaluation_details: EvaluationDetail[];
}

export interface ScenarioTelemetrySummary {
	scenario_id: string;
	total_runs: number;
	passed_runs: number;
	pass_rate: number;
	avg_effectiveness_score: number;
	by_architecture: Partial<Record<Architecture, ScenarioArchitectureTelemetry>>;
}

export interface BenchmarkRunRecord {
	id: string;
	architecture: Architecture;
	scenario_id: string;
	provenance: string;
	total_duration_ms: number;
	total_turns: number;
	total_cost_usd: number;
	policy_passed: boolean;
	task_completed: boolean;
	effectiveness_score: number;
	tool_accuracy_score: number;
	resolution_turns: number;
	tools_called_count: number;
	evaluation_details: EvaluationDetail[];
	summary: string | null;
	created_at: string;
}

export interface BenchmarkComparisonResponse {
	timestamp: string;
	provenance_filter: string;
	architectures: Record<Architecture, ArchitectureSummary>;
	scenarios: Record<string, ScenarioTelemetrySummary>;
	recent_runs: BenchmarkRunRecord[];
}

interface TurnMetricRow {
	run_id: string;
	architecture: Architecture;
	scenario_id: string;
	turn_index: number;
	vad_ms: number | null;
	stt_ms: number | null;
	llm_ttft_ms: number | null;
	tool_ms: number | null;
	tts_ttfb_ms: number | null;
	total_turn_rtt_ms: number;
	client_rtt_ms: number | null;
	tool_called: string | null;
	policy_verdict: string | null;
	transcript_user: string | null;
	transcript_agent: string | null;
	cost_usd: number;
}

interface RunRow {
	id: string;
	architecture: Architecture;
	scenario_id: string;
	provenance: string | null;
	total_duration_ms: number;
	total_turns: number;
	total_cost_usd: number;
	policy_passed: number;
	task_completed: number | null;
	effectiveness_score: number | null;
	tool_accuracy_score: number | null;
	resolution_turns: number | null;
	tools_called_count: number | null;
	evaluation_details_json: string | null;
	summary: string | null;
	created_at: string;
}

function calculateStats(values: number[]): ComponentMetricStats {
	if (values.length === 0) {
		return { p50: 0, p95: 0, mean: 0, min: 0, max: 0 };
	}
	const sorted = [...values].sort((a, b) => a - b);
	const sum = sorted.reduce((acc, v) => acc + v, 0);
	const mean = Math.round((sum / sorted.length) * 10) / 10;
	const min = sorted[0] ?? 0;
	const max = sorted[sorted.length - 1] ?? 0;

	const p50Index = Math.floor(sorted.length * 0.5);
	const p95Index = Math.min(
		sorted.length - 1,
		Math.floor(sorted.length * 0.95),
	);

	return {
		p50: sorted[p50Index] ?? 0,
		p95: sorted[p95Index] ?? 0,
		mean,
		min,
		max,
	};
}

function buildLatencyBreakdown(
	turns: TurnMetricRow[],
): ArchitectureLatencyBreakdown {
	const numValues = (picker: (t: TurnMetricRow) => number | null): number[] =>
		turns.map(picker).filter((v): v is number => typeof v === "number");

	return {
		vad: calculateStats(numValues((t) => t.vad_ms)),
		stt: calculateStats(numValues((t) => t.stt_ms)),
		llm_ttft: calculateStats(numValues((t) => t.llm_ttft_ms)),
		tool: calculateStats(numValues((t) => t.tool_ms)),
		tts_ttfb: calculateStats(numValues((t) => t.tts_ttfb_ms)),
		total_turn_rtt: calculateStats(turns.map((t) => t.total_turn_rtt_ms)),
	};
}

function toEvaluationTurns(turns: BenchmarkTurnMetric[]): EvaluationTurn[] {
	const evalTurns: EvaluationTurn[] = [];
	for (const t of turns) {
		if (t.transcript_user) {
			evalTurns.push({ role: "user", content: t.transcript_user });
		}
		if (t.transcript_agent || t.tool_called) {
			evalTurns.push({
				role: "assistant",
				content: t.transcript_agent ?? "",
				tool_name: t.tool_called ?? undefined,
				tool_args: t.tool_args,
				tool_result: t.tool_result,
			});
		}
	}
	return evalTurns;
}

function deriveRunEffectiveness(run: BenchmarkRunIngest): {
	taskCompleted: boolean;
	effectivenessScore: number;
	toolAccuracyScore: number;
	resolutionTurns: number;
	toolsCalledCount: number;
	details: EvaluationDetail[];
} {
	const toolsCalled = run.turns.filter((t) => Boolean(t.tool_called)).length;
	const defaultTurns = run.turns.length;

	const scenarioDef = resolveScenarioDefinition(run.scenario_id);
	if (scenarioDef && run.turns.some((t) => Boolean(t.transcript_agent))) {
		const evalRes = evaluateScenarioTranscript(
			run.scenario_id,
			run.architecture,
			toEvaluationTurns(run.turns),
		);
		return {
			taskCompleted: run.task_completed ?? evalRes.task_completed,
			effectivenessScore:
				run.effectiveness_score ?? evalRes.effectiveness_score,
			toolAccuracyScore: run.tool_accuracy_score ?? evalRes.tool_accuracy_score,
			resolutionTurns: run.resolution_turns ?? evalRes.resolution_turns,
			toolsCalledCount: run.tools_called_count ?? evalRes.tools_called_count,
			details: run.evaluation_details ?? evalRes.details,
		};
	}

	const taskCompleted = run.task_completed ?? run.policy_passed;
	const toolAcc = run.tool_accuracy_score ?? (run.policy_passed ? 100 : 50);
	const effScore =
		run.effectiveness_score ??
		Math.round(
			(run.policy_passed ? 50 : 0) + (taskCompleted ? 30 : 0) + toolAcc * 0.2,
		);

	return {
		taskCompleted,
		effectivenessScore: effScore,
		toolAccuracyScore: toolAcc,
		resolutionTurns: run.resolution_turns ?? defaultTurns,
		toolsCalledCount: run.tools_called_count ?? toolsCalled,
		details: run.evaluation_details ?? [],
	};
}

function parseDetailsJson(raw: string | null): EvaluationDetail[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as EvaluationDetail[]) : [];
	} catch {
		return [];
	}
}

function mapRunRowToRecord(r: RunRow): BenchmarkRunRecord {
	const policyPassed = Boolean(r.policy_passed);
	return {
		id: r.id,
		architecture: r.architecture,
		scenario_id: r.scenario_id,
		provenance: r.provenance || "edge_simulation",
		total_duration_ms: r.total_duration_ms,
		total_turns: r.total_turns,
		total_cost_usd: r.total_cost_usd,
		policy_passed: policyPassed,
		task_completed:
			r.task_completed !== null ? Boolean(r.task_completed) : policyPassed,
		effectiveness_score: r.effectiveness_score ?? (policyPassed ? 100 : 40),
		tool_accuracy_score: r.tool_accuracy_score ?? (policyPassed ? 100 : 50),
		resolution_turns: r.resolution_turns ?? r.total_turns,
		tools_called_count: r.tools_called_count ?? 0,
		evaluation_details: parseDetailsJson(r.evaluation_details_json),
		summary: r.summary,
		created_at: r.created_at,
	};
}

export class TelemetryService {
	constructor(private db: D1Database) {}

	private async ensureSchemaColumns(): Promise<void> {
		const alterStatements = [
			"ALTER TABLE benchmark_runs ADD COLUMN provenance TEXT NOT NULL DEFAULT 'edge_simulation'",
			"ALTER TABLE benchmark_runs ADD COLUMN task_completed INTEGER NOT NULL DEFAULT 1",
			"ALTER TABLE benchmark_runs ADD COLUMN effectiveness_score REAL NOT NULL DEFAULT 100.0",
			"ALTER TABLE benchmark_runs ADD COLUMN tool_accuracy_score REAL NOT NULL DEFAULT 100.0",
			"ALTER TABLE benchmark_runs ADD COLUMN resolution_turns INTEGER NOT NULL DEFAULT 0",
			"ALTER TABLE benchmark_runs ADD COLUMN tools_called_count INTEGER NOT NULL DEFAULT 0",
			"ALTER TABLE benchmark_runs ADD COLUMN evaluation_details_json TEXT",
			"ALTER TABLE benchmark_turn_metrics ADD COLUMN client_rtt_ms REAL",
		];
		for (const sql of alterStatements) {
			try {
				await this.db.prepare(sql).run();
			} catch {
				// Column already exists
			}
		}
	}

	async recordRun(run: BenchmarkRunIngest): Promise<{
		run_id: string;
		total_cost_usd: number;
		effectiveness_score: number;
		task_completed: boolean;
		policy_passed: boolean;
		evaluation_details: EvaluationDetail[];
	}> {
		await this.ensureSchemaColumns();

		const runId =
			run.run_id ||
			`run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const now = new Date().toISOString();

		let totalCostUsd = 0;
		let totalDurationMs = run.total_duration_ms ?? 0;

		const turnsWithCost = run.turns.map((t, idx) => {
			const derived = estimateTurnTokensAndAudio(t);
			const cost = t.cost_usd ?? calculateTurnCost(run.architecture, t);
			totalCostUsd += cost;
			if (!run.total_duration_ms) {
				totalDurationMs += t.total_turn_rtt_ms;
			}
			return {
				...t,
				turn_index: t.turn_index ?? idx,
				prompt_tokens: derived.prompt_tokens,
				completion_tokens: derived.completion_tokens,
				audio_input_seconds: derived.audio_input_seconds,
				audio_output_seconds: derived.audio_output_seconds,
				cost_usd: cost,
			};
		});

		totalCostUsd = Math.round(totalCostUsd * 10000) / 10000;
		const eff = deriveRunEffectiveness(run);
		const provenance = run.provenance ?? "edge_simulation";

		await this.db
			.prepare(
				`INSERT INTO benchmark_runs (
          id, architecture, scenario_id, provenance, total_duration_ms, total_turns,
          total_cost_usd, policy_passed, task_completed, effectiveness_score,
          tool_accuracy_score, resolution_turns, tools_called_count,
          evaluation_details_json, summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				runId,
				run.architecture,
				run.scenario_id,
				provenance,
				totalDurationMs,
				turnsWithCost.length,
				totalCostUsd,
				run.policy_passed ? 1 : 0,
				eff.taskCompleted ? 1 : 0,
				eff.effectivenessScore,
				eff.toolAccuracyScore,
				eff.resolutionTurns,
				eff.toolsCalledCount,
				JSON.stringify(eff.details),
				run.summary || null,
				now,
			)
			.run();

		const stmts = turnsWithCost.map((t, idx) => {
			const turnId = `${runId}-turn-${idx}`;
			return this.db
				.prepare(
					`INSERT INTO benchmark_turn_metrics (
            id, run_id, architecture, scenario_id, turn_index,
            vad_ms, stt_ms, llm_ttft_ms, tool_ms, tts_ttfb_ms, total_turn_rtt_ms, client_rtt_ms,
            prompt_tokens, completion_tokens, audio_input_seconds, audio_output_seconds,
            cost_usd, tool_called, policy_verdict, transcript_user, transcript_agent, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					turnId,
					runId,
					run.architecture,
					run.scenario_id,
					t.turn_index,
					t.vad_ms ?? null,
					t.stt_ms ?? null,
					t.llm_ttft_ms ?? null,
					t.tool_ms ?? null,
					t.tts_ttfb_ms ?? null,
					t.total_turn_rtt_ms,
					t.client_rtt_ms ?? null,
					t.prompt_tokens,
					t.completion_tokens,
					t.audio_input_seconds,
					t.audio_output_seconds,
					t.cost_usd,
					t.tool_called ?? null,
					t.policy_verdict ?? null,
					t.transcript_user ?? null,
					t.transcript_agent ?? null,
					now,
				);
		});

		if (stmts.length > 0) {
			await this.db.batch(stmts);
		}

		return {
			run_id: runId,
			total_cost_usd: totalCostUsd,
			effectiveness_score: eff.effectivenessScore,
			task_completed: eff.taskCompleted,
			policy_passed: run.policy_passed,
			evaluation_details: eff.details,
		};
	}

	private buildArchitectureSummary(
		arch: Architecture,
		runs: BenchmarkRunRecord[],
		turns: TurnMetricRow[],
	): ArchitectureSummary {
		const totalRuns = runs.length;
		const liveRuns = runs.filter((r) => r.provenance === "live_webrtc").length;
		const simRuns = totalRuns - liveRuns;
		const totalTurns = turns.length;

		const passedRuns = runs.filter((r) => r.policy_passed).length;
		const completedRuns = runs.filter((r) => r.task_completed).length;
		const totalCost = runs.reduce((acc, r) => acc + r.total_cost_usd, 0);
		const totalDuration = runs.reduce((acc, r) => acc + r.total_duration_ms, 0);

		const policyPassRate =
			totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 100;
		const taskCompletionRate =
			totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 100;

		const toolAccSum = runs.reduce((acc, r) => acc + r.tool_accuracy_score, 0);
		const toolAccuracyRate =
			totalRuns > 0 ? Math.round(toolAccSum / totalRuns) : 100;

		const effSum = runs.reduce((acc, r) => acc + r.effectiveness_score, 0);
		const avgEffectivenessScore =
			totalRuns > 0 ? Math.round(effSum / totalRuns) : 100;

		const avgTurnsToResolution =
			totalRuns > 0 ? Math.round((totalTurns / totalRuns) * 10) / 10 : 0;

		const totalMinutes =
			totalDuration > 0 ? totalDuration / 60000 : (totalTurns * 7.0) / 60.0;
		const avgCostPerMin =
			totalMinutes > 0
				? Math.round((totalCost / totalMinutes) * 10000) / 10000
				: 0.05;

		const avgCostPerResolvedCall =
			completedRuns > 0
				? Math.round((totalCost / completedRuns) * 10000) / 10000
				: 0;

		return {
			architecture: arch,
			total_runs: totalRuns,
			live_runs: liveRuns,
			sim_runs: simRuns,
			total_turns: totalTurns,
			policy_pass_rate: policyPassRate,
			task_completion_rate: taskCompletionRate,
			tool_accuracy_rate: toolAccuracyRate,
			avg_effectiveness_score: avgEffectivenessScore,
			avg_turns_to_resolution: avgTurnsToResolution,
			avg_cost_per_minute: avgCostPerMin,
			avg_cost_per_resolved_call: avgCostPerResolvedCall,
			total_cost_usd: Math.round(totalCost * 10000) / 10000,
			latencies: buildLatencyBreakdown(turns),
		};
	}

	private buildScenariosSummary(
		runs: BenchmarkRunRecord[],
		turns: TurnMetricRow[],
	): Record<string, ScenarioTelemetrySummary> {
		const scenarioIds = Array.from(new Set(runs.map((r) => r.scenario_id)));
		const out: Record<string, ScenarioTelemetrySummary> = {};
		const archs: Architecture[] = [
			"cloudflare",
			"elevenlabs",
			"livekit",
			"retell",
		];

		for (const scId of scenarioIds) {
			const scRuns = runs.filter((r) => r.scenario_id === scId);
			const scTurns = turns.filter((t) => t.scenario_id === scId);
			const passedRuns = scRuns.filter((r) => r.policy_passed).length;
			const effSum = scRuns.reduce((acc, r) => acc + r.effectiveness_score, 0);

			const byArch: Partial<
				Record<Architecture, ScenarioArchitectureTelemetry>
			> = {};
			for (const arch of archs) {
				const aRuns = scRuns.filter((r) => r.architecture === arch);
				if (aRuns.length === 0) continue;
				const aTurns = scTurns.filter((t) => t.architecture === arch);
				const breakdown = buildLatencyBreakdown(aTurns);
				const latestRun = aRuns[0];
				const latestTurns = latestRun
					? aTurns
							.filter((t) => t.run_id === latestRun.id)
							.sort((a, b) => a.turn_index - b.turn_index)
					: [];
				const aPassed = aRuns.filter((r) => r.policy_passed).length;
				const aEff = Math.round(
					aRuns.reduce((acc, r) => acc + r.effectiveness_score, 0) /
						aRuns.length,
				);

				byArch[arch] = {
					runs: aRuns.length,
					passed: aPassed,
					pass_rate: Math.round((aPassed / aRuns.length) * 100),
					effectiveness_score: aEff,
					latencies: {
						vad: breakdown.vad.p50,
						stt: breakdown.stt.p50,
						llm: breakdown.llm_ttft.p50,
						tool: breakdown.tool.p50,
						tts: breakdown.tts_ttfb.p50,
						total: breakdown.total_turn_rtt.p50,
						p95_total: breakdown.total_turn_rtt.p95,
					},
					latest_turns: latestTurns,
					evaluation_details: latestRun?.evaluation_details ?? [],
				};
			}

			out[scId] = {
				scenario_id: scId,
				total_runs: scRuns.length,
				passed_runs: passedRuns,
				pass_rate:
					scRuns.length > 0
						? Math.round((passedRuns / scRuns.length) * 100)
						: 100,
				avg_effectiveness_score:
					scRuns.length > 0 ? Math.round(effSum / scRuns.length) : 100,
				by_architecture: byArch,
			};
		}

		return out;
	}

	async getComparison(
		provenanceFilter = "all",
	): Promise<BenchmarkComparisonResponse> {
		await this.ensureSchemaColumns();

		const allRunRows = await this.db
			.prepare(
				`SELECT id, architecture, scenario_id, provenance, total_duration_ms, total_turns,
                total_cost_usd, policy_passed, task_completed, effectiveness_score,
                tool_accuracy_score, resolution_turns, tools_called_count,
                evaluation_details_json, summary, created_at
         FROM benchmark_runs
         ORDER BY created_at DESC`,
			)
			.all<RunRow>();

		const allTurnRows = await this.db
			.prepare(
				`SELECT run_id, architecture, scenario_id, turn_index,
                vad_ms, stt_ms, llm_ttft_ms, tool_ms, tts_ttfb_ms, total_turn_rtt_ms, client_rtt_ms,
                tool_called, policy_verdict, transcript_user, transcript_agent, cost_usd
         FROM benchmark_turn_metrics
         ORDER BY turn_index ASC`,
			)
			.all<TurnMetricRow>();

		const mappedRuns = (allRunRows.results ?? []).map(mapRunRowToRecord);
		const filteredRuns =
			provenanceFilter === "live_webrtc" ||
			provenanceFilter === "edge_simulation"
				? mappedRuns.filter((r) => r.provenance === provenanceFilter)
				: mappedRuns;

		const allowedRunIds = new Set(filteredRuns.map((r) => r.id));
		const filteredTurns = (allTurnRows.results ?? []).filter((t) =>
			allowedRunIds.has(t.run_id),
		);

		const archs: Architecture[] = [
			"retell",
			"livekit",
			"cloudflare",
			"elevenlabs",
		];
		const architectures = {} as Record<Architecture, ArchitectureSummary>;
		for (const arch of archs) {
			architectures[arch] = this.buildArchitectureSummary(
				arch,
				filteredRuns.filter((r) => r.architecture === arch),
				filteredTurns.filter((t) => t.architecture === arch),
			);
		}

		const scenarios = this.buildScenariosSummary(filteredRuns, filteredTurns);

		return {
			timestamp: new Date().toISOString(),
			provenance_filter: provenanceFilter,
			architectures,
			scenarios,
			recent_runs: filteredRuns.slice(0, 25),
		};
	}

	async listRuns(limit = 50): Promise<BenchmarkRunRecord[]> {
		await this.ensureSchemaColumns();
		const runs = await this.db
			.prepare(
				`SELECT id, architecture, scenario_id, provenance, total_duration_ms, total_turns,
                total_cost_usd, policy_passed, task_completed, effectiveness_score,
                tool_accuracy_score, resolution_turns, tools_called_count,
                evaluation_details_json, summary, created_at
         FROM benchmark_runs
         ORDER BY created_at DESC
         LIMIT ?`,
			)
			.bind(limit)
			.all<RunRow>();
		return (runs.results ?? []).map(mapRunRowToRecord);
	}
}
