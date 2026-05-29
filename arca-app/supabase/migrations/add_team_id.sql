ALTER TABLE documents ADD COLUMN IF NOT EXISTS team_id text;
CREATE INDEX IF NOT EXISTS documents_team_id_idx ON documents (team_id);
