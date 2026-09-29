-- Amalfi Coast visit-detection intake fix (2026-09-29).
-- Root cause: the Amalfi catalog (created 2026-09-26/27) missed the 2026-09-28 rule_v1 profile backfill, and 15 of the
-- 2026-09-27 bulk-added items were inserted without coordinates. Nothing was monitored: 46 geocoded items had no
-- visit_profile_key ('no_visit_profile_assigned') and 15 could not be seen by the client at all.
--
-- 1. Coordinates for the 15 coordinate-less items: Google Places (New) Text Search on each item's own maps_query,
--    address checked against the query. google_place_id / formatted_address stored like the admin's confirm-location flow.
-- 2. A reviewed visit profile for every active Amalfi item (61): 49 monitored-eligible, 12 intentionally
--    excluded as manual_only (trails, boat trips, private events, a co-located duplicate). Per-venue reasons below and in
--    docs/visit-recovery/amalfi_profile_decisions.json. Existing thresholds are unchanged.
-- Reversible: UPDATE items SET visit_profile_key = NULL, visit_profile_source = NULL WHERE visit_profile_source = 'curated_2026-09-29';
BEGIN;

-- Coordinates (15)
UPDATE items SET maps_lat = 40.6294153, maps_lng = 14.5928692, geo_location = ST_SetSRID(ST_MakePoint(14.5928692, 40.6294153), 4326),
  geo_radius_m = 150, google_place_id = 'ChIJlWZ_kWiXOxMRbmB5HIkKCVg', formatted_address = 'Via Mauro Comite, 9, 84011 Amalfi SA, Italy'
WHERE id = '94078362-0bd2-4c92-a63e-159a5cb9a0c6' AND maps_lat IS NULL; -- Hotel Santa Caterina Spa
UPDATE items SET maps_lat = 40.6337618, maps_lng = 14.6018391, geo_location = ST_SetSRID(ST_MakePoint(14.6018391, 40.6337618), 4326),
  geo_radius_m = 100, google_place_id = 'ChIJLxzu162VOxMR1TUQKZI3G3k', formatted_address = 'Via Cardinale Marino del Giudice,42, Piazza Duomo, 31, 84011 Amalfi SA, Italy'
WHERE id = 'e7a631c2-ee99-42b6-b727-90bcd994190e' AND maps_lat IS NULL; -- La Scuderia del Duca
UPDATE items SET maps_lat = 40.6344035, maps_lng = 14.601732299999998, geo_location = ST_SetSRID(ST_MakePoint(14.601732299999998, 40.6344035), 4326),
  geo_radius_m = 100, google_place_id = 'ChIJ_SPR4a2VOxMRGtp206eyor4', formatted_address = 'P.za dei Dogi, 26, 84011 Amalfi SA, Italy'
WHERE id = '9b17bceb-1fbf-4565-8ef7-c10a7e85c662' AND maps_lat IS NULL; -- La Tramontina Amalfi
UPDATE items SET maps_lat = 40.6207268, maps_lng = 14.5770378, geo_location = ST_SetSRID(ST_MakePoint(14.5770378, 40.6207268), 4326),
  geo_radius_m = 150, google_place_id = 'ChIJz5elMiWUOxMRyf9hNlDpnpc', formatted_address = 'Via Roma, 2, 84010 Conca dei Marini SA, Italy'
WHERE id = '5f078a41-bcdf-47a3-9abb-18a3ca8e006c' AND maps_lat IS NULL; -- Monastero Santa Rosa Spa
UPDATE items SET maps_lat = 40.6207153, maps_lng = 14.577273899999998, geo_location = ST_SetSRID(ST_MakePoint(14.577273899999998, 40.6207153), 4326),
  geo_radius_m = 100, google_place_id = 'ChIJJRYPwhWVOxMRRnQcdlysOjo', formatted_address = 'Via Roma, 2, 84010 Conca dei Marini SA, Italy'
WHERE id = 'a684b240-a508-4ed5-987c-47492e119f89' AND maps_lat IS NULL; -- Il Refettorio
UPDATE items SET maps_lat = 40.6496807, maps_lng = 14.628874699999997, geo_location = ST_SetSRID(ST_MakePoint(14.628874699999997, 40.6496807), 4326),
  geo_radius_m = 100, google_place_id = 'ChIJZTqbEmyVOxMRvjYLste9Fz0', formatted_address = 'Via Roma, 24, 84010 Minori SA, Italy'
WHERE id = 'ce69f6ff-3a1d-4836-ae85-be73e26f7e63' AND maps_lat IS NULL; -- Studio Fës
UPDATE items SET maps_lat = 40.6502903, maps_lng = 14.626921300000001, geo_location = ST_SetSRID(ST_MakePoint(14.626921300000001, 40.6502903), 4326),
  geo_radius_m = 100, google_place_id = 'ChIJt7NVMWyVOxMRcBVCaAW1uVI', formatted_address = 'C.so Vittorio Emanuele, 17, 84010 Minori SA, Italy'
WHERE id = 'ba1b362f-0280-4d87-a7d6-c22842ba6d99' AND maps_lat IS NULL; -- Il Giardiniello
UPDATE items SET maps_lat = 40.6303413, maps_lng = 14.4856266, geo_location = ST_SetSRID(ST_MakePoint(14.4856266, 40.6303413), 4326),
  geo_radius_m = 100, google_place_id = 'ChIJ437VPm-XOxMR3pO7oMHekPc', formatted_address = '12 - 14 - 16, Viale Pasitea, 84017 Positano SA, Italy'
WHERE id = '7854a417-e16e-4a5a-a9c1-905c8842682d' AND maps_lat IS NULL; -- Maria Lampo
UPDATE items SET maps_lat = 40.6279105, maps_lng = 14.485827899999999, geo_location = ST_SetSRID(ST_MakePoint(14.485827899999999, 40.6279105), 4326),
  geo_radius_m = 100, google_place_id = 'ChIJLZ6-w2iXOxMRvtWExuG8254', formatted_address = 'Via Trara Genoino, 13, 84017 Positano SA, Italy'
WHERE id = '3665be3a-c8ac-4e0a-9685-cf4e1de6eaeb' AND maps_lat IS NULL; -- Positano Home Cooking
UPDATE items SET maps_lat = 40.630141900000005, maps_lng = 14.485910100000002, geo_location = ST_SetSRID(ST_MakePoint(14.485910100000002, 40.630141900000005), 4326),
  geo_radius_m = 100, google_place_id = 'ChIJ4RqIOm-XOxMRLFSm7JXWM80', formatted_address = 'Via Cristoforo Colombo, 1/3, 84017 Positano SA, Italy'
WHERE id = 'b4e7eeb8-564b-4468-af85-eab157fd0e57' AND maps_lat IS NULL; -- Collina Positano Bakery
UPDATE items SET maps_lat = 40.6274163, maps_lng = 14.489397499999999, geo_location = ST_SetSRID(ST_MakePoint(14.489397499999999, 40.6274163), 4326),
  geo_radius_m = 100, google_place_id = 'ChIJOfSRY2mXOxMR6raLGNfFosU', formatted_address = 'Località Grotte Dell''incanto, 51, 84017, 84017 Positano SA, Italy'
WHERE id = '4e1bc785-b8a8-4e8d-b34f-46df3c975045' AND maps_lat IS NULL; -- Music on the Rocks
UPDATE items SET maps_lat = 40.628702, maps_lng = 14.485222499999997, geo_location = ST_SetSRID(ST_MakePoint(14.485222499999997, 40.628702), 4326),
  geo_radius_m = 100, google_place_id = 'ChIJT_mhWQGXOxMRdS3w8_h_arI', formatted_address = 'Viale Pasitea, 67, 84017 Positano SA, Italy'
WHERE id = '57ee2dee-6ab1-4491-be6e-3b43f121e992' AND maps_lat IS NULL; -- Latteria
UPDATE items SET maps_lat = 40.6310673, maps_lng = 14.484918499999997, geo_location = ST_SetSRID(ST_MakePoint(14.484918499999997, 40.6310673), 4326),
  geo_radius_m = 100, google_place_id = 'ChIJAdkaOW-XOxMRRQziS55ANVs', formatted_address = 'Viale Pasitea, 72, 84017 Positano SA, Italy'
WHERE id = '09f3beb6-4b1d-4a33-bc75-22a2e8628742' AND maps_lat IS NULL; -- Bottega di Brunella
UPDATE items SET maps_lat = 40.6112591, maps_lng = 14.5379953, geo_location = ST_SetSRID(ST_MakePoint(14.5379953, 40.6112591), 4326),
  geo_radius_m = 100, google_place_id = 'ChIJOwtw68aWOxMRAld-TGyfKP0', formatted_address = 'Via Terramare, 3, 84010 Praiano SA, Italy'
WHERE id = '4c7f6c3b-c75e-48b2-a442-d99ba43e7e40' AND maps_lat IS NULL; -- Torre a Mare
UPDATE items SET maps_lat = 40.6138362, maps_lng = 14.5204525, geo_location = ST_SetSRID(ST_MakePoint(14.5204525, 40.6138362), 4326),
  geo_radius_m = 150, google_place_id = 'ChIJQ2aS49iWOxMRZfNsj8X6IgE', formatted_address = 'Via Gavitella, 1, 84010 Praiano SA, Italy'
WHERE id = 'aa7f6da5-3068-412b-a512-d0bf8443df38' AND maps_lat IS NULL; -- La Gavitella Cooking Classes

-- Profiles (only fills empty profiles: never overwrites a person's earlier choice)
UPDATE items SET visit_profile_key = 'attraction', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  '94078362-0bd2-4c92-a63e-159a5cb9a0c6', -- Hotel Santa Caterina Spa
  '47887bd9-7949-4fa0-b9c9-566d0c95dd38', -- Chiostro del Paradiso
  '66aba005-d30b-48b8-9085-5acb883741ea', -- Arsenale della Repubblica
  'bd93e034-a611-41f8-be9a-337661819ca7', -- Museo della Carta
  'b7f01448-960c-40ec-8ecb-eed2c9296301', -- Cantine Marisa Cuomo
  '5f078a41-bcdf-47a3-9abb-18a3ca8e006c', -- Monastero Santa Rosa Spa
  'ea962d68-771d-4ae7-a6f8-2b149431fe7f', -- MAR Positano
  'cf4b351f-3b35-43e2-860d-b5e88e3d810e', -- Chiesa di Santa Maria Assunta
  'e7a85b9b-c29f-4636-8498-185eca264017', -- Chiesa di San Pietro
  '4c7f6c3b-c75e-48b2-a442-d99ba43e7e40', -- Torre a Mare
  'b33c9079-b8d0-4bd6-8653-66196226267c', -- Chiesa di San Gennaro
  'cf3ad9cd-6d67-466d-896c-3037630be5be', -- Villa Cimbrone
  '337a9a7f-c864-4fc1-8a90-cc2bd355e39f', -- Duomo di Ravello
  'e49d440e-3965-4f45-bea2-5ffb62102279', -- Villa Rufolo
  'b2529a75-c0df-469c-9241-9df807dd2bc9', -- Ceramica Artistica Solimene
  'f1ff833e-dca5-4341-b969-a088078e1432' -- Chiesa di San Giovanni Battista
);

UPDATE items SET visit_profile_key = 'fast_casual', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  'eef9a888-bd53-4088-bbfe-2858aea229c4', -- Pasticceria Andrea Pansa
  'b4e7eeb8-564b-4468-af85-eab157fd0e57', -- Collina Positano Bakery
  'b2df2866-d8d2-4ad7-9216-94fc39bb69e7' -- Elisir di Positano Cafè
);

UPDATE items SET visit_profile_key = 'retail', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  'e7a631c2-ee99-42b6-b727-90bcd994190e', -- La Scuderia del Duca
  '8805c468-fd14-47eb-a1eb-2ed226db63ab', -- Delfino Battista
  '8fe5beb8-baaf-472f-bdce-a4225f27d2db', -- Ceramiche Casola
  '30179258-eddf-43c0-a39e-d979a06a122a', -- Sapori e Profumi di Positano
  '2900d3f1-d70c-42ed-8cd8-c1d16f6ea258', -- Artigianato Rallo
  '7854a417-e16e-4a5a-a9c1-905c8842682d', -- Maria Lampo
  '09f3beb6-4b1d-4a33-bc75-22a2e8628742' -- Bottega di Brunella
);

UPDATE items SET visit_profile_key = 'manual_only', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  '9f1de824-fb61-433f-9109-6afa21760fc0', -- Amalfi Coast Sea Kayak
  '19c40a4c-eee5-46d6-ba87-3d7c31085cbd', -- Amalfi Coast Watersport
  '7a2d43c8-7788-4eb3-b42a-082a412cc314', -- Grotta dello Smeraldo
  '222079ce-0fc5-40d1-bbd4-d17328731e33', -- Fiordo di Furore
  'ef4b30ca-a2d1-4287-a272-6a69dc2c4436', -- Sentiero dei Limoni
  'a27ee3ce-c1fc-4a96-ad32-679738dffcf2', -- Montepertuso
  '3665be3a-c8ac-4e0a-9685-cf4e1de6eaeb', -- Positano Home Cooking
  '7098744c-bbfd-4dda-aec7-490155df9731', -- Chiesa di San Giacomo
  '47768ccd-9116-47e1-97bc-aaa40c40ac0a', -- Lucibello
  'ec870595-d906-43d6-b7bb-27023bc46d31', -- Nocelle
  '6421fead-34d9-4534-9415-335597e8b92b', -- Sentiero degli Dei
  '923e5f82-57cf-4bbf-8079-9da1562ca12a' -- Valle delle Ferriere
);

UPDATE items SET visit_profile_key = 'restaurant', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  '9b17bceb-1fbf-4565-8ef7-c10a7e85c662', -- La Tramontina Amalfi
  '9f664603-ea0e-44fd-b489-e5589672fc65', -- Al Convento
  'a684b240-a508-4ed5-987c-47492e119f89', -- Il Refettorio
  'ba1b362f-0280-4d87-a7d6-c22842ba6d99', -- Il Giardiniello
  '6fc00a62-24e7-4d87-944f-f50732087603', -- Ristorante Da Adolfo
  '6e64010f-4563-4bb0-b9d1-07ad99c7c623', -- La Zagara
  '16d7d423-145c-459b-a14d-2265f2efdce6', -- Il Ritrovo
  '57ee2dee-6ab1-4491-be6e-3b43f121e992', -- Latteria
  'f07ea9cb-c824-4441-b38f-199a2954be84', -- Chez Black
  '36999903-5b9b-402f-aa9b-7a1089ce2e1a', -- La Tagliata
  '1e683d1c-2c35-4a1d-87ed-456f3ca81b3a', -- Trattoria Da Armandino
  'f7b637cf-e866-41db-9a89-a318612feb5e' -- Trattoria Cumpà Cosimo
);

UPDATE items SET visit_profile_key = 'event', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  'c137ccb9-1beb-491a-8e67-24d6b572badf', -- Amalfi Lemon Experience
  'ce69f6ff-3a1d-4836-ae85-be73e26f7e63', -- Studio Fës
  'aa7f6da5-3068-412b-a512-d0bf8443df38', -- La Gavitella Cooking Classes
  'aa484976-ae54-432b-9f8d-177113779832' -- Mamma Agata
);

UPDATE items SET visit_profile_key = 'quick_stop', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  'a1d9dc59-33f7-488e-87c1-9a0910e33b5e' -- Pasticceria Sal De Riso
);

UPDATE items SET visit_profile_key = 'bar', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  '4e1bc785-b8a8-4e8d-b34f-46df3c975045', -- Music on the Rocks
  '2862fa16-bc7e-4d0f-a6af-672066e61351', -- Franco's Bar
  '712af3a4-0cdd-4119-9806-a5fa82c6ea7e', -- Bacco's Lounge
  'bacba3c1-2b32-4f0d-9048-33a1e513e237' -- Il Pirata
);

UPDATE items SET visit_profile_key = 'outdoor', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  'b3c7cc14-f1cd-458d-b0cc-79ad37d33832', -- Arienzo Beach Club
  '9ed05f8a-17e0-452d-bc30-4c9364cc5ddc' -- Fornillo Beach
);

-- Rationale per venue:
--   attraction  Hotel Santa Caterina Spa: Hotel spa treatment (60+ min); fixed building.
--   fast_casual Pasticceria Andrea Pansa: Pastry cafe on the cathedral piazza; 3 monitored venues within 80 m, so quick_stop's 5 min would misfire on piazza foot traffic. Longer-dwell profile chosen.
--   retail      La Scuderia del Duca: Paper shop; walk-in purchase.
--   attraction  Chiostro del Paradiso: Cloister museum; ticketed visit.
--   attraction  Arsenale della Repubblica: Medieval shipyard museum/venue; ticketed.
--   manual_only Amalfi Coast Sea Kayak: Kayak tour: the activity happens on the water, away from the booking point. Not verifiable by dwelling at one coordinate.
--   manual_only Amalfi Coast Watersport: Parasailing flight: a 15-minute flight offshore; presence at the pier does not show the activity.
--   restaurant  La Tramontina Amalfi: Sit-down deli-restaurant.
--   event       Amalfi Lemon Experience: Booked, scheduled grove walk + tasting at one farm; scheduled-activity profile (as Winston uses for booked activities).
--   attraction  Museo della Carta: Museum; ticketed.
--   retail      Delfino Battista: Producer shop; buy a bottle. Short purchase.
--   restaurant  Al Convento: Sit-down restaurant.
--   attraction  Cantine Marisa Cuomo: Winery cellar tasting; booked visit at one site.
--   manual_only Grotta dello Smeraldo: Boat tour inside a sea cave reached by cliffside elevator; the visit is the boat leg, not dwell at the entrance.
--   attraction  Monastero Santa Rosa Spa: Hotel spa. Note: 20 m from Il Refettorio (same complex), so a spa stay can also surface Il Refettorio; the user confirms which.
--   restaurant  Il Refettorio: Sit-down restaurant in the convent (see spa note).
--   manual_only Fiordo di Furore: Roadside bridge viewpoint on the SS163: a 4-5 minute look is indistinguishable from traffic and bus stops.
--   event       Studio Fës: Booked ceramics workshop.
--   quick_stop  Pasticceria Sal De Riso: Pastry counter/cafe on a main street; no monitored venue within 80 m.
--   restaurant  Il Giardiniello: Sit-down restaurant.
--   manual_only Sentiero dei Limoni: Walking trail (radius 700 m): a route, not a place.
--   retail      Ceramiche Casola: Ceramics shop.
--   restaurant  Ristorante Da Adolfo: Sit-down beach restaurant (free boat is the access, not the visit).
--   retail      Sapori e Profumi di Positano: Limoncello shop; 11 m from La Zagara (same block).
--   retail      Artigianato Rallo: Sandal workshop/shop; 22 m from Bottega di Brunella (same block).
--   retail      Maria Lampo: Boutique.
--   manual_only Montepertuso: Rock-cut stair climb to a hole in the mountain (radius 300 m): a climb, not a place.
--   manual_only Positano Home Cooking: Private-villa dinner: the coordinate is the company address, not where the event happens.
--   fast_casual Collina Positano Bakery: Grab-and-go bakery; 4 monitored venues within 80 m, so quick_stop would misfire. Longer-dwell profile chosen.
--   restaurant  La Zagara: Terrace cafe-restaurant.
--   bar         Music on the Rocks: Nightclub; same profile rule_v1 gives Nightlife.
--   attraction  MAR Positano: Archaeological museum; ticketed.
--   manual_only Chiesa di San Giacomo: Shares the exact coordinate (0 m) with Chiesa di Santa Maria Assunta, so a visit cannot be told apart; Santa Maria Assunta covers that spot.
--   bar         Franco's Bar: Terrace bar.
--   restaurant  Il Ritrovo: Sit-down restaurant in Montepertuso.
--   attraction  Chiesa di Santa Maria Assunta: Cathedral; 18 min is a real visit, a plaza cut-through is not.
--   fast_casual Elisir di Positano Cafè: Granita cafe; 3 monitored venues within 80 m. Longer-dwell profile chosen.
--   restaurant  Latteria: Small deli-restaurant (Google lists it as a restaurant/cooking class).
--   outdoor     Arienzo Beach Club: Beach club: a fixed place people spend hours at.
--   manual_only Lucibello: Sunset boat trip: the activity is at sea.
--   outdoor     Fornillo Beach: A named, bounded beach people stay at (radius 200 m).
--   attraction  Chiesa di San Pietro: Small Laurito chapel; longer profile chosen over landmark because it sits on the SS163 where buses stop.
--   manual_only Nocelle: 1,500-step hike: a route to a hamlet, not a place.
--   bar         Bacco's Lounge: Terrace bar.
--   restaurant  Chez Black: Sit-down restaurant.
--   retail      Bottega di Brunella: Linen boutique; 22 m from Artigianato Rallo.
--   restaurant  La Tagliata: Sit-down restaurant.
--   restaurant  Trattoria Da Armandino: Sit-down restaurant.
--   attraction  Torre a Mare: Artist studio in a watchtower; coordinate matched by Google to the artist's own website (business listed as 'Minerva' on Via Terramare).
--   manual_only Sentiero degli Dei: 8 km hike: a route, not a place.
--   event       La Gavitella Cooking Classes: Booked class at a fixed beach restaurant.
--   attraction  Chiesa di San Gennaro: Church square viewpoint; 18 min is a sunset stay, not a drive-by on the SS163.
--   bar         Il Pirata: Cave lounge bar.
--   event       Mamma Agata: Booked cooking school.
--   attraction  Villa Cimbrone: Villa and gardens; ticketed.
--   attraction  Duomo di Ravello: Cathedral; 44 m from Villa Rufolo on the same piazza (overlap penalty applies).
--   restaurant  Trattoria Cumpà Cosimo: Sit-down restaurant.
--   attraction  Villa Rufolo: Villa and gardens; ticketed.
--   manual_only Valle delle Ferriere: Stream trek (radius 800 m): a route, not a place.
--   attraction  Ceramica Artistica Solimene: Factory showroom visit.
--   attraction  Chiesa di San Giovanni Battista: Church visit.

DO $$
DECLARE n int; g int;
BEGIN
  SELECT count(*) INTO n FROM items WHERE visit_profile_source = 'curated_2026-09-29';
  IF n <> 61 THEN RAISE EXCEPTION 'expected 61 curated Amalfi profiles, found %', n; END IF;
  SELECT count(*) INTO g FROM items i JOIN neighborhoods nb ON nb.id = i.neighborhood_id JOIN metro_areas m ON m.id = nb.metro_id
   WHERE m.slug = 'amalfi-coast' AND i.is_active AND i.maps_lat IS NULL;
  IF g <> 0 THEN RAISE EXCEPTION '% active Amalfi items still lack coordinates', g; END IF;
END $$;

COMMIT;
