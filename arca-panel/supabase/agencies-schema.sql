-- Run this once in your Supabase SQL editor.
-- This table stores all registered agencies for ARCA Desktop activation.

CREATE TABLE IF NOT EXISTS agencies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  team_id    TEXT NOT NULL UNIQUE,
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_code    ON agencies(code);
CREATE INDEX IF NOT EXISTS idx_team_id ON agencies(team_id);
