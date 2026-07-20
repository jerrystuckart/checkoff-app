-- ============================================================
-- destination_spotlights.event_starts_at / event_ends_at
-- 2026-07-15
--
-- Adds display-only event dates to a spotlight (e.g. "Fall Festival,
-- Oct 17-18"), distinct from visible_from/visible_until — those
-- govern when the spotlight itself appears in the app (its promo
-- window), not when the event it's advertising actually happens.
-- Confirmed live: the current Fall Festival spotlight has both
-- visible_from and visible_until as null, so there was never a field
-- storing the event's own date at all.
--
-- Both nullable date columns (no time component — this is a display
-- label, not a scheduling mechanism): a spotlight with no event isn't
-- required to set either. event_ends_at alone with no
-- event_starts_at doesn't render anything (handled client-side, not
-- enforced here) since a range needs a start.
-- ============================================================

ALTER TABLE destination_spotlights
ADD COLUMN event_starts_at date,
ADD COLUMN event_ends_at   date;
