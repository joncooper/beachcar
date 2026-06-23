CREATE TABLE IF NOT EXISTS preference_events (
  id TEXT PRIMARY KEY,
  listing_key TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('voice_note', 'text_note', 'viewed')),
  note TEXT,
  transcript TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (listing_key) REFERENCES listings(listing_key) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_preference_events_created ON preference_events(created_at);
CREATE INDEX IF NOT EXISTS idx_preference_events_listing ON preference_events(listing_key);
