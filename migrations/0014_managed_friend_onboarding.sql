ALTER TABLE invites ADD COLUMN acceptance TEXT NOT NULL DEFAULT 'legacy_code'
  CHECK (acceptance IN ('legacy_code', 'verified_email'));
ALTER TABLE invites ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'legacy'
  CHECK (access_mode IN ('legacy', 'managed_pilot'));
ALTER TABLE invites ADD COLUMN managed_research INTEGER NOT NULL DEFAULT 0
  CHECK (managed_research IN (0, 1));
ALTER TABLE invites ADD COLUMN display_name TEXT;

CREATE INDEX IF NOT EXISTS idx_invites_email_acceptance
  ON invites(email, acceptance, accepted_at, expires_at);

ALTER TABLE users ADD COLUMN usage_subject TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_usage_subject
  ON users(usage_subject) WHERE usage_subject IS NOT NULL;

ALTER TABLE ai_usage_events ADD COLUMN provider_request_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_request
  ON ai_usage_events(provider_request_id) WHERE provider_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY,
  ready_email_enabled INTEGER NOT NULL DEFAULT 1 CHECK (ready_email_enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('shortlist_ready')),
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'skipped')),
  provider_message_id TEXT,
  error TEXT,
  attempted_at TEXT NOT NULL,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, agent_run_id, kind),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user_created
  ON notification_deliveries(user_id, created_at DESC);
