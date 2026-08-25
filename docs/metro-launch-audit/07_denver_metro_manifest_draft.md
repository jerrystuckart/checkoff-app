# Denver/Boulder metro — proposed manifest (draft, non-executable)

No UUIDs invented. No SQL to be run from this document. This is a decision-staging draft only.

## Recommended display name

`Denver / Boulder Metro` (working name from the audit brief) — matches the existing convention
(`Phoenix Metro`, `Milwaukee Metro`, `Tucson Metro` are single-word-city + "Metro"; Denver/Boulder
is a genuine two-anchor metro, so a compound name is reasonable, but confirm against product
intent before finalizing — a single name may be preferred for consistency with the `slug`
derivation used in the admin tool).

## Candidate slug options and code risks

| Candidate | Risk |
|---|---|
| `denver` | Simplest, matches single-word convention of existing 3 metros. Risk: undersells Boulder/Longmont as first-class per the brief's own requirement. |
| `denver-boulder` | Matches the two-anchor naming reality. Risk: none identified in code — `metro_areas.slug` is free text, no length/format constraint found, and no code path assumes single-word slugs (confirmed via `curated_lists.city_slug`, `list_items.city_slug`, `audience_groups.city_slug` are all plain `text` columns with no CHECK constraint). |
| `front-range` | Regional framing matching the brief's "connected Front Range communities" language. Risk: less discoverable/obvious to users than a named-city slug; no code risk either way. |

No code path was found that hardcodes an assumption about slug format (length, single-word,
no-hyphens) — this is a product decision, not a technical constraint. **Do not choose a final
slug until Jerry decides** per the brief's own instruction; all three options are equally safe
technically.

## Timezone

`America/Denver` (Mountain Time, observes DST). **Requires the timezone fix described in
[01](01_current_schema_and_relationships.md)/[02](02_app_metro_dependencies.md)/[06](06_checkin_join_timezone_deeplink_audit.md)
before Denver items use `season_tag` or before Denver lists rely on `starts_at`/`ends_at`
boundary enforcement.** No `timezone` column exists on `metro_areas` today — this is new schema
work, not a data-entry task.

## Coverage statement

Denver, Boulder, Longmont, and the connected communities between and immediately around them —
Longmont as a first-class coverage area, not an afterthought.

## Included areas (for evaluation — not final)

Denver Central, RiNo/Five Points, LoDo/Union Station, Capitol Hill/Uptown, Highlands/Sunnyside,
Cherry Creek, Washington Park/South Denver, Berkeley/Tennyson, Lakewood, Golden, Arvada,
Westminster, Thornton/Northglenn, Broomfield, Boulder, Louisville/Superior, Lafayette, Erie,
Longmont.

## Explicit exclusions

Fort Collins, Colorado Springs, Estes Park, mountain destinations — consistent with existing
metros' pattern of a `metro_destinations`/`destination_zones` day-trip layer for adjacent-but-not-
core areas (e.g. Phoenix's Willcox Wine Trail) rather than folding them into the core metro.

## Proposed neighborhood taxonomy

The 19 areas listed above map reasonably to individual `neighborhoods` rows under one
`metro_areas` row, following Tucson's structural pattern (17 neighborhoods) rather than Milwaukee's
(39, apparently more granular) or Phoenix's (12, apparently coarser). **Open decision**: whether
Golden/Lakewood/Arvada/Westminster/Broomfield (west/northwest suburbs) and
Boulder/Louisville/Superior/Lafayette/Erie/Longmont (Boulder County) should each be their own
`neighborhoods` rows, or whether some should be grouped — this determines ring-radius risk
directly (see below) and needs a product decision on desired granularity, not just a technical
default.

**Hard requirement given the ring-radius finding**: whatever granularity is chosen, each
Denver-area `neighborhoods.ring_1_radius_m`/`ring_2_radius_m` must be set well below the schema
defaults (20mi/40mi) — these neighborhoods are 3-8 miles apart, not 20+ like Phoenix's. Exact
values are an open product/geography decision, not invented here.

## Required metro-only and state tags

No metro-scoped tag mechanism exists in the schema (`tags` is a flat global table, no
metro/city column) — see [05](05_item_intake_contract.md). If "Denver-only tags" is a real
product requirement, it needs new schema (e.g. a `tags.metro_id` nullable FK), not just data
entry. **Open technical decision.**

## Required public list shells

Following the pattern consistent across all 3 metros (confirmed in [03](03_existing_metro_comparison.md)):
one `"{Season} {Year} — Denver / Boulder Metro"`-titled official/public list per active season,
with the operational rule from [04](04_list_model_and_seasonal_selection.md) — only one
official+public list should have the earliest `ends_at` for any given active window, to avoid
depending on the stable-sort tie-break behavior that currently (accidentally) resolves collisions
for the existing 3 metros.

## Required asset set

- `metro_areas.hero_images` — at least 2-3 images (matching existing metros' 2-3 count)
- Denver-specific onboarding preview content to replace the hardcoded "Phoenix Fall 30" mock
  (`screens/OnboardingScreen.jsx:59`) — cosmetic but a real content gap for a Denver-facing launch
- Curated-list header images per audience group, following Phoenix's most-complete pattern

## Recommended hidden/coming-soon/staged behavior

**Blocked by the confirmed RLS gap** — `curated_lists.is_active=false` does not currently hide a
row from public read (see [01](01_current_schema_and_relationships.md)). Staging Denver curated
lists as inactive before go-live will not work as "hidden" until that RLS policy is fixed.
`metro_areas.is_active=false` was not verified to gate city-selector visibility with the same
certainty — `screens/HomeScreen.jsx`'s city selector query explicitly filters
`.eq('is_active', true)` (confirmed by the codebase sweep), so **`metro_areas.is_active=false` is
a working "hidden from selector" mechanism** and can safely be used to stage Denver's foundation
rows before a coordinated flip to `true` at launch. Recommend: build out Denver's `metro_areas`
row as `is_active=false`, populate neighborhoods/items/lists/curated content in full, verify via
direct DB queries or an internal test build, then flip `metro_areas.is_active=true` as the actual
launch trigger — but do NOT rely on `curated_lists.is_active=false` for the same purpose until
its RLS gap is closed.

## Open product decisions

1. Final slug (`denver` / `denver-boulder` / `front-range` / other)
2. Final neighborhood granularity/grouping for the west suburbs and Boulder County
3. Which items get `season_tag` at launch (directly determines whether the timezone fix is a hard
   launch blocker or can be deferred)
4. Whether Denver needs metro-scoped tags (new schema) or can use the existing global `tags` table
5. Audience-group content strategy — Phoenix's model (8 groups, broad) vs. Tucson's (0 groups,
   thin) vs. something new for Denver

## Open technical decisions

1. `metro_areas.timezone` column design and how it threads through
   `prevent_expired_list_checkins()`, `apply_seasonal_active_on_tag_change()`,
   `sync_seasonal_item_active()`, `season_days_until_start()`, and `lib/seasonWindow.js`
2. Fix for `curated_lists`' double RLS policy (drop the `USING(true)` policy, or merge into the
   `is_active=true` one)
3. Fix for `get_never_checkin_users()`'s hardcoded Phoenix UUID
4. Fix for `BrowseListsScreen.jsx`'s hardcoded `'phoenix'` fallback on param-less navigation
5. Whether `lib/useNearby.js`'s `NEIGHBORHOOD_CENTERS` dict needs Denver entries added, or whether
   the item-geocoding process (`scripts/geocode-items.js`) is enforced strongly enough to make
   this moot
6. Denver-area `ring_1_radius_m`/`ring_2_radius_m` values per neighborhood
7. Whether `checkoff_admin.html` (not in this repo — see README) needs a code change for a
   Denver metro dropdown, or auto-derives from `metro_areas` with no edit needed — unresolved,
   requires reading that file directly, outside this audit's repo-scoped access

## Launch blockers (consolidated from all prior docs)

1. Timezone hardcoding (DB triggers + `lib/seasonWindow.js`) — America/Phoenix, DST-insensitive
2. `get_never_checkin_users()` hardcoded Phoenix metro UUID
3. `curated_lists` RLS double-policy (blocks safe pre-launch staging via `is_active`)
4. `BrowseListsScreen.jsx` hardcoded `'phoenix'` fallback on failed deep links / post-completion
5. Neighborhood ring-radius defaults (20mi/40mi) too wide for Denver's tight geography
6. Conditional: `useNearby.js` fallback dictionary, if Denver items aren't fully geocoded
