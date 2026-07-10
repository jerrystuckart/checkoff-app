-- ============================================================
-- Add 'destination_zone' to list_members.invite_source check
-- 2026-07-10
--
-- handleDestinationZoneTap() in HomeScreen.jsx inserts
-- invite_source: 'destination_zone' when a user taps the
-- destination zone banner and gets auto-joined to the list.
-- ============================================================

ALTER TABLE list_members
  DROP CONSTRAINT IF EXISTS list_members_invite_source_check;

ALTER TABLE list_members
  ADD CONSTRAINT list_members_invite_source_check
  CHECK (invite_source IS NULL OR invite_source IN (
    'link', 'direct', 'creator_profile', 'destination_zone'
  ));
