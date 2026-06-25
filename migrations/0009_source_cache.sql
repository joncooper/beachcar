CREATE TABLE IF NOT EXISTS source_items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  site TEXT NOT NULL,
  source_url TEXT NOT NULL,
  item_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  image_urls_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  published_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_source_items_source_last_seen ON source_items(source, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_items_source_published ON source_items(source, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_items_title ON source_items(title);

CREATE TABLE IF NOT EXISTS source_ingestion_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  item_count INTEGER NOT NULL DEFAULT 0,
  new_item_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_ingestion_runs_source_finished ON source_ingestion_runs(source, finished_at DESC);
