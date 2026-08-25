# Phoenix vs. Milwaukee vs. Tucson — foundation comparison

All numbers are live query results (2026-08-21) — see [00_schema_preflight.sql](00_schema_preflight.sql)
queries 9, 10, 13, 14, 15, 16.

## `metro_areas` rows

| Field | Phoenix | Milwaukee | Tucson |
|---|---|---|---|
| slug | `phoenix` | `milwaukee` | `tucson` |
| state | AZ | WI | AZ |
| center_lat/lng | 33.4484, -112.074 | 43.0389, -87.9065 | 32.2226, -110.9747 |
| hero_images count | 3 | 2 | 2 |
| is_active | true | true | true |
| created_at | 2026-04-10 | 2026-04-10 (same batch as Phoenix) | 2026-07-05 (launched later, standalone) |

## Rollup counts

| Metro | Neighborhoods | Active non-universal items | Active public lists | Total `is_official` lists |
|---|---|---|---|---|
| Phoenix | 12 | 290 | 14 | 9 |
| Tucson | 17 | 168 | 7 | 7 |
| Milwaukee | 39 | 140 | 4 | 4 |

Neighborhood count is not a proxy for content maturity — Phoenix has the fewest neighborhoods but
the most items and lists (oldest, most-iterated metro). Milwaukee has 3x Phoenix's neighborhood
count but half the items.

## Official seasonal lists

All three metros currently have **multiple concurrently-active `is_official=true` lists**
covering the same date window (see [01](01_current_schema_and_relationships.md) for the full
collision finding) — e.g. Phoenix has 8 official lists all spanning 2026-07-31→2026-11-30
simultaneously. This is the norm across all three, not an anomaly unique to one. None of the
three metros demonstrates a clean "exactly one official seasonal list at a time" pattern to copy.

## Curated-list / audience-group overlay structure

| Metro | Audience groups | Curated lists (city_slug-scoped) | Using `curated_list_metros` (new model) |
|---|---|---|---|
| Phoenix | 8 (Main Character Cardio, Ferda Girls, Trail Mix Crew, Soft Launch Season, West Valley's Best, Snack Pack Survivors, The Heat Refugees, Wine Trail Wanderers) | ~20 lists, mostly one per audience group ("Summer 2026" suffix) | Only 4 of ~20 (Phoenix Hidden Gems, Rediscover Downtown Peoria, The Heat Refugees, West Valley's Best) |
| Milwaukee | 6 (Main Character Cardio, Snack Pack Survivors, Trail Mix Crew, Lake Effect Locals, Soft Launch Season, Ferda Girls) | ~17 lists | Only 4 (Lake Effect Locals, Madison State Street Drift, The Dells Dive-In, The Door County Detour, The Green Bay Leap — day-trip-style lists) |
| Tucson | 0 audience groups | 3 lists (Best of Tucson, Mercado District, Tucson Hidden Bars) — all `audience_group_id IS NULL` | 2 of 3 (Mercado District, Tucson Hidden Bars) |

**Stale-documentation correction:** "Best of Tucson" was flagged in the ADDED section as
"active with 0 items" per an earlier check. **Live query confirms 22 items now** — that concern
is resolved as of this audit; do not carry it forward as still-true.

**Overlay-model adoption is inconsistent and partial across all three metros**, not just Tucson.
The majority of curated lists (all the audience-group/"Summer 2026" pattern lists) rely on the
legacy `curated_lists.city_slug` column directly, not `curated_list_metros` — only the
smaller subset of geography-flavored lists (hidden gems, neighborhood day trips) use the newer
join-table model. Both mechanisms are simultaneously live in production today.

## Cleanest template — split verdict, not a single answer

No single metro is "cleanest" across every dimension; the data supports the audit's own
suspicion that this should be split:

- **Geography/neighborhoods/items pipeline**: **Tucson** is the cleanest template. It was
  launched most recently (2026-07-05, standalone from the Phoenix/Milwaukee batch), has a
  reasonable neighborhood-to-item ratio (17 neighborhoods / 168 items ≈ 10/neighborhood vs.
  Phoenix's 24/neighborhood and Milwaukee's 3.6/neighborhood), and its official-lists structure
  (7 lists, same July→November pattern as the others) shows the launch pipeline in its most
  recent, presumably most-refined form.
- **Curated-list / audience-group overlay structure**: **Phoenix**, not Tucson, is the actual
  reference — it has the fullest audience-group roster (8 groups) with the most curated lists
  populated (largest item counts per list, e.g. Ferda Girls at 64 items, The Ungoogleable City at
  65), and the most mature mix of both the legacy `city_slug` and newer `curated_list_metros`
  patterns coexisting. Milwaukee is a reasonable second reference (6 groups) but many of its
  audience-group lists are `is_active=false` (Main Character Cardio, Ferda Girls, Trail Mix Crew,
  and 8 others are currently inactive) — don't copy Milwaukee's audience-group list activity
  state as a template without checking which ones are actually meant to be live.
- **Tucson's curated-list layer is comparatively thin** (3 lists, 0 audience groups) — confirming
  the audit's suspicion, but the earlier "0 items" concern specifically is resolved (see above).

**Recommendation for Denver:** use Tucson's geography/neighborhood/item foundation as the
structural template (most recent, cleanest launch pipeline), and Phoenix's audience-group +
curated-list overlay structure as the content-layer template, rather than forcing a single metro
to serve both roles.

## Known dangling reference — confirmed still present

`featured_experiences` row `cfb54ce0-bb31-4cab-9927-a42564f87d12` ("Bachelorette Wine Day") has
`list_id` pointing to curated list `a00dd2e3-ac6d-430e-924e-9e97fc19c113` (same title), which has
`is_active=false`. **Confirmed still true via live query** — this was flagged as a known,
not-yet-cleaned-up issue prior to this audit and remains so. Not Denver-specific, but a real
existing-metro cleanup item; don't mistake it for a new finding if it resurfaces in future audits.
**Classification: Safe to defer** — cosmetic (a dead card), not user-facing breakage since
`featured_experiences` navigation would simply land on an inactive/hidden list.

## Inconsistencies to note before copying any pattern wholesale

- Milwaukee has a `starts_at` value with **no matching `ends_at`** on some rows and vice versa —
  not a hard rule violation, but shows the three metros don't follow a uniform "always set both"
  convention.
- Phoenix has an unusually large number of duplicate-titled "The Next 10: Peoria / Glendale"
  lists (10 rows found, all `is_official=false`, likely iterative test/draft lists never cleaned
  up) — don't copy this as a pattern; it looks like leftover draft data, not intentional design.
- Bonus Drop `sort_order` placement (10/21) is **not consistent** even within Phoenix itself — see
  [01](01_current_schema_and_relationships.md)'s live sample (positions 3 and 28 for one list).
  Only the unlock thresholds (9, 15) are consistent. Don't assume any metro's bonus-drop
  positioning is a fixed convention to replicate for Denver.
