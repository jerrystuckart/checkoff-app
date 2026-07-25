BEGIN;

-- ============================================================
-- FALL 2026 — TUCSON METRO
-- List ID: c3ffd340-5a18-4d90-a0d8-e0d3c3ac7514
--
-- Original 30:
--   is_bonus_drop = false
--   unlock_threshold = NULL
--
-- Bonus Drop 1:
--   Mount Lemmon SkyCenter
--   unlock_threshold = 9
--   position: 11th row (sort_order 10)
--
-- Bonus Drop 2:
--   Seven Falls
--   unlock_threshold = 15
--   position: 22nd row (sort_order 21)
-- ============================================================


-- ============================================================
-- 1. UPDATE THE SELECTED EXISTING ITEMS
-- ============================================================

WITH approved_copy AS (
  SELECT *
  FROM (
    VALUES

    (
      '370d709d-56b3-402c-842d-5356bbd1727a'::uuid,
      $$Catch golden hour at 'Gates Pass' — the Tucson sunset everyone secretly judges you for missing$$
    ),

    (
      '51194846-0cf3-4050-a230-cd66d616c2bf'::uuid,
      $$Climb from cactus to pine forest on the 'Mount Lemmon Scenic Byway' — then end with a giant cookie in Summerhaven$$
    ),

    (
      'f04e2502-8441-467a-909e-d9bf6d99b906'::uuid,
      $$Climb 'Tumamoc Hill' at sunrise — Tucson cardio with a city-and-saguaro payoff at the top$$
    ),

    (
      '4daf6892-15a9-4079-a673-55894074330f'::uuid,
      $$Drive or bike the Cactus Forest Loop at 'Saguaro National Park East' — stop for one perfect saguaro silhouette photo$$
    ),

    (
      '647d3f64-5e01-4b2f-9157-0ebed8190f4a'::uuid,
      $$Find the Signal Hill petroglyphs at 'Saguaro National Park West' — the short hike with the ancient payoff$$
    ),

    (
      'b480ba47-7c07-4a78-a754-2d6b3d0e201f'::uuid,
      $$Ride the tram into 'Sabino Canyon' — then hike back through Tucson's desert oasis$$
    ),

    (
      'edb91dc8-4a23-4cf7-972a-ce3dc9403b79'::uuid,
      $$Birdwatch at 'Sweetwater Wetlands' — a reclaimed-water wetland hiding in the middle of the Sonoran Desert$$
    ),

    (
      'ee40c9c7-bb28-40a7-b10d-34f577afafd7'::uuid,
      $$Ride part of 'The Loop' and stop somewhere local — coffee, beer or a market counts$$
    ),

    (
      '1aad20a2-c99a-45d9-af4e-33cf76d59938'::uuid,
      $$Walk the desert-zoo loop at 'Arizona-Sonora Desert Museum' — Tucson's best first lesson in why the desert is alive$$
    ),

    (
      'f0708277-a94e-4062-9fdc-a825d78c27fa'::uuid,
      $$Stand inside 'Mission San Xavier del Bac' — the White Dove of the Desert still stops people mid-sentence$$
    ),

    (
      '6fd27327-926d-4509-9df5-fffa2b56c6a0'::uuid,
      $$Stand beneath the colors in 'Barrio Viejo' — postcard Tucson without a ticket line, adobe walls painted in colors you've never seen arranged like that before$$
    ),

    (
      '333291c0-8624-433d-a650-bbdf500d4acc'::uuid,
      $$Walk the edible history rows at 'Mission Garden' — Tucson's food story grows beside the Santa Cruz River, from Hohokam to heirloom chile in one plot$$
    ),

    (
      'b8bbe972-d786-4380-8f2a-cfc3e7d4f994'::uuid,
      $$Light a candle at 'El Tiradito' — Tucson's hidden wishing shrine in Barrio Viejo$$
    ),

    (
      '4a430560-8a1d-480a-88e5-febf22eaa930'::uuid,
      $$Step inside the reconstructed walls at 'Presidio San Agustín del Tucson' — where modern Tucson traces itself back to 1775$$
    ),

    (
      '83c7bf50-4bd6-418f-a031-ad2b8d269ee1'::uuid,
      $$Find John Dillinger's chewed gum at the 'Coit Museum of Pharmacy' — a jar of gangster gum inside a UA pharmacy building$$
    ),

    (
      '68b2cc1a-4fac-4a3f-ba7f-daa754ed637c'::uuid,
      $$Stand in the neon glow at 'Ignite Sign Art Museum' — Tucson's rescued motel signs buzzing in one warehouse$$
    ),

    (
      '5a47bf78-7a5a-4757-a26d-62bffecbcf8e'::uuid,
      $$Walk among hundreds of aircraft and find the weirdest plane at 'Pima Air & Space Museum'$$
    ),

    (
      'f82e5ba2-050a-47e9-b9a0-45fd7c073e61'::uuid,
      $$Step into the desert-built chapel at 'DeGrazia Gallery in the Sun' — adobe, cactus and Tucson art fused into one place$$
    ),

    (
      'd6dd9728-d220-4549-ad95-c3adb2718063'::uuid,
      $$Order carne seca at 'El Charro Café' — Tucson history served on a plate since 1922$$
    ),

    (
      '27b6898e-2eea-4a89-bd80-89be66fd1e42'::uuid,
      $$Order the Sonoran dog at 'BK Carne Asada & Hot Dogs' — bacon, beans, salsa and Tucson in one split-top bun$$
    ),

    (
      '747c7060-73aa-4641-8f95-b8fb36a404e6'::uuid,
      $$Order whatever is written on the board at 'Tumerico' — plant-based Mexican food that keeps winning over carnivores$$
    ),

    (
      '077f895d-be6a-412a-909c-45832c2b2a56'::uuid,
      $$Pick up a White Sonora wheat loaf at 'Barrio Bread' — James Beard-level baking from one of America's oldest grain varieties$$
    ),

    (
      'f5c2a3d4-804a-44e9-9ef2-a8691fdb45c8'::uuid,
      $$Order the Assburners at 'Rocco's Little Chicago' — extra-hot secret-menu wings you order at your own risk$$
    ),

    (
      'bcd3a7ac-d080-4c91-a973-762b73f727e8'::uuid,
      $$Split a wood-fired desert dinner at 'Tito & Pep' — citrus, mesquite and candlelight in a Speedway bungalow that punches way above its address$$
    ),

    (
      'f0ec9b0c-43d3-4906-aa5d-2e697eba9785'::uuid,
      $$Take the distillery tour at 'Whiskey Del Bac' — mesquite-smoked single malt for people with nowhere else to be$$
    ),

    (
      'e4bd7d67-3bfa-48cf-9b11-d4c5a96f36c7'::uuid,
      $$Book a table at 'The Century Room' — jazz and cocktails inside the 1919 hotel where Tucson helped catch John Dillinger$$
    ),

    (
      '3ce00353-9ab3-429b-b0ca-50cbdc418527'::uuid,
      $$Find one weird thing on 'Fourth Avenue' — then ride the streetcar away with it$$
    ),

    (
      '29fbd2f7-f529-40fc-b25a-6a8ecd02b696'::uuid,
      $$Go to a Wildcats football game and make it a Main Gate pregame walk at 'Arizona Stadium'$$
    ),

    (
      'ab81bb28-6cf8-4b41-8ef7-44b652a03004'::uuid,
      $$Hike all the way to Seven Falls from 'Sabino Canyon' — nine stream crossings and a waterfall payoff earned over nine miles$$
    )

  ) AS v (
    item_id,
    approved_body
  )
)

UPDATE items i
SET
  body = a.approved_body,
  is_active = true,
  is_approved = true
FROM approved_copy a
WHERE i.id = a.item_id;


-- ============================================================
-- 2. INSERT THE THREE MISSING ITEMS
-- ============================================================

WITH missing_item_data AS (
  SELECT *
  FROM (
    VALUES

    -- Tucson Meet Yourself · Original 30
    (
      $$Eat food from three different cultures at 'Tucson Meet Yourself' — the three-day festival locals still call Tucson Eat Yourself$$,
      'bf25c484-9eea-4766-8136-0789e2876ce8'::uuid,
      'bcd82e32-39e6-4562-8b16-e98fee480a49'::uuid,
      'tap',
      32.223100,
      -110.972900,
      450,
      'Tucson Meet Yourself Jacome Plaza Tucson AZ',
      'https://tucsonmeetyourself.org',
      false,
      'fall',
      true,
      5,
      false
    ),

    -- All Souls Procession · Original 30
    (
      $$Carry someone's memory through the 'All Souls Procession' — then watch Tucson burn the collective urn beneath the desert night$$,
      'bf25c484-9eea-4766-8136-0789e2876ce8'::uuid,
      'ba627408-9424-4194-953f-b1176164e341'::uuid,
      'tap',
      32.225000,
      -110.990000,
      1200,
      'All Souls Procession Tucson Westside AZ',
      'https://allsoulsprocession.org',
      false,
      'fall',
      true,
      10,
      true
    ),

    -- Mount Lemmon SkyCenter · Bonus Drop
    (
      $$Watch Saturn rise through the telescope at 'Mount Lemmon SkyCenter' — stargazing from 9,100 feet through one of the Southwest's largest public telescopes$$,
      'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid,
      'bd16267d-41b4-4660-9343-985fe6631f5d'::uuid,
      'tap',
      32.442500,
      -110.788700,
      300,
      'Mount Lemmon SkyCenter 9800 E Ski Run Rd Mount Lemmon AZ 85619',
      'https://skycenter.arizona.edu',
      false,
      'fall',
      true,
      10,
      true
    )

  ) AS v (
    body,
    category_id,
    neighborhood_id,
    checkin_type,
    latitude,
    longitude,
    geo_radius_m,
    maps_query,
    website_url,
    has_alcohol,
    season_tag,
    is_recurring,
    difficulty,
    photo_required
  )
)

INSERT INTO items (
  body,
  category_id,
  city_id,
  neighborhood_id,
  checkin_type,
  geo_radius_m,
  maps_lat,
  maps_lng,
  maps_query,
  website_url,
  has_alcohol,
  season_tag,
  is_recurring,
  difficulty,
  photo_required,
  is_active,
  is_approved,
  is_universal
)
SELECT
  d.body,
  d.category_id,

  -- Derive Tucson city_id from an existing Tucson item
  (
    SELECT city_id
    FROM items
    WHERE id = '370d709d-56b3-402c-842d-5356bbd1727a'
  ),

  d.neighborhood_id,
  d.checkin_type,
  d.geo_radius_m,
  d.latitude,
  d.longitude,
  d.maps_query,
  d.website_url,
  d.has_alcohol,
  d.season_tag,
  d.is_recurring,
  d.difficulty,
  d.photo_required,
  true,
  true,
  false

FROM missing_item_data d

WHERE NOT EXISTS (
  SELECT 1
  FROM items i
  WHERE LOWER(i.maps_query) = LOWER(d.maps_query)
     OR LOWER(i.body) = LOWER(d.body)
);


-- ============================================================
-- 3. DEFINE THE ORIGINAL 30
-- Positions 11 and 22 are reserved for the two Bonus Drops
-- (sort_order 10 and 21), so the original 30 skip those slots.
-- ============================================================

WITH original_30 AS (
  SELECT *
  FROM (
    VALUES
      ( 0, '370d709d-56b3-402c-842d-5356bbd1727a'::uuid),
      ( 1, '51194846-0cf3-4050-a230-cd66d616c2bf'::uuid),
      ( 2, 'f04e2502-8441-467a-909e-d9bf6d99b906'::uuid),
      ( 3, '4daf6892-15a9-4079-a673-55894074330f'::uuid),
      ( 4, '647d3f64-5e01-4b2f-9157-0ebed8190f4a'::uuid),
      ( 5, 'b480ba47-7c07-4a78-a754-2d6b3d0e201f'::uuid),
      ( 6, 'edb91dc8-4a23-4cf7-972a-ce3dc9403b79'::uuid),
      ( 7, 'ee40c9c7-bb28-40a7-b10d-34f577afafd7'::uuid),
      ( 8, '1aad20a2-c99a-45d9-af4e-33cf76d59938'::uuid),
      ( 9, 'f0708277-a94e-4062-9fdc-a825d78c27fa'::uuid),
      -- sort_order 10 reserved for Bonus Drop 1 (Mount Lemmon SkyCenter)
      (11, '6fd27327-926d-4509-9df5-fffa2b56c6a0'::uuid),
      (12, '333291c0-8624-433d-a650-bbdf500d4acc'::uuid),
      (13, 'b8bbe972-d786-4380-8f2a-cfc3e7d4f994'::uuid),
      (14, '4a430560-8a1d-480a-88e5-febf22eaa930'::uuid),
      (15, '83c7bf50-4bd6-418f-a031-ad2b8d269ee1'::uuid),
      (16, '68b2cc1a-4fac-4a3f-ba7f-daa754ed637c'::uuid),
      (17, '5a47bf78-7a5a-4757-a26d-62bffecbcf8e'::uuid),
      (18, 'f82e5ba2-050a-47e9-b9a0-45fd7c073e61'::uuid),
      (19, 'd6dd9728-d220-4549-ad95-c3adb2718063'::uuid),
      (20, '27b6898e-2eea-4a89-bd80-89be66fd1e42'::uuid),
      -- sort_order 21 reserved for Bonus Drop 2 (Seven Falls)
      (22, '747c7060-73aa-4641-8f95-b8fb36a404e6'::uuid),
      (23, '077f895d-be6a-412a-909c-45832c2b2a56'::uuid),
      (24, 'f5c2a3d4-804a-44e9-9ef2-a8691fdb45c8'::uuid),
      (25, 'bcd3a7ac-d080-4c91-a973-762b73f727e8'::uuid),
      (26, 'f0ec9b0c-43d3-4906-aa5d-2e697eba9785'::uuid),
      (27, 'e4bd7d67-3bfa-48cf-9b11-d4c5a96f36c7'::uuid),
      (28, '3ce00353-9ab3-429b-b0ca-50cbdc418527'::uuid),
      (29, '29fbd2f7-f529-40fc-b25a-6a8ecd02b696'::uuid),

      (
        30,
        (
          SELECT id
          FROM items
          WHERE LOWER(maps_query) =
                LOWER('Tucson Meet Yourself Jacome Plaza Tucson AZ')
          ORDER BY created_at DESC NULLS LAST
          LIMIT 1
        )
      ),

      (
        31,
        (
          SELECT id
          FROM items
          WHERE LOWER(maps_query) =
                LOWER('All Souls Procession Tucson Westside AZ')
          ORDER BY created_at DESC NULLS LAST
          LIMIT 1
        )
      )

  ) AS v (
    sort_order,
    item_id
  )
)

INSERT INTO list_items (
  list_id,
  item_id,
  sort_order,
  is_bonus_drop,
  unlock_threshold
)
SELECT
  'c3ffd340-5a18-4d90-a0d8-e0d3c3ac7514'::uuid,
  o.item_id,
  o.sort_order,
  false,
  NULL
FROM original_30 o
WHERE o.item_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM list_items li
    WHERE li.list_id =
          'c3ffd340-5a18-4d90-a0d8-e0d3c3ac7514'::uuid
      AND li.item_id = o.item_id
  );


-- Normalize any Original 30 rows already attached to the list — corrects
-- sort_order too (not just is_bonus_drop/unlock_threshold), so re-running
-- this script fixes stale positions from an earlier partial run.
WITH original_ids AS (
  SELECT *
  FROM (
    VALUES
      ('370d709d-56b3-402c-842d-5356bbd1727a'::uuid,  0),
      ('51194846-0cf3-4050-a230-cd66d616c2bf'::uuid,  1),
      ('f04e2502-8441-467a-909e-d9bf6d99b906'::uuid,  2),
      ('4daf6892-15a9-4079-a673-55894074330f'::uuid,  3),
      ('647d3f64-5e01-4b2f-9157-0ebed8190f4a'::uuid,  4),
      ('b480ba47-7c07-4a78-a754-2d6b3d0e201f'::uuid,  5),
      ('edb91dc8-4a23-4cf7-972a-ce3dc9403b79'::uuid,  6),
      ('ee40c9c7-bb28-40a7-b10d-34f577afafd7'::uuid,  7),
      ('1aad20a2-c99a-45d9-af4e-33cf76d59938'::uuid,  8),
      ('f0708277-a94e-4062-9fdc-a825d78c27fa'::uuid,  9),
      ('6fd27327-926d-4509-9df5-fffa2b56c6a0'::uuid, 11),
      ('333291c0-8624-433d-a650-bbdf500d4acc'::uuid, 12),
      ('b8bbe972-d786-4380-8f2a-cfc3e7d4f994'::uuid, 13),
      ('4a430560-8a1d-480a-88e5-febf22eaa930'::uuid, 14),
      ('83c7bf50-4bd6-418f-a031-ad2b8d269ee1'::uuid, 15),
      ('68b2cc1a-4fac-4a3f-ba7f-daa754ed637c'::uuid, 16),
      ('5a47bf78-7a5a-4757-a26d-62bffecbcf8e'::uuid, 17),
      ('f82e5ba2-050a-47e9-b9a0-45fd7c073e61'::uuid, 18),
      ('d6dd9728-d220-4549-ad95-c3adb2718063'::uuid, 19),
      ('27b6898e-2eea-4a89-bd80-89be66fd1e42'::uuid, 20),
      ('747c7060-73aa-4641-8f95-b8fb36a404e6'::uuid, 22),
      ('077f895d-be6a-412a-909c-45832c2b2a56'::uuid, 23),
      ('f5c2a3d4-804a-44e9-9ef2-a8691fdb45c8'::uuid, 24),
      ('bcd3a7ac-d080-4c91-a973-762b73f727e8'::uuid, 25),
      ('f0ec9b0c-43d3-4906-aa5d-2e697eba9785'::uuid, 26),
      ('e4bd7d67-3bfa-48cf-9b11-d4c5a96f36c7'::uuid, 27),
      ('3ce00353-9ab3-429b-b0ca-50cbdc418527'::uuid, 28),
      ('29fbd2f7-f529-40fc-b25a-6a8ecd02b696'::uuid, 29)
  ) AS v(item_id, sort_order)

  UNION ALL

  SELECT id, 30
  FROM items
  WHERE LOWER(maps_query) = LOWER('Tucson Meet Yourself Jacome Plaza Tucson AZ')

  UNION ALL

  SELECT id, 31
  FROM items
  WHERE LOWER(maps_query) = LOWER('All Souls Procession Tucson Westside AZ')
)

UPDATE list_items li
SET
  is_bonus_drop = false,
  unlock_threshold = NULL,
  sort_order = o.sort_order
FROM original_ids o
WHERE li.list_id =
      'c3ffd340-5a18-4d90-a0d8-e0d3c3ac7514'::uuid
  AND li.item_id = o.item_id;


-- ============================================================
-- 4. ADD THE TWO BONUS DROPS
-- Positions: Mount Lemmon SkyCenter = 11th row (sort_order 10),
-- Seven Falls = 22nd row (sort_order 21).
-- ============================================================

WITH bonus_items AS (

  SELECT
    i.id AS item_id,
    10 AS sort_order,
    9 AS unlock_threshold
  FROM items i
  WHERE LOWER(i.maps_query) =
        LOWER('Mount Lemmon SkyCenter 9800 E Ski Run Rd Mount Lemmon AZ 85619')
  ORDER BY i.created_at DESC NULLS LAST
  LIMIT 1

),

all_bonus_items AS (

  SELECT *
  FROM bonus_items

  UNION ALL

  SELECT
    'ab81bb28-6cf8-4b41-8ef7-44b652a03004'::uuid,
    21,
    15
)

INSERT INTO list_items (
  list_id,
  item_id,
  sort_order,
  is_bonus_drop,
  unlock_threshold
)
SELECT
  'c3ffd340-5a18-4d90-a0d8-e0d3c3ac7514'::uuid,
  b.item_id,
  b.sort_order,
  true,
  b.unlock_threshold
FROM all_bonus_items b
WHERE b.item_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM list_items li
    WHERE li.list_id =
          'c3ffd340-5a18-4d90-a0d8-e0d3c3ac7514'::uuid
      AND li.item_id = b.item_id
  );


-- Normalize the Bonus Drop settings if either row already existed —
-- corrects sort_order too, for the same re-run-safety reason as above.
UPDATE list_items li
SET
  is_bonus_drop = true,
  sort_order = CASE
    WHEN li.item_id = 'ab81bb28-6cf8-4b41-8ef7-44b652a03004'::uuid
      THEN 21
    ELSE 10
  END,
  unlock_threshold = CASE
    WHEN li.item_id = 'ab81bb28-6cf8-4b41-8ef7-44b652a03004'::uuid
      THEN 15
    ELSE 9
  END
WHERE li.list_id =
      'c3ffd340-5a18-4d90-a0d8-e0d3c3ac7514'::uuid
  AND (
    li.item_id = 'ab81bb28-6cf8-4b41-8ef7-44b652a03004'::uuid

    OR li.item_id IN (
      SELECT id
      FROM items
      WHERE LOWER(maps_query) =
            LOWER('Mount Lemmon SkyCenter 9800 E Ski Run Rd Mount Lemmon AZ 85619')
    )
  );


COMMIT;


-- ============================================================
-- 5. VERIFICATION
-- Expected:
--   30 original items
--   2 Bonus Drops
-- ============================================================

SELECT
  COUNT(*) FILTER (
    WHERE li.is_bonus_drop = false
  ) AS original_item_count,

  COUNT(*) FILTER (
    WHERE li.is_bonus_drop = true
  ) AS bonus_drop_count,

  COUNT(*) AS total_list_rows

FROM list_items li

WHERE li.list_id =
  'c3ffd340-5a18-4d90-a0d8-e0d3c3ac7514'::uuid;


SELECT
  li.sort_order,
  li.is_bonus_drop,
  li.unlock_threshold,
  i.id AS item_id,
  i.body,
  c.name AS category,
  n.name AS neighborhood,
  i.maps_lat,
  i.maps_lng,
  i.geo_radius_m,
  i.is_active

FROM list_items li

JOIN items i
  ON i.id = li.item_id

LEFT JOIN categories c
  ON c.id = i.category_id

LEFT JOIN neighborhoods n
  ON n.id = i.neighborhood_id

WHERE li.list_id =
  'c3ffd340-5a18-4d90-a0d8-e0d3c3ac7514'::uuid

ORDER BY
  li.sort_order;
