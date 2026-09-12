CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- Trigram Indexes for content and resolution lexical matching
CREATE INDEX IF NOT EXISTS idx_agenda_content_plain_trgm ON agenda USING gin (content_plain gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_agenda_resolution_plain_trgm ON agenda USING gin (resolution_plain gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_agenda_content_trgm ON agenda USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_agenda_resolution_trgm ON agenda USING gin (resolution gin_trgm_ops);
