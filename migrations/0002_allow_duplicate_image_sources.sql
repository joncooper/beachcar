DROP INDEX IF EXISTS idx_images_source_url;
CREATE INDEX IF NOT EXISTS idx_images_source_url ON images(source_url);
