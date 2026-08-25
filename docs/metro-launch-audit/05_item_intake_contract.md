# Item intake contract

Live-observed values from production (`items` table, 1,068 rows) — see
[00_schema_preflight.sql](00_schema_preflight.sql) queries 18, plus schema from query 2.

## Column-by-column contract

| Field | Required? | Notes |
|---|---|---|
| `body` | NOT NULL | item text |
| `category_id` | nullable, FK → `categories` | safe to default null |
| `city_id` | nullable, FK → `cities` | **safe to default null / defer** — only 25.9% of live items have this set; see [01](01_current_schema_and_relationships.md) geography resolution. Not the operative metro signal. |
| `neighborhood_id` | nullable, FK → `neighborhoods` | operative geography signal alongside `is_universal` — should be set for any non-universal Denver item |
| `partner_id` | nullable, FK → `partners` | only for partner-sourced items |
| `checkin_type` | NOT NULL, default `'tap'` | **exactly 3 live values: `tap`, `photo`, `gps`** — no other values observed in production |
| `geo_location` | nullable, PostGIS point | synced from `maps_lat`/`maps_lng` via `trg_sync_item_geo_location` trigger (BEFORE INSERT) — don't set directly, set `maps_lat`/`maps_lng` instead |
| `geo_radius_m` | nullable | live stats: min 10, max 45,000, avg ≈910; set on 707/1,068 items (361 unset). See neighborhood ring-radius warning below for the Denver-specific risk. |
| `is_universal` | NOT NULL, default `false` | 318/1,068 items are universal (available in every metro) |
| `is_active` | NOT NULL, default `true` | **do not set directly if `season_tag` is set** — `trg_apply_seasonal_active_on_tag_change` (BEFORE INSERT) overwrites it based on current month; see timezone warning in [01](01_current_schema_and_relationships.md) |
| `is_approved` | NOT NULL, default `true` | RLS gates public read on `is_active=true AND is_approved=true`; user-submitted items insert as `is_approved=false` (see RLS policy `items: authenticated insert`) |
| `season_tag` | nullable | valid values inferred from trigger logic: `fall`, `winter`, `spring`, `summer`, or unrecognized/`all` (left alone) |
| `is_recurring` | NOT NULL, default `true` | |
| `active_from`/`active_until` | nullable dates | separate from season_tag-driven activity |
| `maps_lat`/`maps_lng` | nullable | **should be populated for every Denver item** — see Nearby fallback-dictionary risk in [02](02_app_metro_dependencies.md); use `update_item_location(item_id, new_lat, new_lng)` RPC, confirmed live, not a raw UPDATE (it also syncs `geo_location`) |
| `has_alcohol` | NOT NULL, default `false` | |
| `difficulty` | NOT NULL, default `1` | **live values are 1 (881 items), 5 (160), 10 (20), 25 (7) — reads as a points scale, not a 1-5 difficulty scale.** `get_never_checkin_users()` specifically filters `difficulty IN (10, 25)` for "high-difficulty" suggestions — Denver items intended as showcase/high-value should use 10 or 25. |
| `photo_required` | NOT NULL, default `false` | should correlate with `checkin_type='photo'` but not DB-enforced |
| `is_secret`/`secret_reveal_text` | nullable | |
| `google_place_id`/`formatted_address` | nullable | |
| `duplicate key` | none found — **no UNIQUE constraint on `items`** beyond the primary key. Duplicate prevention (if any) is application-side, not DB-enforced. |

## Tag source/confidence

`item_tags (item_id, tag_id, source default 'ai', confidence numeric, created_at)` — no
maximum-tag-count constraint found in schema (no CHECK, no trigger limiting count per item).
No "metro-only tag" requirement found at the DB level — `tags` is a flat global table with no
metro scoping column at all. If a "Denver-only tags" concept is wanted, it does not exist today
and would need new schema.

## Neighborhood check-off radius — concrete Denver risk (restated from [01](01_current_schema_and_relationships.md))

`neighborhoods.ring_1_radius_m` defaults to 32,187m (≈20mi), `ring_2_radius_m` to 64,374m
(≈40mi). These are copied onto neighborhood-scoped items as a "wide radius" check-off anchor per
the `update_neighborhood_center` migration's own comment. Denver-area neighborhoods under
consideration (Golden, Lakewood, Denver Central, Arvada, Westminster, etc.) sit roughly 3–8 miles
apart — a 20-mile ring from any one of them already overlaps several others. **Classification:
Important before launch** — Denver neighborhood rows should use smaller, metro-appropriate ring
radii rather than the schema defaults, or the ring-radius pattern itself should not be used for
Denver's tightly-packed neighborhoods (prefer item-specific `maps_lat`/`maps_lng` +
tighter `geo_radius_m` instead of relying on neighborhood-center ring fallback).

## Duplicate-key comparison against the old intake generator

**UNKNOWN — the old `New_Intake_SQL_generator` (or similarly-named prompt/script) was not found
in this repo** (`checkoff_import_csv.js`, `checkoff_precision_import.js`,
`checkoff_gapfill_import.js`, and `checkoff_seasonal_update.js` exist at repo root but were not
read in full as part of this audit — reading and diffing them against the live contract above is
recommended as the next step, not completed here due to audit scope). The columns above represent
the **current, verified-live contract**; a side-by-side diff against those scripts should be done
before generating Denver intake SQL from them.

| Aspect | Status |
|---|---|
| `checkin_type` values (tap/photo/gps) | Confirmed still valid |
| `difficulty` as points scale (1/5/10/25) | Confirmed still valid |
| `city_id` as a required field | **Changed** — legacy/optional now, not required (see [01](01_current_schema_and_relationships.md)) |
| Neighborhood ring-radius as check-off anchor | **Unsafe for Denver as-is** — defaults too wide for Denver's geography |
| Bonus Drop sort_order fixed at 10/21 | **Obsolete** — live data shows positions vary per list; only thresholds (9, 15) are consistent |
| `adoptCuratedList()` as the clone mechanism | **Obsolete** — dead code; real path is `CreateListScreen.jsx` + `fetchCuratedListItems()` |
| Old scripts' exact column mapping | **UNKNOWN — needs direct comparison**, not completed in this audit pass |

## New item → zero list memberships, confirmed

No trigger, RPC, or RLS policy on `items` inserts a corresponding `list_items`/`curated_list_items`
row. Item creation and list membership are fully decoupled at the DB level — confirmed by the
absence of any `items`-table trigger beyond `trg_apply_seasonal_active_on_tag_change`,
`trg_sync_item_geo_location`, and `trg_sync_photo_required` (none of which touch `list_items`).
