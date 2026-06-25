CREATE TABLE IF NOT EXISTS ai_usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_run_id TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  operation TEXT NOT NULL,
  mode TEXT,
  gateway_id TEXT,
  gateway_key_ref TEXT,
  gateway_request_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'cached')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_occurred ON ai_usage_events(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_agent_run ON ai_usage_events(agent_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_gateway_request ON ai_usage_events(gateway_request_id) WHERE gateway_request_id IS NOT NULL;
