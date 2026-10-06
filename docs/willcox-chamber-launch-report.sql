-- =============================================================================
-- WILLCOX DESTINATION HUB LAUNCH RESULTS  (Chamber report dataset, read-only)
-- One query, one result set: columns section | label | value. Paste into the Supabase SQL editor,
-- edit the dates in `p`, export as CSV, and build the report from it.
--
-- Chamber-safe: contains NO emails, names, user ids or secret item text.
-- Limits (see docs/willcox-launch-analytics.sql header): landing views are page views, not unique
-- visitors; installs cannot be attributed to a campaign; "registrations" are new accounts created in
-- the window, shown with how many of them checked off a Willcox item.
-- =============================================================================
with p as (
  select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid dest,
         'e35e8947-92ad-44ad-80f6-633a65d94dc1'::uuid nbhd,
         '2026-10-16'::date d0,             -- first day of the reporting window (Phoenix time)
         '2026-10-26'::date d1              -- exclusive end date
),
wx as (select id from items where neighborhood_id = (select nbhd from p)
       union select li.item_id from list_items li join destination_lists dl on dl.list_id = li.list_id
              where dl.destination_id = (select dest from p) and dl.is_active),
le as (select e.* from landing_events e, p
       where e.destination_id = p.dest
         and (e.occurred_at at time zone 'America/Phoenix')::date >= p.d0
         and (e.occurred_at at time zone 'America/Phoenix')::date <  p.d1),
c as (select ci.user_id, ci.item_id from check_ins ci join wx on wx.id = ci.item_id, p
      where ci.user_id not in (select id from users where is_admin)
        and (ci.checked_at at time zone 'America/Phoenix')::date >= p.d0
        and (ci.checked_at at time zone 'America/Phoenix')::date <  p.d1),
per_user as (select user_id, count(*) n from c group by 1),
nu as (select u.id from users u, p
       where not coalesce(u.is_admin,false) and not coalesce(u.is_deleted,false)
         and (u.created_at at time zone 'America/Phoenix')::date >= p.d0
         and (u.created_at at time zone 'America/Phoenix')::date <  p.d1),
subs as (select * from destination_item_submissions s, p where s.destination_id = p.dest
         and (s.submitted_at at time zone 'America/Phoenix')::date >= p.d0
         and (s.submitted_at at time zone 'America/Phoenix')::date <  p.d1)
select * from (
  select 1 ord, 'Hub visits' section, 'Willcox landing page views' label, count(*)::text value from le where event_type = 'landing_view'
  union all select 2, 'Hub visits', 'Tapped Open in app', count(*)::text from le where event_type = 'app_open_attempt'
  union all select 3, 'Hub visits', 'App Store or Google Play clicks', count(*)::text from le where event_type in ('appstore_click','playstore_click')
  union all select 10, 'Acquisition source', coalesce(utm_source,'(none)') || ' / ' || coalesce(utm_medium,'(none)'), count(*)::text
            from le where event_type = 'landing_view' group by utm_source, utm_medium
  union all select 20, 'Registrations', 'New CheckOff accounts created in the window', count(*)::text from nu
  union all select 21, 'Registrations', '...of those who checked off a Willcox experience', count(*)::text from nu where id in (select user_id from c)
  union all select 30, 'Engagement', 'Unique CheckOff users in Willcox', count(*)::text from per_user
  union all select 31, 'Engagement', 'Total Willcox checkoffs', count(*)::text from c
  union all select 32, 'Engagement', 'Places/experiences receiving checkoffs', count(distinct item_id)::text from c
  union all select 33, 'Engagement', 'Users with 2 or more Willcox checkoffs', count(*)::text from per_user where n >= 2
  union all select 34, 'Engagement', 'Users with 3 or more Willcox checkoffs', count(*)::text from per_user where n >= 3
  union all (select 40 + row_number() over (order by count(*) desc, i.body), 'Top 10 experiences',
            case when i.is_secret then '(hidden experience)' else i.body end, count(*)::text || ' checkoffs'
            from c join items i on i.id = c.item_id group by i.id, i.body, i.is_secret order by count(*) desc, i.body limit 10)
  union all select 60, 'Business participation', 'Businesses that verified their CheckOff', count(distinct item_id)::text from subs where submission_type = 'verification'
  union all select 61, 'Business participation', 'Change requests received', count(*)::text from subs where submission_type = 'change_request'
  union all select 62, 'Business participation', 'Business page views', count(*)::text from le where event_type = 'partners_view'
  union all select 63, 'Business participation', 'Promo material clicks', count(*)::text from le where event_type = 'promo_click'
) r order by ord, label;
