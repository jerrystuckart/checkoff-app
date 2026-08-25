# Denver/Boulder Metro Launch — Pre-Audit Context

Prepared 2026-08-21 by cross-referencing Open Brain (452 captured thoughts, 3/9/26–8/20/26)
against a live, read-only pass over `~/Downloads/checkoff` (main branch, commit `c818d4c9`,
worktree dirty — see below). This is **prep material for the audit prompt**, not the audit
itself. Treat every claim below as a **lead to verify against current code/schema**, not a
fact to assume — several of them directly contradict earlier documentation, which is the
whole reason this audit is needed.

## 1. The metro-launch playbook has already been rewritten twice, and reality has moved past both versions

Three "final" versions exist in Open Brain, in this order:

1. **6/28/26** — "no code changes needed," gate purely on `metro_areas.is_active`.
2. **7/5/26** — "Complete Blueprint," 14 steps, `cities` INSERT required first, `items.city_id`
   populated on every item, `center_lat`/`center_lng` haversine GPS logic, EAS build required
   once (done) for the nearest-metro calculation.
3. **7/17–7/18/26** — a **curated-list architecture refactor** superseded part of #2 without a
   new "playbook" doc ever being written. This is the gap Tucson exposed and nobody has
   reconciled yet:
   - `curated_lists.city_slug` is now **display-only legacy** — list visibility is governed by
     a new join table, `curated_list_metros` (curated_list_id, city_slug; no rows = universal).
   - Item-level overlay is a nullable `city_slug` column added to **both**
     `curated_list_items` and `list_items` (NULL = universal, set = metro-specific).
   - `adoptCuratedList()` is dead code; the real personal-list clone path is inline in
     `CreateListScreen.jsx` (~line 133).
   - None of this is in the 7/5 Blueprint. **Step 3/6 of the audit prompt needs to inspect
     `curated_list_metros` explicitly** — it isn't named in Jerry's draft.

**Open contradiction the audit must resolve:** the 7/5 Blueprint says `items.city_id` is
required and non-negotiable on every item. A 7/18 correction found **live production data**
shows only 109/735 items (15%) have `city_id` set, and 0 of the 729 items in the old
Phoenix/Milwaukee duplicated list pairs have it. The canonical classification signal going
forward was determined to be `items.is_universal` + `neighborhood_id → neighborhoods.metro_id
→ metro_areas.slug`, not `city_id`. A still-later note (7/12) argues `city_id` *is* required
for the subset of items that belong to a "full metro" (as opposed to a destination/experience
tier location like Willcox or Door County). **Both can't be operative guidance for Denver
without a current-schema check** — this is exactly the kind of "older doc vs. current
behavior" conflict the audit prompt's own rules tell it to resolve by reading code/schema,
not by trusting either note.

## 2. A known, unresolved timezone hardcode was found live in the repo — likely launch blocker

Three **uncommitted, unapplied** migration files sit in `supabase/migrations/` right now
(dated 8/9 and 8/11, not yet run against production per `git status`):

- `20260809_seasonal_item_active.sql` — creates `sync_seasonal_item_active()`,
  `apply_seasonal_active_on_tag_change()` (a trigger on `items.season_tag`), and
  `season_days_until_start()`. **All three hardcode `AT TIME ZONE 'America/Phoenix'`** to
  determine "what month is it" for season-window visibility (fall=Sep–Nov, winter=Dec–Feb,
  etc.), and a monthly `pg_cron` job runs the sync at 06:00 UTC.
- `20260811_update_item_location_rpc.sql` / `20260811_update_neighborhood_center_rpc.sql` —
  new admin RPCs (`update_item_location`, `update_neighborhood_center`) that write
  `maps_lat/maps_lng`/`center_geo` together atomically, replacing hand-typed coordinates in
  `checkoff_admin.html`'s new "Find & confirm location" control.
- The client-side twin, `lib/seasonFilter.js` (also new, uncommitted), uses
  `new Date().getMonth()` — the **device's local timezone**, not the item's metro — with a
  comment saying it's a stopgap "until the DB-level sync (Priority 3) lands."

**Neither the DB trigger/cron nor the client filter is metro-aware.** If `season_tag` gets
used on any Denver item before this is fixed, the DB-side job will flip `is_active` based on
Phoenix's calendar (no DST) rather than Denver's (observes DST), and the client filter will
use whatever device the checker happens to be on. This is squarely inside **Step 11
(Timezone and seasonal behavior)** of the audit prompt, but the audit prompt as drafted
doesn't know these specific files/functions exist yet — worth pointing Claude Code at them
directly rather than making it rediscover this from a full-repo grep.

Also worth noting for Step 1: this is real in-flight work that **must be preserved** — do not
let an audit session stash, revert, or "clean" the worktree.

## 3. Full current dirty-worktree / uncommitted-file inventory (as of this orientation pass)

```
Modified (not committed):
  .gitignore, app.json, lib/useNearby.js, screens/DiscoverScreen.jsx,
  screens/HomeScreen.jsx, screens/OnboardingScreen.jsx, supabase/.temp/cli-latest

Untracked (not committed):
  components/OnboardingDeviceFrame.jsx
  components/OnboardingPreviews.jsx
  lib/seasonFilter.js
  scripts/  (directory — contents not enumerated here)
  supabase/migrations/20260809_seasonal_item_active.sql
  supabase/migrations/20260811_update_item_location_rpc.sql
  supabase/migrations/20260811_update_neighborhood_center_rpc.sql
```

Branch is `main` (production/hotfix branch per the 5/4/26 branching note; `v2` is the future
branch). Latest commit: `c818d4c9…` "Finalize Android Google Sign-In credentials" (2026-08-19).
Four `claude/*` branches also exist locally from prior Claude Code sessions — not investigated
here.

## 4. `checkoff_admin.html` — the admin tool — is NOT in this repo

`admin-tool-changes.md` (in repo root) says explicitly: "For `checkoff_admin.html` (outside
this repo)." Any audit step that wants to read the admin tool's current source (Steps 2, 12,
and the METRO_SLUGS question below) will need Jerry to point Claude Code at wherever that file
actually lives — grepping this repo won't find it.

**A concrete doc-vs-reality gap already caught once:** `admin-tool-changes.md` proposes a
hardcoded `METRO_SLUGS = [{slug:'phoenix'...}, {slug:'milwaukee'...}, {slug:'tucson'...}]`
array that a future metro would need a line added to. But an Open Brain note from the same
week (7/18) says the *actual shipped* implementation instead reused the admin tool's existing
`metros` array with a derive-slug-from-name pattern specifically so "future metros auto-appear"
with no hardcoded list to edit — with the constraint that a new metro's **display name must
derive to the exact `metro_areas.slug` value**. These two documents disagree about whether
Denver needs a code edit here at all. The audit needs to check `checkoff_admin.html`'s current
source to see which pattern actually shipped.

## 5. No read-only production DB connection is evident from inside this repo

`.env` and `.env.local` in the repo only define `GOOGLE_PLACES_API_KEY` and
`SENTRY_AUTH_TOKEN`. Supabase config (project URL + anon key) reportedly lives in `app.json`
and `lib/supabase.js` (per an earlier Open Brain note) — anon key only, which is client-safe
but not useful for admin-level schema/RLS/trigger inspection. No service-role key, no
Supabase CLI project link, and no separate read-only Postgres role were found in this pass.

**This matters a lot for how much of the audit prompt Claude Code can actually complete in
one shot.** If Jerry doesn't set up *something* read-only before running Step 3 (a `supabase
login`/`link` if the CLI is available and he's comfortable running read-only `db pull`/introspection,
a scoped read-only Postgres role, or just the Supabase dashboard SQL editor with results pasted
back), Claude Code's honest output for Steps 3–9 will mostly be "UNKNOWN — needs production
query/access" plus a generated `00_schema_preflight.sql`. That's a legitimate outcome per the
prompt's own rules, but Jerry should decide *before* the run whether he wants that first pass
(code-only, schema-inferred) or wants to hand over real DB access first so it's a single pass.

## 6. Known open issues from the 7/17 overlay refactor that Tucson comparisons will run into

From the 7/18 Open Brain note ("STILL OPEN from refactor") — these are pre-existing, not
things the audit is expected to fix, but the audit should **recognize them as known issues**
rather than mistake them for new findings or, worse, treat Tucson as a fully clean template
without checking for them:

- Rail sort bug: `fetchCuratedLists()` sorts on `audience_groups.city_slug` **truthy**, not
  `=== userCitySlug` — so e.g. Milwaukee-tagged lists can rank above Phoenix's own on a
  Phoenix rail. One-line fix identified, not yet applied.
- `featured_experiences` row `cfb54ce0` ("Bachelorette Wine Day") points at an inactive list —
  known dangling reference, not yet cleaned up.
- Content backlog: 6 curated lists with zero universal items ("zero-universal shells"), 4 thin
  lists, Tucson-specific overlays not yet written, and **"Best of Tucson" curated list has 0
  items and is currently active** — i.e. Tucson itself is not a fully populated reference
  metro for curated-list content specifically, even though it's the most recent full metro
  launched via the geography/items pipeline.
- `curated_lists` has two overlapping public-read RLS policies (one gated on `is_active=true`,
  one `USING(true)`) — the permissive one makes the `is_active` gate a no-op. Flagged as
  "cleanup candidate, not urgent" — worth the audit re-confirming it's still true and logging
  it as "important before launch" or "safe to defer," not silently skipping it.

## 7. Recent migration history (last ~8 weeks, for Step 1 orientation)

Chronological, most recent last: `lists_featured_eligible` (6/30) → `email_automation_rpcs`
(7/9) → `destination_zone_invite_source`, `destination_zones_rls` (7/10–11) →
`item_deactivation_cleanup`, `city_partnerships_lockdown`,
`crew_picker_and_users_email_lockdown`, `destination_hub_foundation`,
`destination_lists_is_active`, `featured_experiences_and_badges_rls` (7/12–13) →
`destination_partner_credit_view`, `destination_spotlights` (7/13) →
`freeze_checkins_on_partner_cancellation`, `lists_public_read_for_destination_hub`,
`lists_source_destination_list_id` (7/13–14) → `metro_day_trips_foundation` (7/14) →
`destination_spotlights_event_dates` (7/15) → `interaction_events`,
`list_deletion_fk_fixes` (7/16, applied 7/20) → `backfill_checkins_item_id` (7/20) →
`checkoff_invite_source`, `neighborhoods_metro_id_nullable`, `willcox_tucson_promotion`
(7/21) → `creator_program_leads`, `creators_contact_email` (7/25) →
`standalone_checkins` (8/4) → `drop_standalone_lifetime_unique` (8/6) →
`seasonal_item_active` (8/9, **uncommitted**) → `update_item_location_rpc`,
`update_neighborhood_center_rpc` (8/11, **uncommitted**).

Notable: `neighborhoods_metro_id_nullable` and `willcox_tucson_promotion` landed the same day
(7/21) — almost certainly the "Experience → Metro Upgrade Path" pattern referenced in Open
Brain (destinations like Willcox start with `metro_id` null under a parent metro's
neighborhoods, and get promoted). `metro_day_trips_foundation` and `destination_hub_foundation`
are very likely load-bearing for Step 12 (deep links, destination cards) and should be read in
full, not assumed from their names — the audit prompt's own instruction ("do not assume a
trigger is harmless because its name looks familiar") applies just as much to these tables.

## 8. What this means for Denver specifically

Nothing here should be read as "Denver is blocked." It means: the audit should not start from
either the 7/5 Blueprint or the 6/28 playbook as ground truth — both predate the overlay
refactor. It should treat the **overlay architecture (curated_list_metros + dual city_slug
columns) and the is_universal/neighborhood_id classification signal as the current model to
verify against live schema**, explicitly check the two hardcoded-timezone functions before any
Denver item gets a `season_tag`, confirm what `checkoff_admin.html` actually does today for
metro dropdowns, and flag the DB-read-access question to Jerry before assuming Steps 3–9 can
run to completion unattended.
