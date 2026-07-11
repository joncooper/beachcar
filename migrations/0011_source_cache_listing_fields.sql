ALTER TABLE source_items ADD COLUMN bid_num INTEGER;
ALTER TABLE source_items ADD COLUMN location TEXT;
ALTER TABLE source_items ADD COLUMN location_city TEXT;
ALTER TABLE source_items ADD COLUMN location_region TEXT;
ALTER TABLE source_items ADD COLUMN location_country TEXT;
ALTER TABLE source_items ADD COLUMN ends_at TEXT;
ALTER TABLE source_items ADD COLUMN no_reserve INTEGER;
ALTER TABLE source_items ADD COLUMN last_detail_at TEXT;
ALTER TABLE source_items ADD COLUMN detail_status TEXT;
ALTER TABLE source_items ADD COLUMN detail_error TEXT;
ALTER TABLE source_items ADD COLUMN is_live INTEGER;
ALTER TABLE source_items ADD COLUMN dossier_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_source_items_source_live_ends ON source_items(source, is_live DESC, ends_at ASC);
CREATE INDEX IF NOT EXISTS idx_source_items_source_bid ON source_items(source, bid_num);
CREATE INDEX IF NOT EXISTS idx_source_items_source_location ON source_items(source, location_region, location_city);
