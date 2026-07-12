-- Fixes schema drift found while running scripts/test-rls-isolation.mjs:
-- the live `documents` table had an `uploaded_by` column that was NOT NULL
-- with no default, but that column did not exist anywhere in
-- arca-app/supabase/schema.sql or in any other tracked migration — it was
-- legacy drift, almost certainly left over from an older, pre-team_id
-- version of this schema (which had `uploaded_by text` as a nullable
-- column) that was later altered to NOT NULL directly in the Supabase
-- dashboard without ever being reflected back into the tracked schema.
--
-- arca-app has no concept of an individual uploader today — it's a
-- single-user Electron install per machine; the only identity it tracks is
-- team_id. Neither saveDocumentAsync nor triggerBackgroundSync's push
-- payload in lib/db.ts send `uploaded_by`, so every real insert against a
-- database with this constraint failed with:
--   null value in column "uploaded_by" of relation "documents"
--   violates not-null constraint
--
-- Already applied directly in production; kept here so any other existing
-- project (or anyone restoring from an older backup) can run the same fix.

ALTER TABLE documents ALTER COLUMN uploaded_by DROP NOT NULL;
ALTER TABLE documents ALTER COLUMN uploaded_by SET DEFAULT 'desktop';
