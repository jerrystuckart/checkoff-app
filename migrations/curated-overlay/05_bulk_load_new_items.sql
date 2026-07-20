-- ============================================================
-- Bulk-load new items into curated lists (77 attachments) — CORRECTED
-- Run in Supabase SQL editor in order: 1, 2, 2B, 3.
-- Fixes applied vs. the original draft (all verified live before
-- handing back):
--   - items' text column is `body`, not `title` — every i.title
--     reference below is i.body.
--   - curated_list_items has no `created_at` column — dropped from
--     Step 3b, which no longer needs a "today" filter to be useful.
--   - 'Selah Beauty' -> 'Selah' (actual item name; original pattern
--     matched zero rows).
--   - 'Mission Garden' -> 'living agricultural history' for all three
--     targets. A second "Mission Garden" item was created in today's
--     batch that's a near-duplicate of one already in the database
--     (the one this whole batch was presumably meant to attach) —
--     this pattern picks the pre-existing item deliberately. The new
--     duplicate (id 333291c0-8624-433d-a650-bbdf500d4acc) is left
--     alone here; decide separately whether to soft-deactivate it.
--   - Added STEP 2B: Mercado District and Tucson Hidden Bars each
--     have a paired `lists` row (is_official=true, created by you in
--     the same batch as their curated_lists row, at the identical
--     timestamp — confirmed live, not a coincidental title match).
--     Step 2 alone would leave list_items out of sync for those two
--     lists' new items. 2B mirrors just those 8 rows.
-- ============================================================

-- ============================================================
-- STEP 1 — PRE-FLIGHT (read-only). Must return ZERO rows.
-- ============================================================
WITH mappings(item_pattern, list_pattern, slug, ord) AS (
  VALUES
    ('Rocks and Ropes',                  'Main Character Cardio',      'tucson', 1),
    ('BLOC Climbing',                    'Main Character Cardio',      'tucson', 2),
    ('SpaWell',                          'Ferda Girls',                'tucson', 3),
    ('Kaelen Harwell',                   'Ferda Girls',                'tucson', 4),
    ('Radiant Day Spa',                  'Ferda Girls',                'tucson', 5),
    ('Selah',                            'Ferda Girls',                'tucson', 6),
    ('Canyon Ranch',                     'Ferda Girls',                'tucson', 7),
    ('The Coronet',                      'Soft Launch Season',         'tucson', 8),
    ('The Coronet',                      'Little League Parents',      'tucson', 9),
    ('Tito & Pep',                       'Soft Launch Season',         'tucson', 10),
    ('Tito & Pep',                       'Little League Parents',      'tucson', 11),
    ('BATA',                             'Soft Launch Season',         'tucson', 12),
    ('BATA',                             'Little League Parents',      'tucson', 13),
    ('Wild Katz',                        'Snack Pack Survivors',       'tucson', 14),
    ('Skate Country',                    'Snack Pack Survivors',       'tucson', 15),
    ('La Estrella',                      'Mercado District',           'tucson', 16),
    ('Presta Coffee',                    'Mercado District',           'tucson', 17),
    ('Kukai',                            'Mercado District',           'tucson', 18),
    ('Desierto Books',                   'Mercado District',           'tucson', 19),
    ('Summer Night Market',              'Mercado District',           'tucson', 20),
    ('wooden nickel',                    'Tucson Hidden Bars',         'tucson', 21),
    ('wooden nickel',                    'Ungoogleable City',          'tucson', 22),
    ('Sunshine Wine',                    'Tucson Hidden Bars',         'tucson', 23),
    ('Sunshine Wine',                    'Soft Launch Season',         'tucson', 24),
    ('Market Run',                       'Brunch Bloc',                'tucson', 25),
    ('Market Run',                       'New Kids on the Block',      'tucson', 26),
    ('Market Run',                       'Ferda Girls',                'tucson', 27),
    ('Century Room',                     'Little League Parents',      'tucson', 28),
    ('Century Room',                     'Soft Launch Season',         'tucson', 29),
    ('Barrio Viejo',                     'Live Here',                  'tucson', 30),
    ('Barrio Viejo',                     'New Kids on the Block',      'tucson', 31),
    ('Barrio Viejo',                     'Best of Tucson',             'tucson', 32),
    ('living agricultural history',      'Live Here',                  'tucson', 33),
    ('living agricultural history',      'New Kids on the Block',      'tucson', 34),
    ('living agricultural history',      'Mercado District',           'tucson', 35),
    ('Seven Falls',                      'Trail Mix Crew',             'tucson', 36),
    ('Seven Falls',                      'Main Character Cardio',      'tucson', 37),
    ('Wasson Peak',                      'Trail Mix Crew',             'tucson', 38),
    ('Wasson Peak',                      'Main Character Cardio',      'tucson', 39),
    ('Lucidi Distilling',                'Rediscover Downtown Peoria', 'phoenix', 40),
    ('Theater Works',                    'Rediscover Downtown Peoria', 'phoenix', 41),
    ('Ape Index',                        'Rediscover Downtown Peoria', 'phoenix', 42),
    ('red lantern',                      'Phoenix Hidden Gems',        'phoenix', 43),
    ('Walk the steepest hill',           'Main Character Cardio',      NULL, 44),
    ('public staircase',                 'Main Character Cardio',      NULL, 45),
    ('one car errand',                   'Main Character Cardio',      NULL, 46),
    ('facial at a local spa',            'Ferda Girls',                NULL, 47),
    ('emotional infrastructure',         'Ferda Girls',                NULL, 48),
    ('boutique crawl',                   'Ferda Girls',                NULL, 49),
    ('one appetizer and one dessert',    'Soft Launch Season',         NULL, 50),
    ('cannot pronounce',                 'Soft Launch Season',         NULL, 51),
    ('two-stop food crawl',              'Soft Launch Season',         NULL, 52),
    ('trail snack',                      'Trail Mix Crew',             NULL, 53),
    ('one real view',                    'Trail Mix Crew',             NULL, 54),
    ('water-adjacent',                   'Trail Mix Crew',             NULL, 55),
    ('pick a park and a snack stop',     'Snack Pack Survivors',       NULL, 56),
    ('frozen drinks',                    'Snack Pack Survivors',       NULL, 57),
    ('indoor play backup',               'Snack Pack Survivors',       NULL, 58),
    ('where they take visitors',         'Live Here',                  NULL, 59),
    ('without using the main street',    'Live Here',                  NULL, 60),
    ('local transit for one stop',       'Live Here',                  NULL, 61),
    ('smallest museum',                  'Ungoogleable City',          NULL, 62),
    ('regulars order',                   'Ungoogleable City',          NULL, 63),
    ('oldest local shop',                'Ungoogleable City',          NULL, 64),
    ('reservation after 8pm',            'Little League Parents',      NULL, 65),
    ('cocktail at a grown-up bar',       'Little League Parents',      NULL, 66),
    ('late movie or live show',          'Little League Parents',      NULL, 67),
    ('pastry case',                      'Brunch Bloc',                NULL, 68),
    ('one savory plate and one sweet plate', 'Brunch Bloc',            NULL, 69),
    ('walkable second stop',             'Brunch Bloc',                NULL, 70),
    ('keep driving past',                'New Kids on the Block',      NULL, 71),
    ('independent shop',                 'New Kids on the Block',      NULL, 72),
    ('one neighborhood name',            'New Kids on the Block',      NULL, 73),
    ('one hour from a local cafe',       'Remote and Restless',        NULL, 74),
    ('midday bookstore break',           'Remote and Restless',        NULL, 75),
    ('no-spend afternoon',               'College Dropout',            NULL, 76),
    ('two-dollar side quest',            'College Dropout',            NULL, 77)
)
SELECT
  mp.ord, mp.item_pattern, mp.list_pattern,
  (SELECT count(*) FROM items i
     WHERE i.body ILIKE '%' || mp.item_pattern || '%' AND i.is_active) AS item_matches,
  (SELECT count(*) FROM curated_lists cl
     WHERE cl.title ILIKE '%' || mp.list_pattern || '%' AND cl.is_active) AS list_matches
FROM mappings mp
WHERE (SELECT count(*) FROM items i
         WHERE i.body ILIKE '%' || mp.item_pattern || '%' AND i.is_active) <> 1
   OR (SELECT count(*) FROM curated_lists cl
         WHERE cl.title ILIKE '%' || mp.list_pattern || '%' AND cl.is_active) <> 1;


-- ============================================================
-- STEP 2 — INSERT into curated_list_items. Run only after Step 1
-- returns zero rows. NOTE: VALUES block must stay identical to Step 1's.
-- ============================================================
WITH mappings(item_pattern, list_pattern, slug, ord) AS (
  VALUES
    ('Rocks and Ropes',                  'Main Character Cardio',      'tucson', 1),
    ('BLOC Climbing',                    'Main Character Cardio',      'tucson', 2),
    ('SpaWell',                          'Ferda Girls',                'tucson', 3),
    ('Kaelen Harwell',                   'Ferda Girls',                'tucson', 4),
    ('Radiant Day Spa',                  'Ferda Girls',                'tucson', 5),
    ('Selah',                            'Ferda Girls',                'tucson', 6),
    ('Canyon Ranch',                     'Ferda Girls',                'tucson', 7),
    ('The Coronet',                      'Soft Launch Season',         'tucson', 8),
    ('The Coronet',                      'Little League Parents',      'tucson', 9),
    ('Tito & Pep',                       'Soft Launch Season',         'tucson', 10),
    ('Tito & Pep',                       'Little League Parents',      'tucson', 11),
    ('BATA',                             'Soft Launch Season',         'tucson', 12),
    ('BATA',                             'Little League Parents',      'tucson', 13),
    ('Wild Katz',                        'Snack Pack Survivors',       'tucson', 14),
    ('Skate Country',                    'Snack Pack Survivors',       'tucson', 15),
    ('La Estrella',                      'Mercado District',           'tucson', 16),
    ('Presta Coffee',                    'Mercado District',           'tucson', 17),
    ('Kukai',                            'Mercado District',           'tucson', 18),
    ('Desierto Books',                   'Mercado District',           'tucson', 19),
    ('Summer Night Market',              'Mercado District',           'tucson', 20),
    ('wooden nickel',                    'Tucson Hidden Bars',         'tucson', 21),
    ('wooden nickel',                    'Ungoogleable City',          'tucson', 22),
    ('Sunshine Wine',                    'Tucson Hidden Bars',         'tucson', 23),
    ('Sunshine Wine',                    'Soft Launch Season',         'tucson', 24),
    ('Market Run',                       'Brunch Bloc',                'tucson', 25),
    ('Market Run',                       'New Kids on the Block',      'tucson', 26),
    ('Market Run',                       'Ferda Girls',                'tucson', 27),
    ('Century Room',                     'Little League Parents',      'tucson', 28),
    ('Century Room',                     'Soft Launch Season',         'tucson', 29),
    ('Barrio Viejo',                     'Live Here',                  'tucson', 30),
    ('Barrio Viejo',                     'New Kids on the Block',      'tucson', 31),
    ('Barrio Viejo',                     'Best of Tucson',             'tucson', 32),
    ('living agricultural history',      'Live Here',                  'tucson', 33),
    ('living agricultural history',      'New Kids on the Block',      'tucson', 34),
    ('living agricultural history',      'Mercado District',           'tucson', 35),
    ('Seven Falls',                      'Trail Mix Crew',             'tucson', 36),
    ('Seven Falls',                      'Main Character Cardio',      'tucson', 37),
    ('Wasson Peak',                      'Trail Mix Crew',             'tucson', 38),
    ('Wasson Peak',                      'Main Character Cardio',      'tucson', 39),
    ('Lucidi Distilling',                'Rediscover Downtown Peoria', 'phoenix', 40),
    ('Theater Works',                    'Rediscover Downtown Peoria', 'phoenix', 41),
    ('Ape Index',                        'Rediscover Downtown Peoria', 'phoenix', 42),
    ('red lantern',                      'Phoenix Hidden Gems',        'phoenix', 43),
    ('Walk the steepest hill',           'Main Character Cardio',      NULL, 44),
    ('public staircase',                 'Main Character Cardio',      NULL, 45),
    ('one car errand',                   'Main Character Cardio',      NULL, 46),
    ('facial at a local spa',            'Ferda Girls',                NULL, 47),
    ('emotional infrastructure',         'Ferda Girls',                NULL, 48),
    ('boutique crawl',                   'Ferda Girls',                NULL, 49),
    ('one appetizer and one dessert',    'Soft Launch Season',         NULL, 50),
    ('cannot pronounce',                 'Soft Launch Season',         NULL, 51),
    ('two-stop food crawl',              'Soft Launch Season',         NULL, 52),
    ('trail snack',                      'Trail Mix Crew',             NULL, 53),
    ('one real view',                    'Trail Mix Crew',             NULL, 54),
    ('water-adjacent',                   'Trail Mix Crew',             NULL, 55),
    ('pick a park and a snack stop',     'Snack Pack Survivors',       NULL, 56),
    ('frozen drinks',                    'Snack Pack Survivors',       NULL, 57),
    ('indoor play backup',               'Snack Pack Survivors',       NULL, 58),
    ('where they take visitors',         'Live Here',                  NULL, 59),
    ('without using the main street',    'Live Here',                  NULL, 60),
    ('local transit for one stop',       'Live Here',                  NULL, 61),
    ('smallest museum',                  'Ungoogleable City',          NULL, 62),
    ('regulars order',                   'Ungoogleable City',          NULL, 63),
    ('oldest local shop',                'Ungoogleable City',          NULL, 64),
    ('reservation after 8pm',            'Little League Parents',      NULL, 65),
    ('cocktail at a grown-up bar',       'Little League Parents',      NULL, 66),
    ('late movie or live show',          'Little League Parents',      NULL, 67),
    ('pastry case',                      'Brunch Bloc',                NULL, 68),
    ('one savory plate and one sweet plate', 'Brunch Bloc',            NULL, 69),
    ('walkable second stop',             'Brunch Bloc',                NULL, 70),
    ('keep driving past',                'New Kids on the Block',      NULL, 71),
    ('independent shop',                 'New Kids on the Block',      NULL, 72),
    ('one neighborhood name',            'New Kids on the Block',      NULL, 73),
    ('one hour from a local cafe',       'Remote and Restless',        NULL, 74),
    ('midday bookstore break',           'Remote and Restless',        NULL, 75),
    ('no-spend afternoon',               'College Dropout',            NULL, 76),
    ('two-dollar side quest',            'College Dropout',            NULL, 77)
),
resolved AS (
  SELECT
    mp.ord,
    mp.slug,
    (SELECT i.id FROM items i
       WHERE i.body ILIKE '%' || mp.item_pattern || '%' AND i.is_active) AS item_id,
    (SELECT cl.id FROM curated_lists cl
       WHERE cl.title ILIKE '%' || mp.list_pattern || '%' AND cl.is_active) AS list_id
  FROM mappings mp
),
ordered AS (
  SELECT r.*,
    COALESCE((SELECT max(c.display_order) FROM curated_list_items c
                WHERE c.curated_list_id = r.list_id), 0)
    + row_number() OVER (PARTITION BY r.list_id ORDER BY r.ord) AS new_order
  FROM resolved r
)
INSERT INTO curated_list_items (curated_list_id, item_id, display_order, city_slug)
SELECT o.list_id, o.item_id, o.new_order, o.slug
FROM ordered o
WHERE o.list_id IS NOT NULL
  AND o.item_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM curated_list_items e
    WHERE e.curated_list_id = o.list_id AND e.item_id = o.item_id
  )
RETURNING id, curated_list_id, item_id, city_slug, display_order;


-- ============================================================
-- STEP 2B — Mirror into list_items for the two lists that have a
-- paired, is_official `lists` row (Mercado District, Tucson Hidden
-- Bars — confirmed live, not a title coincidence: both created by
-- you, is_official=true, same timestamp as their curated_lists row).
-- Only the 8 rows targeting these two lists need this; the other 69
-- have no lists-row counterpart (verified) and don't need mirroring.
-- ============================================================
WITH mappings(item_pattern, lists_id, slug, ord) AS (
  VALUES
    ('La Estrella',                 '13ef3245-7d11-4ad5-ac58-fa603c0d816f'::uuid, 'tucson', 16), -- Mercado District
    ('Presta Coffee',               '13ef3245-7d11-4ad5-ac58-fa603c0d816f'::uuid, 'tucson', 17),
    ('Kukai',                       '13ef3245-7d11-4ad5-ac58-fa603c0d816f'::uuid, 'tucson', 18),
    ('Desierto Books',              '13ef3245-7d11-4ad5-ac58-fa603c0d816f'::uuid, 'tucson', 19),
    ('Summer Night Market',         '13ef3245-7d11-4ad5-ac58-fa603c0d816f'::uuid, 'tucson', 20),
    ('living agricultural history', '13ef3245-7d11-4ad5-ac58-fa603c0d816f'::uuid, 'tucson', 35),
    ('wooden nickel',               'bd0d2d57-557d-4e9c-825c-b349eec37d74'::uuid, 'tucson', 21), -- Tucson Hidden Bars
    ('Sunshine Wine',                'bd0d2d57-557d-4e9c-825c-b349eec37d74'::uuid, 'tucson', 23)
),
resolved AS (
  SELECT
    mp.ord, mp.slug, mp.lists_id,
    (SELECT i.id FROM items i WHERE i.body ILIKE '%' || mp.item_pattern || '%' AND i.is_active) AS item_id
  FROM mappings mp
),
ordered AS (
  SELECT r.*,
    COALESCE((SELECT max(li.sort_order) FROM list_items li WHERE li.list_id = r.lists_id), 0)
    + row_number() OVER (PARTITION BY r.lists_id ORDER BY r.ord) AS new_order
  FROM resolved r
)
INSERT INTO list_items (list_id, item_id, sort_order, city_slug)
SELECT o.lists_id, o.item_id, o.new_order, o.slug
FROM ordered o
WHERE o.item_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM list_items e WHERE e.list_id = o.lists_id AND e.item_id = o.item_id
  )
RETURNING id, list_id, item_id, city_slug, sort_order;


-- ============================================================
-- STEP 3 — VERIFICATION (read-only)
-- ============================================================

-- 3a. Per-metro effective composition of every active list.
SELECT cl.title,
  count(*) FILTER (WHERE cli.city_slug IS NULL)        AS universal,
  count(*) FILTER (WHERE cli.city_slug = 'phoenix')    AS phoenix,
  count(*) FILTER (WHERE cli.city_slug = 'milwaukee')  AS milwaukee,
  count(*) FILTER (WHERE cli.city_slug = 'tucson')     AS tucson
FROM curated_lists cl
JOIN curated_list_items cli ON cli.curated_list_id = cl.id
WHERE cl.is_active
GROUP BY cl.title
ORDER BY cl.title;

-- 3b. Universal attachments whose underlying item is NOT flagged
-- is_universal (should be zero rows; fix items if not). Dropped the
-- created_at filter — curated_list_items has no such column.
SELECT i.id, i.body
FROM curated_list_items cli
JOIN items i ON i.id = cli.item_id
WHERE cli.city_slug IS NULL
  AND i.is_universal IS NOT TRUE;

-- 3c. Tucson attachments whose item lacks a neighborhood
-- (should be zero except intentionally unscoped ones).
SELECT i.id, i.body
FROM curated_list_items cli
JOIN items i ON i.id = cli.item_id
WHERE cli.city_slug = 'tucson'
  AND i.neighborhood_id IS NULL;

-- 3d. Confirms list_items now matches curated_list_items for the two
-- mirrored lists. Expect Mercado District and Tucson Hidden Bars each
-- present with equal counts; nothing else should appear here.
SELECT cl.title AS curated_list,
  (SELECT count(*) FROM curated_list_items c2 WHERE c2.curated_list_id = cl.id) AS cli_count,
  (SELECT count(*) FROM list_items li WHERE li.list_id = l.id) AS list_items_count
FROM curated_lists cl
JOIN lists l ON l.title = cl.title
WHERE cl.is_active
  AND (cl.title ILIKE '%Mercado District%' OR cl.title ILIKE '%Tucson Hidden Bars%');
