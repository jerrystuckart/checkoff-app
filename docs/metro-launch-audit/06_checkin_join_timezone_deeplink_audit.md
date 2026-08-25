# Check-off, joining, timezone, deep-link, asset, and analytics audit

## Public check-off / joining behavior

| Path | Confirmed behavior |
|---|---|
| Public item check-off without joining | Confirmed possible — RLS on `list_items`/`check_ins` does not require `list_members` for read/insert on public lists; `check_ins.list_item_id` is nullable (standalone check-ins, see below) |
| Official-list joining from Home | `list_members` insert; `lists_auto_add_creator` trigger auto-adds the creator on list creation, but joining an existing public/official list is a separate explicit action (not traced to exact screen in this pass) |
| Standalone check-in (no list at all) | **Confirmed live**, added by `20260804_standalone_checkins.sql`, refined by `20260806_drop_standalone_lifetime_unique.sql`. `check_ins.item_id` is the canonical reference when `list_item_id IS NULL`. Validated directly against `items.is_active` by `prevent_expired_list_checkins()`'s standalone branch. |
| Standalone check-in uniqueness | **Changed 2026-08-06**: no longer a lifetime unique constraint. Same item can be re-checked each season — season membership is deliberately never stored on the row, computed at read time via `lib/seasonWindow.js`. De-dup within the same season is app-layer only (`isWithinWindow`/`getCurrentSeasonWindow` in `ItemDetailScreen.jsx`/`PhotoCheckInScreen.jsx`), explicitly best-effort by design (migration comment: "a rare true-simultaneous duplicate standalone row is an accepted tradeoff"). |
| Retroactive list credit | List-attached check-ins whose `list_items` row is later deleted collapse into the standalone bucket via `check_ins_list_item_id_fkey ON DELETE SET NULL` (added 20260716) — not lost, but their identity as "was list-attached" is not preserved. |
| Points | `points_awarded` stored per check-in (numeric, not derived from `items.difficulty` at read time — snapshotted at check-in time via `sync_lifetime_points`/`sync_lifetime_points_delete` triggers) |
| Streaks | `update_user_streak()` trigger, AFTER INSERT on `check_ins` |
| Badges | `check_and_award_badges()` trigger, AFTER INSERT on `check_ins`; `badge_definitions` table is a flat lookup, no metro scoping |
| Notifications | `queue_checkin_notification()` trigger; `queue_leaderboard_nudges()` trigger — both AFTER INSERT on `check_ins`, feed `notification_queue`, processed by the `process-notification-queue` edge function on a 1-minute pg_cron job |
| Weekly recap | `queue_weekly_summaries()` — pg_cron `weekly-summaries` job, Mondays 2am UTC |
| Monthly recap | `get_monthly_recap_users()` RPC — **confirmed metro-aware**, derives `top_metro` from the user's own check-in history, joins `metro_areas` for display name, recommends items scoped to that metro. Fully data-driven, works correctly for Denver automatically. |
| Unchecking | Not directly traced in this pass — `check_ins` deletion triggers `after_checkin_delete` → `sync_lifetime_points_delete()`, confirms points are correctly reversed on delete |

## Confirmed inconsistencies

1. **`get_never_checkin_users()` hardcodes Phoenix's metro UUID** for suggested items to every
   zero-activity user regardless of metro. **Launch blocker** — see [02](02_app_metro_dependencies.md).
2. **Timezone hardcoding** in both `prevent_expired_list_checkins()` (DB, 6 migrations) and
   `lib/seasonWindow.js` (client) — America/Phoenix, DST-insensitive to Denver. **Launch blocker**
   — see [01](01_current_schema_and_relationships.md) and [02](02_app_metro_dependencies.md).
3. **Standalone check-in de-dup is best-effort by explicit design**, not a Denver-specific gap —
   applies identically to all metros, not blocking.

## Timezone — consolidated verdict

Confirmed live in production (not merely present in an unapplied local migration file — see
[01](01_current_schema_and_relationships.md) for the `supabase migration list` finding that
explains why the local "unapplied" framing was stale):

- **DB-level**: `apply_seasonal_active_on_tag_change()`, `sync_seasonal_item_active()` (+ its
  monthly pg_cron job), `season_days_until_start()`, and `prevent_expired_list_checkins()` (found
  in 6 separate migration files, all with the identical hardcode) all use
  `now() AT TIME ZONE 'America/Phoenix'`.
- **Client-level**: `lib/seasonFilter.js` uses `new Date().getMonth()` (device-local clock, not
  city-specific — low risk, see [02](02_app_metro_dependencies.md)). `lib/seasonWindow.js` uses
  `Intl.DateTimeFormat(..., {timeZone:'America/Phoenix'})` explicitly to mirror the DB trigger —
  **this one is the real client-side risk**, DST-sensitive exactly like its DB counterpart.
- **Who's exposed today**: Milwaukee (56 season_tag items) and Tucson (4 season_tag items)
  already have live season-tagged items being evaluated on Arizona's clock — not a
  Denver-specific future risk, a present cross-metro one.
- **Fix scope**: requires a `timezone` column on `metro_areas` (does not exist in any reviewed
  migration) threaded through 4 DB functions and `lib/seasonWindow.js` together. **Not a
  data-only fix.**
- **Classification**: **Launch blocker if Denver items use `season_tag`** at launch (Denver
  observes DST; Phoenix doesn't, so the drift is real for ~8 months/year, which covers essentially
  the entire prospective launch season). Independently, **already overdue for Milwaukee/Tucson.**

## Assets, web, and deep links

| Asset/link type | Status |
|---|---|
| Metro hero images | `metro_areas.hero_images` (text[]), Phoenix has 3, Milwaukee/Tucson have 2 each. Random pick on Home load. **Denver needs this array populated** or the hero falls back to a gradient/no-photo look (cosmetic only, not blocking). |
| Item images | Full URLs, no filename/city-name convention |
| Storage buckets | `checkin-photos` (public), `checkoff-images` (public), `submission-photos` (private) — no city-scoped bucket or path prefix anywhere in the codebase |
| City selector image | Not found as a distinct asset type — the selector renders metro rows from `metro_areas` directly (name/slug text, per [02](02_app_metro_dependencies.md)'s city-selector finding); no separate per-metro selector icon/image field exists in the schema |
| Website metro page | **UNKNOWN** — this repo does not contain the marketing website (`getcheckoff-site`, per prior memory, is a separate deploy target not in this repo's scope) |
| App Store / download link | Not evaluated in this pass — outside repo scope |
| QR / custom-scheme / universal links | `checkoff://list?id=SLUG&city=CITY_SLUG` confirmed as the working custom scheme via `DeepLinkListResolverScreen.jsx`'s 4-tier resolution (slug+city exact → slug-only exact → title-pattern+city → title-pattern any city). This is **proven working**, not planned. |
| List join links | Via `invite_code` on `lists`, RLS policy `lists: read via invite code` confirms this is a live, working mechanism |
| AASA/Android app-link association files | **UNKNOWN — not found in this repo pass**; typically live in `public/.well-known/apple-app-site-association` on the website repo or as a static asset — outside this repo's scope, flag for Jerry to confirm location |

**Separate finding, restated from [02](02_app_metro_dependencies.md):** `BrowseListsScreen.jsx`
defaults to `'phoenix'`/`'Phoenix'` on any deep link that fails to resolve or any post-list-
completion flow — this is the deep-link behavior most directly relevant to Denver's actual launch
experience, more so than the AASA/QR mechanics above, which are metro-agnostic and already work.

## Analytics — what's measurable today

**No analytics/segmentation SDK exists anywhere in this repository** (confirmed by the codebase
sweep — zero hits for Mixpanel/Amplitude/Segment/etc.). Sentry is present but used for error
tracking only; no `setTag`/`setContext`/`setUser` calls carry metro data.

The only structured event-tracking table is `interaction_events` (`user_id, event_type, list_id,
item_id, occurred_at`). Live distinct `event_type` values in production:

| event_type | count |
|---|---|
| `list_view` | 246 |
| `item_view` | 230 |
| `directions_click` | 40 |
| `url_click` | 27 |
| `dare_click` | 10 |

**What can be measured for Denver today without new product work:**
- List views, item views, directions/URL/dare clicks — all segmentable by joining through
  `lists.metro_id`/`items.neighborhood_id → neighborhoods.metro_id`.
- Check-ins, unique completed items, points, streaks, badges — all standard `check_ins`/
  `user_badges` queries, joinable to metro the same way.
- New vs. existing user — via `users.created_at` vs. `check_ins`/`interaction_events` history.
- Save/list addition — via `list_members` join timestamps.
- Business referral/amplification — via `partner_visits`, `promotion_redemptions`,
  `invite_referrals` (not deeply audited in this pass; tables exist and appear metro-joinable
  through their respective FK chains).

**What cannot be measured without new product work:** QR-source or deep-link-source attribution
(no `source`/`utm`-style column found on `interaction_events` or `check_ins`) — `invite_referrals`
may partially cover referral-source tracking but wasn't traced to a QR-specific field in this
pass. **UNKNOWN — needs a direct schema read of `invite_referrals`** if QR-source segmentation is
a Denver launch requirement.

## Proposed Denver launch scorecard (currently-measurable fields only)

- Neighborhoods live, items live (active, non-universal), items geocoded (%)
- Official/public lists live, avg items per list
- Curated lists live per audience group, curated_list_metros coverage (%)
- Signups by metro (via `users` + onboarding-selected metro, if captured)
- Check-ins by metro, unique items checked off by metro
- `list_view`/`item_view`/`directions_click`/`url_click` counts scoped to Denver's `lists.metro_id`
- Points/streaks/badges awarded, Denver-scoped
- Zero-activity users (14-day) — **do not trust this cohort's suggested-items email until the
  `get_never_checkin_users()` Phoenix-UUID hardcode is fixed** (see above)
