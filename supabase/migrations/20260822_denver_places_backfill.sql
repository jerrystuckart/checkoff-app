-- Denver Places backfill -- Pass 3 commit SQL
-- Generated 2026-08-22 from scripts/output/denver-geocode-2026-08-22.csv (149 rows)
-- and scripts/output/denver-geocode-rescore-2026-08-22.csv (53 re-run rows).
--
-- Category breakdown (149 total items with maps_lat IS NULL going in):
--   A (auto-commit, STRONG match): 119
--   B (manually approved despite ambiguity/variant/rebrand flag): 25
--   C (manual override -- wrong candidate replaced): 1
--   D (HELD OUT -- CLOSED_TEMPORARILY, needs a product decision): 2
--   E (new query resolved a bad original maps_query): 1
--   F (HELD OUT -- no Places listing exists, needs manual sourcing): 1
--   Total in this commit (A+B+C+E): 146
--   Total held out (D+F): 3
--   149 = 119 + 25 + 1 + 2 + 1 + 1
--
-- Category C override: b05c509c (The Art of Cheese, Longmont) -- the script's
-- default pick (places[0]) was 8,701 N 55th St, 11,288m from Longmont's center;
-- a second, identically-named Places result at 350 Terry St (324m from center)
-- was identified as the correct one during the rescore investigation and is used
-- here instead.
--
-- Category E resolution: a7df3180 (Tennyson Street Cultural District) matched a
-- real but wrong district (Art District on Santa Fe, 6.2km away) on both prior
-- runs. Replacement query built from a live web search confirming Tennyson
-- Street's actual cross streets (38th-46th Ave, Berkeley neighborhood) and a
-- specific real gallery on the street itself (Future Drawn oneLINE Gallery, 4420
-- Tennyson St -- also directly relevant to the item's own body text, which asks
-- for "a local gallery or street art piece"). Single candidate, OPERATIONAL, 393m
-- from the Berkeley/Tennyson neighborhood center.
--
-- geo_location is intentionally NOT set directly in these UPDATEs --
-- trg_sync_item_geo_location derives it from maps_lat/maps_lng automatically.
--
-- Each UPDATE is guarded by AND maps_lat IS NULL, so a row only changes if it
-- still has no coordinates today -- if this has drifted since the CSVs were
-- generated, that row's WHERE clause simply won't match and the postflight count
-- check below will catch it, instead of silently overwriting a coordinate someone
-- else already set.

BEGIN;

DO $do$
BEGIN
  IF EXISTS (
    WITH expected(item_id) AS (
      VALUES
      ('0058d8dc-fdf4-4ab2-88f5-b9b4b85c61c7'::uuid),
      ('010907d9-e545-4439-bf35-0422f3e09758'::uuid),
      ('03f59ab1-32b9-4037-b083-fa1d5bafc526'::uuid),
      ('04bf3f18-8e08-4f09-8671-17f6f3fd65b6'::uuid),
      ('052a0a3b-44e2-423e-8318-b755cc2d2b0d'::uuid),
      ('05655893-cb5d-45f1-8210-b3bb652b884d'::uuid),
      ('08893b11-d552-407a-a407-255625f949db'::uuid),
      ('0c483c15-f425-4750-885f-5461d81f387c'::uuid),
      ('104bbb02-92a3-447a-968f-7cde6e0e137c'::uuid),
      ('12792398-76f2-4a51-aef1-551a284d0d9f'::uuid),
      ('13772396-c850-44b2-a008-465013e49efb'::uuid),
      ('14683011-33a7-4bcb-9508-563548d2ff73'::uuid),
      ('14e1bd19-fad5-44e7-8ec1-9a8088953af3'::uuid),
      ('16f97705-df7b-44dc-8273-dd5a74f8b7de'::uuid),
      ('1915043e-a819-4bd4-8f70-b6d20404ff3e'::uuid),
      ('1a1ea071-5b80-4b48-8081-24a55d2796c0'::uuid),
      ('1a2689a8-2570-4c4a-b6cd-1a858e7fe25c'::uuid),
      ('1cb0161d-464c-4fee-bcb0-3e4e735ac4f0'::uuid),
      ('1d4b68b6-546d-4039-a4fd-f76df7230c1a'::uuid),
      ('1fb94167-c521-43a8-ac26-8cf61b61b306'::uuid),
      ('218678c7-c7f7-40f5-8131-1dcec8ac028b'::uuid),
      ('22230bac-ab00-4e34-ae95-df977d37e800'::uuid),
      ('227d2f0f-fc9d-47c5-a1cd-821818092b33'::uuid),
      ('276561ac-76be-4795-80eb-d9bec1672955'::uuid),
      ('2957baa5-270d-453e-bf0f-54b7e94ddb41'::uuid),
      ('29b6827c-2e59-4b21-9a15-ecbb7188a556'::uuid),
      ('2a3523f7-31a1-4ad5-93db-e276bf1b0ed7'::uuid),
      ('2cd5dab3-ac6b-4730-8d08-dfae0f0ad66f'::uuid),
      ('2e2c2fc5-f13a-44c3-ba83-888c392a0f17'::uuid),
      ('36911e65-55e4-4e9c-a3e4-b1b04fb8c5cc'::uuid),
      ('36c87d34-8c14-4236-b7d9-da32d2e65b06'::uuid),
      ('3bc7e5ce-f628-4ce5-87aa-813130006ed9'::uuid),
      ('3d2d8e9d-876c-49f4-90d1-d13b5f1621e9'::uuid),
      ('3f269beb-e3f6-473e-9c36-ccdea5e3f599'::uuid),
      ('3fc6c1ee-aba0-4f53-b5f0-9e4ac8ac91e3'::uuid),
      ('432d8675-53b1-4a43-9233-53708507831c'::uuid),
      ('43aa56cf-5529-415d-aa0d-9e04f5431315'::uuid),
      ('442ee691-41ef-4a16-aad6-bc757480e9e6'::uuid),
      ('46357f48-049a-4f90-b833-356ec0b2448b'::uuid),
      ('4669e6ea-005e-48bd-a517-71b0e218be7e'::uuid),
      ('476cf174-504c-45c5-b520-233c28a5ac40'::uuid),
      ('4a37a0e9-2d15-46e5-9e41-c3f16cedb850'::uuid),
      ('53f78e06-6997-45a7-8103-92a26d5bc018'::uuid),
      ('58eb6e0b-80f0-4279-9893-59ab8e5453c4'::uuid),
      ('591ab105-f33d-42c5-b474-e6610157bf27'::uuid),
      ('597247fb-f09f-4f80-a2b6-5170643a9d81'::uuid),
      ('5eb9abca-a4d2-455d-8644-28782f3ca3c1'::uuid),
      ('5ecda3c3-e40a-4698-83f5-e25fdfc96cdb'::uuid),
      ('5f9a1622-2267-47a6-b19e-387c7a636df5'::uuid),
      ('60285c1f-87b1-4f6c-8ed4-ac89e467baf4'::uuid),
      ('60834533-2059-4404-8c5c-b804c31d96c2'::uuid),
      ('61750c16-18b7-4f12-b2fd-0807bc8465d6'::uuid),
      ('63bfd734-9dc2-4211-9030-11eee9101d7d'::uuid),
      ('6607f6bb-d9f3-4baa-8951-511c1cf995ea'::uuid),
      ('67ac51f2-072f-4e79-ac0f-35ddb447ad6b'::uuid),
      ('694b9858-dbcf-4e32-aba9-ed2a2bbc9316'::uuid),
      ('70024913-9352-4e78-9588-1f5db9f3556e'::uuid),
      ('70f84234-4de2-471b-8a33-d818834095d5'::uuid),
      ('716ef3a6-5355-4e15-a8ca-6192175eacc6'::uuid),
      ('735a1089-f29d-44df-badf-b5993c7efaa8'::uuid),
      ('754b6bdc-4b87-4c55-8b3f-0b36f3606990'::uuid),
      ('7789de88-3bb0-47d6-bb5d-3504261230d9'::uuid),
      ('78b0b102-d466-4dad-a18d-d8188a96ab5a'::uuid),
      ('7adebb0d-72e4-4906-990e-f242391999bd'::uuid),
      ('7dd7f28f-7228-4097-8f25-7cbaa7bfd614'::uuid),
      ('7de38a1b-e1ef-4e81-8518-b5b799f26758'::uuid),
      ('7f61f150-1e39-493d-bed3-9f39960342a8'::uuid),
      ('822f114b-ec19-4c23-8d09-33e6a1bce703'::uuid),
      ('833193d6-b4b9-42ce-914e-47b8b9ea870e'::uuid),
      ('874902d5-57ac-4256-9b6a-f8ce356164a8'::uuid),
      ('897bab12-c398-405e-a749-a7bec3fe4692'::uuid),
      ('89bab711-c679-4b6e-9145-e7e7ba6d47a3'::uuid),
      ('8bcfe55d-7fb5-41cc-ac00-287c18647b0b'::uuid),
      ('91027c2c-69cf-4ceb-860f-e89e80e45397'::uuid),
      ('91a2093e-1eba-4ec6-badc-74de0a749e15'::uuid),
      ('92df86d6-4831-4410-b9ab-506308eeb25b'::uuid),
      ('93c0e099-29eb-4db4-abaa-7cb9d1a67dca'::uuid),
      ('949c8de8-73a9-4bde-b3a9-4d2205a947e2'::uuid),
      ('94a1ce73-8138-4a63-8a50-78651fbbf557'::uuid),
      ('97f5eea0-84a3-42aa-a433-94b3f2d41d87'::uuid),
      ('9ac42676-1628-428c-a707-d33344524079'::uuid),
      ('9e443f77-e115-4347-b0ff-21f33e55577c'::uuid),
      ('a031abde-3a7b-46d7-9758-eaaff0518e9f'::uuid),
      ('a549b8e3-ecc7-429b-9715-af6cc821f6ac'::uuid),
      ('a7df3180-7372-4c85-b701-2429e500edeb'::uuid),
      ('a9ad1cca-9d0f-432f-b311-61707d4124ec'::uuid),
      ('ad002e2b-fdb2-4ecf-b59b-680810c4f0b4'::uuid),
      ('aee81f04-b581-47aa-923d-cc2879a46b13'::uuid),
      ('afc95660-f347-4e21-b697-8b987fb4db1d'::uuid),
      ('aff3d648-9fc2-4801-8546-8b15ed14e2f0'::uuid),
      ('b05c509c-9b4d-43aa-ba19-aae8a9c0b10e'::uuid),
      ('b2e1e100-f9c6-4ca0-bd1a-1c1ff57c8460'::uuid),
      ('b498d6f0-ab22-4849-9c84-1a8c4267d245'::uuid),
      ('b50f6e4f-b33c-4b16-8450-d9cfe95427f8'::uuid),
      ('b6416d2e-f771-437d-b9f9-8007600c0681'::uuid),
      ('b9630340-4798-4904-8523-1c684ac6cb09'::uuid),
      ('bab4b62a-72e5-4578-a662-de0263f1e2a2'::uuid),
      ('bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b'::uuid),
      ('bd0fd163-2833-4e23-8bb4-6c9b84cde657'::uuid),
      ('c4280d06-7aa1-4382-a4ec-1231fc6939e3'::uuid),
      ('c674befd-40d5-4d27-bb1a-81c445423cad'::uuid),
      ('c7a07f61-4288-4596-8c09-05ea5d3e4a46'::uuid),
      ('c83d85bd-3f44-48dc-9ac8-042f4946eb11'::uuid),
      ('c9cf5edc-82db-49d6-80a9-2cfb13b82945'::uuid),
      ('c9d51017-0e7a-4347-89fe-3f377a46b748'::uuid),
      ('c9ffca28-5a4f-4f6f-8cd7-9cbe08b8b489'::uuid),
      ('cc79459f-33bf-4f9b-81bd-fadb0a8022f4'::uuid),
      ('cde0d025-dcd6-4fff-ae8a-dc3ddc3a10d9'::uuid),
      ('cf7ce51f-f03f-4631-a7c9-4669afc9f20f'::uuid),
      ('d0b5a03d-cf1e-42ae-bca7-99e67902cdc9'::uuid),
      ('d0f49958-63d3-495f-84b2-6343d52ee762'::uuid),
      ('d1e1d2aa-7f1f-433f-9a0f-3a460ad50063'::uuid),
      ('d225235d-5650-4376-8d4b-d16d946baf95'::uuid),
      ('d228dd53-81ce-4cea-98e1-893498c1a933'::uuid),
      ('d3e9f7cc-73ff-4148-913b-99c78817d409'::uuid),
      ('d463f0a3-2520-4d58-b9c4-3d334b3ab5e9'::uuid),
      ('d5a60c98-2e53-49ef-aafa-4516f37f157d'::uuid),
      ('d6d0e4fe-55d3-49b1-bf4c-a545889c9069'::uuid),
      ('d7687915-0750-4ea1-a57a-876a969173d8'::uuid),
      ('d8f8912d-915b-4814-982b-c5fcb2c5a014'::uuid),
      ('db4f7371-6647-4df0-b3d5-aaee0eae67db'::uuid),
      ('dc1cdc75-add7-41f9-9513-84793386de17'::uuid),
      ('dcedc561-9f46-4083-8b9a-4b81ccd8ede4'::uuid),
      ('dd20c7d4-0a92-46ad-9531-a4977cc7dea9'::uuid),
      ('dd31c3a5-ed03-4fe0-9c9b-f64f0a8d7da6'::uuid),
      ('ddd8b9cd-85ed-4c33-8865-8bc2a8ee7f49'::uuid),
      ('de1208e6-fcb6-4f15-a430-449fc9ca2da1'::uuid),
      ('de219490-ef35-4746-9132-5a5e1fef70d5'::uuid),
      ('dff1afbb-9684-4ba0-baf3-bdd00ef57fbd'::uuid),
      ('e0b82e7f-c02d-458a-907e-55898f99bd85'::uuid),
      ('e1f92e2e-66b6-4254-b6dc-34bdcee540f6'::uuid),
      ('e337d21e-fab6-4edf-a6ed-60bcd94b9768'::uuid),
      ('e57c8b9c-e790-4def-8091-c5dea8be8fea'::uuid),
      ('e85fae74-a640-4288-961f-116f82b1a067'::uuid),
      ('e91add97-243c-456c-8bee-5150c43a0ba8'::uuid),
      ('e98a6e40-5a39-4c74-a0e3-9069afcd8e23'::uuid),
      ('eaa9fcfc-1a79-4918-b20e-3441171a9bf3'::uuid),
      ('ecdbdf5e-94fa-41f3-a47c-a5378cb8e527'::uuid),
      ('f1064c56-9319-4b49-8e54-59c0cebde034'::uuid),
      ('f28dc3de-c7d9-4a4f-97ad-7969cc8dbad7'::uuid),
      ('f435af68-de4b-4574-8d46-a07294f7641c'::uuid),
      ('f7be7ce1-fb50-49c6-aa0c-0cfef0f232c5'::uuid),
      ('fcba198c-f35c-4c44-9af1-73a31971dff2'::uuid),
      ('fd951015-7d8c-411e-b8dc-009b3c9ee2ec'::uuid),
      ('fde1d318-c462-4c5a-88b8-95ffae4dab86'::uuid),
      ('ff527e9f-a178-45e7-9fcb-33877303ef21'::uuid)
    )
    SELECT 1
    FROM expected e
    LEFT JOIN public.items i ON i.id = e.item_id
    WHERE i.id IS NULL OR i.maps_lat IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'One or more Denver items are missing or already have maps_lat set -- stop and reconcile before backfilling';
  END IF;
END
$do$;

-- [A] 0058d8dc-fdf4-4ab2-88f5-b9b4b85c61c7 -- Order the shrimp-and-pork chili wontons with zha cai and chili oil at 'Pig and T
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('0058d8dc-fdf4-4ab2-88f5-b9b4b85c61c7'::uuid, NULL, NULL, $ga$Pig and Tiger, 2200 California St, Denver, CO 80205$ga$, 39.750810099999995, -104.9846608, $ga$ChIJr9FosCp5bIcRXRpl38vxsDQ$ga$, $ga$2200 California St, Denver, CO 80205, USA$ga$, $ga$Pig and Tiger, 2200 California St, Denver, CO 80205$ga$, 966, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.750810099999995, maps_lng = -104.9846608, google_place_id = $ga$ChIJr9FosCp5bIcRXRpl38vxsDQ$ga$, formatted_address = $ga$2200 California St, Denver, CO 80205, USA$ga$ WHERE id = '0058d8dc-fdf4-4ab2-88f5-b9b4b85c61c7'::uuid AND maps_lat IS NULL;

-- [A] 010907d9-e545-4439-bf35-0422f3e09758 -- Order the handmade shrimp-and-pork shu mai at 'Chinese Palace Dim Sum'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('010907d9-e545-4439-bf35-0422f3e09758'::uuid, NULL, NULL, $ga$Chinese Palace Dim Sum, 11970 Washington St, Northglenn, CO 80233$ga$, 39.9132435, -104.9766676, $ga$ChIJHaHjEwB1bIcRdyFhKkH9NNk$ga$, $ga$11970 Washington St, Northglenn, CO 80233, USA$ga$, $ga$Chinese Palace Dim Sum, 11970 Washington St, Northglenn, CO 80233$ga$, 5043, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.9132435, maps_lng = -104.9766676, google_place_id = $ga$ChIJHaHjEwB1bIcRdyFhKkH9NNk$ga$, formatted_address = $ga$11970 Washington St, Northglenn, CO 80233, USA$ga$ WHERE id = '010907d9-e545-4439-bf35-0422f3e09758'::uuid AND maps_lat IS NULL;

-- [A] 03f59ab1-32b9-4037-b083-fa1d5bafc526 -- Find a portal connecting all four worlds at 'Meow Wolf Denver Convergence Statio
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('03f59ab1-32b9-4037-b083-fa1d5bafc526'::uuid, NULL, NULL, $ga$Meow Wolf Denver — Convergence Station, Denver, CO$ga$, 39.7408092, -105.01565389999999, $ga$ChIJrY3Kkih5bIcRrc8NGVd5KQk$ga$, $ga$1338 1st St, Denver, CO 80204, USA$ga$, $ga$Meow Wolf Denver — Convergence Station, Denver, CO$ga$, 2065, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7408092, maps_lng = -105.01565389999999, google_place_id = $ga$ChIJrY3Kkih5bIcRrc8NGVd5KQk$ga$, formatted_address = $ga$1338 1st St, Denver, CO 80204, USA$ga$ WHERE id = '03f59ab1-32b9-4037-b083-fa1d5bafc526'::uuid AND maps_lat IS NULL;

-- [A] 04bf3f18-8e08-4f09-8671-17f6f3fd65b6 -- Spot the original light fixture in the foyer during a tour of 'Molly Brown House
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('04bf3f18-8e08-4f09-8671-17f6f3fd65b6'::uuid, NULL, NULL, $ga$Molly Brown House Museum, Denver, CO$ga$, 39.7374933, -104.9807338, $ga$ChIJd8jaltR-bIcRrftppzqiBeY$ga$, $ga$1340 Pennsylvania St, Denver, CO 80203, USA$ga$, $ga$Molly Brown House Museum, Denver, CO$ga$, 443, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7374933, maps_lng = -104.9807338, google_place_id = $ga$ChIJd8jaltR-bIcRrftppzqiBeY$ga$, formatted_address = $ga$1340 Pennsylvania St, Denver, CO 80203, USA$ga$ WHERE id = '04bf3f18-8e08-4f09-8671-17f6f3fd65b6'::uuid AND maps_lat IS NULL;

-- [A] 052a0a3b-44e2-423e-8318-b755cc2d2b0d -- Have a drink at the historic Brunswick back bar at '740 Front'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('052a0a3b-44e2-423e-8318-b755cc2d2b0d'::uuid, NULL, NULL, $ga$740 Front, 740 Front St, Louisville, CO 80027$ga$, 39.977672999999996, -105.130672, $ga$ChIJXUNzjl7za4cRP7uEcmfHYic$ga$, $ga$740 Front St, Louisville, CO 80027, USA$ga$, $ga$740 Front, 740 Front St, Louisville, CO 80027$ga$, 108, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.977672999999996, maps_lng = -105.130672, google_place_id = $ga$ChIJXUNzjl7za4cRP7uEcmfHYic$ga$, formatted_address = $ga$740 Front St, Louisville, CO 80027, USA$ga$ WHERE id = '052a0a3b-44e2-423e-8318-b755cc2d2b0d'::uuid AND maps_lat IS NULL;

-- [A] 05655893-cb5d-45f1-8210-b3bb652b884d -- Play a game of shuffleboard upstairs with a 'Rail Yard Ale' at 'Wynkoop Brewing 
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('05655893-cb5d-45f1-8210-b3bb652b884d'::uuid, NULL, NULL, $ga$Wynkoop Brewing Company, Denver, CO$ga$, 39.7534439, -104.9984977, $ga$ChIJBadAhB95bIcR1h_loSGkaR0$ga$, $ga$1634 18th St, Denver, CO 80202, USA$ga$, $ga$Wynkoop Brewing Company, Denver, CO$ga$, 221, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7534439, maps_lng = -104.9984977, google_place_id = $ga$ChIJBadAhB95bIcR1h_loSGkaR0$ga$, formatted_address = $ga$1634 18th St, Denver, CO 80202, USA$ga$ WHERE id = '05655893-cb5d-45f1-8210-b3bb652b884d'::uuid AND maps_lat IS NULL;

-- [A] 08893b11-d552-407a-a407-255625f949db -- Hear Olympic champion Connie Carpenter describe her gold-medal finish beside the
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('08893b11-d552-407a-a407-255625f949db'::uuid, NULL, NULL, $ga$Museum of Boulder, Boulder, CO$ga$, 40.0201169, -105.281167, $ga$ChIJldMlWzfsa4cRd6MQGGDygGE$ga$, $ga$2205 Broadway, Boulder, CO 80302, USA$ga$, $ga$Museum of Boulder, Boulder, CO$ga$, 562, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0201169, maps_lng = -105.281167, google_place_id = $ga$ChIJldMlWzfsa4cRd6MQGGDygGE$ga$, formatted_address = $ga$2205 Broadway, Boulder, CO 80302, USA$ga$ WHERE id = '08893b11-d552-407a-a407-255625f949db'::uuid AND maps_lat IS NULL;

-- [A] 0c483c15-f425-4750-885f-5461d81f387c -- Walk the open space loop at 'Carolyn Holmberg Preserve at Rock Creek Farm'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('0c483c15-f425-4750-885f-5461d81f387c'::uuid, NULL, NULL, $ga$Carolyn Holmberg Preserve at Rock Creek Farm, Broomfield, CO$ga$, 39.9467547, -105.1088063, $ga$ChIJNxECjmqLa4cRfM-qofLonS0$ga$, $ga$2240 S 104th St, Broomfield, CO 80020, USA$ga$, $ga$Carolyn Holmberg Preserve at Rock Creek Farm, Broomfield, CO$ga$, 3473, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.9467547, maps_lng = -105.1088063, google_place_id = $ga$ChIJNxECjmqLa4cRfM-qofLonS0$ga$, formatted_address = $ga$2240 S 104th St, Broomfield, CO 80020, USA$ga$ WHERE id = '0c483c15-f425-4750-885f-5461d81f387c'::uuid AND maps_lat IS NULL;

-- [A] 104bbb02-92a3-447a-968f-7cde6e0e137c -- Tear open a powdered-sugar beignet at 'Lucile's Creole Cafe'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('104bbb02-92a3-447a-968f-7cde6e0e137c'::uuid, NULL, NULL, $ga$Lucile's Creole Cafe, 2124 14th St, Boulder, CO 80302$ga$, 40.0200688, -105.27767349999999, $ga$ChIJDZzVdCjsa4cRmgi-Ktpp1Ys$ga$, $ga$2124 14th St, Boulder, CO 80302, USA$ga$, $ga$Lucile's Creole Cafe, 2124 14th St, Boulder, CO 80302$ga$, 278, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0200688, maps_lng = -105.27767349999999, google_place_id = $ga$ChIJDZzVdCjsa4cRmgi-Ktpp1Ys$ga$, formatted_address = $ga$2124 14th St, Boulder, CO 80302, USA$ga$ WHERE id = '104bbb02-92a3-447a-968f-7cde6e0e137c'::uuid AND maps_lat IS NULL;

-- [A] 12792398-76f2-4a51-aef1-551a284d0d9f -- Climb into the real tractor cab inside the big red barn at 'Agricultural Heritag
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('12792398-76f2-4a51-aef1-551a284d0d9f'::uuid, NULL, NULL, $ga$Agricultural Heritage Center, Longmont, CO$ga$, 40.2026545, -105.15915609999999, $ga$ChIJXQ11JnH8a4cRHp8xoJwGZYM$ga$, $ga$8348 Ute Hwy, Longmont, CO 80503, USA$ga$, $ga$Agricultural Heritage Center, Longmont, CO$ga$, 6259, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.2026545, maps_lng = -105.15915609999999, google_place_id = $ga$ChIJXQ11JnH8a4cRHp8xoJwGZYM$ga$, formatted_address = $ga$8348 Ute Hwy, Longmont, CO 80503, USA$ga$ WHERE id = '12792398-76f2-4a51-aef1-551a284d0d9f'::uuid AND maps_lat IS NULL;

-- [A] 13772396-c850-44b2-a008-465013e49efb -- End the current exhibition with a craft cocktail on the rooftop at 'Museum of Co
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('13772396-c850-44b2-a008-465013e49efb'::uuid, NULL, NULL, $ga$Museum of Contemporary Art Denver, Denver, CO$ga$, 39.752302199999995, -105.0042101, $ga$ChIJvcHQQcF4bIcRmDttJRd0FN4$ga$, $ga$1485 Delgany St, Denver, CO 80202, USA$ga$, $ga$Museum of Contemporary Art Denver, Denver, CO$ga$, 541, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.752302199999995, maps_lng = -105.0042101, google_place_id = $ga$ChIJvcHQQcF4bIcRmDttJRd0FN4$ga$, formatted_address = $ga$1485 Delgany St, Denver, CO 80202, USA$ga$ WHERE id = '13772396-c850-44b2-a008-465013e49efb'::uuid AND maps_lat IS NULL;

-- [A] 14683011-33a7-4bcb-9508-563548d2ff73 -- Walk beneath the lights at 'Larimer Square' after dark
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('14683011-33a7-4bcb-9508-563548d2ff73'::uuid, NULL, NULL, $ga$Larimer Square, Denver, CO$ga$, 39.7477084, -104.999113, $ga$ChIJNRm0bcV4bIcRi74dMWUc_V8$ga$, $ga$1430 Larimer St, Denver, CO 80202, USA$ga$, $ga$Larimer Square, Denver, CO$ga$, 432, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7477084, maps_lng = -104.999113, google_place_id = $ga$ChIJNRm0bcV4bIcRi74dMWUc_V8$ga$, formatted_address = $ga$1430 Larimer St, Denver, CO 80202, USA$ga$ WHERE id = '14683011-33a7-4bcb-9508-563548d2ff73'::uuid AND maps_lat IS NULL;

-- [A] 14e1bd19-fad5-44e7-8ec1-9a8088953af3 -- Have a drink overlooking the Great Hall from 'Cooper Lounge'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('14e1bd19-fad5-44e7-8ec1-9a8088953af3'::uuid, NULL, NULL, $ga$Cooper Lounge, Denver, CO$ga$, 39.7530837, -105.0000491, $ga$ChIJb7ZFC8N4bIcR5fZEKYgUcgI$ga$, $ga$1701 Wynkoop St, Denver, CO 80202, USA$ga$, $ga$Cooper Lounge, Denver, CO$ga$, 250, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7530837, maps_lng = -105.0000491, google_place_id = $ga$ChIJb7ZFC8N4bIcR5fZEKYgUcgI$ga$, formatted_address = $ga$1701 Wynkoop St, Denver, CO 80202, USA$ga$ WHERE id = '14e1bd19-fad5-44e7-8ec1-9a8088953af3'::uuid AND maps_lat IS NULL;

-- [A] 16f97705-df7b-44dc-8273-dd5a74f8b7de -- Order the bacon-wrapped hot dog with beans, onions, tomato, cheese and condiment
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('16f97705-df7b-44dc-8273-dd5a74f8b7de'::uuid, NULL, NULL, $ga$Marco's Hot Dogs & Tacos, 1647 Kimbark St, Longmont, CO 80501$ga$, 40.1883015, -105.1007946, $ga$ChIJW5yWET_5a4cR_Qd1VmGqKyw$ga$, $ga$1647 Kimbark St, Longmont, CO 80501, USA$ga$, $ga$Marco's Hot Dogs & Tacos, 1647 Kimbark St, Longmont, CO 80501$ga$, 2348, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1883015, maps_lng = -105.1007946, google_place_id = $ga$ChIJW5yWET_5a4cR_Qd1VmGqKyw$ga$, formatted_address = $ga$1647 Kimbark St, Longmont, CO 80501, USA$ga$ WHERE id = '16f97705-df7b-44dc-8273-dd5a74f8b7de'::uuid AND maps_lat IS NULL;

-- [B] 1915043e-a819-4bd4-8f70-b6d20404ff3e -- Order a scoop from the giant milk can at 'Little Man Ice Cream'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('1915043e-a819-4bd4-8f70-b6d20404ff3e'::uuid, NULL, NULL, $ga$Little Man Ice Cream, Denver, CO$ga$, 39.759464099999995, -105.01108239999999, $ga$ChIJ8wjJkZR4bIcRxIdpJKL5KwE$ga$, $ga$2620 16th St, Denver, CO 80211, USA$ga$, $ga$Little Man Ice Cream, Denver, CO$ga$, 418, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.759464099999995, maps_lng = -105.01108239999999, google_place_id = $ga$ChIJ8wjJkZR4bIcRxIdpJKL5KwE$ga$, formatted_address = $ga$2620 16th St, Denver, CO 80211, USA$ga$ WHERE id = '1915043e-a819-4bd4-8f70-b6d20404ff3e'::uuid AND maps_lat IS NULL;

-- [B] 1a1ea071-5b80-4b48-8081-24a55d2796c0 -- Have afternoon tea beneath the stained glass atrium at 'The Brown Palace Hotel a
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('1a1ea071-5b80-4b48-8081-24a55d2796c0'::uuid, NULL, NULL, $ga$Brown Palace Hotel, Denver, CO$ga$, 39.7439251, -104.98788049999999, $ga$ChIJ9dBRb9Z4bIcRD9UXGYyDqvY$ga$, $ga$321 17th St, Denver, CO 80202, USA$ga$, $ga$Brown Palace Hotel, Denver, CO$ga$, 394, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7439251, maps_lng = -104.98788049999999, google_place_id = $ga$ChIJ9dBRb9Z4bIcRD9UXGYyDqvY$ga$, formatted_address = $ga$321 17th St, Denver, CO 80202, USA$ga$ WHERE id = '1a1ea071-5b80-4b48-8081-24a55d2796c0'::uuid AND maps_lat IS NULL;

-- [A] 1a2689a8-2570-4c4a-b6cd-1a858e7fe25c -- Order the GABF medal-winning 'Dear You' French saison at 'Ratio Beerworks'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('1a2689a8-2570-4c4a-b6cd-1a858e7fe25c'::uuid, NULL, NULL, $ga$Ratio Beerworks, Denver, CO$ga$, 39.761507699999996, -104.9810761, $ga$ChIJgZ4HIR95bIcRVav2shAUzp8$ga$, $ga$2920 Larimer St, Denver, CO 80205, USA$ga$, $ga$Ratio Beerworks, Denver, CO$ga$, 392, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.761507699999996, maps_lng = -104.9810761, google_place_id = $ga$ChIJgZ4HIR95bIcRVav2shAUzp8$ga$, formatted_address = $ga$2920 Larimer St, Denver, CO 80205, USA$ga$ WHERE id = '1a2689a8-2570-4c4a-b6cd-1a858e7fe25c'::uuid AND maps_lat IS NULL;

-- [A] 1cb0161d-464c-4fee-bcb0-3e4e735ac4f0 -- Play one artist's audio story beside their large-scale work in the free Sculptur
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('1cb0161d-464c-4fee-bcb0-3e4e735ac4f0'::uuid, NULL, NULL, $ga$Arvada Center for the Arts and Humanities, Arvada, CO$ga$, 39.823499, -105.08352099999999, $ga$ChIJ7z8mMIqIa4cRimLUyAkQV6c$ga$, $ga$6901 Wadsworth Blvd, Arvada, CO 80003, USA$ga$, $ga$Arvada Center for the Arts and Humanities, Arvada, CO$ga$, 2330, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.823499, maps_lng = -105.08352099999999, google_place_id = $ga$ChIJ7z8mMIqIa4cRimLUyAkQV6c$ga$, formatted_address = $ga$6901 Wadsworth Blvd, Arvada, CO 80003, USA$ga$ WHERE id = '1cb0161d-464c-4fee-bcb0-3e4e735ac4f0'::uuid AND maps_lat IS NULL;

-- [A] 1d4b68b6-546d-4039-a4fd-f76df7230c1a -- Order a sushi burrito at 'Sushi Box'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('1d4b68b6-546d-4039-a4fd-f76df7230c1a'::uuid, NULL, NULL, $ga$Sushi Box, 1844 Hover St, Suite C, Longmont, CO 80501$ga$, 40.1917857, -105.1302355, $ga$ChIJkfyBsZn7a4cRo3CkBQIVRZU$ga$, $ga$1844 Hover St Ste c, Longmont, CO 80501, USA$ga$, $ga$Sushi Box, 1844 Hover St, Suite C, Longmont, CO 80501$ga$, 3641, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1917857, maps_lng = -105.1302355, google_place_id = $ga$ChIJkfyBsZn7a4cRo3CkBQIVRZU$ga$, formatted_address = $ga$1844 Hover St Ste c, Longmont, CO 80501, USA$ga$ WHERE id = '1d4b68b6-546d-4039-a4fd-f76df7230c1a'::uuid AND maps_lat IS NULL;

-- [A] 1fb94167-c521-43a8-ac26-8cf61b61b306 -- Sip the blue-raspberry 'Petra' cocktail with Pop Rocks at 'The Passenger'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('1fb94167-c521-43a8-ac26-8cf61b61b306'::uuid, NULL, NULL, $ga$The Passenger, Longmont, CO$ga$, 40.1641419, -105.10213619999999, $ga$ChIJ51nIt8D5a4cRsXLZlewN5Do$ga$, $ga$300 Main St, Longmont, CO 80501, USA$ga$, $ga$The Passenger, Longmont, CO$ga$, 341, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1641419, maps_lng = -105.10213619999999, google_place_id = $ga$ChIJ51nIt8D5a4cRsXLZlewN5Do$ga$, formatted_address = $ga$300 Main St, Longmont, CO 80501, USA$ga$ WHERE id = '1fb94167-c521-43a8-ac26-8cf61b61b306'::uuid AND maps_lat IS NULL;

-- [A] 218678c7-c7f7-40f5-8131-1dcec8ac028b -- Find the elaborate Art Deco murals inside while seeing a show at 'Boulder Theate
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('218678c7-c7f7-40f5-8131-1dcec8ac028b'::uuid, NULL, NULL, $ga$Boulder Theater, Boulder, CO$ga$, 40.0192048, -105.2774254, $ga$ChIJ00Gjeyjsa4cRvLYGmRIQ92o$ga$, $ga$2032 14th St, Boulder, CO 80302, USA$ga$, $ga$Boulder Theater, Boulder, CO$ga$, 230, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0192048, maps_lng = -105.2774254, google_place_id = $ga$ChIJ00Gjeyjsa4cRvLYGmRIQ92o$ga$, formatted_address = $ga$2032 14th St, Boulder, CO 80302, USA$ga$ WHERE id = '218678c7-c7f7-40f5-8131-1dcec8ac028b'::uuid AND maps_lat IS NULL;

-- [A] 22230bac-ab00-4e34-ae95-df977d37e800 -- Reach the summit of 'Mount Sanitas Trail'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('22230bac-ab00-4e34-ae95-df977d37e800'::uuid, NULL, NULL, $ga$Mount Sanitas Trail, Boulder, CO$ga$, 40.0211269, -105.2964368, $ga$EiVNb3VudCBTYW5pdGFzIFRyYWlsLCBCb3VsZGVyLCBDTywgVVNBIi4qLAoUChIJM2tn16bua4cRlqgzXc-iUUISFAoSCdOvjSdOjWuHEViAG6B8OznI$ga$, $ga$Mount Sanitas Trail, Boulder, CO, USA$ga$, $ga$Mount Sanitas Trail, Boulder, CO$ga$, 1863, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0211269, maps_lng = -105.2964368, google_place_id = $ga$EiVNb3VudCBTYW5pdGFzIFRyYWlsLCBCb3VsZGVyLCBDTywgVVNBIi4qLAoUChIJM2tn16bua4cRlqgzXc-iUUISFAoSCdOvjSdOjWuHEViAG6B8OznI$ga$, formatted_address = $ga$Mount Sanitas Trail, Boulder, CO, USA$ga$ WHERE id = '22230bac-ab00-4e34-ae95-df977d37e800'::uuid AND maps_lat IS NULL;

-- [A] 227d2f0f-fc9d-47c5-a1cd-821818092b33 -- Feed the animals during a Farmfest session at 'Sunflower Farm'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('227d2f0f-fc9d-47c5-a1cd-821818092b33'::uuid, NULL, NULL, $ga$Sunflower Farm, 11150 Prospect Rd, Longmont, CO 80504$ga$, 40.1325836, -105.09006409999999, $ga$ChIJbSi6YGn5a4cR518njAGPVaM$ga$, $ga$11150 Prospect Rd, Longmont, CO 80504, USA$ga$, $ga$Sunflower Farm, 11150 Prospect Rd, Longmont, CO 80504$ga$, 3980, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1325836, maps_lng = -105.09006409999999, google_place_id = $ga$ChIJbSi6YGn5a4cR518njAGPVaM$ga$, formatted_address = $ga$11150 Prospect Rd, Longmont, CO 80504, USA$ga$ WHERE id = '227d2f0f-fc9d-47c5-a1cd-821818092b33'::uuid AND maps_lat IS NULL;

-- [B] 276561ac-76be-4795-80eb-d9bec1672955 -- Build a gelato bar dipped in Belgian chocolate at 'HipPOPS'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('276561ac-76be-4795-80eb-d9bec1672955'::uuid, NULL, NULL, $ga$HipPOPS, 700 Ken Pratt Blvd, Suite 200, Longmont, CO 80501$ga$, 40.1535948, -105.1058066, $ga$ChIJVwrw__H5a4cRQKqHaq4XuyA$ga$, $ga$700 Ken Pratt Blvd # 200 - Pod 8, Longmont, CO 80504, USA$ga$, $ga$HipPOPS, 700 Ken Pratt Blvd, Suite 200, Longmont, CO 80501$ga$, 1549, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1535948, maps_lng = -105.1058066, google_place_id = $ga$ChIJVwrw__H5a4cRQKqHaq4XuyA$ga$, formatted_address = $ga$700 Ken Pratt Blvd # 200 - Pod 8, Longmont, CO 80504, USA$ga$ WHERE id = '276561ac-76be-4795-80eb-d9bec1672955'::uuid AND maps_lat IS NULL;

-- [A] 2957baa5-270d-453e-bf0f-54b7e94ddb41 -- Complete the loop around Smith and Grasmere lakes at 'Washington Park'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('2957baa5-270d-453e-bf0f-54b7e94ddb41'::uuid, NULL, NULL, $ga$Washington Park, Denver, CO$ga$, 39.7002435, -104.9687106, $ga$ChIJ7aqIGl9-bIcRwFaF5FB1uuQ$ga$, $ga$Washington Park, Denver, CO, USA$ga$, $ga$Washington Park, Denver, CO$ga$, 0, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7002435, maps_lng = -104.9687106, google_place_id = $ga$ChIJ7aqIGl9-bIcRwFaF5FB1uuQ$ga$, formatted_address = $ga$Washington Park, Denver, CO, USA$ga$ WHERE id = '2957baa5-270d-453e-bf0f-54b7e94ddb41'::uuid AND maps_lat IS NULL;

-- [B] 29b6827c-2e59-4b21-9a15-ecbb7188a556 -- Walk or bike a continuous two mile segment of 'St. Vrain Greenway'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('29b6827c-2e59-4b21-9a15-ecbb7188a556'::uuid, NULL, NULL, $ga$St. Vrain Greenway, Longmont, CO$ga$, 40.1544743, -105.0956336, $ga$ChIJRx7lHFT5a4cRGiyoLmFO6S0$ga$, $ga$180 Ken Pratt Blvd, Longmont, CO 80501, USA$ga$, $ga$St. Vrain Greenway, Longmont, CO$ga$, 1513, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1544743, maps_lng = -105.0956336, google_place_id = $ga$ChIJRx7lHFT5a4cRGiyoLmFO6S0$ga$, formatted_address = $ga$180 Ken Pratt Blvd, Longmont, CO 80501, USA$ga$ WHERE id = '29b6827c-2e59-4b21-9a15-ecbb7188a556'::uuid AND maps_lat IS NULL;

-- [A] 2a3523f7-31a1-4ad5-93db-e276bf1b0ed7 -- Pair Cerveza mí Face-ah with the Nashville smoked wings at 'Busey Brews'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('2a3523f7-31a1-4ad5-93db-e276bf1b0ed7'::uuid, NULL, NULL, $ga$Busey Brews, 70 E 1st St, Nederland, CO 80466$ga$, 39.9617717, -105.5093619, $ga$ChIJk4JPeT7Ha4cRiCyb6AXFPq4$ga$, $ga$70 E 1st St, Nederland, CO 80466, USA$ga$, $ga$Busey Brews, 70 E 1st St, Nederland, CO 80466$ga$, 133, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.9617717, maps_lng = -105.5093619, google_place_id = $ga$ChIJk4JPeT7Ha4cRiCyb6AXFPq4$ga$, formatted_address = $ga$70 E 1st St, Nederland, CO 80466, USA$ga$ WHERE id = '2a3523f7-31a1-4ad5-93db-e276bf1b0ed7'::uuid AND maps_lat IS NULL;

-- [A] 2cd5dab3-ac6b-4730-8d08-dfae0f0ad66f -- See a dome show at 'Fiske Planetarium'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('2cd5dab3-ac6b-4730-8d08-dfae0f0ad66f'::uuid, NULL, NULL, $ga$Fiske Planetarium, Boulder, CO$ga$, 40.0035992, -105.2634436, $ga$ChIJOzT2QTXsa4cRYKro75cPNtM$ga$, $ga$2414 Regent Dr, Boulder, CO 80309, USA$ga$, $ga$Fiske Planetarium, Boulder, CO$ga$, 1962, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0035992, maps_lng = -105.2634436, google_place_id = $ga$ChIJOzT2QTXsa4cRYKro75cPNtM$ga$, formatted_address = $ga$2414 Regent Dr, Boulder, CO 80309, USA$ga$ WHERE id = '2cd5dab3-ac6b-4730-8d08-dfae0f0ad66f'::uuid AND maps_lat IS NULL;

-- [A] 2e2c2fc5-f13a-44c3-ba83-888c392a0f17 -- Order the 303 Green Chile Relleno Burger at 'Cherry Cricket'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('2e2c2fc5-f13a-44c3-ba83-888c392a0f17'::uuid, NULL, NULL, $ga$Cherry Cricket, 2641 E 2nd Ave, Denver, CO 80206$ga$, 39.719586299999996, -104.9563501, $ga$ChIJIzsCgJZ-bIcRJ8wt6D2vSoQ$ga$, $ga$2641 E 2nd Ave, Denver, CO 80206, USA$ga$, $ga$Cherry Cricket, 2641 E 2nd Ave, Denver, CO 80206$ga$, 561, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.719586299999996, maps_lng = -104.9563501, google_place_id = $ga$ChIJIzsCgJZ-bIcRJ8wt6D2vSoQ$ga$, formatted_address = $ga$2641 E 2nd Ave, Denver, CO 80206, USA$ga$ WHERE id = '2e2c2fc5-f13a-44c3-ba83-888c392a0f17'::uuid AND maps_lat IS NULL;

-- [A] 36911e65-55e4-4e9c-a3e4-b1b04fb8c5cc -- Pair a live jazz set with the five-course 'Ellington Experience' beneath the Art
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('36911e65-55e4-4e9c-a3e4-b1b04fb8c5cc'::uuid, NULL, NULL, $ga$Nocturne, Denver, CO$ga$, 39.7595964, -104.9843854, $ga$ChIJb8q07h95bIcReD5YqVibPrk$ga$, $ga$between Larimer and Walnut on 27th, 1330 27th St, Denver, CO 80205, USA$ga$, $ga$Nocturne, Denver, CO$ga$, 41, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7595964, maps_lng = -104.9843854, google_place_id = $ga$ChIJb8q07h95bIcReD5YqVibPrk$ga$, formatted_address = $ga$between Larimer and Walnut on 27th, 1330 27th St, Denver, CO 80205, USA$ga$ WHERE id = '36911e65-55e4-4e9c-a3e4-b1b04fb8c5cc'::uuid AND maps_lat IS NULL;

-- [A] 36c87d34-8c14-4236-b7d9-da32d2e65b06 -- Pair a used book browse with a coffee at 'Trident Booksellers and Cafe'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('36c87d34-8c14-4236-b7d9-da32d2e65b06'::uuid, NULL, NULL, $ga$Trident Booksellers & Cafe, Boulder, CO$ga$, 40.0171546, -105.28299179999999, $ga$ChIJHSJLxCbsa4cRkw2E3vTDfzU$ga$, $ga$940 Pearl St, Boulder, CO 80302, USA$ga$, $ga$Trident Booksellers & Cafe, Boulder, CO$ga$, 731, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0171546, maps_lng = -105.28299179999999, google_place_id = $ga$ChIJHSJLxCbsa4cRkw2E3vTDfzU$ga$, formatted_address = $ga$940 Pearl St, Boulder, CO 80302, USA$ga$ WHERE id = '36c87d34-8c14-4236-b7d9-da32d2e65b06'::uuid AND maps_lat IS NULL;

-- [A] 3bc7e5ce-f628-4ce5-87aa-813130006ed9 -- Peel apart one of Izzio Bakery's caramelized 'Queen' kouign-amann pastries insid
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('3bc7e5ce-f628-4ce5-87aa-813130006ed9'::uuid, NULL, NULL, $ga$Denver Central Market, Denver, CO$ga$, 39.759360799999996, -104.9846129, $ga$ChIJJScW7h95bIcRje8-s9qYG4M$ga$, $ga$2669 Larimer St, Denver, CO 80205, USA$ga$, $ga$Denver Central Market, Denver, CO$ga$, 25, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.759360799999996, maps_lng = -104.9846129, google_place_id = $ga$ChIJJScW7h95bIcRje8-s9qYG4M$ga$, formatted_address = $ga$2669 Larimer St, Denver, CO 80205, USA$ga$ WHERE id = '3bc7e5ce-f628-4ce5-87aa-813130006ed9'::uuid AND maps_lat IS NULL;

-- [A] 3d2d8e9d-876c-49f4-90d1-d13b5f1621e9 -- Order the Black Garlic Ramen with pork chashu and black garlic oil at 'Neko Rame
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('3d2d8e9d-876c-49f4-90d1-d13b5f1621e9'::uuid, NULL, NULL, $ga$Neko Ramen & Rice, 4030 Colorado Blvd, Unit 103, Denver, CO 80216$ga$, 39.7735951, -104.9400635, $ga$ChIJI7lV00B5bIcR_6tSILh7Xbk$ga$, $ga$4030 Colorado Blvd #103, Denver, CO 80216, USA$ga$, $ga$Neko Ramen & Rice, 4030 Colorado Blvd, Unit 103, Denver, CO 80216$ga$, 4136, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7735951, maps_lng = -104.9400635, google_place_id = $ga$ChIJI7lV00B5bIcR_6tSILh7Xbk$ga$, formatted_address = $ga$4030 Colorado Blvd #103, Denver, CO 80216, USA$ga$ WHERE id = '3d2d8e9d-876c-49f4-90d1-d13b5f1621e9'::uuid AND maps_lat IS NULL;

-- [B] 3f269beb-e3f6-473e-9c36-ccdea5e3f599 -- Take a photo beneath the giant blue bear at 'Denver Performing Arts Complex'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('3f269beb-e3f6-473e-9c36-ccdea5e3f599'::uuid, NULL, NULL, $ga$Denver Performing Arts Complex, Denver, CO$ga$, 39.7445062, -104.99818739999999, $ga$ChIJS_vG1dF4bIcRHT1-cH_igaM$ga$, $ga$1400 Curtis Street, Denver, CO 80204, USA$ga$, $ga$Denver Performing Arts Complex, Denver, CO$ga$, 519, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7445062, maps_lng = -104.99818739999999, google_place_id = $ga$ChIJS_vG1dF4bIcRHT1-cH_igaM$ga$, formatted_address = $ga$1400 Curtis Street, Denver, CO 80204, USA$ga$ WHERE id = '3f269beb-e3f6-473e-9c36-ccdea5e3f599'::uuid AND maps_lat IS NULL;

-- [B] 3fc6c1ee-aba0-4f53-b5f0-9e4ac8ac91e3 -- Complete the brewery tour at 'Coors Brewery'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('3fc6c1ee-aba0-4f53-b5f0-9e4ac8ac91e3'::uuid, NULL, NULL, $ga$Coors Brewery, Golden, CO$ga$, 39.7555757, -105.216916, $ga$ChIJoUBdNi2Fa4cRxPJDBnnzpNg$ga$, $ga$502 14th St, Golden, CO 80401, USA$ga$, $ga$Coors Brewery, Golden, CO$ga$, 358, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7555757, maps_lng = -105.216916, google_place_id = $ga$ChIJoUBdNi2Fa4cRxPJDBnnzpNg$ga$, formatted_address = $ga$502 14th St, Golden, CO 80401, USA$ga$ WHERE id = '3fc6c1ee-aba0-4f53-b5f0-9e4ac8ac91e3'::uuid AND maps_lat IS NULL;

-- [A] 432d8675-53b1-4a43-9233-53708507831c -- Paddle or swim at 'Union Reservoir'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('432d8675-53b1-4a43-9233-53708507831c'::uuid, NULL, NULL, $ga$Union Reservoir, Longmont, CO$ga$, 40.180529799999995, -105.0411298, $ga$ChIJBf7fo4T4a4cRkfCG6a65Xek$ga$, $ga$Union Reservoir, Longmont, CO 80504, USA$ga$, $ga$Union Reservoir, Longmont, CO$ga$, 5374, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.180529799999995, maps_lng = -105.0411298, google_place_id = $ga$ChIJBf7fo4T4a4cRkfCG6a65Xek$ga$, formatted_address = $ga$Union Reservoir, Longmont, CO 80504, USA$ga$ WHERE id = '432d8675-53b1-4a43-9233-53708507831c'::uuid AND maps_lat IS NULL;

-- [A] 43aa56cf-5529-415d-aa0d-9e04f5431315 -- Order the arroz con pollo at 'Rosario's Peruvian Restaurant'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('43aa56cf-5529-415d-aa0d-9e04f5431315'::uuid, NULL, NULL, $ga$Rosario's Peruvian Restaurant, 625 Ken Pratt Blvd, Longmont, CO 80501$ga$, 40.15168980000001, -105.10401449999999, $ga$ChIJr8oMNZb5a4cRDUHOrcR-eWE$ga$, $ga$625 Ken Pratt Blvd, Longmont, CO 80501, USA$ga$, $ga$Rosario's Peruvian Restaurant, 625 Ken Pratt Blvd, Longmont, CO 80501$ga$, 1735, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.15168980000001, maps_lng = -105.10401449999999, google_place_id = $ga$ChIJr8oMNZb5a4cRDUHOrcR-eWE$ga$, formatted_address = $ga$625 Ken Pratt Blvd, Longmont, CO 80501, USA$ga$ WHERE id = '43aa56cf-5529-415d-aa0d-9e04f5431315'::uuid AND maps_lat IS NULL;

-- [A] 442ee691-41ef-4a16-aad6-bc757480e9e6 -- Watch the cliff divers and finish with sopapillas at 'Casa Bonita'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('442ee691-41ef-4a16-aad6-bc757480e9e6'::uuid, NULL, NULL, $ga$Casa Bonita, Lakewood, CO$ga$, 39.7417583, -105.0706972, $ga$ChIJE7tYRySHa4cRSauU_fDROfk$ga$, $ga$6715 W Colfax Ave, Lakewood, CO 80214, USA$ga$, $ga$Casa Bonita, Lakewood, CO$ga$, 4220, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7417583, maps_lng = -105.0706972, google_place_id = $ga$ChIJE7tYRySHa4cRSauU_fDROfk$ga$, formatted_address = $ga$6715 W Colfax Ave, Lakewood, CO 80214, USA$ga$ WHERE id = '442ee691-41ef-4a16-aad6-bc757480e9e6'::uuid AND maps_lat IS NULL;

-- [A] 46357f48-049a-4f90-b833-356ec0b2448b -- Meet under the Great Hall clock at 'Denver Union Station'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('46357f48-049a-4f90-b833-356ec0b2448b'::uuid, NULL, NULL, $ga$Denver Union Station, Denver, CO$ga$, 39.751497199999996, -104.9979721, $ga$ChIJux94CcN4bIcRcH7lFkSAUfo$ga$, $ga$Union Station, Denver, CO 80202, USA$ga$, $ga$Denver Union Station, Denver, CO$ga$, 0, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.751497199999996, maps_lng = -104.9979721, google_place_id = $ga$ChIJux94CcN4bIcRcH7lFkSAUfo$ga$, formatted_address = $ga$Union Station, Denver, CO 80202, USA$ga$ WHERE id = '46357f48-049a-4f90-b833-356ec0b2448b'::uuid AND maps_lat IS NULL;

-- [A] 4669e6ea-005e-48bd-a517-71b0e218be7e -- Find the moon rock at 'Mines Museum of Earth Science'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('4669e6ea-005e-48bd-a517-71b0e218be7e'::uuid, NULL, NULL, $ga$Mines Museum of Earth Science, Golden, CO$ga$, 39.7518642, -105.2247713, $ga$ChIJh0F0-dOaa4cRn8ErVNoPIpg$ga$, $ga$1310 Maple St, Golden, CO 80401, USA$ga$, $ga$Mines Museum of Earth Science, Golden, CO$ga$, 516, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7518642, maps_lng = -105.2247713, google_place_id = $ga$ChIJh0F0-dOaa4cRn8ErVNoPIpg$ga$, formatted_address = $ga$1310 Maple St, Golden, CO 80401, USA$ga$ WHERE id = '4669e6ea-005e-48bd-a517-71b0e218be7e'::uuid AND maps_lat IS NULL;

-- [A] 476cf174-504c-45c5-b520-233c28a5ac40 -- Launch yourself from the virtual Steamboat Springs ski jump at 'History Colorado
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('476cf174-504c-45c5-b520-233c28a5ac40'::uuid, NULL, NULL, $ga$History Colorado Center, Denver, CO$ga$, 39.7358374, -104.98713049999999, $ga$ChIJH5sxlCp_bIcR7IqinQjhWYk$ga$, $ga$1200 Broadway, Denver, CO 80203, USA$ga$, $ga$History Colorado Center, Denver, CO$ga$, 1127, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7358374, maps_lng = -104.98713049999999, google_place_id = $ga$ChIJH5sxlCp_bIcR7IqinQjhWYk$ga$, formatted_address = $ga$1200 Broadway, Denver, CO 80203, USA$ga$ WHERE id = '476cf174-504c-45c5-b520-233c28a5ac40'::uuid AND maps_lat IS NULL;

-- [A] 4a37a0e9-2d15-46e5-9e41-c3f16cedb850 -- Ride a hand carved animal on the restored 'Carousel of Happiness'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('4a37a0e9-2d15-46e5-9e41-c3f16cedb850'::uuid, NULL, NULL, $ga$Carousel of Happiness, Nederland, CO$ga$, 39.960113400000004, -105.51007179999999, $ga$ChIJlxxb18_Ga4cRAuI4M6EQv_E$ga$, $ga$20 Lakeview Dr, Nederland, CO 80466, USA$ga$, $ga$Carousel of Happiness, Nederland, CO$ga$, 155, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.960113400000004, maps_lng = -105.51007179999999, google_place_id = $ga$ChIJlxxb18_Ga4cRAuI4M6EQv_E$ga$, formatted_address = $ga$20 Lakeview Dr, Nederland, CO 80466, USA$ga$ WHERE id = '4a37a0e9-2d15-46e5-9e41-c3f16cedb850'::uuid AND maps_lat IS NULL;

-- [A] 53f78e06-6997-45a7-8103-92a26d5bc018 -- Let your dog play off leash while you order a local beer at 'Romero's K9 Club'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('53f78e06-6997-45a7-8103-92a26d5bc018'::uuid, NULL, NULL, $ga$Romero's K9 Club & Tap House, 985 S Public Rd, Lafayette, CO 80026$ga$, 39.989554999999996, -105.09099, $ga$ChIJb-yFHOb0a4cRep8yQMo9ThU$ga$, $ga$985 S Public Rd, Lafayette, CO 80026, USA$ga$, $ga$Romero's K9 Club & Tap House, 985 S Public Rd, Lafayette, CO 80026$ga$, 462, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.989554999999996, maps_lng = -105.09099, google_place_id = $ga$ChIJb-yFHOb0a4cRep8yQMo9ThU$ga$, formatted_address = $ga$985 S Public Rd, Lafayette, CO 80026, USA$ga$ WHERE id = '53f78e06-6997-45a7-8103-92a26d5bc018'::uuid AND maps_lat IS NULL;

-- [A] 58eb6e0b-80f0-4279-9893-59ab8e5453c4 -- Try a Nederland brewed beer at 'Knotted Root Brewing Company'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('58eb6e0b-80f0-4279-9893-59ab8e5453c4'::uuid, NULL, NULL, $ga$Knotted Root Brewing Company, Nederland, CO$ga$, 39.963603899999995, -105.5151977, $ga$ChIJFdRtgMbGa4cRHIueqMN-mV8$ga$, $ga$250 Caribou St, Nederland, CO 80466, USA$ga$, $ga$Knotted Root Brewing Company, Nederland, CO$ga$, 447, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.963603899999995, maps_lng = -105.5151977, google_place_id = $ga$ChIJFdRtgMbGa4cRHIueqMN-mV8$ga$, formatted_address = $ga$250 Caribou St, Nederland, CO 80466, USA$ga$ WHERE id = '58eb6e0b-80f0-4279-9893-59ab8e5453c4'::uuid AND maps_lat IS NULL;

-- [A] 591ab105-f33d-42c5-b474-e6610157bf27 -- Stand where Cherry Creek meets the South Platte at 'Confluence Park'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('591ab105-f33d-42c5-b474-e6610157bf27'::uuid, NULL, NULL, $ga$Confluence Park, Denver, CO$ga$, 39.754653999999995, -105.0073456, $ga$ChIJH_pMDcB4bIcRzYaLaau8pkI$ga$, $ga$2250 15th St, Denver, CO 80202, USA$ga$, $ga$Confluence Park, Denver, CO$ga$, 875, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.754653999999995, maps_lng = -105.0073456, google_place_id = $ga$ChIJH_pMDcB4bIcRzYaLaau8pkI$ga$, formatted_address = $ga$2250 15th St, Denver, CO 80202, USA$ga$ WHERE id = '591ab105-f33d-42c5-b474-e6610157bf27'::uuid AND maps_lat IS NULL;

-- [B] 597247fb-f09f-4f80-a2b6-5170643a9d81 -- Walk around Ferril Lake for the skyline view at 'City Park'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('597247fb-f09f-4f80-a2b6-5170643a9d81'::uuid, NULL, NULL, $ga$City Park — Ferril Lake, Denver, CO$ga$, 39.746068300000005, -104.9487418, $ga$ChIJ0YIUXFJ5bIcR_YOcScVQf_Q$ga$, $ga$Ferril Lake, Denver, CO 80205, USA$ga$, $ga$City Park — Ferril Lake, Denver, CO$ga$, 3182, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.746068300000005, maps_lng = -104.9487418, google_place_id = $ga$ChIJ0YIUXFJ5bIcR_YOcScVQf_Q$ga$, formatted_address = $ga$Ferril Lake, Denver, CO 80205, USA$ga$ WHERE id = '597247fb-f09f-4f80-a2b6-5170643a9d81'::uuid AND maps_lat IS NULL;

-- [A] 5eb9abca-a4d2-455d-8644-28782f3ca3c1 -- See the current exhibition at 'Boulder Museum of Contemporary Art'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('5eb9abca-a4d2-455d-8644-28782f3ca3c1'::uuid, NULL, NULL, $ga$Boulder Museum of Contemporary Art, Boulder, CO$ga$, 40.015163799999996, -105.27736979999999, $ga$ChIJXWa3XS_sa4cRSoyyFGj5frc$ga$, $ga$1750 13th St, Boulder, CO 80302, USA$ga$, $ga$Boulder Museum of Contemporary Art, Boulder, CO$ga$, 479, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.015163799999996, maps_lng = -105.27736979999999, google_place_id = $ga$ChIJXWa3XS_sa4cRSoyyFGj5frc$ga$, formatted_address = $ga$1750 13th St, Boulder, CO 80302, USA$ga$ WHERE id = '5eb9abca-a4d2-455d-8644-28782f3ca3c1'::uuid AND maps_lat IS NULL;

-- [B] 5ecda3c3-e40a-4698-83f5-e25fdfc96cdb -- Travel a continuous two mile segment of 'Boulder Creek Path'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('5ecda3c3-e40a-4698-83f5-e25fdfc96cdb'::uuid, NULL, NULL, $ga$Boulder Creek Path, Boulder, CO$ga$, 40.0142327, -105.2775463, $ga$EiRCb3VsZGVyIENyZWVrIFBhdGgsIEJvdWxkZXIsIENPLCBVU0EiLiosChQKEgl_zhl1IuxrhxGBGoly85_mpxIUChIJ06-NJ06Na4cRWIAboHw7Ocg$ga$, $ga$Boulder Creek Path, Boulder, CO, USA$ga$, $ga$Boulder Creek Path, Boulder, CO$ga$, 579, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0142327, maps_lng = -105.2775463, google_place_id = $ga$EiRCb3VsZGVyIENyZWVrIFBhdGgsIEJvdWxkZXIsIENPLCBVU0EiLiosChQKEgl_zhl1IuxrhxGBGoly85_mpxIUChIJ06-NJ06Na4cRWIAboHw7Ocg$ga$, formatted_address = $ga$Boulder Creek Path, Boulder, CO, USA$ga$ WHERE id = '5ecda3c3-e40a-4698-83f5-e25fdfc96cdb'::uuid AND maps_lat IS NULL;

-- [A] 5f9a1622-2267-47a6-b19e-387c7a636df5 -- Order the Brian—fried chicken, over-medium egg, cheese and honey—at 'Biscuit Mik
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('5f9a1622-2267-47a6-b19e-387c7a636df5'::uuid, NULL, NULL, $ga$Biscuit Mike's, 900 Coffman St, Suite B, Longmont, CO 80501$ga$, 40.1742576, -105.1033641, $ga$ChIJDflGaQD5a4cRM0hgxW14h28$ga$, $ga$900 Coffman St B, Longmont, CO 80501, USA$ga$, $ga$Biscuit Mike's, 900 Coffman St, Suite B, Longmont, CO 80501$ga$, 793, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1742576, maps_lng = -105.1033641, google_place_id = $ga$ChIJDflGaQD5a4cRM0hgxW14h28$ga$, formatted_address = $ga$900 Coffman St B, Longmont, CO 80501, USA$ga$ WHERE id = '5f9a1622-2267-47a6-b19e-387c7a636df5'::uuid AND maps_lat IS NULL;

-- [A] 60285c1f-87b1-4f6c-8ed4-ac89e467baf4 -- Order one piece of nigiri selected by the chef at 'Sushi Den'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('60285c1f-87b1-4f6c-8ed4-ac89e467baf4'::uuid, NULL, NULL, $ga$Sushi Den, Denver, CO$ga$, 39.689578, -104.9808419, $ga$ChIJL2TJFlJ-bIcRENgfRp3uELQ$ga$, $ga$1487 S Pearl St, Denver, CO 80210, USA$ga$, $ga$Sushi Den, Denver, CO$ga$, 1576, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.689578, maps_lng = -104.9808419, google_place_id = $ga$ChIJL2TJFlJ-bIcRENgfRp3uELQ$ga$, formatted_address = $ga$1487 S Pearl St, Denver, CO 80210, USA$ga$ WHERE id = '60285c1f-87b1-4f6c-8ed4-ac89e467baf4'::uuid AND maps_lat IS NULL;

-- [A] 60834533-2059-4404-8c5c-b804c31d96c2 -- Watch candy canes or lollipops being made on the free tour at 'Hammond's Candies
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('60834533-2059-4404-8c5c-b804c31d96c2'::uuid, NULL, NULL, $ga$Hammond's Candies, 5735 Washington St, Denver, CO 80216$ga$, 39.7996341, -104.9801645, $ga$ChIJWTAH3cl5bIcRwc6-H-2epYo$ga$, $ga$5735 Washington St, Denver, CO 80216, USA$ga$, $ga$Hammond's Candies, 5735 Washington St, Denver, CO 80216$ga$, 4481, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7996341, maps_lng = -104.9801645, google_place_id = $ga$ChIJWTAH3cl5bIcRwc6-H-2epYo$ga$, formatted_address = $ga$5735 Washington St, Denver, CO 80216, USA$ga$ WHERE id = '60834533-2059-4404-8c5c-b804c31d96c2'::uuid AND maps_lat IS NULL;

-- [B] 61750c16-18b7-4f12-b2fd-0807bc8465d6 -- See the dinosaur fossil discovered 763 feet beneath the parking lot at 'Denver M
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('61750c16-18b7-4f12-b2fd-0807bc8465d6'::uuid, NULL, NULL, $ga$Denver Museum of Nature & Science, Denver, CO$ga$, 39.7475261, -104.9428078, $ga$ChIJI3SnU1F5bIcREWJ08vMIP80$ga$, $ga$2001 Colorado Blvd, Denver, CO 80205, USA$ga$, $ga$Denver Museum of Nature & Science, Denver, CO$ga$, 3710, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7475261, maps_lng = -104.9428078, google_place_id = $ga$ChIJI3SnU1F5bIcREWJ08vMIP80$ga$, formatted_address = $ga$2001 Colorado Blvd, Denver, CO 80205, USA$ga$ WHERE id = '61750c16-18b7-4f12-b2fd-0807bc8465d6'::uuid AND maps_lat IS NULL;

-- [A] 63bfd734-9dc2-4211-9030-11eee9101d7d -- Follow the outdoor Weather Trail behind I.M. Pei's 'NCAR Mesa Laboratory'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('63bfd734-9dc2-4211-9030-11eee9101d7d'::uuid, NULL, NULL, $ga$NCAR Mesa Laboratory, Boulder, CO$ga$, 39.9783179, -105.2750307, $ga$ChIJcZxNHFXsa4cR2oo880PDcGE$ga$, $ga$1850 Table Mesa Dr, Boulder, CO 80305, USA$ga$, $ga$NCAR Mesa Laboratory, Boulder, CO$ga$, 4521, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.9783179, maps_lng = -105.2750307, google_place_id = $ga$ChIJcZxNHFXsa4cR2oo880PDcGE$ga$, formatted_address = $ga$1850 Table Mesa Dr, Boulder, CO 80305, USA$ga$ WHERE id = '63bfd734-9dc2-4211-9030-11eee9101d7d'::uuid AND maps_lat IS NULL;

-- [A] 6607f6bb-d9f3-4baa-8951-511c1cf995ea -- Finish 'The Reaper' Nashville hot chicken and earn the survivor sticker at '300 
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('6607f6bb-d9f3-4baa-8951-511c1cf995ea'::uuid, NULL, NULL, $ga$300 Suns Brewing, Longmont, CO$ga$, 40.1599201, -105.10127419999999, $ga$ChIJzTJtH6L5a4cRxe_WXDORfxc$ga$, $ga$335 1st Ave Unit C, Longmont, CO 80501, USA$ga$, $ga$300 Suns Brewing, Longmont, CO$ga$, 812, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1599201, maps_lng = -105.10127419999999, google_place_id = $ga$ChIJzTJtH6L5a4cRxe_WXDORfxc$ga$, formatted_address = $ga$335 1st Ave Unit C, Longmont, CO 80501, USA$ga$ WHERE id = '6607f6bb-d9f3-4baa-8951-511c1cf995ea'::uuid AND maps_lat IS NULL;

-- [A] 67ac51f2-072f-4e79-ac0f-35ddb447ad6b -- Order the ribeye bulgogi burger at 'Big Sky Burger'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('67ac51f2-072f-4e79-ac0f-35ddb447ad6b'::uuid, NULL, NULL, $ga$Big Sky Burger, 1958 S Garrison St, Lakewood, CO 80227$ga$, 39.681474, -105.09982339999999, $ga$ChIJHxmc-NWBa4cRkOqbOuNt30I$ga$, $ga$1958 S Garrison St, Lakewood, CO 80227, USA$ga$, $ga$Big Sky Burger, 1958 S Garrison St, Lakewood, CO 80227$ga$, 3028, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.681474, maps_lng = -105.09982339999999, google_place_id = $ga$ChIJHxmc-NWBa4cRkOqbOuNt30I$ga$, formatted_address = $ga$1958 S Garrison St, Lakewood, CO 80227, USA$ga$ WHERE id = '67ac51f2-072f-4e79-ac0f-35ddb447ad6b'::uuid AND maps_lat IS NULL;

-- [A] 694b9858-dbcf-4e32-aba9-ed2a2bbc9316 -- Play a retro arcade game and one round of skee ball or pinball at 'Quarters Bar 
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('694b9858-dbcf-4e32-aba9-ed2a2bbc9316'::uuid, NULL, NULL, $ga$Quarters Bar + Arcade, Longmont, CO$ga$, 40.1672124, -105.10274469999999, $ga$ChIJUZaPZm75a4cRCNJKDvZQQ_U$ga$, $ga$475 Main St, Longmont, CO 80501, USA$ga$, $ga$Quarters Bar + Arcade, Longmont, CO$ga$, 69, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1672124, maps_lng = -105.10274469999999, google_place_id = $ga$ChIJUZaPZm75a4cRCNJKDvZQQ_U$ga$, formatted_address = $ga$475 Main St, Longmont, CO 80501, USA$ga$ WHERE id = '694b9858-dbcf-4e32-aba9-ed2a2bbc9316'::uuid AND maps_lat IS NULL;

-- [A] 70024913-9352-4e78-9588-1f5db9f3556e -- Complete the infrared-sauna, cold-shower and hops-and-barley bath circuit at 'Oa
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('70024913-9352-4e78-9588-1f5db9f3556e'::uuid, NULL, NULL, $ga$Oakwell Beer Spa, 3004 N Downing St, Denver, CO 80205$ga$, 39.759684899999996, -104.9731216, $ga$ChIJYSIHF1J5bIcRe948PUN1mp8$ga$, $ga$3004 N Downing St, Denver, CO 80205, USA$ga$, $ga$Oakwell Beer Spa, 3004 N Downing St, Denver, CO 80205$ga$, 1002, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.759684899999996, maps_lng = -104.9731216, google_place_id = $ga$ChIJYSIHF1J5bIcRe948PUN1mp8$ga$, formatted_address = $ga$3004 N Downing St, Denver, CO 80205, USA$ga$ WHERE id = '70024913-9352-4e78-9588-1f5db9f3556e'::uuid AND maps_lat IS NULL;

-- [A] 70f84234-4de2-471b-8a33-d818834095d5 -- Reach the stone arch on 'Royal Arch Trail'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('70f84234-4de2-471b-8a33-d818834095d5'::uuid, NULL, NULL, $ga$Royal Arch Trail, Boulder, CO$ga$, 39.9859549, -105.2905087, $ga$EihSb3lhbCBBcmNoIFRyYWlsLCBCb3VsZGVyLCBDTyA4MDMwMiwgVVNBIi4qLAoUChIJbz0TXWfsa4cRRA37L5amQvMSFAoSCdOvjSdOjWuHEViAG6B8OznI$ga$, $ga$Royal Arch Trail, Boulder, CO 80302, USA$ga$, $ga$Royal Arch Trail, Boulder, CO$ga$, 3909, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.9859549, maps_lng = -105.2905087, google_place_id = $ga$EihSb3lhbCBBcmNoIFRyYWlsLCBCb3VsZGVyLCBDTyA4MDMwMiwgVVNBIi4qLAoUChIJbz0TXWfsa4cRRA37L5amQvMSFAoSCdOvjSdOjWuHEViAG6B8OznI$ga$, formatted_address = $ga$Royal Arch Trail, Boulder, CO 80302, USA$ga$ WHERE id = '70f84234-4de2-471b-8a33-d818834095d5'::uuid AND maps_lat IS NULL;

-- [B] 716ef3a6-5355-4e15-a8ca-6192175eacc6 -- Look up at the leather straps Vance Kirkland used to suspend himself over painti
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('716ef3a6-5355-4e15-a8ca-6192175eacc6'::uuid, NULL, NULL, $ga$Kirkland Museum of Fine & Decorative Art, Denver, CO$ga$, 39.7355683, -104.9905479, $ga$ChIJXwSNg9R-bIcRltbMQ0joT70$ga$, $ga$1201 Bannock St, Denver, CO 80204, USA$ga$, $ga$Kirkland Museum of Fine & Decorative Art, Denver, CO$ga$, 1080, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7355683, maps_lng = -104.9905479, google_place_id = $ga$ChIJXwSNg9R-bIcRltbMQ0joT70$ga$, formatted_address = $ga$1201 Bannock St, Denver, CO 80204, USA$ga$ WHERE id = '716ef3a6-5355-4e15-a8ca-6192175eacc6'::uuid AND maps_lat IS NULL;

-- [A] 735a1089-f29d-44df-badf-b5993c7efaa8 -- Order the JCB jalapeño cream cheese burger at 'My Brother's Bar'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('735a1089-f29d-44df-badf-b5993c7efaa8'::uuid, NULL, NULL, $ga$My Brother's Bar, Denver, CO$ga$, 39.7562205, -105.0093141, $ga$ChIJh1Z5TpV4bIcRABuUrCOahzo$ga$, $ga$2376 15th St, Denver, CO 80202, USA$ga$, $ga$My Brother's Bar, Denver, CO$ga$, 794, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7562205, maps_lng = -105.0093141, google_place_id = $ga$ChIJh1Z5TpV4bIcRABuUrCOahzo$ga$, formatted_address = $ga$2376 15th St, Denver, CO 80202, USA$ga$ WHERE id = '735a1089-f29d-44df-badf-b5993c7efaa8'::uuid AND maps_lat IS NULL;

-- [A] 754b6bdc-4b87-4c55-8b3f-0b36f3606990 -- Drink a 'Dale's Pale Ale' at its source inside 'Tasty Weasel Taproom'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('754b6bdc-4b87-4c55-8b3f-0b36f3606990'::uuid, NULL, NULL, $ga$Oskar Blues Brewery — Tasty Weasel Taproom, Longmont, CO$ga$, 40.1389134, -105.1219723, $ga$ChIJDymWUvT5a4cRtUtTs__8Pog$ga$, $ga$1640 S Sunset St, Longmont, CO 80501, USA$ga$, $ga$Oskar Blues Brewery — Tasty Weasel Taproom, Longmont, CO$ga$, 3578, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1389134, maps_lng = -105.1219723, google_place_id = $ga$ChIJDymWUvT5a4cRtUtTs__8Pog$ga$, formatted_address = $ga$1640 S Sunset St, Longmont, CO 80501, USA$ga$ WHERE id = '754b6bdc-4b87-4c55-8b3f-0b36f3606990'::uuid AND maps_lat IS NULL;

-- [B] 7789de88-3bb0-47d6-bb5d-3504261230d9 -- Choose and photograph your favorite mural along Larimer Street in RiNo
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('7789de88-3bb0-47d6-bb5d-3504261230d9'::uuid, NULL, NULL, $ga$Larimer Street murals, Denver, CO$ga$, 39.7547893, -104.9871289, $ga$ChIJWY-wRY15bIcRErj48ummPJ4$ga$, $ga$2314 N Broadway, Denver, CO 80205, USA$ga$, $ga$Larimer Street murals, Denver, CO$ga$, 558, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7547893, maps_lng = -104.9871289, google_place_id = $ga$ChIJWY-wRY15bIcRErj48ummPJ4$ga$, formatted_address = $ga$2314 N Broadway, Denver, CO 80205, USA$ga$ WHERE id = '7789de88-3bb0-47d6-bb5d-3504261230d9'::uuid AND maps_lat IS NULL;

-- [A] 78b0b102-d466-4dad-a18d-d8188a96ab5a -- Eat the world famous mini donuts inside the train car cafe at 'Train Cars Coffee
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('78b0b102-d466-4dad-a18d-d8188a96ab5a'::uuid, NULL, NULL, $ga$Train Cars Coffee and Kava, Nederland, CO$ga$, 39.9603955, -105.5101174, $ga$ChIJq-8738_Ga4cRDK1iEcak84E$ga$, $ga$101 CO-119, Nederland, CO 80466, USA$ga$, $ga$Train Cars Coffee and Kava, Nederland, CO$ga$, 125, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.9603955, maps_lng = -105.5101174, google_place_id = $ga$ChIJq-8738_Ga4cRDK1iEcak84E$ga$, formatted_address = $ga$101 CO-119, Nederland, CO 80466, USA$ga$ WHERE id = '78b0b102-d466-4dad-a18d-d8188a96ab5a'::uuid AND maps_lat IS NULL;

-- [A] 7adebb0d-72e4-4906-990e-f242391999bd -- Hike to the first unobstructed Flatirons viewpoint from 'Chautauqua Park'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('7adebb0d-72e4-4906-990e-f242391999bd'::uuid, NULL, NULL, $ga$Chautauqua Park, Boulder, CO$ga$, 39.999200599999995, -105.2814963, $ga$ChIJwd_EEkfsa4cRqy6eShKXFXY$ga$, $ga$900 Baseline Rd &, 9th St, Boulder, CO 80302, USA$ga$, $ga$Chautauqua Park, Boulder, CO$ga$, 2273, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.999200599999995, maps_lng = -105.2814963, google_place_id = $ga$ChIJwd_EEkfsa4cRqy6eShKXFXY$ga$, formatted_address = $ga$900 Baseline Rd &, 9th St, Boulder, CO 80302, USA$ga$ WHERE id = '7adebb0d-72e4-4906-990e-f242391999bd'::uuid AND maps_lat IS NULL;

-- [A] 7dd7f28f-7228-4097-8f25-7cbaa7bfd614 -- See a show in the century-old room where Harry Houdini once performed at 'Ogden 
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('7dd7f28f-7228-4097-8f25-7cbaa7bfd614'::uuid, NULL, NULL, $ga$Colfax Avenue — Ogden Theatre, Denver, CO$ga$, 39.7401704, -104.9752697, $ga$ChIJc1frSS15bIcRvEDDqHoi9qc$ga$, $ga$935 E Colfax Ave, Denver, CO 80218, USA$ga$, $ga$Colfax Avenue — Ogden Theatre, Denver, CO$ga$, 938, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7401704, maps_lng = -104.9752697, google_place_id = $ga$ChIJc1frSS15bIcRvEDDqHoi9qc$ga$, formatted_address = $ga$935 E Colfax Ave, Denver, CO 80218, USA$ga$ WHERE id = '7dd7f28f-7228-4097-8f25-7cbaa7bfd614'::uuid AND maps_lat IS NULL;

-- [A] 7de38a1b-e1ef-4e81-8518-b5b799f26758 -- Walk through a tropical rainforest surrounded by butterflies at 'Butterfly Pavil
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('7de38a1b-e1ef-4e81-8518-b5b799f26758'::uuid, NULL, NULL, $ga$Butterfly Pavilion, Westminster, CO$ga$, 39.8873108, -105.0666409, $ga$ChIJ34zTb4iJa4cRbmupTPTiK5E$ga$, $ga$6252 W 104th Ave, Westminster, CO 80020, USA$ga$, $ga$Butterfly Pavilion, Westminster, CO$ga$, 6168, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.8873108, maps_lng = -105.0666409, google_place_id = $ga$ChIJ34zTb4iJa4cRbmupTPTiK5E$ga$, formatted_address = $ga$6252 W 104th Ave, Westminster, CO 80020, USA$ga$ WHERE id = '7de38a1b-e1ef-4e81-8518-b5b799f26758'::uuid AND maps_lat IS NULL;

-- [A] 7f61f150-1e39-493d-bed3-9f39960342a8 -- Catch a Front Range sunset at 'Lost Gulch Overlook'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('7f61f150-1e39-493d-bed3-9f39960342a8'::uuid, NULL, NULL, $ga$Flagstaff Mountain — Lost Gulch Overlook, Boulder, CO$ga$, 39.9911541, -105.3192943, $ga$ChIJheQPBozra4cRPyEAWUX2s88$ga$, $ga$Boulder, CO 80302, USA$ga$, $ga$Flagstaff Mountain — Lost Gulch Overlook, Boulder, CO$ga$, 4896, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.9911541, maps_lng = -105.3192943, google_place_id = $ga$ChIJheQPBozra4cRPyEAWUX2s88$ga$, formatted_address = $ga$Boulder, CO 80302, USA$ga$ WHERE id = '7f61f150-1e39-493d-bed3-9f39960342a8'::uuid AND maps_lat IS NULL;

-- [B] 822f114b-ec19-4c23-8d09-33e6a1bce703 -- Make music with the interactive dairy-churn sculpture in 'Dairy Block Alley'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('822f114b-ec19-4c23-8d09-33e6a1bce703'::uuid, NULL, NULL, $ga$Dairy Block Alley, Denver, CO$ga$, 39.753285999999996, -104.996804, $ga$ChIJ7wsutdx4bIcRFZzkdlvSkAY$ga$, $ga$1800 Wazee St, Denver, CO 80202, USA$ga$, $ga$Dairy Block Alley, Denver, CO$ga$, 223, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.753285999999996, maps_lng = -104.996804, google_place_id = $ga$ChIJ7wsutdx4bIcRFZzkdlvSkAY$ga$, formatted_address = $ga$1800 Wazee St, Denver, CO 80202, USA$ga$ WHERE id = '822f114b-ec19-4c23-8d09-33e6a1bce703'::uuid AND maps_lat IS NULL;

-- [A] 833193d6-b4b9-42ce-914e-47b8b9ea870e -- Order momos in the cultural-center courtyard at 'Sherpa House'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('833193d6-b4b9-42ce-914e-47b8b9ea870e'::uuid, NULL, NULL, $ga$Sherpa House, 1518 Washington Ave, Golden, CO 80401$ga$, 39.752269399999996, -105.2188278, $ga$ChIJFzIZWyuFa4cR-yD7X2TRrOE$ga$, $ga$1518 Washington Ave, Golden, CO 80401, USA$ga$, $ga$Sherpa House, 1518 Washington Ave, Golden, CO 80401$ga$, 413, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.752269399999996, maps_lng = -105.2188278, google_place_id = $ga$ChIJFzIZWyuFa4cR-yD7X2TRrOE$ga$, formatted_address = $ga$1518 Washington Ave, Golden, CO 80401, USA$ga$ WHERE id = '833193d6-b4b9-42ce-914e-47b8b9ea870e'::uuid AND maps_lat IS NULL;

-- [A] 874902d5-57ac-4256-9b6a-f8ce356164a8 -- Complete the sauna, cold-plunge, warm-soak and steam circuit at 'ROK SPAS'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('874902d5-57ac-4256-9b6a-f8ce356164a8'::uuid, NULL, NULL, $ga$ROK SPAS, 2025 17th St, Denver, CO 80202$ga$, 39.75529470000001, -105.00242229999999, $ga$ChIJAfeU6d55bIcRhkQtys2CG24$ga$, $ga$2025 17th St, Denver, CO 80202, USA$ga$, $ga$ROK SPAS, 2025 17th St, Denver, CO 80202$ga$, 568, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.75529470000001, maps_lng = -105.00242229999999, google_place_id = $ga$ChIJAfeU6d55bIcRhkQtys2CG24$ga$, formatted_address = $ga$2025 17th St, Denver, CO 80202, USA$ga$ WHERE id = '874902d5-57ac-4256-9b6a-f8ce356164a8'::uuid AND maps_lat IS NULL;

-- [A] 897bab12-c398-405e-a749-a7bec3fe4692 -- Step inside the 1948 Valentine diner and the 1920s country school on a tour of '
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('897bab12-c398-405e-a749-a7bec3fe4692'::uuid, NULL, NULL, $ga$Heritage Lakewood Belmar Park, Lakewood, CO$ga$, 39.703217699999996, -105.0837357, $ga$ChIJvVq4FR-Ba4cRfsDgknRPQfY$ga$, $ga$801 S Yarrow St, Lakewood, CO 80226, USA$ga$, $ga$Heritage Lakewood Belmar Park, Lakewood, CO$ga$, 261, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.703217699999996, maps_lng = -105.0837357, google_place_id = $ga$ChIJvVq4FR-Ba4cRfsDgknRPQfY$ga$, formatted_address = $ga$801 S Yarrow St, Lakewood, CO 80226, USA$ga$ WHERE id = '897bab12-c398-405e-a749-a7bec3fe4692'::uuid AND maps_lat IS NULL;

-- [A] 89bab711-c679-4b6e-9145-e7e7ba6d47a3 -- Step into the walk-in Cheese Room and ask for a wedge you have never tasted at '
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('89bab711-c679-4b6e-9145-e7e7ba6d47a3'::uuid, NULL, NULL, $ga$Cheese Importers, Longmont, CO$ga$, 40.1605615, -105.1029186, $ga$ChIJYUmqTpn5a4cRhn6DA2Xki8M$ga$, $ga$103 Main St, Longmont, CO 80501, USA$ga$, $ga$Cheese Importers, Longmont, CO$ga$, 744, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1605615, maps_lng = -105.1029186, google_place_id = $ga$ChIJYUmqTpn5a4cRhn6DA2Xki8M$ga$, formatted_address = $ga$103 Main St, Longmont, CO 80501, USA$ga$ WHERE id = '89bab711-c679-4b6e-9145-e7e7ba6d47a3'::uuid AND maps_lat IS NULL;

-- [A] 8bcfe55d-7fb5-41cc-ac00-287c18647b0b -- Compare four house whiskeys in the whiskey flight at 'Abbott and Wallace Distill
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('8bcfe55d-7fb5-41cc-ac00-287c18647b0b'::uuid, NULL, NULL, $ga$Abbott & Wallace Distilling, Longmont, CO$ga$, 40.1655686, -105.1046392, $ga$ChIJOSE8cHX5a4cRyaeQ7Ge2uy8$ga$, $ga$350 Terry St Suite #120, Longmont, CO 80501, USA$ga$, $ga$Abbott & Wallace Distilling, Longmont, CO$ga$, 294, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1655686, maps_lng = -105.1046392, google_place_id = $ga$ChIJOSE8cHX5a4cRyaeQ7Ge2uy8$ga$, formatted_address = $ga$350 Terry St Suite #120, Longmont, CO 80501, USA$ga$ WHERE id = '8bcfe55d-7fb5-41cc-ac00-287c18647b0b'::uuid AND maps_lat IS NULL;

-- [A] 91027c2c-69cf-4ceb-860f-e89e80e45397 -- Build a dry-to-sweet flight from the 36 rotating Colorado cider taps at 'St. Vra
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('91027c2c-69cf-4ceb-860f-e89e80e45397'::uuid, NULL, NULL, $ga$St. Vrain Cidery, Longmont, CO$ga$, 40.1651691, -105.1046569, $ga$ChIJRyE8cHX5a4cRC9jono0DC-8$ga$, $ga$in alleyway, 350 Terry St #130, Longmont, CO 80501, USA$ga$, $ga$St. Vrain Cidery, Longmont, CO$ga$, 324, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1651691, maps_lng = -105.1046569, google_place_id = $ga$ChIJRyE8cHX5a4cRC9jono0DC-8$ga$, formatted_address = $ga$in alleyway, 350 Terry St #130, Longmont, CO 80501, USA$ga$ WHERE id = '91027c2c-69cf-4ceb-860f-e89e80e45397'::uuid AND maps_lat IS NULL;

-- [B] 91a2093e-1eba-4ec6-badc-74de0a749e15 -- Watch the nitrogen cascade settle in a 'Milk Stout Nitro' at 'Left Hand Brewing 
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('91a2093e-1eba-4ec6-badc-74de0a749e15'::uuid, NULL, NULL, $ga$Left Hand Brewing Company, Longmont, CO$ga$, 40.1582861, -105.11502329999999, $ga$ChIJ2cylXYP5a4cR97u-1MG0f3U$ga$, $ga$1265 Boston Ave, Longmont, CO 80501, USA$ga$, $ga$Left Hand Brewing Company, Longmont, CO$ga$, 1491, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1582861, maps_lng = -105.11502329999999, google_place_id = $ga$ChIJ2cylXYP5a4cR97u-1MG0f3U$ga$, formatted_address = $ga$1265 Boston Ave, Longmont, CO 80501, USA$ga$ WHERE id = '91a2093e-1eba-4ec6-badc-74de0a749e15'::uuid AND maps_lat IS NULL;

-- [A] 92df86d6-4831-4410-b9ab-506308eeb25b -- Find the single purple row exactly 5,280 feet above sea level inside 'Coors Fiel
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('92df86d6-4831-4410-b9ab-506308eeb25b'::uuid, NULL, NULL, $ga$Coors Field, Denver, CO$ga$, 39.7561077, -104.9941676, $ga$ChIJVV75VNx4bIcR3tkU4SjDHBc$ga$, $ga$2001 Blake St, Denver, CO 80205, USA$ga$, $ga$Coors Field, Denver, CO$ga$, 607, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7561077, maps_lng = -104.9941676, google_place_id = $ga$ChIJVV75VNx4bIcR3tkU4SjDHBc$ga$, formatted_address = $ga$2001 Blake St, Denver, CO 80205, USA$ga$ WHERE id = '92df86d6-4831-4410-b9ab-506308eeb25b'::uuid AND maps_lat IS NULL;

-- [A] 93c0e099-29eb-4db4-abaa-7cb9d1a67dca -- Find the restored El Milagro mural at 'RiNo ArtPark'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('93c0e099-29eb-4db4-abaa-7cb9d1a67dca'::uuid, NULL, NULL, $ga$RiNo ArtPark, Denver, CO$ga$, 39.7706508, -104.98115159999999, $ga$ChIJpaBiAbR5bIcRSuZUkJYrnvg$ga$, $ga$1900 35th St, Denver, CO 80216, USA$ga$, $ga$RiNo ArtPark, Denver, CO$ga$, 1280, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7706508, maps_lng = -104.98115159999999, google_place_id = $ga$ChIJpaBiAbR5bIcRSuZUkJYrnvg$ga$, formatted_address = $ga$1900 35th St, Denver, CO 80216, USA$ga$ WHERE id = '93c0e099-29eb-4db4-abaa-7cb9d1a67dca'::uuid AND maps_lat IS NULL;

-- [A] 949c8de8-73a9-4bde-b3a9-4d2205a947e2 -- Build a three-pour whiskey flight inside the 1882 schoolhouse at 'School House'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('949c8de8-73a9-4bde-b3a9-4d2205a947e2'::uuid, NULL, NULL, $ga$School House Kitchen and Libations, 5660 Olde Wadsworth Blvd, Arvada, CO 80002$ga$, 39.7999878, -105.0812619, $ga$ChIJO-QcTDgacEAR4fWS-jb6BZc$ga$, $ga$5660 Olde Wadsworth Blvd, Arvada, CO 80002, USA$ga$, $ga$School House Kitchen and Libations, 5660 Olde Wadsworth Blvd, Arvada, CO 80002$ga$, 615, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7999878, maps_lng = -105.0812619, google_place_id = $ga$ChIJO-QcTDgacEAR4fWS-jb6BZc$ga$, formatted_address = $ga$5660 Olde Wadsworth Blvd, Arvada, CO 80002, USA$ga$ WHERE id = '949c8de8-73a9-4bde-b3a9-4d2205a947e2'::uuid AND maps_lat IS NULL;

-- [A] 94a1ce73-8138-4a63-8a50-78651fbbf557 -- Try on a snap front western shirt at the original 'Rockmount Ranch Wear' store
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('94a1ce73-8138-4a63-8a50-78651fbbf557'::uuid, NULL, NULL, $ga$Rockmount Ranch Wear, Denver, CO$ga$, 39.7515448, -104.9993803, $ga$ChIJPToancR4bIcRYM95Bwx_bgw$ga$, $ga$1626 Wazee St, Denver, CO 80202, USA$ga$, $ga$Rockmount Ranch Wear, Denver, CO$ga$, 936, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7515448, maps_lng = -104.9993803, google_place_id = $ga$ChIJPToancR4bIcRYM95Bwx_bgw$ga$, formatted_address = $ga$1626 Wazee St, Denver, CO 80202, USA$ga$ WHERE id = '94a1ce73-8138-4a63-8a50-78651fbbf557'::uuid AND maps_lat IS NULL;

-- [A] 97f5eea0-84a3-42aa-a433-94b3f2d41d87 -- Watch a concert from the tiered bowl built around the movable stage at 'The Miss
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('97f5eea0-84a3-42aa-a433-94b3f2d41d87'::uuid, NULL, NULL, $ga$The Mission Ballroom, Denver, CO$ga$, 39.776204, -104.969168, $ga$ChIJNzlf3X95bIcRFeU_G_4p1rc$ga$, $ga$4242 Wynkoop St, Denver, CO 80216, USA$ga$, $ga$The Mission Ballroom, Denver, CO$ga$, 2291, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.776204, maps_lng = -104.969168, google_place_id = $ga$ChIJNzlf3X95bIcRFeU_G_4p1rc$ga$, formatted_address = $ga$4242 Wynkoop St, Denver, CO 80216, USA$ga$ WHERE id = '97f5eea0-84a3-42aa-a433-94b3f2d41d87'::uuid AND maps_lat IS NULL;

-- [B] 9ac42676-1628-428c-a707-d33344524079 -- Stand on the official mile high marker on the west steps of 'Colorado State Capi
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('9ac42676-1628-428c-a707-d33344524079'::uuid, NULL, NULL, $ga$Colorado State Capitol, Denver, CO$ga$, 39.739325099999995, -104.9848069, $ga$ChIJGclBlCp5bIcRjwqRDQIXohI$ga$, $ga$200 E Colfax Ave, Denver, CO 80203, USA$ga$, $ga$Colorado State Capitol, Denver, CO$ga$, 908, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.739325099999995, maps_lng = -104.9848069, google_place_id = $ga$ChIJGclBlCp5bIcRjwqRDQIXohI$ga$, formatted_address = $ga$200 E Colfax Ave, Denver, CO 80203, USA$ga$ WHERE id = '9ac42676-1628-428c-a707-d33344524079'::uuid AND maps_lat IS NULL;

-- [A] 9e443f77-e115-4347-b0ff-21f33e55577c -- Find the piece of fallen Twin Towers steel embedded in a bronze figure at 'Broom
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('9e443f77-e115-4347-b0ff-21f33e55577c'::uuid, NULL, NULL, $ga$Broomfield 9/11 Memorial, Broomfield, CO$ga$, 39.9188067, -105.066975, $ga$ChIJJ5B9VEWKa4cRsZ5bW40IDy4$ga$, $ga$Broomfield, CO 80020, USA$ga$, $ga$Broomfield 9/11 Memorial, Broomfield, CO$ga$, 1689, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.9188067, maps_lng = -105.066975, google_place_id = $ga$ChIJJ5B9VEWKa4cRsZ5bW40IDy4$ga$, formatted_address = $ga$Broomfield, CO 80020, USA$ga$ WHERE id = '9e443f77-e115-4347-b0ff-21f33e55577c'::uuid AND maps_lat IS NULL;

-- [A] a031abde-3a7b-46d7-9758-eaaff0518e9f -- Play a Japanese arcade game and order a themed drink at 'Akihabara Arcade and Ba
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('a031abde-3a7b-46d7-9758-eaaff0518e9f'::uuid, NULL, NULL, $ga$Akihabara Arcade and Bar, 8901 N Harlan St, Westminster, CO 80031$ga$, 39.858169200000006, -105.0652146, $ga$ChIJeZiserCJa4cRUvldgMdEb3M$ga$, $ga$8901 N Harlan St, Westminster, CO 80031, USA$ga$, $ga$Akihabara Arcade and Bar, 8901 N Harlan St, Westminster, CO 80031$ga$, 3383, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.858169200000006, maps_lng = -105.0652146, google_place_id = $ga$ChIJeZiserCJa4cRUvldgMdEb3M$ga$, formatted_address = $ga$8901 N Harlan St, Westminster, CO 80031, USA$ga$ WHERE id = 'a031abde-3a7b-46d7-9758-eaaff0518e9f'::uuid AND maps_lat IS NULL;

-- [A] a549b8e3-ecc7-429b-9715-af6cc821f6ac -- Start with the Busaba Chicken Puff at 'Busaba Thai'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('a549b8e3-ecc7-429b-9715-af6cc821f6ac'::uuid, NULL, NULL, $ga$Busaba Thai, 4800 Baseline Rd, A-110, Boulder, CO 80303$ga$, 39.997832599999995, -105.2333, $ga$ChIJk0F2qZLta4cRlkTQ8X6hF-g$ga$, $ga$4800 Baseline Rd A-110, Boulder, CO 80303, USA$ga$, $ga$Busaba Thai, 4800 Baseline Rd, A-110, Boulder, CO 80303$ga$, 4241, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.997832599999995, maps_lng = -105.2333, google_place_id = $ga$ChIJk0F2qZLta4cRlkTQ8X6hF-g$ga$, formatted_address = $ga$4800 Baseline Rd A-110, Boulder, CO 80303, USA$ga$ WHERE id = 'a549b8e3-ecc7-429b-9715-af6cc821f6ac'::uuid AND maps_lat IS NULL;

-- [E] a7df3180-7372-4c85-b701-2429e500edeb -- Find a local gallery or street art piece along the 'Tennyson Street Cultural Dis
-- Manual requery: original maps_query matched a wrong, unrelated district; replaced with a confirmed real anchor on Tennyson Street itself.
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('a7df3180-7372-4c85-b701-2429e500edeb'::uuid, NULL, NULL, $ga$Future Drawn oneLINE Gallery, 4420 Tennyson St, Denver, CO$ga$, 39.777092, -105.0438165, $ga$ChIJ5x9jJiyHa4cRUO8nMX0PUpc$ga$, $ga$4420 Tennyson St, Denver, CO 80212, USA$ga$, $ga$Future Drawn oneLINE Gallery, 4420 Tennyson St, Denver, CO$ga$, 393, $ga$E$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.777092, maps_lng = -105.0438165, google_place_id = $ga$ChIJ5x9jJiyHa4cRUO8nMX0PUpc$ga$, formatted_address = $ga$4420 Tennyson St, Denver, CO 80212, USA$ga$ WHERE id = 'a7df3180-7372-4c85-b701-2429e500edeb'::uuid AND maps_lat IS NULL;

-- [A] a9ad1cca-9d0f-432f-b311-61707d4124ec -- Walk beside Clear Creek from Golden's welcome arch to 'Golden History Park'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('a9ad1cca-9d0f-432f-b311-61707d4124ec'::uuid, NULL, NULL, $ga$Clear Creek Trail, Golden, CO$ga$, 39.7614367, -105.2202072, $ga$EiJDbGVhciBDcmVlayBUcmFpbCwgR29sZGVuLCBDTywgVVNBIi4qLAoUChIJb72D8aaFa4cRwziRd-TnLLQSFAoSCfdsaIcSmGuHEdxVgCBURsYU$ga$, $ga$Clear Creek Trail, Golden, CO, USA$ga$, $ga$Clear Creek Trail, Golden, CO$ga$, 660, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7614367, maps_lng = -105.2202072, google_place_id = $ga$EiJDbGVhciBDcmVlayBUcmFpbCwgR29sZGVuLCBDTywgVVNBIi4qLAoUChIJb72D8aaFa4cRwziRd-TnLLQSFAoSCfdsaIcSmGuHEdxVgCBURsYU$ga$, formatted_address = $ga$Clear Creek Trail, Golden, CO, USA$ga$ WHERE id = 'a9ad1cca-9d0f-432f-b311-61707d4124ec'::uuid AND maps_lat IS NULL;

-- [A] ad002e2b-fdb2-4ecf-b59b-680810c4f0b4 -- Order an Indian taco with bison at 'Tocabe'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('ad002e2b-fdb2-4ecf-b59b-680810c4f0b4'::uuid, NULL, NULL, $ga$Tocabe, 3536 W 44th Ave, Denver, CO 80211$ga$, 39.776552599999995, -105.0342438, $ga$ChIJzWzqxYCHa4cRz-McKMrXmz0$ga$, $ga$3536 W 44th Ave, Denver, CO 80211, USA$ga$, $ga$Tocabe, 3536 W 44th Ave, Denver, CO 80211$ga$, 428, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.776552599999995, maps_lng = -105.0342438, google_place_id = $ga$ChIJzWzqxYCHa4cRz-McKMrXmz0$ga$, formatted_address = $ga$3536 W 44th Ave, Denver, CO 80211, USA$ga$ WHERE id = 'ad002e2b-fdb2-4ecf-b59b-680810c4f0b4'::uuid AND maps_lat IS NULL;

-- [A] aee81f04-b581-47aa-923d-cc2879a46b13 -- Complete the Mount Carbon loop at 'Bear Creek Lake Park'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('aee81f04-b581-47aa-923d-cc2879a46b13'::uuid, NULL, NULL, $ga$Bear Creek Lake Park, Lakewood, CO$ga$, 39.6519513, -105.14343869999999, $ga$ChIJldssyxSCa4cRJCykqZ5Frsk$ga$, $ga$Bear Creek Lake Park, Lakewood, CO, USA$ga$, $ga$Bear Creek Lake Park, Lakewood, CO$ga$, 7914, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.6519513, maps_lng = -105.14343869999999, google_place_id = $ga$ChIJldssyxSCa4cRJCykqZ5Frsk$ga$, formatted_address = $ga$Bear Creek Lake Park, Lakewood, CO, USA$ga$ WHERE id = 'aee81f04-b581-47aa-923d-cc2879a46b13'::uuid AND maps_lat IS NULL;

-- [A] afc95660-f347-4e21-b697-8b987fb4db1d -- Find the six-foot replica of historic downtown inside 'Louisville Historical Mus
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('afc95660-f347-4e21-b697-8b987fb4db1d'::uuid, NULL, NULL, $ga$Louisville Historical Museum, Louisville, CO$ga$, 39.979801900000005, -105.13232789999999, $ga$ChIJM7ls5F3za4cR7Z90h68QIDY$ga$, $ga$1001 Main St, Louisville, CO 80027, USA$ga$, $ga$Louisville Historical Museum, Louisville, CO$ga$, 229, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.979801900000005, maps_lng = -105.13232789999999, google_place_id = $ga$ChIJM7ls5F3za4cR7Z90h68QIDY$ga$, formatted_address = $ga$1001 Main St, Louisville, CO 80027, USA$ga$ WHERE id = 'afc95660-f347-4e21-b697-8b987fb4db1d'::uuid AND maps_lat IS NULL;

-- [A] aff3d648-9fc2-4801-8546-8b15ed14e2f0 -- Taste American single pot still whiskey at 'Talnua Distillery'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('aff3d648-9fc2-4801-8546-8b15ed14e2f0'::uuid, NULL, NULL, $ga$Talnua Distillery, Arvada, CO$ga$, 39.8005828, -105.0552124, $ga$ChIJH-J8-eeHa4cRqlq83IweBDc$ga$, $ga$5405 W 56th Ave Unit C, Arvada, CO 80002, USA$ga$, $ga$Talnua Distillery, Arvada, CO$ga$, 2768, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.8005828, maps_lng = -105.0552124, google_place_id = $ga$ChIJH-J8-eeHa4cRqlq83IweBDc$ga$, formatted_address = $ga$5405 W 56th Ave Unit C, Arvada, CO 80002, USA$ga$ WHERE id = 'aff3d648-9fc2-4801-8546-8b15ed14e2f0'::uuid AND maps_lat IS NULL;

-- [C] b05c509c-9b4d-43aa-ba19-aae8a9c0b10e -- Make your own cheese during a hands on class at 'The Art of Cheese'
-- Manual override: script's default candidate was wrong (11,288m from Longmont center); using the correct second candidate instead.
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('b05c509c-9b4d-43aa-ba19-aae8a9c0b10e'::uuid, NULL, NULL, $ga$The Art of Cheese, Longmont, CO$ga$, 40.1652771, -105.1047913, $ga$ChIJ5erhAZL5a4cRuR9Re1UzzBc$ga$, $ga$350 Terry St, Longmont, CO 80501, USA$ga$, $ga$The Art of Cheese, Longmont, CO$ga$, 324, $ga$C$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1652771, maps_lng = -105.1047913, google_place_id = $ga$ChIJ5erhAZL5a4cRuR9Re1UzzBc$ga$, formatted_address = $ga$350 Terry St, Longmont, CO 80501, USA$ga$ WHERE id = 'b05c509c-9b4d-43aa-ba19-aae8a9c0b10e'::uuid AND maps_lat IS NULL;

-- [A] b2e1e100-f9c6-4ca0-bd1a-1c1ff57c8460 -- Find the cheekily hidden signature on the bottom of the nearly 11-foot 'Mud Woma
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('b2e1e100-f9c6-4ca0-bd1a-1c1ff57c8460'::uuid, NULL, NULL, $ga$Denver Art Museum, Denver, CO$ga$, 39.7371878, -104.9893451, $ga$ChIJFaqhMyt_bIcRMfeTGF4E8kM$ga$, $ga$100 W 14th Ave Pkwy, Denver, CO 80204, USA$ga$, $ga$Denver Art Museum, Denver, CO$ga$, 923, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7371878, maps_lng = -104.9893451, google_place_id = $ga$ChIJFaqhMyt_bIcRMfeTGF4E8kM$ga$, formatted_address = $ga$100 W 14th Ave Pkwy, Denver, CO 80204, USA$ga$ WHERE id = 'b2e1e100-f9c6-4ca0-bd1a-1c1ff57c8460'::uuid AND maps_lat IS NULL;

-- [A] b498d6f0-ab22-4849-9c84-1a8c4267d245 -- Try a Lafayette brewed beer at 'Liquid Mechanics Brewing Company'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('b498d6f0-ab22-4849-9c84-1a8c4267d245'::uuid, NULL, NULL, $ga$Liquid Mechanics Brewing Company, Lafayette, CO$ga$, 39.999719899999995, -105.10351589999999, $ga$ChIJaVkaXIv0a4cRY0wrDeNceBg$ga$, $ga$297 US-287 #100, Lafayette, CO 80026, USA$ga$, $ga$Liquid Mechanics Brewing Company, Lafayette, CO$ga$, 1359, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.999719899999995, maps_lng = -105.10351589999999, google_place_id = $ga$ChIJaVkaXIv0a4cRY0wrDeNceBg$ga$, formatted_address = $ga$297 US-287 #100, Lafayette, CO 80026, USA$ga$ WHERE id = 'b498d6f0-ab22-4849-9c84-1a8c4267d245'::uuid AND maps_lat IS NULL;

-- [B] b50f6e4f-b33c-4b16-8450-d9cfe95427f8 -- See a free exhibition inside Golden's restored Astor House at 'Foothills Art Cen
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('b50f6e4f-b33c-4b16-8450-d9cfe95427f8'::uuid, NULL, NULL, $ga$Foothills Art Center, Golden, CO$ga$, 39.7550721, -105.2224148, $ga$ChIJgwgkViuFa4cRvZrQfMTPgEg$ga$, $ga$1133 Arapahoe St, Golden, CO 80401, USA$ga$, $ga$Foothills Art Center, Golden, CO$ga$, 124, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7550721, maps_lng = -105.2224148, google_place_id = $ga$ChIJgwgkViuFa4cRvZrQfMTPgEg$ga$, formatted_address = $ga$1133 Arapahoe St, Golden, CO 80401, USA$ga$ WHERE id = 'b50f6e4f-b33c-4b16-8450-d9cfe95427f8'::uuid AND maps_lat IS NULL;

-- [A] b6416d2e-f771-437d-b9f9-8007600c0681 -- Complete the lake loop at 'Waneka Lake Park'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('b6416d2e-f771-437d-b9f9-8007600c0681'::uuid, NULL, NULL, $ga$Waneka Lake Park, Lafayette, CO$ga$, 39.993170299999996, -105.11328519999999, $ga$ChIJr_Ow6o_0a4cRHgk6VwYCvs8$ga$, $ga$1600 Caria Dr, Lafayette, CO 80026, USA$ga$, $ga$Waneka Lake Park, Lafayette, CO$ga$, 2009, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.993170299999996, maps_lng = -105.11328519999999, google_place_id = $ga$ChIJr_Ow6o_0a4cRHgk6VwYCvs8$ga$, formatted_address = $ga$1600 Caria Dr, Lafayette, CO 80026, USA$ga$ WHERE id = 'b6416d2e-f771-437d-b9f9-8007600c0681'::uuid AND maps_lat IS NULL;

-- [A] b9630340-4798-4904-8523-1c684ac6cb09 -- Choose a cocktail from the 52-card menu at 'Run for the Roses'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('b9630340-4798-4904-8523-1c684ac6cb09'::uuid, NULL, NULL, $ga$Run for the Roses, 1801 Blake St, Suite 10, Denver, CO 80202$ga$, 39.7527696, -104.99679379999999, $ga$ChIJ6RRXRBl5bIcRSbvRcjh9yok$ga$, $ga$1801 Blake St #10, Denver, CO 80202, USA$ga$, $ga$Run for the Roses, 1801 Blake St, Suite 10, Denver, CO 80202$ga$, 174, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7527696, maps_lng = -104.99679379999999, google_place_id = $ga$ChIJ6RRXRBl5bIcRSbvRcjh9yok$ga$, formatted_address = $ga$1801 Blake St #10, Denver, CO 80202, USA$ga$ WHERE id = 'b9630340-4798-4904-8523-1c684ac6cb09'::uuid AND maps_lat IS NULL;

-- [A] bab4b62a-72e5-4578-a662-de0263f1e2a2 -- Pull yourself toward the ceiling in a pulley chair at 'WOW! Children's Museum'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('bab4b62a-72e5-4578-a662-de0263f1e2a2'::uuid, NULL, NULL, $ga$WOW! Children's Museum, Lafayette, CO$ga$, 39.998932, -105.0890433, $ga$ChIJiZZnXvr0a4cRlisPALtFBJM$ga$, $ga$110 N Harrison Ave, Lafayette, CO 80026, USA$ga$, $ga$WOW! Children's Museum, Lafayette, CO$ga$, 596, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.998932, maps_lng = -105.0890433, google_place_id = $ga$ChIJiZZnXvr0a4cRlisPALtFBJM$ga$, formatted_address = $ga$110 N Harrison Ave, Lafayette, CO 80026, USA$ga$ WHERE id = 'bab4b62a-72e5-4578-a662-de0263f1e2a2'::uuid AND maps_lat IS NULL;

-- [A] bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b -- Taste the smoky spirit distilled from native prickly pear cactus at 'Dry Land Di
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b'::uuid, NULL, NULL, $ga$Dry Land Distillers, Longmont, CO$ga$, 40.1681946, -105.1028127, $ga$ChIJ4dBgKXX5a4cRL3Gv-5Y2cXE$ga$, $ga$519 Main St, Longmont, CO 80501, USA$ga$, $ga$Dry Land Distillers, Longmont, CO$ga$, 133, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1681946, maps_lng = -105.1028127, google_place_id = $ga$ChIJ4dBgKXX5a4cRL3Gv-5Y2cXE$ga$, formatted_address = $ga$519 Main St, Longmont, CO 80501, USA$ga$ WHERE id = 'bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b'::uuid AND maps_lat IS NULL;

-- [A] bd0fd163-2833-4e23-8bb4-6c9b84cde657 -- Order the Chupacabra breakfast burrito at 'Bonfire Burritos'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('bd0fd163-2833-4e23-8bb4-6c9b84cde657'::uuid, NULL, NULL, $ga$Bonfire Burritos, 2221 Ford St, Golden, CO 80401$ga$, 39.747878199999995, -105.21078709999999, $ga$ChIJ8T0jQOmEa4cRHWi4m5pqc20$ga$, $ga$2221 Ford St, Golden, CO 80401, USA$ga$, $ga$Bonfire Burritos, 2221 Ford St, Golden, CO 80401$ga$, 1226, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.747878199999995, maps_lng = -105.21078709999999, google_place_id = $ga$ChIJ8T0jQOmEa4cRHWi4m5pqc20$ga$, formatted_address = $ga$2221 Ford St, Golden, CO 80401, USA$ga$ WHERE id = 'bd0fd163-2833-4e23-8bb4-6c9b84cde657'::uuid AND maps_lat IS NULL;

-- [B] c4280d06-7aa1-4382-a4ec-1231fc6939e3 -- Walk beneath the Howdy Folks welcome arch in downtown Golden
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('c4280d06-7aa1-4382-a4ec-1231fc6939e3'::uuid, NULL, NULL, $ga$Golden Welcome Arch, Golden, CO$ga$, 39.7557666, -105.2216971, $ga$ChIJXWDZ8dKaa4cR0441eGq_epY$ga$, $ga$1110 Washington Ave, Golden, CO 80401, USA$ga$, $ga$Golden Welcome Arch, Golden, CO$ga$, 57, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7557666, maps_lng = -105.2216971, google_place_id = $ga$ChIJXWDZ8dKaa4cR0441eGq_epY$ga$, formatted_address = $ga$1110 Washington Ave, Golden, CO 80401, USA$ga$ WHERE id = 'c4280d06-7aa1-4382-a4ec-1231fc6939e3'::uuid AND maps_lat IS NULL;

-- [A] c674befd-40d5-4d27-bb1a-81c445423cad -- Walk all four pedestrian blocks of 'Pearl Street Mall' and stop for a street per
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('c674befd-40d5-4d27-bb1a-81c445423cad'::uuid, NULL, NULL, $ga$Pearl Street Mall, Boulder, CO$ga$, 40.018350999999996, -105.2786591, $ga$ChIJiTEGLibsa4cRepH7ZMFEcJ8$ga$, $ga$1303 Pearl St, Boulder, CO 80302, USA$ga$, $ga$Pearl Street Mall, Boulder, CO$ga$, 341, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.018350999999996, maps_lng = -105.2786591, google_place_id = $ga$ChIJiTEGLibsa4cRepH7ZMFEcJ8$ga$, formatted_address = $ga$1303 Pearl St, Boulder, CO 80302, USA$ga$ WHERE id = 'c674befd-40d5-4d27-bb1a-81c445423cad'::uuid AND maps_lat IS NULL;

-- [A] c7a07f61-4288-4596-8c09-05ea5d3e4a46 -- Find the heirloom chickens among the historic buildings at 'Golden History Park'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('c7a07f61-4288-4596-8c09-05ea5d3e4a46'::uuid, NULL, NULL, $ga$Golden History Park, Golden, CO$ga$, 39.754981099999995, -105.2247939, $ga$ChIJfUa_kdGaa4cRauVmicaMddQ$ga$, $ga$1020 11th St, Golden, CO 80401, USA$ga$, $ga$Golden History Park, Golden, CO$ga$, 322, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.754981099999995, maps_lng = -105.2247939, google_place_id = $ga$ChIJfUa_kdGaa4cRauVmicaMddQ$ga$, formatted_address = $ga$1020 11th St, Golden, CO 80401, USA$ga$ WHERE id = 'c7a07f61-4288-4596-8c09-05ea5d3e4a46'::uuid AND maps_lat IS NULL;

-- [B] c83d85bd-3f44-48dc-9ac8-042f4946eb11 -- Pick up the free art-kit inspired by the current exhibition at 'The Collective C
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('c83d85bd-3f44-48dc-9ac8-042f4946eb11'::uuid, NULL, NULL, $ga$The Collective Community Arts Center, Lafayette, CO$ga$, 39.9993621, -105.0906205, $ga$ChIJe9UGd_r0a4cRJyHnezmjlSU$ga$, $ga$201 N Public Rd, Lafayette, CO 80026, USA$ga$, $ga$The Collective Community Arts Center, Lafayette, CO$ga$, 646, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.9993621, maps_lng = -105.0906205, google_place_id = $ga$ChIJe9UGd_r0a4cRJyHnezmjlSU$ga$, formatted_address = $ga$201 N Public Rd, Lafayette, CO 80026, USA$ga$ WHERE id = 'c83d85bd-3f44-48dc-9ac8-042f4946eb11'::uuid AND maps_lat IS NULL;

-- [A] c9cf5edc-82db-49d6-80a9-2cfb13b82945 -- Eat a street-food plate beneath the old 'Olinger Mortuaries' rooftop sign at 'Li
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('c9cf5edc-82db-49d6-80a9-2cfb13b82945'::uuid, NULL, NULL, $ga$Linger, Denver, CO$ga$, 39.7595235, -105.011411, $ga$ChIJF4sShZR4bIcRZCQ8ZRvoh_c$ga$, $ga$2030 W 30th Ave, Denver, CO 80211, USA$ga$, $ga$Linger, Denver, CO$ga$, 411, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7595235, maps_lng = -105.011411, google_place_id = $ga$ChIJF4sShZR4bIcRZCQ8ZRvoh_c$ga$, formatted_address = $ga$2030 W 30th Ave, Denver, CO 80211, USA$ga$ WHERE id = 'c9cf5edc-82db-49d6-80a9-2cfb13b82945'::uuid AND maps_lat IS NULL;

-- [B] c9d51017-0e7a-4347-89fe-3f377a46b748 -- Eat a cylindrical hand roll while the rice is warm and the nori still crisp at '
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('c9d51017-0e7a-4347-89fe-3f377a46b748'::uuid, NULL, NULL, $ga$The Source Hotel + Market Hall, Denver, CO$ga$, 39.7686962, -104.9804736, $ga$ChIJjzxMspd5bIcRpikyAUQDwYU$ga$, $ga$3330 Brighton Blvd, Denver, CO 80216, USA$ga$, $ga$The Source Hotel + Market Hall, Denver, CO$ga$, 1089, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7686962, maps_lng = -104.9804736, google_place_id = $ga$ChIJjzxMspd5bIcRpikyAUQDwYU$ga$, formatted_address = $ga$3330 Brighton Blvd, Denver, CO 80216, USA$ga$ WHERE id = 'c9d51017-0e7a-4347-89fe-3f377a46b748'::uuid AND maps_lat IS NULL;

-- [A] c9ffca28-5a4f-4f6f-8cd7-9cbe08b8b489 -- Hike two miles to Ralph Price Reservoir at 'Button Rock Preserve'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('c9ffca28-5a4f-4f6f-8cd7-9cbe08b8b489'::uuid, NULL, NULL, $ga$Button Rock Preserve, County Road 80, Lyons, CO 80540$ga$, 40.228712099999996, -105.34199219999999, $ga$ChIJOycHZrnha4cRgVSmyb_qYss$ga$, $ga$Co Hwy 80, Lyons, CO 80540, USA$ga$, $ga$Button Rock Preserve, County Road 80, Lyons, CO 80540$ga$, 21506, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.228712099999996, maps_lng = -105.34199219999999, google_place_id = $ga$ChIJOycHZrnha4cRgVSmyb_qYss$ga$, formatted_address = $ga$Co Hwy 80, Lyons, CO 80540, USA$ga$ WHERE id = 'c9ffca28-5a4f-4f6f-8cd7-9cbe08b8b489'::uuid AND maps_lat IS NULL;

-- [A] cc79459f-33bf-4f9b-81bd-fadb0a8022f4 -- Board or closely explore a historic railcar at 'Colorado Railroad Museum'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('cc79459f-33bf-4f9b-81bd-fadb0a8022f4'::uuid, NULL, NULL, $ga$Colorado Railroad Museum, Golden, CO$ga$, 39.7714516, -105.1933883, $ga$ChIJ0bAW1mqFa4cRyC9E-gU2UoM$ga$, $ga$17155 W 44th Ave, Golden, CO 80403, USA$ga$, $ga$Colorado Railroad Museum, Golden, CO$ga$, 2956, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7714516, maps_lng = -105.1933883, google_place_id = $ga$ChIJ0bAW1mqFa4cRyC9E-gU2UoM$ga$, formatted_address = $ga$17155 W 44th Ave, Golden, CO 80403, USA$ga$ WHERE id = 'cc79459f-33bf-4f9b-81bd-fadb0a8022f4'::uuid AND maps_lat IS NULL;

-- [A] cde0d025-dcd6-4fff-ae8a-dc3ddc3a10d9 -- Watch the BEYOND light show inside 'International Church of Cannabis'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('cde0d025-dcd6-4fff-ae8a-dc3ddc3a10d9'::uuid, NULL, NULL, $ga$International Church of Cannabis, 400 S Logan St, Denver, CO 80209$ga$, 39.7091597, -104.98227759999999, $ga$ChIJx2VML-N-bIcRD1NUD373_uk$ga$, $ga$400 S Logan St, Denver, CO 80209, USA$ga$, $ga$International Church of Cannabis, 400 S Logan St, Denver, CO 80209$ga$, 1526, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7091597, maps_lng = -104.98227759999999, google_place_id = $ga$ChIJx2VML-N-bIcRD1NUD373_uk$ga$, formatted_address = $ga$400 S Logan St, Denver, CO 80209, USA$ga$ WHERE id = 'cde0d025-dcd6-4fff-ae8a-dc3ddc3a10d9'::uuid AND maps_lat IS NULL;

-- [A] cf7ce51f-f03f-4631-a7c9-4669afc9f20f -- Step behind the bookcase for a monthly speakeasy night at '24 Carrot Bistro'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('cf7ce51f-f03f-4631-a7c9-4669afc9f20f'::uuid, NULL, NULL, $ga$24 Carrot Bistro, 578 Briggs St, Erie, CO 80516$ga$, 40.0499209, -105.0478222, $ga$ChIJpwa3T-L1a4cR0v64nwKdVtA$ga$, $ga$578 Briggs St, Erie, CO 80516, USA$ga$, $ga$24 Carrot Bistro, 578 Briggs St, Erie, CO 80516$ga$, 188, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0499209, maps_lng = -105.0478222, google_place_id = $ga$ChIJpwa3T-L1a4cR0v64nwKdVtA$ga$, formatted_address = $ga$578 Briggs St, Erie, CO 80516, USA$ga$ WHERE id = 'cf7ce51f-f03f-4631-a7c9-4669afc9f20f'::uuid AND maps_lat IS NULL;

-- [B] d0b5a03d-cf1e-42ae-bca7-99e67902cdc9 -- Find three pieces of public art in the 'Downtown Longmont Creative District'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('d0b5a03d-cf1e-42ae-bca7-99e67902cdc9'::uuid, NULL, NULL, $ga$Downtown Longmont Creative District, Longmont, CO$ga$, 40.164468899999996, -105.1020594, $ga$ChIJbQh0NQv5a4cR1qh2LAWMaRM$ga$, $ga$320 Main St, Longmont, CO 80501, USA$ga$, $ga$Downtown Longmont Creative District, Longmont, CO$ga$, 305, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.164468899999996, maps_lng = -105.1020594, google_place_id = $ga$ChIJbQh0NQv5a4cR1qh2LAWMaRM$ga$, formatted_address = $ga$320 Main St, Longmont, CO 80501, USA$ga$ WHERE id = 'd0b5a03d-cf1e-42ae-bca7-99e67902cdc9'::uuid AND maps_lat IS NULL;

-- [B] d0f49958-63d3-495f-84b2-6343d52ee762 -- Reach the Denver skyline viewpoint at 'William F. Hayden Green Mountain Park'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('d0f49958-63d3-495f-84b2-6343d52ee762'::uuid, NULL, NULL, $ga$William F. Hayden Green Mountain Park, Lakewood, CO$ga$, 39.6945933, -105.17032979999999, $ga$ChIJGe79E56Da4cR45Y-iJggRsU$ga$, $ga$1000 S Rooney Rd, Lakewood, CO 80228, USA$ga$, $ga$William F. Hayden Green Mountain Park, Lakewood, CO$ga$, 7693, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.6945933, maps_lng = -105.17032979999999, google_place_id = $ga$ChIJGe79E56Da4cR45Y-iJggRsU$ga$, formatted_address = $ga$1000 S Rooney Rd, Lakewood, CO 80228, USA$ga$ WHERE id = 'd0f49958-63d3-495f-84b2-6343d52ee762'::uuid AND maps_lat IS NULL;

-- [A] d1e1d2aa-7f1f-433f-9a0f-3a460ad50063 -- Play a board game beside the firepits on the graffiti-lined patio at 'Improper C
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('d1e1d2aa-7f1f-433f-9a0f-3a460ad50063'::uuid, NULL, NULL, $ga$Improper City, Denver, CO$ga$, 39.765277499999996, -104.9791467, $ga$ChIJeeWSFKp5bIcRkU3OlL__JBU$ga$, $ga$3201 Walnut St #107, Denver, CO 80205, USA$ga$, $ga$Improper City, Denver, CO$ga$, 807, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.765277499999996, maps_lng = -104.9791467, google_place_id = $ga$ChIJeeWSFKp5bIcRkU3OlL__JBU$ga$, formatted_address = $ga$3201 Walnut St #107, Denver, CO 80205, USA$ga$ WHERE id = 'd1e1d2aa-7f1f-433f-9a0f-3a460ad50063'::uuid AND maps_lat IS NULL;

-- [A] d225235d-5650-4376-8d4b-d16d946baf95 -- Order the original Sink cheeseburger as a trio of sliders beneath the ceiling ar
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('d225235d-5650-4376-8d4b-d16d946baf95'::uuid, NULL, NULL, $ga$The Sink, 1165 13th St, Boulder, CO 80302$ga$, 40.0085805, -105.27640729999999, $ga$ChIJ5TW3jDDsa4cRkSewKsCsNSE$ga$, $ga$1165 13th St, Boulder, CO 80302, USA$ga$, $ga$The Sink, 1165 13th St, Boulder, CO 80302$ga$, 1164, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0085805, maps_lng = -105.27640729999999, google_place_id = $ga$ChIJ5TW3jDDsa4cRkSewKsCsNSE$ga$, formatted_address = $ga$1165 13th St, Boulder, CO 80302, USA$ga$ WHERE id = 'd225235d-5650-4376-8d4b-d16d946baf95'::uuid AND maps_lat IS NULL;

-- [A] d228dd53-81ce-4cea-98e1-893498c1a933 -- Rotate through the cedar sauna, cold plunge, salt room and forest showers at 'Th
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('d228dd53-81ce-4cea-98e1-893498c1a933'::uuid, NULL, NULL, $ga$The Dragontree Spa, 2405 Broadway, Boulder, CO 80304$ga$, 40.0220603, -105.2816848, $ga$ChIJ3xvcVSjsa4cR_51q-TWGx0E$ga$, $ga$2405 Broadway, Boulder, CO 80304, USA$ga$, $ga$The Dragontree Spa, 2405 Broadway, Boulder, CO 80304$ga$, 684, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0220603, maps_lng = -105.2816848, google_place_id = $ga$ChIJ3xvcVSjsa4cR_51q-TWGx0E$ga$, formatted_address = $ga$2405 Broadway, Boulder, CO 80304, USA$ga$ WHERE id = 'd228dd53-81ce-4cea-98e1-893498c1a933'::uuid AND maps_lat IS NULL;

-- [B] d3e9f7cc-73ff-4148-913b-99c78817d409 -- Complete the loop around 'McIntosh Lake'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('d3e9f7cc-73ff-4148-913b-99c78817d409'::uuid, NULL, NULL, $ga$McIntosh Lake, Longmont, CO$ga$, 40.1920554, -105.1386935, $ga$ChIJW3FwZvD7a4cRhMWqZBrlyVg$ga$, $ga$miles, 1905 Harvard St #3.5, Longmont, CO 80503, USA$ga$, $ga$McIntosh Lake, Longmont, CO$ga$, 4170, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1920554, maps_lng = -105.1386935, google_place_id = $ga$ChIJW3FwZvD7a4cRhMWqZBrlyVg$ga$, formatted_address = $ga$miles, 1905 Harvard St #3.5, Longmont, CO 80503, USA$ga$ WHERE id = 'd3e9f7cc-73ff-4148-913b-99c78817d409'::uuid AND maps_lat IS NULL;

-- [A] d463f0a3-2520-4d58-b9c4-3d334b3ab5e9 -- Hike to the Blue Bird Mine bunkhouse and ore-cart tracks at 'Caribou Ranch'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('d463f0a3-2520-4d58-b9c4-3d334b3ab5e9'::uuid, NULL, NULL, $ga$Caribou Ranch Open Space, 144 County Road 126, Nederland, CO 80466$ga$, 39.9823521, -105.5192496, $ga$ChIJEwV866PGa4cRYHklCIUdnN4$ga$, $ga$CR-Peezo House At, 144 Co Rd 126 #86, Nederland, CO 80466, USA$ga$, $ga$Caribou Ranch Open Space, 144 County Road 126, Nederland, CO 80466$ga$, 2440, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.9823521, maps_lng = -105.5192496, google_place_id = $ga$ChIJEwV866PGa4cRYHklCIUdnN4$ga$, formatted_address = $ga$CR-Peezo House At, 144 Co Rd 126 #86, Nederland, CO 80466, USA$ga$ WHERE id = 'd463f0a3-2520-4d58-b9c4-3d334b3ab5e9'::uuid AND maps_lat IS NULL;

-- [A] d5a60c98-2e53-49ef-aafa-4516f37f157d -- Enter through the bookcase and order a cocktail at 'Williams & Graham'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('d5a60c98-2e53-49ef-aafa-4516f37f157d'::uuid, NULL, NULL, $ga$Williams & Graham, 3160 Tejon St, Denver, CO 80211$ga$, 39.7619399, -105.011026, $ga$ChIJ-yVzEpN4bIcRn8UiXo68tUo$ga$, $ga$3160 Tejon St, Denver, CO 80211, USA$ga$, $ga$Williams & Graham, 3160 Tejon St, Denver, CO 80211$ga$, 143, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7619399, maps_lng = -105.011026, google_place_id = $ga$ChIJ-yVzEpN4bIcRn8UiXo68tUo$ga$, formatted_address = $ga$3160 Tejon St, Denver, CO 80211, USA$ga$ WHERE id = 'd5a60c98-2e53-49ef-aafa-4516f37f157d'::uuid AND maps_lat IS NULL;

-- [A] d6d0e4fe-55d3-49b1-bf4c-a545889c9069 -- Order The Franklin biscuit sandwich at 'Denver Biscuit Company'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('d6d0e4fe-55d3-49b1-bf4c-a545889c9069'::uuid, NULL, NULL, $ga$Denver Biscuit Company, 3237 E Colfax Ave, Denver, CO 80206$ga$, 39.7403976, -104.9490503, $ga$ChIJB8H2oa1-bIcR0v0lKsQugFw$ga$, $ga$3237 E Colfax Ave, Denver, CO 80206, USA$ga$, $ga$Denver Biscuit Company, 3237 E Colfax Ave, Denver, CO 80206$ga$, 2939, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7403976, maps_lng = -104.9490503, google_place_id = $ga$ChIJB8H2oa1-bIcR0v0lKsQugFw$ga$, formatted_address = $ga$3237 E Colfax Ave, Denver, CO 80206, USA$ga$ WHERE id = 'd6d0e4fe-55d3-49b1-bf4c-a545889c9069'::uuid AND maps_lat IS NULL;

-- [A] d7687915-0750-4ea1-a57a-876a969173d8 -- Have tea beneath the hand painted ceiling at 'Boulder Dushanbe Teahouse'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('d7687915-0750-4ea1-a57a-876a969173d8'::uuid, NULL, NULL, $ga$Boulder Dushanbe Teahouse, Boulder, CO$ga$, 40.0154553, -105.277204, $ga$ChIJ4-dlTy_sa4cRd978vIqVG1Y$ga$, $ga$1770 13th St, Boulder, CO 80302, USA$ga$, $ga$Boulder Dushanbe Teahouse, Boulder, CO$ga$, 444, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0154553, maps_lng = -105.277204, google_place_id = $ga$ChIJ4-dlTy_sa4cRd978vIqVG1Y$ga$, formatted_address = $ga$1770 13th St, Boulder, CO 80302, USA$ga$ WHERE id = 'd7687915-0750-4ea1-a57a-876a969173d8'::uuid AND maps_lat IS NULL;

-- [A] d8f8912d-915b-4814-982b-c5fcb2c5a014 -- Find a historic photograph of a Denver street you recognize in the Western Histo
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('d8f8912d-915b-4814-982b-c5fcb2c5a014'::uuid, NULL, NULL, $ga$Denver Public Library — Central Library, Denver, CO$ga$, 39.7372618, -104.98814569999999, $ga$ChIJRcO9KSt_bIcRRSyTvef5bUQ$ga$, $ga$10 W 14th Ave, Denver, CO 80204, USA$ga$, $ga$Denver Public Library — Central Library, Denver, CO$ga$, 948, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7372618, maps_lng = -104.98814569999999, google_place_id = $ga$ChIJRcO9KSt_bIcRRSyTvef5bUQ$ga$, formatted_address = $ga$10 W 14th Ave, Denver, CO 80204, USA$ga$ WHERE id = 'd8f8912d-915b-4814-982b-c5fcb2c5a014'::uuid AND maps_lat IS NULL;

-- [A] db4f7371-6647-4df0-b3d5-aaee0eae67db -- Find the historic water tower while walking 'Olde Town Arvada'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('db4f7371-6647-4df0-b3d5-aaee0eae67db'::uuid, NULL, NULL, $ga$Olde Town Arvada, Arvada, CO$ga$, 39.800874199999996, -105.0798535, $ga$ChIJAebUNCuGa4cR0OpWUB6nXI4$ga$, $ga$Olde Town Arvada, Arvada, CO 80002, USA$ga$, $ga$Olde Town Arvada, Arvada, CO$ga$, 685, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.800874199999996, maps_lng = -105.0798535, google_place_id = $ga$ChIJAebUNCuGa4cR0OpWUB6nXI4$ga$, formatted_address = $ga$Olde Town Arvada, Arvada, CO 80002, USA$ga$ WHERE id = 'db4f7371-6647-4df0-b3d5-aaee0eae67db'::uuid AND maps_lat IS NULL;

-- [A] dc1cdc75-add7-41f9-9513-84793386de17 -- Tour the tea factory and sample from more than 80 teas at 'Celestial Seasonings'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('dc1cdc75-add7-41f9-9513-84793386de17'::uuid, NULL, NULL, $ga$Celestial Seasonings, Boulder, CO$ga$, 40.0592587, -105.2195742, $ga$ChIJt4hY4Sfua4cR9ccGbqlvcak$ga$, $ga$4600 Sleepytime Dr, Boulder, CO 80301, USA$ga$, $ga$Celestial Seasonings, Boulder, CO$ga$, 6490, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0592587, maps_lng = -105.2195742, google_place_id = $ga$ChIJt4hY4Sfua4cR9ccGbqlvcak$ga$, formatted_address = $ga$4600 Sleepytime Dr, Boulder, CO 80301, USA$ga$ WHERE id = 'dc1cdc75-add7-41f9-9513-84793386de17'::uuid AND maps_lat IS NULL;

-- [A] dcedc561-9f46-4083-8b9a-4b81ccd8ede4 -- Build a flight around 'White Rascal' and the taproom-exclusive 'Out of Bounds' s
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('dcedc561-9f46-4083-8b9a-4b81ccd8ede4'::uuid, NULL, NULL, $ga$Avery Brewing Company, Boulder, CO$ga$, 40.062566499999996, -105.2047371, $ga$ChIJoe7MMgjya4cRRiQzBFTNDLk$ga$, $ga$4910 Nautilus Ct N, Boulder, CO 80301, USA$ga$, $ga$Avery Brewing Company, Boulder, CO$ga$, 7682, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.062566499999996, maps_lng = -105.2047371, google_place_id = $ga$ChIJoe7MMgjya4cRRiQzBFTNDLk$ga$, formatted_address = $ga$4910 Nautilus Ct N, Boulder, CO 80301, USA$ga$ WHERE id = 'dcedc561-9f46-4083-8b9a-4b81ccd8ede4'::uuid AND maps_lat IS NULL;

-- [B] dd20c7d4-0a92-46ad-9531-a4977cc7dea9 -- See a concert beneath the original movie-theater marquee in the 625-capacity 'Fo
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('dd20c7d4-0a92-46ad-9531-a4977cc7dea9'::uuid, NULL, NULL, $ga$Fox Theatre Boulder, Boulder, CO$ga$, 40.0080325, -105.2763878, $ga$ChIJm3Mz6jDsa4cRcLUYctwIzBI$ga$, $ga$1135 13th St, Boulder, CO 80302, USA$ga$, $ga$Fox Theatre Boulder, Boulder, CO$ga$, 1225, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0080325, maps_lng = -105.2763878, google_place_id = $ga$ChIJm3Mz6jDsa4cRcLUYctwIzBI$ga$, formatted_address = $ga$1135 13th St, Boulder, CO 80302, USA$ga$ WHERE id = 'dd20c7d4-0a92-46ad-9531-a4977cc7dea9'::uuid AND maps_lat IS NULL;

-- [A] dd31c3a5-ed03-4fe0-9c9b-f64f0a8d7da6 -- Step into the replica office of former mayor Wellington Webb at 'Blair-Caldwell 
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('dd31c3a5-ed03-4fe0-9c9b-f64f0a8d7da6'::uuid, NULL, NULL, $ga$Blair-Caldwell African American Research Library, Denver, CO$ga$, 39.7524003, -104.9816252, $ga$ChIJhYS17SZ5bIcR0Lh8OXFAFeI$ga$, $ga$2401 Welton St, Denver, CO 80205, USA$ga$, $ga$Blair-Caldwell African American Research Library, Denver, CO$ga$, 835, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7524003, maps_lng = -104.9816252, google_place_id = $ga$ChIJhYS17SZ5bIcR0Lh8OXFAFeI$ga$, formatted_address = $ga$2401 Welton St, Denver, CO 80205, USA$ga$ WHERE id = 'dd31c3a5-ed03-4fe0-9c9b-f64f0a8d7da6'::uuid AND maps_lat IS NULL;

-- [A] ddd8b9cd-85ed-4c33-8865-8bc2a8ee7f49 -- Build a cider flight with the Front Range view at 'Acreage by Stem Ciders'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('ddd8b9cd-85ed-4c33-8865-8bc2a8ee7f49'::uuid, NULL, NULL, $ga$Acreage by Stem Ciders, 1380 Horizon Ave, Unit A, Lafayette, CO 80026$ga$, 39.981449100000006, -105.0639518, $ga$ChIJX6jqTzr1a4cR9BiEDWE7cTU$ga$, $ga$1380 Horizon Ave A, Lafayette, CO 80026, USA$ga$, $ga$Acreage by Stem Ciders, 1380 Horizon Ave, Unit A, Lafayette, CO 80026$ga$, 2577, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.981449100000006, maps_lng = -105.0639518, google_place_id = $ga$ChIJX6jqTzr1a4cR9BiEDWE7cTU$ga$, formatted_address = $ga$1380 Horizon Ave A, Lafayette, CO 80026, USA$ga$ WHERE id = 'ddd8b9cd-85ed-4c33-8865-8bc2a8ee7f49'::uuid AND maps_lat IS NULL;

-- [B] de1208e6-fcb6-4f15-a430-449fc9ca2da1 -- Walk eye-to-eye with red kangaroos and wallabies along Wallaby Way in 'Down Unde
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('de1208e6-fcb6-4f15-a430-449fc9ca2da1'::uuid, NULL, NULL, $ga$Denver Zoo Conservation Alliance, Denver, CO$ga$, 39.7495961, -104.95085189999999, $ga$ChIJcY8lIE55bIcRKWyHPdIO_VM$ga$, $ga$2300 Steele St, Denver, CO 80205, USA$ga$, $ga$Denver Zoo Conservation Alliance, Denver, CO$ga$, 3218, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7495961, maps_lng = -104.95085189999999, google_place_id = $ga$ChIJcY8lIE55bIcRKWyHPdIO_VM$ga$, formatted_address = $ga$2300 Steele St, Denver, CO 80205, USA$ga$ WHERE id = 'de1208e6-fcb6-4f15-a430-449fc9ca2da1'::uuid AND maps_lat IS NULL;

-- [A] de219490-ef35-4746-9132-5a5e1fef70d5 -- Pair food from two vendors with the skyline view at 'Avanti Food and Beverage De
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('de219490-ef35-4746-9132-5a5e1fef70d5'::uuid, NULL, NULL, $ga$Avanti Food & Beverage Denver, Denver, CO$ga$, 39.762226399999996, -105.0062466, $ga$ChIJ7Thv9ex4bIcRCDoTtC3kIy0$ga$, $ga$3200 N Pecos St, Denver, CO 80211, USA$ga$, $ga$Avanti Food & Beverage Denver, Denver, CO$ga$, 436, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.762226399999996, maps_lng = -105.0062466, google_place_id = $ga$ChIJ7Thv9ex4bIcRCDoTtC3kIy0$ga$, formatted_address = $ga$3200 N Pecos St, Denver, CO 80211, USA$ga$ WHERE id = 'de219490-ef35-4746-9132-5a5e1fef70d5'::uuid AND maps_lat IS NULL;

-- [A] dff1afbb-9684-4ba0-baf3-bdd00ef57fbd -- Find a dinosaur track or trace fossil along 'Triceratops Trail'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('dff1afbb-9684-4ba0-baf3-bdd00ef57fbd'::uuid, NULL, NULL, $ga$Triceratops Trail, Golden, CO$ga$, 39.7453643, -105.22251279999999, $ga$ChIJfT7RaCuba4cRq5_CmHtA5lw$ga$, $ga$3050 Illinois St, Golden, CO 80401, USA$ga$, $ga$Triceratops Trail, Golden, CO$ga$, 1138, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7453643, maps_lng = -105.22251279999999, google_place_id = $ga$ChIJfT7RaCuba4cRq5_CmHtA5lw$ga$, formatted_address = $ga$3050 Illinois St, Golden, CO 80401, USA$ga$ WHERE id = 'dff1afbb-9684-4ba0-baf3-bdd00ef57fbd'::uuid AND maps_lat IS NULL;

-- [A] e0b82e7f-c02d-458a-907e-55898f99bd85 -- Cool off with a 'Lightshine Radler' blending award-winning helles and house-made
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('e0b82e7f-c02d-458a-907e-55898f99bd85'::uuid, NULL, NULL, $ga$Wibby Brewing, Longmont, CO$ga$, 40.162395599999996, -105.10019009999999, $ga$ChIJfW8nqaH5a4cR_ZNBUxJkl_w$ga$, $ga$209 Emery St, Longmont, CO 80501, USA$ga$, $ga$Wibby Brewing, Longmont, CO$ga$, 555, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.162395599999996, maps_lng = -105.10019009999999, google_place_id = $ga$ChIJfW8nqaH5a4cR_ZNBUxJkl_w$ga$, formatted_address = $ga$209 Emery St, Longmont, CO 80501, USA$ga$ WHERE id = 'e0b82e7f-c02d-458a-907e-55898f99bd85'::uuid AND maps_lat IS NULL;

-- [A] e1f92e2e-66b6-4254-b6dc-34bdcee540f6 -- Watch a show from the 100-seat balcony inside the old movie palace at 'The Orien
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('e1f92e2e-66b6-4254-b6dc-34bdcee540f6'::uuid, NULL, NULL, $ga$The Oriental Theater, Denver, CO$ga$, 39.776786799999996, -105.04352759999999, $ga$ChIJ67M_roSHa4cRwCG6QqMk1dE$ga$, $ga$4335 W 44th Ave, Denver, CO 80212, USA$ga$, $ga$The Oriental Theater, Denver, CO$ga$, 366, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.776786799999996, maps_lng = -105.04352759999999, google_place_id = $ga$ChIJ67M_roSHa4cRwCG6QqMk1dE$ga$, formatted_address = $ga$4335 W 44th Ave, Denver, CO 80212, USA$ga$ WHERE id = 'e1f92e2e-66b6-4254-b6dc-34bdcee540f6'::uuid AND maps_lat IS NULL;

-- [A] e337d21e-fab6-4edf-a6ed-60bcd94b9768 -- Order the chile relleno burrito smothered in green chile at 'El Taco de Mexico'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('e337d21e-fab6-4edf-a6ed-60bcd94b9768'::uuid, NULL, NULL, $ga$El Taco de Mexico, 714 Santa Fe Dr, Denver, CO 80204$ga$, 39.7276381, -104.9982842, $ga$ChIJjztzFDB_bIcRPBxaDMfY81Q$ga$, $ga$714 Santa Fe Dr, Denver, CO 80204, USA$ga$, $ga$El Taco de Mexico, 714 Santa Fe Dr, Denver, CO 80204$ga$, 2021, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7276381, maps_lng = -104.9982842, google_place_id = $ga$ChIJjztzFDB_bIcRPBxaDMfY81Q$ga$, formatted_address = $ga$714 Santa Fe Dr, Denver, CO 80204, USA$ga$ WHERE id = 'e337d21e-fab6-4edf-a6ed-60bcd94b9768'::uuid AND maps_lat IS NULL;

-- [A] e57c8b9c-e790-4def-8091-c5dea8be8fea -- Watch part of a game on the giant outdoor screen at 'McGregor Square'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('e57c8b9c-e790-4def-8091-c5dea8be8fea'::uuid, NULL, NULL, $ga$McGregor Square, Denver, CO$ga$, 39.754923399999996, -104.9961421, $ga$ChIJ9bgqFqB5bIcRR6mRvjC3CFA$ga$, $ga$1901 Wazee St, Denver, CO 80202, USA$ga$, $ga$McGregor Square, Denver, CO$ga$, 412, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.754923399999996, maps_lng = -104.9961421, google_place_id = $ga$ChIJ9bgqFqB5bIcRR6mRvjC3CFA$ga$, formatted_address = $ga$1901 Wazee St, Denver, CO 80202, USA$ga$ WHERE id = 'e57c8b9c-e790-4def-8091-c5dea8be8fea'::uuid AND maps_lat IS NULL;

-- [A] e85fae74-a640-4288-961f-116f82b1a067 -- Hike from 'Windy Saddle Park' to the Beaver Brook overlook
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('e85fae74-a640-4288-961f-116f82b1a067'::uuid, NULL, NULL, $ga$Windy Saddle Park, Golden, CO$ga$, 39.7368283, -105.2454911, $ga$ChIJYZOqFiOba4cRwm9s-0F0u_E$ga$, $ga$1277 Lookout Mountain Rd, Golden, CO 80401, USA$ga$, $ga$Windy Saddle Park, Golden, CO$ga$, 2946, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7368283, maps_lng = -105.2454911, google_place_id = $ga$ChIJYZOqFiOba4cRwm9s-0F0u_E$ga$, formatted_address = $ga$1277 Lookout Mountain Rd, Golden, CO 80401, USA$ga$ WHERE id = 'e85fae74-a640-4288-961f-116f82b1a067'::uuid AND maps_lat IS NULL;

-- [B] e91add97-243c-456c-8bee-5150c43a0ba8 -- Find three murals along the ArtLine in the '40 West Arts District'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('e91add97-243c-456c-8bee-5150c43a0ba8'::uuid, NULL, NULL, $ga$40 West Arts District, Lakewood, CO$ga$, 39.740848400000004, -105.0684538, $ga$ChIJJ_BE1yaHa4cRmo-Pv7QeSAI$ga$, $ga$6501 W Colfax Ave, Lakewood, CO 80214, USA$ga$, $ga$40 West Arts District, Lakewood, CO$ga$, 4168, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.740848400000004, maps_lng = -105.0684538, google_place_id = $ga$ChIJJ_BE1yaHa4cRmo-Pv7QeSAI$ga$, formatted_address = $ga$6501 W Colfax Ave, Lakewood, CO 80214, USA$ga$ WHERE id = 'e91add97-243c-456c-8bee-5150c43a0ba8'::uuid AND maps_lat IS NULL;

-- [A] e98a6e40-5a39-4c74-a0e3-9069afcd8e23 -- Complete one themed mini golf course at 'Adventure Golf and Raceway'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('e98a6e40-5a39-4c74-a0e3-9069afcd8e23'::uuid, NULL, NULL, $ga$Adventure Golf & Raceway, Westminster, CO$ga$, 39.8714346, -105.0521472, $ga$ChIJv-tA6-mJa4cRVFtWxkQluJs$ga$, $ga$9650 Sheridan Blvd, Westminster, CO 80031, USA$ga$, $ga$Adventure Golf & Raceway, Westminster, CO$ga$, 4072, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.8714346, maps_lng = -105.0521472, google_place_id = $ga$ChIJv-tA6-mJa4cRVFtWxkQluJs$ga$, formatted_address = $ga$9650 Sheridan Blvd, Westminster, CO 80031, USA$ga$ WHERE id = 'e98a6e40-5a39-4c74-a0e3-9069afcd8e23'::uuid AND maps_lat IS NULL;

-- [B] eaa9fcfc-1a79-4918-b20e-3441171a9bf3 -- Visit Buffalo Bill's grave and museum atop Lookout Mountain
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('eaa9fcfc-1a79-4918-b20e-3441171a9bf3'::uuid, NULL, NULL, $ga$Buffalo Bill Museum and Grave, Golden, CO$ga$, 39.7333895, -105.2384798, $ga$ChIJAe02kzyba4cRaAkCeicVBa8$ga$, $ga$987 1/2 Lookout Mountain Rd, Golden, CO 80401, USA$ga$, $ga$Buffalo Bill Museum and Grave, Golden, CO$ga$, 2877, $ga$B$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7333895, maps_lng = -105.2384798, google_place_id = $ga$ChIJAe02kzyba4cRaAkCeicVBa8$ga$, formatted_address = $ga$987 1/2 Lookout Mountain Rd, Golden, CO 80401, USA$ga$ WHERE id = 'eaa9fcfc-1a79-4918-b20e-3441171a9bf3'::uuid AND maps_lat IS NULL;

-- [A] ecdbdf5e-94fa-41f3-a47c-a5378cb8e527 -- Try Rocky Mountain oysters at 'The Buckhorn Exchange'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('ecdbdf5e-94fa-41f3-a47c-a5378cb8e527'::uuid, NULL, NULL, $ga$The Buckhorn Exchange, Denver, CO$ga$, 39.7322576, -105.0051634, $ga$ChIJiZdhRjR_bIcRcPMnysmKymQ$ga$, $ga$1000 Osage St, Denver, CO 80204, USA$ga$, $ga$The Buckhorn Exchange, Denver, CO$ga$, 4732, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7322576, maps_lng = -105.0051634, google_place_id = $ga$ChIJiZdhRjR_bIcRcPMnysmKymQ$ga$, formatted_address = $ga$1000 Osage St, Denver, CO 80204, USA$ga$ WHERE id = 'ecdbdf5e-94fa-41f3-a47c-a5378cb8e527'::uuid AND maps_lat IS NULL;

-- [A] f1064c56-9319-4b49-8e54-59c0cebde034 -- Order the handmade soup dumplings at 'Flower Pepper'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('f1064c56-9319-4b49-8e54-59c0cebde034'::uuid, NULL, NULL, $ga$Flower Pepper, 1310 College Ave, Boulder, CO 80302$ga$, 40.0071181, -105.2759597, $ga$ChIJi5tTDZzua4cRCJGf4ui2isU$ga$, $ga$1310 College Ave, Boulder, CO 80302, USA$ga$, $ga$Flower Pepper, 1310 College Ave, Boulder, CO 80302$ga$, 1322, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.0071181, maps_lng = -105.2759597, google_place_id = $ga$ChIJi5tTDZzua4cRCJGf4ui2isU$ga$, formatted_address = $ga$1310 College Ave, Boulder, CO 80302, USA$ga$ WHERE id = 'f1064c56-9319-4b49-8e54-59c0cebde034'::uuid AND maps_lat IS NULL;

-- [A] f28dc3de-c7d9-4a4f-97ad-7969cc8dbad7 -- Peer through the windows into the working conservation lab at 'Clyfford Still Mu
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('f28dc3de-c7d9-4a4f-97ad-7969cc8dbad7'::uuid, NULL, NULL, $ga$Clyfford Still Museum, Denver, CO$ga$, 39.7363194, -104.9897917, $ga$ChIJrfRCFCt_bIcRXZXnUpY9cu4$ga$, $ga$1250 Bannock St, Denver, CO 80204, USA$ga$, $ga$Clyfford Still Museum, Denver, CO$ga$, 1008, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7363194, maps_lng = -104.9897917, google_place_id = $ga$ChIJrfRCFCt_bIcRXZXnUpY9cu4$ga$, formatted_address = $ga$1250 Bannock St, Denver, CO 80204, USA$ga$ WHERE id = 'f28dc3de-c7d9-4a4f-97ad-7969cc8dbad7'::uuid AND maps_lat IS NULL;

-- [A] f435af68-de4b-4574-8d46-a07294f7641c -- Complete the current Sugar Science tasting and choose a liquid-nitrogen sundae a
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('f435af68-de4b-4574-8d46-a07294f7641c'::uuid, NULL, NULL, $ga$The Inventing Room, 4433 W 29th Ave, Unit 101, Denver, CO 80212$ga$, 39.7586194, -105.0448114, $ga$ChIJyzMnm2-Ha4cRAor8ibF19X4$ga$, $ga$4433 W 29th Ave #101, Denver, CO 80212, USA$ga$, $ga$The Inventing Room, 4433 W 29th Ave, Unit 101, Denver, CO 80212$ga$, 2920, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7586194, maps_lng = -105.0448114, google_place_id = $ga$ChIJyzMnm2-Ha4cRAor8ibF19X4$ga$, formatted_address = $ga$4433 W 29th Ave #101, Denver, CO 80212, USA$ga$ WHERE id = 'f435af68-de4b-4574-8d46-a07294f7641c'::uuid AND maps_lat IS NULL;

-- [A] f7be7ce1-fb50-49c6-aa0c-0cfef0f232c5 -- Order a Scotch egg with a British ale at 'The Burns Pub'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('f7be7ce1-fb50-49c6-aa0c-0cfef0f232c5'::uuid, NULL, NULL, $ga$The Burns Pub, 9009 Metro Airport Ave, Broomfield, CO 80021$ga$, 39.9093842, -105.10014509999999, $ga$ChIJ71YGeb6La4cRtgqnCAqDMVg$ga$, $ga$9009 Metro Airport Ave, Broomfield, CO 80021, USA$ga$, $ga$The Burns Pub, 9009 Metro Airport Ave, Broomfield, CO 80021$ga$, 1692, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.9093842, maps_lng = -105.10014509999999, google_place_id = $ga$ChIJ71YGeb6La4cRtgqnCAqDMVg$ga$, formatted_address = $ga$9009 Metro Airport Ave, Broomfield, CO 80021, USA$ga$ WHERE id = 'f7be7ce1-fb50-49c6-aa0c-0cfef0f232c5'::uuid AND maps_lat IS NULL;

-- [A] fcba198c-f35c-4c44-9af1-73a31971dff2 -- Find the gold doorbell and enter the hidden bar at 'B&GC'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('fcba198c-f35c-4c44-9af1-73a31971dff2'::uuid, NULL, NULL, $ga$B&GC, 249 Columbine St, Denver, CO 80206$ga$, 39.7204737, -104.95758459999999, $ga$ChIJQ5SUcZV_bIcRwF2loEtnDvY$ga$, $ga$249 Columbine St, Denver, CO 80206, USA$ga$, $ga$B&GC, 249 Columbine St, Denver, CO 80206$ga$, 697, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7204737, maps_lng = -104.95758459999999, google_place_id = $ga$ChIJQ5SUcZV_bIcRwF2loEtnDvY$ga$, formatted_address = $ga$249 Columbine St, Denver, CO 80206, USA$ga$ WHERE id = 'fcba198c-f35c-4c44-9af1-73a31971dff2'::uuid AND maps_lat IS NULL;

-- [A] fd951015-7d8c-411e-b8dc-009b3c9ee2ec -- Step from Colorado into the tropics inside the conservatory at 'Denver Botanic G
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('fd951015-7d8c-411e-b8dc-009b3c9ee2ec'::uuid, NULL, NULL, $ga$Denver Botanic Gardens, Denver, CO$ga$, 39.732096399999996, -104.9612839, $ga$ChIJ0T6BO7h-bIcRGm7RHsvfG0A$ga$, $ga$1007 York St, Denver, CO 80206, USA$ga$, $ga$Denver Botanic Gardens, Denver, CO$ga$, 1806, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.732096399999996, maps_lng = -104.9612839, google_place_id = $ga$ChIJ0T6BO7h-bIcRGm7RHsvfG0A$ga$, formatted_address = $ga$1007 York St, Denver, CO 80206, USA$ga$ WHERE id = 'fd951015-7d8c-411e-b8dc-009b3c9ee2ec'::uuid AND maps_lat IS NULL;

-- [A] fde1d318-c462-4c5a-88b8-95ffae4dab86 -- See a performance in the 1881 upstairs hall at 'Dickens Opera House'
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('fde1d318-c462-4c5a-88b8-95ffae4dab86'::uuid, NULL, NULL, $ga$Dickens Opera House, Longmont, CO$ga$, 40.1641933, -105.1021131, $ga$ChIJlYFEp575a4cRY4jmQs0Zq5I$ga$, $ga$302 Main St, Longmont, CO 80501, USA$ga$, $ga$Dickens Opera House, Longmont, CO$ga$, 335, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 40.1641933, maps_lng = -105.1021131, google_place_id = $ga$ChIJlYFEp575a4cRY4jmQs0Zq5I$ga$, formatted_address = $ga$302 Main St, Longmont, CO 80501, USA$ga$ WHERE id = 'fde1d318-c462-4c5a-88b8-95ffae4dab86'::uuid AND maps_lat IS NULL;

-- [A] ff527e9f-a178-45e7-9fcb-33877303ef21 -- Catch two concerts under one roof on a Dual Venue night at 'Cervantes Masterpiec
INSERT INTO public.geo_corrections (item_id, old_maps_lat, old_maps_lng, old_maps_query, new_maps_lat, new_maps_lng, google_place_id, formatted_address, places_api_query, distance_moved_m, match_confidence, corrected_by) VALUES ('ff527e9f-a178-45e7-9fcb-33877303ef21'::uuid, NULL, NULL, $ga$Cervantes' Masterpiece Ballroom, Denver, CO$ga$, 39.7545132, -104.9787432, $ga$ChIJaXL29SN5bIcR3rVUVP5pFyw$ga$, $ga$2637 Welton St, Denver, CO 80205, USA$ga$, $ga$Cervantes' Masterpiece Ballroom, Denver, CO$ga$, 761, $ga$A$ga$, $ga$denver_places_backfill_20260822$ga$);
UPDATE public.items SET maps_lat = 39.7545132, maps_lng = -104.9787432, google_place_id = $ga$ChIJaXL29SN5bIcR3rVUVP5pFyw$ga$, formatted_address = $ga$2637 Welton St, Denver, CO 80205, USA$ga$ WHERE id = 'ff527e9f-a178-45e7-9fcb-33877303ef21'::uuid AND maps_lat IS NULL;

DO $do$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM (
    WITH expected(item_id) AS (
      VALUES
      ('0058d8dc-fdf4-4ab2-88f5-b9b4b85c61c7'::uuid),
      ('010907d9-e545-4439-bf35-0422f3e09758'::uuid),
      ('03f59ab1-32b9-4037-b083-fa1d5bafc526'::uuid),
      ('04bf3f18-8e08-4f09-8671-17f6f3fd65b6'::uuid),
      ('052a0a3b-44e2-423e-8318-b755cc2d2b0d'::uuid),
      ('05655893-cb5d-45f1-8210-b3bb652b884d'::uuid),
      ('08893b11-d552-407a-a407-255625f949db'::uuid),
      ('0c483c15-f425-4750-885f-5461d81f387c'::uuid),
      ('104bbb02-92a3-447a-968f-7cde6e0e137c'::uuid),
      ('12792398-76f2-4a51-aef1-551a284d0d9f'::uuid),
      ('13772396-c850-44b2-a008-465013e49efb'::uuid),
      ('14683011-33a7-4bcb-9508-563548d2ff73'::uuid),
      ('14e1bd19-fad5-44e7-8ec1-9a8088953af3'::uuid),
      ('16f97705-df7b-44dc-8273-dd5a74f8b7de'::uuid),
      ('1915043e-a819-4bd4-8f70-b6d20404ff3e'::uuid),
      ('1a1ea071-5b80-4b48-8081-24a55d2796c0'::uuid),
      ('1a2689a8-2570-4c4a-b6cd-1a858e7fe25c'::uuid),
      ('1cb0161d-464c-4fee-bcb0-3e4e735ac4f0'::uuid),
      ('1d4b68b6-546d-4039-a4fd-f76df7230c1a'::uuid),
      ('1fb94167-c521-43a8-ac26-8cf61b61b306'::uuid),
      ('218678c7-c7f7-40f5-8131-1dcec8ac028b'::uuid),
      ('22230bac-ab00-4e34-ae95-df977d37e800'::uuid),
      ('227d2f0f-fc9d-47c5-a1cd-821818092b33'::uuid),
      ('276561ac-76be-4795-80eb-d9bec1672955'::uuid),
      ('2957baa5-270d-453e-bf0f-54b7e94ddb41'::uuid),
      ('29b6827c-2e59-4b21-9a15-ecbb7188a556'::uuid),
      ('2a3523f7-31a1-4ad5-93db-e276bf1b0ed7'::uuid),
      ('2cd5dab3-ac6b-4730-8d08-dfae0f0ad66f'::uuid),
      ('2e2c2fc5-f13a-44c3-ba83-888c392a0f17'::uuid),
      ('36911e65-55e4-4e9c-a3e4-b1b04fb8c5cc'::uuid),
      ('36c87d34-8c14-4236-b7d9-da32d2e65b06'::uuid),
      ('3bc7e5ce-f628-4ce5-87aa-813130006ed9'::uuid),
      ('3d2d8e9d-876c-49f4-90d1-d13b5f1621e9'::uuid),
      ('3f269beb-e3f6-473e-9c36-ccdea5e3f599'::uuid),
      ('3fc6c1ee-aba0-4f53-b5f0-9e4ac8ac91e3'::uuid),
      ('432d8675-53b1-4a43-9233-53708507831c'::uuid),
      ('43aa56cf-5529-415d-aa0d-9e04f5431315'::uuid),
      ('442ee691-41ef-4a16-aad6-bc757480e9e6'::uuid),
      ('46357f48-049a-4f90-b833-356ec0b2448b'::uuid),
      ('4669e6ea-005e-48bd-a517-71b0e218be7e'::uuid),
      ('476cf174-504c-45c5-b520-233c28a5ac40'::uuid),
      ('4a37a0e9-2d15-46e5-9e41-c3f16cedb850'::uuid),
      ('53f78e06-6997-45a7-8103-92a26d5bc018'::uuid),
      ('58eb6e0b-80f0-4279-9893-59ab8e5453c4'::uuid),
      ('591ab105-f33d-42c5-b474-e6610157bf27'::uuid),
      ('597247fb-f09f-4f80-a2b6-5170643a9d81'::uuid),
      ('5eb9abca-a4d2-455d-8644-28782f3ca3c1'::uuid),
      ('5ecda3c3-e40a-4698-83f5-e25fdfc96cdb'::uuid),
      ('5f9a1622-2267-47a6-b19e-387c7a636df5'::uuid),
      ('60285c1f-87b1-4f6c-8ed4-ac89e467baf4'::uuid),
      ('60834533-2059-4404-8c5c-b804c31d96c2'::uuid),
      ('61750c16-18b7-4f12-b2fd-0807bc8465d6'::uuid),
      ('63bfd734-9dc2-4211-9030-11eee9101d7d'::uuid),
      ('6607f6bb-d9f3-4baa-8951-511c1cf995ea'::uuid),
      ('67ac51f2-072f-4e79-ac0f-35ddb447ad6b'::uuid),
      ('694b9858-dbcf-4e32-aba9-ed2a2bbc9316'::uuid),
      ('70024913-9352-4e78-9588-1f5db9f3556e'::uuid),
      ('70f84234-4de2-471b-8a33-d818834095d5'::uuid),
      ('716ef3a6-5355-4e15-a8ca-6192175eacc6'::uuid),
      ('735a1089-f29d-44df-badf-b5993c7efaa8'::uuid),
      ('754b6bdc-4b87-4c55-8b3f-0b36f3606990'::uuid),
      ('7789de88-3bb0-47d6-bb5d-3504261230d9'::uuid),
      ('78b0b102-d466-4dad-a18d-d8188a96ab5a'::uuid),
      ('7adebb0d-72e4-4906-990e-f242391999bd'::uuid),
      ('7dd7f28f-7228-4097-8f25-7cbaa7bfd614'::uuid),
      ('7de38a1b-e1ef-4e81-8518-b5b799f26758'::uuid),
      ('7f61f150-1e39-493d-bed3-9f39960342a8'::uuid),
      ('822f114b-ec19-4c23-8d09-33e6a1bce703'::uuid),
      ('833193d6-b4b9-42ce-914e-47b8b9ea870e'::uuid),
      ('874902d5-57ac-4256-9b6a-f8ce356164a8'::uuid),
      ('897bab12-c398-405e-a749-a7bec3fe4692'::uuid),
      ('89bab711-c679-4b6e-9145-e7e7ba6d47a3'::uuid),
      ('8bcfe55d-7fb5-41cc-ac00-287c18647b0b'::uuid),
      ('91027c2c-69cf-4ceb-860f-e89e80e45397'::uuid),
      ('91a2093e-1eba-4ec6-badc-74de0a749e15'::uuid),
      ('92df86d6-4831-4410-b9ab-506308eeb25b'::uuid),
      ('93c0e099-29eb-4db4-abaa-7cb9d1a67dca'::uuid),
      ('949c8de8-73a9-4bde-b3a9-4d2205a947e2'::uuid),
      ('94a1ce73-8138-4a63-8a50-78651fbbf557'::uuid),
      ('97f5eea0-84a3-42aa-a433-94b3f2d41d87'::uuid),
      ('9ac42676-1628-428c-a707-d33344524079'::uuid),
      ('9e443f77-e115-4347-b0ff-21f33e55577c'::uuid),
      ('a031abde-3a7b-46d7-9758-eaaff0518e9f'::uuid),
      ('a549b8e3-ecc7-429b-9715-af6cc821f6ac'::uuid),
      ('a7df3180-7372-4c85-b701-2429e500edeb'::uuid),
      ('a9ad1cca-9d0f-432f-b311-61707d4124ec'::uuid),
      ('ad002e2b-fdb2-4ecf-b59b-680810c4f0b4'::uuid),
      ('aee81f04-b581-47aa-923d-cc2879a46b13'::uuid),
      ('afc95660-f347-4e21-b697-8b987fb4db1d'::uuid),
      ('aff3d648-9fc2-4801-8546-8b15ed14e2f0'::uuid),
      ('b05c509c-9b4d-43aa-ba19-aae8a9c0b10e'::uuid),
      ('b2e1e100-f9c6-4ca0-bd1a-1c1ff57c8460'::uuid),
      ('b498d6f0-ab22-4849-9c84-1a8c4267d245'::uuid),
      ('b50f6e4f-b33c-4b16-8450-d9cfe95427f8'::uuid),
      ('b6416d2e-f771-437d-b9f9-8007600c0681'::uuid),
      ('b9630340-4798-4904-8523-1c684ac6cb09'::uuid),
      ('bab4b62a-72e5-4578-a662-de0263f1e2a2'::uuid),
      ('bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b'::uuid),
      ('bd0fd163-2833-4e23-8bb4-6c9b84cde657'::uuid),
      ('c4280d06-7aa1-4382-a4ec-1231fc6939e3'::uuid),
      ('c674befd-40d5-4d27-bb1a-81c445423cad'::uuid),
      ('c7a07f61-4288-4596-8c09-05ea5d3e4a46'::uuid),
      ('c83d85bd-3f44-48dc-9ac8-042f4946eb11'::uuid),
      ('c9cf5edc-82db-49d6-80a9-2cfb13b82945'::uuid),
      ('c9d51017-0e7a-4347-89fe-3f377a46b748'::uuid),
      ('c9ffca28-5a4f-4f6f-8cd7-9cbe08b8b489'::uuid),
      ('cc79459f-33bf-4f9b-81bd-fadb0a8022f4'::uuid),
      ('cde0d025-dcd6-4fff-ae8a-dc3ddc3a10d9'::uuid),
      ('cf7ce51f-f03f-4631-a7c9-4669afc9f20f'::uuid),
      ('d0b5a03d-cf1e-42ae-bca7-99e67902cdc9'::uuid),
      ('d0f49958-63d3-495f-84b2-6343d52ee762'::uuid),
      ('d1e1d2aa-7f1f-433f-9a0f-3a460ad50063'::uuid),
      ('d225235d-5650-4376-8d4b-d16d946baf95'::uuid),
      ('d228dd53-81ce-4cea-98e1-893498c1a933'::uuid),
      ('d3e9f7cc-73ff-4148-913b-99c78817d409'::uuid),
      ('d463f0a3-2520-4d58-b9c4-3d334b3ab5e9'::uuid),
      ('d5a60c98-2e53-49ef-aafa-4516f37f157d'::uuid),
      ('d6d0e4fe-55d3-49b1-bf4c-a545889c9069'::uuid),
      ('d7687915-0750-4ea1-a57a-876a969173d8'::uuid),
      ('d8f8912d-915b-4814-982b-c5fcb2c5a014'::uuid),
      ('db4f7371-6647-4df0-b3d5-aaee0eae67db'::uuid),
      ('dc1cdc75-add7-41f9-9513-84793386de17'::uuid),
      ('dcedc561-9f46-4083-8b9a-4b81ccd8ede4'::uuid),
      ('dd20c7d4-0a92-46ad-9531-a4977cc7dea9'::uuid),
      ('dd31c3a5-ed03-4fe0-9c9b-f64f0a8d7da6'::uuid),
      ('ddd8b9cd-85ed-4c33-8865-8bc2a8ee7f49'::uuid),
      ('de1208e6-fcb6-4f15-a430-449fc9ca2da1'::uuid),
      ('de219490-ef35-4746-9132-5a5e1fef70d5'::uuid),
      ('dff1afbb-9684-4ba0-baf3-bdd00ef57fbd'::uuid),
      ('e0b82e7f-c02d-458a-907e-55898f99bd85'::uuid),
      ('e1f92e2e-66b6-4254-b6dc-34bdcee540f6'::uuid),
      ('e337d21e-fab6-4edf-a6ed-60bcd94b9768'::uuid),
      ('e57c8b9c-e790-4def-8091-c5dea8be8fea'::uuid),
      ('e85fae74-a640-4288-961f-116f82b1a067'::uuid),
      ('e91add97-243c-456c-8bee-5150c43a0ba8'::uuid),
      ('e98a6e40-5a39-4c74-a0e3-9069afcd8e23'::uuid),
      ('eaa9fcfc-1a79-4918-b20e-3441171a9bf3'::uuid),
      ('ecdbdf5e-94fa-41f3-a47c-a5378cb8e527'::uuid),
      ('f1064c56-9319-4b49-8e54-59c0cebde034'::uuid),
      ('f28dc3de-c7d9-4a4f-97ad-7969cc8dbad7'::uuid),
      ('f435af68-de4b-4574-8d46-a07294f7641c'::uuid),
      ('f7be7ce1-fb50-49c6-aa0c-0cfef0f232c5'::uuid),
      ('fcba198c-f35c-4c44-9af1-73a31971dff2'::uuid),
      ('fd951015-7d8c-411e-b8dc-009b3c9ee2ec'::uuid),
      ('fde1d318-c462-4c5a-88b8-95ffae4dab86'::uuid),
      ('ff527e9f-a178-45e7-9fcb-33877303ef21'::uuid)
    )
    SELECT e.item_id
    FROM expected e
    JOIN public.items i ON i.id = e.item_id
    WHERE i.maps_lat IS NULL
  ) AS still_null;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Postflight check failed: % item(s) still have NULL maps_lat -- an UPDATE silently did not apply', v_count;
  END IF;
END
$do$;

-- Review before COMMIT
WITH expected(item_id) AS (
  VALUES
      ('0058d8dc-fdf4-4ab2-88f5-b9b4b85c61c7'::uuid),
      ('010907d9-e545-4439-bf35-0422f3e09758'::uuid),
      ('03f59ab1-32b9-4037-b083-fa1d5bafc526'::uuid),
      ('04bf3f18-8e08-4f09-8671-17f6f3fd65b6'::uuid),
      ('052a0a3b-44e2-423e-8318-b755cc2d2b0d'::uuid),
      ('05655893-cb5d-45f1-8210-b3bb652b884d'::uuid),
      ('08893b11-d552-407a-a407-255625f949db'::uuid),
      ('0c483c15-f425-4750-885f-5461d81f387c'::uuid),
      ('104bbb02-92a3-447a-968f-7cde6e0e137c'::uuid),
      ('12792398-76f2-4a51-aef1-551a284d0d9f'::uuid),
      ('13772396-c850-44b2-a008-465013e49efb'::uuid),
      ('14683011-33a7-4bcb-9508-563548d2ff73'::uuid),
      ('14e1bd19-fad5-44e7-8ec1-9a8088953af3'::uuid),
      ('16f97705-df7b-44dc-8273-dd5a74f8b7de'::uuid),
      ('1915043e-a819-4bd4-8f70-b6d20404ff3e'::uuid),
      ('1a1ea071-5b80-4b48-8081-24a55d2796c0'::uuid),
      ('1a2689a8-2570-4c4a-b6cd-1a858e7fe25c'::uuid),
      ('1cb0161d-464c-4fee-bcb0-3e4e735ac4f0'::uuid),
      ('1d4b68b6-546d-4039-a4fd-f76df7230c1a'::uuid),
      ('1fb94167-c521-43a8-ac26-8cf61b61b306'::uuid),
      ('218678c7-c7f7-40f5-8131-1dcec8ac028b'::uuid),
      ('22230bac-ab00-4e34-ae95-df977d37e800'::uuid),
      ('227d2f0f-fc9d-47c5-a1cd-821818092b33'::uuid),
      ('276561ac-76be-4795-80eb-d9bec1672955'::uuid),
      ('2957baa5-270d-453e-bf0f-54b7e94ddb41'::uuid),
      ('29b6827c-2e59-4b21-9a15-ecbb7188a556'::uuid),
      ('2a3523f7-31a1-4ad5-93db-e276bf1b0ed7'::uuid),
      ('2cd5dab3-ac6b-4730-8d08-dfae0f0ad66f'::uuid),
      ('2e2c2fc5-f13a-44c3-ba83-888c392a0f17'::uuid),
      ('36911e65-55e4-4e9c-a3e4-b1b04fb8c5cc'::uuid),
      ('36c87d34-8c14-4236-b7d9-da32d2e65b06'::uuid),
      ('3bc7e5ce-f628-4ce5-87aa-813130006ed9'::uuid),
      ('3d2d8e9d-876c-49f4-90d1-d13b5f1621e9'::uuid),
      ('3f269beb-e3f6-473e-9c36-ccdea5e3f599'::uuid),
      ('3fc6c1ee-aba0-4f53-b5f0-9e4ac8ac91e3'::uuid),
      ('432d8675-53b1-4a43-9233-53708507831c'::uuid),
      ('43aa56cf-5529-415d-aa0d-9e04f5431315'::uuid),
      ('442ee691-41ef-4a16-aad6-bc757480e9e6'::uuid),
      ('46357f48-049a-4f90-b833-356ec0b2448b'::uuid),
      ('4669e6ea-005e-48bd-a517-71b0e218be7e'::uuid),
      ('476cf174-504c-45c5-b520-233c28a5ac40'::uuid),
      ('4a37a0e9-2d15-46e5-9e41-c3f16cedb850'::uuid),
      ('53f78e06-6997-45a7-8103-92a26d5bc018'::uuid),
      ('58eb6e0b-80f0-4279-9893-59ab8e5453c4'::uuid),
      ('591ab105-f33d-42c5-b474-e6610157bf27'::uuid),
      ('597247fb-f09f-4f80-a2b6-5170643a9d81'::uuid),
      ('5eb9abca-a4d2-455d-8644-28782f3ca3c1'::uuid),
      ('5ecda3c3-e40a-4698-83f5-e25fdfc96cdb'::uuid),
      ('5f9a1622-2267-47a6-b19e-387c7a636df5'::uuid),
      ('60285c1f-87b1-4f6c-8ed4-ac89e467baf4'::uuid),
      ('60834533-2059-4404-8c5c-b804c31d96c2'::uuid),
      ('61750c16-18b7-4f12-b2fd-0807bc8465d6'::uuid),
      ('63bfd734-9dc2-4211-9030-11eee9101d7d'::uuid),
      ('6607f6bb-d9f3-4baa-8951-511c1cf995ea'::uuid),
      ('67ac51f2-072f-4e79-ac0f-35ddb447ad6b'::uuid),
      ('694b9858-dbcf-4e32-aba9-ed2a2bbc9316'::uuid),
      ('70024913-9352-4e78-9588-1f5db9f3556e'::uuid),
      ('70f84234-4de2-471b-8a33-d818834095d5'::uuid),
      ('716ef3a6-5355-4e15-a8ca-6192175eacc6'::uuid),
      ('735a1089-f29d-44df-badf-b5993c7efaa8'::uuid),
      ('754b6bdc-4b87-4c55-8b3f-0b36f3606990'::uuid),
      ('7789de88-3bb0-47d6-bb5d-3504261230d9'::uuid),
      ('78b0b102-d466-4dad-a18d-d8188a96ab5a'::uuid),
      ('7adebb0d-72e4-4906-990e-f242391999bd'::uuid),
      ('7dd7f28f-7228-4097-8f25-7cbaa7bfd614'::uuid),
      ('7de38a1b-e1ef-4e81-8518-b5b799f26758'::uuid),
      ('7f61f150-1e39-493d-bed3-9f39960342a8'::uuid),
      ('822f114b-ec19-4c23-8d09-33e6a1bce703'::uuid),
      ('833193d6-b4b9-42ce-914e-47b8b9ea870e'::uuid),
      ('874902d5-57ac-4256-9b6a-f8ce356164a8'::uuid),
      ('897bab12-c398-405e-a749-a7bec3fe4692'::uuid),
      ('89bab711-c679-4b6e-9145-e7e7ba6d47a3'::uuid),
      ('8bcfe55d-7fb5-41cc-ac00-287c18647b0b'::uuid),
      ('91027c2c-69cf-4ceb-860f-e89e80e45397'::uuid),
      ('91a2093e-1eba-4ec6-badc-74de0a749e15'::uuid),
      ('92df86d6-4831-4410-b9ab-506308eeb25b'::uuid),
      ('93c0e099-29eb-4db4-abaa-7cb9d1a67dca'::uuid),
      ('949c8de8-73a9-4bde-b3a9-4d2205a947e2'::uuid),
      ('94a1ce73-8138-4a63-8a50-78651fbbf557'::uuid),
      ('97f5eea0-84a3-42aa-a433-94b3f2d41d87'::uuid),
      ('9ac42676-1628-428c-a707-d33344524079'::uuid),
      ('9e443f77-e115-4347-b0ff-21f33e55577c'::uuid),
      ('a031abde-3a7b-46d7-9758-eaaff0518e9f'::uuid),
      ('a549b8e3-ecc7-429b-9715-af6cc821f6ac'::uuid),
      ('a7df3180-7372-4c85-b701-2429e500edeb'::uuid),
      ('a9ad1cca-9d0f-432f-b311-61707d4124ec'::uuid),
      ('ad002e2b-fdb2-4ecf-b59b-680810c4f0b4'::uuid),
      ('aee81f04-b581-47aa-923d-cc2879a46b13'::uuid),
      ('afc95660-f347-4e21-b697-8b987fb4db1d'::uuid),
      ('aff3d648-9fc2-4801-8546-8b15ed14e2f0'::uuid),
      ('b05c509c-9b4d-43aa-ba19-aae8a9c0b10e'::uuid),
      ('b2e1e100-f9c6-4ca0-bd1a-1c1ff57c8460'::uuid),
      ('b498d6f0-ab22-4849-9c84-1a8c4267d245'::uuid),
      ('b50f6e4f-b33c-4b16-8450-d9cfe95427f8'::uuid),
      ('b6416d2e-f771-437d-b9f9-8007600c0681'::uuid),
      ('b9630340-4798-4904-8523-1c684ac6cb09'::uuid),
      ('bab4b62a-72e5-4578-a662-de0263f1e2a2'::uuid),
      ('bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b'::uuid),
      ('bd0fd163-2833-4e23-8bb4-6c9b84cde657'::uuid),
      ('c4280d06-7aa1-4382-a4ec-1231fc6939e3'::uuid),
      ('c674befd-40d5-4d27-bb1a-81c445423cad'::uuid),
      ('c7a07f61-4288-4596-8c09-05ea5d3e4a46'::uuid),
      ('c83d85bd-3f44-48dc-9ac8-042f4946eb11'::uuid),
      ('c9cf5edc-82db-49d6-80a9-2cfb13b82945'::uuid),
      ('c9d51017-0e7a-4347-89fe-3f377a46b748'::uuid),
      ('c9ffca28-5a4f-4f6f-8cd7-9cbe08b8b489'::uuid),
      ('cc79459f-33bf-4f9b-81bd-fadb0a8022f4'::uuid),
      ('cde0d025-dcd6-4fff-ae8a-dc3ddc3a10d9'::uuid),
      ('cf7ce51f-f03f-4631-a7c9-4669afc9f20f'::uuid),
      ('d0b5a03d-cf1e-42ae-bca7-99e67902cdc9'::uuid),
      ('d0f49958-63d3-495f-84b2-6343d52ee762'::uuid),
      ('d1e1d2aa-7f1f-433f-9a0f-3a460ad50063'::uuid),
      ('d225235d-5650-4376-8d4b-d16d946baf95'::uuid),
      ('d228dd53-81ce-4cea-98e1-893498c1a933'::uuid),
      ('d3e9f7cc-73ff-4148-913b-99c78817d409'::uuid),
      ('d463f0a3-2520-4d58-b9c4-3d334b3ab5e9'::uuid),
      ('d5a60c98-2e53-49ef-aafa-4516f37f157d'::uuid),
      ('d6d0e4fe-55d3-49b1-bf4c-a545889c9069'::uuid),
      ('d7687915-0750-4ea1-a57a-876a969173d8'::uuid),
      ('d8f8912d-915b-4814-982b-c5fcb2c5a014'::uuid),
      ('db4f7371-6647-4df0-b3d5-aaee0eae67db'::uuid),
      ('dc1cdc75-add7-41f9-9513-84793386de17'::uuid),
      ('dcedc561-9f46-4083-8b9a-4b81ccd8ede4'::uuid),
      ('dd20c7d4-0a92-46ad-9531-a4977cc7dea9'::uuid),
      ('dd31c3a5-ed03-4fe0-9c9b-f64f0a8d7da6'::uuid),
      ('ddd8b9cd-85ed-4c33-8865-8bc2a8ee7f49'::uuid),
      ('de1208e6-fcb6-4f15-a430-449fc9ca2da1'::uuid),
      ('de219490-ef35-4746-9132-5a5e1fef70d5'::uuid),
      ('dff1afbb-9684-4ba0-baf3-bdd00ef57fbd'::uuid),
      ('e0b82e7f-c02d-458a-907e-55898f99bd85'::uuid),
      ('e1f92e2e-66b6-4254-b6dc-34bdcee540f6'::uuid),
      ('e337d21e-fab6-4edf-a6ed-60bcd94b9768'::uuid),
      ('e57c8b9c-e790-4def-8091-c5dea8be8fea'::uuid),
      ('e85fae74-a640-4288-961f-116f82b1a067'::uuid),
      ('e91add97-243c-456c-8bee-5150c43a0ba8'::uuid),
      ('e98a6e40-5a39-4c74-a0e3-9069afcd8e23'::uuid),
      ('eaa9fcfc-1a79-4918-b20e-3441171a9bf3'::uuid),
      ('ecdbdf5e-94fa-41f3-a47c-a5378cb8e527'::uuid),
      ('f1064c56-9319-4b49-8e54-59c0cebde034'::uuid),
      ('f28dc3de-c7d9-4a4f-97ad-7969cc8dbad7'::uuid),
      ('f435af68-de4b-4574-8d46-a07294f7641c'::uuid),
      ('f7be7ce1-fb50-49c6-aa0c-0cfef0f232c5'::uuid),
      ('fcba198c-f35c-4c44-9af1-73a31971dff2'::uuid),
      ('fd951015-7d8c-411e-b8dc-009b3c9ee2ec'::uuid),
      ('fde1d318-c462-4c5a-88b8-95ffae4dab86'::uuid),
      ('ff527e9f-a178-45e7-9fcb-33877303ef21'::uuid)
)
SELECT e.item_id, i.body, i.maps_lat, i.maps_lng, i.google_place_id, i.formatted_address
FROM expected e
JOIN public.items i ON i.id = e.item_id
ORDER BY e.item_id;

COMMIT;
