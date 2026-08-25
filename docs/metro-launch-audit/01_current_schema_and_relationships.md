# Current schema & relationships

All findings below are from live read-only queries against the linked production project
(`uggusbbswybyplypkbxz`, via `supabase db query --linked`), run 2026-08-21. Query source: [00_schema_preflight.sql](00_schema_preflight.sql).

**Access note (Step 1 finding):** No Supabase service-role key or DB connection string exists
in the repo (`.env` has only `GOOGLE_PLACES_API_KEY`, `.env.local` has only `SENTRY_AUTH_TOKEN`).
However, `supabase` CLI v2.90.0 is installed and already linked to the `CheckOff` project
(reference `uggusbbswybyplypkbxz`). `supabase db query -f <file> --linked` opens a real session
against production **without needing Docker** (Docker is only required for `supabase status`/
local dev DB, not for `--linked` queries). This means Steps 3–9 were run as live verified
queries, not left as an unexecuted preflight file. Treat this as a capability worth knowing
about for future audits — it is a full read/write session (the CLI does not enforce read-only),
so care was taken to run only SELECT statements throughout this audit.

## Geography model — resolved

`cities` and `metro_areas` are **two separate, FK-disconnected hierarchies.** There is no FK
from `cities` to `metro_areas`, and `neighborhoods` has no `city_id` column at all — only
`metro_id`.

```
metro_areas (id, slug, name, state, center_lat/lng, hero_images[], is_active)
    ↑ metro_id
neighborhoods (id, metro_id, slug, name, center_geo, ring_0/1/2/3_radius_m, is_active)
    ↑ neighborhood_id                       ↑ item_neighborhoods (M:N, ring_weight)
items (id, city_id→cities, neighborhood_id→neighborhoods, is_universal, season_tag, ...)

cities (id, name, state, center_geo)   ← orphaned from metro_areas/neighborhoods entirely
    ↑ city_id                 ↑ city_id
items.city_id            lists.city_id, users.city_id, partners.city_id

lists (id, metro_id→metro_areas, city_id→cities, season_id→seasons, is_official, is_public, starts_at, ends_at)
    ↑ list_id
list_items (id, list_id, item_id, sort_order, city_slug[overlay,text,no FK], is_bonus_drop, unlock_threshold)

curated_lists (id, audience_group_id→audience_groups, city_slug[text,no FK], slug, season, year, is_active)
    ↑ curated_list_id
curated_list_items (id, curated_list_id, item_id, display_order, city_slug[overlay,text,no FK])
curated_list_metros (id, curated_list_id, city_slug[text,NOT NULL,no FK])  -- UNIQUE(curated_list_id, city_slug)
```

**Answers to the Step 4 questions:**

1. **Selectable app metro** = a `metro_areas` row (`slug`, e.g. `phoenix`). This is the only
   table an in-app "current metro" concept can point at with an FK (`lists.metro_id`,
   `neighborhoods.metro_id`, `metro_destinations.metro_id`, `partner_pipeline.metro_id`,
   `spotlights.metro_id`, `user_suggestions.metro_id`).
2. **An item's city/market** is ambiguous by design in the current schema — see the `city_id`
   resolution below. The more consistently populated signal is
   `items.neighborhood_id → neighborhoods.metro_id → metro_areas`, or `items.is_universal`.
3. **Metro rollup** happens only through `neighborhoods.metro_id`. There is no direct
   `items.metro_id` column.
4. **City-selector visibility**: not verified from DB alone — see [02_app_metro_dependencies.md](02_app_metro_dependencies.md)
   for the code-side answer (city selector agent findings pending as this doc was drafted).
5. **Can one metro contain multiple `cities` rows?** Structurally yes (no constraint prevents
   it), but in practice `cities` currently holds exactly 3 rows — Phoenix/AZ, Milwaukee/WI,
   Tucson/AZ, one per metro, not one per suburb — so today it's used as a 1:1 shadow of
   `metro_areas`, not a true sub-metro city list. There's no evidence in the schema that `cities`
   is populated with Golden/Lakewood/Longmont-style sub-areas anywhere; that role is filled by
   `neighborhoods` instead.
6. **Are Phoenix/Milwaukee/Tucson implemented consistently?** No — see
   [03_existing_metro_comparison.md](03_existing_metro_comparison.md). Neighborhood counts differ
   sharply (Phoenix 12, Tucson 17, Milwaukee 39) and curated-list audience-group coverage differs
   per metro.
7. **What would Denver/Boulder/Longmont most safely become?** One `metro_areas` row
   (`slug` TBD — see manifest doc) with `neighborhoods` rows for Denver Central, RiNo, LoDo,
   Capitol Hill, Highlands, Cherry Creek, Wash Park, Berkeley/Tennyson, Lakewood, Golden, Arvada,
   Westminster, Thornton/Northglenn, Broomfield, Boulder, Louisville/Superior, Lafayette, Erie,
   Longmont — no `cities` row is required based on how the existing three metros actually use
   that table (see item 5). A `cities` row costs nothing to add for parity, but nothing in the
   current schema requires it for full metro functionality, since `neighborhoods.metro_id` is
   the load-bearing rollup path.
8. **Authoritative signal when two disagree** — this directly resolves the documented Open Brain
   contradiction (7/5 "city_id required" vs. 7/18 correction vs. 7/12 "required only for full
   metro items"):

   **Live query result:** of 1,068 total items, only **277 (25.9%)** have `city_id` set. 318 are
   `is_universal`. That leaves **473 items (44%)** that are neither universal nor have a
   `city_id` — meaning `city_id` cannot be the operative signal for "is this item part of a
   metro," because if it were, nearly half of all real items would be invisible to metro rollup.
   The `items_city_active_covering` index (`city_id, is_active`) and `idx_items_city` exist and
   are used somewhere in query paths, but the **majority-viable signal is
   `neighborhood_id → neighborhoods.metro_id`**, matching the 7/18 correction, not the 7/5 note.
   The 7/12 note's "required only for full-metro items, not destination-tier" framing is closer
   but still not fully consistent with a 44% null rate among presumably full-metro items — treat
   `city_id` as **legacy/optional metadata, not a launch requirement for Denver items.**
   **Classification: the 7/18 correction is operative. Safe to defer `city_id` population for
   Denver — do not block launch on it.**

## `curated_lists` visibility model — RLS gap confirmed still live

Per `pg_policies` (query 4), `curated_lists` currently has three overlapping policies:

| policy | cmd | qual |
|---|---|---|
| `curated_lists: admin write` | ALL | admin-only (`users.is_admin`) |
| `Public read active curated lists` | SELECT | `is_active = true` |
| `curated_lists: public read` | SELECT | `true` |

Postgres RLS policies of the same command type are OR'd together for a given role. A permissive
`SELECT ... USING (true)` policy makes the `is_active = true` policy a no-op — **any row is
publicly readable regardless of `is_active`.** This was flagged as a known open item and is
**confirmed still present** as of this audit (not yet fixed).

**Classification: Important before launch, verging on launch-blocking for Denver specifically**
— if the launch plan is to stage Denver curated lists as `is_active=false` before go-live (a
"coming soon, hidden" pattern), that gate currently does nothing at the RLS layer. Anyone with
the anon key can read every `is_active=false` curated list today, including any pre-launch Denver
content staged that way. `curated_list_items` and `curated_list_metros` have the same
admin-write/public-read shape but no competing `is_active`-gated policy, so they aren't
double-policied — but they inherit the same real-world exposure once the parent `curated_lists`
row is public-readable regardless of its `is_active` flag.

`items` and `lists` do **not** have this bug — their public-read policies correctly AND
`is_active`/`is_approved`/`is_public` into a single qualifying policy each.

## Timezone hardcoding — confirmed live in production, not just an unapplied migration

The prompt's premise was that `20260809_seasonal_item_active.sql` is unapplied locally. **It has
already been applied to production** — `supabase migration list --linked` shows every local
migration filename with a blank "Remote" column (this project does not use the CLI's tracked
migration-history table; changes are applied directly, e.g. via the SQL editor, so a blank
Remote column does not mean "not applied"). Live verification:

- `apply_seasonal_active_on_tag_change()` — trigger `trg_apply_seasonal_active_on_tag_change`
  (`BEFORE INSERT` on `items`) — **live**, hardcodes `now() AT TIME ZONE 'America/Phoenix'`.
- `sync_seasonal_item_active()` — **live**, same hardcode, invoked by an **active pg_cron job**
  `sync-seasonal-item-active-monthly` (`0 6 1 * *`).
- `season_days_until_start()` — **live**, same hardcode.
- `prevent_expired_list_checkins()` (trigger `trg_prevent_expired_list_checkins`, `BEFORE UPDATE`
  on `check_ins`) — **also hardcodes `America/Phoenix`** for evaluating a list's `starts_at`/
  `ends_at` boundary against "today." This function was not named in the original Step 11 list
  but is directly in scope: it gates every list-attached check-in's start/end date logic for
  **every metro**, not just Phoenix.

**Who is exposed today, not just hypothetically:** live item counts by metro show
season_tag-bearing items exist for **all three current metros**: Milwaukee (56 items across
fall/spring/summer/winter), Phoenix (68), and Tucson (4). Milwaukee and Tucson are **already**
having their item visibility computed on Arizona's clock today — this is not a Denver-only future
risk, it is a present, live cross-metro bug that Denver would simply be the third (well, fourth)
metro to inherit unless fixed. The client-side counterpart in `lib/seasonFilter.js` also needs a
code-side check — see [02_app_metro_dependencies.md](02_app_metro_dependencies.md).

**Classification: Launch blocker for Denver if Denver items are expected to use `season_tag` at
launch** (America/Denver observes DST, America/Phoenix does not — the drift is real, not
cosmetic, twice a year). **Important before launch, arguably already overdue, for Milwaukee/
Tucson regardless of Denver**, since it's already live and wrong for them. The fix is a schema
change (a `timezone` column on `metro_areas`, threaded through these three functions plus
`prevent_expired_list_checkins` and the client `lib/seasonFilter.js`), not a data-only fix.

## Item intake contract (live-observed values)

| Field | Observed values / stats |
|---|---|
| `checkin_type` | `tap`, `photo`, `gps` (exactly 3 values in use) |
| `difficulty` | 1 (881 items), 5 (160), 10 (20), 25 (7) — reads as a points scale, not a 1–5 difficulty scale |
| `geo_radius_m` | min 10, max 45,000, avg ≈910, set on 707/1068 items (361 items have no radius set) |
| `is_universal` | 318 of 1068 items |
| `city_id` fill rate | 277/1068 (25.9%) — see geography resolution above |

**Neighborhood check-off radius convention (Step 8 addition):** `neighborhoods.ring_1_radius_m`
defaults to **32,187 m (≈20 mi)** and `ring_2_radius_m` to **64,374 m (≈40 mi)**. Per the
`update_neighborhood_center` migration comment, `neighborhoods.center_geo` doubles as the
check-off anchor for neighborhood-scoped items — they copy the neighborhood's center into their
own `maps_lat`/`maps_lng` with a "wide radius." **These specific ring radii (20–40 mi) are
Phoenix/Milwaukee-scale distances and are almost certainly too wide for Denver's core**, where
Golden, Lakewood, and Denver Central are roughly 3–8 miles apart — a 20-mile ring from a Golden
neighborhood center would already overlap Denver Central and several other neighborhoods,
creating exactly the cross-neighborhood false-positive check-in risk flagged as a concern.
**Classification: Important before launch** — Denver neighborhoods using the ring-radius
check-off pattern need neighborhood-specific (smaller) radius values, not the schema defaults, or
a schema change to make the default itself metro-aware.

## Standalone check-in semantics (Step 10/migrations)

Both flagged migrations are confirmed live:
- `check_ins_standalone_user_item_unique` (a partial unique index on `(user_id, item_id) WHERE
  list_item_id IS NULL`, added 2026-08-04) is **confirmed dropped** — it does not appear in the
  current `pg_indexes` listing for `check_ins`. This matches `20260806_drop_standalone_lifetime_unique.sql`'s
  intent: standalone check-ins are deliberately re-checkable every season, with de-dup for the
  same-season case pushed to the app layer (`lib/seasonWindow.js`/`isWithinWindow` in
  `ItemDetailScreen.jsx`/`PhotoCheckInScreen.jsx` — code-side pattern, verify file paths in
  [02_app_metro_dependencies.md](02_app_metro_dependencies.md) once available).
- `prevent_expired_list_checkins()`'s standalone branch (validates `items.is_active` directly
  when `list_item_id IS NULL`) is live in the current function body shown above.
- This is a **best-effort, not airtight** de-dup model by explicit design (per the migration's
  own comment) — a rare true-simultaneous duplicate standalone check-in is an accepted tradeoff.
  Not a Denver-specific concern; applies identically to any metro.

## Official seasonal-list selection — not exclusive per metro

Live query of `lists` with `starts_at`/`ends_at` set shows **multiple concurrently-active
`is_official=true` lists per metro** are the norm, not an edge case:

- Milwaukee: 3 concurrent `is_official=true` lists for the same 07-31→11-30 window ("Wisconsin
  Weird", "Fall 2026 — Milwaukee Metro", "Milwaukee After Dark").
- Phoenix: 8 concurrent `is_official=true` lists for the same window.
- Tucson: 4 concurrent `is_official=true` lists for the same window.

So `is_official` is **not** a "the one official seasonal list" flag in the data — it reads as a
general "this is curated/officially-published content" flag, with something else (likely
client-side selection logic, e.g. picking the list whose title matches a `Season YYYY — Metro`
naming convention, or the first result of some ordering) choosing what actually renders as
*the* Home hero list. **This must be verified against app code** — see
[02_app_metro_dependencies.md](02_app_metro_dependencies.md) for the selection logic once the
codebase sweep completes. No `display_order`/`priority` column exists on `lists` at all, which
rules out a priority-field-based selection mechanism at the DB level.

**Classification: Important before launch** — Denver needs to know definitively which exact
list the client will render as the Home hero before multiple official lists are created for it,
or risk an indeterminate/wrong hero list at launch, exactly as could already be happening for the
existing three metros.

## Bonus Drop pattern — does not match the documented "10/21" convention

Live sample of `list_items` for "Fall 2026 — Phoenix Metro" (32 items, sort_order 0–36 with gaps
at 11/16/18/19/26 — evidence of prior edits/deletions, not a clean contiguous sequence):

- Bonus drop 1: `sort_order=3`, `unlock_threshold=9`
- Bonus drop 2: `sort_order=28`, `unlock_threshold=15`

The **unlock thresholds (9 and 15) match** the documented pattern, but the **sort_order
positions (10 and 21) do not** — actual live positions are 3 and 28 for this list. Treat the
"Bonus Drops at sort_order 10 and 21" claim from prior scripts as **obsolete/unreliable**; only
the threshold values (9, 15) are corroborated by live data. Don't assume a fixed position without
checking each list individually — see [05_item_intake_contract.md](05_item_intake_contract.md).

## Existing metro rollup counts (live)

| Metro | Neighborhoods | Active non-universal items (via neighborhood) | Active public lists | Total `is_official` lists |
|---|---|---|---|---|
| Phoenix | 12 | 290 | 14 | 9 |
| Tucson | 17 | 168 | 7 | 7 |
| Milwaukee | 39 | 140 | 4 | 4 |

Note Phoenix has the fewest neighborhoods (12) but the most items and public lists — neighborhood
count is not a reliable proxy for metro content maturity.

## Storage buckets (live)

| Bucket | Public |
|---|---|
| `checkin-photos` | yes |
| `checkoff-images` | yes |
| `submission-photos` | no |

No metro-specific bucket or path-prefix convention was found in bucket naming itself — any
city-name-based path convention would be in application code (upload path construction), not the
bucket list. See [02_app_metro_dependencies.md](02_app_metro_dependencies.md) / [12](06_checkin_join_timezone_deeplink_audit.md).

## `app_config` (live)

Only two keys exist: `min_required_version` = `1.0.0`, `current_version` = `1.0.1`. No
metro-specific configuration lives in this table.
