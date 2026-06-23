CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  report_markdown TEXT,
  source_summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listings (
  listing_key TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  lane TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_payload_json TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_url ON listings(url);
CREATE INDEX IF NOT EXISTS idx_listings_last_seen ON listings(last_seen_at);

CREATE TABLE IF NOT EXISTS run_listings (
  run_id TEXT NOT NULL,
  listing_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (run_id, listing_key),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (listing_key) REFERENCES listings(listing_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_listings_run_order ON run_listings(run_id, sort_order);

CREATE TABLE IF NOT EXISTS feedback (
  listing_key TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('like', 'star', 'hide', 'avoid')),
  tags_json TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (listing_key) REFERENCES listings(listing_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS images (
  image_key TEXT PRIMARY KEY,
  listing_key TEXT NOT NULL,
  source_url TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  byte_length INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending', 'copied', 'failed')),
  error TEXT,
  copied_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (listing_key) REFERENCES listings(listing_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_images_source_url ON images(source_url);
CREATE INDEX IF NOT EXISTS idx_images_listing ON images(listing_key);
