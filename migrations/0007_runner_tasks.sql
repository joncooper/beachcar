CREATE TABLE IF NOT EXISTS runner_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_run_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('source_discovery', 'codex_research', 'browser_source')),
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  input_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  error TEXT,
  runner_id TEXT,
  claimed_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_runner_tasks_status_priority ON runner_tasks(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_runner_tasks_user_created ON runner_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runner_tasks_agent_run ON runner_tasks(agent_run_id);
