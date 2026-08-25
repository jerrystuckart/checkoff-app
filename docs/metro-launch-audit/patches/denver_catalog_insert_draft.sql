-- CheckOff Denver Metro permanent catalog intake
-- Generated 2026-08-21 from the reviewed workbook and authoritative Supabase exports.
-- Candidate reconciliation: 150 starting; 0 workbook duplicates; 1 omitted (HG-037); 149 SQL-eligible.
-- Explicit user override: all inserted items are active. Google Places identity fields remain NULL for a later review pass.
-- This script does not insert, update, or delete any list membership.

BEGIN;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.metros
    WHERE id = 'b00f7f91-3176-48c5-aaf1-6ded7426f756'::uuid
      AND name = 'Denver Metro'
      AND slug = 'denver'
      AND state = 'CO'
      AND timezone = 'America/Denver'
      AND is_active = false
  ) THEN
    RAISE EXCEPTION 'Denver Metro foundation row is missing or has changed';
  END IF;
END
$do$;

CREATE TEMP TABLE _denver_required_neighborhoods (
  name text PRIMARY KEY,
  id uuid UNIQUE NOT NULL
) ON COMMIT DROP;

INSERT INTO _denver_required_neighborhoods (name, id) VALUES
  ($co$Arvada$co$, '0d7cce53-d99e-4232-897f-486590f71150'::uuid),
  ($co$Berkeley / Tennyson$co$, '5e3fe418-c2b7-42b4-83a1-8aeeabc787e2'::uuid),
  ($co$Boulder$co$, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid),
  ($co$Broomfield$co$, '7d8c42f0-6519-4dcd-9e2d-9ded2f81249a'::uuid),
  ($co$Capitol Hill / Uptown$co$, 'e234aa68-444d-41dd-b32b-246268ea7b2a'::uuid),
  ($co$Cherry Creek$co$, 'f1835731-c5ca-40bc-a37f-d0013666f039'::uuid),
  ($co$Denver Central$co$, '9ec42458-871a-4150-97d7-52c201cd54aa'::uuid),
  ($co$Erie$co$, '311db7f8-f584-47c1-98c9-29c5b1192edc'::uuid),
  ($co$Golden$co$, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid),
  ($co$Highlands / Sunnyside$co$, '78f5edb2-a6ad-47b7-8def-4bf09fcb37f8'::uuid),
  ($co$Lafayette$co$, '3a8dd37f-c208-4763-9ce4-4eca61b89516'::uuid),
  ($co$Lakewood$co$, '14e669ce-b5c1-4ffa-bd8b-b4817b459c85'::uuid),
  ($co$LoDo / Union Station$co$, '8cfd6d45-059c-4553-9ddd-d0b75ece9e18'::uuid),
  ($co$Longmont$co$, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid),
  ($co$Louisville / Superior$co$, '7b098c15-c258-43c9-953f-672c464be02b'::uuid),
  ($co$Nederland / Eldora$co$, '8f57ac21-5317-411e-87ed-a6f64009ef91'::uuid),
  ($co$RiNo / Five Points$co$, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid),
  ($co$Thornton / Northglenn$co$, '1ec57b5b-047a-4158-8497-bb53a5d59e0b'::uuid),
  ($co$Washington Park / South Denver$co$, '5c3f138a-ad76-44e5-8e01-db680e948892'::uuid),
  ($co$Westminster$co$, '7ca7e3dd-c3ca-466d-a9e2-964d964e6be0'::uuid);

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM _denver_required_neighborhoods r
    LEFT JOIN public.neighborhoods n ON n.id = r.id
    WHERE n.id IS NULL
       OR n.name <> r.name
       OR n.metro_id <> 'b00f7f91-3176-48c5-aaf1-6ded7426f756'::uuid
       OR n.is_active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'One or more Denver neighborhood foundation rows are missing or changed';
  END IF;
END
$do$;

CREATE TEMP TABLE _denver_required_categories (
  name text PRIMARY KEY,
  id uuid UNIQUE NOT NULL
) ON COMMIT DROP;

INSERT INTO _denver_required_categories (name, id) VALUES
  ($co$Adventure$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid),
  ($co$Arts & Culture$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid),
  ($co$Bar & drinks$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid),
  ($co$Food & drink$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid),
  ($co$Misc$co$, 'd76e2626-7782-4af1-a4ee-7783ed7f9070'::uuid),
  ($co$Nightlife$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid),
  ($co$Play$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid),
  ($co$Spa & self-care$co$, 'aad9e527-57d9-4f96-a6f3-b863ae4a75a4'::uuid);

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM _denver_required_categories r
    LEFT JOIN public.categories c ON c.id = r.id
    WHERE c.id IS NULL OR c.name <> r.name
  ) THEN
    RAISE EXCEPTION 'One or more required category rows are missing or changed';
  END IF;
END
$do$;

CREATE TEMP TABLE _denver_required_tags (
  name text PRIMARY KEY,
  id uuid UNIQUE NOT NULL
) ON COMMIT DROP;

INSERT INTO _denver_required_tags (name, id) VALUES
  ($co$adventure$co$, '3577fee7-aca0-452d-a818-e4020f2a219a'::uuid),
  ($co$animals$co$, '0cc4833b-db8a-4744-b7f6-27e44b42017d'::uuid),
  ($co$arcade$co$, 'cc1058eb-07e6-4cae-b0a8-1ebd6e1b319a'::uuid),
  ($co$art$co$, '92e3aef7-9851-40c5-8d92-16821936c13c'::uuid),
  ($co$arts$co$, '2a79c18d-e897-444b-9c84-095b94f4fb9c'::uuid),
  ($co$bakery$co$, 'e29afe91-4d24-4b0c-b058-5d956fc6c9ec'::uuid),
  ($co$bar$co$, 'a45b23ca-fd81-4eff-bc3f-3f38026b7084'::uuid),
  ($co$baseball$co$, '866f2c1e-30a0-448f-be1f-c789d96a98c0'::uuid),
  ($co$beer$co$, '6eb9fd3d-353e-44e1-804e-440a6f77dbde'::uuid),
  ($co$botanical-garden$co$, '8c6b5d63-a860-4335-b30c-f17af00c979f'::uuid),
  ($co$brewery$co$, '81310b2a-10d3-4d7f-963c-7924f5ca911b'::uuid),
  ($co$burger$co$, '4b27d646-4e5b-4af8-82e4-ad20655ffbab'::uuid),
  ($co$cocktails$co$, '758c4f4d-19a2-43b1-ac94-a40cc5a28f21'::uuid),
  ($co$coffee$co$, '76d1243a-49fe-44af-95b5-941bb5d9d703'::uuid),
  ($co$drinks$co$, 'b99611d1-98af-4df1-bb73-866fffb5f841'::uuid),
  ($co$food$co$, 'f11a6713-c60c-437c-98f8-e7f5ea16391c'::uuid),
  ($co$fun$co$, '591758ff-02e7-4cd8-9fec-ffb324457954'::uuid),
  ($co$hidden-bar$co$, 'e9070988-6a0e-4972-b444-5c2e911fd60e'::uuid),
  ($co$historic$co$, 'fa31d890-b349-48d9-b63d-b7fb93c72397'::uuid),
  ($co$hot-dog$co$, '2b1e4a95-2f33-4c2f-9646-c403dd05dfd7'::uuid),
  ($co$ice-cream$co$, '4863a410-6f7b-4978-b4cf-9138870c0ab5'::uuid),
  ($co$jazz$co$, '42cf84b9-d220-484a-9649-cd719c7a582a'::uuid),
  ($co$landmark$co$, '0bc1d9e6-379f-401d-b366-7eddfa38ea04'::uuid),
  ($co$library$co$, 'b9b29b7c-f7a5-4d78-8948-2199a22fd09c'::uuid),
  ($co$live-music$co$, 'a6e20e03-a87c-4632-8546-12c08eba1326'::uuid),
  ($co$local$co$, 'f81c806f-f884-49c2-b6fe-cbf6e375159e'::uuid),
  ($co$local-culture$co$, 'b1aed0e2-4760-4e93-8085-eb0048bd7e6c'::uuid),
  ($co$museum$co$, 'ba41937b-bb9c-409d-ad7b-a5581b42f977'::uuid),
  ($co$night-out$co$, 'e973b175-9e80-4c88-8c07-714d286cd6b7'::uuid),
  ($co$nightlife$co$, '6a058d0f-196a-4a51-a1bc-df7b0f74238c'::uuid),
  ($co$outdoor$co$, 'd9bf8870-7a3b-4014-8bc5-be31ba2c0265'::uuid),
  ($co$park$co$, '1760092b-49fe-4331-aa6b-d03e6b32aa22'::uuid),
  ($co$play$co$, '17fa0829-f73d-4509-ae2f-9a938bcd0f1a'::uuid),
  ($co$restaurant$co$, '1e87ec73-7a24-4fc9-be9f-4ab890d0f83e'::uuid),
  ($co$sauna$co$, '9f0c782d-ab64-414f-8e70-85c53b73d149'::uuid),
  ($co$spa$co$, '592fc725-fe1a-4cbe-90d3-a4e550e96ade'::uuid),
  ($co$sushi$co$, 'a18c3cfe-d892-4334-9519-0d98972c03a8'::uuid),
  ($co$tacos$co$, '44bddc26-9c88-4293-a5f8-4d668c7d4d9c'::uuid),
  ($co$theater$co$, '24c714ac-1486-478f-8c53-7e7e15f0e48e'::uuid),
  ($co$trail$co$, '22fcbf31-fc68-4a66-bba9-214faa335377'::uuid),
  ($co$views$co$, '38fa434a-cdc8-4ee3-bb34-98619406d764'::uuid),
  ($co$wellness$co$, 'cc88587d-bfc5-4200-a37a-cc4defa00926'::uuid),
  ($co$western-history$co$, '8dba147e-ca4f-4704-8a14-a0e24aae6347'::uuid),
  ($co$whiskey$co$, '69411f0f-40f3-4fb8-917b-5eb87f9b5042'::uuid),
  ($co$zoo$co$, 'ca950351-52a8-4077-99f3-5950f487a665'::uuid);

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM _denver_required_tags r
    LEFT JOIN public.tags t ON t.id = r.id
    WHERE t.id IS NULL OR t.name <> r.name
  ) THEN
    RAISE EXCEPTION 'One or more required production tags are missing or changed';
  END IF;
END
$do$;

CREATE TEMP TABLE _denver_catalog_candidates (
  source_candidate_id text PRIMARY KEY,
  place text NOT NULL,
  body text NOT NULL,
  category_id uuid NOT NULL,
  neighborhood_id uuid NOT NULL,
  website_url text,
  maps_query text NOT NULL,
  has_alcohol boolean NOT NULL,
  is_recurring boolean NOT NULL,
  tag_names text[] NOT NULL
) ON COMMIT DROP;

INSERT INTO _denver_catalog_candidates (
  source_candidate_id, place, body, category_id, neighborhood_id,
  website_url, maps_query, has_alcohol, is_recurring, tag_names
) VALUES
  ($co$DEN-SEE-001$co$, $co$Colorado State Capitol$co$, $co$Stand on the official mile high marker on the west steps of 'Colorado State Capitol'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '9ec42458-871a-4150-97d7-52c201cd54aa'::uuid, $co$https://visitdenver.com/things-to-do/attractions/must-see-do/$co$, $co$Colorado State Capitol, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$]::text[]),
  ($co$DEN-SEE-002$co$, $co$Denver Art Museum$co$, $co$Find one work in the Indigenous Arts of North America galleries at 'Denver Art Museum'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '9ec42458-871a-4150-97d7-52c201cd54aa'::uuid, $co$https://visitdenver.com/things-to-do/attractions/must-see-do/$co$, $co$Denver Art Museum, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$]::text[]),
  ($co$DEN-SEE-003$co$, $co$Clyfford Still Museum$co$, $co$Choose your favorite Clyfford Still painting at 'Clyfford Still Museum'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '9ec42458-871a-4150-97d7-52c201cd54aa'::uuid, $co$https://visitdenver.com/things-to-do/attractions/must-see-do/$co$, $co$Clyfford Still Museum, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$, $co$art$co$]::text[]),
  ($co$DEN-SEE-004$co$, $co$Kirkland Museum of Fine & Decorative Art$co$, $co$Look up at the leather straps Vance Kirkland used to suspend himself over paintings at 'Kirkland Museum of Fine & Decorative Art'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '9ec42458-871a-4150-97d7-52c201cd54aa'::uuid, $co$https://visitdenver.com/blog/post/kirkland-museum/$co$, $co$Kirkland Museum of Fine & Decorative Art, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$, $co$art$co$]::text[]),
  ($co$DEN-SEE-005$co$, $co$History Colorado Center$co$, $co$Step inside one hands on Colorado story at 'History Colorado Center'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '9ec42458-871a-4150-97d7-52c201cd54aa'::uuid, $co$https://visitdenver.com/things-to-do/attractions/must-see-do/$co$, $co$History Colorado Center, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$historic$co$]::text[]),
  ($co$DEN-SEE-006$co$, $co$Denver Public Library — Central Library$co$, $co$Explore the newly renovated 'Denver Public Library Central Library' and find one Colorado collection item$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '9ec42458-871a-4150-97d7-52c201cd54aa'::uuid, $co$https://www.denverlibrary.org/central-renovation-updates$co$, $co$Denver Public Library — Central Library, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$library$co$]::text[]),
  ($co$DEN-SEE-008$co$, $co$Denver Performing Arts Complex$co$, $co$Take a photo beneath the giant blue bear at 'Denver Performing Arts Complex'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '9ec42458-871a-4150-97d7-52c201cd54aa'::uuid, $co$https://visitdenver.com/things-to-do/attractions/must-see-do/$co$, $co$Denver Performing Arts Complex, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$]::text[]),
  ($co$DEN-SEE-010$co$, $co$Brown Palace Hotel$co$, $co$Have afternoon tea beneath the stained glass atrium at 'The Brown Palace Hotel and Spa'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '9ec42458-871a-4150-97d7-52c201cd54aa'::uuid, $co$https://visitdenver.com/things-to-do/attractions/must-see-do/$co$, $co$Brown Palace Hotel, Denver, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$DEN-SEE-011$co$, $co$Rockmount Ranch Wear$co$, $co$Try on a snap front western shirt at the original 'Rockmount Ranch Wear' store$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '9ec42458-871a-4150-97d7-52c201cd54aa'::uuid, $co$https://visitdenver.com/things-to-do/attractions/must-see-do/$co$, $co$Rockmount Ranch Wear, Denver, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$, $co$western-history$co$]::text[]),
  ($co$DEN-SEE-012$co$, $co$Meow Wolf Denver — Convergence Station$co$, $co$Find a portal connecting all four worlds at 'Meow Wolf Denver Convergence Station'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '9ec42458-871a-4150-97d7-52c201cd54aa'::uuid, $co$https://visitdenver.com/things-to-do/attractions/must-see-do/$co$, $co$Meow Wolf Denver — Convergence Station, Denver, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$]::text[]),
  ($co$DEN-SEE-013$co$, $co$Denver Union Station$co$, $co$Meet under the Great Hall clock at 'Denver Union Station'$co$, 'd76e2626-7782-4af1-a4ee-7783ed7f9070'::uuid, '8cfd6d45-059c-4553-9ddd-d0b75ece9e18'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Denver Union Station, Denver, CO$co$, false, false, ARRAY[$co$local$co$, $co$landmark$co$]::text[]),
  ($co$DEN-SEE-014$co$, $co$Cooper Lounge$co$, $co$Have a drink overlooking the Great Hall from 'Cooper Lounge'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '8cfd6d45-059c-4553-9ddd-d0b75ece9e18'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Cooper Lounge, Denver, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$views$co$]::text[]),
  ($co$DEN-SEE-015$co$, $co$Larimer Square$co$, $co$Walk beneath the lights at 'Larimer Square' after dark$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid, '8cfd6d45-059c-4553-9ddd-d0b75ece9e18'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Larimer Square, Denver, CO$co$, false, false, ARRAY[$co$nightlife$co$, $co$night-out$co$]::text[]),
  ($co$DEN-SEE-016$co$, $co$Dairy Block Alley$co$, $co$Find the alley art installation at 'Dairy Block Alley'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '8cfd6d45-059c-4553-9ddd-d0b75ece9e18'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Dairy Block Alley, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$art$co$]::text[]),
  ($co$DEN-SEE-017$co$, $co$McGregor Square$co$, $co$Watch part of a game on the giant outdoor screen at 'McGregor Square'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '8cfd6d45-059c-4553-9ddd-d0b75ece9e18'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$McGregor Square, Denver, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$]::text[]),
  ($co$DEN-SEE-018$co$, $co$Coors Field$co$, $co$Watch the Rockies play or take a stadium tour at 'Coors Field'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '8cfd6d45-059c-4553-9ddd-d0b75ece9e18'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Coors Field, Denver, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$, $co$baseball$co$]::text[]),
  ($co$DEN-SEE-019$co$, $co$Wynkoop Brewing Company$co$, $co$Drink a house beer inside Denver's original brewpub at 'Wynkoop Brewing Company'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '8cfd6d45-059c-4553-9ddd-d0b75ece9e18'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Wynkoop Brewing Company, Denver, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$historic$co$, $co$brewery$co$]::text[]),
  ($co$DEN-SEE-020$co$, $co$Museum of Contemporary Art Denver$co$, $co$See the current exhibition, then visit the rooftop at 'Museum of Contemporary Art Denver'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '8cfd6d45-059c-4553-9ddd-d0b75ece9e18'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Museum of Contemporary Art Denver, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$]::text[]),
  ($co$DEN-SEE-021$co$, $co$Confluence Park$co$, $co$Stand where Cherry Creek meets the South Platte at 'Confluence Park'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, '8cfd6d45-059c-4553-9ddd-d0b75ece9e18'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Confluence Park, Denver, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$park$co$]::text[]),
  ($co$DEN-SEE-023$co$, $co$Denver Central Market$co$, $co$Build a two stop snack crawl inside 'Denver Central Market'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://visitdenver.com/neighborhoods/rino-river-north-art-district/$co$, $co$Denver Central Market, Denver, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$DEN-SEE-024$co$, $co$The Source Hotel + Market Hall$co$, $co$Order a bite inside the 1870s iron foundry turned market hall at 'The Source Hotel and Market Hall'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://visitdenver.com/neighborhoods/rino-river-north-art-district/$co$, $co$The Source Hotel + Market Hall, Denver, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$DEN-SEE-025$co$, $co$RiNo ArtPark$co$, $co$Find the restored El Milagro mural at 'RiNo ArtPark'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://rinoartdistrict.org/artpark/about$co$, $co$RiNo ArtPark, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$art$co$, $co$park$co$]::text[]),
  ($co$DEN-SEE-026$co$, $co$Larimer Street murals$co$, $co$Choose and photograph your favorite mural along Larimer Street in RiNo$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://visitdenver.com/neighborhoods/rino-river-north-art-district/$co$, $co$Larimer Street murals, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$art$co$]::text[]),
  ($co$DEN-SEE-027$co$, $co$Nocturne$co$, $co$Hear a live jazz set at 'Nocturne'$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://visitdenver.com/neighborhoods/rino-river-north-art-district/$co$, $co$Nocturne, Denver, CO$co$, false, false, ARRAY[$co$nightlife$co$, $co$night-out$co$, $co$jazz$co$]::text[]),
  ($co$DEN-SEE-028$co$, $co$Cervantes' Masterpiece Ballroom$co$, $co$See a live show inside historic Five Points at 'Cervantes Masterpiece Ballroom'$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://visitdenver.com/neighborhoods/rino-river-north-art-district/$co$, $co$Cervantes' Masterpiece Ballroom, Denver, CO$co$, false, false, ARRAY[$co$nightlife$co$, $co$night-out$co$, $co$historic$co$, $co$theater$co$]::text[]),
  ($co$DEN-SEE-029$co$, $co$Blair-Caldwell African American Research Library$co$, $co$Learn one Five Points story at 'Blair Caldwell African American Research Library'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://visitdenver.com/neighborhoods/rino-river-north-art-district/$co$, $co$Blair-Caldwell African American Research Library, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$library$co$]::text[]),
  ($co$DEN-SEE-030$co$, $co$The Mission Ballroom$co$, $co$Attend a concert at 'The Mission Ballroom'$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://visitdenver.com/neighborhoods/rino-river-north-art-district/$co$, $co$The Mission Ballroom, Denver, CO$co$, false, false, ARRAY[$co$nightlife$co$, $co$night-out$co$, $co$theater$co$, $co$live-music$co$]::text[]),
  ($co$DEN-SEE-031$co$, $co$Improper City$co$, $co$Pair a food truck order with the courtyard at 'Improper City'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://visitdenver.com/neighborhoods/rino-river-north-art-district/$co$, $co$Improper City, Denver, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$DEN-SEE-032$co$, $co$Ratio Beerworks$co$, $co$Try a beer brewed on Larimer Street at 'Ratio Beerworks'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://visitdenver.com/neighborhoods/rino-river-north-art-district/$co$, $co$Ratio Beerworks, Denver, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$brewery$co$, $co$beer$co$]::text[]),
  ($co$DEN-SEE-033$co$, $co$Molly Brown House Museum$co$, $co$Tour 'Molly Brown House Museum' and learn one fact about the Unsinkable Molly Brown$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'e234aa68-444d-41dd-b32b-246268ea7b2a'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Molly Brown House Museum, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$]::text[]),
  ($co$DEN-SEE-034$co$, $co$Denver Botanic Gardens$co$, $co$Step from Colorado into the tropics inside the conservatory at 'Denver Botanic Gardens'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, 'e234aa68-444d-41dd-b32b-246268ea7b2a'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Denver Botanic Gardens, Denver, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$botanical-garden$co$]::text[]),
  ($co$DEN-SEE-036$co$, $co$City Park — Ferril Lake$co$, $co$Walk around Ferril Lake for the skyline view at 'City Park'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, 'e234aa68-444d-41dd-b32b-246268ea7b2a'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$City Park — Ferril Lake, Denver, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$park$co$, $co$views$co$]::text[]),
  ($co$DEN-SEE-037$co$, $co$Denver Museum of Nature & Science$co$, $co$See the dinosaur fossil discovered 763 feet beneath the parking lot at 'Denver Museum of Nature & Science'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'e234aa68-444d-41dd-b32b-246268ea7b2a'::uuid, $co$https://www.dmns.org/$co$, $co$Denver Museum of Nature & Science, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$, $co$park$co$]::text[]),
  ($co$DEN-SEE-038$co$, $co$Denver Zoo Conservation Alliance$co$, $co$Find an animal species you have never seen in person at 'Denver Zoo Conservation Alliance'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, 'e234aa68-444d-41dd-b32b-246268ea7b2a'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Denver Zoo Conservation Alliance, Denver, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$, $co$zoo$co$, $co$animals$co$]::text[]),
  ($co$DEN-SEE-039$co$, $co$Colfax Avenue — Ogden Theatre$co$, $co$See a show beneath the marquee at 'Ogden Theatre'$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid, 'e234aa68-444d-41dd-b32b-246268ea7b2a'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Colfax Avenue — Ogden Theatre, Denver, CO$co$, false, false, ARRAY[$co$nightlife$co$, $co$night-out$co$, $co$theater$co$]::text[]),
  ($co$DEN-SEE-045$co$, $co$Washington Park$co$, $co$Complete the loop around Smith and Grasmere lakes at 'Washington Park'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, '5c3f138a-ad76-44e5-8e01-db680e948892'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Washington Park, Denver, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$park$co$]::text[]),
  ($co$DEN-SEE-049$co$, $co$Sushi Den$co$, $co$Order one piece of nigiri selected by the chef at 'Sushi Den'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '5c3f138a-ad76-44e5-8e01-db680e948892'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Sushi Den, Denver, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$sushi$co$]::text[]),
  ($co$DEN-SEE-050$co$, $co$The Buckhorn Exchange$co$, $co$Try Rocky Mountain oysters at 'The Buckhorn Exchange'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '5c3f138a-ad76-44e5-8e01-db680e948892'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$The Buckhorn Exchange, Denver, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$DEN-SEE-052$co$, $co$Little Man Ice Cream$co$, $co$Order a scoop from the giant milk can at 'Little Man Ice Cream'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '78f5edb2-a6ad-47b7-8def-4bf09fcb37f8'::uuid, $co$https://visitdenver.com/neighborhoods/highlands/$co$, $co$Little Man Ice Cream, Denver, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$ice-cream$co$]::text[]),
  ($co$DEN-SEE-053$co$, $co$Avanti Food & Beverage Denver$co$, $co$Pair food from two vendors with the skyline view at 'Avanti Food and Beverage Denver'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '78f5edb2-a6ad-47b7-8def-4bf09fcb37f8'::uuid, $co$https://visitdenver.com/neighborhoods/highlands/$co$, $co$Avanti Food & Beverage Denver, Denver, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$views$co$]::text[]),
  ($co$DEN-SEE-054$co$, $co$Linger$co$, $co$Have a bite inside the former mortuary building at 'Linger'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '78f5edb2-a6ad-47b7-8def-4bf09fcb37f8'::uuid, $co$https://visitdenver.com/neighborhoods/highlands/$co$, $co$Linger, Denver, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$DEN-SEE-055$co$, $co$My Brother's Bar$co$, $co$Order the JCB jalapeño cream cheese burger at 'My Brother's Bar'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '78f5edb2-a6ad-47b7-8def-4bf09fcb37f8'::uuid, $co$https://www.mybrothersbar.com/$co$, $co$My Brother's Bar, Denver, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$burger$co$]::text[]),
  ($co$DEN-SEE-057$co$, $co$Tennyson Street Cultural District$co$, $co$Find a local gallery or street art piece along the 'Tennyson Street Cultural District'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '5e3fe418-c2b7-42b4-83a1-8aeeabc787e2'::uuid, $co$https://visitdenver.com/neighborhoods/highlands/$co$, $co$Tennyson Street Cultural District, Denver, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$art$co$]::text[]),
  ($co$DEN-SEE-060$co$, $co$The Oriental Theater$co$, $co$See a show at the historic 'Oriental Theater'$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid, '5e3fe418-c2b7-42b4-83a1-8aeeabc787e2'::uuid, $co$https://visitdenver.com/neighborhoods/highlands/$co$, $co$The Oriental Theater, Denver, CO$co$, false, false, ARRAY[$co$nightlife$co$, $co$night-out$co$, $co$historic$co$, $co$theater$co$]::text[]),
  ($co$DEN-SEE-061$co$, $co$Pearl Street Mall$co$, $co$Walk all four pedestrian blocks of 'Pearl Street Mall' and stop for a street performer$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Pearl Street Mall, Boulder, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$]::text[]),
  ($co$DEN-SEE-062$co$, $co$Boulder Dushanbe Teahouse$co$, $co$Have tea beneath the hand painted ceiling at 'Boulder Dushanbe Teahouse'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Boulder Dushanbe Teahouse, Boulder, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$DEN-SEE-063$co$, $co$Trident Booksellers & Cafe$co$, $co$Pair a used book browse with a coffee at 'Trident Booksellers and Cafe'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Trident Booksellers & Cafe, Boulder, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$library$co$, $co$coffee$co$]::text[]),
  ($co$DEN-SEE-064$co$, $co$Boulder Theater$co$, $co$See a film, talk or live show beneath the marquee at 'Boulder Theater'$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Boulder Theater, Boulder, CO$co$, false, false, ARRAY[$co$nightlife$co$, $co$night-out$co$, $co$theater$co$]::text[]),
  ($co$DEN-SEE-065$co$, $co$Museum of Boulder$co$, $co$Learn one surprising Boulder story at 'Museum of Boulder'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Museum of Boulder, Boulder, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$]::text[]),
  ($co$DEN-SEE-066$co$, $co$Boulder Museum of Contemporary Art$co$, $co$See the current exhibition at 'Boulder Museum of Contemporary Art'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Boulder Museum of Contemporary Art, Boulder, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$]::text[]),
  ($co$DEN-SEE-068$co$, $co$Chautauqua Park$co$, $co$Hike to the first unobstructed Flatirons viewpoint from 'Chautauqua Park'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Chautauqua Park, Boulder, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$trail$co$, $co$park$co$]::text[]),
  ($co$DEN-SEE-069$co$, $co$Royal Arch Trail$co$, $co$Reach the stone arch on 'Royal Arch Trail'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Royal Arch Trail, Boulder, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$trail$co$]::text[]),
  ($co$DEN-SEE-070$co$, $co$Mount Sanitas Trail$co$, $co$Reach the summit of 'Mount Sanitas Trail'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Mount Sanitas Trail, Boulder, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$trail$co$]::text[]),
  ($co$DEN-SEE-071$co$, $co$Boulder Creek Path$co$, $co$Travel a continuous two mile segment of 'Boulder Creek Path'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Boulder Creek Path, Boulder, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$]::text[]),
  ($co$DEN-SEE-072$co$, $co$Flagstaff Mountain — Lost Gulch Overlook$co$, $co$Catch a Front Range sunset at 'Lost Gulch Overlook'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Flagstaff Mountain — Lost Gulch Overlook, Boulder, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$views$co$]::text[]),
  ($co$DEN-SEE-073$co$, $co$NCAR Mesa Laboratory$co$, $co$Explore the public exhibits and step onto the terrace at 'NCAR Mesa Laboratory'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$NCAR Mesa Laboratory, Boulder, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$]::text[]),
  ($co$DEN-SEE-074$co$, $co$Fiske Planetarium$co$, $co$See a dome show at 'Fiske Planetarium'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Fiske Planetarium, Boulder, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$]::text[]),
  ($co$DEN-SEE-075$co$, $co$CU Boulder Heritage Center$co$, $co$Find one piece of CU history inside Old Main at 'CU Boulder Heritage Center'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$CU Boulder Heritage Center, Boulder, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$historic$co$]::text[]),
  ($co$DEN-SEE-076$co$, $co$Fox Theatre Boulder$co$, $co$See a live show on The Hill at 'Fox Theatre Boulder'$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Fox Theatre Boulder, Boulder, CO$co$, false, false, ARRAY[$co$nightlife$co$, $co$night-out$co$, $co$theater$co$]::text[]),
  ($co$DEN-SEE-077$co$, $co$Avery Brewing Company$co$, $co$Build a flight of Boulder brewed beers at 'Avery Brewing Company'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/things-to-do/insider-guides/pearl-street/$co$, $co$Avery Brewing Company, Boulder, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$brewery$co$, $co$beer$co$]::text[]),
  ($co$DEN-SEE-078$co$, $co$Celestial Seasonings$co$, $co$Tour the tea factory and sample from more than 80 teas at 'Celestial Seasonings'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://celestialseasonings.com/pages/tea-tour$co$, $co$Celestial Seasonings, Boulder, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$DEN-SEE-079$co$, $co$Left Hand Brewing Company$co$, $co$Take the brewery tour or a guided tasting at 'Left Hand Brewing Company'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$Left Hand Brewing Company, Longmont, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$brewery$co$]::text[]),
  ($co$DEN-SEE-080$co$, $co$Oskar Blues Brewery — Tasty Weasel Taproom$co$, $co$Try an Oskar Blues beer at the source inside 'Tasty Weasel Taproom'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$Oskar Blues Brewery — Tasty Weasel Taproom, Longmont, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$brewery$co$, $co$beer$co$]::text[]),
  ($co$DEN-SEE-081$co$, $co$St. Vrain Cidery$co$, $co$Build a flight of Colorado ciders at 'St. Vrain Cidery'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$St. Vrain Cidery, Longmont, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$]::text[]),
  ($co$DEN-SEE-082$co$, $co$Brewhop Trolley$co$, $co$Ride one full hop between Longmont drink makers aboard 'Brewhop Trolley'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://brewhoptrolley.com/shop/tickets/$co$, $co$Brewhop Trolley, Longmont, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$, $co$brewery$co$]::text[]),
  ($co$DEN-SEE-083$co$, $co$Wibby Brewing$co$, $co$Drink a lager in the pavilion or beer garden at 'Wibby Brewing'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$Wibby Brewing, Longmont, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$botanical-garden$co$, $co$brewery$co$]::text[]),
  ($co$DEN-SEE-084$co$, $co$300 Suns Brewing$co$, $co$Pair a house beer with the kitchen's signature chicken at '300 Suns Brewing'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$300 Suns Brewing, Longmont, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$brewery$co$, $co$beer$co$]::text[]),
  ($co$DEN-SEE-085$co$, $co$Dry Land Distillers$co$, $co$Try a locally distilled spirit during a guided tasting at 'Dry Land Distillers'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$Dry Land Distillers, Longmont, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$]::text[]),
  ($co$DEN-SEE-086$co$, $co$Abbott & Wallace Distilling$co$, $co$Order a Longmont made spirit or cocktail at 'Abbott and Wallace Distilling'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$Abbott & Wallace Distilling, Longmont, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$cocktails$co$]::text[]),
  ($co$DEN-SEE-087$co$, $co$Cheese Importers$co$, $co$Choose a cheese you have never tried from the market at 'Cheese Importers'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$Cheese Importers, Longmont, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$DEN-SEE-088$co$, $co$The Art of Cheese$co$, $co$Make your own cheese during a hands on class at 'The Art of Cheese'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$The Art of Cheese, Longmont, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$]::text[]),
  ($co$DEN-SEE-090$co$, $co$Agricultural Heritage Center$co$, $co$Learn one Boulder County farm story at 'Agricultural Heritage Center'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$Agricultural Heritage Center, Longmont, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$]::text[]),
  ($co$DEN-SEE-091$co$, $co$Downtown Longmont Creative District$co$, $co$Find three pieces of public art in the 'Downtown Longmont Creative District'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$Downtown Longmont Creative District, Longmont, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$]::text[]),
  ($co$DEN-SEE-092$co$, $co$Dickens Opera House$co$, $co$See a performance inside the historic 'Dickens Opera House'$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$Dickens Opera House, Longmont, CO$co$, false, false, ARRAY[$co$nightlife$co$, $co$night-out$co$, $co$historic$co$]::text[]),
  ($co$DEN-SEE-094$co$, $co$St. Vrain Greenway$co$, $co$Walk or bike a continuous two mile segment of 'St. Vrain Greenway'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$St. Vrain Greenway, Longmont, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$]::text[]),
  ($co$DEN-SEE-095$co$, $co$McIntosh Lake$co$, $co$Complete the loop around 'McIntosh Lake'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$McIntosh Lake, Longmont, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$]::text[]),
  ($co$DEN-SEE-096$co$, $co$Union Reservoir$co$, $co$Paddle or swim at 'Union Reservoir'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$Union Reservoir, Longmont, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$trail$co$]::text[]),
  ($co$DEN-SEE-097$co$, $co$Quarters Bar + Arcade$co$, $co$Play a retro arcade game and one round of skee ball or pinball at 'Quarters Bar and Arcade'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$Quarters Bar + Arcade, Longmont, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$, $co$arcade$co$]::text[]),
  ($co$DEN-SEE-098$co$, $co$The Passenger$co$, $co$Order one globally inspired small plate and a cocktail or mocktail at 'The Passenger'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/things-to-do/$co$, $co$The Passenger, Longmont, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$cocktails$co$]::text[]),
  ($co$DEN-SEE-099$co$, $co$Golden Welcome Arch$co$, $co$Walk beneath the Howdy Folks welcome arch in downtown Golden$co$, 'd76e2626-7782-4af1-a4ee-7783ed7f9070'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://www.visitgolden.com/things-to-do/$co$, $co$Golden Welcome Arch, Golden, CO$co$, false, false, ARRAY[$co$local$co$, $co$landmark$co$]::text[]),
  ($co$DEN-SEE-100$co$, $co$Clear Creek Trail$co$, $co$Walk beside Clear Creek from Golden's welcome arch to 'Golden History Park'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://www.visitgolden.com/things-to-do/$co$, $co$Clear Creek Trail, Golden, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$historic$co$, $co$trail$co$]::text[]),
  ($co$DEN-SEE-101$co$, $co$Coors Brewery$co$, $co$Complete the brewery tour at 'Coors Brewery'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://www.visitgolden.com/things-to-do/$co$, $co$Coors Brewery, Golden, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$brewery$co$]::text[]),
  ($co$DEN-SEE-102$co$, $co$Colorado Railroad Museum$co$, $co$Board or closely explore a historic railcar at 'Colorado Railroad Museum'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://www.visitgolden.com/things-to-do/$co$, $co$Colorado Railroad Museum, Golden, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$, $co$historic$co$]::text[]),
  ($co$DEN-SEE-103$co$, $co$Mines Museum of Earth Science$co$, $co$Find the moon rock at 'Mines Museum of Earth Science'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://www.visitgolden.com/things-to-do/$co$, $co$Mines Museum of Earth Science, Golden, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$]::text[]),
  ($co$DEN-SEE-104$co$, $co$Buffalo Bill Museum and Grave$co$, $co$Visit Buffalo Bill's grave and museum atop Lookout Mountain$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://www.visitgolden.com/things-to-do/$co$, $co$Buffalo Bill Museum and Grave, Golden, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$]::text[]),
  ($co$DEN-SEE-105$co$, $co$Golden History Park$co$, $co$Find the heirloom chickens among the historic buildings at 'Golden History Park'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://www.visitgolden.com/things-to-do/$co$, $co$Golden History Park, Golden, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$historic$co$, $co$park$co$]::text[]),
  ($co$DEN-SEE-106$co$, $co$Triceratops Trail$co$, $co$Find a dinosaur track or trace fossil along 'Triceratops Trail'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://www.visitgolden.com/things-to-do/$co$, $co$Triceratops Trail, Golden, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$trail$co$]::text[]),
  ($co$DEN-SEE-108$co$, $co$American Mountaineering Museum$co$, $co$Learn one Colorado climbing story at 'American Mountaineering Museum'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://www.visitgolden.com/things-to-do/$co$, $co$American Mountaineering Museum, Golden, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$]::text[]),
  ($co$DEN-SEE-109$co$, $co$Foothills Art Center$co$, $co$See a free exhibition inside Golden's restored Astor House at 'Foothills Art Center'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://foothillsartcenter.org/visit/$co$, $co$Foothills Art Center, Golden, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$]::text[]),
  ($co$DEN-SEE-110$co$, $co$Windy Saddle Park$co$, $co$Hike from 'Windy Saddle Park' to the Beaver Brook overlook$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://www.visitgolden.com/things-to-do/$co$, $co$Windy Saddle Park, Golden, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$trail$co$, $co$park$co$]::text[]),
  ($co$DEN-SEE-111$co$, $co$Casa Bonita$co$, $co$Watch the cliff divers and finish with sopapillas at 'Casa Bonita'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '14e669ce-b5c1-4ffa-bd8b-b4817b459c85'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Casa Bonita, Lakewood, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$DEN-SEE-112$co$, $co$Bear Creek Lake Park$co$, $co$Complete the Mount Carbon loop at 'Bear Creek Lake Park'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, '14e669ce-b5c1-4ffa-bd8b-b4817b459c85'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Bear Creek Lake Park, Lakewood, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$park$co$]::text[]),
  ($co$DEN-SEE-113$co$, $co$Heritage Lakewood Belmar Park$co$, $co$Step inside one preserved twentieth century building at 'Heritage Lakewood Belmar Park'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '14e669ce-b5c1-4ffa-bd8b-b4817b459c85'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$Heritage Lakewood Belmar Park, Lakewood, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$historic$co$, $co$park$co$]::text[]),
  ($co$DEN-SEE-114$co$, $co$40 West Arts District$co$, $co$Find three murals along the ArtLine in the '40 West Arts District'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '14e669ce-b5c1-4ffa-bd8b-b4817b459c85'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$40 West Arts District, Lakewood, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$art$co$]::text[]),
  ($co$DEN-SEE-115$co$, $co$William F. Hayden Green Mountain Park$co$, $co$Reach the Denver skyline viewpoint at 'William F. Hayden Green Mountain Park'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, '14e669ce-b5c1-4ffa-bd8b-b4817b459c85'::uuid, $co$https://visitdenver.com/neighborhoods/$co$, $co$William F. Hayden Green Mountain Park, Lakewood, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$park$co$, $co$views$co$]::text[]),
  ($co$DEN-SEE-117$co$, $co$Olde Town Arvada$co$, $co$Find the historic water tower while walking 'Olde Town Arvada'$co$, 'd76e2626-7782-4af1-a4ee-7783ed7f9070'::uuid, '0d7cce53-d99e-4232-897f-486590f71150'::uuid, $co$https://www.visitarvada.org/$co$, $co$Olde Town Arvada, Arvada, CO$co$, false, false, ARRAY[$co$local$co$, $co$landmark$co$, $co$historic$co$]::text[]),
  ($co$DEN-SEE-118$co$, $co$Talnua Distillery$co$, $co$Taste American single pot still whiskey at 'Talnua Distillery'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '0d7cce53-d99e-4232-897f-486590f71150'::uuid, $co$https://www.visitarvada.org/$co$, $co$Talnua Distillery, Arvada, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$whiskey$co$]::text[]),
  ($co$DEN-SEE-119$co$, $co$Arvada Center for the Arts and Humanities$co$, $co$See an exhibition or performance at 'Arvada Center for the Arts and Humanities'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '0d7cce53-d99e-4232-897f-486590f71150'::uuid, $co$https://www.visitarvada.org/$co$, $co$Arvada Center for the Arts and Humanities, Arvada, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$]::text[]),
  ($co$DEN-SEE-122$co$, $co$Butterfly Pavilion$co$, $co$Walk through a tropical rainforest surrounded by butterflies at 'Butterfly Pavilion'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '7ca7e3dd-c3ca-466d-a9e2-964d964e6be0'::uuid, $co$https://www.colorado.com/cities-and-towns/westminster$co$, $co$Butterfly Pavilion, Westminster, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$]::text[]),
  ($co$DEN-SEE-126$co$, $co$Adventure Golf & Raceway$co$, $co$Complete one themed mini golf course at 'Adventure Golf and Raceway'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '7ca7e3dd-c3ca-466d-a9e2-964d964e6be0'::uuid, $co$https://www.colorado.com/cities-and-towns/westminster$co$, $co$Adventure Golf & Raceway, Westminster, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$]::text[]),
  ($co$DEN-SEE-127$co$, $co$Broomfield 9/11 Memorial$co$, $co$Read the stories behind the artifacts at 'Broomfield 9/11 Memorial'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '7d8c42f0-6519-4dcd-9e2d-9ded2f81249a'::uuid, $co$https://www.broomfield.org/98/AttractionsFacilities$co$, $co$Broomfield 9/11 Memorial, Broomfield, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$]::text[]),
  ($co$DEN-SEE-130$co$, $co$Carolyn Holmberg Preserve at Rock Creek Farm$co$, $co$Walk the open space loop at 'Carolyn Holmberg Preserve at Rock Creek Farm'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, '7d8c42f0-6519-4dcd-9e2d-9ded2f81249a'::uuid, $co$https://www.broomfield.org/98/AttractionsFacilities$co$, $co$Carolyn Holmberg Preserve at Rock Creek Farm, Broomfield, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$park$co$]::text[]),
  ($co$DEN-SEE-132$co$, $co$Louisville Historical Museum$co$, $co$Learn one coal mining era story at 'Louisville Historical Museum'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '7b098c15-c258-43c9-953f-672c464be02b'::uuid, $co$https://www.bouldercoloradousa.com/$co$, $co$Louisville Historical Museum, Louisville, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$, $co$museum$co$, $co$historic$co$]::text[]),
  ($co$DEN-SEE-136$co$, $co$Waneka Lake Park$co$, $co$Complete the lake loop at 'Waneka Lake Park'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, '3a8dd37f-c208-4763-9ce4-4eca61b89516'::uuid, $co$https://www.bouldercoloradousa.com/$co$, $co$Waneka Lake Park, Lafayette, CO$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$park$co$]::text[]),
  ($co$DEN-SEE-137$co$, $co$WOW! Children's Museum$co$, $co$Complete one hands on exhibit challenge at 'WOW! Children's Museum'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '3a8dd37f-c208-4763-9ce4-4eca61b89516'::uuid, $co$https://www.bouldercoloradousa.com/$co$, $co$WOW! Children's Museum, Lafayette, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$, $co$museum$co$]::text[]),
  ($co$DEN-SEE-138$co$, $co$The Collective Community Arts Center$co$, $co$See a local exhibition or program at 'The Collective Community Arts Center'$co$, '48631ca5-19d2-4098-abc6-9a4c95d276b4'::uuid, '3a8dd37f-c208-4763-9ce4-4eca61b89516'::uuid, $co$https://www.bouldercoloradousa.com/$co$, $co$The Collective Community Arts Center, Lafayette, CO$co$, false, false, ARRAY[$co$arts$co$, $co$local-culture$co$]::text[]),
  ($co$DEN-SEE-139$co$, $co$Liquid Mechanics Brewing Company$co$, $co$Try a Lafayette brewed beer at 'Liquid Mechanics Brewing Company'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '3a8dd37f-c208-4763-9ce4-4eca61b89516'::uuid, $co$https://www.bouldercoloradousa.com/$co$, $co$Liquid Mechanics Brewing Company, Lafayette, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$brewery$co$, $co$beer$co$]::text[]),
  ($co$DEN-SEE-146$co$, $co$Carousel of Happiness$co$, $co$Ride a hand carved animal on the restored 'Carousel of Happiness'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '8f57ac21-5317-411e-87ed-a6f64009ef91'::uuid, $co$https://www.colorado.com/cities-and-towns/nederland$co$, $co$Carousel of Happiness, Nederland, CO$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$, $co$animals$co$]::text[]),
  ($co$DEN-SEE-151$co$, $co$Knotted Root Brewing Company$co$, $co$Try a Nederland brewed beer at 'Knotted Root Brewing Company'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '8f57ac21-5317-411e-87ed-a6f64009ef91'::uuid, $co$https://www.colorado.com/cities-and-towns/nederland$co$, $co$Knotted Root Brewing Company, Nederland, CO$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$brewery$co$, $co$beer$co$]::text[]),
  ($co$DEN-SEE-152$co$, $co$Train Cars Coffee and Kava$co$, $co$Eat the world famous mini donuts inside the train car cafe at 'Train Cars Coffee and Kava'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '8f57ac21-5317-411e-87ed-a6f64009ef91'::uuid, $co$https://www.traincarscoffeeandkava.com/$co$, $co$Train Cars Coffee and Kava, Nederland, CO$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$coffee$co$]::text[]),
  ($co$HG-001$co$, $co$The Dragontree Spa$co$, $co$Rotate through the cedar sauna, cold plunge, salt room and forest showers at 'The Dragontree'$co$, 'aad9e527-57d9-4f96-a6f3-b863ae4a75a4'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://thedragontree.com/pages/boulder-day-spa-and-sanctuary$co$, $co$The Dragontree Spa, 2405 Broadway, Boulder, CO 80304$co$, false, false, ARRAY[$co$spa$co$, $co$wellness$co$, $co$sauna$co$]::text[]),
  ($co$HG-002$co$, $co$B&GC$co$, $co$Find the gold doorbell and enter the hidden bar at 'B&GC'$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid, 'f1835731-c5ca-40bc-a37f-d0013666f039'::uuid, $co$https://bandgcdenver.com/$co$, $co$B&GC, 249 Columbine St, Denver, CO 80206$co$, true, false, ARRAY[$co$nightlife$co$, $co$night-out$co$, $co$hidden-bar$co$]::text[]),
  ($co$HG-003$co$, $co$Cherry Cricket$co$, $co$Order the 303 Green Chile Relleno Burger at 'Cherry Cricket'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'f1835731-c5ca-40bc-a37f-d0013666f039'::uuid, $co$https://cherrycricket.com/location-cherry-creek$co$, $co$Cherry Cricket, 2641 E 2nd Ave, Denver, CO 80206$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$burger$co$]::text[]),
  ($co$HG-004$co$, $co$El Taco de Mexico$co$, $co$Order the chile relleno burrito smothered in green chile at 'El Taco de Mexico'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '9ec42458-871a-4150-97d7-52c201cd54aa'::uuid, $co$https://eltacodemexico5280.com/$co$, $co$El Taco de Mexico, 714 Santa Fe Dr, Denver, CO 80204$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$tacos$co$]::text[]),
  ($co$HG-005$co$, $co$Hammond's Candies$co$, $co$Watch candy canes or lollipops being made on the free tour at 'Hammond's Candies'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://hammondscandies.com/pages/factory-tours-new$co$, $co$Hammond's Candies, 5735 Washington St, Denver, CO 80216$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$]::text[]),
  ($co$HG-006$co$, $co$International Church of Cannabis$co$, $co$Watch the BEYOND light show inside 'International Church of Cannabis'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '5c3f138a-ad76-44e5-8e01-db680e948892'::uuid, $co$https://beyondlightshow.com/products/beyond-light-show-ticket$co$, $co$International Church of Cannabis, 400 S Logan St, Denver, CO 80209$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$]::text[]),
  ($co$HG-007$co$, $co$Neko Ramen & Rice$co$, $co$Order the Black Garlic Ramen with pork chashu and black garlic oil at 'Neko Ramen & Rice'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://nekoramenandrice.com/$co$, $co$Neko Ramen & Rice, 4030 Colorado Blvd, Unit 103, Denver, CO 80216$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$HG-008$co$, $co$Oakwell Beer Spa$co$, $co$Complete the infrared-sauna, cold-shower and hops-and-barley bath circuit at 'Oakwell Beer Spa'$co$, 'aad9e527-57d9-4f96-a6f3-b863ae4a75a4'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://oakwell.com/$co$, $co$Oakwell Beer Spa, 3004 N Downing St, Denver, CO 80205$co$, false, false, ARRAY[$co$spa$co$, $co$wellness$co$, $co$beer$co$, $co$sauna$co$]::text[]),
  ($co$HG-009$co$, $co$Pig and Tiger$co$, $co$Order the shrimp-and-pork chili wontons with zha cai and chili oil at 'Pig and Tiger'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'd20dbe4f-e45b-4965-b638-cba07b79618f'::uuid, $co$https://pigandtiger.com/$co$, $co$Pig and Tiger, 2200 California St, Denver, CO 80205$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$HG-010$co$, $co$ROK SPAS$co$, $co$Complete the sauna, cold-plunge, warm-soak and steam circuit at 'ROK SPAS'$co$, 'aad9e527-57d9-4f96-a6f3-b863ae4a75a4'::uuid, '8cfd6d45-059c-4553-9ddd-d0b75ece9e18'::uuid, $co$https://rokspas.com/$co$, $co$ROK SPAS, 2025 17th St, Denver, CO 80202$co$, false, false, ARRAY[$co$spa$co$, $co$wellness$co$, $co$sauna$co$]::text[]),
  ($co$HG-011$co$, $co$Run for the Roses$co$, $co$Choose a cocktail from the 52-card menu at 'Run for the Roses'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '8cfd6d45-059c-4553-9ddd-d0b75ece9e18'::uuid, $co$https://rftrbar.com/$co$, $co$Run for the Roses, 1801 Blake St, Suite 10, Denver, CO 80202$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$cocktails$co$]::text[]),
  ($co$HG-012$co$, $co$Tocabe$co$, $co$Order an Indian taco with bison at 'Tocabe'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '5e3fe418-c2b7-42b4-83a1-8aeeabc787e2'::uuid, $co$https://www.tocabe.com/menu$co$, $co$Tocabe, 3536 W 44th Ave, Denver, CO 80211$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$tacos$co$]::text[]),
  ($co$HG-013$co$, $co$Williams & Graham$co$, $co$Enter through the bookcase and order a cocktail at 'Williams & Graham'$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid, '78f5edb2-a6ad-47b7-8def-4bf09fcb37f8'::uuid, $co$https://williamsandgraham.com/$co$, $co$Williams & Graham, 3160 Tejon St, Denver, CO 80211$co$, true, false, ARRAY[$co$nightlife$co$, $co$night-out$co$, $co$cocktails$co$, $co$hidden-bar$co$]::text[]),
  ($co$HG-014$co$, $co$Bonfire Burritos$co$, $co$Order the Chupacabra breakfast burrito at 'Bonfire Burritos'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://bonfireburritos.com/golden-menu/$co$, $co$Bonfire Burritos, 2221 Ford St, Golden, CO 80401$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$HG-015$co$, $co$Sherpa House$co$, $co$Order momos in the cultural-center courtyard at 'Sherpa House'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'e2e8ebab-5465-4f55-816b-4abf556d2db4'::uuid, $co$https://www.sherpahouse.com/$co$, $co$Sherpa House, 1518 Washington Ave, Golden, CO 80401$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$HG-016$co$, $co$Romero's K9 Club & Tap House$co$, $co$Let your dog play off leash while you order a local beer at 'Romero's K9 Club'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '3a8dd37f-c208-4763-9ce4-4eca61b89516'::uuid, $co$https://www.romerosk9club.com/faq$co$, $co$Romero's K9 Club & Tap House, 985 S Public Rd, Lafayette, CO 80026$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$brewery$co$, $co$beer$co$]::text[]),
  ($co$HG-017$co$, $co$Sunflower Farm$co$, $co$Feed the animals during a Farmfest session at 'Sunflower Farm'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.sunflowerfarminfo.com/farmfest-public-hours$co$, $co$Sunflower Farm, 11150 Prospect Rd, Longmont, CO 80504$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$, $co$animals$co$]::text[]),
  ($co$HG-018$co$, $co$Caribou Ranch Open Space$co$, $co$Hike to the Blue Bird Mine bunkhouse and ore-cart tracks at 'Caribou Ranch'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, '8f57ac21-5317-411e-87ed-a6f64009ef91'::uuid, $co$https://bouldercounty.gov/open-space/parks-and-trails/caribou-ranch/$co$, $co$Caribou Ranch Open Space, 144 County Road 126, Nederland, CO 80466$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$trail$co$, $co$park$co$]::text[]),
  ($co$HG-019$co$, $co$Akihabara Arcade and Bar$co$, $co$Play a Japanese arcade game and order a themed drink at 'Akihabara Arcade and Bar'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '7ca7e3dd-c3ca-466d-a9e2-964d964e6be0'::uuid, $co$http://www.akihabaraarcade.com/$co$, $co$Akihabara Arcade and Bar, 8901 N Harlan St, Westminster, CO 80031$co$, true, false, ARRAY[$co$play$co$, $co$fun$co$, $co$arcade$co$]::text[]),
  ($co$HG-020$co$, $co$School House Kitchen and Libations$co$, $co$Build a three-pour whiskey flight inside the 1882 schoolhouse at 'School House'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '0d7cce53-d99e-4232-897f-486590f71150'::uuid, $co$https://www.schoolhousemenu.com/$co$, $co$School House Kitchen and Libations, 5660 Olde Wadsworth Blvd, Arvada, CO 80002$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$historic$co$, $co$whiskey$co$]::text[]),
  ($co$HG-060$co$, $co$Busey Brews$co$, $co$Pair Cerveza mí Face-ah with the Nashville smoked wings at 'Busey Brews'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '8f57ac21-5317-411e-87ed-a6f64009ef91'::uuid, $co$https://buseybrews.com/cerveza/$co$, $co$Busey Brews, 70 E 1st St, Nederland, CO 80466$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$brewery$co$]::text[]),
  ($co$HG-022$co$, $co$Busaba Thai$co$, $co$Start with the Busaba Chicken Puff at 'Busaba Thai'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://busabaco.com/menu/busaba-boulder-4800-baseline-rd-a-110$co$, $co$Busaba Thai, 4800 Baseline Rd, A-110, Boulder, CO 80303$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$HG-023$co$, $co$Flower Pepper$co$, $co$Order the handmade soup dumplings at 'Flower Pepper'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.bouldercoloradousa.com/listings/flower-pepper/2276/$co$, $co$Flower Pepper, 1310 College Ave, Boulder, CO 80302$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$HG-024$co$, $co$Lucile's Creole Cafe$co$, $co$Tear open a powdered-sugar beignet at 'Lucile's Creole Cafe'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.luciles.com/boulder-location-menu/$co$, $co$Lucile's Creole Cafe, 2124 14th St, Boulder, CO 80302$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$bakery$co$]::text[]),
  ($co$HG-025$co$, $co$The Sink$co$, $co$Order the original Sink cheeseburger as a trio of sliders beneath the ceiling art at 'The Sink'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'b758388e-6211-497a-ba79-c811ff6dda4b'::uuid, $co$https://www.thesink.com/dinner-lunch$co$, $co$The Sink, 1165 13th St, Boulder, CO 80302$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$art$co$, $co$burger$co$]::text[]),
  ($co$HG-026$co$, $co$The Burns Pub$co$, $co$Order a Scotch egg with a British ale at 'The Burns Pub'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '7d8c42f0-6519-4dcd-9e2d-9ded2f81249a'::uuid, $co$https://theburnspub.com/$co$, $co$The Burns Pub, 9009 Metro Airport Ave, Broomfield, CO 80021$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$HG-027$co$, $co$Denver Biscuit Company$co$, $co$Order The Franklin biscuit sandwich at 'Denver Biscuit Company'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, 'e234aa68-444d-41dd-b32b-246268ea7b2a'::uuid, $co$https://www.theatomiccowboy.com/locations-colfax$co$, $co$Denver Biscuit Company, 3237 E Colfax Ave, Denver, CO 80206$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$bakery$co$]::text[]),
  ($co$HG-028$co$, $co$The Inventing Room$co$, $co$Complete the current Sugar Science tasting and choose a liquid-nitrogen sundae at 'The Inventing Room'$co$, 'b5257fd4-f723-46fb-b86e-365a88deb0f3'::uuid, '78f5edb2-a6ad-47b7-8def-4bf09fcb37f8'::uuid, $co$https://tirdenver.com/sugar-science$co$, $co$The Inventing Room, 4433 W 29th Ave, Unit 101, Denver, CO 80212$co$, false, false, ARRAY[$co$play$co$, $co$fun$co$, $co$ice-cream$co$]::text[]),
  ($co$HG-029$co$, $co$Acreage by Stem Ciders$co$, $co$Build a cider flight with the Front Range view at 'Acreage by Stem Ciders'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '3a8dd37f-c208-4763-9ce4-4eca61b89516'::uuid, $co$https://acreageco.com/$co$, $co$Acreage by Stem Ciders, 1380 Horizon Ave, Unit A, Lafayette, CO 80026$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$views$co$]::text[]),
  ($co$HG-030$co$, $co$Big Sky Burger$co$, $co$Order the ribeye bulgogi burger at 'Big Sky Burger'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '14e669ce-b5c1-4ffa-bd8b-b4817b459c85'::uuid, $co$https://www.bigskyburger.com/menu/$co$, $co$Big Sky Burger, 1958 S Garrison St, Lakewood, CO 80227$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$burger$co$]::text[]),
  ($co$HG-031$co$, $co$Biscuit Mike's$co$, $co$Order the Brian—fried chicken, over-medium egg, cheese and honey—at 'Biscuit Mike's'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.visitlongmont.org/listing/biscuit-mike%E2%80%99s/20809/$co$, $co$Biscuit Mike's, 900 Coffman St, Suite B, Longmont, CO 80501$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$bakery$co$]::text[]),
  ($co$HG-032$co$, $co$Button Rock Preserve$co$, $co$Hike two miles to Ralph Price Reservoir at 'Button Rock Preserve'$co$, 'd1019850-5513-4d85-825c-7357ffc36ebc'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://longmontcolorado.gov/facility/button-rock-preserve/$co$, $co$Button Rock Preserve, County Road 80, Lyons, CO 80540$co$, false, false, ARRAY[$co$adventure$co$, $co$outdoor$co$, $co$trail$co$]::text[]),
  ($co$HG-033$co$, $co$HipPOPS$co$, $co$Build a gelato bar dipped in Belgian chocolate at 'HipPOPS'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://hippops.com/$co$, $co$HipPOPS, 700 Ken Pratt Blvd, Suite 200, Longmont, CO 80501$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$ice-cream$co$]::text[]),
  ($co$HG-034$co$, $co$Marco's Hot Dogs & Tacos$co$, $co$Order the bacon-wrapped hot dog with beans, onions, tomato, cheese and condiments at 'Marco's Hot Dogs & Tacos'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://marcoshotdogsandtacos.com/$co$, $co$Marco's Hot Dogs & Tacos, 1647 Kimbark St, Longmont, CO 80501$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$tacos$co$, $co$hot-dog$co$]::text[]),
  ($co$HG-035$co$, $co$Rosario's Peruvian Restaurant$co$, $co$Order the arroz con pollo at 'Rosario's Peruvian Restaurant'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.rosariosperuvianrestaurant.com/$co$, $co$Rosario's Peruvian Restaurant, 625 Ken Pratt Blvd, Longmont, CO 80501$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$HG-036$co$, $co$740 Front$co$, $co$Have a drink at the historic Brunswick back bar at '740 Front'$co$, 'b6ffb902-d9b3-4585-af19-1df9d405ec33'::uuid, '7b098c15-c258-43c9-953f-672c464be02b'::uuid, $co$https://740front.com/$co$, $co$740 Front, 740 Front St, Louisville, CO 80027$co$, true, false, ARRAY[$co$bar$co$, $co$drinks$co$, $co$historic$co$]::text[]),
  ($co$HG-038$co$, $co$Chinese Palace Dim Sum$co$, $co$Order the handmade shrimp-and-pork shu mai at 'Chinese Palace Dim Sum'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '1ec57b5b-047a-4158-8497-bb53a5d59e0b'::uuid, $co$https://www.chinesepalaceco.com/$co$, $co$Chinese Palace Dim Sum, 11970 Washington St, Northglenn, CO 80233$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$]::text[]),
  ($co$HG-039$co$, $co$24 Carrot Bistro$co$, $co$Step behind the bookcase for a monthly speakeasy night at '24 Carrot Bistro'$co$, '99a3f07b-561d-40b1-bf42-4fa404ffd509'::uuid, '311db7f8-f584-47c1-98c9-29c5b1192edc'::uuid, $co$https://www.24carrotbistro.com/$co$, $co$24 Carrot Bistro, 578 Briggs St, Erie, CO 80516$co$, true, true, ARRAY[$co$nightlife$co$, $co$night-out$co$, $co$hidden-bar$co$]::text[]),
  ($co$HG-040$co$, $co$Sushi Box$co$, $co$Order a sushi burrito at 'Sushi Box'$co$, 'ab2b96ab-9a6b-4c6c-ad7a-b73ce2578d85'::uuid, '018da150-6ebf-43f3-8eb1-e37338310738'::uuid, $co$https://www.sushiboxlongmont.com/$co$, $co$Sushi Box, 1844 Hover St, Suite C, Longmont, CO 80501$co$, false, false, ARRAY[$co$food$co$, $co$restaurant$co$, $co$sushi$co$]::text[]);

DO $do$
DECLARE
  staged_count integer;
BEGIN
  SELECT count(*) INTO staged_count FROM _denver_catalog_candidates;
  IF staged_count <> 149 THEN
    RAISE EXCEPTION 'Expected 149 SQL-eligible candidates; staged %', staged_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM _denver_catalog_candidates
    WHERE btrim(maps_query) = '' OR cardinality(tag_names) < 2
  ) THEN
    RAISE EXCEPTION 'Every candidate must have a maps_query and at least two tags';
  END IF;
  IF EXISTS (
    SELECT lower(regexp_replace(btrim(maps_query), '[^a-z0-9]+', '', 'g'))
    FROM _denver_catalog_candidates
    GROUP BY 1 HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate normalized maps_query values exist inside the staged cohort';
  END IF;
END
$do$;

CREATE TEMP TABLE _denver_preexisting_matches ON COMMIT DROP AS
SELECT
  c.source_candidate_id,
  i.id AS existing_item_id,
  i.body AS existing_body,
  i.maps_query AS existing_maps_query
FROM _denver_catalog_candidates c
JOIN public.items i
  ON lower(regexp_replace(btrim(i.maps_query), '[^a-z0-9]+', '', 'g'))
   = lower(regexp_replace(btrim(c.maps_query), '[^a-z0-9]+', '', 'g'));

DO $do$
BEGIN
  IF EXISTS (
    SELECT source_candidate_id
    FROM _denver_preexisting_matches
    GROUP BY source_candidate_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A staged candidate matches multiple production items; manual duplicate review required';
  END IF;
END
$do$;

CREATE TEMP TABLE _denver_new_items (
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
    c.body, c.category_id, NULL, NULL, 'tap', NULL,
    150, false, true, NULL, true,
    c.neighborhood_id, 0, NULL, c.is_recurring, NULL,
    NULL, c.website_url, c.maps_query, NULL, NULL, c.has_alcohol,
    1, false, false, NULL,
    NULL, false, NULL,
    NULL, false, NULL,
    NULL, NULL,
    NULL, NULL
  FROM _denver_catalog_candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM _denver_preexisting_matches d
    WHERE d.source_candidate_id = c.source_candidate_id
  )
  RETURNING id, body, maps_query, neighborhood_id
)
INSERT INTO _denver_new_items (item_id, source_candidate_id)
SELECT i.id, c.source_candidate_id
FROM inserted i
JOIN _denver_catalog_candidates c
  ON c.body = i.body
 AND c.maps_query = i.maps_query
 AND c.neighborhood_id = i.neighborhood_id;

INSERT INTO public.item_tags (item_id, tag_id, source, confidence)
SELECT ni.item_id, t.id, 'ai', 1.0
FROM _denver_new_items ni
JOIN _denver_catalog_candidates c USING (source_candidate_id)
CROSS JOIN LATERAL unnest(c.tag_names) AS chosen(tag_name)
JOIN public.tags t ON t.name = chosen.tag_name
ON CONFLICT (item_id, tag_id) DO NOTHING;

CREATE TEMP TABLE _denver_batch_items ON COMMIT DROP AS
SELECT c.source_candidate_id, i.id AS item_id
FROM _denver_catalog_candidates c
JOIN public.items i
  ON lower(regexp_replace(btrim(i.maps_query), '[^a-z0-9]+', '', 'g'))
   = lower(regexp_replace(btrim(c.maps_query), '[^a-z0-9]+', '', 'g'));

DO $do$
BEGIN
  IF (SELECT count(*) FROM _denver_batch_items) <> 149 THEN
    RAISE EXCEPTION 'Batch reconciliation failed: expected 149 staged items after insert';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM _denver_batch_items b
    JOIN public.items i ON i.id = b.item_id
    WHERE i.is_active IS DISTINCT FROM true
       OR i.is_approved IS DISTINCT FROM true
       OR i.is_universal IS DISTINCT FROM false
       OR i.city_id IS NOT NULL
       OR i.season_tag IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'One or more Denver batch items violate locked intake values';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM _denver_new_items n
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
    SELECT 1 FROM public.list_items li
    JOIN _denver_new_items n ON n.item_id = li.item_id
  ) THEN
    RAISE EXCEPTION 'Unexpected official-list membership found for a newly inserted item';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.curated_list_items cli
    JOIN _denver_new_items n ON n.item_id = cli.item_id
  ) THEN
    RAISE EXCEPTION 'Unexpected curated-list membership found for a newly inserted item';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM _denver_new_items n
    LEFT JOIN public.item_tags it ON it.item_id = n.item_id
    GROUP BY n.item_id
    HAVING count(it.tag_id) < 2
  ) THEN
    RAISE EXCEPTION 'A newly inserted item is missing its required tags';
  END IF;
END
$do$;

SELECT
  149 AS staged_candidates,
  (SELECT count(*) FROM _denver_new_items) AS inserted_now,
  (SELECT count(*) FROM _denver_preexisting_matches) AS skipped_as_existing,
  1 AS omitted_before_sql,
  150 AS starting_candidates;

-- Verification queries run before COMMIT so they can reuse the transaction's
-- temporary reconciliation tables. They are read-only.
SELECT id, name, slug, is_active
FROM public.metros
WHERE id = 'b00f7f91-3176-48c5-aaf1-6ded7426f756'::uuid;

SELECT n.id, n.name, n.slug, n.metro_id, n.is_active,
       n.ring_0_radius_m, n.ring_1_radius_m, n.ring_2_radius_m, n.ring_3_radius_m
FROM public.neighborhoods n
JOIN _denver_required_neighborhoods r ON r.id = n.id
ORDER BY n.name;

SELECT n.id, n.name, n.slug, n.metro_id, n.is_active,
       ST_Y(n.center_geo::geometry) AS center_lat,
       ST_X(n.center_geo::geometry) AS center_lng,
       n.ring_0_radius_m, n.ring_1_radius_m, n.ring_2_radius_m, n.ring_3_radius_m
FROM public.neighborhoods n
WHERE n.id = '8f57ac21-5317-411e-87ed-a6f64009ef91'::uuid;

SELECT
  count(*) AS reconciled_batch_count,
  count(*) FILTER (WHERE n.item_id IS NOT NULL) AS inserted_this_run,
  count(*) FILTER (WHERE p.existing_item_id IS NOT NULL) AS preexisting_count,
  count(*) FILTER (WHERE i.is_active) AS active_count,
  count(*) FILTER (WHERE i.is_approved) AS approved_count,
  count(*) FILTER (WHERE i.is_universal) AS universal_count,
  count(*) FILTER (WHERE i.season_tag IS NULL) AS null_season_count,
  count(*) FILTER (WHERE i.maps_lat IS NULL AND i.maps_lng IS NULL
                    AND i.geo_location IS NULL AND i.google_place_id IS NULL
                    AND i.formatted_address IS NULL) AS places_pending_count
FROM _denver_batch_items b
JOIN public.items i ON i.id = b.item_id
LEFT JOIN _denver_new_items n ON n.item_id = b.item_id
LEFT JOIN _denver_preexisting_matches p USING (source_candidate_id);

SELECT c.name AS category, count(*) AS item_count
FROM _denver_batch_items b
JOIN public.items i ON i.id = b.item_id
JOIN public.categories c ON c.id = i.category_id
GROUP BY c.name
ORDER BY c.name;

SELECT n.name AS neighborhood, count(*) AS item_count
FROM _denver_batch_items b
JOIN public.items i ON i.id = b.item_id
JOIN public.neighborhoods n ON n.id = i.neighborhood_id
GROUP BY n.name
ORDER BY n.name;

SELECT i.google_place_id, count(*) AS duplicate_count
FROM _denver_batch_items b
JOIN public.items i ON i.id = b.item_id
WHERE i.google_place_id IS NOT NULL
GROUP BY i.google_place_id
HAVING count(*) > 1;

SELECT count(*) AS official_memberships
FROM public.list_items li
JOIN _denver_batch_items b ON b.item_id = li.item_id;

SELECT count(*) AS curated_memberships
FROM public.curated_list_items cli
JOIN _denver_batch_items b ON b.item_id = cli.item_id;

SELECT
  b.source_candidate_id,
  i.id,
  i.body,
  n.name AS neighborhood,
  i.maps_query,
  i.is_active,
  i.maps_lat,
  i.maps_lng,
  i.geo_location,
  i.google_place_id,
  i.formatted_address,
  count(DISTINCT it.tag_id) AS tag_count,
  count(DISTINCT li.id) AS official_list_count,
  count(DISTINCT cli.id) AS curated_list_count
FROM _denver_batch_items b
JOIN public.items i ON i.id = b.item_id
JOIN public.neighborhoods n ON n.id = i.neighborhood_id
LEFT JOIN public.item_tags it ON it.item_id = i.id
LEFT JOIN public.list_items li ON li.item_id = i.id
LEFT JOIN public.curated_list_items cli ON cli.item_id = i.id
GROUP BY b.source_candidate_id, i.id, i.body, n.name, i.maps_query,
         i.is_active, i.maps_lat, i.maps_lng, i.geo_location,
         i.google_place_id, i.formatted_address
ORDER BY b.source_candidate_id;

COMMIT;
