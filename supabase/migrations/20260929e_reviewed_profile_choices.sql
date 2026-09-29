-- Reviewed visit profiles for items the category rule declines (2026-09-29).
-- Every row was read and decided: bounded venues get the matching existing profile; routes, loops, trails, dated festivals,
-- recurring meetups, rides, road trips and anything without a single place are manual_only (intentionally excluded).
-- Only fills empty profiles. Reversible via visit_profile_source = 'curated_2026-09-29'.
BEGIN;
UPDATE items SET visit_profile_key = 'outdoor', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  '7f61f150-1e39-493d-bed3-9f39960342a8', -- denv: Catch a Front Range sunset at 'Lost Gulch Overlook'
  '432d8675-53b1-4a43-9233-53708507831c', -- denv: Paddle or swim at 'Union Reservoir'
  'd0f49958-63d3-495f-84b2-6343d52ee762', -- denv: Reach the Denver skyline viewpoint at 'William F. Hayde
  '591ab105-f33d-42c5-b474-e6610157bf27', -- denv: Stand where Cherry Creek meets the South Platte at 'Con
  '6b79b0ff-2658-4a94-88a7-18f6656934ec', -- denv: Ride one complete lap of the asphalt pump track without
  '717ce3d1-3355-492e-9420-a059d63bf971', -- denv: Ride, roll or skate through one concrete bowl at 'Denve
  '9cb62c36-aeda-414f-a5de-bbaf0e3ea58c', -- gree: Challenge someone to the outdoor games at 'Titletown Di
  '33c7bc02-afe2-48a1-8918-f115ea5af601', -- gree: Explore the trails winding through the 700-acre wildlif
  '0f010e30-06ae-4de7-8e34-b76533438614', -- gree: Follow the ravine trail to the scenic waterfall at 'Weq
  '0ab5d6b0-acfc-40b2-86b6-c67f6e11d1bb', -- gree: Follow the trails through the waterfowl habitat at 'Bar
  '8924e50c-2561-4ac7-8a08-e67741c59448', -- gree: Play a match on the pickleball or tennis courts at 'Idl
  'd88cfb07-9b88-470a-95cb-0ed7999f0caa', -- gree: Spot the natural spring, walk through prairie and woodl
  '10656524-7f40-401e-98cd-05b481186ed5', -- gree: Spot the hidden waterfall just off the highway at 'Wequ
  'ea04f310-9aa5-4b3f-8de3-68160dd1bc29', -- gree: Cool off in the splash pad at 'Howard Commons Activity 
  '5e99645b-23a3-4348-ac54-46fd3eb8bf18', -- milw: Pick an apple straight off the tree at 'Peck & Bushel' 
  'ec30d23e-1817-4c7f-802e-c3b50c50268d', -- milw: Walk through Wisconsin's last original covered bridge a
  '8349f977-d0e1-4f93-bd3e-a9b9dea1cf4f', -- muni: Climb 'Olympiaberg' for sunset over Olympiapark's tent 
  '25dd54b0-8780-441e-9620-53aac7fd3e37', -- muni: Feed deer along the forest paths at 'Wildpark Poing'.
  'c6035cec-a9b5-4880-9cb7-5c7fa61724eb', -- muni: Feed the deer beside the beer garden at 'Hirschgarten'.
  'd1019fd1-c89d-421f-92f0-2c852c1d0c09', -- muni: Look all the way to the Alps from the ridge-top garden 
  'f20b0d51-c9b8-4d5d-b927-5528362fc1a6', -- muni: Swim from the landscaped beach at 'Riemer See'.
  '89a57448-b400-4072-866e-82bb97fbdb03', -- muni: Swim from the lawn with an Alpine backdrop at 'Feldmoch
  'c4b020ca-0782-4b00-bf31-759462ab228f', -- none: Hike to 'Massai Point' at Chiricahua — half a mile, pav
  'b705fd0e-e65b-4879-888c-457b9cdf60eb', -- none: Watch the bats pour out from under the 'Campbell Bat Br
  '132a829f-12e3-407b-b619-0ecaba8ad73b', -- none: U-Pick at 'Apple Annies Orchard'
  'cefdfd05-ae2a-469d-909b-5f0b2e66af3d', -- phoe: Climb the observation tower and look for birds at 'Ripa
  '9eb2b2fb-5f66-49d7-8b81-92bf185cade2', -- phoe: Look for wild horses at 'Coon Bluff' near sunrise or su
  '666b1091-1a55-4a2c-a189-4f2b67e184fb', -- san-: Let your dog run off leash along North Beach at 'Del Ma
  'ed04483a-d01e-462a-ab03-da21261a667a', -- san-: Let your dog run straight into the Pacific at the 24-ho
  '6f619f95-85b3-4a5a-8dbf-c38400735312', -- san-: Watch the sun drop behind the coastal arches and sea ca
  'edb91dc8-4a23-4cf7-972a-ce3dc9403b79', -- tucs: Birdwatch at 'Sweetwater Wetlands' — a reclaimed-water 
  '647d3f64-5e01-4b2f-9157-0ebed8190f4a', -- tucs: Find the Signal Hill petroglyphs at 'Saguaro National P
  '3376deca-d431-492b-835e-46f7893abbbe', -- tucs: Identify three hummingbird species from the feeder benc
  '5fa906d9-c305-4bff-94db-69a7851250f3', -- tucs: Find the Last Supper carved in stone at 'Garden of Geth
  '57c92888-ed45-42e6-b94c-29294ea30efd', -- vien: Cool off beside the new water features and climate frie
  'd74bb8b1-4f20-495d-aaa5-aede7e70c1ae', -- vien: Find Beethoven-themed sculptures and green space at 'Be
  '9b8ce071-671c-4c2d-b44f-6e62f5120a3b', -- vien: Find the original tombstone of composer Joseph Haydn in
  '28760179-260f-4221-83cf-d1dd18416965', -- vien: Frame the Donauturm from Papstwiese while wandering thr
  '29595ffb-f830-4792-9dfc-6799b64a17b9', -- vien: Roam the garden grounds of 'Neugebäude Palace Unterer G
  'bed672a1-9b5b-4840-bd6d-7f6f5765087a', -- vien: Spot the Vienna Boys' Choir home tucked inside 'Augarte
  '27abcd08-61fa-47e9-ae0c-f8dd53f2d054', -- vien: Trade pavement for pocket park greenery at the transfor
  '18206059-6b81-47cc-a8e7-b4e64ab97e26', -- vien: Try all 24 exercise stations across the 21,000 m² outdo
  '1b797e9d-41b2-4cbc-8e12-704a60617847', -- vien: Wander the paths of 'Türkenschanzpark', one of Vienna's
  'fe2b0af5-0218-4ff3-963e-3dc47a7f08bb', -- vien: Slow down beside the koi pond and traditional tea house
  '5ba1b86f-deb2-43fc-ad4a-30984ca7fe50', -- vien: Cruise the concrete flowpark's bowl, flat rail and ledg
  '92ceef69-4432-4372-a6da-0edf4885b05b' -- vien: Pick your way onto the water at 'Alte Donau recreation 
);
UPDATE items SET visit_profile_key = 'manual_only', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  'b6416d2e-f771-437d-b9f9-8007600c0681', -- denv: Complete the lake loop at 'Waneka Lake Park'
  'd3e9f7cc-73ff-4148-913b-99c78817d409', -- denv: Complete the loop around 'McIntosh Lake'
  '2957baa5-270d-453e-bf0f-54b7e94ddb41', -- denv: Complete the loop around Smith and Grasmere lakes at 'W
  'aee81f04-b581-47aa-923d-cc2879a46b13', -- denv: Complete the Mount Carbon loop at 'Bear Creek Lake Park
  'dff1afbb-9684-4ba0-baf3-bdd00ef57fbd', -- denv: Find a dinosaur track or trace fossil along 'Triceratop
  'e85fae74-a640-4288-961f-116f82b1a067', -- denv: Hike from 'Windy Saddle Park' to the Beaver Brook overl
  'd463f0a3-2520-4d58-b9c4-3d334b3ab5e9', -- denv: Hike to the Blue Bird Mine bunkhouse and ore-cart track
  '7adebb0d-72e4-4906-990e-f242391999bd', -- denv: Hike to the first unobstructed Flatirons viewpoint from
  'c9ffca28-5a4f-4f6f-8cd7-9cbe08b8b489', -- denv: Hike two miles to Ralph Price Reservoir at 'Button Rock
  '70f84234-4de2-471b-8a33-d818834095d5', -- denv: Reach the stone arch on 'Royal Arch Trail'
  '22230bac-ab00-4e34-ae95-df977d37e800', -- denv: Reach the summit of 'Mount Sanitas Trail'
  '5ecda3c3-e40a-4698-83f5-e25fdfc96cdb', -- denv: Travel a continuous two mile segment of 'Boulder Creek 
  '597247fb-f09f-4f80-a2b6-5170643a9d81', -- denv: Walk around Ferril Lake for the skyline view at 'City P
  'a9ad1cca-9d0f-432f-b311-61707d4124ec', -- denv: Walk beside Clear Creek from Golden's welcome arch to '
  '29b6827c-2e59-4b21-9a15-ecbb7188a556', -- denv: Walk or bike a continuous two mile segment of 'St. Vrai
  '0c483c15-f425-4750-885f-5461d81f387c', -- denv: Walk the open space loop at 'Carolyn Holmberg Preserve 
  '7789de88-3bb0-47d6-bb5d-3504261230d9', -- denv: Choose and photograph your favorite mural along Larimer
  'db4f7371-6647-4df0-b3d5-aaee0eae67db', -- denv: Find the historic water tower while walking 'Olde Town 
  '46357f48-049a-4f90-b833-356ec0b2448b', -- denv: Meet under the Great Hall clock at 'Denver Union Statio
  'c4280d06-7aa1-4382-a4ec-1231fc6939e3', -- denv: Stroll Washington Avenue in downtown Golden and see the
  'f2d816b2-2f7c-4635-bd5e-0bcecf6e4e2c', -- denv: Complete the 14 mile party pace city loop with 'Denver 
  'b0a405a0-e56b-4c51-9777-8dcfa21456ca', -- gree: Bike or stroll the East River Trail through the 'Villag
  '3006d261-6715-4fdb-9586-4f1a50e23b9b', -- gree: Launch a kayak directly from the floating docks at the 
  'b715546b-751e-418b-9f4b-5ce1653af4f4', -- gree: Make a day of a festival like Art in the Park at 'Voyag
  'bfa2a421-c82d-471c-8bf0-df7d2b1aeea8', -- gree: Paddle a kayak, canoe, or paddleboard on one of the loc
  'f6b41a1c-a626-46d3-80a1-2f028bf68d64', -- gree: Play a round of disc golf or regular golf at the Howard
  'a9b8d736-32b0-4ab9-a3b3-5af88eb12ca7', -- gree: Spot wildlife and cross over to historic Government Isl
  '0ac44cf8-af30-4793-a972-e2e47b6ff1e2', -- milw: Hike at Devil's Lake
  '6d228cb9-c2a9-44e2-8ab3-aea4aed4ea1c', -- milw: Hike to 'Eagle Bluff Lighthouse' in Peninsula State Par
  '5691977a-f207-4f8e-9b25-817495c163d9', -- milw: Hike to the observation tower at 'Lapham Peak' — the cl
  'afd7ac79-830f-481d-b83e-dbcb2f35e151', -- milw: Kayak a hidden cove in Door County — rent from any outf
  '1d677ed6-63ef-4d36-b246-7c984e2a56d3', -- milw: Take the leaf-covered stairs through 'Lake Park' — fini
  '6d9c99b7-019e-4b6d-843f-74ea7dcf7ee9', -- milw: Walk across the causeway to 'Cana Island Lighthouse' an
  '6dcf910e-7e14-431c-a629-239bb5fb23a4', -- milw: Walk all Seven Bridges at 'Grant Park' — follow the rav
  '62e4c804-a369-4b09-84b5-66a6ddc83c03', -- milw: Walk the 'CityDeck' along the Fox River at dusk and adm
  'f91ccdba-c93d-4cd8-912a-0b6943948133', -- milw: Walk through 'Lakeshore State Park' to the red Pierhead
  '62978386-4404-417a-a74c-4563f0c3ea8b', -- milw: Figure out the meaning of the colors on the 'Flame' ato
  '5186363a-9e6d-41c6-86bf-bbe3d4339f44', -- milw: Sing along to a song you should not know at a ‘Pat McCu
  'e4aa2f0f-9e31-4c28-9d4e-5681479ebdf6', -- milw: Watch a Thunderstorm on Lake Drive
  '54b787ec-256f-498b-9415-c7943df6506e', -- milw: Go shopping in Kenosha
  '86a6ac96-8743-4632-99ed-f66b067b6470', -- milw: Hoist a stein at 'Milwaukee Oktoberfest' — spend an Oct
  'bfdb9965-b3cc-4109-850d-9ab6ae11c8aa', -- milw: Meet up for dinner and a walk around 'The Corners of Br
  '5f54d297-d19a-4f11-bc69-d8b0187aa8c6', -- milw: Ride 'The Hop' streetcar end to end — $0, connects the 
  '19735aa7-c202-41ae-81d2-369628510378', -- milw: Drive to Door County
  'd1cc546d-28fc-4f4d-90aa-22c983145093', -- milw: Roadtrip to Chicago for the day
  'd8a2c599-d05d-4829-9120-e555654a1b35', -- milw: Roadtrip to Madtown
  'dfea67c2-2204-4017-ad03-a50d7e4df240', -- muni: Hike the shaded gorge path along Maisinger Bach through
  '248aa3a6-34f1-4c2c-a94d-fa4c49913261', -- muni: Walk the long canal axis connecting the palace grounds 
  '72e9ed0c-eda8-41f9-bfcb-b2530f554511', -- muni: Walk to the end of the long lake pier at 'Herrsching'.
  'fd0428aa-5db4-4841-9a2a-b80b8f32c07f', -- muni: Bring a dish to the neighborhood Mitbringdinner at 'Gie
  '3be2cb4c-3cd3-4643-93dc-d7f33e348f42', -- muni: Join the Sunday 11 AM community ice bath in Schwabinger
  'f590b131-314b-4d69-bffb-e6666b9a01d9', -- none: Drive the scenic road through 'Chiricahua National Monu
  'd397b765-4148-4df6-b758-27a56ddf5901', -- none: Find 'Cochise Stronghold' in the Dragoon Mountains — th
  '29270440-d54a-44fb-b0ad-5c3469f9c487', -- none: Hike the 1.5 miles into 'Fort Bowie' — no road access, 
  '814f48c1-e01e-450f-b680-81008b89b693', -- none: Locate the grave of Warren Earp, the youngest brother o
  'f2c29c3b-3dc7-4dbf-9358-770ade99fe50', -- none: Pull over at 'Willcox Playa Wildlife Area' — a dry lake
  'e620f063-7ff1-4414-ba99-12ece149c7e7', -- none: Spot a coati, javelina, or black bear on a trail at 'Ch
  'd23154df-54c9-465a-8600-82aef25eda7a', -- none: Walk the wine trail on 'Railroad Avenue' — three tastin
  '504c8b29-71b3-4aa7-9a9a-2e9ca25146e9', -- none: Grab a meal at a downtown Willcox local spot — no chain
  'f79a3912-e922-4f84-8f12-fcecfd49b6ad', -- none: Visit the Art Museum
  '0e962119-2273-4ec7-b83c-5dd4e4982317', -- phoe: Book a narrated cruise on 'Lake Pleasant Cruises'
  '93dff330-cb60-4f4c-8950-ceda0583acbb', -- phoe: Climb all 340 'Victory Steps at Verrado' — look back ac
  '28f7fad9-a452-4f52-b59b-4dc6fe566e90', -- phoe: Find Petroglyph Plaza along ‘Waterfall Trail’ — treat a
  '6b20ad6c-5bd3-4c5f-82e2-db6e5b37cbc1', -- phoe: Float over the Sonoran Desert at sunrise with 'Hot Air 
  '2c5690bb-a231-4784-a6dc-856fe7c70bdd', -- phoe: Hike the Wind Cave Trail at 'Usery Mountain Regional Pa
  '31cc8039-6ba7-421d-920c-c95a9dd0e223', -- phoe: Hike up to the scenic overlook at 'Thunderbird Conserva
  '98211103-8965-4b43-8f95-ceb7aa577a17', -- phoe: Make your first tandem jump at 'Skydive Buckeye' — free
  '9372fa1a-4bfb-45cf-989c-d994dd9b70e5', -- phoe: Ride horseback through saguaros as the sun drops at “Ma
  '513b5a0e-c921-4665-a205-a3699219f4f8', -- phoe: Ride over the trestle and through the tunnel at 'Daisy 
  '32d34ade-6742-4356-9078-90ab40d30c6a', -- phoe: Start Sunday with a mimosa and live music aboard 'Deser
  'b1bd1b2a-0046-41b6-b88a-5d24995683b2', -- phoe: Walk the loop and cross the pedestrian bridge at 'Tempe
  '605f8046-83dd-4c42-828b-be773380eb54', -- phoe: Photograph three murals on three different Roosevelt bl
  'b5588e87-4755-4d23-a3fa-b0b8fd7f14c2', -- phoe: Hit up 5 different bars on Bell Road in one evening
  '9860f2be-53e3-494e-b1bc-7029c861f2bd', -- phoe: Sample some Rattlesnake
  '612087b5-1693-4c6a-abed-9c5482174ec8', -- phoe: Go 'Salt River Tubing'
  '973a4edd-7eee-45e7-93c1-d61fd679fe8d', -- phoe: Meet 5 natives of Arizona
  '48d111f6-382d-424d-99cd-86ed6973af34', -- phoe: Obtain a key from 'The Door Christian Fellowship'
  '478ed14f-551b-4d95-8f19-670d3b3ec354', -- phoe: Pick up a copy of 'PHOENIX magazine'
  'bf81c02d-215c-4d6e-9724-45daddf16454', -- phoe: Use the bathroom at 'W Scottsdale'
  '2e12df27-4f39-421b-9871-968223153bce', -- phoe: Visit two different 'Cold Beers & Cheeseburgers' locati
  '04791c78-b931-4416-a6fa-ba295a2053b7', -- phoe: Meet up for dinner and a movie at 'Park West'
  'f9cef870-f972-42b6-a6d2-64f2d5ca068d', -- phoe: Shop 'Agritopia Farm Night' after dark — buy something 
  '48170d86-18f8-4cca-9db3-9adb26a2b79b', -- phoe: Hike 'Camelback Mountain' to the top - 1,200 feet of cl
  'e993aa19-4070-4501-bb00-012d9b32842f', -- phoe: Walk the park loop or shoot hoops at 'Anthem Community 
  '1d7419e6-3da3-49d5-8e0a-f2858e917ca8', -- phoe: Drive out to the desert and stop to see the stars
  '30cb6b1d-2b51-4cf0-ab6f-cd87251f08ba', -- phoe: Road-trip to California
  '2c2bc759-c6d4-48ec-a934-7d0664c48cee', -- phoe: Road-trip to Las Vegas
  'c7e7fc00-74ea-4eb3-9cf8-99e199c1fcb7', -- san-: Fish the local kelp beds on a six-hour half-day trip fr
  'e9c79e21-94e6-4ac7-bb63-2ace3a794def', -- san-: Squeeze through the sandstone slot and climb to the lag
  '23798a84-8749-4c0c-8bb4-4048b21af246', -- san-: See what locals have dressed the Cardiff Kook as today 
  '1ca54f54-8c40-4dae-af1a-b7ba1a7b098a', -- san-: Shop South Park after dark during the quarterly 'South 
  '3513f62b-2998-429e-bbbc-734a685249ec', -- tucs: Book the sunset horseback ride at 'Tucson Mountain Stab
  '51194846-0cf3-4050-a230-cd66d616c2bf', -- tucs: Climb from cactus to pine forest on the 'Mount Lemmon S
  '4daf6892-15a9-4079-a673-55894074330f', -- tucs: Drive or bike the Cactus Forest Loop at 'Saguaro Nation
  'e55a828a-56f3-43f4-8f55-7470dc04c0b1', -- tucs: Drive the dirt switchbacks into ‘Redington Pass’ and lo
  'ab81bb28-6cf8-4b41-8ef7-44b652a03004', -- tucs: Hike to Seven Falls from ‘Sabino Canyon’ — take the Bea
  '645fa7b7-e201-48c6-b6e4-4e562ec8550a', -- tucs: Look through a stranger's telescope at 'Catalina State 
  '809a3822-4f3b-496d-84fe-d879c0136669', -- tucs: Ride the open-air chairlift to 9,150 feet at ‘Mount Lem
  '235384eb-1d66-44ee-ac47-c1b190943e6d', -- tucs: Take a sunset ride with 'Tattered Saddle' — cowboy-for-
  'f4954179-cff8-4adb-9948-7ee2eaca6168', -- tucs: Take the sunset trail ride at 'Houston’s Horseback Ridi
  '25d6a5dd-a2f5-4d4a-b1db-e0e64cd02a24', -- tucs: Walk into 'Saguaro National Park' after dark — bring a 
  '04e424e6-5266-40d9-ad22-048df6dbe7c3', -- tucs: Walk the paved hill at 'Tumamoc Hill' at sunrise and ea
  'b8bbe972-d786-4380-8f2a-cfc3e7d4f994', -- tucs: Light a candle at 'El Tiradito' — Tucson's hidden wishi
  'b4efe824-4d92-4a47-9545-6d5b59f56dd9', -- tucs: Walk through the belly of 'Rattlesnake Bridge' — the ta
  '6591473f-6f9f-4c9a-b0cb-3af4f1d98eba', -- tucs: Carry someone's memory through the 'All Souls Processio
  '9f56c442-31fc-47b7-a6e2-a3db5ee4ac2f', -- tucs: Catch the Summer Night Market at 'MSA Annex' — local ma
  '5e4718ef-5387-4e44-8213-e07ad4ab0ce3', -- tucs: Do the 'Fourth Avenue Street Fair' and find one weird t
  '27acfac8-2c83-4744-8f22-8a971f13765f', -- tucs: Eat food from three different cultures at 'Tucson Meet 
  'd0b50c9f-babf-4795-b73e-68bc255d9af2', -- tucs: Meet up for shops, food, music and outdoor events at th
  'ad61943d-bd01-49ba-a880-efecc07f7f04', -- tucs: Check off the 'Tucson Rodeo' — La Fiesta de los Vaquero
  'ee40c9c7-bb28-40a7-b10d-34f577afafd7', -- tucs: Ride part of 'The Loop' and stop somewhere local — coff
  'c541459d-434b-46b3-ad1d-3643c250885e', -- vien: Catch a free outdoor summer cultural event at 'Hyblerpa
  '5ead4794-32ab-4596-8f2b-a1aaae909aac', -- vien: Follow the bike and walking path connecting sections of
  '17b1f5b5-c289-46d4-b36d-dcd21bef9455', -- vien: Hike one of the 14 marked trails in the official networ
  '0349dd41-ceda-470c-a647-d872fe4a991e', -- vien: Launch from a 40 m tower and soar 380 m across the city
  'a340d4cd-19ea-4ee1-a443-d1b75f583038', -- vien: Tackle Austria’s only artificial whitewater course for 
  '8067f147-09b5-4948-9b4d-4ac63b88fa5f', -- vien: Take the Mistquiz, catch waste-management demonstration
  'ee6d06ca-e5e1-44ef-97d0-9e23529a255a', -- vien: Check out the reopened, modernized facilities at 'Sport
  '4bd02e7b-969c-4139-a51f-44080c82d26e' -- vien: Roll through streets normally reserved for cars on the 
);
UPDATE items SET visit_profile_key = 'attraction', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  'fd951015-7d8c-411e-b8dc-009b3c9ee2ec', -- denv: Step from Colorado into the tropics inside the conserva
  'eaa9fcfc-1a79-4918-b20e-3441171a9bf3', -- denv: Visit Buffalo Bill's grave and museum atop Lookout Moun
  '1b6be764-e626-4956-9094-6bc1404b2bae', -- denv: Complete the official behind-the-scenes tour of 'Empowe
  '711276ef-d3d6-4df2-b134-b42f64952447', -- denv: Conquer one television-inspired obstacle during open gy
  '92df86d6-4831-4410-b9ab-506308eeb25b', -- denv: Find the single purple row exactly 5,280 feet above sea
  '08893b11-d552-407a-a407-255625f949db', -- denv: Hear Olympic champion Connie Carpenter describe her gol
  '76b2794c-546e-4cd5-a42d-c8155cc6e482', -- denv: Kick a soccer ball into an oversized cup during a FootG
  '18a8eca9-2f2c-40c8-9c23-cf7eaca81cf8', -- denv: Knock out an opposing target with a foam-tipped arrow d
  'e212beee-1309-449d-bbd8-3d4952939712', -- denv: Practice skiing or snowboarding on an indoor revolving 
  '82fa9293-6e65-413b-8af2-8e0ff0495de4', -- denv: Try to clear all ten duckpins in three rolls at 'Winner
  '965449b4-443e-473c-b03d-8af6ab09d2b3', -- gree: Complete the ropes course, zip line, climbing, or free-
  '60729551-410f-4d12-9055-ca1ecf29b4f3', -- gree: Ride the classic midway attractions for free, then walk
  '6ad60ef3-39a5-4176-bec4-d2908e06b0c5', -- gree: Ride vintage amusement rides that date back to the earl
  'c9269d81-ddf0-4842-bc2c-8192d9af799a', -- gree: Step inside original and recreated buildings from the 1
  '6cf75ea1-c1b4-4353-89d3-e057489f1cac', -- gree: Step into 19th-century life through the interactive act
  'd453a66a-4c7b-4a6f-8902-ff8f3b9e92a7', -- gree: Tackle vertical climbing challenges at 'Odyssey Climbin
  '03c3f85e-857b-40a2-9e61-32055c72066c', -- gree: Wander the year-round display gardens at 'Green Bay Bot
  'e0e349d7-797f-4f79-b6bc-54413a9b10a2', -- gree: Go behind the scenes on a guided stadium tour, then exp
  'afbdef54-5815-495d-ac52-a16e31311177', -- gree: Tour Packers-related attractions at 'Lambeau Field'.
  '1fa40adb-9c48-4420-917d-9d606cb15718', -- milw: Climb the scenic tower at 'Holy Hill' during peak color
  'dc726ba7-b3d4-4cd2-b6cf-0de3984242b7', -- milw: Play a round of WhirlyBall at 'WhirlyBall'
  '95ace9d5-8d97-419b-876c-7278e2409d5d', -- milw: Tour the Pabst Mansion
  'fa30a438-f676-4baa-b72b-cc92b9da33b9', -- milw: Walk from the desert into the rainforest at the 'Mitche
  '7ce69692-494d-4b95-af37-66548dc88cb8', -- milw: Choose your favorite tiny head at the 'National Bobbleh
  '0e989089-e4fb-4241-923e-a9bbd44fd365', -- milw: Ice skate at the 'Pettit Center'
  'd2d4a91c-3762-4bc9-ad40-44b7b2a7cb82', -- milw: Walk through the players tunnel on the 'Lambeau Field' 
  'd765ae7f-e95a-42cf-bcb7-2cb576470532', -- muni: Book a session on the artificial surf wave at 'Surftown
  '5180b2a3-360a-4e20-a60b-7d205bca310e', -- muni: Climb the tallest route you can finish at 'DAV Kletter-
  '73c0db62-0904-46e1-9273-a798f4087fff', -- muni: Fly on the indoor wind stream at 'Jochen Schweizer Aren
  '6a74df6f-5707-4232-8cfc-a6be71408e27', -- muni: Ride the permanent standing wave in 25°C water at 'Joch
  'b837be8e-427c-4a13-a9c3-e33af29690f2', -- muni: Lace up for a public-skating session on one of the ice 
  '8a9759d7-960a-47c2-804f-285e074880b1', -- none: Stand in front of the 'Rex Allen Arizona Cowboy Museum'
  '02decd89-e890-406d-901d-d895a7a61b00', -- none: Walk through the 'Chiricahua Regional Museum' — Cochise
  '7460afab-244c-4f26-8912-ca08698ed299', -- none: Catch Sunday hours at the 'Gadsden-Pacific Toy Train Mu
  '3da83fb4-8a47-4fbe-a30c-52ac80175294', -- none: Buy into bingo at 'Casino Del Sol' — retired, reckless,
  'e2ff32d1-b7e4-49af-8d63-b9736bdd593d', -- phoe: Check out all the animals at the 'Phoenix Zoo'
  'f9d2860f-fd15-4be7-a202-771bd4375f2f', -- phoe: Find a petroglyph at 'Deer Valley Petroglyph Preserve' 
  'f3497e92-f378-4de1-8772-1d1b3c5e6a4b', -- phoe: Go underground at 'Goldfield Ghost Town' — tour the Mam
  '9737e1a3-6be0-4b6a-af37-aa477e3429f0', -- phoe: Race the electric karts at 'Andretti Indoor Karting & G
  '40b0a60c-bbda-4787-bd68-285d7716b597', -- phoe: Race up Arizona's only Olympic speed wall at 'Alta Clim
  'f0f52bd5-3e08-47e0-b906-40592f65a8fa', -- phoe: Ride the OdySea Voyager at 'OdySea Aquarium'
  '57f9b881-6337-4b4c-9164-a90768da6e1f', -- phoe: Step off a cliff platform at 'Revel Surf' — work your w
  '837201db-eab6-4376-8f2f-876e82d23619', -- phoe: Walk the 3D archery course at 'Joe Foss Shooting Comple
  'cb72f969-c8d8-47a0-b5b3-f7022affa37d', -- phoe: Pick the artwork you cannot stop staring at inside 'eye
  'bc53d01f-e358-418d-a781-de6d0a46d9e4', -- phoe: Play pinball at 'Castles N' Coasters'
  'ef867e68-1260-43fa-8510-86ecf6d9f392', -- phoe: Take some kids to 'Enchanted Island Amusement Park'
  '38cd872f-86ca-49cd-b7dc-27f2b7b1ca23', -- phoe: Complete a bite-drink-art crawl through 'The Pemberton'
  '1eccf551-67ed-4803-b946-be0ca7b212b9', -- phoe: Meet up for bowling and bar food at 'Uptown Alley'
  '7d3d36c7-b5dd-4ef4-9f9e-3dfa67854f19', -- phoe: Meet up for mini golf or the water park at 'Golfland Su
  '423067ac-a4eb-4f19-a886-0898f94c3beb', -- phoe: Meet up on the tee line at 'Topgolf Gilbert'
  'e2c3c81a-c807-4f12-80d7-71f66f728e17', -- phoe: Stand beside Rick Mears’s first Indy 500 winner at “Pen
  '069e0469-c580-4359-b7f7-e6e1b0de435a', -- san-: Feed one of the resident parrots during a reserved visi
  '2c8b82ac-2dc6-42c2-bc2d-8e0e138d7c41', -- san-: Walk through North America's largest living bamboo coll
  'd846c66b-b8be-4fa9-80a7-a33e3198c05b', -- san-: Watch the world's smallest penguins during the daily 10
  '8e44bab3-5b8d-437a-ad83-42123aae49f7', -- san-: Lace up for a public skating session at 'San Diego Ice 
  'f30b6f7d-6e6c-4c2c-99fe-776381faf3fa', -- san-: Play the historic nine-hole par-three course with renta
  '68565682-337a-40f7-8a9d-7e2c2bedc623', -- tucs: Boulder indoors at 'The BLOC Climbing + Fitness' — cact
  'fd8cef09-157f-42cd-988d-419696bebd91', -- tucs: Climb the color-coded boulders at 'Rocks and Ropes' — t
  'c0da435a-a63a-414d-ac75-2cc34acf1a82', -- tucs: Tour a desert cave then add a trail ride at 'Colossal C
  'b1334c92-80ae-4594-8740-2e721c6d8400', -- tucs: Turn the launch key during the simulated missile sequen
  '1aad20a2-c99a-45d9-af4e-33cf76d59938', -- tucs: Walk the desert-zoo loop at 'Arizona-Sonora Desert Muse
  '795cb0d9-e26c-4069-b1f9-bf6cbd3e09c6', -- tucs: Book a day pass at 'The L Offices' — unlimited coffee, 
  '83c7bf50-4bd6-418f-a031-ad2b8d269ee1', -- tucs: Find John Dillinger's chewed gum at the 'Coit Museum of
  '766500f8-cc8c-4c99-9584-7271b56764c8', -- tucs: Find the room you would live in at 'Mini Time Machine M
  '9b31ae11-5c9c-4a94-a112-7d0279d9b38b', -- tucs: Ride the mini train, see a stunt show or make it a west
  '37c91b05-2fd8-449c-b46a-d1907a0d97cd', -- tucs: Book a bay and compete with your crew at 'Topgolf Tucso
  'd93ce5f2-7ff2-457a-9a07-d4080e215cf0', -- vien: Climb routes up to 30 meters high on the exterior wall 
  '83ae9cc1-9a32-4881-8ee1-b80fe5335b84', -- vien: Enter the aquarium built inside a WWII flak tower at 'H
  '0ba24a56-a3dc-4aa9-b6f4-387037716b3e', -- vien: Lose yourself among the themed gardens at 'Blumengärten
  '237309c6-527d-4b4b-8f0e-9b82b11494a1', -- vien: Swim in the indoor or outdoor pools at 'Theresienbad'.
  'fd5bc898-210c-4188-9848-dfa76d47ce30', -- vien: Tackle multiple difficulty levels and flying foxes at t
  '2fddaae5-1454-4af5-9ab3-b36f817e1115', -- vien: Watch porcelain being crafted at the historic manufacto
  '863b4b69-15df-4f05-8cde-1b2c8403dc2c', -- vien: Descend into a historic monastic cellar for the hat mus
  'f84a3c15-5f10-47e1-8f46-1a825d1d1d4b', -- vien: Discover where Vienna’s famous original snow globes are
  '23b30689-d85e-480b-86c9-bc8c261954d1', -- vien: Pick a new activity from three independent sports halls
  '5bc67b5e-ca6c-484e-aa06-2f3c74854c4e', -- vien: Play a round of curling on one of six real ice lanes fl
  '6213343b-d11b-4296-b40c-13111a5161f0', -- vien: Take a dip in the indoor or outdoor pools at 'Großfelds
  'c5a60379-967f-4a72-9495-45870e060123', -- vien: Test your parkour or freerunning skills on the trampoli
  '9f2c49e1-082f-4605-9952-1b9b6ec29ea1' -- vien: Turn yourself into the video-game character on a Valo J
);
UPDATE items SET visit_profile_key = 'event', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  'fcd0dc1c-2418-42ca-8351-aaf0030a6532', -- denv: Complete the free 90 minute Tuesday tour at 'NOAA Bould
  '20bbd826-4191-444a-be21-1db1f3447fae', -- denv: Join a full moon ceremony inside 'The StarHouse'
  'cb54f001-4d13-4908-9127-f6e5826de0fd', -- denv: Bring any book, read silently for one hour, then stay f
  'bf4bf9b5-54f6-4e25-bfab-1003a7740d4d', -- denv: Share one improvised movement exchange during the Monda
  '34c1259a-3032-48a3-ab46-365adc6d60e9', -- denv: Take the mic for one song, poem or story at 'Butterscot
  '83fd1fec-da93-433d-9e57-529c12136683', -- denv: Learn why a biased bowl refuses to roll straight during
  '66b3a47c-7771-4044-bdae-1c4d433101fb', -- gree: Experience game day at Lambeau Field with the 'Green Ba
  '1029ac0a-ea66-4614-b345-6b7691194427', -- milw: Explore 'Pabst Mansion' by candlelight during 'Illumina
  '30165cb2-7e58-4d0d-b07d-8797d138d603', -- milw: Have your car ballet-parked at 'Comedy Sportz'
  '95166de5-e401-446e-8345-8d417eb78f56', -- muni: Book the official guided visit to see the Art Nouveau s
  '3f56e651-547d-45c7-8465-bea82fd670cd', -- muni: Book a Riso workshop and leave with your own two-color 
  'd981fbdc-92f4-4d5f-8143-f1b9f25abe17', -- none: Catch a movie at the 'Willcox Historic Theater' — 1936 
  '2144af07-9903-48a3-8172-8bf71a58c1d6', -- phoe: Wear a funny hat to 'Turf Paradise'
  'af1ffd3b-cab8-4041-b502-330ad3f2c38b', -- phoe: Eat something fried that shouldn't be fried at the 'Ari
  '2fa25d09-f4eb-4a77-b447-183e25de4d5b', -- phoe: Laugh your tail off at 'Stand Up Live'
  '9a770675-7947-4b01-aaec-58d983fa5e31', -- phoe: See a show at 'Tempe Improv'
  'd845fe24-0b23-4f80-921c-abb0861be2b3', -- phoe: See the Royals or Rangers up close at 'Surprise Stadium
  'c885f059-a07b-4be8-850f-16314f2fdd2b', -- phoe: Watch a future MLB starter play in front of 200 people 
  '321b0030-ccf0-4f39-a14d-86868aa843ce', -- san-: Walk onto the research-only 'Scripps Pier' at sunset du
  'a83a268d-55c7-4bf6-9025-f83d27890436', -- tucs: Descend into an operating copper mine on the guided ‘AS
  'fbacc07f-f4a5-457c-bfca-00a6317ea7fa', -- tucs: Look through the telescope at ‘Mount Lemmon SkyCenter’ 
  'da4df425-c214-48e1-8312-711d7909969e', -- tucs: Catch an open-event day at 'Valley of the Moon' — Tucso
  'cae76a70-27f3-428a-8412-f404f6aaa9ea', -- tucs: Go to a local improv show or take an intro class at 'Tu
  '9e6965e4-50f3-4def-957e-1fe99dc4911b', -- tucs: Hear Native American flute music echo through the canyo
  'b224e929-1c95-4c35-a597-5412dd1b37ad', -- tucs: Hear two live jazz sets inside ‘The Century Room’ — Tuc
  '22d9bea6-ba2d-4b4d-b7d0-17ee47f0769e', -- tucs: See a professional theatre performance in a historic Tu
  'e38eb3f6-6fe2-4307-b22f-d0b22db12ff9', -- tucs: See a show in Tucson's restored historic movie palace a
  'e0089842-e0ac-438a-990b-26eabfb74869', -- tucs: Watch an indie film or cult screening at 'The Loft Cine
  'ab3225d4-858a-49ce-9104-9d8b854f923b', -- tucs: Experience a Wildcats basketball game inside 'McKale Ce
  '44a4df36-9256-4879-b098-1e9e31a1c04d', -- tucs: Go to a 'Tucson Roadrunners' hockey game downtown.
  '29fbd2f7-f529-40fc-b25a-6a8ecd02b696', -- tucs: Go to a Wildcats football game and make it a Main Gate 
  '3fb935f1-9863-48cd-9ff8-47fa4b8e796f', -- tucs: Take the introductory class on the 42-degree banks at ‘
  'db4d2c86-2d41-4c0e-912b-50ec53d7cc83', -- vien: Join a public tour or attend an art event inside the WW
  'b93e901f-5493-4786-bdb0-90e936e3797f', -- vien: Learn to fall, spot and solve your first problems in th
  'a5144509-4d2d-42ea-b499-3589f93def1d' -- vien: Hear an orchestral concert during the Vienna Concerto F
);
UPDATE items SET visit_profile_key = 'bar', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  '1feb03e5-3546-4e91-af52-af25cdc0aaee', -- denv: Roll one wooden wheel closest to the feather on the cus
  'd34ed7be-a910-4b34-81e9-74e8ce1801b2', -- milw: Exit through the phone booth at 'SafeHouse Milwaukee'
  'd55d07c2-e5f8-4d56-a1ec-cfbc209c6e51', -- milw: Reserve the lanes at Holler House — human pinsetters st
  '5d15ae43-f561-492e-b64f-9a136d086558', -- none: Take a selfie with either owner of ‘Birds and Barrels V
  '3c706acd-9a4c-49eb-a46b-7503aed0c8a7', -- none: Drive out to 'Bodega Pierce' — estate-grown high desert
  '21fdc0b2-374f-4cdf-a0b9-02f7444b1825', -- none: Find 'Keeling Schaefer Vineyards' in the old Willcox Ba
  'cc5c1fbe-4f53-4e84-813f-06319584bef9', -- none: Roll dice over a beer at 'Short Rest Tavern' — board-ga
  'e2f5020d-37c1-4e53-8076-158173b65316', -- none: Stop into 'Flying Leap Vineyards' downtown — local wine
  '84b3ad09-120b-46fa-8e5d-b2339bdcb82d', -- none: Taste something unexpected at 'Aridus Wine Company' — A
  '1dd744f4-f1b4-44d9-ab3c-17c3cc6ec0f3', -- phoe: Rent a pool table at 'Main Street Billiards'
  '831ce5fb-4495-41b2-94e2-a982285a33dd', -- phoe: Order a 'Ricky Ricardo' at 'ZuZu' @ the 'Hotel Valley H
  '3e30d26a-a865-402f-8801-17d62469b37a', -- phoe: Rub a tiki god's belly at 'Undertow'
  '0319cc7d-6b5b-4fb8-87bd-852c86ea582c', -- phoe: Spin the wheel at 'Gilligan's Bar & Grill'
  '8eedb58d-a785-40c4-ace6-94f97d471721', -- phoe: Check out a band at 'The Dubliner Irish Pub'
  'f32ab6ef-fba3-493c-aa4d-97634bb80dd0', -- phoe: Duck into the speakeasy and order a classic cocktail at
  'be2537cf-4eb5-4636-b37c-198ec0519ccb', -- tucs: Spend a night at 'Hotel Congress' — music, history and 
  'a27c1399-4649-40e1-9725-faef905e3816', -- vien: Catch one of the every-other-week live bands while drin
  '1d8642e7-67ad-4413-8899-2cbf081eb2cb' -- vien: Pick from more than 1,200 games and pair your choice wi
);
UPDATE items SET visit_profile_key = 'retail', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  '364a0ddb-c7a3-4e84-a317-22d7a14c3f10', -- milw: Browse 'Lion's Mouth Bookstore' and leave with somethin
  'd07f42cf-59cb-4060-afae-c656e929d545', -- none: Touch the walls of the 'Willcox Commercial Store' — the
  'c8500323-45a3-4d6b-b4cd-e91c19f6cc64' -- vien: Pick up a handmade Viennese porcelain piece at 'feinedi
);
UPDATE items SET visit_profile_key = 'restaurant', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  '7018a16a-fc6f-4bc6-a3a2-ce8f097fb87c', -- none: Grill your own meat at 'Rix's Tavern'
  'daf77fc6-c446-4999-bfad-75584070ad8f', -- none: Order the brisket at 'Big Tex BBQ' — yes, it's in a 192
  '9a0b18fe-029d-40a0-a675-66a057d16eab', -- none: Order the jalapeño popper dog at 'The Blacktop Grill' —
  '021777c5-7903-43b2-be52-035007d2891d', -- none: Order the tonkatsu ramen at 'Ikkyu' — strip-mall bowls 
  'ecf40687-62af-4ef7-845d-05ff25f20e55', -- phoe: Enter Durant's through the kitchen and order a steak wi
  'b4d77c1c-0915-44f2-b9bd-0d72a7107166', -- phoe: Fill out a comment card at 'Carlos O'Brien's Mexican Re
  '0af3ff2d-a276-45db-af9a-0276a5d44b89', -- phoe: Order the Cardinal Burger at 'Big's American Bar & Gril
  'a19f1c52-5387-498b-972a-50f9e1fc191a', -- phoe: Take a picture with friends at 'Pasta Brioni'
  'c438fb57-466d-4e30-9ba1-30036ab3949a', -- vien: Build an Austrian tapas tasting around Viennese snails 
  'db11bd0b-5110-49b0-bfba-99857389b6de' -- vien: Build a meal from regional producer stalls, then claim 
);
DO $$ BEGIN IF (SELECT count(*) FROM items WHERE visit_profile_source='curated_2026-09-29' AND visit_profile_key IS NOT NULL) < 310 THEN RAISE EXCEPTION 'reviewed profiles not all applied'; END IF; END $$;
COMMIT;
