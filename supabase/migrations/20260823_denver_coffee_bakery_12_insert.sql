-- CheckOff Denver Metro: 12 approved coffee and bakery additions
-- Generated 2026-08-23 using the production-verified Denver intake schema.
-- Landline Doughnuts & Coffee is intentionally excluded because its official
-- site says the business is closing August 25, 2026.
--
-- Items are active and approved. Metro association is provided through
-- neighborhood_id -> neighborhoods.metro_id; city_id remains NULL.
-- maps_query is populated, while all Google Places and GPS fields remain NULL.
-- business_status is intentionally omitted. No list memberships are created.
--
-- TAGGING: rewritten 2026-08-23 to match the "smart tagging" technique confirmed live
-- against production (docs/metro-launch-audit/17_pull_tag_vocabulary_for_smart_tagging.sql,
-- run read-only via `supabase db query --linked`) rather than the flat 3-tag/source='ai'/
-- confidence=1.0 pattern this file originally used. Confirmed via 9 real comparable
-- coffee/bakery/cafe items (e.g. 'Coyoacán's Bakery' in Phoenix): exactly 8 tags per item,
-- source='auto', two confidence tiers (5 tags @ 1.0, 3 tags @ 0.9). Every comparable item
-- also carried a metro-flavor tag (only-in-phoenix / only-in-tucson / only-in-milwaukee /
-- only-in-willcox) — NO only-in-denver tag exists in production yet, so that slot is
-- intentionally omitted here rather than invented; creating it would be a write, out of
-- scope for this pass. Flag to Jerry before running: do we want an only-in-denver tag
-- created (separately) and folded into these 12 items, or leave it out for now?

BEGIN;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.metro_areas
    WHERE id = 'b00f7f91-3176-48c5-aaf1-6ded7426f756'::uuid
      AND name = 'Denver Metro'
      AND slug = 'denver'
      AND state = 'CO'
      AND timezone = 'America/Denver'
  ) THEN
    RAISE EXCEPTION 'Denver Metro foundation row is missing or has changed';
  END IF;
END
$do$;

CREATE TEMP TABLE _denver_cafe_required_neighborhoods (
  name text PRIMARY KEY,
  id uuid UNIQUE NOT NULL
) ON COMMIT DROP;

INSERT INTO _denver_cafe_required_neighborhoods (name, id) VALUES
  ($co$Boulder$co$, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid),
  ($co$Lakewood$co$, '14e669ce-b5c1-4ffa-bd8b-b4817b459c85'::uuid),
  ($co$Longmont$co$, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid),
  ($co$Louisville / Superior$co$, '7b098c15-c258-43c9-953f-672c464be02b'::uuid),
  ($co$RiNo / Five Points$co$, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid),
  ($co$Washington Park / South Denver$co$, '5c3f138a-ad76-44e5-8e01-db680e948892'::uuid);

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM _denver_cafe_required_neighborhoods r
    LEFT JOIN public.neighborhoods n ON n.id = r.id
    WHERE n.id IS NULL
       OR n.name <> r.name
       OR n.metro_id <> 'b00f7f91-3176-48c5-aaf1-6ded7426f756'::uuid
       OR n.is_active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'One or more required Denver neighborhood rows are missing or changed';
  END IF;
END
$do$;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.categories
    WHERE id = 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid
      AND name = 'Food & drink'
  ) THEN
    RAISE EXCEPTION 'Required Food & drink category is missing or changed';
  END IF;
END
$do$;

CREATE TEMP TABLE _denver_cafe_required_tags (
  name text PRIMARY KEY,
  id uuid UNIQUE NOT NULL
) ON COMMIT DROP;

INSERT INTO _denver_cafe_required_tags (name, id) VALUES
  ($co$bakery$co$, 'e29afe91-4d24-4b0c-b058-5d956fc6c9ec'::uuid),
  ($co$coffee$co$, '76d1243a-49fe-44af-95b5-941bb5d9d703'::uuid),
  ($co$drinks$co$, 'b99611d1-98af-4df1-bb73-866fffb5f841'::uuid),
  ($co$food$co$, 'f11a6713-c60c-437c-98f8-e7f5ea16391c'::uuid),
  ($co$historic$co$, 'fa31d890-b349-48d9-b63d-b7fb93c72397'::uuid),
  ($co$local$co$, 'f81c806f-f884-49c2-b6fe-cbf6e375159e'::uuid),
  ($co$local-culture$co$, 'b1aed0e2-4760-4e93-8085-eb0048bd7e6c'::uuid),
  ($co$restaurant$co$, '1e87ec73-7a24-4fc9-be9f-4ab890d0f83e'::uuid),
  ($co$dessert$co$, '00d4a098-e0a5-449d-826f-8e717a04efe2'::uuid),
  ($co$coffee-shop$co$, '578908a3-ee6f-41be-98dc-56af7e4796b3'::uuid),
  ($co$specialty-drink$co$, 'b2da718f-1e34-4b4a-92d1-44eaa8cdf818'::uuid),
  ($co$cafe$co$, 'c8f08af1-dbd2-413e-9137-0bf97738bc92'::uuid),
  ($co$unique$co$, '4e40289b-5771-423d-9ecb-4fecffeb4787'::uuid),
  ($co$instagrammable$co$, '1f32683d-df5b-4616-ac2f-b810cd60d3f8'::uuid),
  ($co$hidden-gem$co$, 'dee183c9-622f-44f1-a099-9941fcae4847'::uuid),
  ($co$local-favorite$co$, '1c32fbe6-fcf0-4da9-ab7d-2bd6770fea54'::uuid),
  ($co$breakfast$co$, 'f0527445-abad-4e4c-9bd3-2cc655b18909'::uuid),
  ($co$snack$co$, '1c4c0732-9294-4a3b-92a0-a5fdce824533'::uuid);

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM _denver_cafe_required_tags r
    LEFT JOIN public.tags t ON t.id = r.id
    WHERE t.id IS NULL OR t.name <> r.name
  ) THEN
    RAISE EXCEPTION 'One or more required production tags are missing or changed';
  END IF;
END
$do$;

CREATE TEMP TABLE _denver_cafe_candidates (
  source_candidate_id text PRIMARY KEY,
  place text NOT NULL,
  body text NOT NULL,
  category_id uuid NOT NULL,
  neighborhood_id uuid NOT NULL,
  checkin_type text NOT NULL,
  website_url text,
  maps_query text NOT NULL,
  has_alcohol boolean NOT NULL,
  is_recurring boolean NOT NULL,
  -- Two confidence tiers matching the real "smart tagging" production pattern
  -- (confirmed via docs/metro-launch-audit/17_pull_tag_vocabulary_for_smart_tagging.sql):
  -- tier1 = confidence 1.0 (core/central to what the item is), tier2 = confidence 0.9
  -- (secondary/flavor descriptors). Always 5 + 3 = 8 tags per item, matching the exact
  -- split seen on the reference example ('Coyoacán's Bakery', Phoenix).
  tag_names_tier1 text[] NOT NULL,
  tag_names_tier2 text[] NOT NULL
) ON COMMIT DROP;

INSERT INTO _denver_cafe_candidates (
  source_candidate_id, place, body, category_id, neighborhood_id, checkin_type,
  website_url, maps_query, has_alcohol, is_recurring, tag_names_tier1, tag_names_tier2
) VALUES
  (
    $co$DEN-CAFE-001$co$,
    $co$Whittier Cafe$co$,
    $co$Watch coffee beans roasted, brewed in a clay jebena and served during the Sunday East African coffee ceremony at 'Whittier Cafe'$co$,
    'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid,
    'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid,
    $co$tap$co$,
    $co$https://whittiercafe.com/$co$,
    $co$Whittier Cafe, 1710 E 25th Ave, Denver, CO 80205$co$,
    false, true,
    ARRAY[$co$coffee$co$, $co$drinks$co$, $co$cafe$co$, $co$coffee-shop$co$, $co$local-culture$co$]::text[],
    ARRAY[$co$specialty-drink$co$, $co$unique$co$, $co$local$co$]::text[]
  ),
  (
    $co$DEN-CAFE-002$co$,
    $co$Tí Cafe$co$,
    $co$Top a phin-brewed Vietnamese iced coffee with an entire layer of flan at 'Tí Cafe'$co$,
    'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid,
    '5c3f138a-ad76-44e5-8e01-db680e948892'::uuid,
    $co$tap$co$,
    $co$https://www.ti.cafe/$co$,
    $co$Tí Cafe, 30 N Broadway, Denver, CO 80203$co$,
    false, false,
    ARRAY[$co$coffee$co$, $co$drinks$co$, $co$cafe$co$, $co$coffee-shop$co$, $co$specialty-drink$co$]::text[],
    ARRAY[$co$local-culture$co$, $co$dessert$co$, $co$unique$co$]::text[]
  ),
  (
    $co$DEN-CAFE-003$co$,
    $co$Coffee Sarap$co$,
    $co$Taste ube and pandan together in the original 'Palawan Dreams' latte at 'Coffee Sarap'$co$,
    'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid,
    'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid,
    $co$tap$co$,
    $co$https://www.coffeesarap.com/$co$,
    $co$Coffee Sarap, 3460 Larimer St, Denver, CO 80205$co$,
    false, false,
    ARRAY[$co$coffee$co$, $co$drinks$co$, $co$cafe$co$, $co$coffee-shop$co$, $co$specialty-drink$co$]::text[],
    ARRAY[$co$local-culture$co$, $co$unique$co$, $co$instagrammable$co$]::text[]
  ),
  (
    $co$DEN-CAFE-004$co$,
    $co$Reunion Bakery$co$,
    $co$Crack into a caramelized Portuguese 'pastel de nata' baked in the open kitchen at 'Reunion Bakery'$co$,
    'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid,
    '5c3f138a-ad76-44e5-8e01-db680e948892'::uuid,
    $co$tap$co$,
    $co$https://reunionbread.square.site/$co$,
    $co$Reunion Bakery, 1240 S Pearl St, Denver, CO 80210$co$,
    false, false,
    ARRAY[$co$bakery$co$, $co$food$co$, $co$dessert$co$, $co$local-culture$co$, $co$breakfast$co$]::text[],
    ARRAY[$co$unique$co$, $co$cafe$co$, $co$snack$co$]::text[]
  ),
  (
    $co$DEN-CAFE-005$co$,
    $co$Tokyo Premium Bakery$co$,
    $co$Preorder a Japanese shokupan loaf and choose exactly how thick it is sliced at 'Tokyo Premium Bakery'$co$,
    'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid,
    '5c3f138a-ad76-44e5-8e01-db680e948892'::uuid,
    $co$tap$co$,
    $co$https://tokyopremiumbakery.com/$co$,
    $co$Tokyo Premium Bakery, 1540 S Pearl St, Denver, CO 80210$co$,
    false, false,
    ARRAY[$co$bakery$co$, $co$food$co$, $co$local-culture$co$, $co$unique$co$, $co$breakfast$co$]::text[],
    ARRAY[$co$dessert$co$, $co$snack$co$, $co$hidden-gem$co$]::text[]
  ),
  (
    $co$DEN-CAFE-006$co$,
    $co$Black Box Bakery$co$,
    $co$Bite through the red-striped croissant into strawberry-yogurt crémeux in the 'Strawberry Milk' at 'Black Box Bakery'$co$,
    'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid,
    '14e669ce-b5c1-4ffa-bd8b-b4817b459c85'::uuid,
    $co$tap$co$,
    $co$https://www.blackboxbakery.com/$co$,
    $co$Black Box Bakery, 5505 W 20th Ave, Unit 182, Edgewater, CO 80214$co$,
    false, false,
    ARRAY[$co$bakery$co$, $co$food$co$, $co$dessert$co$, $co$unique$co$, $co$instagrammable$co$]::text[],
    ARRAY[$co$local$co$, $co$breakfast$co$, $co$snack$co$]::text[]
  ),
  (
    $co$DEN-CAFE-007$co$,
    $co$Maison Shelby$co$,
    $co$Cut open a fruit-shaped trompe-l'œil pastry and reveal its real-fruit center at 'Maison Shelby'$co$,
    'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid,
    '5c3f138a-ad76-44e5-8e01-db680e948892'::uuid,
    $co$tap$co$,
    $co$https://maisonshelby.com/$co$,
    $co$Maison Shelby, 2120 S Broadway, Denver, CO 80210$co$,
    false, false,
    ARRAY[$co$bakery$co$, $co$food$co$, $co$dessert$co$, $co$unique$co$, $co$instagrammable$co$]::text[],
    ARRAY[$co$restaurant$co$, $co$local$co$, $co$snack$co$]::text[]
  ),
  (
    $co$DEN-CAFE-008$co$,
    $co$Süti & Co.$co$,
    $co$Taste every named shortbread in the 'Itty Bitty Sampler Pack' at 'Süti & Co.'$co$,
    'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid,
    'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid,
    $co$tap$co$,
    $co$https://www.sutiandco.com/$co$,
    $co$Süti & Co., 2031 16th St, Boulder, CO 80302$co$,
    false, false,
    ARRAY[$co$bakery$co$, $co$food$co$, $co$dessert$co$, $co$local$co$, $co$unique$co$]::text[],
    ARRAY[$co$snack$co$, $co$hidden-gem$co$, $co$breakfast$co$]::text[]
  ),
  (
    $co$DEN-CAFE-009$co$,
    $co$Moxie Bread Co.$co$,
    $co$Tear into a long-fermented loaf made with heirloom grain milled by 'Moxie Bread Co.'$co$,
    'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid,
    '7b098c15-c258-43c9-953f-672c464be02b'::uuid,
    $co$tap$co$,
    $co$https://www.moxiebreadco.com/$co$,
    $co$Moxie Bread Co., 641 Main St, Louisville, CO 80027$co$,
    false, false,
    ARRAY[$co$bakery$co$, $co$food$co$, $co$local$co$, $co$unique$co$, $co$local-favorite$co$]::text[],
    ARRAY[$co$breakfast$co$, $co$snack$co$, $co$hidden-gem$co$]::text[]
  ),
  (
    $co$DEN-CAFE-010$co$,
    $co$Taste of Denmark$co$,
    $co$Pull apart a flaky slice of almond kringle from 'Taste of Denmark'$co$,
    'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid,
    '14e669ce-b5c1-4ffa-bd8b-b4817b459c85'::uuid,
    $co$tap$co$,
    $co$https://tasteofdenmarkco.com/$co$,
    $co$Taste of Denmark, 1901 S Kipling St, Lakewood, CO 80227$co$,
    false, false,
    ARRAY[$co$bakery$co$, $co$food$co$, $co$dessert$co$, $co$local-culture$co$, $co$local$co$]::text[],
    ARRAY[$co$unique$co$, $co$snack$co$, $co$breakfast$co$]::text[]
  ),
  (
    $co$DEN-CAFE-011$co$,
    $co$Juniper Goods$co$,
    $co$Follow an espresso with a crafted zero-proof cocktail while browsing Colorado-made goods at 'Juniper Goods'$co$,
    'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid,
    '018da150-6ebf-43f3-8eb1-e37338310738'::uuid,
    $co$tap$co$,
    $co$https://junipergoods.co/$co$,
    $co$Juniper Goods, 659 4th Ave, Longmont, CO 80501$co$,
    false, false,
    ARRAY[$co$coffee$co$, $co$drinks$co$, $co$cafe$co$, $co$coffee-shop$co$, $co$local$co$]::text[],
    ARRAY[$co$specialty-drink$co$, $co$unique$co$, $co$local-favorite$co$]::text[]
  ),
  (
    $co$DEN-CAFE-012$co$,
    $co$JavaStop$co$,
    $co$Drink black iced coffee over coffee ice cubes inside Longmont's oldest café at 'JavaStop'$co$,
    'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid,
    '018da150-6ebf-43f3-8eb1-e37338310738'::uuid,
    $co$tap$co$,
    $co$https://www.javastop.cafe/$co$,
    $co$JavaStop, 301 Main St, Unit 7, Longmont, CO 80501$co$,
    false, false,
    ARRAY[$co$coffee$co$, $co$drinks$co$, $co$cafe$co$, $co$coffee-shop$co$, $co$historic$co$]::text[],
    ARRAY[$co$specialty-drink$co$, $co$local-favorite$co$, $co$local$co$]::text[]
  );

DO $do$
DECLARE
  candidate_count integer;
BEGIN
  SELECT count(*) INTO candidate_count FROM _denver_cafe_candidates;
  IF candidate_count <> 12 THEN
    RAISE EXCEPTION 'Expected 12 coffee and bakery candidates; staged %', candidate_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM _denver_cafe_candidates
    WHERE btrim(maps_query) = ''
       OR cardinality(tag_names_tier1) <> 5
       OR cardinality(tag_names_tier2) <> 3
       OR cardinality(ARRAY(SELECT DISTINCT unnest(tag_names_tier1 || tag_names_tier2))) <> 8
  ) THEN
    RAISE EXCEPTION 'Every candidate must have a maps_query and exactly 8 distinct tags (5 tier1 + 3 tier2)';
  END IF;
  IF EXISTS (
    SELECT lower(regexp_replace(btrim(maps_query), '[^a-z0-9]+', '', 'g'))
    FROM _denver_cafe_candidates
    GROUP BY 1 HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate normalized maps_query values exist in this batch';
  END IF;
END
$do$;

CREATE TEMP TABLE _denver_cafe_preexisting_matches ON COMMIT DROP AS
SELECT c.source_candidate_id, i.id AS existing_item_id
FROM _denver_cafe_candidates c
JOIN public.items i
  ON lower(regexp_replace(btrim(i.maps_query), '[^a-z0-9]+', '', 'g'))
   = lower(regexp_replace(btrim(c.maps_query), '[^a-z0-9]+', '', 'g'));

DO $do$
BEGIN
  IF EXISTS (
    SELECT source_candidate_id
    FROM _denver_cafe_preexisting_matches
    GROUP BY source_candidate_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A candidate matches multiple production items; manual duplicate review required';
  END IF;
END
$do$;

CREATE TEMP TABLE _denver_cafe_new_items (
  item_id uuid PRIMARY KEY,
  source_candidate_id text UNIQUE NOT NULL
) ON COMMIT DROP;

WITH inserted AS (
  INSERT INTO public.items (
    body, category_id, city_id, partner_id, checkin_type, geo_location,
    geo_radius_m, is_universal, is_active, submitted_by, is_approved,
    neighborhood_id, ring_weight, season_tag, is_recurring, active_from,
    active_until, website_url, maps_query, maps_lat, maps_lng, has_alcohol,
    difficulty, photo_required, is_secret, secret_reveal_text,
    partner_edited_at, allows_personal_note, personal_prompt_label,
    personal_place_label, is_insider_drop, insider_drop_requires_points,
    insider_drop_requires_status, insider_drop_teaser_text,
    google_place_id, formatted_address
  )
  SELECT
    c.body, c.category_id, NULL, NULL, c.checkin_type, NULL,
    150, false, true, NULL, true,
    c.neighborhood_id, 0, NULL, c.is_recurring, NULL,
    NULL, c.website_url, c.maps_query, NULL, NULL, c.has_alcohol,
    1, false, false, NULL,
    NULL, false, NULL,
    NULL, false, NULL,
    NULL, NULL,
    NULL, NULL
  FROM _denver_cafe_candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM _denver_cafe_preexisting_matches p
    WHERE p.source_candidate_id = c.source_candidate_id
  )
  RETURNING id, body, maps_query, neighborhood_id
)
INSERT INTO _denver_cafe_new_items (item_id, source_candidate_id)
SELECT i.id, c.source_candidate_id
FROM inserted i
JOIN _denver_cafe_candidates c
  ON c.body = i.body
 AND c.maps_query = i.maps_query
 AND c.neighborhood_id = i.neighborhood_id;

CREATE TEMP TABLE _denver_cafe_batch_items ON COMMIT DROP AS
SELECT c.source_candidate_id, i.id AS item_id
FROM _denver_cafe_candidates c
JOIN public.items i
  ON lower(regexp_replace(btrim(i.maps_query), '[^a-z0-9]+', '', 'g'))
   = lower(regexp_replace(btrim(c.maps_query), '[^a-z0-9]+', '', 'g'));

-- Smart-tagging technique confirmed live against production (see file header note):
-- source='auto', tier1 tags @ confidence 1.0, tier2 tags @ confidence 0.9.
INSERT INTO public.item_tags (item_id, tag_id, source, confidence)
SELECT b.item_id, t.id, 'auto', 1.0
FROM _denver_cafe_batch_items b
JOIN _denver_cafe_candidates c USING (source_candidate_id)
CROSS JOIN LATERAL unnest(c.tag_names_tier1) AS chosen(tag_name)
JOIN public.tags t ON t.name = chosen.tag_name
ON CONFLICT (item_id, tag_id) DO NOTHING;

INSERT INTO public.item_tags (item_id, tag_id, source, confidence)
SELECT b.item_id, t.id, 'auto', 0.9
FROM _denver_cafe_batch_items b
JOIN _denver_cafe_candidates c USING (source_candidate_id)
CROSS JOIN LATERAL unnest(c.tag_names_tier2) AS chosen(tag_name)
JOIN public.tags t ON t.name = chosen.tag_name
ON CONFLICT (item_id, tag_id) DO NOTHING;

DO $do$
BEGIN
  IF (SELECT count(*) FROM _denver_cafe_batch_items) <> 12
     OR (SELECT count(DISTINCT item_id) FROM _denver_cafe_batch_items) <> 12 THEN
    RAISE EXCEPTION 'Batch reconciliation failed: expected 12 distinct items after insert';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _denver_cafe_batch_items b
    JOIN public.items i ON i.id = b.item_id
    WHERE i.is_active IS DISTINCT FROM true
       OR i.is_approved IS DISTINCT FROM true
       OR i.is_universal IS DISTINCT FROM false
       OR i.city_id IS NOT NULL
       OR i.season_tag IS NOT NULL
       OR i.difficulty <> 1
       OR i.geo_radius_m <> 150
       OR i.photo_required IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'One or more coffee and bakery items violate locked intake values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _denver_cafe_new_items n
    JOIN public.items i ON i.id = n.item_id
    WHERE i.maps_lat IS NOT NULL
       OR i.maps_lng IS NOT NULL
       OR i.geo_location IS NOT NULL
       OR i.google_place_id IS NOT NULL
       OR i.formatted_address IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A newly inserted item unexpectedly contains Google Places data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _denver_cafe_batch_items b
    JOIN _denver_cafe_candidates c USING (source_candidate_id)
    CROSS JOIN LATERAL unnest(c.tag_names_tier1 || c.tag_names_tier2) AS chosen(tag_name)
    JOIN public.tags t ON t.name = chosen.tag_name
    LEFT JOIN public.item_tags it
      ON it.item_id = b.item_id AND it.tag_id = t.id
    WHERE it.item_id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more coffee and bakery items are missing required tags';
  END IF;

  IF EXISTS (
    SELECT b.item_id
    FROM _denver_cafe_batch_items b
    JOIN public.item_tags it ON it.item_id = b.item_id
    GROUP BY b.item_id
    HAVING count(*) <> 8
       OR count(*) FILTER (WHERE it.confidence = 1.0 AND it.source = 'auto') <> 5
       OR count(*) FILTER (WHERE it.confidence = 0.9 AND it.source = 'auto') <> 3
  ) THEN
    RAISE EXCEPTION 'One or more items do not have exactly 8 tags in the expected 5@1.0/3@0.9 smart-tagging split';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.list_items li
    JOIN _denver_cafe_new_items n ON n.item_id = li.item_id
  ) THEN
    RAISE EXCEPTION 'Unexpected official-list membership found for a newly inserted item';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.curated_list_items cli
    JOIN _denver_cafe_new_items n ON n.item_id = cli.item_id
  ) THEN
    RAISE EXCEPTION 'Unexpected curated-list membership found for a newly inserted item';
  END IF;
END
$do$;

SELECT
  12 AS staged_candidates,
  (SELECT count(*) FROM _denver_cafe_new_items) AS inserted_now,
  (SELECT count(*) FROM _denver_cafe_preexisting_matches) AS skipped_as_existing;

SELECT
  b.source_candidate_id,
  i.id,
  i.body,
  n.name AS neighborhood,
  n.metro_id,
  i.city_id,
  i.maps_query,
  i.is_active,
  i.is_approved,
  i.is_recurring,
  i.maps_lat,
  i.maps_lng,
  i.geo_location,
  i.google_place_id,
  i.formatted_address,
  count(DISTINCT it.tag_id) AS tag_count,
  count(DISTINCT li.id) AS official_list_count,
  count(DISTINCT cli.id) AS curated_list_count
FROM _denver_cafe_batch_items b
JOIN public.items i ON i.id = b.item_id
JOIN public.neighborhoods n ON n.id = i.neighborhood_id
LEFT JOIN public.item_tags it ON it.item_id = i.id
LEFT JOIN public.list_items li ON li.item_id = i.id
LEFT JOIN public.curated_list_items cli ON cli.item_id = i.id
GROUP BY b.source_candidate_id, i.id, i.body, n.name, n.metro_id,
         i.city_id, i.maps_query, i.is_active, i.is_approved,
         i.is_recurring, i.maps_lat, i.maps_lng, i.geo_location,
         i.google_place_id, i.formatted_address
ORDER BY b.source_candidate_id;

COMMIT;
