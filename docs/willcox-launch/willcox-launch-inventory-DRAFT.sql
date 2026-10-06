-- =============================================================================
-- WILLCOX LAUNCH INVENTORY: DRAFT SQL.  *** DO NOT EXECUTE WITHOUT JERRY'S APPROVAL ***
-- Generated 2026-10-05 from Willcox_Chamber_Review_Draft_2026-09-01.xlsx (66 candidates)
-- reconciled against production (see willcox-reconciliation.md / .csv).
--
-- Safety: the whole file runs inside a transaction that ENDS WITH ROLLBACK. Nothing persists
-- unless you deliberately change the last line to COMMIT after review.
--
-- Rules followed: place names in literal single quotes; is_recurring = true; difficulty only
-- 1/5/10/25; no invented coordinates, Google Place IDs, addresses or websites; no new
-- categories/tags (categories are looked up by existing name; tags are NOT assigned here);
-- nothing is added to themed/seasonal lists automatically.
--
-- Everything inserted is is_active=false and is_approved=false. maps_query is only a
-- name search string ("<Place> Willcox AZ"), NOT verified address data. Before activating
-- any inserted item: (1) run the geocode step (geocode-items.mjs / checkoff_gapfill_import.js)
-- to fill maps_lat/lng, formatted_address, google_place_id; (2) set visit_profile_key;
-- (3) get the business/Chamber verification noted in the reconciliation; (4) tag from the
-- existing tags table. Visit monitoring needs coordinates + a profile (see memory:
-- visit catalog readiness).
--
-- Sections: 0 preflight | 1 updates | 2 inserts | 3 pending Chamber decisions |
--           4 retirements | 5 list membership + activation | 6 seasonal
-- =============================================================================
BEGIN;

-- 0. PREFLIGHT -----------------------------------------------------------------
DO $pre$
DECLARE v_missing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.neighborhoods WHERE id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1'::uuid AND name = 'Willcox') THEN
    RAISE EXCEPTION 'Willcox neighborhood preflight failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.destination_lists WHERE destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid AND list_id = 'bbd16ea1-f7d6-4805-abbc-d6d23e2c596b'::uuid) THEN
    RAISE EXCEPTION 'Hub list is not linked to the Willcox destination';
  END IF;
  SELECT string_agg(x.name, ', ') INTO v_missing
  FROM (VALUES ('Bar & drinks'),('Food & drink'),('Arts & Culture'),('Adventure'),('Play'),('Sports'),('Social'),('Shopping'),('Spa & self-care'),('Travel')) AS x(name)
  WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.name = x.name);
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'Missing categories: %', v_missing; END IF;
  IF (SELECT count(*) FROM public.items WHERE neighborhood_id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1'::uuid) <> 26 THEN
    RAISE EXCEPTION 'Willcox inventory changed since this draft was written (expected 26 items). Re-run the reconciliation.';
  END IF;
END
$pre$;

-- 1. UPDATES TO EXISTING ITEMS ---------------------------------------------------
-- 1a. Apple Annie's Orchard: current body is a bare "U-Pick at 'Apple Annies Orchard'".
--     NEEDS BUSINESS VERIFICATION (fruit windows) before running. Kept commented.
-- UPDATE public.items SET body = $b$Pick your own peaches, apples, or pears at 'Apple Annie''s Orchard', then grab a bakery treat.$b$
--  WHERE id = '132a829f-12e3-407b-b619-0ecaba8ad73b'::uuid
--    AND body = $b$U-Pick at 'Apple Annies Orchard'$b$;
-- 1b. Rix's Tavern: bare body; Chamber marked "Discuss". Wait for the Chamber, do not guess a rewrite.
-- 1c. Warren Earp grave item (814f48c1-e01e-450f-b680-81008b89b693): likely the Pioneer Cemetery. AMBIGUOUS.
--     Verify the cemetery name/address, then rename in the body. Do not insert a duplicate cemetery item.

-- 2. INSERTS: Chamber "Include" rows with no production match (22 items) -------------
-- Inactive + unapproved drafts. Duplicate guard first.
DO $dup$
BEGIN
  IF EXISTS (SELECT 1 FROM public.items WHERE maps_query IN ($q$Pillsbury Wine Company Willcox AZ$q$, $q$La Unica Tortilleria Willcox AZ$q$, $q$Isabel's South of the Border Willcox AZ$q$, $q$Adolfo's Taco Shop Willcox AZ$q$, $q$Double S Steakhouse Willcox AZ$q$, $q$Desert Brew Willcox AZ$q$, $q$Dos Cabezas Coffee Company Willcox AZ$q$, $q$Historic Railroad Depot / Visitor Center Willcox AZ$q$, $q$Historic Railroad Park Willcox AZ$q$, $q$Twin Lakes Golf Course Willcox AZ$q$, $q$Keiller Park Willcox AZ$q$, $q$Quail Park Willcox AZ$q$, $q$Railroad Dog Park Willcox AZ$q$, $q$Willcox Pool & Splash Pad Willcox AZ$q$, $q$Event Center & Rodeo Grounds Willcox AZ$q$, $q$Railroad Avenue Walk Willcox AZ$q$, $q$Willcox Historic Downtown Photo Walk Willcox AZ$q$, $q$Tirrito Farm Willcox AZ$q$, $q$Rhumb Line Vineyard & Lavender Farm Willcox AZ$q$, $q$Lee's Pecans Willcox AZ$q$, $q$Rafter M Meats Willcox AZ$q$, $q$Inde Motorsports Ranch Willcox AZ$q$)) THEN
    RAISE EXCEPTION 'One or more draft maps_query values already exist; review before inserting';
  END IF;
END
$dup$;

INSERT INTO public.items
  (body, category_id, neighborhood_id, checkin_type, maps_query, is_universal, is_active, is_approved,
   is_recurring, difficulty, photo_required, has_alcohol, season_tag)
SELECT v.body, c.id, 'e35e8947-92ad-44ad-80f6-633a65d94dc1'::uuid, 'tap', v.mq, false,
       false,  -- is_active: inactive until geocoded + business-verified
       false,  -- is_approved: flip with is_active after verification
       true, v.diff, false, v.alc, v.season
FROM (VALUES
  ($body$Visit 'Pillsbury Wine Company' and taste a legacy Arizona wine.$body$, $c$Bar & drinks$c$, 1, true, NULL, $mq$Pillsbury Wine Company Willcox AZ$mq$),  -- #8 Pillsbury Wine Company [Curated]
  ($body$Eat a fresh tortilla-based meal at 'La Unica Tortilleria' and take tortillas home.$body$, $c$Food & drink$c$, 1, false, NULL, $mq$La Unica Tortilleria Willcox AZ$mq$),  -- #10 La Unica Tortilleria [Curated]
  ($body$Try the fire-roasted salsa with a Mexican dinner at 'Isabel's South of the Border'.$body$, $c$Food & drink$c$, 1, false, NULL, $mq$Isabel's South of the Border Willcox AZ$mq$),  -- #11 Isabel's South of the Border [Curated]
  ($body$Order carne asada tacos or a breakfast burrito at 'Adolfo's Taco Shop'.$body$, $c$Food & drink$c$, 1, false, NULL, $mq$Adolfo's Taco Shop Willcox AZ$mq$),  -- #12 Adolfo's Taco Shop [Curated]
  ($body$Have a steak dinner at 'Double S Steakhouse' after a day of wine, hiking, or exploring.$body$, $c$Food & drink$c$, 1, false, NULL, $mq$Double S Steakhouse Willcox AZ$mq$),  -- #13 Double S Steakhouse [Curated]
  ($body$Order a horchata frappe or a local coffee drink at 'Desert Brew'.$body$, $c$Food & drink$c$, 1, false, NULL, $mq$Desert Brew Willcox AZ$mq$),  -- #14 Desert Brew [Curated]
  ($body$Start the morning with locally roasted coffee at 'Dos Cabezas Coffee Company'.$body$, $c$Food & drink$c$, 1, false, NULL, $mq$Dos Cabezas Coffee Company Willcox AZ$mq$),  -- #15 Dos Cabezas Coffee Company [Curated]
  ($body$Start at the 'Historic Railroad Depot' and set out on a Railroad Avenue walk.$body$, $c$Arts & Culture$c$, 1, false, NULL, $mq$Historic Railroad Depot / Visitor Center Willcox AZ$mq$),  -- #22 Historic Railroad Depot / Visitor Center [Curated]
  ($body$Walk 'Historic Railroad Park' and photograph a piece of Willcox railroad history.$body$, $c$Arts & Culture$c$, 1, false, NULL, $mq$Historic Railroad Park Willcox AZ$mq$),  -- #24 Historic Railroad Park [Curated]
  ($body$Play nine holes at 'Twin Lakes Golf Course' with Willcox's high-desert landscape around you.$body$, $c$Sports$c$, 5, false, NULL, $mq$Twin Lakes Golf Course Willcox AZ$mq$),  -- #37 Twin Lakes Golf Course [Discoverable]
  ($body$Take a break at 'Keiller Park' and enjoy a local public green space.$body$, $c$Play$c$, 1, false, NULL, $mq$Keiller Park Willcox AZ$mq$),  -- #38 Keiller Park [Discoverable]
  ($body$Walk the paved trail or catch a game at 'Quail Park'.$body$, $c$Play$c$, 1, false, NULL, $mq$Quail Park Willcox AZ$mq$),  -- #39 Quail Park [Discoverable]
  ($body$Give your dog a travel break at 'Railroad Dog Park' downtown.$body$, $c$Play$c$, 1, false, NULL, $mq$Railroad Dog Park Willcox AZ$mq$),  -- #40 Railroad Dog Park [Discoverable]
  ($body$Cool off at the 'Willcox Pool & Splash Pad' on a summer visit.$body$, $c$Play$c$, 1, false, $s$summer$s$, $mq$Willcox Pool & Splash Pad Willcox AZ$mq$),  -- #41 Willcox Pool & Splash Pad [Seasonal]
  ($body$Catch a rodeo, community event, or Western gathering at the 'Event Center & Rodeo Grounds'.$body$, $c$Social$c$, 1, false, NULL, $mq$Event Center & Rodeo Grounds Willcox AZ$mq$),  -- #42 Event Center & Rodeo Grounds [Seasonal]
  ($body$Stroll historic 'Railroad Avenue' and find your favorite old-Willcox photo stop.$body$, $c$Adventure$c$, 1, false, NULL, $mq$Railroad Avenue Walk Willcox AZ$mq$),  -- #44 Railroad Avenue Walk [Curated]
  ($body$Photograph a favorite historic facade, sign, or railroad-era detail on a downtown Willcox walk.$body$, $c$Adventure$c$, 1, false, NULL, $mq$Willcox Historic Downtown Photo Walk Willcox AZ$mq$),  -- #45 Willcox Historic Downtown Photo Walk [Discoverable]
  ($body$Tour a working farm with animals, vineyards, a brewery, and lodging at 'Tirrito Farm'.$body$, $c$Play$c$, 5, true, NULL, $mq$Tirrito Farm Willcox AZ$mq$),  -- #51 Tirrito Farm [Curated]
  ($body$Walk the lavender-and-vineyard property at 'Rhumb Line Vineyard & Lavender Farm' during bloom season.$body$, $c$Play$c$, 1, true, NULL, $mq$Rhumb Line Vineyard & Lavender Farm Willcox AZ$mq$),  -- #52 Rhumb Line Vineyard & Lavender Farm [Seasonal]
  ($body$Take home a Willcox-grown pecan product from 'Lee's Pecans'.$body$, $c$Shopping$c$, 1, false, NULL, $mq$Lee's Pecans Willcox AZ$mq$),  -- #53 Lee's Pecans [Curated]
  ($body$Buy Arizona-raised jerky, sausage, or a fresh cut direct from the packing house at 'Rafter M Meats'.$body$, $c$Shopping$c$, 1, false, NULL, $mq$Rafter M Meats Willcox AZ$mq$),  -- #54 Rafter M Meats [Curated]
  ($body$Drive the private road course with a professional instructor at 'Inde Motorsports Ranch'.$body$, $c$Adventure$c$, 25, false, NULL, $mq$Inde Motorsports Ranch Willcox AZ$mq$)  -- #66 Inde Motorsports Ranch [Curated]
) AS v(body, cat, diff, alc, season, mq)
JOIN public.categories c ON c.name = v.cat;

-- 3. PENDING CHAMBER DECISION / AMBIGUOUS (26 items). COMMENTED OUT ---------------
-- Chamber marked these "Discuss", or the match to production is ambiguous (#36 Twin Lakes vs the
-- inactive Cochise Lake cranes item; #50 Produce & Pumpkins vs the existing orchard).
-- Reserve rows #61 Lazul Med Spa and #65 Arizona Sunset Inn are intentionally NOT included.
-- Uncomment only after the Chamber says Include.
-- INSERT INTO public.items
--   (body, category_id, neighborhood_id, checkin_type, maps_query, is_universal, is_active, is_approved,
--    is_recurring, difficulty, photo_required, has_alcohol, season_tag)
-- SELECT v.body, c.id, 'e35e8947-92ad-44ad-80f6-633a65d94dc1'::uuid, 'tap', v.mq, false,
--        false,  -- is_active: inactive until geocoded + business-verified
--        false,  -- is_approved: flip with is_active after verification
--        true, v.diff, false, v.alc, v.season
-- FROM (VALUES
--   ($body$Taste high-elevation estate-grown wine at 'Carlson Creek Vineyard'.$body$, $c$Bar & drinks$c$, 1, true, NULL, $mq$Carlson Creek Vineyard Willcox AZ$mq$),  -- #4 Carlson Creek Vineyard [Curated]
--   ($body$Taste Golden Rule wines at 'Golden Rule Vineyards' in the Willcox area.$body$, $c$Bar & drinks$c$, 1, true, NULL, $mq$Golden Rule Vineyards Willcox AZ$mq$),  -- #7 Golden Rule Vineyards [Curated]
--   ($body$Grab a local hot dog from 'Katy's Rico Hot Dogs' roadside stand.$body$, $c$Food & drink$c$, 1, false, NULL, $mq$Katy's Rico Hot Dogs Willcox AZ$mq$),  -- #16 Katy's Rico Hot Dogs [Discoverable]
--   ($body$Order a local Mexican favorite at 'Peter's Mexican Food'.$body$, $c$Food & drink$c$, 1, false, NULL, $mq$Peter's Mexican Food Willcox AZ$mq$),  -- #17 Peter's Mexican Food [Discoverable]
--   ($body$Order a made-to-order Mexican street-food favorite at 'Antojitos El Cholo Food Truck'.$body$, $c$Food & drink$c$, 1, false, NULL, $mq$Antojitos El Cholo Food Truck Willcox AZ$mq$),  -- #18 Antojitos El Cholo Food Truck [Discoverable]
--   ($body$Split a pizza at 'R&R Pizza', a local Willcox spot.$body$, $c$Food & drink$c$, 1, false, NULL, $mq$R&R Pizza Willcox AZ$mq$),  -- #19 R&R Pizza [Discoverable]
--   ($body$Have a drink at 'Mack's Bar', a downtown Willcox local bar.$body$, $c$Bar & drinks$c$, 1, true, NULL, $mq$Mack's Bar Willcox AZ$mq$),  -- #21 Mack's Bar [Discoverable]
--   ($body$See the 'Historic Schwertner House', one of Willcox's early historic homes.$body$, $c$Arts & Culture$c$, 1, false, NULL, $mq$Historic Schwertner House Willcox AZ$mq$),  -- #28 Historic Schwertner House [Discoverable]
--   ($body$Explore Indigenous art and archaeology at the 'Amerind Museum' in Texas Canyon.$body$, $c$Arts & Culture$c$, 1, false, NULL, $mq$Amerind Museum Willcox AZ$mq$),  -- #29 Amerind Museum [Curated]
--   ($body$Stop into 'Studio 128' for a local art or creative experience downtown.$body$, $c$Arts & Culture$c$, 1, false, NULL, $mq$Studio 128 Willcox AZ$mq$),  -- #30 Studio 128 [Discoverable]
--   ($body$Explore the 'Dos Cabezas' area and take in the two granite peaks.$body$, $c$Adventure$c$, 5, false, NULL, $mq$Dos Cabezas Willcox AZ$mq$),  -- #34 Dos Cabezas [Discoverable]
--   ($body$Scan 'Twin Lakes' for migrating shorebirds and waterfowl.$body$, $c$Adventure$c$, 1, false, NULL, $mq$Twin Lakes Birding Willcox AZ$mq$),  -- #36 Twin Lakes Birding [Curated]
--   ($body$Give the kids a playground break at the 'Willcox Community Center'.$body$, $c$Play$c$, 1, false, NULL, $mq$Willcox Community Center Playground Willcox AZ$mq$),  -- #43 Willcox Community Center Playground [Discoverable]
--   ($body$Ride the 'Willcox Flyer' and see the Sulphur Springs Valley from two wheels.$body$, $c$Sports$c$, 25, false, NULL, $mq$Willcox Flyer Bike Ride Willcox AZ$mq$),  -- #46 Willcox Flyer Bike Ride [Seasonal]
--   ($body$Run the 'Boulderdash Trail Run' through the Texas Canyon landscape.$body$, $c$Sports$c$, 25, false, NULL, $mq$Boulderdash Trail Run Willcox AZ$mq$),  -- #47 Boulderdash Trail Run [Seasonal]
--   ($body$Run the 'Amerind Texas Canyon Trail Run' through the granite scenery around the Amerind.$body$, $c$Sports$c$, 25, false, NULL, $mq$Amerind Texas Canyon Trail Run Willcox AZ$mq$),  -- #48 Amerind Texas Canyon Trail Run [Seasonal]
--   ($body$Pick vegetables or a pumpkin and tackle the corn maze at 'Apple Annie's Produce & Pumpkins'.$body$, $c$Play$c$, 1, false, $s$fall$s$, $mq$Apple Annie's Produce & Pumpkins Willcox AZ$mq$),  -- #50 Apple Annie's Produce & Pumpkins [Seasonal]
--   ($body$Browse 'Amarillo by Morning' and take home something with local Western character.$body$, $c$Shopping$c$, 1, false, NULL, $mq$Amarillo by Morning Willcox AZ$mq$),  -- #55 Amarillo by Morning [Discoverable]
--   ($body$Browse 'Buffalo Sisters' for a locally distinctive downtown find.$body$, $c$Shopping$c$, 1, false, NULL, $mq$Buffalo Sisters Willcox AZ$mq$),  -- #56 Buffalo Sisters [Discoverable]
--   ($body$Browse the 'Friendly Bookstore' and pick out a road-trip read.$body$, $c$Shopping$c$, 1, false, NULL, $mq$Friendly Bookstore Willcox AZ$mq$),  -- #57 Friendly Bookstore [Discoverable]
--   ($body$Browse 'Vin•Tage' inside historic downtown Willcox.$body$, $c$Shopping$c$, 1, false, NULL, $mq$Vin•Tage Willcox AZ$mq$),  -- #58 Vin•Tage [Discoverable]
--   ($body$Find a locally distinctive souvenir or treasure at 'Willcox Traders'.$body$, $c$Shopping$c$, 1, false, NULL, $mq$Willcox Traders Willcox AZ$mq$),  -- #59 Willcox Traders [Discoverable]
--   ($body$Hunt for a vintage or thrifted find at 'Bear's Vintage Thrift'.$body$, $c$Shopping$c$, 1, false, NULL, $mq$Bear's Vintage Thrift Willcox AZ$mq$),  -- #60 Bear's Vintage Thrift [Discoverable]
--   ($body$Take a Pilates class at 'The Neighborhood Studio' while you're in Willcox.$body$, $c$Spa & self-care$c$, 5, false, NULL, $mq$The Neighborhood Studio (Pilates) Willcox AZ$mq$),  -- #62 The Neighborhood Studio (Pilates) [Discoverable]
--   ($body$Stay overnight on a working farm in Willcox wine country at 'Tirrito Farm Casitas'.$body$, $c$Travel$c$, 10, false, NULL, $mq$Tirrito Farm Casitas Willcox AZ$mq$),  -- #63 Tirrito Farm Casitas [Discoverable]
--   ($body$Sleep under the high-desert sky in a glamping dome at 'Tirrito Farm'.$body$, $c$Travel$c$, 10, false, NULL, $mq$Tirrito Farm Glamping Domes Willcox AZ$mq$)  -- #64 Tirrito Farm Glamping Domes [Curated]
-- ) AS v(body, cat, diff, alc, season, mq)
-- JOIN public.categories c ON c.name = v.cat;

-- 4. RETIREMENTS / DEACTIVATIONS. ALL COMMENTED, NEEDS APPROVAL --------------------------
-- Remove two generic road-trip prompts from the Hub list (items stay active for other lists):
-- DELETE FROM public.list_items WHERE list_id = 'bbd16ea1-f7d6-4805-abbc-d6d23e2c596b'::uuid
--   AND item_id IN ('e4e347d9-2a69-4353-8636-67bfab98c86f'::uuid, 'fa52507f-f90e-46f3-9703-e7f4f8f52823'::uuid);
-- Generic downtown meal prompt (already not in the Hub list):
-- UPDATE public.items SET is_active = false WHERE id = '504c8b29-71b3-4aa7-9a9a-2e9ca25146e9'::uuid;
-- Nothing else is retired. Flying Leap Vineyards (e2f5020d-...) and Willcox Commercial Store
-- (d07f42cf-...) are live but absent from the workbook: ask the Chamber first.

-- 5. LIST MEMBERSHIP + ACTIVATION. COMMENTED, RUN ONLY AFTER VERIFICATION --------------------
-- Curated rows to put on the Hub primary list once each item is geocoded and verified.
-- Decide first whether to rename the list (it is titled "Willcox Wine Trail · Anytime 2026"
-- and has cover_emoji "🔟", which renders as "10" on some platforms; see memory emoji gotcha).
-- Curated additions: Pillsbury Wine Company, La Unica Tortilleria, Isabel's South of the Border, Adolfo's Taco Shop, Double S Steakhouse, Desert Brew, Dos Cabezas Coffee Company, Historic Railroad Depot / Visitor Center, Historic Railroad Park, Railroad Avenue Walk, Tirrito Farm, Lee's Pecans, Rafter M Meats, Inde Motorsports Ranch
-- Activate (per item, after geocode + verification):
--   UPDATE public.items SET is_active = true, is_approved = true WHERE id = '<id>' AND maps_lat IS NOT NULL;
-- Then add to the list, e.g.:
--   INSERT INTO public.list_items (list_id, item_id, sort_order)
--   SELECT 'bbd16ea1-f7d6-4805-abbc-d6d23e2c596b'::uuid, i.id, 100 + row_number() OVER (ORDER BY i.body)
--   FROM public.items i WHERE i.neighborhood_id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1'::uuid AND i.is_active
--     AND i.body IN (<approved bodies>)
--     AND NOT EXISTS (SELECT 1 FROM public.list_items li WHERE li.list_id = 'bbd16ea1-f7d6-4805-abbc-d6d23e2c596b'::uuid AND li.item_id = i.id);
-- The destination zone banner says "25 experiences waiting": update banner_subtitle to the real count.

-- 6. SEASONAL ----------------------------------------------------------------------------
-- season_tag set at insert: #41 Willcox Pool & Splash Pad = summer; #50 Produce & Pumpkins = fall (pending block).
-- NO invented dates. Needs real windows from the owners before setting active_from / active_until:
--   #42 Event Center & Rodeo Grounds, #46 Willcox Flyer, #47 Boulderdash, #48 Amerind Texas Canyon Run,
--   #52 Rhumb Line lavender bloom, Wings Over Willcox (b07c6c8b..., winter, inactive), Cochise Lake cranes (984d5c12..., winter, inactive).
-- No Willcox seasonal list exists. Creating one is a separate decision.

ROLLBACK;  -- change to COMMIT only after review and approval
