-- Denver launch list-membership backfill
-- Generated 2026-08-22 from Denver_List_Curation_Manifest_v0.1.xlsx (already
-- reviewed and approved). Populates membership for one official seasonal list
-- and three curated list shells, all currently empty. Does NOT activate anything
-- -- metro_areas.is_active and all three curated shells' is_active stay exactly
-- as they are today (false); per the manifest's Dashboard sheet, activation is a
-- separate, later step after art/SQL QA/device QA pass.
--
-- Schema verified against the live linked DB before writing this file:
--   - Official list shells live in public.lists (title text, starts_at/ends_at
--     date, is_official/is_public boolean, metro_id uuid). No is_active column
--     exists on this table at all -- the prompt's Step 3 hedge about leaving
--     is_active alone is moot; nothing on this table is being activated/
--     deactivated by this file, only title/starts_at/ends_at are set.
--   - public.list_items: id, list_id, item_id, sort_order, plus point_multiplier/
--     is_bonus_drop/unlock_threshold/city_slug/added_by/created_at. Confirmed
--     UNIQUE(list_id, item_id) -- no unique constraint on (list_id, sort_order).
--     id defaults to gen_random_uuid(), left to its default below.
--   - Curated list shells live in public.curated_lists, confirmed is_active=false
--     for all three ids today, titles already set ("Hoptimists · Denver", etc.)
--     -- not touched by this file.
--   - public.curated_list_items: the FK column is curated_list_id, NOT list_id
--     (the prompt correctly flagged this as unconfirmed -- confirmed now).
--     Columns: id, curated_list_id, item_id, display_order, point_multiplier,
--     city_slug. Confirmed UNIQUE(curated_list_id, item_id). id defaults to
--     gen_random_uuid().
--   - All 60 distinct item ids referenced below (66 row-references across the 4
--     lists, minus the 5 duplicate row-appearances from the intentional overlap
--     noted in the source prompt -- Chautauqua Park appears 3x, four others 2x
--     each) exist in public.items with is_active = true. The prompt's own header
--     said "66 distinct item IDs"; the literal count of distinct ids is 60, not
--     66 -- noted here rather than silently reconciled, same as the row count
--     itself (66) which IS correct as the total membership-row count across all
--     four lists.
--   - Confirmed zero pre-existing rows in list_items for the official list id and
--     in curated_list_items for all three curated list ids -- this is a genuine
--     from-zero population, not an upsert. No ON CONFLICT needed anywhere below.
--
-- 5 items intentionally appear on more than one list (by design, not a dedup bug
-- -- see the source prompt's own note): Chautauqua Park (Fall 15, Trail Mix Crew,
-- Pearl Street Regulars), Boulder Dushanbe Teahouse (Fall 15, Pearl Street
-- Regulars), Romero's K9 Club (Fall 15, Hoptimists), The Dragontree (Fall 15,
-- Pearl Street Regulars), Avery Brewing Company (Hoptimists, Pearl Street
-- Regulars). Each gets one row per list/table it belongs to.

BEGIN;

DO $do$
BEGIN
  -- 1. All 4 list-shell ids exist
  IF NOT EXISTS (SELECT 1 FROM public.lists WHERE id = '178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid) THEN
    RAISE EXCEPTION 'Official Fall 2026 list shell (178ecd7c-...) not found';
  END IF;
  IF (SELECT count(*) FROM public.curated_lists WHERE id IN (
    '4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, '2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid
  )) <> 3 THEN
    RAISE EXCEPTION 'One or more of the 3 curated list shells (Hoptimists/Trail Mix Crew/Pearl Street Regulars) not found';
  END IF;

  -- 2. No pre-existing membership rows for these 4 lists (from-zero population)
  IF EXISTS (SELECT 1 FROM public.list_items WHERE list_id = '178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid) THEN
    RAISE EXCEPTION 'list_items already has rows for the official Fall 2026 list -- stop, this is meant to be a from-zero population';
  END IF;
  IF EXISTS (SELECT 1 FROM public.curated_list_items WHERE curated_list_id IN (
    '4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, '2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid
  )) THEN
    RAISE EXCEPTION 'curated_list_items already has rows for one or more of the 3 curated lists -- stop, this is meant to be a from-zero population';
  END IF;

  -- 3. All 60 distinct item ids exist and are is_active = true
  IF EXISTS (
    WITH expected(item_id) AS (
      VALUES
      ('03f59ab1-32b9-4037-b083-fa1d5bafc526'::uuid),
  ('052a0a3b-44e2-423e-8318-b755cc2d2b0d'::uuid),
  ('08893b11-d552-407a-a407-255625f949db'::uuid),
  ('0c483c15-f425-4750-885f-5461d81f387c'::uuid),
  ('104bbb02-92a3-447a-968f-7cde6e0e137c'::uuid),
  ('14683011-33a7-4bcb-9508-563548d2ff73'::uuid),
  ('1a2689a8-2570-4c4a-b6cd-1a858e7fe25c'::uuid),
  ('218678c7-c7f7-40f5-8131-1dcec8ac028b'::uuid),
  ('22230bac-ab00-4e34-ae95-df977d37e800'::uuid),
  ('227d2f0f-fc9d-47c5-a1cd-821818092b33'::uuid),
  ('2957baa5-270d-453e-bf0f-54b7e94ddb41'::uuid),
  ('29b6827c-2e59-4b21-9a15-ecbb7188a556'::uuid),
  ('2a3523f7-31a1-4ad5-93db-e276bf1b0ed7'::uuid),
  ('2cd5dab3-ac6b-4730-8d08-dfae0f0ad66f'::uuid),
  ('36c87d34-8c14-4236-b7d9-da32d2e65b06'::uuid),
  ('3fc6c1ee-aba0-4f53-b5f0-9e4ac8ac91e3'::uuid),
  ('442ee691-41ef-4a16-aad6-bc757480e9e6'::uuid),
  ('4a37a0e9-2d15-46e5-9e41-c3f16cedb850'::uuid),
  ('53f78e06-6997-45a7-8103-92a26d5bc018'::uuid),
  ('591ab105-f33d-42c5-b474-e6610157bf27'::uuid),
  ('5ecda3c3-e40a-4698-83f5-e25fdfc96cdb'::uuid),
  ('60834533-2059-4404-8c5c-b804c31d96c2'::uuid),
  ('63bfd734-9dc2-4211-9030-11eee9101d7d'::uuid),
  ('6607f6bb-d9f3-4baa-8951-511c1cf995ea'::uuid),
  ('70f84234-4de2-471b-8a33-d818834095d5'::uuid),
  ('754b6bdc-4b87-4c55-8b3f-0b36f3606990'::uuid),
  ('7adebb0d-72e4-4906-990e-f242391999bd'::uuid),
  ('7f61f150-1e39-493d-bed3-9f39960342a8'::uuid),
  ('89bab711-c679-4b6e-9145-e7e7ba6d47a3'::uuid),
  ('8bcfe55d-7fb5-41cc-ac00-287c18647b0b'::uuid),
  ('91027c2c-69cf-4ceb-860f-e89e80e45397'::uuid),
  ('91a2093e-1eba-4ec6-badc-74de0a749e15'::uuid),
  ('949c8de8-73a9-4bde-b3a9-4d2205a947e2'::uuid),
  ('9ac42676-1628-428c-a707-d33344524079'::uuid),
  ('a9ad1cca-9d0f-432f-b311-61707d4124ec'::uuid),
  ('aee81f04-b581-47aa-923d-cc2879a46b13'::uuid),
  ('aff3d648-9fc2-4801-8546-8b15ed14e2f0'::uuid),
  ('b6416d2e-f771-437d-b9f9-8007600c0681'::uuid),
  ('b9630340-4798-4904-8523-1c684ac6cb09'::uuid),
  ('bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b'::uuid),
  ('c674befd-40d5-4d27-bb1a-81c445423cad'::uuid),
  ('c9ffca28-5a4f-4f6f-8cd7-9cbe08b8b489'::uuid),
  ('cde0d025-dcd6-4fff-ae8a-dc3ddc3a10d9'::uuid),
  ('d0f49958-63d3-495f-84b2-6343d52ee762'::uuid),
  ('d225235d-5650-4376-8d4b-d16d946baf95'::uuid),
  ('d228dd53-81ce-4cea-98e1-893498c1a933'::uuid),
  ('d3e9f7cc-73ff-4148-913b-99c78817d409'::uuid),
  ('d463f0a3-2520-4d58-b9c4-3d334b3ab5e9'::uuid),
  ('d5a60c98-2e53-49ef-aafa-4516f37f157d'::uuid),
  ('d7687915-0750-4ea1-a57a-876a969173d8'::uuid),
  ('dc1cdc75-add7-41f9-9513-84793386de17'::uuid),
  ('dcedc561-9f46-4083-8b9a-4b81ccd8ede4'::uuid),
  ('dd20c7d4-0a92-46ad-9531-a4977cc7dea9'::uuid),
  ('ddd8b9cd-85ed-4c33-8865-8bc2a8ee7f49'::uuid),
  ('dff1afbb-9684-4ba0-baf3-bdd00ef57fbd'::uuid),
  ('e0b82e7f-c02d-458a-907e-55898f99bd85'::uuid),
  ('e337d21e-fab6-4edf-a6ed-60bcd94b9768'::uuid),
  ('e85fae74-a640-4288-961f-116f82b1a067'::uuid),
  ('f1064c56-9319-4b49-8e54-59c0cebde034'::uuid),
  ('f7be7ce1-fb50-49c6-aa0c-0cfef0f232c5'::uuid)
    )
    SELECT 1
    FROM expected e
    LEFT JOIN public.items i ON i.id = e.item_id
    WHERE i.id IS NULL OR i.is_active IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'One or more of the 60 referenced items are missing or inactive -- stop and reconcile before writing membership';
  END IF;
END
$do$;

-- Step 3: official Fall 2026 list shell metadata
UPDATE public.lists SET
    title = $lm$Denver Fall 2026$lm$,
    starts_at = '2026-09-06'::date,
    ends_at = '2026-11-30'::date
  WHERE id = '178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid;

-- Step 4: Fall 2026 official list membership (15 rows)
INSERT INTO public.list_items (list_id, item_id, sort_order) VALUES
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, '7adebb0d-72e4-4906-990e-f242391999bd'::uuid, 0),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, 'e337d21e-fab6-4edf-a6ed-60bcd94b9768'::uuid, 1),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, '4a37a0e9-2d15-46e5-9e41-c3f16cedb850'::uuid, 2),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, '03f59ab1-32b9-4037-b083-fa1d5bafc526'::uuid, 3),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, '89bab711-c679-4b6e-9145-e7e7ba6d47a3'::uuid, 4),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, '9ac42676-1628-428c-a707-d33344524079'::uuid, 5),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, '442ee691-41ef-4a16-aad6-bc757480e9e6'::uuid, 6),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, '60834533-2059-4404-8c5c-b804c31d96c2'::uuid, 7),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, 'd7687915-0750-4ea1-a57a-876a969173d8'::uuid, 8),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, '53f78e06-6997-45a7-8103-92a26d5bc018'::uuid, 9),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, '6607f6bb-d9f3-4baa-8951-511c1cf995ea'::uuid, 10),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, 'cde0d025-dcd6-4fff-ae8a-dc3ddc3a10d9'::uuid, 11),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, 'd228dd53-81ce-4cea-98e1-893498c1a933'::uuid, 12),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, '14683011-33a7-4bcb-9508-563548d2ff73'::uuid, 13),
  ('178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid, '227d2f0f-fc9d-47c5-a1cd-821818092b33'::uuid, 14);

-- Step 5: Hoptimists curated membership (18 rows)
INSERT INTO public.curated_list_items (curated_list_id, item_id, display_order) VALUES
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '949c8de8-73a9-4bde-b3a9-4d2205a947e2'::uuid, 0),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, 'aff3d648-9fc2-4801-8546-8b15ed14e2f0'::uuid, 1),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, 'dcedc561-9f46-4083-8b9a-4b81ccd8ede4'::uuid, 2),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, 'f7be7ce1-fb50-49c6-aa0c-0cfef0f232c5'::uuid, 3),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '3fc6c1ee-aba0-4f53-b5f0-9e4ac8ac91e3'::uuid, 4),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, 'd5a60c98-2e53-49ef-aafa-4516f37f157d'::uuid, 5),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '53f78e06-6997-45a7-8103-92a26d5bc018'::uuid, 6),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, 'ddd8b9cd-85ed-4c33-8865-8bc2a8ee7f49'::uuid, 7),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, 'b9630340-4798-4904-8523-1c684ac6cb09'::uuid, 8),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '754b6bdc-4b87-4c55-8b3f-0b36f3606990'::uuid, 9),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '8bcfe55d-7fb5-41cc-ac00-287c18647b0b'::uuid, 10),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '91027c2c-69cf-4ceb-860f-e89e80e45397'::uuid, 11),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '91a2093e-1eba-4ec6-badc-74de0a749e15'::uuid, 12),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, 'bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b'::uuid, 13),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, 'e0b82e7f-c02d-458a-907e-55898f99bd85'::uuid, 14),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '052a0a3b-44e2-423e-8318-b755cc2d2b0d'::uuid, 15),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '2a3523f7-31a1-4ad5-93db-e276bf1b0ed7'::uuid, 16),
  ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '1a2689a8-2570-4c4a-b6cd-1a858e7fe25c'::uuid, 17);

-- Step 6: Trail Mix Crew curated membership (18 rows)
INSERT INTO public.curated_list_items (curated_list_id, item_id, display_order) VALUES
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, '22230bac-ab00-4e34-ae95-df977d37e800'::uuid, 0),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, '5ecda3c3-e40a-4698-83f5-e25fdfc96cdb'::uuid, 1),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, '70f84234-4de2-471b-8a33-d818834095d5'::uuid, 2),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, '7adebb0d-72e4-4906-990e-f242391999bd'::uuid, 3),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, '7f61f150-1e39-493d-bed3-9f39960342a8'::uuid, 4),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, '0c483c15-f425-4750-885f-5461d81f387c'::uuid, 5),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, 'a9ad1cca-9d0f-432f-b311-61707d4124ec'::uuid, 6),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, 'dff1afbb-9684-4ba0-baf3-bdd00ef57fbd'::uuid, 7),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, 'e85fae74-a640-4288-961f-116f82b1a067'::uuid, 8),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, 'b6416d2e-f771-437d-b9f9-8007600c0681'::uuid, 9),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, 'aee81f04-b581-47aa-923d-cc2879a46b13'::uuid, 10),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, 'd0f49958-63d3-495f-84b2-6343d52ee762'::uuid, 11),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, '591ab105-f33d-42c5-b474-e6610157bf27'::uuid, 12),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, '29b6827c-2e59-4b21-9a15-ecbb7188a556'::uuid, 13),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, 'c9ffca28-5a4f-4f6f-8cd7-9cbe08b8b489'::uuid, 14),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, 'd3e9f7cc-73ff-4148-913b-99c78817d409'::uuid, 15),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, 'd463f0a3-2520-4d58-b9c4-3d334b3ab5e9'::uuid, 16),
  ('479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, '2957baa5-270d-453e-bf0f-54b7e94ddb41'::uuid, 17);

-- Step 7: Pearl Street Regulars curated membership (15 rows)
INSERT INTO public.curated_list_items (curated_list_id, item_id, display_order) VALUES
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, '104bbb02-92a3-447a-968f-7cde6e0e137c'::uuid, 0),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, '08893b11-d552-407a-a407-255625f949db'::uuid, 1),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, '218678c7-c7f7-40f5-8131-1dcec8ac028b'::uuid, 2),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, '2cd5dab3-ac6b-4730-8d08-dfae0f0ad66f'::uuid, 3),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, '36c87d34-8c14-4236-b7d9-da32d2e65b06'::uuid, 4),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, '63bfd734-9dc2-4211-9030-11eee9101d7d'::uuid, 5),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, '7adebb0d-72e4-4906-990e-f242391999bd'::uuid, 6),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, 'c674befd-40d5-4d27-bb1a-81c445423cad'::uuid, 7),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, 'd225235d-5650-4376-8d4b-d16d946baf95'::uuid, 8),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, 'd228dd53-81ce-4cea-98e1-893498c1a933'::uuid, 9),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, 'd7687915-0750-4ea1-a57a-876a969173d8'::uuid, 10),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, 'dc1cdc75-add7-41f9-9513-84793386de17'::uuid, 11),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, 'dcedc561-9f46-4083-8b9a-4b81ccd8ede4'::uuid, 12),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, 'dd20c7d4-0a92-46ad-9531-a4977cc7dea9'::uuid, 13),
  ('2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid, 'f1064c56-9319-4b49-8e54-59c0cebde034'::uuid, 14);

DO $do$
DECLARE
  v_fall_count int;
  v_fall_gap_or_dup int;
  v_hop_count int;
  v_hop_gap_or_dup int;
  v_tmc_count int;
  v_tmc_gap_or_dup int;
  v_psr_count int;
  v_psr_gap_or_dup int;
  v_title text;
  v_starts date;
  v_ends date;
BEGIN
  SELECT count(*) INTO v_fall_count FROM public.list_items WHERE list_id = '178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid;
  IF v_fall_count <> 15 THEN
    RAISE EXCEPTION 'Postflight: expected 15 rows in list_items for the Fall list, found %', v_fall_count;
  END IF;
  SELECT count(*) INTO v_fall_gap_or_dup FROM (SELECT sort_order, count(*) FROM public.list_items WHERE list_id = '178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid GROUP BY sort_order HAVING count(*) <> 1) dup;
  IF v_fall_gap_or_dup <> 0 THEN
    RAISE EXCEPTION 'Postflight: Fall list has duplicate sort_order values';
  END IF;
  SELECT count(*) INTO v_fall_gap_or_dup FROM generate_series(0,14) s WHERE NOT EXISTS (SELECT 1 FROM public.list_items WHERE list_id = '178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid AND sort_order = s);
  IF v_fall_gap_or_dup <> 0 THEN
    RAISE EXCEPTION 'Postflight: Fall list sort_order is not contiguous 0-14';
  END IF;

  SELECT count(*) INTO v_hop_count FROM public.curated_list_items WHERE curated_list_id = '4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid;
  IF v_hop_count <> 18 THEN
    RAISE EXCEPTION 'Postflight: expected 18 rows for Hoptimists, found %', v_hop_count;
  END IF;
  SELECT count(*) INTO v_hop_gap_or_dup FROM (SELECT display_order, count(*) FROM public.curated_list_items WHERE curated_list_id = '4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid GROUP BY display_order HAVING count(*) <> 1) dup;
  IF v_hop_gap_or_dup <> 0 THEN
    RAISE EXCEPTION 'Postflight: Hoptimists has duplicate display_order values';
  END IF;
  SELECT count(*) INTO v_hop_gap_or_dup FROM generate_series(0,17) s WHERE NOT EXISTS (SELECT 1 FROM public.curated_list_items WHERE curated_list_id = '4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid AND display_order = s);
  IF v_hop_gap_or_dup <> 0 THEN
    RAISE EXCEPTION 'Postflight: Hoptimists display_order is not contiguous 0-17';
  END IF;

  SELECT count(*) INTO v_tmc_count FROM public.curated_list_items WHERE curated_list_id = '479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid;
  IF v_tmc_count <> 18 THEN
    RAISE EXCEPTION 'Postflight: expected 18 rows for Trail Mix Crew, found %', v_tmc_count;
  END IF;
  SELECT count(*) INTO v_tmc_gap_or_dup FROM (SELECT display_order, count(*) FROM public.curated_list_items WHERE curated_list_id = '479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid GROUP BY display_order HAVING count(*) <> 1) dup;
  IF v_tmc_gap_or_dup <> 0 THEN
    RAISE EXCEPTION 'Postflight: Trail Mix Crew has duplicate display_order values';
  END IF;
  SELECT count(*) INTO v_tmc_gap_or_dup FROM generate_series(0,17) s WHERE NOT EXISTS (SELECT 1 FROM public.curated_list_items WHERE curated_list_id = '479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid AND display_order = s);
  IF v_tmc_gap_or_dup <> 0 THEN
    RAISE EXCEPTION 'Postflight: Trail Mix Crew display_order is not contiguous 0-17';
  END IF;

  SELECT count(*) INTO v_psr_count FROM public.curated_list_items WHERE curated_list_id = '2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid;
  IF v_psr_count <> 15 THEN
    RAISE EXCEPTION 'Postflight: expected 15 rows for Pearl Street Regulars, found %', v_psr_count;
  END IF;
  SELECT count(*) INTO v_psr_gap_or_dup FROM (SELECT display_order, count(*) FROM public.curated_list_items WHERE curated_list_id = '2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid GROUP BY display_order HAVING count(*) <> 1) dup;
  IF v_psr_gap_or_dup <> 0 THEN
    RAISE EXCEPTION 'Postflight: Pearl Street Regulars has duplicate display_order values';
  END IF;
  SELECT count(*) INTO v_psr_gap_or_dup FROM generate_series(0,14) s WHERE NOT EXISTS (SELECT 1 FROM public.curated_list_items WHERE curated_list_id = '2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid AND display_order = s);
  IF v_psr_gap_or_dup <> 0 THEN
    RAISE EXCEPTION 'Postflight: Pearl Street Regulars display_order is not contiguous 0-14';
  END IF;

  SELECT title, starts_at, ends_at INTO v_title, v_starts, v_ends FROM public.lists WHERE id = '178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid;
  IF v_title IS DISTINCT FROM $lm$Denver Fall 2026$lm$ OR v_starts IS DISTINCT FROM '2026-09-06'::date OR v_ends IS DISTINCT FROM '2026-11-30'::date THEN
    RAISE EXCEPTION 'Postflight: official list shell title/dates do not match what Step 3 set -- title=%, starts=%, ends=%', v_title, v_starts, v_ends;
  END IF;
END
$do$;

-- Review before COMMIT
SELECT 'official' AS list_kind, l.title, l.starts_at, l.ends_at, count(li.id) AS item_count
FROM public.lists l LEFT JOIN public.list_items li ON li.list_id = l.id
WHERE l.id = '178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid
GROUP BY l.title, l.starts_at, l.ends_at
UNION ALL
SELECT 'curated' AS list_kind, cl.title, NULL, NULL, count(cli.id)
FROM public.curated_lists cl LEFT JOIN public.curated_list_items cli ON cli.curated_list_id = cl.id
WHERE cl.id IN ('4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid, '479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid, '2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid)
GROUP BY cl.title;

COMMIT;
