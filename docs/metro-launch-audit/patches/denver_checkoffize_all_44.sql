-- Denver catalog Checkoffization pass -- ALL 44 rewrites, plain UPDATE statements
--
-- 43 of these were already applied successfully (confirmed live on production --
-- see the read-only diagnostic run earlier). The 44th, Museum of Boulder / Connie
-- Carpenter, was held back pending verification and is now included since you
-- confirmed you want it applied as ChatGPT wrote it.
--
-- Every statement is a plain UPDATE guarded by 'AND body = <old text>'. That makes
-- this file safe to run top to bottom regardless of what's already applied: a row
-- whose body no longer matches the old text (because it's already been updated)
-- simply reports "UPDATE 0" for that statement -- not an error, just a no-op. Only
-- the Museum of Boulder row should actually report "UPDATE 1" if you run this now.

BEGIN;

-- Denver Public Library — Central Library  [HIGH]
UPDATE public.items
SET body = 'Find a historic photograph of a Denver street you recognize in the Western History Collection at ''Denver Public Library Central Library'''
WHERE id = 'd8f8912d-915b-4814-982b-c5fcb2c5a014'
  AND body = 'Explore the newly renovated ''Denver Public Library Central Library'' and find one Colorado collection item';

-- Denver Art Museum  [HIGH]
UPDATE public.items
SET body = 'Find the cheekily hidden signature on the bottom of the nearly 11-foot ''Mud Woman Rolls On'' at ''Denver Art Museum''',
    checkin_type = 'photo'
WHERE id = 'b2e1e100-f9c6-4ca0-bd1a-1c1ff57c8460'
  AND body = 'Find one work in the Indigenous Arts of North America galleries at ''Denver Art Museum''';

-- History Colorado Center  [MEDIUM]
UPDATE public.items
SET body = 'Launch yourself from the virtual Steamboat Springs ski jump at ''History Colorado Center'''
WHERE id = '476cf174-504c-45c5-b520-233c28a5ac40'
  AND body = 'Step inside one hands on Colorado story at ''History Colorado Center''';

-- Clyfford Still Museum  [HIGH]
UPDATE public.items
SET body = 'Peer through the windows into the working conservation lab at ''Clyfford Still Museum'''
WHERE id = 'f28dc3de-c7d9-4a4f-97ad-7969cc8dbad7'
  AND body = 'Choose your favorite Clyfford Still painting at ''Clyfford Still Museum''';

-- The Source Hotel + Market Hall  [HIGH]
UPDATE public.items
SET body = 'Eat a cylindrical hand roll while the rice is warm and the nori still crisp at ''Temaki Den'' inside ''The Source Hotel and Market Hall'''
WHERE id = 'c9d51017-0e7a-4347-89fe-3f377a46b748'
  AND body = 'Order a bite inside the 1870s iron foundry turned market hall at ''The Source Hotel and Market Hall''';

-- Blair-Caldwell African American Research Library  [HIGH]
UPDATE public.items
SET body = 'Step into the replica office of former mayor Wellington Webb at ''Blair-Caldwell African American Research Library''',
    checkin_type = 'photo'
WHERE id = 'dd31c3a5-ed03-4fe0-9c9b-f64f0a8d7da6'
  AND body = 'Learn one Five Points story at ''Blair Caldwell African American Research Library''';

-- Nocturne  [HIGH]
UPDATE public.items
SET body = 'Pair a live jazz set with the five-course ''Ellington Experience'' beneath the Art Deco staircase at ''Nocturne'''
WHERE id = '36911e65-55e4-4e9c-a3e4-b1b04fb8c5cc'
  AND body = 'Hear a live jazz set at ''Nocturne''';

-- Ratio Beerworks  [HIGH]
UPDATE public.items
SET body = 'Order the GABF medal-winning ''Dear You'' French saison at ''Ratio Beerworks'''
WHERE id = '1a2689a8-2570-4c4a-b6cd-1a858e7fe25c'
  AND body = 'Try a beer brewed on Larimer Street at ''Ratio Beerworks''';

-- The Mission Ballroom  [HIGH]
UPDATE public.items
SET body = 'Watch a concert from the tiered bowl built around the movable stage at ''The Mission Ballroom'''
WHERE id = '97f5eea0-84a3-42aa-a433-94b3f2d41d87'
  AND body = 'Attend a concert at ''The Mission Ballroom''';

-- Improper City  [HIGH]
UPDATE public.items
SET body = 'Play a board game beside the firepits on the graffiti-lined patio at ''Improper City'''
WHERE id = 'd1e1d2aa-7f1f-433f-9a0f-3a460ad50063'
  AND body = 'Pair a food truck order with the courtyard at ''Improper City''';

-- Denver Central Market  [HIGH]
UPDATE public.items
SET body = 'Peel apart one of Izzio Bakery''s caramelized ''Queen'' kouign-amann pastries inside ''Denver Central Market'''
WHERE id = '3bc7e5ce-f628-4ce5-87aa-813130006ed9'
  AND body = 'Build a two stop snack crawl inside ''Denver Central Market''';

-- Cervantes' Masterpiece Ballroom  [HIGH]
UPDATE public.items
SET body = 'Catch two concerts under one roof on a Dual Venue night at ''Cervantes Masterpiece Ballroom'''
WHERE id = 'ff527e9f-a178-45e7-9fcb-33877303ef21'
  AND body = 'See a live show inside historic Five Points at ''Cervantes Masterpiece Ballroom''';

-- Museum of Contemporary Art Denver  [HIGH]
UPDATE public.items
SET body = 'End the current exhibition with a craft cocktail on the rooftop at ''Museum of Contemporary Art Denver'''
WHERE id = '13772396-c850-44b2-a008-465013e49efb'
  AND body = 'See the current exhibition, then visit the rooftop at ''Museum of Contemporary Art Denver''';

-- Dairy Block Alley  [MEDIUM]
UPDATE public.items
SET body = 'Make music with the interactive dairy-churn sculpture in ''Dairy Block Alley'''
WHERE id = '822f114b-ec19-4c23-8d09-33e6a1bce703'
  AND body = 'Find the alley art installation at ''Dairy Block Alley''';

-- Coors Field  [HIGH]
UPDATE public.items
SET body = 'Find the single purple row exactly 5,280 feet above sea level inside ''Coors Field''',
    checkin_type = 'photo'
WHERE id = '92df86d6-4831-4410-b9ab-506308eeb25b'
  AND body = 'Watch the Rockies play or take a stadium tour at ''Coors Field''';

-- Wynkoop Brewing Company  [MEDIUM]
UPDATE public.items
SET body = 'Play a game of shuffleboard upstairs with a ''Rail Yard Ale'' at ''Wynkoop Brewing Company'''
WHERE id = '05655893-cb5d-45f1-8210-b3bb652b884d'
  AND body = 'Drink a house beer inside Denver''s original brewpub at ''Wynkoop Brewing Company''';

-- Denver Zoo Conservation Alliance  [HIGH]
UPDATE public.items
SET body = 'Walk eye-to-eye with red kangaroos and wallabies along Wallaby Way in ''Down Under'' at ''Denver Zoo Conservation Alliance''',
    checkin_type = 'photo'
WHERE id = 'de1208e6-fcb6-4f15-a430-449fc9ca2da1'
  AND body = 'Find an animal species you have never seen in person at ''Denver Zoo Conservation Alliance''';

-- Colfax Avenue — Ogden Theatre  [HIGH]
UPDATE public.items
SET body = 'See a show in the century-old room where Harry Houdini once performed at ''Ogden Theatre'''
WHERE id = '7dd7f28f-7228-4097-8f25-7cbaa7bfd614'
  AND body = 'See a show beneath the marquee at ''Ogden Theatre''';

-- Molly Brown House Museum  [MEDIUM]
UPDATE public.items
SET body = 'Spot the original light fixture in the foyer during a tour of ''Molly Brown House Museum'''
WHERE id = '04bf3f18-8e08-4f09-8671-17f6f3fd65b6'
  AND body = 'Tour ''Molly Brown House Museum'' and learn one fact about the Unsinkable Molly Brown';

-- Linger  [MEDIUM]
UPDATE public.items
SET body = 'Eat a street-food plate beneath the old ''Olinger Mortuaries'' rooftop sign at ''Linger'''
WHERE id = 'c9cf5edc-82db-49d6-80a9-2cfb13b82945'
  AND body = 'Have a bite inside the former mortuary building at ''Linger''';

-- The Oriental Theater  [HIGH]
UPDATE public.items
SET body = 'Watch a show from the 100-seat balcony inside the old movie palace at ''The Oriental Theater'''
WHERE id = 'e1f92e2e-66b6-4254-b6dc-34bdcee540f6'
  AND body = 'See a show at the historic ''Oriental Theater''';

-- Louisville Historical Museum  [HIGH]
UPDATE public.items
SET body = 'Find the six-foot replica of historic downtown inside ''Louisville Historical Museum''',
    checkin_type = 'photo'
WHERE id = 'afc95660-f347-4e21-b697-8b987fb4db1d'
  AND body = 'Learn one coal mining era story at ''Louisville Historical Museum''';

-- The Collective Community Arts Center  [HIGH]
UPDATE public.items
SET body = 'Pick up the free art-kit inspired by the current exhibition at ''The Collective Community Arts Center'''
WHERE id = 'c83d85bd-3f44-48dc-9ac8-042f4946eb11'
  AND body = 'See a local exhibition or program at ''The Collective Community Arts Center''';

-- WOW! Children's Museum  [HIGH]
UPDATE public.items
SET body = 'Pull yourself toward the ceiling in a pulley chair at ''WOW! Children''s Museum''',
    checkin_type = 'photo'
WHERE id = 'bab4b62a-72e5-4578-a662-de0263f1e2a2'
  AND body = 'Complete one hands on exhibit challenge at ''WOW! Children''s Museum''';

-- Arvada Center for the Arts and Humanities  [HIGH]
UPDATE public.items
SET body = 'Play one artist''s audio story beside their large-scale work in the free Sculpture Field at ''Arvada Center'''
WHERE id = '1cb0161d-464c-4fee-bcb0-3e4e735ac4f0'
  AND body = 'See an exhibition or performance at ''Arvada Center for the Arts and Humanities''';

-- Broomfield 9/11 Memorial  [HIGH]
UPDATE public.items
SET body = 'Find the piece of fallen Twin Towers steel embedded in a bronze figure at ''Broomfield 9/11 Memorial''',
    checkin_type = 'photo'
WHERE id = '9e443f77-e115-4347-b0ff-21f33e55577c'
  AND body = 'Read the stories behind the artifacts at ''Broomfield 9/11 Memorial''';

-- Heritage Lakewood Belmar Park  [HIGH]
UPDATE public.items
SET body = 'Step inside the 1948 Valentine diner and the 1920s country school on a tour of ''Heritage Lakewood Belmar Park'''
WHERE id = '897bab12-c398-405e-a749-a7bec3fe4692'
  AND body = 'Step inside one preserved twentieth century building at ''Heritage Lakewood Belmar Park''';

-- American Mountaineering Museum  [HIGH]
UPDATE public.items
SET body = 'Find Jim Whittaker''s gear from the first American ascent of Everest at ''American Mountaineering Museum''',
    checkin_type = 'photo'
WHERE id = '0a223411-6c06-45b5-bfa5-0a02be08f50f'
  AND body = 'Learn one Colorado climbing story at ''American Mountaineering Museum''';

-- Avery Brewing Company  [MEDIUM]
UPDATE public.items
SET body = 'Build a flight around ''White Rascal'' and the taproom-exclusive ''Out of Bounds'' stout at ''Avery Brewing Company'''
WHERE id = 'dcedc561-9f46-4083-8b9a-4b81ccd8ede4'
  AND body = 'Build a flight of Boulder brewed beers at ''Avery Brewing Company''';

-- Fox Theatre Boulder  [MEDIUM]
UPDATE public.items
SET body = 'See a concert beneath the original movie-theater marquee in the 625-capacity ''Fox Theatre Boulder'''
WHERE id = 'dd20c7d4-0a92-46ad-9531-a4977cc7dea9'
  AND body = 'See a live show on The Hill at ''Fox Theatre Boulder''';

-- NCAR Mesa Laboratory  [HIGH]
UPDATE public.items
SET body = 'Follow the outdoor Weather Trail behind I.M. Pei''s ''NCAR Mesa Laboratory'''
WHERE id = '63bfd734-9dc2-4211-9030-11eee9101d7d'
  AND body = 'Explore the public exhibits and step onto the terrace at ''NCAR Mesa Laboratory''';

-- Museum of Boulder  [HIGH]
UPDATE public.items
SET body = 'Hear Olympic champion Connie Carpenter describe her gold-medal finish beside the bicycle she rode at ''Museum of Boulder'''
WHERE id = '08893b11-d552-407a-a407-255625f949db'
  AND body = 'Learn one surprising Boulder story at ''Museum of Boulder''';

-- Boulder Theater  [HIGH]
UPDATE public.items
SET body = 'Find the elaborate Art Deco murals inside while seeing a show at ''Boulder Theater''',
    checkin_type = 'photo'
WHERE id = '218678c7-c7f7-40f5-8131-1dcec8ac028b'
  AND body = 'See a film, talk or live show beneath the marquee at ''Boulder Theater''';

-- The Passenger  [MEDIUM]
UPDATE public.items
SET body = 'Sip the blue-raspberry ''Petra'' cocktail with Pop Rocks at ''The Passenger'''
WHERE id = '1fb94167-c521-43a8-ac26-8cf61b61b306'
  AND body = 'Order one globally inspired small plate and a cocktail or mocktail at ''The Passenger''';

-- Wibby Brewing  [HIGH]
UPDATE public.items
SET body = 'Cool off with a ''Lightshine Radler'' blending award-winning helles and house-made raspberry lemonade at ''Wibby Brewing'''
WHERE id = 'e0b82e7f-c02d-458a-907e-55898f99bd85'
  AND body = 'Drink a lager in the pavilion or beer garden at ''Wibby Brewing''';

-- Cheese Importers  [HIGH]
UPDATE public.items
SET body = 'Step into the walk-in Cheese Room and ask for a wedge you have never tasted at ''Cheese Importers'''
WHERE id = '89bab711-c679-4b6e-9145-e7e7ba6d47a3'
  AND body = 'Choose a cheese you have never tried from the market at ''Cheese Importers''';

-- Agricultural Heritage Center  [HIGH]
UPDATE public.items
SET body = 'Climb into the real tractor cab inside the big red barn at ''Agricultural Heritage Center''',
    checkin_type = 'photo'
WHERE id = '12792398-76f2-4a51-aef1-551a284d0d9f'
  AND body = 'Learn one Boulder County farm story at ''Agricultural Heritage Center''';

-- Dry Land Distillers  [HIGH]
UPDATE public.items
SET body = 'Taste the smoky spirit distilled from native prickly pear cactus at ''Dry Land Distillers'''
WHERE id = 'bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b'
  AND body = 'Try a locally distilled spirit during a guided tasting at ''Dry Land Distillers''';

-- 300 Suns Brewing  [HIGH]
UPDATE public.items
SET body = 'Finish ''The Reaper'' Nashville hot chicken and earn the survivor sticker at ''300 Suns Brewing''',
    checkin_type = 'photo'
WHERE id = '6607f6bb-d9f3-4baa-8951-511c1cf995ea'
  AND body = 'Pair a house beer with the kitchen''s signature chicken at ''300 Suns Brewing''';

-- St. Vrain Cidery  [HIGH]
UPDATE public.items
SET body = 'Build a dry-to-sweet flight from the 36 rotating Colorado cider taps at ''St. Vrain Cidery'''
WHERE id = '91027c2c-69cf-4ceb-860f-e89e80e45397'
  AND body = 'Build a flight of Colorado ciders at ''St. Vrain Cidery''';

-- Abbott & Wallace Distilling  [HIGH]
UPDATE public.items
SET body = 'Compare four house whiskeys in the whiskey flight at ''Abbott and Wallace Distilling'''
WHERE id = '8bcfe55d-7fb5-41cc-ac00-287c18647b0b'
  AND body = 'Order a Longmont made spirit or cocktail at ''Abbott and Wallace Distilling''';

-- Oskar Blues Brewery — Tasty Weasel Taproom  [MEDIUM]
UPDATE public.items
SET body = 'Drink a ''Dale''s Pale Ale'' at its source inside ''Tasty Weasel Taproom'''
WHERE id = '754b6bdc-4b87-4c55-8b3f-0b36f3606990'
  AND body = 'Try an Oskar Blues beer at the source inside ''Tasty Weasel Taproom''';

-- Left Hand Brewing Company  [HIGH]
UPDATE public.items
SET body = 'Watch the nitrogen cascade settle in a ''Milk Stout Nitro'' at ''Left Hand Brewing Company'''
WHERE id = '91a2093e-1eba-4ec6-badc-74de0a749e15'
  AND body = 'Take the brewery tour or a guided tasting at ''Left Hand Brewing Company''';

-- Dickens Opera House  [HIGH]
UPDATE public.items
SET body = 'See a performance in the 1881 upstairs hall at ''Dickens Opera House'''
WHERE id = 'fde1d318-c462-4c5a-88b8-95ffae4dab86'
  AND body = 'See a performance inside the historic ''Dickens Opera House''';

COMMIT;