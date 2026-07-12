-- Run this once against an EXISTING Supabase project (one created before the
-- per-agency JWT migration) to replace the old "anon full access" policy,
-- which let any holder of the shared anon key read/write every agency's
-- documents by changing the team_id filter in a raw request.
--
-- Requires arca-panel's /api/activate to already be signing JWTs with
-- { role: 'authenticated', team_id: <agency> } — see SUPABASE_JWT_SECRET in
-- arca-panel/.env.example. Existing agencies must re-activate (paste their
-- code again in onboarding) to receive a JWT instead of the old anon key;
-- until they do, their old anon key will simply stop being authorized here.

DROP POLICY IF EXISTS "anon full access" ON documents;

CREATE POLICY "team isolation" ON documents
  FOR ALL TO authenticated
  USING (team_id = (auth.jwt() ->> 'team_id'))
  WITH CHECK (team_id = (auth.jwt() ->> 'team_id'));
