-- ============================================================
-- Add 'checkoff' to list_members.invite_source check
-- 2026-07-21
--
-- fanOutCheckIn() in lib/checkInFanOut.js inserts
-- invite_source: 'checkoff' when a user checks off an item
-- belonging to an official/seasonal list they aren't a member
-- of yet — the check-off itself is the join signal, no prompt.
-- Distinct from 'direct' (a deliberate tap-to-join decision) and
-- from NULL (uninterpretable for activation measurement).
-- ============================================================

ALTER TABLE list_members
  DROP CONSTRAINT IF EXISTS list_members_invite_source_check;

ALTER TABLE list_members
  ADD CONSTRAINT list_members_invite_source_check
  CHECK (invite_source IS NULL OR invite_source IN (
    'link', 'direct', 'creator_profile', 'destination_zone', 'checkoff'
  ));
