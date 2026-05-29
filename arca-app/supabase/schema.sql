-- Run this once in your Supabase SQL editor to set up the ARCA documents table.

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  client_name TEXT,
  doc_type    TEXT NOT NULL,
  description TEXT NOT NULL,
  tags        JSONB DEFAULT '[]',
  file_url    TEXT,
  file_name   TEXT NOT NULL,
  mime_type   TEXT,
  raw_content TEXT,
  mode        TEXT DEFAULT 'team',
  team_id     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_team    ON documents(team_id);
CREATE INDEX IF NOT EXISTS idx_client  ON documents(client_name);
CREATE INDEX IF NOT EXISTS idx_created ON documents(created_at DESC);

-- Optional: full-text search index
CREATE INDEX IF NOT EXISTS idx_description ON documents USING gin(to_tsvector('spanish', description));

-- Row Level Security: each team_id only sees its own rows.
-- Note: RLS with anon key requires enabling it here AND creating a policy.
-- For simplicity with the anon key (no JWT claims), we rely on app-level
-- team_id filtering in all queries. RLS below adds an extra safety layer
-- if you upgrade to a service-role or JWT-based flow later.
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Allow anon key full access (app enforces team_id filtering in queries)
CREATE POLICY "anon full access" ON documents
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
