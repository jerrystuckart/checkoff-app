# Build Denver's 3 Home Screen Themed Lists (Hidden Bars, Second Date Material, Ferda Girls) — review-only, nothing applied

Paste into Claude Code from inside the `checkoff` repo. These are `public.lists` rows
(`is_official = true`), the same pattern confirmed for Tucson's "Foodies of Tucson"/"Dark Skies"
and Milwaukee's "Wisconsin Weird" — distinct from the `curated_lists` table used for
Hoptimists/Trail Mix Crew/Pearl Street Regulars. They render in the Home Screen's "Themed Lists"
rail, fed by the same `officialLists` query as the seasonal hero card
(`screens/HomeScreen.jsx` line ~316).

All items and list membership below were curated from a full live pull of the Denver catalog
(`docs/metro-launch-audit/18_pull_full_denver_catalog_for_themed_lists.sql`'s output) — every item
id referenced actually exists, is `is_active = true`, and its body/category were read directly
from that pull, not guessed.

## Guardrails

* Review-only. Do NOT run this SQL against the database yourself — generate it as a file for Jerry
  to run.
* Do NOT commit or push.
* Single `BEGIN;`/`COMMIT;`, CTE-based preflight/postflight `RAISE EXCEPTION` guards, matching
  every other production file in this project.
* Do NOT touch `metro_areas.is_active` or any `curated_lists` row — these are unrelated tables.

## Step 1 — Verify live schema before writing

Confirm `public.lists` still has exactly the columns already established in this project:
`id, title, starts_at, ends_at, is_official, is_public, metro_id, hero_image_url, cover_emoji`
(plus whatever else `\d public.lists` shows). Confirm `list_items (list_id, item_id, sort_order)`
and its `UNIQUE(list_id, item_id)` constraint. If anything differs, use the real names — don't
guess.

## Step 2 — Preflight guard

* Confirm all 44 distinct item ids referenced below (13 + 12 + 19, no overlap between these 3 new
  lists themselves) exist in `public.items` with
  `is_active = true`. List any that don't — stop rather than proceed on a mismatch.
* Confirm no `public.lists` row already exists with any of these 3 exact titles for Denver's
  `metro_id` (`b00f7f91-3176-48c5-aaf1-6ded7426f756`) — this is a fresh creation, not an update.

## Step 3 — Create the 3 list shells

All three: `is_official = true`, `is_public = true`,
`metro_id = 'b00f7f91-3176-48c5-aaf1-6ded7426f756'::uuid`, `starts_at = '2026-09-06'::date`,
`ends_at = '2026-11-30'::date` — matching Denver Fall 2026's own dates, consistent with the
confirmed cross-metro convention that themed lists share their season's exact end date with the
seasonal hero list. `hero_image_url` is intentionally left NULL — Jerry will set real images via
the admin tool once Creative delivers them. Use `gen_random_uuid()` for each list's `id` (no
pre-assigned ids for these, unlike the curated lists).

| Title | cover_emoji |
|---|---|
| Hidden Bars | 🔑 |
| Second Date Material | 💫 |
| Ferda Girls | 💅 |

## Step 4 — Hidden Bars (13 items, `sort_order` 0-indexed contiguous)

Note to Claude Code: item ids for every list below are given as exact `body` text, not uuids — the
source data only had 8-character-truncated ids available. Look up each item's real uuid by exact
match against the live `public.items.body` (e.g. `WHERE body = '...'`), don't guess or truncate.
List of exact bodies, in the intended sort order:

0. "Ignore the 'Staff Only' door inside 'Spirits Wine Provisions' and ask for a personalized cocktail at 'The Stockroom'"
1. "Flip the switch beside the freezer door behind 'Sweet Action Ice Cream' and step into 'Retrograde' for a cosmic cocktail"
2. "Find the gold doorbell and enter the hidden bar at 'B&GC'"
3. "Answer the African-culture question for a QR entry pass, then order the sugarcane 'Kango Kane' at 'Trybal African Speakeasy'"
4. "Step behind the bookcase for a monthly speakeasy night at '24 Carrot Bistro'"
5. "Go underground in downtown Golden, call your shot and win a game of pool at 'The Down Low'"
6. "Descend into 'The Devil's Drink,' order the tiramisu 'Duncan Hills' espresso martini and play a rack of pool underground"
7. "Enter through the bookcase and order a cocktail at 'Williams & Graham'"
8. "Confess your sins inside the confessional-inspired 'Agua Bendita' and order the mezcal 'Bandito'"
9. "Descend below Larimer Square and order the rum-and-rice-milk 'Clarified Horchata' in the dark tropical hideaway at 'Emerald Eye'"
10. "Find the unmarked basement entrance inside the IceHouse, bring cash and spend one Lincoln on a drink at 'Lincoln's'"
11. "Descend beneath Main Street and play a note on the white baby grand inside 'The Speakeasy's' hidden Shotgun Room"
12. "Slip through 'The Simon's' South Street back door, descend into 'Nora's Speakeasy' and order one of 'Nora's Takes' on a classic cocktail"

## Step 5 — Second Date Material (12 items, `sort_order` 0-indexed contiguous)

Exact bodies, in intended sort order:

0. "Have tea beneath the hand painted ceiling at 'Boulder Dushanbe Teahouse'"
1. "Have afternoon tea beneath the stained glass atrium at 'The Brown Palace Hotel and Spa'"
2. "Pair a live jazz set with the five-course 'Ellington Experience' beneath the Art Deco staircase at 'Nocturne'"
3. "Pair food from two vendors with the skyline view at 'Avanti Food and Beverage Denver'"
4. "Catch a Front Range sunset at 'Lost Gulch Overlook'"
5. "See a dome show at 'Fiske Planetarium'"
6. "See the current exhibition at 'Boulder Museum of Contemporary Art'"
7. "Descend beneath 'Hotel Boulderado' and raise a cocktail under Boulder's original 1969 liquor license at 'License No. 1'"
8. "End the current exhibition with a craft cocktail on the rooftop at 'Museum of Contemporary Art Denver'"
9. "Walk beneath the lights at 'Larimer Square' after dark"
10. "Play a board game beside the firepits on the graffiti-lined patio at 'Improper City'"
11. "Pair a used book browse with a coffee at 'Trident Booksellers and Cafe'"

(12 items total for this list — recount confirmed: 0 through 11 = 12, not 13; use 12 as the real
count for this list's postflight guard, not 13.)

## Step 6 — Ferda Girls (19 items, `sort_order` 0-indexed contiguous)

Exact bodies, in intended sort order — all 10 Spa & self-care items, then all 9 Shopping items:

0. "Rotate through the cedar sauna, cold plunge, salt room and forest showers at 'The Dragontree'"
1. "Alternate between the cedar sauna and cold plunge at Denver's 1927 'Lake Steam Baths'"
2. "Complete the sauna, cold-plunge, warm-soak and steam circuit at 'ROK SPAS'"
3. "Cycle between a wood fired sauna and cold plunge on the farm at 'Puffin Sauna Club'"
4. "Step into the whole body cryotherapy chamber at 'Fire & Ice Wellness'"
5. "Complete the infrared-sauna, cold-shower and hops-and-barley bath circuit at 'Oakwell Beer Spa'"
6. "Float without light or sound, then journal over tea at 'Samana Float Center'"
7. "Lie back for a session inside the 13,000 pound Himalayan salt cave at '5 Star Salt Caves'"
8. "Receive a continuous stream of warm herbal oil across your forehead during Shirodhara at 'The Soma Spa'"
9. "Try the warm water halo during a Restorative HeadSpa service at 'HeadSpa Denver'"
10. "Find an 8 track, a cassette and a LaserDisc under one roof at 'Black & Read'"
11. "Choose one bone, pinned insect or botanical oddity at 'The Terrorium Shop'"
12. "Choose between a traditional kite and a stunt kite at 'Into The Wind'"
13. "Find the strangest kitchen gadget you can explain how to use at 'Peppercorn'"
14. "Follow the stairs through every level and choose one bookseller recommendation at 'Boulder Book Store'"
15. "Enter the castle and choose one beginner magic trick to learn at 'The Wizard's Chest'"
16. "Rescue one secondhand art supply for your next project at 'ReCreative Denver'"
17. "Adopt a rehabilitated plant during the Sunday Rescue Plant Pop Up at 'The Golden Bee'"
18. "Find one toy or trading card from your childhood inside the 1980s time capsule at 'Fifty-Two 80's'"

## Step 7 — Postflight guard

* Hidden Bars: exactly 13 rows in `list_items`, `sort_order` 0–12 contiguous, no duplicates.
* Second Date Material: exactly **12** rows (not 13 — see note in Step 5), `sort_order` 0–11
  contiguous, no duplicates.
* Ferda Girls: exactly 19 rows, `sort_order` 0–18 contiguous, no duplicates.
* All 3 list shells have `is_official = true`, `is_public = true`,
  `metro_id = 'b00f7f91-3176-48c5-aaf1-6ded7426f756'`, `starts_at = '2026-09-06'`,
  `ends_at = '2026-11-30'`.

## Note on overlap — expected, not a bug

Several items already belong to the Fall 2026 official list and/or a curated list (e.g. Williams &
Graham is already in Hoptimists; Boulder Dushanbe Teahouse and Chautauqua-adjacent items are
already in Pearl Street Regulars/Fall 15). Jerry explicitly said not to worry about cross-over —
`list_items` rows are per-list, so the same item can and should appear on multiple lists here.

## Deliverable

`supabase/migrations/<today's date>_denver_themed_lists.sql` (new file, not applied).

## Report back

1. Confirmation all 44 distinct item ids were found by body-text match and their real uuids.
2. The 3 new list ids generated (`gen_random_uuid()` output).
3. Final row counts per list, confirmed against Step 7.
4. The generated SQL file path, ready for Jerry to review and run himself — do not run it.
5. Confirmation nothing was written to any table, nothing committed or pushed.
