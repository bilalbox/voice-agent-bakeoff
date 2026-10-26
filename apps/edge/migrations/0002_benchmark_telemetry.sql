-- Benchmark run telemetry and turn latency breakdown

CREATE TABLE IF NOT EXISTS benchmark_runs (
  id TEXT PRIMARY KEY,
  architecture TEXT NOT NULL, -- retell | livekit | cloudflare
  scenario_id TEXT NOT NULL,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  total_turns INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0.0,
  policy_passed INTEGER NOT NULL DEFAULT 1, -- 1 for pass, 0 for fail
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_benchmark_runs_arch ON benchmark_runs(architecture, scenario_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_created ON benchmark_runs(created_at);

CREATE TABLE IF NOT EXISTS benchmark_turn_metrics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  architecture TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  vad_ms REAL,
  stt_ms REAL,
  llm_ttft_ms REAL,
  tool_ms REAL,
  tts_ttfb_ms REAL,
  total_turn_rtt_ms REAL NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  audio_input_seconds REAL,
  audio_output_seconds REAL,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  tool_called TEXT,
  policy_verdict TEXT, -- pass | fail | neutral
  transcript_user TEXT,
  transcript_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES benchmark_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turn_metrics_run ON benchmark_turn_metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_turn_metrics_arch ON benchmark_turn_metrics(architecture);
