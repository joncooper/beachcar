CREATE TABLE IF NOT EXISTS automation_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_automation_tokens_user_created ON automation_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_tokens_hash_active ON automation_tokens(token_hash, revoked_at);

CREATE TABLE IF NOT EXISTS automation_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_id TEXT,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (token_id) REFERENCES automation_tokens(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_events_user_created ON automation_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_events_token_created ON automation_events(token_id, created_at DESC);
