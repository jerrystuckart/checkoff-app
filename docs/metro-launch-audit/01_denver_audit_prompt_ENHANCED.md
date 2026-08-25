# Denver/Boulder Metro Launch Audit — Claude Code Prompt (Enhanced)

Prepared 2026-08-21. This is Jerry's ChatGPT-drafted audit prompt with additions from a
cross-check against Open Brain (452 captured thoughts) and a live read-only pass over the
repo. **All of the original guardrails and structure are unchanged.** Additions are marked
`[ADDED]`. Read `00_open_brain_and_repo_context.md` in this same folder first — it has the
full reasoning behind each addition below; this file only carries the pointers Claude Code
needs inline.

Paste everything below the line into Claude Code, running from inside the `checkoff` repo.

---

You are auditing the current CheckOff codebase and production database so we can create a
safe, repeatable new-metro launch system. The first metro using this system will cover Denver,
Boulder, Longmont, and the connected Front Range communities around them.

This task is discovery and documentation only.

DO NOT:

* Modify production data.
* Run INSERT, UPDATE, DELETE, ALTER, DROP, CREATE, migration, seed, or RPC calls that write data.
* Apply migrations.
* change application code.
* install packages.
* build or deploy the app.
* commit or push anything.
* invent missing schema details, UUIDs, slugs, relationships, or application behavior.
* treat older documentation or SQL scripts as authoritative when current code or production schema contradicts them.

You may create local audit documents and read-only SQL files in the repository. Preserve all
unrelated existing work.

**[ADDED] Preserve, do not touch, this specific in-flight work:** the worktree is currently
dirty with real uncommitted changes — modified `.gitignore`, `app.json`, `lib/useNearby.js`,
`screens/DiscoverScreen.jsx`, `screens/HomeScreen.jsx`, `screens/OnboardingScreen.jsx`,
`supabase/.temp/cli-latest` — plus untracked files `components/OnboardingDeviceFrame.jsx`,
`components/OnboardingPreviews.jsx`, `lib/seasonFilter.js`, `scripts/`, and three unapplied
migrations: `supabase/migrations/20260809_seasonal_item_active.sql`,
`20260811_update_item_location_rpc.sql`, `20260811_update_neighborhood_center_rpc.sql`. None
of this is audit output — do not stash, revert, or clean it. Re-verify this list is still
accurate as of your run (it may have changed) and report any differences.

## Primary objective

Determine exactly what CheckOff currently requires to add a new metro from an empty database
foundation through app visibility, item loading, list creation, activation, QA, deep links,
assets, notifications, analytics, and launch.

The result must tell us:

1. What database records must exist.
2. The exact dependency order in which they must be created.
3. Which fields and relationships each record requires.
4. Which application surfaces consume those records.
5. Which behaviors are data-driven versus hardcoded.
6. Which existing Phoenix, Milwaukee, and Tucson records are the best models.
7. Which older processes are obsolete or unsafe.
8. What decisions remain for Denver before mutation SQL can be generated.

## Working Denver assumption

Use this only as a draft product assumption, not permission to insert anything:

* Product-facing working name: Denver / Boulder Metro
* Coverage: Denver, Boulder, Longmont, and the connected communities between and immediately around them
* Longmont must be a first-class coverage area
* Likely included areas for evaluation: Denver Central, RiNo/Five Points, LoDo/Union Station, Capitol Hill/Uptown, Highlands/Sunnyside, Cherry Creek, Washington Park/South Denver, Berkeley/Tennyson, Lakewood, Golden, Arvada, Westminster, Thornton/Northglenn, Broomfield, Boulder, Louisville/Superior, Lafayette, Erie, and Longmont
* Likely excluded from the core metro: Fort Collins, Colorado Springs, Estes Park, and mountain destinations
* Expected timezone: America/Denver
* Do not choose the final metro slug until all code and database assumptions have been inspected

**[ADDED] Timezone note:** America/Denver observes DST; America/Phoenix does not. This is not
cosmetic for this launch — see Step 11 addition below, there is a specific known hardcode to
check before this stops being a "someday" issue.

## Step 1 — Repository orientation

Read the repository instructions first, including any `CLAUDE.md`, `AGENTS.md`, README files,
architecture documentation, and Supabase instructions.

**[ADDED]** None of `CLAUDE.md`/`AGENTS.md`/`README*` were found at repo root as of this
writing — confirm that's still the case rather than assuming it. Also note:
`checkoff_admin.html` (the admin tool referenced throughout this audit) is **not in this
repo** — `admin-tool-changes.md` at repo root says so explicitly. If you need its current
source for Steps 2 or 12, ask Jerry where it lives rather than assuming grep will find it.

Then record:

* Current branch
* Current commit
* Whether the worktree is dirty
* Relevant existing uncommitted files that must be preserved
* App framework and version
* Supabase project configuration available to this repository
* Whether a safe read-only production database connection is available

Do not expose credentials, tokens, secrets, or complete environment-variable values.

**[ADDED]** As of this writing, `.env`/`.env.local` in this repo define only
`GOOGLE_PLACES_API_KEY` and `SENTRY_AUTH_TOKEN` — no Supabase service-role key or read-only DB
connection string was found in the repo itself. If that's still true when you check, **say so
explicitly and stop treating Step 3 as "run the queries"** — fall back to generating
`00_schema_preflight.sql` and flag for Jerry that he needs to supply read-only DB access
(Supabase CLI link, a scoped read-only role, or dashboard SQL editor results pasted back)
before Steps 3–9 can produce verified-not-inferred answers.

## Step 2 — Find every metro-dependent code path

Search the entire repository for all references to:

* `metro`
* `metro_id`
* `metro_areas`
* `city_id`
* `city_slug`
* `cities`
* `neighborhood`
* `neighborhood_id`
* `Phoenix`
* `Milwaukee`
* `Tucson`
* their current slugs
* supported-city arrays
* city selector
* active city
* selected city
* Home hero
* seasonal list
* official list
* `is_official`
* `activeOfficial`
* Nearby
* Discover
* curated lists
* destination lists
* day trips
* app links and deep links
* notification targeting
* email/recap metro segmentation
* analytics metro segmentation
* asset paths or storage keys that contain city names

**[ADDED]** Also search for these — found live in the repo/Open Brain and not in the original
list: `curated_list_metros`, `is_universal`, `season_tag`, `audience_groups`,
`destination_hub`, `destination_zone`, `metro_day_trips`, `adoptCuratedList` (confirm it's
still dead code), `METRO_SLUGS`, and the derive-slug-from-name pattern in the admin tool's
`metros` array (per Open Brain, this — not a hardcoded `METRO_SLUGS` list — is what actually
governs whether Denver needs a code touch in the admin tool; verify which pattern is live).

For each relevant code path, report:

* File and function/component
* What it reads
* How it decides the current metro
* Whether behavior is data-driven or hardcoded
* What must change, if anything, for a new metro
* Whether the path is launch-blocking

Pay particular attention to:

* City selector population and ordering
* HomeScreen metro hero
* Seasonal-list selection
* Themed/public-list rails
* Nearby results
* Search and filtering
* Admin-tool city/neighborhood choices
* Deep-link resolution
* Website download/join routes
* Notifications
* Weekly and monthly recap logic
* Analytics/reporting
* Any edge function that expects a known city slug
* Any storage bucket or image filename convention tied to existing metros

## Step 3 — Read-only database schema inspection

If a safe read-only database connection is available, run read-only inspection queries.
If it is not available, create `00_schema_preflight.sql` containing every required SELECT
query and clearly state that the results are still needed.

Inspect these tables if they exist:

* `metro_areas`
* `cities`
* `neighborhoods`
* `categories`
* `tags`
* `items`
* `item_tags`
* `lists`
* `list_items`
* `curated_lists`
* `curated_list_items`
* `list_members`
* `check_ins`
* destination/hub/zone tables
* destination partner tables
* metro presentation/media/configuration tables
* notification or analytics configuration tables related to metros
* any other table referenced by the metro-dependent code paths

**[ADDED] Also explicitly inspect these — confirmed to exist and to matter for metro logic,
not covered by the generic categories above:** `curated_list_metros` (the join table that
actually governs curated-list visibility per metro — supersedes `curated_lists.city_slug` for
that purpose as of a 7/17 refactor; `curated_lists.city_slug` is now display-only legacy,
confirm that's still true), `audience_groups`, `featured_experiences`, `destination_zones`,
`destination_spotlights`, `season_tag`/`is_universal` columns on `items`, `badge_definitions`,
`push_tokens`, `notification_queue`, `interaction_events`.

For every relevant table, capture:

* Columns
* Data types
* Nullability
* Defaults
* Generated columns
* Primary key
* Unique constraints
* Check constraints
* Foreign keys
* Indexes
* Triggers and trigger functions
* RLS status and policies
* Grants or permission constraints relevant to admin SQL
* Referencing tables that would affect creation or rollback order

**[ADDED]** For `curated_lists` specifically: confirm whether there are still two overlapping
public-read RLS policies (one gated on `is_active=true`, one `USING(true)`) that make the
`is_active` gate a no-op. This was flagged as an open cleanup item, not yet fixed as of the
last check — confirm current state and classify (launch blocker / important before launch /
safe to defer), don't silently pass over it either way.

Also inspect relevant functions/RPCs, especially:

* Location update/geocoding functions
* Item creation functions
* List join/backfill functions
* Check-in validation
* Seasonal filtering
* Metro selection
* Any function that automatically attaches items to lists

**[ADDED]** By name, confirm the current definition of: `update_item_location`,
`update_neighborhood_center`, `sync_seasonal_item_active`,
`apply_seasonal_active_on_tag_change` (trigger on `items.season_tag`),
`season_days_until_start`, and `prevent_expired_list_checkins`. The seasonal-visibility trio
was added in an unapplied migration (`20260809_seasonal_item_active.sql`) and **hardcodes
`AT TIME ZONE 'America/Phoenix'`** for computing "what season is it right now," with a monthly
`pg_cron` job (`sync-seasonal-item-active-monthly`) as a safety net. This is the specific
concern behind Step 11 below — confirm whether this migration has been applied by the time you
run this audit, and either way, evaluate it against a Denver item using `season_tag`.

Do not assume a trigger is harmless because its name looks familiar. Read its current
definition.

## Step 4 — Resolve the actual geography model

Document the exact relationship among:

* `metro_areas`
* `cities`
* `neighborhoods`
* `items.city_id`
* `items.neighborhood_id`
* `neighborhoods.city_id`
* `neighborhoods.metro_id`
* `lists.metro_id`
* Any `city_slug` fields

Answer explicitly:

1. What represents a selectable app metro?
2. What represents an item's city or market?
3. What controls metro rollup?
4. What controls city-selector visibility?
5. Can one metro contain multiple `cities` rows?
6. Are Phoenix, Milwaukee, and Tucson implemented consistently?
7. What would Denver, Boulder, and Longmont most safely become under the current model?
8. Which field or relationship is authoritative when two signals disagree?

**[ADDED] Specifically resolve this documented contradiction as part of question 8:** one
Open Brain note (dated 7/5) states `items.city_id` is required and non-negotiable on every
item for a full metro. A later note (7/18, explicitly framed as a correction) found only 15%
of live items have `city_id` set, and argues the canonical signal is actually
`items.is_universal` plus `neighborhood_id → neighborhoods.metro_id → metro_areas.slug`. A
still-later note (7/12) argues `city_id` genuinely is required, but only for "full metro" items
as opposed to destination/experience-tier locations (Willcox, Door County) that intentionally
have `city_id` null. Determine from current schema/constraints/code which of these is actually
operative today, and state plainly what Denver's items need for `city_id`.

Create a compact relationship diagram in the audit report.

Provide one verified read-only metro rollup query that returns:

* Metro ID
* Metro name
* Metro slug
* City IDs/names
* Neighborhood IDs/names
* Active non-universal item count
* Active public-list count
* Active official seasonal-list count
* Items on zero active public lists

## Step 5 — Inspect existing metros as templates

Retrieve the complete relevant foundation records for Phoenix, Milwaukee, and Tucson.

For each metro, document:

* `metro_areas` row
* Related `cities` row or rows
* Neighborhood count and representative rows
* Metro-specific tags
* Selector/display metadata
* Hero/media configuration
* Official seasonal lists
* Evergreen public lists
* List types and visibility rules
* Start/end dates
* Ordering/priority fields
* Item counts
* Bonus Drop configuration
* Day-trip/destination relationships
* Any metro-specific deep links
* Any inconsistencies among the three metros

Do not dump all catalog items. Return enough exact foundation data to identify the correct
pattern.

Identify which metro is the cleanest current template and explain why.

**[ADDED]** Before concluding Tucson is the cleanest template by default (it's the most
recently launched via the full geography/items pipeline, which is a real point in its favor):
as of the last check, Tucson's curated-list layer was known to be incomplete — "Best of
Tucson" curated list active with 0 items, and Tucson-specific overlay content not yet written
into the universal+overlay lists. Confirm current state before naming a single "cleanest"
metro; it may be that Tucson is the right template for geography/items/activation and Phoenix
or Milwaukee is the right template for curated-list overlay structure — say so if that's what
the data shows rather than forcing one answer.

## Step 6 — Determine the current list source of truth

The project has historically used both:

* `lists` / `list_items`
* `curated_lists` / `curated_list_items`

Determine current behavior for every list class:

* Seasonal
* Themed
* Public destination
* Local Guide
* Creator
* Template
* Private/user-created
* Adopted Hub copy
* Day trip
* Spotlight or event presentation

For each class, report:

* Authoritative table
* Whether a mirror is required
* How the app loads it
* Whether it is public/read-only or private/adoptable
* Whether joining is expected
* Whether checking off requires membership
* How progress is calculated
* Which dates control visibility
* How ordering works
* Whether title-based matching still exists anywhere

**[ADDED]** Per Open Brain, `curated_list_metros` (list-level visibility) and a `city_slug`
column added to both `curated_list_items` and `list_items` (item-level overlay) were shipped
7/17 as the current model, replacing per-metro duplicated curated lists. Also per Open Brain:
`adoptCuratedList()` was marked dead code as of 7/17, with the real clone path inline in
`CreateListScreen.jsx` around line 133 via `fetchCuratedListItems(curatedListId, userCitySlug)`.
Confirm both are still true and fold them into your answer for "Public destination" and
"Adopted Hub copy" above rather than treating them as undiscovered.

Explicitly identify any obsolete dual-write or mirror behavior that Denver must not inherit.

## Step 7 — Verify official seasonal-list selection

Trace the complete code and query path that chooses the official seasonal list shown on Home.

Answer:

* Does it use dates, season, priority, display order, creation time, array order, or another field?
* Can two active official lists exist for one metro?
* What happens if they do?
* Is selection deterministic?
* What exact fields must Denver populate?
* Is a client change required to make this launch-safe?

Include a read-only collision query that returns every metro with zero or more than one
currently eligible official seasonal list.

## Step 8 — Verify item intake requirements

Using the current production schema and current admin code, document the authoritative
item-creation contract.

Include:

* Required columns
* Fields safe to default
* Valid difficulty values
* Points behavior
* Valid check-in types
* Status/approval fields
* Season fields
* Recurrence semantics
* Alcohol semantics
* Photo-required semantics
* Google Place ID
* Formatted address
* `maps_query`
* Latitude/longitude
* `geo_location`
* Geo-radius conventions
* Duplicate key
* Tag source/confidence rules
* Maximum tag count
* Metro-only tag requirement
* Whether inactive staging is supported
* What happens after an insert

**[ADDED]** For geo-radius conventions specifically: per the `update_neighborhood_center` RPC's
own migration comment, `neighborhoods.center_geo` "doubles as the check-off anchor for
neighborhood-scoped items (they copy this center into their own maps_lat/maps_lng with a wide
radius)" — confirm this pattern in current code and document exactly what "wide radius" means
numerically, since Denver neighborhood boundaries (e.g. Golden vs. Lakewood vs. Denver Central)
are close enough together that a wide check-off radius could cause cross-neighborhood
false-positive check-ins in a way Phoenix/Milwaukee/Tucson's more spread-out geography may not
have surfaced.

Confirm that a new item creates zero list memberships.

Compare the current contract against any existing `New_Intake_SQL_generator` or similar
prompt. Produce a table of:

* Still valid
* Changed
* Unsafe
* Obsolete
* Missing

Do not modify the old generator yet.

## Step 9 — Verify list-membership and Bonus Drop requirements

Document the exact current `list_items` contract:

* Required columns
* Unique constraints
* `sort_order` base
* Bonus Drop fields
* Unlock thresholds
* City/metro fields, if any
* Public-list behavior
* Duplicate prevention
* Deletion/deactivation behavior

**[ADDED]** `list_items` gained a nullable `city_slug` overlay column in the 7/17 refactor —
confirm it's still there and document how it interacts with `sort_order`/Bonus Drop placement
(e.g. does an overlay item at a given `sort_order` collide with or displace a universal item at
the same position for a given viewer?).

Verify how the established 30 regular plus 2 Bonus Drop structure currently works.

Determine whether the known pattern still requires:

* Bonus Drops at `sort_order` 10 and 21
* Unlock thresholds 9 and 15
* Regular items occupying all other positions
* Zero-based rendering

Do not assume prior scripts are still correct.

## Step 10 — Verify public check-off and joining behavior

Trace:

* Public item check-off without joining
* Official-list joining from Home
* Joining from ListScreen
* Invite-code joining
* Website join flow
* Retroactive list credit
* Standalone check-in uniqueness
* Points
* Streaks
* Badges
* Notifications
* Weekly recap
* Monthly recap
* Unchecking

**[ADDED]** Two recent unapplied/recent migrations bear directly on this step:
`20260804_standalone_checkins.sql` and `20260806_drop_standalone_lifetime_unique.sql` —
read both in full; the naming suggests a recent change to standalone check-in uniqueness
semantics that should feed directly into your answer here rather than being treated as
unrelated history.

Report all known inconsistencies and whether they block a Denver launch.

Do not implement fixes.

## Step 11 — Timezone and seasonal behavior

Find every use of:

* `America/Phoenix`
* Local device timezone
* UTC
* Current date
* Month-based season filtering
* List start/end timestamps
* Notification scheduling
* Reporting periods

Determine exactly what must support `America/Denver`.

Distinguish:

* Month-based season visibility
* Midnight/date-boundary behavior
* Launch and expiration timestamps
* Notification timing
* Analytics/reporting bucketing

Report whether this requires only data configuration or an application change.

**[ADDED] This is the highest-confidence concrete finding from pre-audit orientation — verify
it first, it's likely to change your overall readiness verdict:** an unapplied migration,
`supabase/migrations/20260809_seasonal_item_active.sql`, defines `sync_seasonal_item_active()`,
`apply_seasonal_active_on_tag_change()` (a `BEFORE INSERT OR UPDATE OF season_tag` trigger on
`items`), and `season_days_until_start()` — all three compute "current month" via
`(now() AT TIME ZONE 'America/Phoenix')`, hardcoded, with no per-metro parameter. A
`pg_cron` job runs the sync monthly. Separately, the client-side equivalent,
`lib/seasonFilter.js`, uses `new Date().getMonth()` (the checking device's local clock) with a
code comment saying it's a stopgap pending the DB-level sync. **Neither path is metro-aware.**
Phoenix doesn't observe DST; Denver does — so even after this migration is applied, any Denver
item given a `season_tag` will have its visibility computed on Arizona's clock, which drifts
from Denver's local season boundaries by an hour twice a year and, more importantly, was never
designed with a second timezone in mind at all. Determine: (a) whether this migration has been
applied to production yet, (b) whether any current metro other than Phoenix already has
`season_tag`-bearing items exposed to this same bug, and (c) what the fix actually requires —
almost certainly a `timezone` column on `metro_areas` threaded through both the trigger/RPC and
`lib/seasonFilter.js`, rather than a data-only fix. Classify this explicitly as launch-blocking
or not for Denver depending on whether Denver items are expected to use `season_tag` at launch.

## Step 12 — Assets, web, and deep links

Document every asset or configuration needed for a metro to appear complete:

* Metro hero
* Seasonal hero
* Themed-list images
* Item images
* Storage buckets and paths
* Expected dimensions
* Fallback behavior
* City selector image
* Website metro page, if any
* App Store/download link
* QR target
* Custom-scheme links
* Universal/app links
* List join links
* Seasonal links
* Metro links
* AASA/Android association requirements

Separate proven working links from planned or unsupported routes.

## Step 13 — Analytics and launch verification

Identify which current metrics can be segmented by:

* Metro
* List
* Item
* QR source
* Deep link
* New versus existing user
* Save/list addition
* Check-in
* Unique completed item
* Bonus unlock
* Business referral or amplification

Report what can be measured today without new product work.

Create a proposed Denver launch scorecard using only currently measurable fields.

## Step 14 — Draft the Denver metro manifest

Create a proposed, non-executable Denver manifest containing:

* Recommended display name
* Candidate slug options and code risks
* Timezone
* Coverage statement
* Included areas
* Explicit exclusions
* Proposed neighborhood taxonomy
* Required metro-only and state tags
* Required public list shells
* Required asset set
* Recommended hidden/coming-soon/staged behavior
* Open product decisions
* Open technical decisions
* Launch blockers

Do not invent UUIDs.

## Required deliverables

Create this directory unless a repository convention clearly requires another location:
`docs/metro-launch-audit/`

Create:

1. `README.md` — Executive summary, go/no-go status, cleanest existing metro template, blockers, and recommended next action.
2. `00_schema_preflight.sql` — Read-only queries needed to reproduce or complete the audit.
3. `01_current_schema_and_relationships.md` — Current schema, constraints, triggers, RLS, functions, and relationship diagram.
4. `02_app_metro_dependencies.md` — Every metro-dependent app, website, admin, edge-function, notification, and analytics path.
5. `03_existing_metro_comparison.md` — Phoenix versus Milwaukee versus Tucson foundation comparison.
6. `04_list_model_and_seasonal_selection.md` — Current list source of truth, list-class matrix, mirrors, ordering, eligibility, and collision risks.
7. `05_item_intake_contract.md` — Current authoritative item contract and comparison against the old intake generator.
8. `06_checkin_join_timezone_deeplink_audit.md` — Public check-offs, joins, recaps, timezone, assets, and link behavior.
9. `07_denver_metro_manifest_draft.md` — Proposed Denver/Boulder/Longmont foundation with unresolved decisions clearly marked.
10. `08_future_metro_build_sequence.md` — Exact dependency order and proposed reusable files: geography foundation, tags/presentation, list shells, item staging, list membership, activation, verification, device QA, launch runbook, repair/rollback.

## Evidence requirements

Every material finding must include one of:

* Exact repository file and function
* Exact database table/column/constraint/trigger/function
* Read-only query result
* Clearly labeled "UNKNOWN — needs production query/access"

Do not state assumptions as facts.

For each gap, label it:

* Launch blocker
* Important before launch
* Safe to defer
* Obsolete process to remove

## Final response

When finished, return:

1. Overall readiness: READY, READY WITH DECISIONS, or NOT READY.
2. The five most important findings.
3. The exact unresolved decisions Jerry must make.
4. Any database access limitation.
5. The created file list.
6. The recommended next Claude Code prompt, but do not execute it.
7. Confirmation that no database writes, code changes, builds, commits, pushes, or deployments occurred.
