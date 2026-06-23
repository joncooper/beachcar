CREATE TABLE IF NOT EXISTS feedback_next (
  listing_key TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('like', 'star', 'hide', 'avoid')),
  tags_json TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (listing_key) REFERENCES listings(listing_key) ON DELETE CASCADE
);

INSERT OR REPLACE INTO feedback_next (listing_key, action, tags_json, note, updated_at)
SELECT listing_key, action, tags_json, note, updated_at FROM feedback;

DROP TABLE feedback;

ALTER TABLE feedback_next RENAME TO feedback;
