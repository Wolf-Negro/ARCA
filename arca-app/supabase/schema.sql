-- Run this once in your Supabase SQL editor to set up the ARCA documents table.

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  -- Legacy column from a pre-team_id version of this schema, kept nullable
  -- with a default rather than removed — arca-app itself never reads or
  -- writes it, it has no concept of an individual uploader (single-user
  -- install per machine, team_id is the only identity it tracks).
  uploaded_by TEXT DEFAULT 'desktop',
  client_name TEXT,
  doc_type    TEXT NOT NULL,
  description TEXT NOT NULL,
  tags        JSONB DEFAULT '[]',
  file_url    TEXT,
  file_name   TEXT NOT NULL,
  mime_type   TEXT,
  raw_content TEXT,
  mode        TEXT DEFAULT 'team',
  team_id     TEXT NOT NULL,
  -- INTEGER (0/1), not BOOLEAN, to mirror the local SQLite column exactly —
  -- lib/db.ts's rowToDocFromSupabase does `row.pinned ?? 0`, which only
  -- falls back to 0 when the value is null/undefined; a Postgres `false`
  -- would pass through as-is and silently mix booleans with numbers in the
  -- same in-memory Document[] array.
  pinned      INTEGER     DEFAULT 0,
  deleted     BOOLEAN     DEFAULT false,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team    ON documents(team_id);
CREATE INDEX IF NOT EXISTS idx_client  ON documents(client_name);
CREATE INDEX IF NOT EXISTS idx_created ON documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_updated ON documents(updated_at DESC);

-- Soft-delete tombstones: deletes propagate as `deleted = true` rows instead
-- of a real DELETE, so other team members' incremental pull (which only asks
-- for rows changed since its last watermark) finds out about them. A hard
-- DELETE would just vanish from that query, so on other devices it would
-- never be told to remove its local copy.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_updated ON documents;
CREATE TRIGGER trg_documents_updated BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Optional: full-text search index
CREATE INDEX IF NOT EXISTS idx_description ON documents USING gin(to_tsvector('spanish', description));

-- Row Level Security: each team_id only sees its own rows.
-- arca-panel signs a JWT per agency (role: authenticated, team_id: <agency>)
-- in /api/activate — RLS checks that claim directly, so one agency's key can
-- never read or write another agency's rows, even via a raw curl to
-- PostgREST with an arbitrary team_id filter.
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon full access" ON documents;

CREATE POLICY "team isolation" ON documents
  FOR ALL TO authenticated
  USING (team_id = (auth.jwt() ->> 'team_id'))
  WITH CHECK (team_id = (auth.jwt() ->> 'team_id'));
