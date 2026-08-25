# Denver Places backfill — dry-run batch lookup for all 149 items (nothing written to the DB)

Paste into Claude Code from inside the `checkoff` repo. This is Pass 1 of the same 3-pass
geocoding discipline already proven in this repo (`scripts/geocode-items.js` →
`scripts/triage-weak.js` → `scripts/generate-commit-sql.js`), adapted for a different situation:
those scripts were built to **re-verify items that already have coordinates** (drift-check against
an existing `maps_lat`/`maps_lng`). Denver's 149 items have `maps_query` populated but
`maps_lat`/`maps_lng`/`google_place_id`/`formatted_address` all NULL by design — this is a
**first-time placement**, not a re-geocode. Build a new, separate script rather than modifying the
existing one, so the proven re-geocode tool other metros may still need stays untouched.

## Guardrails

* Do NOT write anything to `public.items`, `public.geo_corrections`, or any other table. This pass
  only calls the Google Places API and writes a CSV to disk.
* Do NOT run `triage-weak.js` or `generate-commit-sql.js` (or Denver equivalents of them) in this
  pass — that's the next step, after I've reviewed this CSV with Jerry.
* Do NOT modify `scripts/geocode-items.js`, `scripts/triage-weak.js`, or
  `scripts/generate-commit-sql.js` in place. Create a new file for this.
* Do NOT commit or push.

## Step 1 — Re-read the proven pattern before adapting it

Read `scripts/geocode-items.js` in full again (field mask, bias resolution hierarchy, the
normalized-Levenshtein `similarity()` function, STRONG/WEAK/NONE thresholds, the minimal `.env`
loader, `MAX_CALLS`). Confirm `GOOGLE_PLACES_API_KEY` is still present wherever that script reads
it from — if it's missing or expired, stop and tell me rather than guessing a substitute.

## Step 2 — Create `scripts/geocode-denver-items.js`

Copy the proven pattern from `scripts/geocode-items.js`, with these changes:

1. **Selection query — scope to Denver, driven by the live DB, not a hardcoded list.** First query
   `public.neighborhoods` for the 20 rows under Denver (`metro_id` = the `id` from
   `metro_areas WHERE slug = 'denver'`) to get their real ids, names, and `center_geo`. Then select
   items with `neighborhood_id IN (<those 20 ids>) AND is_universal = false AND maps_lat IS NULL`
   (no `is_active` filter needed — every Denver row is already `is_active = true` from the intake
   insert). Confirm this returns exactly 149 rows before proceeding — if it doesn't, stop and tell
   me the actual count and why, don't proceed on a mismatch.

2. **Field mask — add `places.businessStatus`.** The full mask should be
   `places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus`.
   This is already confirmed to sit in the same "Text Search Pro" SKU as the other fields
   (`$32/1000` requests) — adding it costs nothing extra. Flag to me the projected total cost for
   this run (~149 requests) before running it, using current published Places API pricing — don't
   assume it's still exactly what it was when last checked, do a quick check that pricing hasn't
   changed.

3. **Bias — use the neighborhood's own `center_geo`, already fetched in step 2's query.** Every one
   of these 149 items has a `neighborhood_id`, so this is the only bias level you'll need (no
   `city_id`/item-own-coords fallback required here, since none of these items have any of that).

4. **Distance metric — there's no "old" coordinate to measure drift from.** Replace
   `distance_moved_m` with `distance_from_neighborhood_center_m`: the haversine distance between
   the Places API's returned location and that item's neighborhood's `center_geo`. This is the
   sanity check that matters here — a returned place many miles from its assigned neighborhood is
   a sign the match is wrong (wrong city, wrong chain location, etc.), same purpose the original
   drift check served, just measured against the neighborhood anchor instead of a prior value.

5. **Keep the STRONG/WEAK/NONE classification logic (similarity ≥ 0.6 + single result = STRONG,
   similarity ≥ 0.35 = WEAK, else NONE) unchanged.**

6. **Output CSV** to `scripts/output/denver-geocode-<today's date>.csv` with columns: `item_id`,
   `body`, `maps_query`, `neighborhood_name`, `distance_from_neighborhood_center_m`,
   `returned_name`, `formatted_address`, `new_lat`, `new_lng`, `place_id`, `business_status`,
   `match_signal`, `similarity_score`. `business_status` is not written to any DB column anywhere
   in this schema — it exists in this CSV purely as a review signal so Jerry can spot any
   `CLOSED_PERMANENTLY`/`CLOSED_TEMPORARILY` result before anything gets committed.

## Step 3 — Run it

Confirm the row count from step 2 is 149, tell me the projected cost, then run the script against
the live Places API. This makes ~149 real, billed API calls — don't run it more than once
unnecessarily (e.g. don't re-run to "double check" without a reason; if it fails partway through,
resume rather than restart from item 1 if the script supports that, or tell me if it doesn't and
we'll add resume support before re-running).

## Report back

1. The confirmed pre-run row count (should be 149) and the neighborhood-driven query you used to
   get it.
2. The projected and actual cost of the run.
3. STRONG / WEAK / NONE counts.
4. Any row where `business_status` is not `OPERATIONAL` — list these explicitly by item_id and
   place name, since a permanently-closed business needs a product decision (drop the item?
   replace it?), not a geocoding fix.
5. Any row where `distance_from_neighborhood_center_m` is unusually large (you decide a sensible
   threshold given each neighborhood's own ring radii, and say what threshold you used) — these are
   likely wrong-place matches (a same-named business in a different city, a chain location, etc.).
6. The full CSV, and its path.
7. Confirmation nothing was written to `items`, `geo_corrections`, or any other table, and nothing
   was committed or pushed.
