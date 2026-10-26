import {
  type BenchmarkRunIngest,
  type BenchmarkTurnMetric,
  type Architecture,
  calculateTurnCost,
} from "@applianceops/contracts";

export interface ComponentMetricStats {
  p50: number;
  p95: number;
  mean: number;
  min: number;
  max: number;
}

export interface ArchitectureSummary {
  architecture: Architecture;
  total_runs: number;
  total_turns: number;
  policy_pass_rate: number;
  avg_cost_per_minute: number;
  total_cost_usd: number;
  latencies: {
    vad: ComponentMetricStats;
    stt: ComponentMetricStats;
    llm_ttft: ComponentMetricStats;
    tool: ComponentMetricStats;
    tts_ttfb: ComponentMetricStats;
    total_turn_rtt: ComponentMetricStats;
  };
}

export interface BenchmarkComparisonResponse {
  timestamp: string;
  architectures: Record<Architecture, ArchitectureSummary>;
  recent_runs: Array<{
    id: string;
    architecture: Architecture;
    scenario_id: string;
    total_duration_ms: number;
    total_turns: number;
    total_cost_usd: number;
    policy_passed: boolean;
    created_at: string;
  }>;
}

function calculateStats(values: number[]): ComponentMetricStats {
  if (values.length === 0) {
    return { p50: 0, p95: 0, mean: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = Math.round((sum / sorted.length) * 10) / 10;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  const p50Index = Math.floor(sorted.length * 0.5);
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));

  return {
    p50: sorted[p50Index],
    p95: sorted[p95Index],
    mean,
    min,
    max,
  };
}

export class TelemetryService {
  constructor(private db: D1Database) {}

  async recordRun(run: BenchmarkRunIngest): Promise<{ run_id: string; total_cost_usd: number }> {
    const runId = run.run_id || `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    let totalCostUsd = 0;
    let totalDurationMs = run.total_duration_ms ?? 0;

    const turnsWithCost = run.turns.map((t, idx) => {
      const cost = t.cost_usd ?? calculateTurnCost(run.architecture, t);
      totalCostUsd += cost;
      if (!run.total_duration_ms) {
        totalDurationMs += t.total_turn_rtt_ms;
      }
      return {
        ...t,
        turn_index: t.turn_index ?? idx,
        cost_usd: cost,
      };
    });

    totalCostUsd = Math.round(totalCostUsd * 10000) / 10000;

    // Insert benchmark run header
    await this.db
      .prepare(
        `INSERT INTO benchmark_runs (
          id, architecture, scenario_id, total_duration_ms, total_turns, total_cost_usd, policy_passed, summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        runId,
        run.architecture,
        run.scenario_id,
        totalDurationMs,
        turnsWithCost.length,
        totalCostUsd,
        run.policy_passed ? 1 : 0,
        run.summary || null,
        now
      )
      .run();

    // Insert turns
    const stmts = turnsWithCost.map((t, idx) => {
      const turnId = `${runId}-turn-${idx}`;
      return this.db
        .prepare(
          `INSERT INTO benchmark_turn_metrics (
            id, run_id, architecture, scenario_id, turn_index,
            vad_ms, stt_ms, llm_ttft_ms, tool_ms, tts_ttfb_ms, total_turn_rtt_ms,
            prompt_tokens, completion_tokens, audio_input_seconds, audio_output_seconds,
            cost_usd, tool_called, policy_verdict, transcript_user, transcript_agent, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          t.prompt_tokens ?? null,
          t.completion_tokens ?? null,
          t.audio_input_seconds ?? null,
          t.audio_output_seconds ?? null,
          t.cost_usd,
          t.tool_called ?? null,
          t.policy_verdict ?? null,
          t.transcript_user ?? null,
          t.transcript_agent ?? null,
          now
        );
    });

    if (stmts.length > 0) {
      await this.db.batch(stmts);
    }

    return { run_id: runId, total_cost_usd: totalCostUsd };
  }

  async getComparison(): Promise<BenchmarkComparisonResponse> {
    const archs: Architecture[] = ["retell", "livekit", "cloudflare"];
    const results: Partial<Record<Architecture, ArchitectureSummary>> = {};

    for (const arch of archs) {
      // 1. Fetch runs aggregates
      const runStats = await this.db
        .prepare(
          `SELECT 
            COUNT(*) as total_runs,
            SUM(CASE WHEN policy_passed = 1 THEN 1 ELSE 0 END) as passed_runs,
            SUM(total_turns) as total_turns,
            SUM(total_cost_usd) as total_cost,
            SUM(total_duration_ms) as total_duration_ms
           FROM benchmark_runs
           WHERE architecture = ?`
        )
        .bind(arch)
        .first<{
          total_runs: number;
          passed_runs: number;
          total_turns: number;
          total_cost: number;
          total_duration_ms: number;
        }>();

      const totalRuns = runStats?.total_runs ?? 0;
      const totalTurns = runStats?.total_turns ?? 0;
      const passedRuns = runStats?.passed_runs ?? 0;
      const totalCost = runStats?.total_cost ?? 0;
      const totalDuration = runStats?.total_duration_ms ?? 0;

      const policyPassRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 100;
      const totalMinutes = totalDuration > 0 ? totalDuration / 60000 : (totalTurns * 7.0) / 60.0;
      const avgCostPerMin = totalMinutes > 0 ? Math.round((totalCost / totalMinutes) * 10000) / 10000 : 0.05;

      // 2. Fetch turns for latency metrics
      const turnRows = await this.db
        .prepare(
          `SELECT vad_ms, stt_ms, llm_ttft_ms, tool_ms, tts_ttfb_ms, total_turn_rtt_ms
           FROM benchmark_turn_metrics
           WHERE architecture = ?`
        )
        .bind(arch)
        .all<{
          vad_ms: number | null;
          stt_ms: number | null;
          llm_ttft_ms: number | null;
          tool_ms: number | null;
          tts_ttfb_ms: number | null;
          total_turn_rtt_ms: number;
        }>();

      const turns = turnRows.results ?? [];

      const vads = turns.map((t) => t.vad_ms).filter((v): v is number => typeof v === "number");
      const stts = turns.map((t) => t.stt_ms).filter((v): v is number => typeof v === "number");
      const llms = turns.map((t) => t.llm_ttft_ms).filter((v): v is number => typeof v === "number");
      const tools = turns.map((t) => t.tool_ms).filter((v): v is number => typeof v === "number");
      const ttss = turns.map((t) => t.tts_ttfb_ms).filter((v): v is number => typeof v === "number");
      const rtts = turns.map((t) => t.total_turn_rtt_ms);

      results[arch] = {
        architecture: arch,
        total_runs: totalRuns,
        total_turns: totalTurns,
        policy_pass_rate: policyPassRate,
        avg_cost_per_minute: avgCostPerMin,
        total_cost_usd: Math.round(totalCost * 10000) / 10000,
        latencies: {
          vad: calculateStats(vads),
          stt: calculateStats(stts),
          llm_ttft: calculateStats(llms),
          tool: calculateStats(tools),
          tts_ttfb: calculateStats(ttss),
          total_turn_rtt: calculateStats(rtts),
        },
      };
    }

    // 3. Fetch recent runs
    const recent = await this.db
      .prepare(
        `SELECT id, architecture, scenario_id, total_duration_ms, total_turns, total_cost_usd, policy_passed, created_at
         FROM benchmark_runs
         ORDER BY created_at DESC
         LIMIT 20`
      )
      .all<{
        id: string;
        architecture: Architecture;
        scenario_id: string;
        total_duration_ms: number;
        total_turns: number;
        total_cost_usd: number;
        policy_passed: number;
        created_at: string;
      }>();

    return {
      timestamp: new Date().toISOString(),
      architectures: results as Record<Architecture, ArchitectureSummary>,
      recent_runs: (recent.results ?? []).map((r) => ({
        ...r,
        policy_passed: Boolean(r.policy_passed),
      })),
    };
  }

  async listRuns(limit = 50) {
    const runs = await this.db
      .prepare(
        `SELECT id, architecture, scenario_id, total_duration_ms, total_turns, total_cost_usd, policy_passed, summary, created_at
         FROM benchmark_runs
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(limit)
      .all();
    return runs.results ?? [];
  }
}
