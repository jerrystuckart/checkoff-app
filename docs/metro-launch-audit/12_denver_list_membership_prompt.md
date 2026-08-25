# Generate the Denver launch list-membership SQL (review-only, nothing applied)

Paste into Claude Code from inside the `checkoff` repo. This is the final step of the Denver
metro launch prep: writing the actual list-membership rows for the four lists in
`Denver_List_Curation_Manifest_v0.1.xlsx` (already fully reviewed and approved). Nothing has been
written to any membership table yet — the official list shell has zero items, a placeholder title,
and null dates; the three curated shells are inactive with zero items.

Confirmed already, don't re-derive: the Places geocoding backfill
(`supabase/migrations/20260822_denver_places_backfill.sql`) has been run against production — 146
of 149 Denver items now have `maps_lat`/`maps_lng`/`google_place_id`/`formatted_address` populated.
The remaining 3 (the two `CLOSED_TEMPORARILY` museums and Brewhop Trolley) are `is_active = false`
and correctly excluded from every list below.

## Guardrails

* Review-only. Do NOT run this SQL against the database yourself — generate it as a file for Jerry
  to run, same as every other production SQL file in this project.
* Do NOT commit or push.
* Do NOT flip `metro_areas.is_active`, and do NOT flip `is_active` on any of the three curated list
  shells. Per the manifest's own Dashboard sheet: "Keep curated shells inactive and metro inactive
  until art, SQL QA and device QA pass." This SQL populates membership and the official list's
  metadata only — activation is a separate, later step.
* Follow the same discipline as every other production file in this project: single
  `BEGIN;`/`COMMIT;`, CTE-based (not temp-table) preflight/postflight `RAISE EXCEPTION` guards,
  `gen_random_uuid()` only if any new IDs are needed (they shouldn't be — all four list shells and
  all 149 items already exist).

## Step 1 — Verify the live schema before writing anything

`items`, and by extension the list tables, predate this project's tracked migration history, so
column names below are stated with confidence only where explicitly confirmed elsewhere in this
project. Confirm all of the following against the live, linked DB before generating SQL — if any
name is wrong, use the real name; if something doesn't exist as expected, stop and flag it rather
than guessing:

1. The table holding the official seasonal list shells (referred to here as "the list shell
   table" — likely `public.lists`). Run `\d` on it and confirm it has a primary key matching
   `178ecd7c-8c05-45ee-af2a-a58979bc5184`, plus columns for a title/name and a start date and end
   date (exact names unconfirmed — could be `title`/`name`, `start_date`/`end_date`,
   `starts_at`/`ends_at`, etc.).
2. `public.list_items` — confirm columns `list_id`, `item_id`, `sort_order` (all three referenced
   already in this project's docs) and whether a unique constraint exists on
   `(list_id, item_id)` or `(list_id, sort_order)` — needed to know if `ON CONFLICT` is usable or
   if the preflight guard needs to check for pre-existing rows directly instead.
3. The table holding the three curated list shells (referred to here as "the curated list shell
   table" — likely `public.curated_lists`). Confirm it has a primary key matching all three of:
   `4ae154ea-37af-4d5f-b567-1744df7b5e0d` (Hoptimists), `479a4fb9-5cf1-4c5c-8f26-3b9de5442df7`
   (Trail Mix Crew), `2c4dc895-2334-45ba-9fa9-650f7b065b6f` (Pearl Street Regulars), and an
   `is_active` column (confirm current value is `false` for all three, per the manifest).
4. `public.curated_list_items` — confirm columns `list_id` (or `curated_list_id` — check the real
   FK column name), `item_id`, `display_order`, and the same constraint question as #2.
5. Confirm all 66 distinct item IDs referenced below (15 + 18 + 18 + 15, with some overlap — see
   note below) exist in `public.items` with `is_active = true`. List any that don't.

## Step 2 — Preflight guard (CTE-based, read-only check before any writes)

Before the inserts/update, verify with a `DO $do$ ... RAISE EXCEPTION` block:

* All 4 list-shell IDs (1 official + 3 curated) exist.
* None of `public.list_items` already has rows for the official list ID, and none of
  `public.curated_list_items` already has rows for any of the 3 curated list IDs — this is a
  from-zero population, not an upsert. If any rows already exist for these list IDs, stop and
  report rather than assuming it's safe to append or overwrite.
* All 66 distinct item IDs referenced below exist in `public.items` with `is_active = true`.

## Step 3 — Update the official Fall 2026 list shell

List ID `178ecd7c-8c05-45ee-af2a-a58979bc5184`. Set:

* Title: `Denver Fall 2026`
* Start date: `2026-09-06`
* End date: `2026-11-30`

Use whatever the real column names turn out to be from Step 1. Do not change `is_active` on this
shell unless Step 1 reveals it's already meant to be true at this stage — if unsure, leave it as
whatever it currently is and report the current value.

## Step 4 — Insert the Fall 2026 official list membership (15 rows, `list_items`)

`list_id = '178ecd7c-8c05-45ee-af2a-a58979bc5184'` for every row. `sort_order` is the first column
below (0-indexed, contiguous, already verified correct — do not re-order).

```
sort_order | item_id
0          | 7adebb0d-72e4-4906-990e-f242391999bd
1          | e337d21e-fab6-4edf-a6ed-60bcd94b9768
2          | 4a37a0e9-2d15-46e5-9e41-c3f16cedb850
3          | 03f59ab1-32b9-4037-b083-fa1d5bafc526
4          | 89bab711-c679-4b6e-9145-e7e7ba6d47a3
5          | 9ac42676-1628-428c-a707-d33344524079
6          | 442ee691-41ef-4a16-aad6-bc757480e9e6
7          | 60834533-2059-4404-8c5c-b804c31d96c2
8          | d7687915-0750-4ea1-a57a-876a969173d8
9          | 53f78e06-6997-45a7-8103-92a26d5bc018
10         | 6607f6bb-d9f3-4baa-8951-511c1cf995ea
11         | cde0d025-dcd6-4fff-ae8a-dc3ddc3a10d9
12         | d228dd53-81ce-4cea-98e1-893498c1a933
13         | 14683011-33a7-4bcb-9508-563548d2ff73
14         | 227d2f0f-fc9d-47c5-a1cd-821818092b33
```

## Step 5 — Insert the Hoptimists curated membership (18 rows, `curated_list_items`)

Curated list ID `4ae154ea-37af-4d5f-b567-1744df7b5e0d`. `display_order` 0-indexed, contiguous.

```
display_order | item_id
0             | 949c8de8-73a9-4bde-b3a9-4d2205a947e2
1             | aff3d648-9fc2-4801-8546-8b15ed14e2f0
2             | dcedc561-9f46-4083-8b9a-4b81ccd8ede4
3             | f7be7ce1-fb50-49c6-aa0c-0cfef0f232c5
4             | 3fc6c1ee-aba0-4f53-b5f0-9e4ac8ac91e3
5             | d5a60c98-2e53-49ef-aafa-4516f37f157d
6             | 53f78e06-6997-45a7-8103-92a26d5bc018
7             | ddd8b9cd-85ed-4c33-8865-8bc2a8ee7f49
8             | b9630340-4798-4904-8523-1c684ac6cb09
9             | 754b6bdc-4b87-4c55-8b3f-0b36f3606990
10            | 8bcfe55d-7fb5-41cc-ac00-287c18647b0b
11            | 91027c2c-69cf-4ceb-860f-e89e80e45397
12            | 91a2093e-1eba-4ec6-badc-74de0a749e15
13            | bb1ff5e9-8f73-4a25-a40f-0dd2a0b4690b
14            | e0b82e7f-c02d-458a-907e-55898f99bd85
15            | 052a0a3b-44e2-423e-8318-b755cc2d2b0d
16            | 2a3523f7-31a1-4ad5-93db-e276bf1b0ed7
17            | 1a2689a8-2570-4c4a-b6cd-1a858e7fe25c
```

## Step 6 — Insert the Trail Mix Crew curated membership (18 rows, `curated_list_items`)

Curated list ID `479a4fb9-5cf1-4c5c-8f26-3b9de5442df7`. `display_order` 0-indexed, contiguous.

```
display_order | item_id
0             | 22230bac-ab00-4e34-ae95-df977d37e800
1             | 5ecda3c3-e40a-4698-83f5-e25fdfc96cdb
2             | 70f84234-4de2-471b-8a33-d818834095d5
3             | 7adebb0d-72e4-4906-990e-f242391999bd
4             | 7f61f150-1e39-493d-bed3-9f39960342a8
5             | 0c483c15-f425-4750-885f-5461d81f387c
6             | a9ad1cca-9d0f-432f-b311-61707d4124ec
7             | dff1afbb-9684-4ba0-baf3-bdd00ef57fbd
8             | e85fae74-a640-4288-961f-116f82b1a067
9             | b6416d2e-f771-437d-b9f9-8007600c0681
10            | aee81f04-b581-47aa-923d-cc2879a46b13
11            | d0f49958-63d3-495f-84b2-6343d52ee762
12            | 591ab105-f33d-42c5-b474-e6610157bf27
13            | 29b6827c-2e59-4b21-9a15-ecbb7188a556
14            | c9ffca28-5a4f-4f6f-8cd7-9cbe08b8b489
15            | d3e9f7cc-73ff-4148-913b-99c78817d409
16            | d463f0a3-2520-4d58-b9c4-3d334b3ab5e9
17            | 2957baa5-270d-453e-bf0f-54b7e94ddb41
```

## Step 7 — Insert the Pearl Street Regulars curated membership (15 rows, `curated_list_items`)

Curated list ID `2c4dc895-2334-45ba-9fa9-650f7b065b6f`. `display_order` 0-indexed, contiguous.

```
display_order | item_id
0             | 104bbb02-92a3-447a-968f-7cde6e0e137c
1             | 08893b11-d552-407a-a407-255625f949db
2             | 218678c7-c7f7-40f5-8131-1dcec8ac028b
3             | 2cd5dab3-ac6b-4730-8d08-dfae0f0ad66f
4             | 36c87d34-8c14-4236-b7d9-da32d2e65b06
5             | 63bfd734-9dc2-4211-9030-11eee9101d7d
6             | 7adebb0d-72e4-4906-990e-f242391999bd
7             | c674befd-40d5-4d27-bb1a-81c445423cad
8             | d225235d-5650-4376-8d4b-d16d946baf95
9             | d228dd53-81ce-4cea-98e1-893498c1a933
10            | d7687915-0750-4ea1-a57a-876a969173d8
11            | dc1cdc75-add7-41f9-9513-84793386de17
12            | dcedc561-9f46-4083-8b9a-4b81ccd8ede4
13            | dd20c7d4-0a92-46ad-9531-a4977cc7dea9
14            | f1064c56-9319-4b49-8e54-59c0cebde034
```

## Note — 5 items intentionally appear on more than one list

This is by design, not a dedup bug — do not collapse or skip these:

* `7adebb0d-72e4-4906-990e-f242391999bd` (Chautauqua Park): Fall 15, Trail Mix Crew, Pearl Street
  Regulars
* `d7687915-0750-4ea1-a57a-876a969173d8` (Boulder Dushanbe Teahouse): Fall 15, Pearl Street
  Regulars
* `53f78e06-6997-45a7-8103-92a26d5bc018` (Romero's K9 Club): Fall 15, Hoptimists
* `d228dd53-81ce-4cea-98e1-893498c1a933` (The Dragontree): Fall 15, Pearl Street Regulars
* `dcedc561-9f46-4083-8b9a-4b81ccd8ede4` (Avery Brewing Company): Hoptimists, Pearl Street
  Regulars

Since `list_items` and `curated_list_items` are separate tables, each of these gets one row per
list it appears on (e.g. Chautauqua Park gets 3 rows total, one in each table/list it belongs to)
— this is expected and should not trip the preflight guard.

## Step 8 — Postflight guard

After the inserts, verify with a `DO $do$ ... RAISE EXCEPTION` block:

* `list_items` has exactly 15 rows for list `178ecd7c-8c05-45ee-af2a-a58979bc5184`, sort_order
  0–14 contiguous with no gaps or duplicates.
* `curated_list_items` has exactly 18 rows for `4ae154ea-...`, 18 for `479a4fb9-...`, and 15 for
  `2c4dc895-...`, each with `display_order` contiguous 0-indexed and no gaps or duplicates.
* The official list shell's title/start date/end date now read back exactly as set in Step 3.

## Deliverable

`supabase/migrations/<today's date>_denver_list_membership.sql` (new file, not applied) containing
the schema-verified update + all inserts, wrapped in `BEGIN;`/`COMMIT;`, with the preflight and
postflight guards described above.

## Report back

1. The real schema findings from Step 1 (actual table/column names used, and the constraint
   findings) — flag anything that didn't match this prompt's assumed names.
2. Confirmation all 66 distinct item IDs exist and are `is_active = true` (list any that aren't).
3. Confirmation no pre-existing rows were found in `list_items`/`curated_list_items` for these 4
   list IDs before this run (or, if some were found, stop and report rather than proceeding).
4. The generated SQL file path, ready for Jerry to review and run himself — do not run it.
5. Confirmation `metro_areas.is_active` and all three curated shells' `is_active` were left
   untouched.
6. Confirmation nothing was written to any table, nothing committed or pushed.
