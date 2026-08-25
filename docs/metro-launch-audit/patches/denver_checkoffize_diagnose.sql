-- Read-only diagnostic: which of the 43 Checkoffize target items don't match
-- the audit CSV's recorded current_body exactly. No writes, safe to run anytime.

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
SELECT
  e.item_id,
  i.id IS NULL AS item_missing,
  i.body AS live_body,
  e.expected_current_body AS csv_body,
  (i.body = e.expected_current_body) AS exact_match,
  length(i.body) AS live_len,
  length(e.expected_current_body) AS csv_len,
  encode(convert_to(i.body, 'UTF8'), 'hex') AS live_body_hex,
  encode(convert_to(e.expected_current_body, 'UTF8'), 'hex') AS csv_body_hex
FROM expected e
LEFT JOIN public.items i ON i.id = e.item_id
WHERE i.id IS NULL OR i.body <> e.expected_current_body
ORDER BY e.item_id;