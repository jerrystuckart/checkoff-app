-- CheckOff Denver Metro: 3 new Themed Lists (public.lists, is_official=true)
-- Generated 2026-08-24, review-only — NOT YET RUN.
--
-- Hidden Bars, Second Date Material, Ferda Girls — the same is_official=true /
-- public.lists pattern already confirmed for Tucson's "Foodies of Tucson"/"Dark
-- Skies" and Milwaukee's "Wisconsin Weird". Distinct from public.curated_lists
-- (Hoptimists/Trail Mix Crew/Pearl Street Regulars), which are intentionally left
-- untouched — this is a deliberate duplication, not a migration off curated_lists.
-- These 3 render in the Home Screen's officialLists-driven "Themed Lists" rail
-- (screens/HomeScreen.jsx ~line 316) as fixed, locked lists with "0 of N" progress.
--
-- All 44 items (13 + 12 + 19, zero overlap between these 3 lists) were resolved
-- from exact body-text match against production, confirmed is_active=true, and
-- their real ids are hardcoded below. A defensive preflight re-verifies each one
-- still exists/is active/matches its expected body before writing anything, in
-- case anything changes between this review and Jerry actually running it.
--
-- Dates: starts_at = 2026-08-25 (tomorrow, per Jerry — testing before public
-- launch, no users on Denver yet so no risk). ends_at = 2026-11-30, matching
-- Denver Fall 2026's own end date, consistent with the confirmed cross-metro
-- convention that themed lists share their season's exact end date with the
-- seasonal hero list.
-- hero_image_url intentionally left NULL — set later via the admin tool once
-- Creative delivers real images.
--
-- Cross-list/cross-list-type item overlap (e.g. Williams & Graham already being
-- in Hoptimists) is expected and fine — list_items rows are per-list.

BEGIN;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.metro_areas
    WHERE id = 'b00f7f91-3176-48c5-aaf1-6ded7426f756'::uuid
      AND name = 'Denver Metro' AND slug = 'denver' AND state = 'CO'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Denver Metro foundation row is missing or has changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = '11275026-65be-4421-80a4-46c57195408b'::uuid
      AND email = 'jerrystuckart@hotmail.com' AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin creator_id foundation row is missing or has changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.lists
    WHERE metro_id = 'b00f7f91-3176-48c5-aaf1-6ded7426f756'::uuid
      AND title IN ('Hidden Bars', 'Second Date Material', 'Ferda Girls')
  ) THEN
    RAISE EXCEPTION 'A list with one of these 3 titles already exists for Denver — this is a fresh creation, not an update';
  END IF;
END
$do$;

CREATE TEMP TABLE _themed_list_shells (
  list_key text PRIMARY KEY,
  id uuid NOT NULL,
  title text NOT NULL,
  cover_emoji text NOT NULL
) ON COMMIT DROP;

INSERT INTO _themed_list_shells (list_key, id, title, cover_emoji) VALUES
  ($co$hidden_bars$co$,   '2b48fcfd-fd58-4557-8d75-a42a5741966d'::uuid, $co$Hidden Bars$co$,            $co$🔑$co$),
  ($co$second_date$co$,   '02815f0d-39db-4ad2-b9cd-6f3351c2bf5b'::uuid, $co$Second Date Material$co$,   $co$💫$co$),
  ($co$ferda_girls$co$,   'af7782fd-a401-4144-8ed1-5f4a4095ea18'::uuid, $co$Ferda Girls$co$,             $co$💅$co$);

CREATE TEMP TABLE _themed_list_items (
  list_key text NOT NULL,
  sort_order integer NOT NULL,
  item_id uuid NOT NULL,
  expected_body text NOT NULL,
  PRIMARY KEY (list_key, sort_order)
) ON COMMIT DROP;

INSERT INTO _themed_list_items (list_key, sort_order, item_id, expected_body) VALUES
  -- Hidden Bars (13)
  ($co$hidden_bars$co$, 0,  'a9f89ed6-0572-45eb-953e-e08793448b11'::uuid, $co$Ignore the 'Staff Only' door inside 'Spirits Wine Provisions' and ask for a personalized cocktail at 'The Stockroom'$co$),
  ($co$hidden_bars$co$, 1,  '3e68bd64-2c56-4d6a-beaf-50801df26be9'::uuid, $co$Flip the switch beside the freezer door behind 'Sweet Action Ice Cream' and step into 'Retrograde' for a cosmic cocktail$co$),
  ($co$hidden_bars$co$, 2,  'fcba198c-f35c-4c44-9af1-73a31971dff2'::uuid, $co$Find the gold doorbell and enter the hidden bar at 'B&GC'$co$),
  ($co$hidden_bars$co$, 3,  '93da5d23-200f-40dd-a00f-d0b37716a43a'::uuid, $co$Answer the African-culture question for a QR entry pass, then order the sugarcane 'Kango Kane' at 'Trybal African Speakeasy'$co$),
  ($co$hidden_bars$co$, 4,  'cf7ce51f-f03f-4631-a7c9-4669afc9f20f'::uuid, $co$Step behind the bookcase for a monthly speakeasy night at '24 Carrot Bistro'$co$),
  ($co$hidden_bars$co$, 5,  '113c6f23-f9d3-4d5a-959c-b3de2117990c'::uuid, $co$Go underground in downtown Golden, call your shot and win a game of pool at 'The Down Low'$co$),
  ($co$hidden_bars$co$, 6,  'dbfd0fa2-3d49-4d77-bddd-77d3aa8557aa'::uuid, $co$Descend into 'The Devil’s Drink,' order the tiramisu 'Duncan Hills' espresso martini and play a rack of pool underground$co$),
  ($co$hidden_bars$co$, 7,  'd5a60c98-2e53-49ef-aafa-4516f37f157d'::uuid, $co$Enter through the bookcase and order a cocktail at 'Williams & Graham'$co$),
  ($co$hidden_bars$co$, 8,  '29ae293d-d701-4c5f-a4e2-eac0c1313e71'::uuid, $co$Confess your sins inside the confessional-inspired 'Agua Bendita' and order the mezcal 'Bandito'$co$),
  ($co$hidden_bars$co$, 9,  'b782103f-0a63-414e-a699-a315c4c37fab'::uuid, $co$Descend below Larimer Square and order the rum-and-rice-milk 'Clarified Horchata' in the dark tropical hideaway at 'Emerald Eye'$co$),
  ($co$hidden_bars$co$, 10, '9cb5fc22-dfe1-451d-9fb6-a4ffd220423a'::uuid, $co$Find the unmarked basement entrance inside the IceHouse, bring cash and spend one Lincoln on a drink at 'Lincoln’s'$co$),
  ($co$hidden_bars$co$, 11, '1f913c9f-0cf1-47df-ab9b-6d68fe3f8944'::uuid, $co$Descend beneath Main Street and play a note on the white baby grand inside 'The Speakeasy’s' hidden Shotgun Room$co$),
  ($co$hidden_bars$co$, 12, '2a739478-8fcd-4fdd-8300-bc355aff3758'::uuid, $co$Slip through 'The Simon’s' South Street back door, descend into 'Nora’s Speakeasy' and order one of 'Nora’s Takes' on a classic cocktail$co$),

  -- Second Date Material (12)
  ($co$second_date$co$, 0,  'd7687915-0750-4ea1-a57a-876a969173d8'::uuid, $co$Have tea beneath the hand painted ceiling at 'Boulder Dushanbe Teahouse'$co$),
  ($co$second_date$co$, 1,  '1a1ea071-5b80-4b48-8081-24a55d2796c0'::uuid, $co$Have afternoon tea beneath the stained glass atrium at 'The Brown Palace Hotel and Spa'$co$),
  ($co$second_date$co$, 2,  '36911e65-55e4-4e9c-a3e4-b1b04fb8c5cc'::uuid, $co$Pair a live jazz set with the five-course 'Ellington Experience' beneath the Art Deco staircase at 'Nocturne'$co$),
  ($co$second_date$co$, 3,  'de219490-ef35-4746-9132-5a5e1fef70d5'::uuid, $co$Pair food from two vendors with the skyline view at 'Avanti Food and Beverage Denver'$co$),
  ($co$second_date$co$, 4,  '7f61f150-1e39-493d-bed3-9f39960342a8'::uuid, $co$Catch a Front Range sunset at 'Lost Gulch Overlook'$co$),
  ($co$second_date$co$, 5,  '2cd5dab3-ac6b-4730-8d08-dfae0f0ad66f'::uuid, $co$See a dome show at 'Fiske Planetarium'$co$),
  ($co$second_date$co$, 6,  '5eb9abca-a4d2-455d-8644-28782f3ca3c1'::uuid, $co$See the current exhibition at 'Boulder Museum of Contemporary Art'$co$),
  ($co$second_date$co$, 7,  '1e45bdc6-fb66-4236-8a2d-c96d86b52949'::uuid, $co$Descend beneath 'Hotel Boulderado' and raise a cocktail under Boulder’s original 1969 liquor license at 'License No. 1'$co$),
  ($co$second_date$co$, 8,  '13772396-c850-44b2-a008-465013e49efb'::uuid, $co$End the current exhibition with a craft cocktail on the rooftop at 'Museum of Contemporary Art Denver'$co$),
  ($co$second_date$co$, 9,  '14683011-33a7-4bcb-9508-563548d2ff73'::uuid, $co$Walk beneath the lights at 'Larimer Square' after dark$co$),
  ($co$second_date$co$, 10, 'd1e1d2aa-7f1f-433f-9a0f-3a460ad50063'::uuid, $co$Play a board game beside the firepits on the graffiti-lined patio at 'Improper City'$co$),
  ($co$second_date$co$, 11, '36c87d34-8c14-4236-b7d9-da32d2e65b06'::uuid, $co$Pair a used book browse with a coffee at 'Trident Booksellers and Cafe'$co$),

  -- Ferda Girls (19) — 10 Spa & self-care, then 9 Shopping
  ($co$ferda_girls$co$, 0,  'd228dd53-81ce-4cea-98e1-893498c1a933'::uuid, $co$Rotate through the cedar sauna, cold plunge, salt room and forest showers at 'The Dragontree'$co$),
  ($co$ferda_girls$co$, 1,  '66b2a04f-c549-483e-b27c-b9dbbc1c6f8b'::uuid, $co$Alternate between the cedar sauna and cold plunge at Denver’s 1927 'Lake Steam Baths'$co$),
  ($co$ferda_girls$co$, 2,  '874902d5-57ac-4256-9b6a-f8ce356164a8'::uuid, $co$Complete the sauna, cold-plunge, warm-soak and steam circuit at 'ROK SPAS'$co$),
  ($co$ferda_girls$co$, 3,  '8761130b-3276-452e-9bdb-d2b98a7d0aaf'::uuid, $co$Cycle between a wood fired sauna and cold plunge on the farm at 'Puffin Sauna Club'$co$),
  ($co$ferda_girls$co$, 4,  '0b9e30b6-bf9e-438c-9e5e-bed88d02bf62'::uuid, $co$Step into the whole body cryotherapy chamber at 'Fire & Ice Wellness'$co$),
  ($co$ferda_girls$co$, 5,  '70024913-9352-4e78-9588-1f5db9f3556e'::uuid, $co$Complete the infrared-sauna, cold-shower and hops-and-barley bath circuit at 'Oakwell Beer Spa'$co$),
  ($co$ferda_girls$co$, 6,  '04283aa4-d1bb-4e0a-ba81-66945744c8d3'::uuid, $co$Float without light or sound, then journal over tea at 'Samana Float Center'$co$),
  ($co$ferda_girls$co$, 7,  'df29daec-c1f8-4e2d-a25a-ec9accf3dfb4'::uuid, $co$Lie back for a session inside the 13,000 pound Himalayan salt cave at '5 Star Salt Caves'$co$),
  ($co$ferda_girls$co$, 8,  '3b5e6e5d-5a2d-40fa-ad26-66549225cd4a'::uuid, $co$Receive a continuous stream of warm herbal oil across your forehead during Shirodhara at 'The Soma Spa'$co$),
  ($co$ferda_girls$co$, 9,  'ba0b2607-8997-4794-a626-bc06dbe99818'::uuid, $co$Try the warm water halo during a Restorative HeadSpa service at 'HeadSpa Denver'$co$),
  ($co$ferda_girls$co$, 10, '8de52f68-de41-4805-8d1c-0f92535ef5a8'::uuid, $co$Find an 8 track, a cassette and a LaserDisc under one roof at 'Black & Read'$co$),
  ($co$ferda_girls$co$, 11, 'b20a5f15-c882-4265-b11d-f88847d85ba3'::uuid, $co$Choose one bone, pinned insect or botanical oddity at 'The Terrorium Shop'$co$),
  ($co$ferda_girls$co$, 12, 'ae92eeee-53b1-4c38-bc4e-2982d377715d'::uuid, $co$Choose between a traditional kite and a stunt kite at 'Into The Wind'$co$),
  ($co$ferda_girls$co$, 13, '12dc90d6-07ed-4f82-834e-3d3c77c0ccfd'::uuid, $co$Find the strangest kitchen gadget you can explain how to use at 'Peppercorn'$co$),
  ($co$ferda_girls$co$, 14, '1c912bbd-3aa8-4fef-b436-5dcadd697074'::uuid, $co$Follow the stairs through every level and choose one bookseller recommendation at 'Boulder Book Store'$co$),
  ($co$ferda_girls$co$, 15, '64384fe6-f99a-4656-b844-5368d01dcdaa'::uuid, $co$Enter the castle and choose one beginner magic trick to learn at 'The Wizard’s Chest'$co$),
  ($co$ferda_girls$co$, 16, 'b5bf6355-d244-43f2-afe9-3f89e8c3a3b7'::uuid, $co$Rescue one secondhand art supply for your next project at 'ReCreative Denver'$co$),
  ($co$ferda_girls$co$, 17, 'c091afbf-eb98-4a2e-98a9-29cc975d3ccc'::uuid, $co$Adopt a rehabilitated plant during the Sunday Rescue Plant Pop Up at 'The Golden Bee'$co$),
  ($co$ferda_girls$co$, 18, 'b30dee4b-51c1-4a3f-93e6-5406e9b42735'::uuid, $co$Find one toy or trading card from your childhood inside the 1980s time capsule at 'Fifty-Two 80’s'$co$);

DO $do$
DECLARE
  shell_count integer;
  item_count integer;
BEGIN
  SELECT count(*) INTO shell_count FROM _themed_list_shells;
  IF shell_count <> 3 THEN
    RAISE EXCEPTION 'Expected 3 list shells; staged %', shell_count;
  END IF;

  SELECT count(*) INTO item_count FROM _themed_list_items;
  IF item_count <> 44 THEN
    RAISE EXCEPTION 'Expected 44 staged list_items rows (13+12+19); staged %', item_count;
  END IF;

  IF (SELECT count(DISTINCT item_id) FROM _themed_list_items) <> 44 THEN
    RAISE EXCEPTION 'Staged item_ids are not all distinct across the 3 new lists';
  END IF;

  -- Defensive re-verification: every staged item id must still exist, be
  -- active, and its live body must still match what was resolved during
  -- review — catches drift if anything changed between review and this run.
  IF EXISTS (
    SELECT 1
    FROM _themed_list_items t
    LEFT JOIN public.items i ON i.id = t.item_id
    WHERE i.id IS NULL
       OR i.is_active IS DISTINCT FROM true
       OR replace(replace(i.body, '’', ''''), '‘', '''')
        <> replace(replace(t.expected_body, '’', ''''), '‘', '''')
  ) THEN
    RAISE EXCEPTION 'One or more staged items no longer exist, are inactive, or have a changed body — aborting rather than writing stale data';
  END IF;

  -- Per-list count and contiguous 0-indexed sort_order check.
  IF EXISTS (
    SELECT list_key
    FROM _themed_list_items
    GROUP BY list_key
    HAVING count(*) <> max(sort_order) + 1
  ) THEN
    RAISE EXCEPTION 'One or more lists have non-contiguous sort_order values';
  END IF;

  IF (SELECT count(*) FROM _themed_list_items WHERE list_key = 'hidden_bars') <> 13 THEN
    RAISE EXCEPTION 'Hidden Bars must have exactly 13 items';
  END IF;
  IF (SELECT count(*) FROM _themed_list_items WHERE list_key = 'second_date') <> 12 THEN
    RAISE EXCEPTION 'Second Date Material must have exactly 12 items';
  END IF;
  IF (SELECT count(*) FROM _themed_list_items WHERE list_key = 'ferda_girls') <> 19 THEN
    RAISE EXCEPTION 'Ferda Girls must have exactly 19 items';
  END IF;
END
$do$;

INSERT INTO public.lists (
  id, creator_id, title, metro_id, starts_at, ends_at,
  is_public, is_official, cover_emoji, hero_image_url
)
SELECT
  s.id, '11275026-65be-4421-80a4-46c57195408b'::uuid, s.title,
  'b00f7f91-3176-48c5-aaf1-6ded7426f756'::uuid,
  DATE '2026-08-25', DATE '2026-11-30',
  true, true, s.cover_emoji, NULL
FROM _themed_list_shells s;

INSERT INTO public.list_items (list_id, item_id, sort_order)
SELECT s.id, t.item_id, t.sort_order
FROM _themed_list_items t
JOIN _themed_list_shells s ON s.list_key = t.list_key;

DO $do$
BEGIN
  IF (SELECT count(*) FROM public.lists WHERE id IN (SELECT id FROM _themed_list_shells)) <> 3 THEN
    RAISE EXCEPTION 'List shell insert reconciliation failed: expected 3 rows';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.lists l
    JOIN _themed_list_shells s ON s.id = l.id
    WHERE l.is_official IS DISTINCT FROM true
       OR l.is_public IS DISTINCT FROM true
       OR l.metro_id <> 'b00f7f91-3176-48c5-aaf1-6ded7426f756'::uuid
       OR l.starts_at IS DISTINCT FROM DATE '2026-08-25'
       OR l.ends_at IS DISTINCT FROM DATE '2026-11-30'
       OR l.creator_id <> '11275026-65be-4421-80a4-46c57195408b'::uuid
  ) THEN
    RAISE EXCEPTION 'One or more new list shells violate locked intake values';
  END IF;

  IF EXISTS (
    SELECT s.list_key
    FROM _themed_list_shells s
    JOIN public.list_items li ON li.list_id = s.id
    GROUP BY s.list_key
    HAVING count(*) <> (SELECT count(*) FROM _themed_list_items t WHERE t.list_key = s.list_key)
  ) THEN
    RAISE EXCEPTION 'One or more lists do not have the expected number of list_items rows after insert';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.list_items li
    JOIN _themed_list_shells s ON s.id = li.list_id
    GROUP BY li.list_id
    HAVING count(DISTINCT li.item_id) <> count(*)
  ) THEN
    RAISE EXCEPTION 'Duplicate item_id found within a single new list';
  END IF;
END
$do$;

-- Read-only verification output.
SELECT s.list_key, l.id, l.title, l.cover_emoji, l.starts_at, l.ends_at,
       l.is_official, l.is_public, l.metro_id,
       count(li.id) AS item_count
FROM _themed_list_shells s
JOIN public.lists l ON l.id = s.id
LEFT JOIN public.list_items li ON li.list_id = l.id
GROUP BY s.list_key, l.id, l.title, l.cover_emoji, l.starts_at, l.ends_at,
         l.is_official, l.is_public, l.metro_id
ORDER BY s.list_key;

SELECT s.list_key, li.sort_order, i.body, i.is_active
FROM _themed_list_shells s
JOIN public.list_items li ON li.list_id = s.id
JOIN public.items i ON i.id = li.item_id
ORDER BY s.list_key, li.sort_order;

COMMIT;
