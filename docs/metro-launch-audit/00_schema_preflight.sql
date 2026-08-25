-- ============================================================
-- Denver/Boulder metro launch audit — read-only preflight queries
-- Generated 2026-08-21. Every query below was actually executed
-- against the linked production project (uggusbbswybyplypkbxz)
-- via `supabase db query -f <file> --linked` (no Docker/local DB
-- needed for this — it opens a direct read/write-capable Postgres
-- session to the remote project, so these are recorded here as
-- SELECT-only for reproducibility, not because execution was
-- blocked). Results are captured in 01/03/04/05/06 of this audit.
--
-- Re-run any of these at any time to refresh the findings — none
-- of them mutate data.
-- ============================================================

-- 1. All public tables
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' ORDER BY table_name;

-- 2. Columns for every metro-relevant table
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN (
'metro_areas','cities','neighborhoods','categories','tags','items','item_tags','item_neighborhoods',
'lists','list_items','curated_lists','curated_list_items','curated_list_metros','list_members','check_ins',
'destination_lists','destination_partners','destination_spotlights','destination_zones','destinations',
'metro_destination_lists','metro_destinations','audience_groups','featured_experiences','badge_definitions',
'push_tokens','notification_queue','interaction_events','seasons','partner_seasons')
ORDER BY table_name, ordinal_position;

-- 3. Foreign keys touching metro-relevant tables
SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name,
       ccu.column_name AS foreign_column_name, tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public'
ORDER BY tc.table_name, kcu.column_name;

-- 4. RLS policies on metro/list/item tables
SELECT tablename, policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename IN
('curated_lists','curated_list_items','curated_list_metros','lists','list_items','items','neighborhoods','metro_areas','audience_groups')
ORDER BY tablename, policyname;

-- 5. Triggers in public schema
SELECT event_object_table, trigger_name, action_timing, event_manipulation, action_statement
FROM information_schema.triggers WHERE trigger_schema='public'
ORDER BY event_object_table, trigger_name;

-- 6. Key function definitions (metro/seasonal/geo logic)
SELECT routine_name, routine_definition FROM information_schema.routines
WHERE routine_schema='public' AND routine_name IN
('update_item_location','update_neighborhood_center','sync_seasonal_item_active',
 'apply_seasonal_active_on_tag_change','season_days_until_start','prevent_expired_list_checkins','is_list_member')
ORDER BY routine_name;

-- 7. pg_cron jobs
SELECT jobname, schedule, command, active FROM cron.job ORDER BY jobname;

-- 8. Indexes on check-in/list/curated-list tables (constraint shape)
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('check_ins','list_items','curated_list_items','curated_lists','curated_list_metros','items')
ORDER BY tablename, indexname;

-- 9. Existing metro_areas rows (foundation template data)
SELECT id, name, slug, state, is_active, center_lat, center_lng, array_length(hero_images,1) AS hero_img_count, created_at
FROM metro_areas ORDER BY created_at;

-- 10. Metro rollup: neighborhoods, active non-universal items, public/official lists
SELECT m.id AS metro_id, m.name, m.slug,
  (SELECT count(*) FROM neighborhoods n WHERE n.metro_id=m.id) AS neighborhood_count,
  (SELECT count(*) FROM items i JOIN neighborhoods n ON n.id=i.neighborhood_id
     WHERE n.metro_id=m.id AND i.is_active AND NOT i.is_universal) AS active_non_universal_items_via_neighborhood,
  (SELECT count(*) FROM lists l WHERE l.metro_id=m.id AND l.is_public) AS active_public_lists,
  (SELECT count(*) FROM lists l WHERE l.metro_id=m.id AND l.is_official) AS official_lists_total
FROM metro_areas m ORDER BY m.slug;

-- 11. items.city_id fill rate (resolves the city_id-required-or-not contradiction)
SELECT count(*) AS total_items, count(city_id) AS items_with_city_id,
  round(100.0*count(city_id)/count(*),1) AS pct_with_city_id,
  count(*) FILTER (WHERE is_universal) AS universal_items,
  count(*) FILTER (WHERE city_id IS NULL AND NOT is_universal) AS null_city_non_universal
FROM items;

-- 12. cities table contents (check whether it's still meaningfully used)
SELECT id, name, state FROM cities ORDER BY name;

-- 13. season_tag item counts per metro (which metros are exposed to the
--     America/Phoenix-hardcoded seasonal trigger today, not just Denver later)
SELECT m.slug AS metro_slug, i.season_tag, count(*) AS item_count
FROM items i
LEFT JOIN neighborhoods n ON n.id = i.neighborhood_id
LEFT JOIN metro_areas m ON m.id = n.metro_id
WHERE i.season_tag IS NOT NULL
GROUP BY m.slug, i.season_tag ORDER BY m.slug, i.season_tag;

-- 14. Lists with starts_at/ends_at per metro (official seasonal-list collision check)
SELECT m.slug AS metro_slug, l.title, l.is_official, l.starts_at, l.ends_at
FROM lists l LEFT JOIN metro_areas m ON m.id = l.metro_id
WHERE l.starts_at IS NOT NULL OR l.ends_at IS NOT NULL
ORDER BY m.slug, l.starts_at;

-- 15. Curated lists per metro with item counts and curated_list_metros linkage
SELECT cl.title, cl.city_slug, cl.slug, cl.is_active, cl.is_featured, ag.name AS audience_group,
  (SELECT count(*) FROM curated_list_items cli WHERE cli.curated_list_id=cl.id) AS item_count,
  (SELECT array_agg(cm.city_slug) FROM curated_list_metros cm WHERE cm.curated_list_id=cl.id) AS metros_linked
FROM curated_lists cl LEFT JOIN audience_groups ag ON ag.id=cl.audience_group_id
ORDER BY cl.city_slug, cl.title;

-- 16. audience_groups per metro
SELECT id, name, city_slug, is_active, display_order FROM audience_groups ORDER BY city_slug, display_order;

-- 17. Bonus Drop sort_order pattern for a sample official list
SELECT l.title, li.sort_order, li.is_bonus_drop, li.unlock_threshold
FROM list_items li JOIN lists l ON l.id=li.list_id
WHERE l.title LIKE 'Fall 2026%' AND l.metro_id = (SELECT id FROM metro_areas WHERE slug='phoenix')
ORDER BY li.sort_order;

-- 18. Item intake contract values in production
SELECT DISTINCT checkin_type FROM items ORDER BY 1;
SELECT difficulty, count(*) FROM items GROUP BY difficulty ORDER BY 1;
SELECT min(geo_radius_m), max(geo_radius_m), avg(geo_radius_m),
  count(*) FILTER (WHERE geo_radius_m IS NOT NULL) AS set_count, count(*) AS total FROM items;

-- 19. interaction_events distinct event types (what's measurable today)
SELECT event_type, count(*) FROM interaction_events GROUP BY event_type ORDER BY 2 DESC;

-- 20. Storage buckets
SELECT id, name, public FROM storage.buckets ORDER BY id;

-- 21. app_config rows (client version gating — check for any metro-specific keys)
SELECT * FROM app_config;
