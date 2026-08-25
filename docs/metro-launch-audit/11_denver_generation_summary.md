# Denver foundation + platform fixes — generation summary

Generated 2026-08-21, in response to the review-only follow-up prompt. **Nothing in this section
or any file it references was applied, committed, pushed, built, or deployed.** All SQL files are
new, un-run migration files; all application-code changes are diff files under `patches/`, not
edits to the tracked working tree; `lib/resolveDefaultMetro.js` is a new file only referenced by
the (unapplied) `BrowseListsScreen.jsx.diff`.

## 1. Every file generated

| File | Contents |
|---|---|
| [supabase/migrations/20260821_metro_timezone_platform_fix.sql](../../supabase/migrations/20260821_metro_timezone_platform_fix.sql) | A1 — adds `metro_areas.timezone`, backfills existing metros, rewrites 4 DB functions (`apply_seasonal_active_on_tag_change`, `sync_seasonal_item_active`, `season_days_until_start`, `prevent_expired_list_checkins`) to resolve timezone per-metro via two new helper functions instead of hardcoding America/Phoenix |
| [supabase/migrations/20260821_curated_lists_rls_fix.sql](../../supabase/migrations/20260821_curated_lists_rls_fix.sql) | A2 — drops the redundant `USING(true)` policy on `curated_lists`, after confirming no app flow depends on it |
| [supabase/migrations/20260821_never_checkin_users_metro_fix.sql](../../supabase/migrations/20260821_never_checkin_users_metro_fix.sql) | A3 — replaces the hardcoded Phoenix-metro suggestion query with a universal-item-first, globally-popular-fallback query (true per-user metro derivation isn't possible — see finding 3 below) |
| [patches/BrowseListsScreen.jsx.diff](patches/BrowseListsScreen.jsx.diff) | A4 — replaces the hardcoded `'phoenix'`/`'Phoenix'` default with a GPS-nearest-metro resolution via the new helper |
| [patches/DeepLinkListResolverScreen.jsx.diff](patches/DeepLinkListResolverScreen.jsx.diff) | A4 — threads the deep link's own `city` param through to `BrowseLists` on its 2 fetch-failure fallback paths instead of discarding it |
| [lib/resolveDefaultMetro.js](../../lib/resolveDefaultMetro.js) | A4 — new shared helper, extracted from `HomeScreen.jsx`'s existing GPS-nearest-metro logic, used by the `BrowseListsScreen.jsx` diff |
| [patches/lib_seasonWindow.js.diff](patches/lib_seasonWindow.js.diff) | A1 (client half) — `isWithinWindow()`/`toMetroDateString()` accept an optional metro timezone (default `America/Phoenix`, unchanged behavior until callers are updated — see finding 4) |
| [supabase/migrations/20260821_denver_metro_foundation.sql](../../supabase/migrations/20260821_denver_metro_foundation.sql) | B1-B4, B7 — `metro_areas` row (`is_active=false`), 19 `neighborhoods` rows with Places-API-confirmed coordinates and individually tiered ring radii, 8 `audience_groups` rows implementing doc 09's draft, one official/public seasonal list shell (no items), 8 `curated_lists` + `curated_list_metros` rows (no items) |
| [09_denver_audience_groups_draft.md](09_denver_audience_groups_draft.md) | B5 — product-judgment draft: 8 proposed Denver/Boulder audience groups with 1-line reasoning each, open questions for Jerry |
| [10_denver_followups_not_done.md](10_denver_followups_not_done.md) | B6, B8 — item staging and asset gaps, explicitly flagged as not attempted |
| [patches/denver_neighborhood_places_results.json](patches/denver_neighborhood_places_results.json) | Raw Google Places API responses for all 19 neighborhood coordinates, for review alongside the foundation migration |

## 2. Judgment calls made — separate from confirmed audit findings

These are calls I made, not settled facts — react to them:

1. **Denver's display name defaults to "Denver Metro"** (single-word convention match), with the
   compound `"Denver / Boulder Metro"` flagged as a real alternative given Longmont/Boulder's
   first-class-coverage requirement. No code risk either way — pure naming call.
2. **Neighborhood ring-radius values** (5 tiers, 150m-4000m) were calibrated by me to satisfy one
   invariant — no two ring_2 circles overlap anywhere in the 19-neighborhood set, verified
   programmatically — not derived from any documented CheckOff design rule (none was found).
   Reasonable local knowledge could justify different exact numbers within each tier.
3. **`get_never_checkin_users()`'s fix is a compromise, not the requested fix.** True per-user
   metro derivation was requested but is not possible with current data — `users.neighborhood_id`
   and `users.city_id` are both 0% populated (confirmed via live query across all 112 users), and
   no client-side selected-metro state is ever persisted anywhere in the codebase (confirmed via
   grep). The universal-item-first / global-popularity-fallback approach implemented instead is my
   judgment call on the best available substitute — see that migration's header for full reasoning.
4. **`lib/seasonWindow.js`'s fix is partial by design.** `isWithinWindow()` now accepts a metro
   timezone parameter, but none of its 5 real call sites (`HomeScreen.jsx` x2,
   `PostCheckoffSheet.jsx` x3) were updated to pass one — behavior is unchanged until a follow-up
   patch threads it through, which needs a direct read of `PostCheckoffSheet.jsx` (not done in
   this pass) to confirm what metro context is available at each of its 3 call sites.
5. **`season_days_until_start()`'s signature change** (adding `p_metro_id`) is unverified against
   any real caller — the function has zero call sites in the app today.
6. **Denver's 8 audience groups** (names, count, and the split between "kept as-is from Phoenix"
   vs. "new Denver-specific") — see [09_denver_audience_groups_draft.md](09_denver_audience_groups_draft.md)
   in full; this is the most product-judgment-heavy output of this whole pass.
7. **BrowseListsScreen's no-context fallback** now does a real GPS-nearest lookup instead of a
   hardcoded string — but when GPS is unavailable, it falls back to "first active metro
   alphabetically," which is a genuine behavior change (previously: always Phoenix) that a
   reviewer might want to reconsider (e.g. should it show a metro picker instead of silently
   guessing?).
8. **Foundation SQL Section 4's list creator_id, title, and dates are all placeholders** — the
   `creator_id` subquery (oldest admin user) is a guess at what pattern other metros' official
   lists actually use, not verified against their real rows in this pass.

## 3. What could not be completed, and why

| Item | Why not completed |
|---|---|
| True per-user metro derivation for `get_never_checkin_users()` | No stored per-user metro signal exists anywhere in the current schema or app state (see judgment call 3 above) — this needs new onboarding-flow + schema work, out of scope for a fix-in-place pass |
| `lib/seasonWindow.js` callers fully threaded | `PostCheckoffSheet.jsx`'s 3 call sites weren't read in this pass to confirm what metro context (if any) is available at each; `HomeScreen.jsx`'s 2 call sites ARE traceable (list rows carry `metro_id`) but weren't patched to keep this diff's blast radius contained to `seasonWindow.js` itself, per its own header note |
| `season_days_until_start()` real-world verification | Zero live callers exist to verify the new signature against |
| Denver item staging (B6) | Explicitly out of scope per the prompt — needs a real item list from Jerry, not fabricated placeholders |
| Denver visual assets (B8) | Explicitly out of scope per the prompt — needs real imagery/copywriting, not generated here |
| `checkoff_admin.html` metro-dropdown behavior | File lives outside this repo (confirmed in the original audit's README) — inaccessible to this pass |
| Foundation SQL Section 4's real launch-window dates and creator_id | Product decisions / other-metros'-actual-pattern verification not made/done in this pass — left as explicit placeholders, flagged in the migration's own footer comment |

## 4. Confirmation

No SQL was executed against the database. No migrations were applied. No files were committed.
No branch was pushed. No build or deploy was triggered. `screens/BrowseListsScreen.jsx`,
`screens/DeepLinkListResolverScreen.jsx`, and `lib/seasonWindow.js` remain exactly as they were —
their proposed changes exist only as `.diff` files under `patches/`, for manual review and
application. `lib/resolveDefaultMetro.js` is the only new file written directly into the working
tree (since it doesn't yet exist, there is no "original" to diff against) — it is inert until
`BrowseListsScreen.jsx.diff` is applied and actually imports it.

## Verification queries to run after applying (do not run now — nothing exists to query yet)

From [08_future_metro_build_sequence.md](08_future_metro_build_sequence.md) step 7, scoped to
Denver once `20260821_denver_metro_foundation.sql` has actually been applied:

```sql
-- Metro rollup, scoped to Denver
SELECT m.id AS metro_id, m.name, m.slug,
  (SELECT count(*) FROM neighborhoods n WHERE n.metro_id=m.id) AS neighborhood_count,
  (SELECT count(*) FROM items i JOIN neighborhoods n ON n.id=i.neighborhood_id
     WHERE n.metro_id=m.id AND i.is_active AND NOT i.is_universal) AS active_non_universal_items_via_neighborhood,
  (SELECT count(*) FROM lists l WHERE l.metro_id=m.id AND l.is_public) AS active_public_lists,
  (SELECT count(*) FROM lists l WHERE l.metro_id=m.id AND l.is_official) AS official_lists_total
FROM metro_areas m WHERE m.slug = 'denver';

-- Official-lists collision check, scoped to Denver
SELECT l.title, l.is_official, l.starts_at, l.ends_at
FROM lists l WHERE l.metro_id = (SELECT id FROM metro_areas WHERE slug = 'denver')
  AND (l.starts_at IS NOT NULL OR l.ends_at IS NOT NULL);
```

Also worth running specifically for this generation pass (not in doc 08, added here since this
pass introduced new mechanisms to verify):

```sql
-- Confirm the curated_lists RLS fix took effect
SELECT policyname, cmd, qual FROM pg_policies
WHERE schemaname='public' AND tablename='curated_lists' ORDER BY policyname;
-- expect exactly 2 rows (admin write, is_active-gated public read)

-- Confirm metro_areas.timezone backfill
SELECT slug, timezone FROM metro_areas ORDER BY slug;
-- expect phoenix = America/Phoenix, milwaukee = America/Chicago,
-- tucson = America/Phoenix, denver = America/Denver
-- (see docs/metro-launch-audit/12_followup_timezone_and_placeholder_review.md
-- for why Milwaukee is NOT America/Phoenix — a bug caught after this
-- summary was first written)

-- Confirm no neighborhood ring_2 circles actually overlap in production
-- (re-derive from real center_geo rather than trusting the migration's
-- own pre-verified values)
SELECT a.name, b.name,
  ST_Distance(a.center_geo::geography, b.center_geo::geography) AS dist_m,
  a.ring_2_radius_m + b.ring_2_radius_m AS ring_sum_m
FROM neighborhoods a JOIN neighborhoods b ON a.id < b.id
WHERE a.metro_id = (SELECT id FROM metro_areas WHERE slug='denver')
  AND b.metro_id = a.metro_id
  AND ST_Distance(a.center_geo::geography, b.center_geo::geography) < (a.ring_2_radius_m + b.ring_2_radius_m);
-- expect zero rows
```
