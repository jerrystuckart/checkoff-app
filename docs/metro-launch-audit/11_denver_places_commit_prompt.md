# Pass 3 — generate the Denver Places commit SQL (review-only, nothing applied)

Paste into Claude Code from inside the `checkoff` repo. This is the final pass over the two CSVs
already produced (`scripts/output/denver-geocode-2026-08-22.csv` — 149 rows, and
`scripts/output/denver-geocode-rescore-2026-08-22.csv` — the 53 re-run rows). Every item below has
already been triaged; this prompt's job is to turn the triage into real, reviewable commit SQL —
not to re-litigate any of the classifications.

## Guardrails

* Review-only. Do NOT run this SQL against the database yourself — generate it as a file for
  Jerry to run, same as every other production SQL file in this project.
* Do NOT commit or push.
* Follow the same pattern as `scripts/generate-commit-sql.js`: a `geo_corrections` audit-trail
  INSERT immediately before each `items` UPDATE, batched in a single transaction, guarded with a
  preflight existence + `maps_lat IS NULL` check and a postflight non-NULL check (same discipline
  as `docs/metro-launch-audit/patches/denver_catalog_insert_CORRECTED.sql` and
  `denver_checkoffize_update.sql` — CTE-based expected-values check, not a temp table, per the
  established preference in this repo). Set `maps_lat`/`maps_lng`/`google_place_id`/
  `formatted_address` only — never set `geo_location` directly, the `trg_sync_item_geo_location`
  trigger handles that from `maps_lat`/`maps_lng`.

## Category A — auto-commit, no manual review needed

Every item currently `match_signal = STRONG` in either CSV, **except** the two held out in
Category D below. That's 96 (original) + 25 (rescore) − 2 (held out) = 119 items. Pull their
`new_lat`, `new_lng`, `place_id`, `formatted_address` directly from whichever CSV has them.

## Category B — approve as-is despite an ambiguity/variant flag (24 items, use existing data)

These were manually reviewed and judged correct; commit them using the data already in the rescore
CSV, no new lookups needed:

* Ambiguous-candidate-count only, top result is correct: `1915043e`, `61750c16`, `5ecda3c3`,
  `d3e9f7cc`, `9ac42676`, `3f269beb`, `91a2093e`, `276561ac`
* Official-name/formatting variant, single candidate, correct: `eaa9fcfc`, `3fc6c1ee`, `b50f6e4f`,
  `822f114b`, `29b6827c`, `1a1ea071`, `e91add97`, `c9d51017`, `d0f49958`, `597247fb`, `c4280d06`,
  `c83d85bd`, `dd20c7d4`
* Genuine rebrand/relocation, real-world confirmed: `716ef3a6` (Kirkland Museum relocated into the
  Denver Art Museum), `de1208e6` (Denver Zoo Conservation Alliance is commonly still listed as
  "Denver Zoo" — this one is currently NONE in the original CSV with a single candidate; approve
  it using that candidate's data)
* `d0b5a03d` (Downtown Longmont Creative District → "Downtown Development Authority") — I checked
  this one directly: the Creative District is a program administered by the Longmont Downtown
  Development Authority, sharing its office/address — using the DDA's location as this district's
  anchor point is a reasonable, defensible choice, not a wrong match. Approve using its existing
  data.
* `7789de88` (Larimer Street murals → "Denver - Love This City Mural") — the item's body is
  intentionally generic ("choose your favorite mural"), so there's no single objectively-correct
  answer. The returned mural is a real, plausible location on/near Larimer Street (558m from the
  neighborhood center). Approve using its existing data — a real mural in the right area is a fine
  anchor for this kind of open-ended item.

## Category C — manual override, do NOT use the script's picked candidate (1 item)

`b05c509c` (The Art of Cheese, Longmont): the script picked candidate 1 (8701 N 55th St, 11,288m
from Longmont's center). You already identified candidate 2 (350 Terry St, 324m from center) as
the correct one when you pulled the raw candidate list during the rescore investigation. Use
candidate 2's `place_id`/`formattedAddress`/`location` for the commit — if you didn't retain its
exact values from that investigation, do one small targeted re-query (a single Places Text Search
call, `textQuery: "The Art of Cheese, 350 Terry St, Longmont, CO"`) to get them precisely rather
than reconstructing from memory.

## Category D — hold out of this commit entirely (2 items, do NOT geocode yet)

`0a223411` (American Mountaineering Museum) and `2c0eefdd` (CU Heritage Center) are both
`CLOSED_TEMPORARILY` per Google Places, even though both are correct STRONG matches. Leave their
`maps_lat`/`maps_lng`/`google_place_id`/`formatted_address` NULL for now — geocoding a currently-
closed venue isn't the right call while Denver is still pre-launch and there's time to make a
product decision (wait for reopening? replace the item? drop it?). Flag both explicitly in your
report as needing that decision before Denver launches, but don't include them in the commit SQL.

## Category E — needs a new query, not a commit (1 item, small separate re-run)

`a7df3180` (Tennyson Street Cultural District) matched a real but wrong, unrelated Denver district
6.2km away, in both the original run and the rescore (11 candidates, still wrong). Research a more
specific, real anchor for this item — an actual address or well-known landmark on Tennyson Street
itself (e.g. via a web search for "Tennyson Street Cultural District Denver" to find a specific
cross-street or business address) — and run one single Places Text Search call with that improved
query. If the result looks correct (on Tennyson Street, plausible distance from the Highlands/
Sunnyside neighborhood center), include it in the commit SQL as its own clearly-labeled section. If
it's still wrong, don't guess further — leave it NULL and report back what you tried.

## Category F — needs manual sourcing, not a query fix (1 item, exclude from this commit)

`cd98da3e` (Brewhop Trolley) has no Places listing at all — it's a mobile tour service. Do not
attempt another Places query. Leave it NULL. Note in your report that this one needs a manually-
sourced address (e.g. from their ticketing/pickup-location page) as a follow-up outside this
script-driven pipeline.

## Verify the totals before writing SQL

Category A (119) + B (24) + C (1) + E (1, if resolved) = should account for 144 or 145 of the 149,
with D (2) and F (1) — and E (1) if it can't be resolved — held out. Confirm your actual counts add
up to 149 total across all categories before generating the SQL; if they don't, stop and reconcile
rather than proceeding on a mismatch.

## Deliverable

`supabase/migrations/<today's date>_denver_places_backfill.sql` (new file, not applied) containing:
the `geo_corrections` INSERT + `items` UPDATE for every Category A/B/C/E-resolved item, wrapped in
`BEGIN;`/`COMMIT;`, with the same preflight (item exists, `maps_lat IS NULL`) and postflight
(`maps_lat IS NOT NULL` for everything just written) guards used in every other production SQL file
in this project.

## Report back

1. Final category counts and confirmation they sum to 149.
2. The Category C (Art of Cheese) and Category E (Tennyson St) resolutions, with the exact data
   used.
3. The generated SQL file path, ready for Jerry to review and run himself — do not run it.
4. A short, explicit callout of the 2 (or 3, if Tennyson St couldn't be resolved) items still
   sitting with NULL Places data after this pass, and what each one still needs.
5. Confirmation nothing was written to any table, nothing committed or pushed.
