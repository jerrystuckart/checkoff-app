-- CheckOff Release Candidate — Secret Item Protection (2026-09-03).
--
-- Secret/spoiler items (items.is_secret = true) must never gain a cover
-- candidate through the ordinary photo/rotation workflow — the whole
-- point of a secret item is that its reveal is earned in-app, and any
-- circulated photo (community, business, or admin-set) would spoil that.
--
-- This is enforced at the DATABASE level, not only by hiding buttons or
-- checking in application code — every write path (in-app Community
-- Cover submission, the getcheckoff.com business confirmation flow,
-- agent-service's coverCandidateModeration.ts, and the admin tool's
-- direct service-role REST calls) ultimately writes through this same
-- table, so a trigger here is the one place that catches all of them,
-- including any future caller that forgets to check. Application-layer
-- checks are added too (better error messages, avoids wasted upload
-- work), but this trigger is the real backstop.
--
-- Deliberately a hard block, not a configurable gate — "reject secret
-- items unless an explicit future secret-item override mechanism is
-- deliberately added. Do not add such an override now" (explicit
-- instruction). No override column, no bypass flag.
--
-- Data audit before this migration (2026-09-03): 5 live secret items,
-- zero existing item_cover_candidates rows for any of them, zero with
-- active_cover_candidate_id set, zero with display_eligible = true —
-- nothing to correct, this is purely forward-looking protection.
--
-- Review-ready, NOT applied automatically — same convention as every
-- other migration file in this directory. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260903_secret_item_cover_protection.sql --linked

BEGIN;

CREATE OR REPLACE FUNCTION reject_secret_item_cover_candidates()
RETURNS trigger AS $$
DECLARE
  target_is_secret boolean;
BEGIN
  SELECT is_secret INTO target_is_secret FROM items WHERE id = NEW.item_id;
  IF target_is_secret THEN
    RAISE EXCEPTION 'item_cover_candidates: refused — item % is a secret/spoiler item and cannot have a cover candidate', NEW.item_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Covers every future write: a brand-new candidate row (community,
-- business, or admin-inserted) AND any update to an existing row (status
-- change, display_eligible/is_primary/display_weight change) — a secret
-- item can never end up with a live candidate through any door.
DROP TRIGGER IF EXISTS item_cover_candidates_reject_secret_items ON item_cover_candidates;
CREATE TRIGGER item_cover_candidates_reject_secret_items
  BEFORE INSERT OR UPDATE ON item_cover_candidates
  FOR EACH ROW EXECUTE FUNCTION reject_secret_item_cover_candidates();

-- Belt-and-suspenders on the items side: even if some future code path
-- tried to point a secret item's active_cover_candidate_id at a candidate
-- directly (bypassing item_cover_candidates entirely), refuse that too.
CREATE OR REPLACE FUNCTION reject_secret_item_active_cover()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_secret AND NEW.active_cover_candidate_id IS NOT NULL THEN
    RAISE EXCEPTION 'items: refused — secret/spoiler item % cannot have an active_cover_candidate_id', NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Column-scoped (not every items UPDATE) — only fires when is_secret or
-- active_cover_candidate_id is actually part of the write, so this never
-- adds overhead or risk to the many unrelated columns items gets updated
-- through elsewhere in the app.
DROP TRIGGER IF EXISTS items_reject_secret_active_cover ON items;
CREATE TRIGGER items_reject_secret_active_cover
  BEFORE INSERT OR UPDATE OF is_secret, active_cover_candidate_id ON items
  FOR EACH ROW EXECUTE FUNCTION reject_secret_item_active_cover();

COMMIT;
