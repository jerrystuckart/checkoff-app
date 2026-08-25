-- Denver catalog Checkoffization pass -- body/checkin_type UPDATE
-- Generated from ChatGPT's 149-item audit CSV, cross-checked against
-- Denver Art Museum, Broomfield 9/11 Memorial, American Mountaineering Museum,
-- WOW! Children's Museum, Coors Field, Temaki Den/The Source, and 300 Suns Brewing
-- via live web search before being included below.
--
-- Scope: 43 of the 44 REWRITE rows. 101 KEEP rows need no change (proposed_body
-- == current_body). The 4 HOLD rows are untouched. One REWRITE row -- Museum of
-- Boulder / Connie Carpenter (item_id 08893b11-d552-407a-a407-255625f949db) -- is
-- deliberately excluded: two separate fetches of the museum's own current exhibit
-- listings (museumofboulder.org/exhibits/) show no Connie Carpenter/bicycle/audio
-- exhibit at all. Do not run that one until verified directly (call the museum),
-- then add it back in the same pattern as the rows below.
--
-- Each UPDATE is guarded by AND body = '<current production body>' so a row only
-- changes if it still matches exactly what's live today -- if CC's insert drifted
-- from this audit in any way, that row's WHERE clause simply won't match and the
-- postflight count check below will catch it, instead of silently overwriting the
-- wrong row.
--
-- The 43-row expected-values list is expressed as a CTE (no persistent temp table)
-- and is repeated in the preflight check, the postflight check, and the final
-- review SELECT, since a CTE only lives for the single statement it's attached to
-- -- unlike a temp table, it can't be created once and reused across separate
-- statements/DO blocks in the same transaction. All three copies are generated
-- from the same source data, so they're identical.

BEGIN;

DO $do$
BEGIN
  IF EXISTS (
    WITH expected(item_id, expected_current_body) AS (
      VALUES
      ('d8f8912d-915b-4814-982b-c5fcb2c5a014'::uuid, $ckbody$Explore the newly renovated 'Denver Public Library Central Library' and find one Colorado collection item$ckbody$),
      ('b2e1e100-f9c6-4ca0-bd1a-1c1ff57c8460'::uuid, $ckbody$Find one work in the Indigenous Arts of North America galleries at 'Denver Art Museum'$ckbody$),
      ('476cf174-504c-45c5-b520-233c28a5ac40'::uuid, $ckbody$Step inside one hands on Colorado story at 'History Colorado Center'$ckbody$),
      ('f28dc3de-c7d9-4a4f-97ad-7969cc8dbad7'::uuid, $ckbody$Choose your favorite Clyfford Still painting at 'Clyfford Still Museum'$ckbody$),
      ('c9d51017-0e7a-4347-89fe-3f377a46b748'::uuid, $ckbody$Order a bite inside the 1870s iron foundry turned market hall at 'The Source Hotel and Market Hall'$ckbody$),
      ('dd31c3a5-ed03-4fe0-9c9b-f64f0a8d7da6'::uuid, $ckbody$Learn one Five Points story at 'Blair Caldwell African American Research Library'$ckbody$),
      ('36911e65-55e4-4e9c-a3e4-b1b04fb8c5cc'::uuid, $ckbody$Hear a live jazz set at 'Nocturne'$ckbody$),
      ('1a2689a8-2570-4c4a-b6cd-1a858e7fe25c'::uuid, $ckbody$Try a beer brewed on Larimer Street at 'Ratio Beerworks'$ckbody$),
      ('97f5eea0-84a3-42aa-a433-94b3f2d41d87'::uuid, $ckbody$Attend a concert at 'The Mission Ballroom'$ckbody$),
      ('d1e1d2aa-7f1f-433f-9a0f-3a460ad50063'::uuid, $ckbody$Pair a food truck order with the courtyard at 'Improper City'$ckbody$),
      ('3bc7e5ce-f628-4ce5-87aa-813130006ed9'::uuid, $ckbody$Build a two stop snack crawl inside 'Denver Central Market'$ckbody$),
      ('ff527e9f-a178-45e7-9fcb-33877303ef21'::uuid, $ckbody$See a live show inside historic Five Points at 'Cervantes Masterpiece Ballroom'$ckbody$),
      ('13772396-c850-44b2-a008-465013e49efb'::uuid, $ckbody$See the current exhibition, then visit the rooftop at 'Museum of Contemporary Art Denver'$ckbody$),
      ('822f114b-ec19-4c23-8d09-33e6a1bce703'::uuid, $ckbody$Find the alley art installation at 'Dairy Block Alley'$ckbody$),
      ('92df86d6-4831-4410-b9ab-506308eeb25b'::uuid, $ckbody$Watch the Rockies play or take a stadium tour at 'Coors Field'$ckbody$),
      ('05655893-cb5d-45f1-8210-b3bb652b884d'::uuid, $ckbody$Drink a house beer inside Denver's original brewpub at 'Wynkoop Brewing Company'$ckbody$),
      ('de1208e6-fcb6-4f15-a430-449fc9ca2da1'::uuid, $ckbody$Find an animal species you have never seen in person at 'Denver Zoo Conservation Alliance'$ckbody$),
      ('7dd7f28f-7228-4097-8f25-7cbaa7bfd614'::uuid, $ckbody$See a show beneath the marquee at 'Ogden Theatre'$ckbody$),
      ('04bf3f18-8e08-4f09-8671-17f6f3fd65b6'::uuid, $ckbody$Tour 'Molly Brown House Museum' and learn one fact about the Unsinkable Molly Brown$ckbody$),
      ('c9cf5edc-82db-49d6-80a9-2cfb13b82945'::uuid, $ckbody$Have a bite inside the former mortuary building at 'Linger'$ckbody$),
      ('e1f92e2e-66b6-4254-b6dc-34bdcee540f6'::uuid, $ckbody$See a show at the historic 'Oriental Theater'$ckbody$),
      ('afc95660-f347-4e21-b697-8b987fb4db1d'::uuid, $ckbody$Learn one coal mining era story at 'Louisville Historical Museum'$ckbody$),
      ('c83d85bd-3f44-48dc-9ac8-042f4946eb11'::uuid, $ckbody$See a local exhibition or program at 'The Collective Community Arts Center'$ckbody$),
      ('bab4b62a-72e5-4578-a662-de0263f1e2a2'::uuid, $ckbody$Complete one hands on exhibit challenge at 'WOW! Children's Museum'$ckbody$),
      ('1cb0161d-464c-4fee-bcb0-3e4e735ac4f0'::uuid, $ckbody$See an exhibition or performance at 'Arvada Center for the Arts and Humanities'$ckbody$),
      ('9e443f77-e115-4347-b0ff-21f33e55577c'::uuid, $ckbody$Read the stories behind the artifacts at 'Broomfield 9/11 Memorial'$ckbody$),
      ('897bab12-c398-405e-a749-a7bec3fe4692'::uuid, $ckbody$Step inside one preserved twentieth century building at 'Heritage Lakewood Belmar Park'$ckbody$),
      ('0a223411-6c06-45b5-bfa5-0a02be08f50f'::uuid, $ckbody$Learn one Colorado climbing story at 'American Mountaineering Museum'$ckbody$),
      ('dcedc561-9f46-4083-8b9a-4b81ccd8ede4'::uuid, $ckbody$Build a flight of Boulder brewed beers at 'Avery Brewing Company'$ckbody$),
      ('dd20c7d4-0a92-46ad-9531-a4977cc7dea9'::uuid, $ckbody$See a live show on The Hill at 'Fox Theatre Boulder'$ckbody$),
      ('63bfd734-9dc2-4211-9030-11eee9101d7d'::uuid, $ckbody$Explore the public exhibits and step onto the terrace at 'NCAR Mesa Laboratory'$ckbody$),
      ('218678c7-c7f7-40f5-8131-1dcec8ac028b'::uuid, $ckbody$See a film, talk or live show beneath the marquee at 'Boulder Theater'$ckbody$),
      ('1fb94167-c521-43a8-ac26-8cf61b61b306'::uuid, $ckbody$Order one globally inspired small plate and a cocktail or mocktail at 'The Passenger'$ckbody$),
      ('e0b82e7f-c02d-458a-907e-55898f99bd85'::uuid, $ckbody$Drink a lager in the pavilion or beer garden at 'Wibby Brewing'$ckbody$),
      ('89bab711-c679-4b6e-9145-e7e7ba6d47a3'::uuid, $ckbody$Choose a cheese you have never tried from the market at 'Cheese Importers'$ckbody$),
      ('12792398-76f2-4a51-aef1-551a284d0d9f'::uuid, $ckbody$Learn one Boulder County farm story at 'Agricultural Heritage Center'$ckbody$),
      ('bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b'::uuid, $ckbody$Try a locally distilled spirit during a guided tasting at 'Dry Land Distillers'$ckbody$),
      ('6607f6bb-d9f3-4baa-8951-511c1cf995ea'::uuid, $ckbody$Pair a house beer with the kitchen's signature chicken at '300 Suns Brewing'$ckbody$),
      ('91027c2c-69cf-4ceb-860f-e89e80e45397'::uuid, $ckbody$Build a flight of Colorado ciders at 'St. Vrain Cidery'$ckbody$),
      ('8bcfe55d-7fb5-41cc-ac00-287c18647b0b'::uuid, $ckbody$Order a Longmont made spirit or cocktail at 'Abbott and Wallace Distilling'$ckbody$),
      ('754b6bdc-4b87-4c55-8b3f-0b36f3606990'::uuid, $ckbody$Try an Oskar Blues beer at the source inside 'Tasty Weasel Taproom'$ckbody$),
      ('91a2093e-1eba-4ec6-badc-74de0a749e15'::uuid, $ckbody$Take the brewery tour or a guided tasting at 'Left Hand Brewing Company'$ckbody$),
      ('fde1d318-c462-4c5a-88b8-95ffae4dab86'::uuid, $ckbody$See a performance inside the historic 'Dickens Opera House'$ckbody$)
    )
    SELECT 1
    FROM expected e
    LEFT JOIN public.items i ON i.id = e.item_id
    WHERE i.id IS NULL OR i.body <> e.expected_current_body
  ) THEN
    RAISE EXCEPTION 'One or more Denver items have drifted from the audited body text -- stop and reconcile before updating';
  END IF;
END
$do$;

-- Denver Public Library — Central Library  [HIGH]
UPDATE public.items SET
    body = $ckbody$Find a historic photograph of a Denver street you recognize in the Western History Collection at 'Denver Public Library Central Library'$ckbody$
  WHERE id = 'd8f8912d-915b-4814-982b-c5fcb2c5a014'::uuid
    AND body = $ckbody$Explore the newly renovated 'Denver Public Library Central Library' and find one Colorado collection item$ckbody$;

-- Denver Art Museum  [HIGH]
UPDATE public.items SET
    body = $ckbody$Find the cheekily hidden signature on the bottom of the nearly 11-foot 'Mud Woman Rolls On' at 'Denver Art Museum'$ckbody$,
    checkin_type = 'photo'
  WHERE id = 'b2e1e100-f9c6-4ca0-bd1a-1c1ff57c8460'::uuid
    AND body = $ckbody$Find one work in the Indigenous Arts of North America galleries at 'Denver Art Museum'$ckbody$;

-- History Colorado Center  [MEDIUM]
UPDATE public.items SET
    body = $ckbody$Launch yourself from the virtual Steamboat Springs ski jump at 'History Colorado Center'$ckbody$
  WHERE id = '476cf174-504c-45c5-b520-233c28a5ac40'::uuid
    AND body = $ckbody$Step inside one hands on Colorado story at 'History Colorado Center'$ckbody$;

-- Clyfford Still Museum  [HIGH]
UPDATE public.items SET
    body = $ckbody$Peer through the windows into the working conservation lab at 'Clyfford Still Museum'$ckbody$
  WHERE id = 'f28dc3de-c7d9-4a4f-97ad-7969cc8dbad7'::uuid
    AND body = $ckbody$Choose your favorite Clyfford Still painting at 'Clyfford Still Museum'$ckbody$;

-- The Source Hotel + Market Hall  [HIGH]
UPDATE public.items SET
    body = $ckbody$Eat a cylindrical hand roll while the rice is warm and the nori still crisp at 'Temaki Den' inside 'The Source Hotel and Market Hall'$ckbody$
  WHERE id = 'c9d51017-0e7a-4347-89fe-3f377a46b748'::uuid
    AND body = $ckbody$Order a bite inside the 1870s iron foundry turned market hall at 'The Source Hotel and Market Hall'$ckbody$;

-- Blair-Caldwell African American Research Library  [HIGH]
UPDATE public.items SET
    body = $ckbody$Step into the replica office of former mayor Wellington Webb at 'Blair-Caldwell African American Research Library'$ckbody$,
    checkin_type = 'photo'
  WHERE id = 'dd31c3a5-ed03-4fe0-9c9b-f64f0a8d7da6'::uuid
    AND body = $ckbody$Learn one Five Points story at 'Blair Caldwell African American Research Library'$ckbody$;

-- Nocturne  [HIGH]
UPDATE public.items SET
    body = $ckbody$Pair a live jazz set with the five-course 'Ellington Experience' beneath the Art Deco staircase at 'Nocturne'$ckbody$
  WHERE id = '36911e65-55e4-4e9c-a3e4-b1b04fb8c5cc'::uuid
    AND body = $ckbody$Hear a live jazz set at 'Nocturne'$ckbody$;

-- Ratio Beerworks  [HIGH]
UPDATE public.items SET
    body = $ckbody$Order the GABF medal-winning 'Dear You' French saison at 'Ratio Beerworks'$ckbody$
  WHERE id = '1a2689a8-2570-4c4a-b6cd-1a858e7fe25c'::uuid
    AND body = $ckbody$Try a beer brewed on Larimer Street at 'Ratio Beerworks'$ckbody$;

-- The Mission Ballroom  [HIGH]
UPDATE public.items SET
    body = $ckbody$Watch a concert from the tiered bowl built around the movable stage at 'The Mission Ballroom'$ckbody$
  WHERE id = '97f5eea0-84a3-42aa-a433-94b3f2d41d87'::uuid
    AND body = $ckbody$Attend a concert at 'The Mission Ballroom'$ckbody$;

-- Improper City  [HIGH]
UPDATE public.items SET
    body = $ckbody$Play a board game beside the firepits on the graffiti-lined patio at 'Improper City'$ckbody$
  WHERE id = 'd1e1d2aa-7f1f-433f-9a0f-3a460ad50063'::uuid
    AND body = $ckbody$Pair a food truck order with the courtyard at 'Improper City'$ckbody$;

-- Denver Central Market  [HIGH]
UPDATE public.items SET
    body = $ckbody$Peel apart one of Izzio Bakery's caramelized 'Queen' kouign-amann pastries inside 'Denver Central Market'$ckbody$
  WHERE id = '3bc7e5ce-f628-4ce5-87aa-813130006ed9'::uuid
    AND body = $ckbody$Build a two stop snack crawl inside 'Denver Central Market'$ckbody$;

-- Cervantes' Masterpiece Ballroom  [HIGH]
UPDATE public.items SET
    body = $ckbody$Catch two concerts under one roof on a Dual Venue night at 'Cervantes Masterpiece Ballroom'$ckbody$
  WHERE id = 'ff527e9f-a178-45e7-9fcb-33877303ef21'::uuid
    AND body = $ckbody$See a live show inside historic Five Points at 'Cervantes Masterpiece Ballroom'$ckbody$;

-- Museum of Contemporary Art Denver  [HIGH]
UPDATE public.items SET
    body = $ckbody$End the current exhibition with a craft cocktail on the rooftop at 'Museum of Contemporary Art Denver'$ckbody$
  WHERE id = '13772396-c850-44b2-a008-465013e49efb'::uuid
    AND body = $ckbody$See the current exhibition, then visit the rooftop at 'Museum of Contemporary Art Denver'$ckbody$;

-- Dairy Block Alley  [MEDIUM]
UPDATE public.items SET
    body = $ckbody$Make music with the interactive dairy-churn sculpture in 'Dairy Block Alley'$ckbody$
  WHERE id = '822f114b-ec19-4c23-8d09-33e6a1bce703'::uuid
    AND body = $ckbody$Find the alley art installation at 'Dairy Block Alley'$ckbody$;

-- Coors Field  [HIGH]
UPDATE public.items SET
    body = $ckbody$Find the single purple row exactly 5,280 feet above sea level inside 'Coors Field'$ckbody$,
    checkin_type = 'photo'
  WHERE id = '92df86d6-4831-4410-b9ab-506308eeb25b'::uuid
    AND body = $ckbody$Watch the Rockies play or take a stadium tour at 'Coors Field'$ckbody$;

-- Wynkoop Brewing Company  [MEDIUM]
UPDATE public.items SET
    body = $ckbody$Play a game of shuffleboard upstairs with a 'Rail Yard Ale' at 'Wynkoop Brewing Company'$ckbody$
  WHERE id = '05655893-cb5d-45f1-8210-b3bb652b884d'::uuid
    AND body = $ckbody$Drink a house beer inside Denver's original brewpub at 'Wynkoop Brewing Company'$ckbody$;

-- Denver Zoo Conservation Alliance  [HIGH]
UPDATE public.items SET
    body = $ckbody$Walk eye-to-eye with red kangaroos and wallabies along Wallaby Way in 'Down Under' at 'Denver Zoo Conservation Alliance'$ckbody$,
    checkin_type = 'photo'
  WHERE id = 'de1208e6-fcb6-4f15-a430-449fc9ca2da1'::uuid
    AND body = $ckbody$Find an animal species you have never seen in person at 'Denver Zoo Conservation Alliance'$ckbody$;

-- Colfax Avenue — Ogden Theatre  [HIGH]
UPDATE public.items SET
    body = $ckbody$See a show in the century-old room where Harry Houdini once performed at 'Ogden Theatre'$ckbody$
  WHERE id = '7dd7f28f-7228-4097-8f25-7cbaa7bfd614'::uuid
    AND body = $ckbody$See a show beneath the marquee at 'Ogden Theatre'$ckbody$;

-- Molly Brown House Museum  [MEDIUM]
UPDATE public.items SET
    body = $ckbody$Spot the original light fixture in the foyer during a tour of 'Molly Brown House Museum'$ckbody$
  WHERE id = '04bf3f18-8e08-4f09-8671-17f6f3fd65b6'::uuid
    AND body = $ckbody$Tour 'Molly Brown House Museum' and learn one fact about the Unsinkable Molly Brown$ckbody$;

-- Linger  [MEDIUM]
UPDATE public.items SET
    body = $ckbody$Eat a street-food plate beneath the old 'Olinger Mortuaries' rooftop sign at 'Linger'$ckbody$
  WHERE id = 'c9cf5edc-82db-49d6-80a9-2cfb13b82945'::uuid
    AND body = $ckbody$Have a bite inside the former mortuary building at 'Linger'$ckbody$;

-- The Oriental Theater  [HIGH]
UPDATE public.items SET
    body = $ckbody$Watch a show from the 100-seat balcony inside the old movie palace at 'The Oriental Theater'$ckbody$
  WHERE id = 'e1f92e2e-66b6-4254-b6dc-34bdcee540f6'::uuid
    AND body = $ckbody$See a show at the historic 'Oriental Theater'$ckbody$;

-- Louisville Historical Museum  [HIGH]
UPDATE public.items SET
    body = $ckbody$Find the six-foot replica of historic downtown inside 'Louisville Historical Museum'$ckbody$,
    checkin_type = 'photo'
  WHERE id = 'afc95660-f347-4e21-b697-8b987fb4db1d'::uuid
    AND body = $ckbody$Learn one coal mining era story at 'Louisville Historical Museum'$ckbody$;

-- The Collective Community Arts Center  [HIGH]
UPDATE public.items SET
    body = $ckbody$Pick up the free art-kit inspired by the current exhibition at 'The Collective Community Arts Center'$ckbody$
  WHERE id = 'c83d85bd-3f44-48dc-9ac8-042f4946eb11'::uuid
    AND body = $ckbody$See a local exhibition or program at 'The Collective Community Arts Center'$ckbody$;

-- WOW! Children's Museum  [HIGH]
UPDATE public.items SET
    body = $ckbody$Pull yourself toward the ceiling in a pulley chair at 'WOW! Children's Museum'$ckbody$,
    checkin_type = 'photo'
  WHERE id = 'bab4b62a-72e5-4578-a662-de0263f1e2a2'::uuid
    AND body = $ckbody$Complete one hands on exhibit challenge at 'WOW! Children's Museum'$ckbody$;

-- Arvada Center for the Arts and Humanities  [HIGH]
UPDATE public.items SET
    body = $ckbody$Play one artist's audio story beside their large-scale work in the free Sculpture Field at 'Arvada Center'$ckbody$
  WHERE id = '1cb0161d-464c-4fee-bcb0-3e4e735ac4f0'::uuid
    AND body = $ckbody$See an exhibition or performance at 'Arvada Center for the Arts and Humanities'$ckbody$;

-- Broomfield 9/11 Memorial  [HIGH]
UPDATE public.items SET
    body = $ckbody$Find the piece of fallen Twin Towers steel embedded in a bronze figure at 'Broomfield 9/11 Memorial'$ckbody$,
    checkin_type = 'photo'
  WHERE id = '9e443f77-e115-4347-b0ff-21f33e55577c'::uuid
    AND body = $ckbody$Read the stories behind the artifacts at 'Broomfield 9/11 Memorial'$ckbody$;

-- Heritage Lakewood Belmar Park  [HIGH]
UPDATE public.items SET
    body = $ckbody$Step inside the 1948 Valentine diner and the 1920s country school on a tour of 'Heritage Lakewood Belmar Park'$ckbody$
  WHERE id = '897bab12-c398-405e-a749-a7bec3fe4692'::uuid
    AND body = $ckbody$Step inside one preserved twentieth century building at 'Heritage Lakewood Belmar Park'$ckbody$;

-- American Mountaineering Museum  [HIGH]
UPDATE public.items SET
    body = $ckbody$Find Jim Whittaker's gear from the first American ascent of Everest at 'American Mountaineering Museum'$ckbody$,
    checkin_type = 'photo'
  WHERE id = '0a223411-6c06-45b5-bfa5-0a02be08f50f'::uuid
    AND body = $ckbody$Learn one Colorado climbing story at 'American Mountaineering Museum'$ckbody$;

-- Avery Brewing Company  [MEDIUM]
UPDATE public.items SET
    body = $ckbody$Build a flight around 'White Rascal' and the taproom-exclusive 'Out of Bounds' stout at 'Avery Brewing Company'$ckbody$
  WHERE id = 'dcedc561-9f46-4083-8b9a-4b81ccd8ede4'::uuid
    AND body = $ckbody$Build a flight of Boulder brewed beers at 'Avery Brewing Company'$ckbody$;

-- Fox Theatre Boulder  [MEDIUM]
UPDATE public.items SET
    body = $ckbody$See a concert beneath the original movie-theater marquee in the 625-capacity 'Fox Theatre Boulder'$ckbody$
  WHERE id = 'dd20c7d4-0a92-46ad-9531-a4977cc7dea9'::uuid
    AND body = $ckbody$See a live show on The Hill at 'Fox Theatre Boulder'$ckbody$;

-- NCAR Mesa Laboratory  [HIGH]
UPDATE public.items SET
    body = $ckbody$Follow the outdoor Weather Trail behind I.M. Pei's 'NCAR Mesa Laboratory'$ckbody$
  WHERE id = '63bfd734-9dc2-4211-9030-11eee9101d7d'::uuid
    AND body = $ckbody$Explore the public exhibits and step onto the terrace at 'NCAR Mesa Laboratory'$ckbody$;

-- Boulder Theater  [HIGH]
UPDATE public.items SET
    body = $ckbody$Find the elaborate Art Deco murals inside while seeing a show at 'Boulder Theater'$ckbody$,
    checkin_type = 'photo'
  WHERE id = '218678c7-c7f7-40f5-8131-1dcec8ac028b'::uuid
    AND body = $ckbody$See a film, talk or live show beneath the marquee at 'Boulder Theater'$ckbody$;

-- The Passenger  [MEDIUM]
UPDATE public.items SET
    body = $ckbody$Sip the blue-raspberry 'Petra' cocktail with Pop Rocks at 'The Passenger'$ckbody$
  WHERE id = '1fb94167-c521-43a8-ac26-8cf61b61b306'::uuid
    AND body = $ckbody$Order one globally inspired small plate and a cocktail or mocktail at 'The Passenger'$ckbody$;

-- Wibby Brewing  [HIGH]
UPDATE public.items SET
    body = $ckbody$Cool off with a 'Lightshine Radler' blending award-winning helles and house-made raspberry lemonade at 'Wibby Brewing'$ckbody$
  WHERE id = 'e0b82e7f-c02d-458a-907e-55898f99bd85'::uuid
    AND body = $ckbody$Drink a lager in the pavilion or beer garden at 'Wibby Brewing'$ckbody$;

-- Cheese Importers  [HIGH]
UPDATE public.items SET
    body = $ckbody$Step into the walk-in Cheese Room and ask for a wedge you have never tasted at 'Cheese Importers'$ckbody$
  WHERE id = '89bab711-c679-4b6e-9145-e7e7ba6d47a3'::uuid
    AND body = $ckbody$Choose a cheese you have never tried from the market at 'Cheese Importers'$ckbody$;

-- Agricultural Heritage Center  [HIGH]
UPDATE public.items SET
    body = $ckbody$Climb into the real tractor cab inside the big red barn at 'Agricultural Heritage Center'$ckbody$,
    checkin_type = 'photo'
  WHERE id = '12792398-76f2-4a51-aef1-551a284d0d9f'::uuid
    AND body = $ckbody$Learn one Boulder County farm story at 'Agricultural Heritage Center'$ckbody$;

-- Dry Land Distillers  [HIGH]
UPDATE public.items SET
    body = $ckbody$Taste the smoky spirit distilled from native prickly pear cactus at 'Dry Land Distillers'$ckbody$
  WHERE id = 'bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b'::uuid
    AND body = $ckbody$Try a locally distilled spirit during a guided tasting at 'Dry Land Distillers'$ckbody$;

-- 300 Suns Brewing  [HIGH]
UPDATE public.items SET
    body = $ckbody$Finish 'The Reaper' Nashville hot chicken and earn the survivor sticker at '300 Suns Brewing'$ckbody$,
    checkin_type = 'photo'
  WHERE id = '6607f6bb-d9f3-4baa-8951-511c1cf995ea'::uuid
    AND body = $ckbody$Pair a house beer with the kitchen's signature chicken at '300 Suns Brewing'$ckbody$;

-- St. Vrain Cidery  [HIGH]
UPDATE public.items SET
    body = $ckbody$Build a dry-to-sweet flight from the 36 rotating Colorado cider taps at 'St. Vrain Cidery'$ckbody$
  WHERE id = '91027c2c-69cf-4ceb-860f-e89e80e45397'::uuid
    AND body = $ckbody$Build a flight of Colorado ciders at 'St. Vrain Cidery'$ckbody$;

-- Abbott & Wallace Distilling  [HIGH]
UPDATE public.items SET
    body = $ckbody$Compare four house whiskeys in the whiskey flight at 'Abbott and Wallace Distilling'$ckbody$
  WHERE id = '8bcfe55d-7fb5-41cc-ac00-287c18647b0b'::uuid
    AND body = $ckbody$Order a Longmont made spirit or cocktail at 'Abbott and Wallace Distilling'$ckbody$;

-- Oskar Blues Brewery — Tasty Weasel Taproom  [MEDIUM]
UPDATE public.items SET
    body = $ckbody$Drink a 'Dale's Pale Ale' at its source inside 'Tasty Weasel Taproom'$ckbody$
  WHERE id = '754b6bdc-4b87-4c55-8b3f-0b36f3606990'::uuid
    AND body = $ckbody$Try an Oskar Blues beer at the source inside 'Tasty Weasel Taproom'$ckbody$;

-- Left Hand Brewing Company  [HIGH]
UPDATE public.items SET
    body = $ckbody$Watch the nitrogen cascade settle in a 'Milk Stout Nitro' at 'Left Hand Brewing Company'$ckbody$
  WHERE id = '91a2093e-1eba-4ec6-badc-74de0a749e15'::uuid
    AND body = $ckbody$Take the brewery tour or a guided tasting at 'Left Hand Brewing Company'$ckbody$;

-- Dickens Opera House  [HIGH]
UPDATE public.items SET
    body = $ckbody$See a performance in the 1881 upstairs hall at 'Dickens Opera House'$ckbody$
  WHERE id = 'fde1d318-c462-4c5a-88b8-95ffae4dab86'::uuid
    AND body = $ckbody$See a performance inside the historic 'Dickens Opera House'$ckbody$;

DO $do$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM (
    WITH expected(item_id, expected_current_body) AS (
      VALUES
      ('d8f8912d-915b-4814-982b-c5fcb2c5a014'::uuid, $ckbody$Explore the newly renovated 'Denver Public Library Central Library' and find one Colorado collection item$ckbody$),
      ('b2e1e100-f9c6-4ca0-bd1a-1c1ff57c8460'::uuid, $ckbody$Find one work in the Indigenous Arts of North America galleries at 'Denver Art Museum'$ckbody$),
      ('476cf174-504c-45c5-b520-233c28a5ac40'::uuid, $ckbody$Step inside one hands on Colorado story at 'History Colorado Center'$ckbody$),
      ('f28dc3de-c7d9-4a4f-97ad-7969cc8dbad7'::uuid, $ckbody$Choose your favorite Clyfford Still painting at 'Clyfford Still Museum'$ckbody$),
      ('c9d51017-0e7a-4347-89fe-3f377a46b748'::uuid, $ckbody$Order a bite inside the 1870s iron foundry turned market hall at 'The Source Hotel and Market Hall'$ckbody$),
      ('dd31c3a5-ed03-4fe0-9c9b-f64f0a8d7da6'::uuid, $ckbody$Learn one Five Points story at 'Blair Caldwell African American Research Library'$ckbody$),
      ('36911e65-55e4-4e9c-a3e4-b1b04fb8c5cc'::uuid, $ckbody$Hear a live jazz set at 'Nocturne'$ckbody$),
      ('1a2689a8-2570-4c4a-b6cd-1a858e7fe25c'::uuid, $ckbody$Try a beer brewed on Larimer Street at 'Ratio Beerworks'$ckbody$),
      ('97f5eea0-84a3-42aa-a433-94b3f2d41d87'::uuid, $ckbody$Attend a concert at 'The Mission Ballroom'$ckbody$),
      ('d1e1d2aa-7f1f-433f-9a0f-3a460ad50063'::uuid, $ckbody$Pair a food truck order with the courtyard at 'Improper City'$ckbody$),
      ('3bc7e5ce-f628-4ce5-87aa-813130006ed9'::uuid, $ckbody$Build a two stop snack crawl inside 'Denver Central Market'$ckbody$),
      ('ff527e9f-a178-45e7-9fcb-33877303ef21'::uuid, $ckbody$See a live show inside historic Five Points at 'Cervantes Masterpiece Ballroom'$ckbody$),
      ('13772396-c850-44b2-a008-465013e49efb'::uuid, $ckbody$See the current exhibition, then visit the rooftop at 'Museum of Contemporary Art Denver'$ckbody$),
      ('822f114b-ec19-4c23-8d09-33e6a1bce703'::uuid, $ckbody$Find the alley art installation at 'Dairy Block Alley'$ckbody$),
      ('92df86d6-4831-4410-b9ab-506308eeb25b'::uuid, $ckbody$Watch the Rockies play or take a stadium tour at 'Coors Field'$ckbody$),
      ('05655893-cb5d-45f1-8210-b3bb652b884d'::uuid, $ckbody$Drink a house beer inside Denver's original brewpub at 'Wynkoop Brewing Company'$ckbody$),
      ('de1208e6-fcb6-4f15-a430-449fc9ca2da1'::uuid, $ckbody$Find an animal species you have never seen in person at 'Denver Zoo Conservation Alliance'$ckbody$),
      ('7dd7f28f-7228-4097-8f25-7cbaa7bfd614'::uuid, $ckbody$See a show beneath the marquee at 'Ogden Theatre'$ckbody$),
      ('04bf3f18-8e08-4f09-8671-17f6f3fd65b6'::uuid, $ckbody$Tour 'Molly Brown House Museum' and learn one fact about the Unsinkable Molly Brown$ckbody$),
      ('c9cf5edc-82db-49d6-80a9-2cfb13b82945'::uuid, $ckbody$Have a bite inside the former mortuary building at 'Linger'$ckbody$),
      ('e1f92e2e-66b6-4254-b6dc-34bdcee540f6'::uuid, $ckbody$See a show at the historic 'Oriental Theater'$ckbody$),
      ('afc95660-f347-4e21-b697-8b987fb4db1d'::uuid, $ckbody$Learn one coal mining era story at 'Louisville Historical Museum'$ckbody$),
      ('c83d85bd-3f44-48dc-9ac8-042f4946eb11'::uuid, $ckbody$See a local exhibition or program at 'The Collective Community Arts Center'$ckbody$),
      ('bab4b62a-72e5-4578-a662-de0263f1e2a2'::uuid, $ckbody$Complete one hands on exhibit challenge at 'WOW! Children's Museum'$ckbody$),
      ('1cb0161d-464c-4fee-bcb0-3e4e735ac4f0'::uuid, $ckbody$See an exhibition or performance at 'Arvada Center for the Arts and Humanities'$ckbody$),
      ('9e443f77-e115-4347-b0ff-21f33e55577c'::uuid, $ckbody$Read the stories behind the artifacts at 'Broomfield 9/11 Memorial'$ckbody$),
      ('897bab12-c398-405e-a749-a7bec3fe4692'::uuid, $ckbody$Step inside one preserved twentieth century building at 'Heritage Lakewood Belmar Park'$ckbody$),
      ('0a223411-6c06-45b5-bfa5-0a02be08f50f'::uuid, $ckbody$Learn one Colorado climbing story at 'American Mountaineering Museum'$ckbody$),
      ('dcedc561-9f46-4083-8b9a-4b81ccd8ede4'::uuid, $ckbody$Build a flight of Boulder brewed beers at 'Avery Brewing Company'$ckbody$),
      ('dd20c7d4-0a92-46ad-9531-a4977cc7dea9'::uuid, $ckbody$See a live show on The Hill at 'Fox Theatre Boulder'$ckbody$),
      ('63bfd734-9dc2-4211-9030-11eee9101d7d'::uuid, $ckbody$Explore the public exhibits and step onto the terrace at 'NCAR Mesa Laboratory'$ckbody$),
      ('218678c7-c7f7-40f5-8131-1dcec8ac028b'::uuid, $ckbody$See a film, talk or live show beneath the marquee at 'Boulder Theater'$ckbody$),
      ('1fb94167-c521-43a8-ac26-8cf61b61b306'::uuid, $ckbody$Order one globally inspired small plate and a cocktail or mocktail at 'The Passenger'$ckbody$),
      ('e0b82e7f-c02d-458a-907e-55898f99bd85'::uuid, $ckbody$Drink a lager in the pavilion or beer garden at 'Wibby Brewing'$ckbody$),
      ('89bab711-c679-4b6e-9145-e7e7ba6d47a3'::uuid, $ckbody$Choose a cheese you have never tried from the market at 'Cheese Importers'$ckbody$),
      ('12792398-76f2-4a51-aef1-551a284d0d9f'::uuid, $ckbody$Learn one Boulder County farm story at 'Agricultural Heritage Center'$ckbody$),
      ('bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b'::uuid, $ckbody$Try a locally distilled spirit during a guided tasting at 'Dry Land Distillers'$ckbody$),
      ('6607f6bb-d9f3-4baa-8951-511c1cf995ea'::uuid, $ckbody$Pair a house beer with the kitchen's signature chicken at '300 Suns Brewing'$ckbody$),
      ('91027c2c-69cf-4ceb-860f-e89e80e45397'::uuid, $ckbody$Build a flight of Colorado ciders at 'St. Vrain Cidery'$ckbody$),
      ('8bcfe55d-7fb5-41cc-ac00-287c18647b0b'::uuid, $ckbody$Order a Longmont made spirit or cocktail at 'Abbott and Wallace Distilling'$ckbody$),
      ('754b6bdc-4b87-4c55-8b3f-0b36f3606990'::uuid, $ckbody$Try an Oskar Blues beer at the source inside 'Tasty Weasel Taproom'$ckbody$),
      ('91a2093e-1eba-4ec6-badc-74de0a749e15'::uuid, $ckbody$Take the brewery tour or a guided tasting at 'Left Hand Brewing Company'$ckbody$),
      ('fde1d318-c462-4c5a-88b8-95ffae4dab86'::uuid, $ckbody$See a performance inside the historic 'Dickens Opera House'$ckbody$)
    )
    SELECT e.item_id
    FROM expected e
    JOIN public.items i ON i.id = e.item_id
    WHERE i.body = e.expected_current_body
  ) AS still_old;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Postflight check failed: % item(s) still show the OLD body text -- an UPDATE silently did not apply', v_count;
  END IF;
END
$do$;

-- Review before COMMIT
WITH expected(item_id, expected_current_body) AS (
  VALUES
      ('d8f8912d-915b-4814-982b-c5fcb2c5a014'::uuid, $ckbody$Explore the newly renovated 'Denver Public Library Central Library' and find one Colorado collection item$ckbody$),
      ('b2e1e100-f9c6-4ca0-bd1a-1c1ff57c8460'::uuid, $ckbody$Find one work in the Indigenous Arts of North America galleries at 'Denver Art Museum'$ckbody$),
      ('476cf174-504c-45c5-b520-233c28a5ac40'::uuid, $ckbody$Step inside one hands on Colorado story at 'History Colorado Center'$ckbody$),
      ('f28dc3de-c7d9-4a4f-97ad-7969cc8dbad7'::uuid, $ckbody$Choose your favorite Clyfford Still painting at 'Clyfford Still Museum'$ckbody$),
      ('c9d51017-0e7a-4347-89fe-3f377a46b748'::uuid, $ckbody$Order a bite inside the 1870s iron foundry turned market hall at 'The Source Hotel and Market Hall'$ckbody$),
      ('dd31c3a5-ed03-4fe0-9c9b-f64f0a8d7da6'::uuid, $ckbody$Learn one Five Points story at 'Blair Caldwell African American Research Library'$ckbody$),
      ('36911e65-55e4-4e9c-a3e4-b1b04fb8c5cc'::uuid, $ckbody$Hear a live jazz set at 'Nocturne'$ckbody$),
      ('1a2689a8-2570-4c4a-b6cd-1a858e7fe25c'::uuid, $ckbody$Try a beer brewed on Larimer Street at 'Ratio Beerworks'$ckbody$),
      ('97f5eea0-84a3-42aa-a433-94b3f2d41d87'::uuid, $ckbody$Attend a concert at 'The Mission Ballroom'$ckbody$),
      ('d1e1d2aa-7f1f-433f-9a0f-3a460ad50063'::uuid, $ckbody$Pair a food truck order with the courtyard at 'Improper City'$ckbody$),
      ('3bc7e5ce-f628-4ce5-87aa-813130006ed9'::uuid, $ckbody$Build a two stop snack crawl inside 'Denver Central Market'$ckbody$),
      ('ff527e9f-a178-45e7-9fcb-33877303ef21'::uuid, $ckbody$See a live show inside historic Five Points at 'Cervantes Masterpiece Ballroom'$ckbody$),
      ('13772396-c850-44b2-a008-465013e49efb'::uuid, $ckbody$See the current exhibition, then visit the rooftop at 'Museum of Contemporary Art Denver'$ckbody$),
      ('822f114b-ec19-4c23-8d09-33e6a1bce703'::uuid, $ckbody$Find the alley art installation at 'Dairy Block Alley'$ckbody$),
      ('92df86d6-4831-4410-b9ab-506308eeb25b'::uuid, $ckbody$Watch the Rockies play or take a stadium tour at 'Coors Field'$ckbody$),
      ('05655893-cb5d-45f1-8210-b3bb652b884d'::uuid, $ckbody$Drink a house beer inside Denver's original brewpub at 'Wynkoop Brewing Company'$ckbody$),
      ('de1208e6-fcb6-4f15-a430-449fc9ca2da1'::uuid, $ckbody$Find an animal species you have never seen in person at 'Denver Zoo Conservation Alliance'$ckbody$),
      ('7dd7f28f-7228-4097-8f25-7cbaa7bfd614'::uuid, $ckbody$See a show beneath the marquee at 'Ogden Theatre'$ckbody$),
      ('04bf3f18-8e08-4f09-8671-17f6f3fd65b6'::uuid, $ckbody$Tour 'Molly Brown House Museum' and learn one fact about the Unsinkable Molly Brown$ckbody$),
      ('c9cf5edc-82db-49d6-80a9-2cfb13b82945'::uuid, $ckbody$Have a bite inside the former mortuary building at 'Linger'$ckbody$),
      ('e1f92e2e-66b6-4254-b6dc-34bdcee540f6'::uuid, $ckbody$See a show at the historic 'Oriental Theater'$ckbody$),
      ('afc95660-f347-4e21-b697-8b987fb4db1d'::uuid, $ckbody$Learn one coal mining era story at 'Louisville Historical Museum'$ckbody$),
      ('c83d85bd-3f44-48dc-9ac8-042f4946eb11'::uuid, $ckbody$See a local exhibition or program at 'The Collective Community Arts Center'$ckbody$),
      ('bab4b62a-72e5-4578-a662-de0263f1e2a2'::uuid, $ckbody$Complete one hands on exhibit challenge at 'WOW! Children's Museum'$ckbody$),
      ('1cb0161d-464c-4fee-bcb0-3e4e735ac4f0'::uuid, $ckbody$See an exhibition or performance at 'Arvada Center for the Arts and Humanities'$ckbody$),
      ('9e443f77-e115-4347-b0ff-21f33e55577c'::uuid, $ckbody$Read the stories behind the artifacts at 'Broomfield 9/11 Memorial'$ckbody$),
      ('897bab12-c398-405e-a749-a7bec3fe4692'::uuid, $ckbody$Step inside one preserved twentieth century building at 'Heritage Lakewood Belmar Park'$ckbody$),
      ('0a223411-6c06-45b5-bfa5-0a02be08f50f'::uuid, $ckbody$Learn one Colorado climbing story at 'American Mountaineering Museum'$ckbody$),
      ('dcedc561-9f46-4083-8b9a-4b81ccd8ede4'::uuid, $ckbody$Build a flight of Boulder brewed beers at 'Avery Brewing Company'$ckbody$),
      ('dd20c7d4-0a92-46ad-9531-a4977cc7dea9'::uuid, $ckbody$See a live show on The Hill at 'Fox Theatre Boulder'$ckbody$),
      ('63bfd734-9dc2-4211-9030-11eee9101d7d'::uuid, $ckbody$Explore the public exhibits and step onto the terrace at 'NCAR Mesa Laboratory'$ckbody$),
      ('218678c7-c7f7-40f5-8131-1dcec8ac028b'::uuid, $ckbody$See a film, talk or live show beneath the marquee at 'Boulder Theater'$ckbody$),
      ('1fb94167-c521-43a8-ac26-8cf61b61b306'::uuid, $ckbody$Order one globally inspired small plate and a cocktail or mocktail at 'The Passenger'$ckbody$),
      ('e0b82e7f-c02d-458a-907e-55898f99bd85'::uuid, $ckbody$Drink a lager in the pavilion or beer garden at 'Wibby Brewing'$ckbody$),
      ('89bab711-c679-4b6e-9145-e7e7ba6d47a3'::uuid, $ckbody$Choose a cheese you have never tried from the market at 'Cheese Importers'$ckbody$),
      ('12792398-76f2-4a51-aef1-551a284d0d9f'::uuid, $ckbody$Learn one Boulder County farm story at 'Agricultural Heritage Center'$ckbody$),
      ('bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b'::uuid, $ckbody$Try a locally distilled spirit during a guided tasting at 'Dry Land Distillers'$ckbody$),
      ('6607f6bb-d9f3-4baa-8951-511c1cf995ea'::uuid, $ckbody$Pair a house beer with the kitchen's signature chicken at '300 Suns Brewing'$ckbody$),
      ('91027c2c-69cf-4ceb-860f-e89e80e45397'::uuid, $ckbody$Build a flight of Colorado ciders at 'St. Vrain Cidery'$ckbody$),
      ('8bcfe55d-7fb5-41cc-ac00-287c18647b0b'::uuid, $ckbody$Order a Longmont made spirit or cocktail at 'Abbott and Wallace Distilling'$ckbody$),
      ('754b6bdc-4b87-4c55-8b3f-0b36f3606990'::uuid, $ckbody$Try an Oskar Blues beer at the source inside 'Tasty Weasel Taproom'$ckbody$),
      ('91a2093e-1eba-4ec6-badc-74de0a749e15'::uuid, $ckbody$Take the brewery tour or a guided tasting at 'Left Hand Brewing Company'$ckbody$),
      ('fde1d318-c462-4c5a-88b8-95ffae4dab86'::uuid, $ckbody$See a performance inside the historic 'Dickens Opera House'$ckbody$)
)
SELECT e.item_id, i.body AS new_body, i.checkin_type
FROM expected e
JOIN public.items i ON i.id = e.item_id
ORDER BY e.item_id;

COMMIT;