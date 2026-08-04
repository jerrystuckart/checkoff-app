-- ============================================================
-- Add creators.contact_email
-- 2026-07-25
--
-- Admin's "Add List" flow requires creators.user_id (a real
-- auth.users row, the app's actual list-ownership field — distinct
-- from checkoff_creator_id) before a list can be created for a
-- creator. Until now there was no place to store a creator's email
-- to act on that, so the admin had no way to link an account short of
-- manually finding/pasting a UUID. This mirrors partners.contact_email
-- and feeds the new admin-creator-link edge function, which creates
-- the auth.users row via email if one doesn't exist yet and writes
-- the resulting id back to creators.user_id.
-- ============================================================

alter table creators
  add column if not exists contact_email text;
