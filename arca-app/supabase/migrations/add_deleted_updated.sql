-- Run this once against an EXISTING Supabase project to enable soft-delete
-- tombstones and the updated_at watermark that incremental sync depends on.
-- Without this, deletes never propagate between team members (a hard DELETE
-- just vanishes from any "what changed since X" query) and pull is stuck
-- fetching only the latest 100 rows forever.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted    BOOLEAN     DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_updated ON documents;
CREATE TRIGGER trg_documents_updated BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_updated ON documents(updated_at DESC);
