CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL DEFAULT '[]',
  scope TEXT NOT NULL DEFAULT '',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  client_id_issued_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  resource TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_hash_active ON oauth_authorization_codes(code_hash, consumed_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_user_created ON oauth_authorization_codes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  resource TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  last_used_at TEXT,
  revoked_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_hash_active ON oauth_access_tokens(token_hash, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user_created ON oauth_access_tokens(user_id, created_at DESC);
