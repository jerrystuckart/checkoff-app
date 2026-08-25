# App, edge-function, and DB-trigger metro dependencies

Source: full-repo codebase sweep (grep + read across `screens/`, `components/`, `lib/`,
`supabase/functions/`, `supabase/migrations/`) plus the live DB inspection in
[01_current_schema_and_relationships.md](01_current_schema_and_relationships.md). All file:line
citations below were read directly from the current repo state at commit `9efe3f2`.

## Headline finding: no hardcoded `METRO_SLUGS` array exists

Metro support is genuinely data-driven — one `metro_areas` row plus `neighborhoods`/`items`/
`lists` tagged with its `metro_id` is sufficient for almost the entire app to work for a new
metro with zero code changes. The exceptions below are narrow but real.

## Launch-blocking or launch-blocking-adjacent findings

### 1. `lib/seasonWindow.js` — hardcoded `America/Phoenix`, DST-sensitive (client)

`toPhoenixDateString()` converts every check-in timestamp to its Phoenix-local calendar date via
`Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix' })` before comparing against a list's
bare-date `starts_at`/`ends_at`, "to mirror the DB trigger `prevent_expired_list_checkins()`."
Phoenix does not observe DST (UTC-7 year-round); Denver does (UTC-7 MST / UTC-6 MDT). For
roughly 8 months a year (mid-March–early November — the actual launch season), Denver runs one
hour ahead of Phoenix, which can push a late-night check-in into the wrong Phoenix-calendar day
and miscount season "N of M" progress (`HomeScreen.jsx` season-count block) and themed-list
progress (`PostCheckoffSheet`). **Classification: Launch blocker.**

### 2. DB trigger `prevent_expired_list_checkins()` family — same hardcode, server-side (confirmed live in production, see [01](01_current_schema_and_relationships.md))

Present verbatim in 6 migration files (`20260711_item_deactivation_cleanup.sql`,
`20260714_freeze_checkins_on_partner_cancellation.sql`, `20260716_list_deletion_fk_fixes.sql`,
`20260804_standalone_checkins.sql`, `20260809_seasonal_item_active.sql`), all comparing
`(now() AT TIME ZONE 'America/Phoenix')::date` against a list's `starts_at`/`ends_at`. This is
more serious than the client-side counterpart because it can **incorrectly reject a legitimate
check-in or accept an invalid one** near a list boundary — a functional bug, not just a display
miscount. **Classification: Launch blocker.** Fix needs a `timezone` column on `metro_areas`
(does not currently exist) threaded through this function and `lib/seasonWindow.js` together —
not a data-only fix.

### 3. `get_never_checkin_users()` RPC — hardcoded Phoenix UUID (confirmed via migration source)

`supabase/migrations/20260708_email_automation_rpcs.sql` lines ~324–350 hardcodes
`phoenix_id AS (SELECT '43e9fba2-4a26-4941-817f-db860265ea51'::uuid AS id)` and always pulls its
3 suggested items from that metro, regardless of which metro the zero-activity recipient actually
belongs to. Every Denver signup who doesn't check in within 14 days gets a "get started" email
suggesting Phoenix items. This is a genuine, confirmed DB-level bug, not a hypothetical — the
UUID in the migration matches the live `metro_areas.id` for Phoenix confirmed in
[01](01_current_schema_and_relationships.md) query 9. **Classification: Launch blocker.**
Fix requires joining through the user's onboarding-selected metro (if captured at signup) or
generalizing the suggestion query to not assume a single metro.

### 4. `BrowseListsScreen.jsx` — hardcoded `'phoenix'`/`'Phoenix'` fallback

`const citySlug = route.params?.citySlug ?? 'phoenix'; const metroName = route.params?.metroName ?? 'Phoenix'`
(lines 28–29). Every navigation call into this screen omits params **except** HomeScreen's own
explicit tile — confirmed omitted at `DeepLinkExperienceResolverScreen.jsx:32,63`,
`DeepLinkListResolverScreen.jsx:39,104,110`, `ListSummaryScreen.jsx:114`. A Denver user hitting a
broken/stale deep link, or finishing any list, lands on **Phoenix's** curated lists, not
Denver's. This is a pre-existing bug for Milwaukee/Tucson too, but Denver's launch will surface
it immediately on any failed deep link or post-completion flow. **Classification: Launch-blocking
adjacent** — recommend passing the resolved metro through these navigation calls rather than
defaulting to a literal string.

### 5. `lib/useNearby.js` `NEIGHBORHOOD_CENTERS` — hardcoded Phoenix/Milwaukee-only fallback dict

Used only when an item has no `maps_lat`/`maps_lng` of its own — `fetchItems()` doesn't even
select `neighborhoods.center_geo`, so this hardcoded JS object (Peoria, Glendale, Phoenix,
Scottsdale, Tempe, Mesa, Chandler, Gilbert, Surprise, Anthem, Milwaukee, Brookfield, Waukesha) is
the *only* fallback path. A Denver item missing coordinates and whose neighborhood name isn't in
this dict silently defaults to `ring_weight=0` ("Core" ring) regardless of true distance, in
Nearby. **Mitigation exists**: `scripts/geocode-items.js` backfills `maps_lat`/`maps_lng` from
`city_id`/`neighborhood_id`/`metro_id` center coordinates — if Denver's item-onboarding process
runs this script (or otherwise guarantees coordinates on every item), this finding is moot.
**Classification: Conditional launch blocker** — depends entirely on whether the Denver item
intake process guarantees `maps_lat`/`maps_lng` on every item (see
[05_item_intake_contract.md](05_item_intake_contract.md)).

## Data-driven, not launch-blocking

| Area | File(s) | Mechanism |
|---|---|---|
| City selector population/ordering | `screens/HomeScreen.jsx` `init()` | `metro_areas.eq('is_active', true).order('name')` |
| Home hero, seasonal lists, themed rails, creator tile | `screens/HomeScreen.jsx` `loadForMetro()` | filtered by `metro_id` throughout |
| "Near you right now" rail | `screens/HomeScreen.jsx` `loadNearbyRail()` | explicitly NOT metro-scoped — real GPS distance across all metros, by design (documented QA fix in code comments) |
| Discover/proximity/density | `lib/proximity.js`, `lib/densityTier.js`, `screens/DiscoverScreen.jsx` | pure haversine on `maps_lat`/`maps_lng`, zero metro references |
| Curated list visibility | `lib/useItems.js` `fetchCuratedLists()`/`fetchCuratedListItems()` | `curated_list_metros` join table (list-level), `curated_list_items.city_slug` (item-level overlay) — confirmed live pattern, `curated_lists.city_slug`/`audience_groups.city_slug` explicitly documented in code as legacy/display-only |
| List creation / metro picker | `screens/CreateListScreen.jsx` | `metro_areas.eq('is_active', true)`, auto-selects only if exactly one active metro |
| Deep-link list resolver | `screens/DeepLinkListResolverScreen.jsx` | 4-step slug/title/city_slug fallback chain, fully data-driven |
| Notifications (push, streak) | `supabase/functions/send-notifications`, `streak-reminder` | no metro segmentation at all — global per-user |
| Analytics | — | **no analytics/segmentation SDK exists anywhere in this repo** (grepped, zero hits); Sentry is error-tracking only |
| Monthly recap / dormant / inactive-reengagement RPCs | `20260708_email_automation_rpcs.sql` `get_monthly_recap_users()`, `get_inactive_users()` | derive the user's own top/last metro from their check-in history — correctly generalized |
| `metro_destinations` day-trips | trigger `trg_sync_metro_destinations_new_metro` on `metro_areas` insert | auto-populates via haversine against `destinations` on new metro insert — zero code changes needed |
| Storage/asset paths | `screens/PhotoCheckInScreen.jsx` | `${user.id}/${timestamp}.${ext}` — no city-name convention anywhere in the codebase |
| `adoptCuratedList()` (`lib/useItems.js`) | — | **confirmed dead code** — exported, never imported/called anywhere. The real clone path is `CreateListScreen.jsx:133` via `fetchCuratedListItems(curatedListId, userCitySlug)`. Should not be relied on or referenced as live behavior. |
| `stripe-webhook`'s `metro_anchor` string | `supabase/functions/stripe-webhook/index.ts:40,166` | a partner subscription **plan-tier label** (like `trailhead`/`landmark`), unrelated to geography — not a metro concern |

## Cosmetic-only (non-blocking, worth fixing before a Denver-facing launch)

- `screens/OnboardingScreen.jsx:59` — every new user's onboarding preview hardcodes
  `<SeasonalHeroCard emoji="🍂" title="Phoenix Fall 30" cityTag="Phoenix" />` regardless of the
  new user's actual metro. Marketing/content gap, not a functional bug.
- `screens/CuratedListPreviewScreen.jsx:65,219` — `'Phoenix'` used only as a brief loading-state
  placeholder before the real metro name resolves async; self-corrects.
- `screens/HomeScreen.jsx:37-54` `THEMED_LIST_ACCENTS`, `components/ExperiencesRail.jsx:20` —
  title/slug-keyed accent-color maps; both have generic hash-based fallbacks for unrecognized
  entries, so Denver-titled lists just get an auto-assigned color unless bespoke entries are
  added.
- City-selector default-metro fallback (`HomeScreen.jsx` GPS-denied path) — falls back to
  `metros.find(m => m.name.includes('Phoenix')) ?? metroData?.[0]` when location permission is
  denied entirely. Pre-existing behavior affecting all non-Phoenix metros today, not introduced
  by Denver, but worth flagging since it means Denver users without granted location land on
  Phoenix content by default.

## Whether it's launch-blocking, summarized

| # | Finding | File(s) | Blocking? |
|---|---|---|---|
| 1 | Client season-boundary date logic hardcodes America/Phoenix | `lib/seasonWindow.js` | Yes |
| 2 | DB trigger family hardcodes America/Phoenix | 6 migration files, live in prod | Yes |
| 3 | `get_never_checkin_users()` hardcodes Phoenix metro UUID | `20260708_email_automation_rpcs.sql` | Yes |
| 4 | `BrowseListsScreen` defaults to `'phoenix'` on any param-less nav | 4 call sites | Yes (adjacent) |
| 5 | `useNearby.js` neighborhood-center fallback dict has no Denver entries | `lib/useNearby.js` | Conditional on item geocoding coverage |
| — | Everything else | — | No — genuinely data-driven |
