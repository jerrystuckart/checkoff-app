-- ============================================================
-- Creator Program interest form storage
-- 2026-07-25
--
-- Backs the public marketing interest form at getcheckoff.com/creators
-- (getcheckoff-site repo, public/creators/*). Anonymous visitors submit
-- via the Supabase anon key directly from the browser (same pattern as
-- item_submissions and join_android_waitlist), so INSERT must be open
-- to anon but SELECT must NOT be — this is a public lead-capture form,
-- not a readable table.
-- ============================================================

CREATE TABLE IF NOT EXISTS creator_program_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  creator_handle    text NOT NULL,
  primary_platform  text,
  email             text NOT NULL,
  metro             text,
  message           text,
  source            text,
  status            text DEFAULT 'new',
  created_at        timestamptz DEFAULT now()
);

-- Basic duplicate protection on normalized email + handle
CREATE UNIQUE INDEX IF NOT EXISTS creator_program_leads_email_handle_unique
  ON creator_program_leads (lower(email), lower(creator_handle));

ALTER TABLE creator_program_leads ENABLE ROW LEVEL SECURITY;

-- Anonymous (and authenticated) visitors may submit the form
CREATE POLICY "creator_program_leads_anon_insert"
  ON creator_program_leads
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- No one on anon/authenticated may read submitted leads back
CREATE POLICY "creator_program_leads_no_select"
  ON creator_program_leads
  FOR SELECT
  TO anon, authenticated
  USING (false);
