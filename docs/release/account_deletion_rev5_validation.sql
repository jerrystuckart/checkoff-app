-- READ ONLY validation of migration 20261008e (rev 5) against the live catalog. Changes nothing. PREPARE plans without executing; the SELECTs run on literals.
-- Run: supabase db query -f docs/release/account_deletion_rev5_validation.sql --linked --agent=no -o json

-- statements the new delete_data code runs, on real tables
prepare r5a(uuid) as select display_name from public.users where id = $1;
prepare r5b(uuid) as select coalesce(array_agg(distinct list_item_id::text), '{}') from public.check_ins where user_id = $1 and list_item_id is not null;
prepare r5c(uuid) as select coalesce(array_agg(id::text), '{}') from public.dares where from_user_id = $1 or to_user_id = $1;
prepare r5d(uuid) as select coalesce(array_agg(list_id::text), '{}') from public.list_members where user_id = $1;
prepare r5e(uuid, text, text[], text[], text[]) as
delete from public.notification_queue q
 where q.payload->>'to_user_id' = $1::text
    or (coalesce($2, '') <> '' and (
          (q.payload->>'from_user' = $2 and (q.payload->>'list_item_id' = any ($3) or q.payload->>'dare_id' = any ($4)))
       or (q.type = 'leaderboard_nudge' and left(q.payload->>'message', length($2) + 1) = $2 || ' ' and q.payload->>'list_id' = any ($5))));
-- the credential guard regex: a JWT passes, the new style key and junk fail
select ('eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln' ~ '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') as jwt_accepted,
       ('sb_secret_abcdefghijklmnopqrstuvwxyz0123456789' !~ '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') as new_style_key_rejected,
       (''  !~ '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') as empty_rejected;
-- EXECUTE the exact WHERE predicate over literal sample rows. user U (name 'N', list item L1, dare D1, list LST). Expected: t,t,t,t then f,f,f,f,f
with q(label, type, payload) as (values
  ('to the user (badge)',                    'badge',            '{"to_user_id":"U","badge_id":"b"}'::jsonb),
  ('about the user (check in, same item)',   'check_in',         '{"from_user":"N","list_item_id":"L1","to_user_id":"OTHER"}'::jsonb),
  ('about the user (dare)',                  'dare',             '{"from_user":"N","dare_id":"D1","to_user_id":"OTHER"}'::jsonb),
  ('about the user (leaderboard nudge)',     'leaderboard_nudge','{"message":"N just pulled 1 ahead","list_id":"LST","to_user_id":"OTHER"}'::jsonb),
  ('SAME NAME, someone else''s list item',   'check_in',         '{"from_user":"N","list_item_id":"L9","to_user_id":"OTHER"}'::jsonb),
  ('same name nudge but a list U is not in', 'leaderboard_nudge','{"message":"N just pulled 1 ahead","list_id":"ZZZ","to_user_id":"OTHER"}'::jsonb),
  ('another person with a longer name',      'leaderboard_nudge','{"message":"NN just pulled 1 ahead","list_id":"LST","to_user_id":"OTHER"}'::jsonb),
  ('unrelated notification to someone else', 'badge',            '{"to_user_id":"OTHER","badge_id":"b"}'::jsonb),
  ('admin broadcast (no user fields)',       'admin_broadcast',  '{"title":"t","body":"b"}'::jsonb))
select label, (q.payload->>'to_user_id' = 'U'
    or (coalesce('N', '') <> '' and (
          (q.payload->>'from_user' = 'N' and (q.payload->>'list_item_id' = any (array['L1']) or q.payload->>'dare_id' = any (array['D1'])))
       or (q.type = 'leaderboard_nudge' and left(q.payload->>'message', length('N') + 1) = 'N' || ' ' and q.payload->>'list_id' = any (array['LST']))))) is true as would_delete
from q;
