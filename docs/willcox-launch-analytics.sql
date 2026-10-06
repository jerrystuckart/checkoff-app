-- =============================================================================
-- WILLCOX LAUNCH ANALYTICS  (read-only SELECTs; run in the Supabase SQL editor)
-- Wine Festival: Sat Oct 17 and Sun Oct 18, 2026. All dates are America/Phoenix.
--
-- Each query is independent and starts with a `p` CTE of parameters. Edit the dates there.
-- Run one query at a time (the editor shows only the last result set).
--
-- WHAT THE DATA CAN AND CANNOT TELL YOU (checked against the live schema, 2026-10-05):
--  * landing_events has NO visitor id, so "unique visitors" cannot be computed. Page views are
--    the honest number. (Phase 2: add an anonymous visitor id.)
--  * Nothing links a landing visit to an app user. There is no deferred deep link, so an install
--    cannot be attributed to a utm_source. "New users" below are users whose account was created
--    in the window, split by whether they checked off a Willcox item. That is correlation.
--  * "Willcox items" = items in the Willcox neighborhood OR on the destination's active lists.
--  * Admin accounts (users.is_admin) are excluded from user counts so testing does not inflate them.
--  * Private data: B2 shows business contact emails. Do not paste it into a Chamber report.
-- =============================================================================


-- ===================== TRAFFIC (landing_events from /willcox) =====================

-- T1. Total /willcox landing views, by day (Phoenix time).
with p as (select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid dest, '2026-10-01'::date d0, '2026-10-26'::date d1)
select (e.occurred_at at time zone 'America/Phoenix')::date as day,
       count(*) filter (where event_type = 'landing_view') as landing_views,
       count(*) filter (where event_type = 'app_open_attempt') as app_open_attempts,
       count(*) filter (where event_type = 'app_open_success') as app_open_successes,
       count(*) filter (where event_type = 'appstore_click') as appstore_clicks,
       count(*) filter (where event_type = 'playstore_click') as playstore_clicks
from landing_events e, p
where e.destination_id = p.dest
  and (e.occurred_at at time zone 'America/Phoenix')::date >= p.d0 and (e.occurred_at at time zone 'America/Phoenix')::date < p.d1
  and event_type in ('landing_view','app_open_attempt','app_open_success','appstore_click','playstore_click')
group by 1 order by 1;

-- T2. Traffic by utm_source, utm_medium, utm_campaign, utm_content (landing views plus handoff/store actions).
-- Change the group-by columns to slice one dimension at a time. NULL = no UTM on the URL.
with p as (select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid dest, '2026-10-01'::timestamptz t0)
select coalesce(utm_source,'(none)') utm_source, coalesce(utm_medium,'(none)') utm_medium,
       coalesce(utm_campaign,'(none)') utm_campaign, coalesce(utm_content,'(none)') utm_content,
       count(*) filter (where event_type='landing_view') landing_views,
       count(*) filter (where event_type='app_open_attempt') app_open_attempts,
       count(*) filter (where event_type='app_open_success') app_open_successes,
       count(*) filter (where event_type in ('appstore_click','playstore_click')) store_clicks
from landing_events e, p
where e.destination_id = p.dest and e.occurred_at >= p.t0
  and event_type in ('landing_view','app_open_attempt','app_open_success','appstore_click','playstore_click')
group by 1,2,3,4 order by landing_views desc;

-- T3. Platform split of landing views (ios / android / desktop).
with p as (select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid dest, '2026-10-01'::timestamptz t0)
select platform, count(*) landing_views
from landing_events e, p
where e.destination_id = p.dest and e.occurred_at >= p.t0 and event_type = 'landing_view'
group by 1 order by 2 desc;


-- ===================== BUSINESS-OWNER ACTIVATION (/willcox/partners) =====================

-- B1. Partner-page funnel, overall and by utm_source (the handout QR uses utm_source=business_owner_handout).
-- Event names: partners_view, business_lookup, business_selected, verification_submitted,
-- change_request_submitted, promo_click, upgrade_email_click.
with p as (select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid dest, '2026-10-05'::timestamptz t0)
select coalesce(utm_source,'(none)') utm_source,
       count(*) filter (where event_type='partners_view') page_views,
       count(*) filter (where event_type='business_lookup') lookups,
       count(*) filter (where event_type='business_selected') businesses_selected,
       count(*) filter (where event_type='verification_submitted') verification_events,
       count(*) filter (where event_type='change_request_submitted') change_request_events,
       count(*) filter (where event_type='promo_click') promo_clicks,
       count(*) filter (where event_type='upgrade_email_click') upgrade_email_clicks
from landing_events e, p
where e.destination_id = p.dest and e.occurred_at >= p.t0
  and event_type in ('partners_view','business_lookup','business_selected','verification_submitted','change_request_submitted','promo_click','upgrade_email_click')
group by rollup(1) order by 1 nulls last;

-- B2. Source of truth for submissions: one row per verification / change request (PRIVATE: has contact emails).
select s.submitted_at at time zone 'America/Phoenix' as submitted_phx, s.submission_type, s.status,
       s.business_name, s.contact_name, s.contact_email, s.utm_source, s.utm_content,
       s.suggested_wording, s.issue_description, s.website_correction, s.address_correction, s.notes
from destination_item_submissions s
where s.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'
order by s.submitted_at desc;

-- B3. Counts by type and review status, plus distinct businesses (items) verified.
select submission_type, status, count(*) submissions, count(distinct item_id) distinct_items
from destination_item_submissions
where destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'
group by rollup(submission_type, status) order by 1 nulls last, 2 nulls last;

-- B4. Willcox items with no verification yet (outreach worklist). Secret items are flagged, never show their body.
select case when i.is_secret then '(secret item)' else left(i.body, 80) end as item,
       i.is_secret, i.is_active
from items i
where i.neighborhood_id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1' and i.is_active
  and not exists (select 1 from destination_item_submissions s
                  where s.item_id = i.id and s.submission_type = 'verification')
order by 1;


-- ===================== DESTINATION ENGAGEMENT (check_ins, users, interaction_events) =====================
-- check_ins is the checkoff table (check_ins.item_id, user_id, checked_at).

-- E1. Headline: total Willcox checkoffs, unique users, users with 2+ and 3+, in the launch window.
with p as (select '2026-10-16'::date d0, '2026-10-26'::date d1),
wx as (select id from items where neighborhood_id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1'
       union select li.item_id from list_items li join destination_lists dl on dl.list_id = li.list_id
              where dl.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639' and dl.is_active),
c as (select ci.user_id, ci.item_id from check_ins ci join wx on wx.id = ci.item_id join users u on u.id = ci.user_id, p
      where not coalesce(u.is_admin,false)
        and (ci.checked_at at time zone 'America/Phoenix')::date >= p.d0 and (ci.checked_at at time zone 'America/Phoenix')::date < p.d1),
per_user as (select user_id, count(*) n from c group by 1)
select (select count(*) from c) total_checkoffs,
       (select count(*) from per_user) unique_users,
       (select count(*) from per_user where n >= 2) users_2plus,
       (select count(*) from per_user where n >= 3) users_3plus,
       (select count(distinct item_id) from c) distinct_experiences_checked;

-- E2. Checkoffs by item (all Willcox items, including zero-checkoff items), in the window.
with p as (select '2026-10-16'::date d0, '2026-10-26'::date d1),
wx as (select id from items where neighborhood_id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1'
       union select li.item_id from list_items li join destination_lists dl on dl.list_id = li.list_id
              where dl.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639' and dl.is_active)
select case when i.is_secret then '(secret item)' else left(i.body, 90) end as item, i.is_active,
       count(ci.id) checkoffs, count(distinct ci.user_id) users
from wx join items i on i.id = wx.id
left join check_ins ci on ci.item_id = i.id
     and (ci.checked_at at time zone 'America/Phoenix')::date >= (select d0 from p)
     and (ci.checked_at at time zone 'America/Phoenix')::date <  (select d1 from p)
     and ci.user_id not in (select id from users where is_admin)
group by i.id, i.body, i.is_secret, i.is_active order by checkoffs desc, item;

-- E3. Top 10 Willcox experiences by checkoffs (window). Secret items are masked.
with p as (select '2026-10-16'::date d0, '2026-10-26'::date d1),
wx as (select id from items where neighborhood_id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1'
       union select li.item_id from list_items li join destination_lists dl on dl.list_id = li.list_id
              where dl.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639' and dl.is_active)
select case when i.is_secret then '(secret item)' else left(i.body, 90) end as item, count(*) checkoffs, count(distinct ci.user_id) users
from check_ins ci join wx on wx.id = ci.item_id join items i on i.id = ci.item_id, p
where (ci.checked_at at time zone 'America/Phoenix')::date >= p.d0 and (ci.checked_at at time zone 'America/Phoenix')::date < p.d1
  and ci.user_id not in (select id from users where is_admin)
group by i.id, i.body, i.is_secret order by checkoffs desc limit 10;

-- E4. Daily activity: checkoffs and users per day (use to read Oct 17, Oct 18 and the 7 days after).
with p as (select '2026-10-16'::date d0, '2026-10-26'::date d1),
wx as (select id from items where neighborhood_id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1'
       union select li.item_id from list_items li join destination_lists dl on dl.list_id = li.list_id
              where dl.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639' and dl.is_active)
select (ci.checked_at at time zone 'America/Phoenix')::date as day, to_char((ci.checked_at at time zone 'America/Phoenix')::date,'Dy') as dow,
       count(*) checkoffs, count(distinct ci.user_id) users
from check_ins ci join wx on wx.id = ci.item_id, p
where (ci.checked_at at time zone 'America/Phoenix')::date >= p.d0 and (ci.checked_at at time zone 'America/Phoenix')::date < p.d1
  and ci.user_id not in (select id from users where is_admin)
group by 1,2 order by 1;

-- E5. Post-festival 7 days (Oct 19 to Oct 25) vs the festival weekend (Oct 17 to 18), side by side.
with wx as (select id from items where neighborhood_id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1'
            union select li.item_id from list_items li join destination_lists dl on dl.list_id = li.list_id
                   where dl.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639' and dl.is_active),
c as (select ci.user_id, (ci.checked_at at time zone 'America/Phoenix')::date d
      from check_ins ci join wx on wx.id = ci.item_id
      where ci.user_id not in (select id from users where is_admin))
select 'festival Oct 17-18' period, count(*) checkoffs, count(distinct user_id) users from c where d between '2026-10-17' and '2026-10-18'
union all
select 'post-festival Oct 19-25', count(*), count(distinct user_id) from c where d between '2026-10-19' and '2026-10-25';

-- E6. New users in the launch window, split by whether they checked off a Willcox item.
-- users.created_at is the registration time. This is correlation, not attribution (see header).
with p as (select '2026-10-16'::date d0, '2026-10-26'::date d1),
wx as (select id from items where neighborhood_id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1'
       union select li.item_id from list_items li join destination_lists dl on dl.list_id = li.list_id
              where dl.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639' and dl.is_active),
nu as (select u.id, u.platform from users u, p
       where not coalesce(u.is_admin,false) and not coalesce(u.is_deleted,false)
         and (u.created_at at time zone 'America/Phoenix')::date >= p.d0 and (u.created_at at time zone 'America/Phoenix')::date < p.d1)
select count(*) new_users,
       count(*) filter (where exists (select 1 from check_ins ci join wx on wx.id = ci.item_id where ci.user_id = nu.id)) new_users_with_willcox_checkoff,
       count(*) filter (where platform = 'ios') ios, count(*) filter (where platform = 'android') android
from nu;

-- E7. In-app interest in Willcox items (interaction_events): views, saves, directions, website taps, checkoff taps.
-- event_type values seen in production: item_view, item_save, directions_click, url_click, item_checkoff_tap, checkoff_completed.
with p as (select '2026-10-16'::timestamptz t0),
wx as (select id from items where neighborhood_id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1')
select e.event_type, count(*) events, count(distinct e.user_id) users
from interaction_events e join wx on wx.id = e.item_id, p
where e.occurred_at >= p.t0
  and e.event_type in ('item_view','item_save','directions_click','url_click','item_checkoff_tap','checkoff_completed')
group by 1 order by 2 desc;

-- E8. Sanity: who is checking off Willcox (user ids only). Use to spot test accounts before reporting.
select ci.user_id, u.is_admin, u.created_at::date joined, count(*) checkoffs, min(ci.checked_at) first_at, max(ci.checked_at) last_at
from check_ins ci join items i on i.id = ci.item_id and i.neighborhood_id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1'
join users u on u.id = ci.user_id
group by 1,2,3 order by checkoffs desc;
