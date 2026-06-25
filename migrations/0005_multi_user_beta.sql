CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  auth_provider TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  invited_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_subject ON users(auth_provider, auth_subject);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  invited_by_user_id TEXT,
  accepted_by_user_id TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TEXT,
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_code_hash ON invites(code_hash);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  niche TEXT NOT NULL DEFAULT 'Beach cars and runabouts',
  budget_min INTEGER,
  budget_max INTEGER,
  stretch_budget INTEGER,
  home_region TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  schedule_cron TEXT NOT NULL DEFAULT '0 8 * * *',
  profile_json TEXT NOT NULL DEFAULT '{}',
  onboarding_completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_settings (
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, source),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_ai_settings (
  user_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'managed' CHECK (mode IN ('managed', 'byok')),
  gateway_key_ref TEXT,
  monthly_budget_cents INTEGER,
  daily_budget_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured', 'active', 'disabled', 'error')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  actor_user_id TEXT,
  event_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_user_created ON audit_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_type_created ON audit_events(event_type, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workflow_instance_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'published', 'failed', 'cancelled')),
  progress_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_created ON agent_runs(user_id, created_at);

ALTER TABLE runs ADD COLUMN user_id TEXT;
ALTER TABLE runs ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('queued', 'running', 'published', 'failed', 'cancelled'));
ALTER TABLE runs ADD COLUMN completed_at TEXT;
ALTER TABLE runs ADD COLUMN error TEXT;

CREATE INDEX IF NOT EXISTS idx_runs_user_generated ON runs(user_id, generated_at);

CREATE TABLE IF NOT EXISTS feedback_next (
  user_id TEXT,
  listing_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('like', 'star', 'hide', 'avoid')),
  tags_json TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, listing_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (listing_key) REFERENCES listings(listing_key) ON DELETE CASCADE
);

INSERT INTO feedback_next (user_id, listing_key, action, tags_json, note, updated_at)
SELECT NULL, listing_key, action, tags_json, note, updated_at FROM feedback;

DROP TABLE feedback;

ALTER TABLE feedback_next RENAME TO feedback;

CREATE INDEX IF NOT EXISTS idx_feedback_user_updated ON feedback(user_id, updated_at);

ALTER TABLE preference_events ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_preference_events_user_created ON preference_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS image_variants (
  image_key TEXT NOT NULL,
  variant TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  content_type TEXT,
  byte_length INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending', 'created', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (image_key, variant),
  FOREIGN KEY (image_key) REFERENCES images(image_key) ON DELETE CASCADE
);
