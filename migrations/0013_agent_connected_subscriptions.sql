CREATE TABLE IF NOT EXISTS user_research_settings (
  user_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'external_agent' CHECK (mode IN ('external_agent', 'managed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS billing_entitlements (
  user_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  source TEXT NOT NULL DEFAULT 'none' CHECK (source IN ('none', 'clerk_session', 'clerk_webhook', 'pilot_allowlist')),
  plan_slug TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, feature),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_billing_entitlements_feature_active
  ON billing_entitlements(feature, active, updated_at DESC);
