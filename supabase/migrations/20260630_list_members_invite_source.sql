-- ============================================================
-- Allow 'creator_profile' as a valid list_members.invite_source
-- 2026-06-30
--
-- handleFollow() in CreatorProfileScreen.jsx inserts
-- invite_source: 'creator_profile' when a non-owner follows a
-- creator's list. The existing check constraint only allowed
-- 'link' (JoinListScreen / join-list edge fn) and 'direct'
-- (HomeScreen / useCrewInvite), so every Follow This List tap
-- failed with 23514 and silently reverted in the UI.
-- ============================================================

alter table list_members
  drop constraint if exists list_members_invite_source_check;

alter table list_members
  add constraint list_members_invite_source_check
  check (invite_source is null or invite_source in ('link', 'direct', 'creator_profile'));
