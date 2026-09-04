-- Community Cover Photos V1 — Cover Candidates. Review-ready, NOT applied
-- automatically — same convention as every other migration file in this
-- directory (see 20260828_visit_detection_phase1.sql's header). Run
-- manually once reviewed:
--   supabase db query -f supabase/migrations/20260902_item_cover_candidates.sql --linked
--
-- STORAGE AUDIT FINDING (informs everything below): the 'submission-photos'
-- Storage bucket already exists, is PRIVATE (public=false), and already has
-- exactly the RLS shape this feature needs — "anyone can upload submission
-- photos" (INSERT, no public read) + "admins can view submission photos"
-- (SELECT restricted to users.is_admin=true). No new bucket is created by
-- this migration; Cover Candidate photos upload into
-- submission-photos/cover-candidates/<user_id>/<timestamp>.<ext>. The
-- existing bucket-level INSERT policy is NOT modified here -- see the note
-- near the bottom of this file for why, and a recommended follow-up.
--
-- 'checkin-photos' (public) and 'checkoff-images' (public) are NOT reused
-- here on purpose — a Cover Candidate must never be public until an admin
-- explicitly selects it, and neither of those buckets' RLS supports that.

BEGIN;

-- ---------------------------------------------------------------------------
-- Cover Candidates. Storage PATH only, never a public URL (see
-- lib/coverCandidates.js's resolveActiveCoverUrl — a signed URL is minted
-- on demand, only for an item's currently-selected candidate, only by
-- authenticated reads that already have access).
--
-- Lifecycle exactly as specified (preserves the 3-way distinction: safe
-- enough to store / publishable / good enough to be a cover):
--   pending             -- just submitted, not yet assessed at all
--   automated_rejected  -- failed automated safety/quality checks
--   needs_review        -- passed automated checks (or none exist yet, see
--                          lib/coverModeration/ adapter doc) -- awaiting a
--                          human decision. V1 has NO real automated safety
--                          moderation integrated (see final report) so
--                          EVERY submission that isn't trivially malformed
--                          lands here, never auto-approved.
--   approved            -- a human confirmed it's safe/publishable
--   cover_eligible       -- additionally confirmed cover-quality (sharp,
--                          well-lit, relevant, no watermark/text overlay)
--   selected             -- the item's current active_cover_candidate_id
--   rejected             -- terminal reject at any stage (safety, quality,
--                          or just "not usable")
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS item_cover_candidates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  submitted_by_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_path           text NOT NULL,
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'automated_rejected', 'needs_review', 'approved', 'cover_eligible', 'selected', 'rejected')),
  -- Automated signals only (e.g. {"passesBasicSanity": true}) -- never raw
  -- vendor payloads or anything sensitive; see final report on why V1 has
  -- no real content-safety vendor integrated yet.
  moderation_metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  rejection_reason       text,
  reviewed_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at            timestamptz,
  selected_as_cover_at   timestamptz,
  -- Explicit "Great shot. Share it with CheckOff?" opt-in confirmation --
  -- required true at insert time (enforced by the app, not a DB
  -- constraint, so a future consent-copy revision doesn't need a migration).
  consent_ack            boolean NOT NULL DEFAULT false,
  submitted_at           timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS item_cover_candidates_item_status_idx
  ON item_cover_candidates (item_id, status);
CREATE INDEX IF NOT EXISTS item_cover_candidates_submitter_idx
  ON item_cover_candidates (submitted_by_user_id, item_id, status);

-- Item-level "which candidate is the active cover" pointer -- the smallest
-- scalable option (see final report's data-model audit): rather than a new
-- item_images table, this single nullable FK plus the candidates table
-- above is enough to cover all current/near-term image sources when
-- combined with lib/whatsGoodImageSource.js's existing priority-list
-- resolver (item_image_url / venue_image_url / partners.photo_url already
-- audited in the prior Home 2026 pass). Revisit only if the app ever needs
-- MULTIPLE concurrent approved images per item (e.g. a gallery), which V1
-- does not.
ALTER TABLE items ADD COLUMN IF NOT EXISTS active_cover_candidate_id uuid
  REFERENCES item_cover_candidates(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Feature flag -- separate from whats_good_v1 on purpose (different
-- rollout, different risk profile: this one touches user-generated
-- content). Tester-gated via the same TESTER_GATED_FLAGS convention as
-- candidate_visit_*/realtime_nearby_checkoff_notifications/
-- at_place_checkoff_reminders (see lib/featureFlags.js).
-- ---------------------------------------------------------------------------

INSERT INTO feature_flags (key, description, enabled_globally) VALUES
  ('community_cover_photos', 'V1 Community Cover Candidates: at-place users may submit a photo for moderation review to become an item cover. Submission-only -- never auto-public, never auto-selected.', false)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE item_cover_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_cover_candidates_select_own_or_admin ON item_cover_candidates;
CREATE POLICY item_cover_candidates_select_own_or_admin ON item_cover_candidates
  FOR SELECT USING (
    submitted_by_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)
  );

DROP POLICY IF EXISTS item_cover_candidates_insert_own ON item_cover_candidates;
CREATE POLICY item_cover_candidates_insert_own ON item_cover_candidates
  FOR INSERT WITH CHECK (submitted_by_user_id = auth.uid() AND consent_ack = true);

-- Ordinary users can NEVER update their own row (no self-approve/select) --
-- only admins may transition status, set reviewed_by/reviewed_at,
-- rejection_reason, or selected_as_cover_at.
DROP POLICY IF EXISTS item_cover_candidates_update_admin_only ON item_cover_candidates;
CREATE POLICY item_cover_candidates_update_admin_only ON item_cover_candidates
  FOR UPDATE USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true));

DROP POLICY IF EXISTS item_cover_candidates_delete_admin_only ON item_cover_candidates;
CREATE POLICY item_cover_candidates_delete_admin_only ON item_cover_candidates
  FOR DELETE USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true));

-- NOT changed by this migration, flagged instead: the existing
-- "anyone can upload submission photos" policy on storage.objects has no
-- per-user folder scoping (unlike checkin-photos' equivalent policy). This
-- migration deliberately does NOT touch it -- this bucket may already be
-- used by something else not discovered in this audit (no code reference
-- was found, but that isn't proof), and Postgres RLS combines multiple
-- permissive policies with OR, so simply adding a stricter INSERT policy
-- here would not actually restrict anything without also removing the
-- existing broad one. Recommend tightening it to
-- (storage.foldername(name))[1] = auth.uid()::text (matching
-- checkin-photos) as a follow-up, once confirmed nothing else relies on
-- its current unscoped shape -- see final report.

COMMIT;
