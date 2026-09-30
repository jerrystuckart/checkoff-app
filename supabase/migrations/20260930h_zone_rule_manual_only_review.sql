-- Clarified product rule (2026-09-30): CheckOff is an honor system. Time inside an item's configured zone earns a chance to confirm;
-- it does not require proof of the precise activity. 'The activity is not provable from location' is therefore no longer a reason to
-- exclude an item. Reviewed all 144 active manual_only items: the ones below have a real, fixed, named place (an operator's base or
-- landing, a destination, landmark, garden, stairs, pier, venue) and now use the existing profile that fits the place.
-- Kept excluded on purpose (no meaningful fixed zone): routes, loops, trails, greenways, scenic drives, road trips and city-level
-- tasks, multi-stop crawls, dated one-off events and multi-block street fairs, brief window/drive-thru stops, errands with no named
-- place, items whose coordinate is a company address rather than where it happens (Positano Home Cooking), and events without coordinates.
-- Source 'curated_2026-09-30b'. Reversible: UPDATE items SET visit_profile_key='manual_only', visit_profile_source='curated_2026-09-30b' WHERE id IN (...).
BEGIN;
UPDATE items SET visit_profile_key = 'outdoor', visit_profile_source = 'curated_2026-09-30b'
WHERE visit_profile_key = 'manual_only' AND is_active AND NOT is_universal AND maps_lat IS NOT NULL AND id IN (
  'a27ee3ce-c1fc-4a96-ad32-679738dffcf2', -- amal: Climb the rock-cut steps to the hole in the mountain above ''Montepertu,
  '222079ce-0fc5-40d1-bbd4-d17328731e33', -- amal: Peer over the 30-meter Furore bridge into the sea-filled gorge of ''Fio,
  'ec870595-d906-43d6-b7bb-27023bc46d31', -- amal: Tackle roughly 1,500 stone steps up to ''Nocelle'', the car-free hamlet ,
  '3006d261-6715-4fdb-9586-4f1a50e23b9b', -- gree: Launch a kayak directly from the floating docks at the ''Shipyard Distr,
  'a9b8d736-32b0-4ab9-a3b3-5af88eb12ca7', -- gree: Spot wildlife and cross over to historic Government Island and Lock at,
  '6d228cb9-c2a9-44e2-8ab3-aea4aed4ea1c', -- milw: Hike to ''Eagle Bluff Lighthouse'' in Peninsula State Park and take a ph,
  '5691977a-f207-4f8e-9b25-817495c163d9', -- milw: Hike to the observation tower at ''Lapham Peak'' — the climb above the t,
  '6d9c99b7-019e-4b6d-843f-74ea7dcf7ee9', -- milw: Walk across the causeway to ''Cana Island Lighthouse'' and climb it if i,
  '62e4c804-a369-4b09-84b5-66a6ddc83c03', -- milw: Walk the ''CityDeck'' along the Fox River at dusk and admit Green Bay is,
  'f91ccdba-c93d-4cd8-912a-0b6943948133', -- milw: Walk through ''Lakeshore State Park'' to the red Pierhead Lighthouse — s,
  '72e9ed0c-eda8-41f9-bfcb-b2530f554511', -- muni: Walk to the end of the long lake pier at ''Herrsching''.,
  'd397b765-4148-4df6-b758-27a56ddf5901', -- none: Find ''Cochise Stronghold'' in the Dragoon Mountains — the canyon where ,
  '93dff330-cb60-4f4c-8950-ceda0583acbb', -- phoe: Climb all 340 ''Victory Steps at Verrado'' — look back across the wester,
  '28f7fad9-a452-4f52-b59b-4dc6fe566e90', -- phoe: Find Petroglyph Plaza along ‘Waterfall Trail’ — treat any water in the,
  'e993aa19-4070-4501-bb00-012d9b32842f', -- phoe: Walk the park loop or shoot hoops at ''Anthem Community Park'',
  'c541459d-434b-46b3-ad1d-3643c250885e' -- vien: Catch a free outdoor summer cultural event at ''Hyblerpark''.
);
UPDATE items SET visit_profile_key = 'attraction', visit_profile_source = 'curated_2026-09-30b'
WHERE visit_profile_key = 'manual_only' AND is_active AND NOT is_universal AND maps_lat IS NOT NULL AND id IN (
  '7a2d43c8-7788-4eb3-b42a-082a412cc314', -- amal: Drift past stalagmites and a sunken ceramic nativity scene by boat ins,
  '7098744c-bbfd-4dda-aec7-490155df9731', -- amal: Find the 1707 floor inscription left by sailors who survived a shipwre,
  'fb65c9d0-4f56-4e44-8291-7d4993a12e05', -- muni: Spot a fur‑covered winter toothpick among the absurd exhibits at ''Vale,
  '305b9a59-23f6-4b94-9368-39fff046eea9', -- san-: Descend through the beachfront store’s tunnel to the hidden ''Sunny Jim,
  '809a3822-4f3b-496d-84fe-d879c0136669', -- tucs: Ride the open-air chairlift to 9,150 feet at ‘Mount Lemmon Ski Valley’,
  '0349dd41-ceda-470c-a647-d872fe4a991e', -- vien: Launch from a 40 m tower and soar 380 m across the city on the Flying ,
  'a340d4cd-19ea-4ee1-a443-d1b75f583038' -- vien: Tackle Austria’s only artificial whitewater course for rafting or kaya
);
UPDATE items SET visit_profile_key = 'event', visit_profile_source = 'curated_2026-09-30b'
WHERE visit_profile_key = 'manual_only' AND is_active AND NOT is_universal AND maps_lat IS NOT NULL AND id IN (
  '9f1de824-fb61-433f-9109-6afa21760fc0', -- amal: Paddle through Lovers'' Arch and into mineral-streaked ''Runghetiello Gr,
  '19c40a4c-eee5-46d6-ba87-3d7c31085cbd', -- amal: Rise above the coastline on a 15-minute parasailing flight with ''Amalf,
  '47768ccd-9116-47e1-97bc-aaa40c40ac0a', -- amal: Sail out at sunset with ''Lucibello'' to Li Galli, Rudolf Nureyev''s form,
  '0e962119-2273-4ec7-b83c-5dd4e4982317', -- phoe: Book a narrated cruise on ''Lake Pleasant Cruises'',
  '98211103-8965-4b43-8f95-ceb7aa577a17', -- phoe: Make your first tandem jump at ''Skydive Buckeye'' — freefall over the f,
  '9372fa1a-4bfb-45cf-989c-d994dd9b70e5', -- phoe: Ride horseback through saguaros as the sun drops at “MacDonald’s Ranch,
  '513b5a0e-c921-4665-a205-a3699219f4f8', -- phoe: Ride over the trestle and through the tunnel at ''Daisy Mountain Railro,
  '32d34ade-6742-4356-9078-90ab40d30c6a', -- phoe: Start Sunday with a mimosa and live music aboard ''Desert Belle'' — crui,
  '612087b5-1693-4c6a-abed-9c5482174ec8', -- phoe: Go ''Salt River Tubing'',
  'f9cef870-f972-42b6-a6d2-64f2d5ca068d', -- phoe: Shop ''Agritopia Farm Night'' after dark — buy something grown or made b,
  'c7e7fc00-74ea-4eb3-9cf8-99e199c1fcb7', -- san-: Fish the local kelp beds on a six-hour half-day trip from ''Point Loma ,
  '3513f62b-2998-429e-bbbc-734a685249ec', -- tucs: Book the sunset horseback ride at ''Tucson Mountain Stables'' — desert d,
  '235384eb-1d66-44ee-ac47-c1b190943e6d', -- tucs: Take a sunset ride with ''Tattered Saddle'' — cowboy-for-a-day energy in,
  'f4954179-cff8-4adb-9948-7ee2eaca6168', -- tucs: Take the sunset trail ride at ''Houston’s Horseback Riding'' — golden-ho,
  '9f56c442-31fc-47b7-a6e2-a3db5ee4ac2f' -- tucs: Catch the Summer Night Market at ''MSA Annex'' — local makers under ship
);
UPDATE items SET visit_profile_key = 'restaurant', visit_profile_source = 'curated_2026-09-30b'
WHERE visit_profile_key = 'manual_only' AND is_active AND NOT is_universal AND maps_lat IS NOT NULL AND id IN (
  '6fc00a62-24e7-4d87-944f-f50732087603' -- amal: Board the free boat from Positano''s pier to ''Ristorante Da Adolfo'', wh
);
UPDATE items SET visit_profile_key = 'landmark', visit_profile_source = 'curated_2026-09-30b'
WHERE visit_profile_key = 'manual_only' AND is_active AND NOT is_universal AND maps_lat IS NOT NULL AND id IN (
  '46357f48-049a-4f90-b833-356ec0b2448b', -- denv: Meet under the Great Hall clock at ''Denver Union Station'',
  '3ba54c44-7416-4b99-8502-d87ae7bde066', -- muni: Spot the carved plague dragon climbing the corner of ''Neues Rathaus''.,
  '814f48c1-e01e-450f-b680-81008b89b693', -- none: Locate the grave of Warren Earp, the youngest brother of legendary law,
  'f2c29c3b-3dc7-4dbf-9358-770ade99fe50', -- none: Pull over at ''Willcox Playa Wildlife Area'' — a dry lake bed that becom,
  '48d111f6-382d-424d-99cd-86ed6973af34', -- phoe: Obtain a key from ''The Door Christian Fellowship'',
  'bf81c02d-215c-4d6e-9724-45daddf16454', -- phoe: Use the bathroom at ''W Scottsdale'',
  '54f3c29d-de1a-4928-b326-e2e869233dd8', -- san-: Find the landlocked full-size Navy training ship ''USS Recruit'', the ''S,
  '9c8e79d8-5577-4de6-83b6-114eaf715ee0', -- san-: See the whimsical front-yard topiary garden created by a local artist ,
  '23798a84-8749-4c0c-8bb4-4048b21af246', -- san-: See what locals have dressed the Cardiff Kook as today at ''Magic Carpe,
  'b8bbe972-d786-4380-8f2a-cfc3e7d4f994', -- tucs: Light a candle at ''El Tiradito'' — Tucson''s hidden wishing shrine still,
  'b4efe824-4d92-4a47-9545-6d5b59f56dd9', -- tucs: Walk through the belly of ''Rattlesnake Bridge'' — the tail rattles behi,
  'ee6d06ca-e5e1-44ef-97d0-9e23529a255a' -- vien: Check out the reopened, modernized facilities at ''Sport-Club-Stadion H
);
UPDATE items SET visit_profile_key = 'retail', visit_profile_source = 'curated_2026-09-30b'
WHERE visit_profile_key = 'manual_only' AND is_active AND NOT is_universal AND maps_lat IS NOT NULL AND id IN (
  'bfdb9965-b3cc-4109-850d-9ab6ae11c8aa', -- milw: Meet up for dinner and a walk around ''The Corners of Brookfield'',
  '04791c78-b931-4416-a6fa-ba295a2053b7', -- phoe: Meet up for dinner and a movie at ''Park West'',
  'd0b50c9f-babf-4795-b73e-68bc255d9af2' -- tucs: Meet up for shops, food, music and outdoor events at the ''Mercado San 
);
DO $$ BEGIN IF (SELECT count(*) FROM items WHERE visit_profile_source='curated_2026-09-30b' AND visit_profile_key <> 'manual_only') <> 54 THEN RAISE EXCEPTION 'expected 54 reviewed flips'; END IF; END $$;
COMMIT;
