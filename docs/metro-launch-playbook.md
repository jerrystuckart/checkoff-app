# CheckOff Metro Launch Playbook (v2)

Written 2026-08-21, distilled from the Denver/Boulder/Longmont launch cycle — the first metro
built and verified end-to-end with this process. **This supersedes every prior "Metro Launch
Playbook" note** (the 6/28/26 and 7/5/26 versions in particular): both predate the curated-list
overlay refactor and both got at least one load-bearing fact wrong (`items.city_id` requirements,
the EAS-build dependency) that this cycle corrected against live schema and code, not assumption.
Treat this document, not those, as the starting point for the next metro.

## Part 1 — What's now true platform-wide (not per-metro work anymore)

These used to be things every metro launch had to work around. As of the Denver cycle, they're
fixed once, for every metro, going forward.

**Geography model.** A selectable app metro is a `metro_areas` row with `is_active=true`. An
item's market is `neighborhood_id → neighborhoods.metro_id`, or `items.is_universal`. `items.city_id`
is legacy/optional — historically only ~26% of live items had it set, and it is NOT a required
field for a new metro's items. `cities` rows are confirmed non-essential for a new metro launch
(skip them unless you find a specific consumer that needs one — none was found for Denver).

**Timezone.** `metro_areas.timezone` (IANA name, e.g. `America/Denver`) exists and is threaded
through `apply_seasonal_active_on_tag_change()`, `sync_seasonal_item_active()`,
`season_days_until_start()`, `prevent_expired_list_checkins()`, and the client-side
`lib/seasonWindow.js`. Every metro needs this column populated correctly — get it right the first
time; the Denver cycle caught and fixed a live bug where Milwaukee had been silently computing
season/check-in boundaries on Phoenix's clock. One intentional exception: `HomeScreen.jsx`'s
`loadNearbyRail()` is deliberately cross-metro (GPS distance across all metros at once) and was
NOT threaded with a single timezone — that's correct, not a gap.

**List model.** `curated_list_metros` (a join table: no rows = universal/visible everywhere; rows
present = visible only in those metros) is the current mechanism for curated-list visibility.
`curated_lists.city_slug` is legacy/display-only — don't use it for visibility logic.
Item-level overlay is a nullable `city_slug` column on both `curated_list_items` and `list_items`
(NULL = universal, set = metro-specific). `curated_lists.is_active` now actually gates public
read (the RLS double-policy gap that used to make it a no-op is fixed) — this is the correct,
now-working mechanism for staging curated-list content hidden before it's ready.

**Staging mechanism — proven, not just theoretical.** `metro_areas.is_active=false` is the
confirmed way to build a metro fully in production before launch. Verified directly against live
code, not assumed: the city selector, `HomeScreen.jsx`'s GPS-nearest-metro resolution, and the
shared `lib/resolveDefaultMetro.js` helper all filter `metro_areas` on `is_active=true` — so a
staged metro's neighborhoods, audience groups, curated lists, and official-list shell are
unreachable by any real user, including someone physically standing in that metro's coverage area
with GPS on. Build the whole foundation with the metro inactive, verify it thoroughly, then flip
`is_active=true` as the actual, deliberate launch trigger.

**Known, accepted limitation — not fixed, and not worth blocking a launch over:**
`get_never_checkin_users()` (14-day re-engagement email targeting) can't do true per-user metro
personalization, because no per-user home-metro signal is persisted anywhere in the current
schema or client state (`users.neighborhood_id`/`city_id` are effectively unpopulated, and no
client-side selected-metro value is ever saved). It currently runs a
universal-item-first/globally-popular-fallback query instead. If per-user metro personalization
ever becomes a real product priority, it needs new onboarding-flow + schema work — track it as
its own initiative, not a per-metro-launch task.

**Also confirmed low-risk, not re-verified each time:** `checkoff_admin.html` (the admin tool)
lives outside this repo. Its metro dropdowns are confirmed to derive dynamically from live
`metro_areas`/`curated_lists` data rather than a hardcoded list — a new metro should appear there
automatically once its `metro_areas` row exists, no separate admin-tool code change expected.

## Part 2 — The reusable process

Six phases. Phases 1-2 can be much lighter for the next metro than they were for Denver, because
Part 1 above is now known-good — you're verifying it's still true and focusing on what's actually
new about this metro's geography/decisions, not rediscovering the whole platform architecture
from scratch.

### Phase 1 — Orientation (lightweight)

Before writing a full audit prompt: check Open Brain for anything already captured about the new
metro, confirm the repo's current branch/commit/dirty state, and run the git-sync discipline
below if the worktree has uncommitted work that needs handling first. This phase is mostly
"don't start blind," not deep investigation.

### Phase 2 — Audit (lean version — template)

Unlike Denver's audit, this doesn't need to re-derive the geography model, the list model, or
hunt for the timezone/RLS/never-checkin/BrowseLists bugs — those are resolved platform-wide (Part
1). Scope it to what's actually metro-specific:

> You are auditing CheckOff for adding **{METRO_NAME}** as a new metro. This is discovery only —
> no writes, no code changes, no migrations applied, no commits/pushes/builds/deploys.
>
> Part 1 of `docs/metro-launch-playbook.md` describes the current platform architecture as
> already-verified fact — confirm the specific pieces relevant to this metro still hold (e.g. re-run
> the `metro_areas.timezone` backfill check, confirm `curated_lists`' RLS still shows exactly 2
> policies) rather than re-investigating the whole platform from first principles. If anything in
> Part 1 no longer matches current code/schema, say so explicitly — that document itself could be
> stale by the time you read it.
>
> Investigate what's actually new here: **{METRO_NAME}**'s specific geography (does it introduce
> anything Denver/Phoenix/Milwaukee/Tucson didn't — multiple states, an unusual timezone, a
> coverage area spanning two IANA timezones, extremely dense or extremely sparse neighborhoods),
> whether any existing metro's neighborhoods/coverage area overlaps or borders this one in a way
> that affects `loadNearbyRail()` or day-trip/destination relationships, and what the cleanest
> existing metro is to model this one's foundation on (Phoenix/Milwaukee/Tucson/Denver — compare
> foundation records, not full catalogs).
>
> Produce a scaled-down version of Denver's `docs/metro-launch-audit/` deliverables — a README
> with readiness verdict, a manifest draft with the 5-decision checklist from Part 3 below
> answered as open questions, and a schema-preflight file only for anything that's genuinely
> metro-specific (not a full re-audit of tables already documented for Denver).

### Phase 3 — Decisions (same 5 categories every time)

1. **Slug.** Match the existing single-word-city convention unless there's a real reason not to
   (Denver kept `denver`; nothing in the codebase enforces single-word slugs, it's a product
   choice each time).
2. **Neighborhood granularity + ring radii.** More neighborhoods = better Nearby precision, more
   radii to individually tune. Whatever granularity is chosen, ring_2 circles must not overlap
   across the full set (verified programmatically, not eyeballed) — this held for all 20 Denver
   neighborhoods including the later Nederland/Eldora addition and should hold for the next metro
   too.
3. **`season_tag` at launch or not.** If not immediately, still get `metro_areas.timezone`
   correct at creation time — it costs nothing to set right the first time, and avoids a repeat of
   the Milwaukee-style bug when seasonal content gets turned on later.
4. **Audience-group content strategy.** Phoenix's broad ~8-group model vs. a thinner model vs.
   something tailored to the new metro's actual culture.
5. **Metro-scoped tags or global.** Global has been sufficient for every metro so far; only
   introduce `tags.metro_id` (new schema) if there's a real product need, not preemptively.

### Phase 4 — Generate (review-only, template)

> Generate (do not apply) the **{METRO_NAME}** foundation, based on the audit and the 5 resolved
> decisions above. No invented UUIDs — `gen_random_uuid()` in the SQL itself. Neighborhood
> coordinates via a live Google Places API call, same pattern as `scripts/geocode-items.js` —
> never estimated from memory — with raw results saved for the audit trail. Stage the new
> `metro_areas` row `is_active=false`; new `curated_lists` rows `is_active=false` (this now
> actually hides them, since the RLS fix is already live). Flag every judgment call (ring radii,
> audience-group names, display name) explicitly as something to react to, separate from anything
> that's a direct application of an already-decided fact. Present everything as new/unstaged
> files and diffs — nothing applied, committed, or pushed.

### Phase 5 — Follow-up fixes

Whatever the generation pass honestly flags as incomplete (it will — Denver's did, twice: the
`lib/seasonWindow.js` callers, and a bad Milwaukee timezone backfill caught in review before it
shipped). Address each flagged item with its own tightly-scoped follow-up prompt rather than
re-running the whole generation pass.

### Phase 6 — Apply (template)

> Apply the reviewed **{METRO_NAME}** foundation to production. Follow this exact discipline,
> proven across the Denver apply:
>
> - Phase 0: re-confirm nothing drifted since review (git status, and a live check that the new
>   metro's row doesn't already exist, that the fixes you're about to apply haven't already been
>   applied by someone else).
> - Confirm dependency order between migration files explicitly — don't trust filename/date
>   ordering. (Denver's four platform-fix/foundation files shared one date prefix; applying them
>   in default order would have broken because the foundation SQL depends on a column added by
>   another file in the batch.)
> - Confirm each migration file is wrapped in an explicit transaction before applying it.
> - Apply one file at a time via `supabase db query -f <path> --linked` (this project's
>   migrations aren't tracked through the CLI's normal history — don't use a blanket
>   `db push`), verifying against a specific query after each one. Stop on any unexpected result
>   rather than continuing past it.
> - Absolute boundary: do not flip `metro_areas.is_active=true` as part of this prompt. That's
>   the actual launch trigger — a separate, deliberate action once items/assets/dates are ready,
>   not a side effect of applying the foundation.
> - After DB changes verify clean, apply any accompanying app-code diffs, run whatever
>   lint/typecheck the repo has configured (none, as of Denver — a Babel syntax parse was used as
>   a substitute; check if that's changed), then commit and push with the same
>   quarantine-and-grep discipline as the git-sync pattern below.
> - Report every verification result explicitly (not summarized as "all good"), the commit hash,
>   and explicit confirmation nothing was built or deployed.

### Incremental additions to an already-staged metro

For a single small addition after the foundation is already staged (a neighborhood, in Denver's
case — Nederland/Eldora, added while `is_active` stayed `false` throughout) — don't re-run the
full generate/apply cycle. Use a narrowly-scoped single-purpose prompt: verify the target metro's
current record live rather than trusting a hardcoded id in the prompt, get coordinates the same
Google-Places way as everything else, hold the same ring-radius invariants against the *full*
now-larger set, use `gen_random_uuid()` + an explicit `NOT EXISTS` idempotency guard rather than
a hand-picked UUID, and verify the addition doesn't change the metro's reachability. Same
apply/verify discipline as Phase 6, just scoped to one row.

### Git-sync discipline (not metro-specific — apply any time the worktree needs syncing)

Before committing anything: stage explicitly, never `git add -A`. Check every untracked file
against what's already deliberately gitignored (one-time admin/geocoding/import scripts with
embedded keys have a real precedent of slipping through under a new filename — check by content,
not just by matching the existing `.gitignore` patterns). Grep the actual staged diff for
key-shaped strings (`eyJ`, `AIza`, `sk-`, `service_role`, `BEGIN PRIVATE KEY`,
`Authorization: Bearer`, `api[_-]?key|secret|token|password`) before committing, every time — this
caught a real hardcoded Supabase anon key in a new `scripts/` directory during the Denver cycle
that no existing `.gitignore` rule covered.

## Part 3 — Launch-day checklist (once a metro's foundation is staged and verified)

1. Real item intake — a dedicated session against the authoritative item-intake contract, not
   fabricated during a generation pass.
2. Visual assets — metro hero images, curated-list header images, and a metro-aware replacement
   for any hardcoded onboarding content (Denver inherited a literal "Phoenix Fall 30" mock in
   `OnboardingScreen.jsx` shown to every new user regardless of metro — check whether that's been
   fixed generally or still needs a per-metro workaround).
3. Pick the launch season / real `starts_at`/`ends_at` for the official list, and update the
   placeholder title generated during Phase 4 — don't leave a literal `"{SEASON} {YEAR}"` string
   sitting in production.
4. Flip each populated `curated_lists` row's `is_active=true` individually — this doesn't happen
   automatically when the metro goes live.
5. Device QA: city selector shows the new metro and defaults correctly for a GPS-enabled device
   physically in the area; Home hero renders the correct single official list; Nearby/Discover
   ring-tiers correctly at real distances; a check-in near a list boundary date resolves correctly
   in the metro's own local time; a broken/stale deep link for this metro does not fall through to
   another metro's content; a new zero-activity test account in this metro gets sane (even if not
   perfectly personalized, per the known `get_never_checkin_users()` limitation) re-engagement
   behavior.
6. Coordinated flip: `metro_areas.is_active=true`. This is the actual launch moment — sequence
   timing/announcement around it deliberately, it's not a side effect of any prior step.

## Part 4 — Default scope for a full autonomous metro build (required enhancement, recorded 2026-09-06)

Jerry's correction during the San Diego reconciliation repair cycle: a bare command like
"Winston, build out Vienna, Austria" should be understood as a request for a **complete
launch-ready metro package**, not just a permanent catalog. San Diego was built (and is
being repaired) as catalog-only because that was the explicit scope at the time — this is
not a retroactive requirement for San Diego in this repair cycle, but it IS the required
default scope for the next metro built from a bare "build out X" instruction, unless Jerry
explicitly narrows the ask.

The default autonomous metro build should produce all of the following, not catalog alone:

1. **Permanent catalog** — the existing Phase 1-6 process in this document.
2. **Neighborhood coverage** — real, geocoded neighborhoods with non-overlapping ring radii
   (existing Phase 2/4 process).
3. **Verified CheckOffized items** — routed through the OpenAI-exclusive editorial provider,
   never Claude-authored (see `agent-service/specialists/remoteAiExecutor.ts`'s
   `SPECIALIST_EXCLUSIVE_PROVIDER`).
4. **Categories/tags** — using the canonical category set, extending it only via an explicit
   migration when a genuinely new category is needed (as San Diego's Shopping/Sports/Social/
   Travel additions were).
5. **Google Places geocoding** — real item-level `maps_lat`/`maps_lng`, a separate, later,
   human-reviewed pass per the existing convention (never fabricated at intake time).
6. **At least one featured, visitor-facing list** — not just the permanent catalog sitting
   unlisted; a real curated list meant to be the metro's public front door.
7. **Current-season list(s) when appropriate** — a real launch season / `starts_at`/`ends_at`,
   not a placeholder title left in production (existing Phase 3 launch-day item #3).
8. **Obvious themed list(s) when justified by the destination** — e.g. a cross-border
   extension (San Diego/Tijuana), a signature seasonal event, or another theme genuinely
   native to that metro — not manufactured filler.
9. **Featured/hero configuration** — metro hero images and any `featured_experiences` bridge
   cards the destination's structure calls for (e.g. cross-border, multi-neighborhood hub).
10. **Launch-readiness validation** — the existing Part 3 launch-day checklist (device QA,
    coordinated `metro_areas.is_active=true` flip, etc.) run and passing before declaring the
    build complete.

A build that stops at item 1 (catalog only) should be labeled a **partial** build in its own
status report, not presented as a finished metro launch, unless Jerry explicitly asked only
for the catalog.

## Provenance

Built and verified against the Denver/Boulder/Longmont launch cycle, 2026-08-21 —
`docs/metro-launch-audit/` in this repo holds the full audit trail (10+ files), the generation
pass, two follow-up fix passes, the production apply (commit `929bfb6302bbb65bcdfc0e3149cedebea94f4363`),
and the Nederland/Eldora incremental addition. This document is the distilled, reusable process —
that folder is the historical record of the run that proved it.
