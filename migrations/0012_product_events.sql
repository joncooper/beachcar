CREATE TABLE IF NOT EXISTS product_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  properties_json TEXT NOT NULL DEFAULT '{}',
  client_created_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  app_build TEXT NOT NULL,
  tuning_version INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_events_user_received
  ON product_events(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_name_received
  ON product_events(event_name, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_received
  ON product_events(received_at);
