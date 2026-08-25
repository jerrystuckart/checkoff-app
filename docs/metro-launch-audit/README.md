# Denver/Boulder Metro Launch Audit — Executive Summary

Audit performed 2026-08-21 against commit `9efe3f2` on `main`, and against the live production
database (project `uggusbbswybyplypkbxz`, via `supabase db query --linked` read-only SELECT
queries — see [00_schema_preflight.sql](00_schema_preflight.sql) for every query run and its
purpose). Discovery only — no writes, migrations, code changes, builds, commits, or pushes were
performed.

## Readiness: READY WITH DECISIONS

The core architecture is genuinely metro-agnostic and data-driven — adding one `metro_areas` row
plus tagged `neighborhoods`/`items`/`lists` will make most of the app work for Denver with zero
code changes. But a small number of **confirmed, concrete bugs** (not hypothetical risks) exist
today that will directly and visibly affect Denver users at launch, plus several open product
decisions that should be resolved before generating any mutation SQL.

## Note on `00_open_brain_and_repo_context.md`

This audit's own deliverables directory already contained a pre-existing
`00_open_brain_and_repo_context.md` (prep material cross-referencing Open Brain against an
earlier repo pass) — it was read in full and its claims were spot-checked against this audit's
live findings rather than trusted at face value, per its own instruction to treat every claim as
"a lead to verify," not a fact. Two of its flagged "still open" issues turned out to be
**already fixed** as of this audit (the `fetchCuratedLists()` rail-sort bug now correctly sorts
on `curated_list_metros` presence, not the legacy `audience_groups.city_slug` field — see
[04](04_list_model_and_seasonal_selection.md) — and "Best of Tucson" now has 22 items, not 0 —
see [03](03_existing_metro_comparison.md)). One remains open (the `curated_lists` RLS
double-policy). One remains as documented and unresolved by this pass (`featured_experiences`
row `cfb54ce0…` still points at an inactive list — see [03](03_existing_metro_comparison.md),
classified safe-to-defer). Its context also correctly anticipated the timezone hardcode and the
`checkoff_admin.html`-out-of-repo gap, both independently confirmed by this audit.

## Worktree/premise discrepancy — reported as instructed

The audit brief's premise (dirty worktree with specific uncommitted files and three "unapplied"
migrations) is **stale**. As of this audit run: the worktree is clean except
`supabase/.temp/cli-latest` (modified) and this new `docs/` directory. Every file the brief listed
as uncommitted (`.gitignore`, `app.json`, `lib/useNearby.js`, `screens/DiscoverScreen.jsx`,
`screens/HomeScreen.jsx`, `screens/OnboardingScreen.jsx`, `components/OnboardingDeviceFrame.jsx`,
`components/OnboardingPreviews.jsx`, `lib/seasonFilter.js`, `scripts/`) and all three "unapplied"
migrations (`20260809_seasonal_item_active.sql`, `20260811_update_item_location_rpc.sql`,
`20260811_update_neighborhood_center_rpc.sql`) are already **committed**, in commit `9efe3f2`
("Onboarding rework, home/discover seasonal fixes, and admin RPC migrations"). Nothing was
stashed, reverted, or cleaned by this audit — the files simply arrived at a settled state before
this run started. More significantly: those three migrations are also **already applied to
production** (their functions/triggers exist live in the DB) — the "unapplied" framing in the
brief was incorrect on the database side too, not just the local-worktree side. See
[01_current_schema_and_relationships.md](01_current_schema_and_relationships.md) for how this was
verified (`supabase migration list --linked` doesn't track this project's actual apply history,
since migrations are applied outside the CLI's tracked flow).

## Database access — better than expected

No Supabase credentials exist in the repo's `.env`/`.env.local`. However, the `supabase` CLI is
already linked to the production project, and `supabase db query -f <file> --linked` opens a
live session **without needing Docker**. This audit used that path to run real, verified
read-only queries for nearly every step (3 through 9, plus 11-13) instead of falling back to an
unexecuted preflight file — [00_schema_preflight.sql](00_schema_preflight.sql) exists as a
reproducibility artifact, not an unmet dependency. Caveat: this CLI session is not
permission-restricted to read-only — care was taken throughout to run only SELECT statements.

## The five most important findings

1. **Timezone hardcoding is a real, live, functional bug — not cosmetic, and not Phoenix-only.**
   Six DB migrations plus `lib/seasonWindow.js` hardcode `America/Phoenix` for computing season
   visibility and list start/end boundaries. Milwaukee and Tucson already have season-tagged items
   exposed to this today. Denver (which observes DST, unlike Phoenix) would be the first metro
   where the resulting drift is large enough to actually flip check-in acceptance/rejection near a
   list boundary, not just miscount a display number. Fix requires new schema
   (`metro_areas.timezone`) threaded through 4 DB functions and 1 client file — not a data-only
   fix. **Launch blocker if Denver uses `season_tag` at launch.**

2. **`get_never_checkin_users()` hardcodes Phoenix's exact metro UUID** for every zero-activity
   user's re-engagement email suggestions, across all metros, confirmed via direct migration
   source and cross-checked against the live `metro_areas.id`. Every Denver signup who doesn't
   check in within 14 days gets Phoenix item suggestions today. **Launch blocker, DB-level fix
   needed.**

3. **`curated_lists` has a confirmed-still-live RLS gap**: a permissive `USING(true)` SELECT
   policy coexists with the intended `is_active=true` gated one, making `is_active` a no-op for
   public read. This directly breaks the "stage Denver content as inactive before go-live" plan
   unless fixed first — anyone can already read `is_active=false` curated lists today.
   `metro_areas.is_active=false`, by contrast, **is confirmed to work** as a city-selector hide
   mechanism, so metro-level staging is safe; list-level staging is not, yet.

4. **`BrowseListsScreen.jsx` defaults to `'phoenix'`** whenever it's reached without explicit
   params — which is every deep-link failure path and every post-list-completion flow except
   Home's own explicit tile. A Denver user hitting a stale/broken link, or finishing any list,
   lands on Phoenix's curated lists. Pre-existing for Milwaukee/Tucson too, but will be
   immediately visible at Denver's launch.

5. **The geography model resolves a real internal contradiction, and Denver's neighborhood ring
   radii need custom values, not schema defaults.** `items.city_id` is populated on only 25.9% of
   live items — it is legacy/optional, not required; the operative signal is
   `neighborhood_id → neighborhoods.metro_id` or `is_universal`. Separately, the schema's default
   neighborhood check-off ring radii (20mi/40mi) were sized for Phoenix/Milwaukee's spread-out
   geography and would cause real cross-neighborhood false-positive check-ins across Denver's
   much tighter (3-8 mile) neighborhood spacing if used as-is.

## Unresolved decisions Jerry must make

1. Final Denver metro slug (`denver` / `denver-boulder` / `front-range` / other) — no code risk
   either way, purely a naming call.
2. Neighborhood granularity for the west suburbs (Golden/Lakewood/Arvada/Westminster/Broomfield)
   and Boulder County (Boulder/Louisville/Superior/Lafayette/Erie/Longmont) — determines both the
   neighborhood taxonomy and the ring-radius values needed.
3. Whether any Denver items use `season_tag` at launch — this single decision determines whether
   finding #1 above is a hard blocker or can be deferred (universal/non-seasonal items are
   unaffected).
4. Audience-group content strategy for Denver — Phoenix's broad 8-group model vs. Tucson's
   thin/none model vs. a new approach.
5. Whether Denver needs metro-scoped tags (new schema — `tags` has no metro column today) or the
   existing global tag table is sufficient.

## Database access limitations

None beyond the credentials-in-repo point above — live read-only access was available and used
throughout via the linked Supabase CLI session. No table or function needed for this audit was
inaccessible.

One residual gap: `checkoff_admin.html` (the admin tool referenced throughout prior project
history) is **not in this repository** — confirmed via `admin-tool-changes.md` at repo root and
a filesystem check that found it only at `/Users/jerrystuckart/Downloads/checkoff_admin.html`
(outside this repo, alongside several other admin-tool variants). Its exact current source was
**not read** as part of this audit (out of scope for a repo-focused pass) — if Denver's admin-tool
workflow (e.g. the `metros` array / derive-slug-from-name pattern referenced in prior project
history) needs verification, that requires a separate look at that external file.

## Created files

- [README.md](README.md) (this file)
- [00_schema_preflight.sql](00_schema_preflight.sql)
- [01_current_schema_and_relationships.md](01_current_schema_and_relationships.md)
- [02_app_metro_dependencies.md](02_app_metro_dependencies.md)
- [03_existing_metro_comparison.md](03_existing_metro_comparison.md)
- [04_list_model_and_seasonal_selection.md](04_list_model_and_seasonal_selection.md)
- [05_item_intake_contract.md](05_item_intake_contract.md)
- [06_checkin_join_timezone_deeplink_audit.md](06_checkin_join_timezone_deeplink_audit.md)
- [07_denver_metro_manifest_draft.md](07_denver_metro_manifest_draft.md)
- [08_future_metro_build_sequence.md](08_future_metro_build_sequence.md)

## Recommended next Claude Code prompt (not executed)

> "Using docs/metro-launch-audit/07_denver_metro_manifest_draft.md and
> 08_future_metro_build_sequence.md, and after I've made the 5 open product decisions listed in
> the README, generate (but do not run) a staged, reviewable SQL migration set for: (1) the
> platform-wide `metro_areas.timezone` fix threaded through the 4 seasonal/check-in functions and
> `lib/seasonWindow.js`, (2) the `curated_lists` RLS double-policy fix, (3) the
> `get_never_checkin_users()` Phoenix-UUID fix, (4) the `BrowseListsScreen.jsx` hardcoded-fallback
> fix, and (5) the Denver geography/items/lists foundation itself, sequenced per the build order
> in doc 08. Each file should be reviewable and reversible independently — do not apply any of
> them without my explicit go-ahead on each one."

## Confirmation

No database writes, code changes, builds, commits, pushes, or deployments occurred during this
audit. All in-flight work identified in the repository (currently just
`supabase/.temp/cli-latest`, which was not touched) was preserved. Only new files under
`docs/metro-launch-audit/` were created.
