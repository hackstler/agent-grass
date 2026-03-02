-- Add missing indexes for documents table
-- 1. org_id alone: many queries filter by org without topic
-- 2. source: fast duplicate lookup for idempotent re-ingestion
CREATE INDEX IF NOT EXISTS documents_org_id_idx ON documents (org_id);
CREATE INDEX IF NOT EXISTS documents_source_idx ON documents (source);
