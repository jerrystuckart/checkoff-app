-- Business Confirmation + Free Photo + Cling web flow. Review-ready, NOT
-- applied automatically — same convention as every other migration in this
-- directory. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260902_business_confirmation_flow.sql --linked
--
-- Backs the public, no-login getcheckoff.com/confirm/<token> page (built in
-- the sibling getcheckoff-site repo, not this one). Reuses the Community
-- Cover Photos V1 pipeline (item_cover_candidates + the private
-- submission-photos bucket) for the photo half — does NOT duplicate it.
--
-- SCOPE NOTE: this migration only touches THIS project's schema. The
-- getcheckoff-site Vercel functions that read/write these tables use the
-- SAME Supabase project (same SUPABASE_URL) via a service-role key held
-- server-side there — nothing here grants that site any new capability by
-- itself; this migration just creates the tables/columns/view it needs.

BEGIN;

-- ---------------------------------------------------------------------------
-- item_cover_candidates: make it accept a business-originated submission
-- alongside the existing community (in-app, logged-in user) path, without
-- changing anything about how community submissions already work.
-- ---------------------------------------------------------------------------

-- A business submitter has no CheckOff account (no login, per product
-- requirement) -- there is no auth.uid() to satisfy the existing NOT NULL
-- FK. Nullable is additive and changes nothing for existing/community rows,
-- which always set this already.
ALTER TABLE item_cover_candidates ALTER COLUMN submitted_by_user_id DROP NOT NULL;

ALTER TABLE item_cover_candidates ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'community'
  CHECK (source IN ('community', 'business_submission'));

-- ---------------------------------------------------------------------------
-- Outreach tokens. One row per (item, outreach recipient) -- the token
-- string itself IS the access control (unguessable, single-purpose), same
-- model already used elsewhere on getcheckoff.com (campaign-link's HMAC
-- tokens, list invite_codes). business_name / exact_checkoff_item are
-- SNAPSHOTTED at generation time, not live-joined to items/partners at
-- request time -- the public page never needs (and RLS never grants) any
-- broader read access to production business/item tables, and a later
-- item edit can't retroactively change what a since-sent link displays.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS business_outreach_tokens (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token                  text NOT NULL UNIQUE,
  item_id                uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  business_name          text NOT NULL,
  exact_checkoff_item    text NOT NULL,
  campaign               text NOT NULL DEFAULT 'business_photo_outreach_2026_09',
  status                 text NOT NULL DEFAULT 'unopened' CHECK (status IN ('unopened', 'opened', 'submitted')),
  opened_at              timestamptz,
  submitted_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_outreach_tokens_item_idx ON business_outreach_tokens (item_id);

ALTER TABLE item_cover_candidates ADD COLUMN IF NOT EXISTS submitted_by_token_id uuid
  REFERENCES business_outreach_tokens(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Business confirmation submissions. One row per token (a token may be
-- reopened freely -- reopening after submission just re-shows this same
-- row read-only; it never creates a second, conflicting submission).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS business_confirmation_submissions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id                uuid NOT NULL UNIQUE REFERENCES business_outreach_tokens(id) ON DELETE CASCADE,
  item_id                 uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  -- true = "Looks right", false = "Suggest a change" (see proposed_correction),
  -- null = the confirm/correct section was skipped entirely (every section is optional)
  item_confirmed          boolean,
  proposed_correction     text,
  correction_status       text NOT NULL DEFAULT 'not_applicable'
                            CHECK (correction_status IN ('not_applicable', 'pending_review', 'applied', 'declined')),
  photo_candidate_id      uuid REFERENCES item_cover_candidates(id) ON DELETE SET NULL,
  rights_ack              boolean NOT NULL DEFAULT false,
  -- null = cling section skipped, true/false = explicit Yes/Not right now
  cling_requested         boolean,
  cling_mailing_name      text,
  cling_mailing_address   text,
  submitted_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- RLS. Nothing in this migration is readable/writable by the anon or
-- authenticated roles except the one narrow public view below --
-- everything else is service-role-only (the getcheckoff-site Vercel
-- function holds that key server-side; the browser never sees it).
-- ---------------------------------------------------------------------------

ALTER TABLE business_outreach_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_confirmation_submissions ENABLE ROW LEVEL SECURITY;
-- Deliberately zero policies on either table -- RLS default-denies both to
-- anon and authenticated. The public getcheckoff.com/confirm/<token> page
-- never talks to Supabase directly (no anon key involved in this flow at
-- all, unlike some other pages on that site) -- both reading the token's
-- display data and writing a submission go through ONE server-side Vercel
-- function (getcheckoff-site's api/business-confirmation.js) holding the
-- service role key, which bypasses RLS. One code path, one place to audit,
-- no separate public view/grant needed.

COMMIT;
