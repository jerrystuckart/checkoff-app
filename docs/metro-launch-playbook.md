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
5. **Metadata completeness** — every non-geo, non-catalog column
   (`has_alcohol`, `checkin_type`, `difficulty`, `photo_required`, `is_secret`,
   `visit_profile_key`, `website_url`) explicitly EVALUATED per item, not left sitting at its
   bare insert-time default. See Part 5 below — this is a real, required gate now, not an
   implicit assumption.
6. **Google Places geocoding** — real item-level `google_place_id`, `formatted_address`,
   `maps_lat`/`maps_lng`, `geo_location`, `geo_radius_m`, a separate, later, human-reviewed
   pass per the existing convention (never fabricated at intake time). Kept deliberately
   separate from item 5 — one requires an external API call, the other doesn't, and neither
   gate substitutes for the other.
7. **At least one featured, visitor-facing list** — not just the permanent catalog sitting
   unlisted; a real curated list meant to be the metro's public front door.
8. **Current-season list(s) when appropriate** — a real launch season / `starts_at`/`ends_at`,
   not a placeholder title left in production (existing Phase 3 launch-day item #3).
9. **Obvious themed list(s) when justified by the destination** — e.g. a cross-border
   extension (San Diego/Tijuana), a signature seasonal event, or another theme genuinely
   native to that metro — not manufactured filler.
10. **Featured/hero configuration** — metro hero images and any `featured_experiences` bridge
    cards the destination's structure calls for (e.g. cross-border, multi-neighborhood hub).
11. **Launch-readiness validation** — the existing Part 3 launch-day checklist (device QA,
    coordinated `metro_areas.is_active=true` flip, etc.) AND both gates in Part 5 passing
    before declaring the build complete.

A build that stops at item 1 (catalog only) should be labeled a **partial** build in its own
status report, not presented as a finished metro launch, unless Jerry explicitly asked only
for the catalog.

## Part 5 — Metadata completeness and geo enrichment gates (required, recorded 2026-09-06)

San Diego's reconciliation surfaced the next systematic gap after the catalog itself was
correct: every one of `website_url`, `google_place_id`, `formatted_address`, `maps_lat`,
`maps_lng`, `geo_location`, `geo_radius_m`, `visit_profile_key` was 100% NULL across all 149
items, `has_alcohol`/`checkin_type`/`is_secret` were 100% at their bare schema default, and
`difficulty`/`photo_required` were at default except for exactly one manually-edited row. A
column holding its default value is NOT evidence the field was ever evaluated — it looks
identical to a field nobody has ever looked at. **A future bare "build out `<city>`" must not
report launch-ready while this ambiguity still exists.**

Two separate, reusable gates close this gap — see
`agent-service/playbooks/metroMetadataEnrichment.ts`:

- **`METADATA_COMPLETENESS_GATE`** (`evaluateMetadataCompletenessGate`) — covers the 6
  content-evaluable fields (`has_alcohol`, `checkin_type`, `difficulty`, `photo_required`,
  `is_secret`, `visit_profile_key`) plus tracks `website_url` research status separately
  (not a gate failure on its own, since it always requires a targeted external lookup, never
  a fabricated value). PASSes only when every item has an explicit `evaluated: true` record
  for each of the 6 fields — deterministic rules where a real, generalizable rule exists
  (category + keyword matching), explicitly flagged LOW-confidence proposals for a human
  glance where it doesn't (never a silently guessed value for something like `difficulty` or
  `is_secret`, which are real curatorial/UX decisions).
- **`GEO_ENRICHMENT_GATE`** (`evaluateGeoEnrichmentGate`) — covers the 6 Google-Places-
  dependent fields. Deliberately kept SEPARATE from the metadata gate (one requires an
  external API call and its own review pass — `scripts/geocode-*.js` — the other doesn't) and
  FAILs by default with no fabricated "not needed" escape hatch; only PASSes once a real
  Google Places pass has actually run and been reviewed.

**Preserving manual overrides**: `evaluateItemMetadata()` never overwrites an existing value
that already differs from the bare schema default (a genuine prior manual edit) — it
preserves it verbatim and marks it `preservedManualOverride: true`. A value that merely
MATCHES the default is NOT treated as a confirmed override, since there's no way to
distinguish "confirmed false" from "never touched" from the value alone — which is exactly
the ambiguity this whole gate exists to remove going forward.

### Product rules for the 3 fields with real UX/policy consequences (Jerry, 2026-09-06)

Three of the six content-evaluable fields are not neutral facts — getting them wrong changes
real product behavior or violates a business rule. These corrections are now permanent parts
of the methodology, not a one-off San Diego fix:

- **`has_alcohol` is an ITEM property, not a venue property.** True only when completing the
  CheckOff item itself requires ordering/consuming/engaging with alcohol ("Order a tiki
  cocktail at False Idol" → true; "Order the Paella Negra" at a place that also serves
  alcohol → false; "Dance at Rich's" → false even though Rich's is a bar). A venue's category
  (Bar & drinks, Nightlife) never sets this true on its own anymore. All keyword matching uses
  `\b...\b` word-boundary regex — a prior plain-substring check let `"ale"` fire inside
  `"whale"`, `"Whaley"`, `"Daley"`, `"tamale"`; every future keyword added to this list must
  go through `wordBoundaryPattern()`, never `.includes()`.
- **`is_secret` is NEVER inferred from item wording, ever, for any future metro.** It marks a
  paid Pro/Premium business feature, not an editorial judgment. `determineIsSecret()`
  deliberately doesn't even accept a `body` parameter — there's no code path by which
  "hidden entrance"/"speakeasy"/"concealed door" language can reach this field. The only way
  it becomes `true` is an explicit, real, business-configured flag passed in from outside this
  module.
- **`difficulty` follows a completion-EFFORT rubric, not a prestige rubric.** `1` = normal
  walk-in/order/visit; `5` = meaningful cost, reservation/planning, special timing, travel,
  moderate physical effort, a booked activity, or limited access (a guided kayak/whale-watch/
  hot-air-balloon reasonably qualifies); `10` = major commitment/high effort/cost/unusual
  activity (skydiving); `25` = reserved for true Secret Items/special premium experiences and
  is NEVER auto-assigned during normal intake, `is_secret` status included. "Michelin-starred"
  alone is deliberately excluded from the tier-5 signal list (prestige isn't effort), and a
  concealed/hidden entrance alone does not raise the tier either.

### Reusable default enrichment pipeline order

```
final catalog → deterministic metadata pass → Google Places enrichment (incl. website)
  → targeted unresolved research only → completeness certification
```

`website_url` is deliberately NOT researched item-by-item during the metadata pass —
`determineWebsiteUrl()` always returns `evaluated: false` and defers to the Google Places
step, which returns an official website field wherever the business has one on file
alongside `google_place_id`/`formatted_address`/`maps_lat`/`maps_lng`/`geo_location`/
`geo_radius_m`. Only items Places can't resolve at all, or for which Places returns no usable
website, get an individual targeted lookup afterward — never 100+ speculative one-off
searches up front.

### Places research is a separate, permanently CACHED stage — apply never re-calls it

Corrected 2026-09-06 after San Diego's Places dry run was mistakenly at risk of being re-run
just to turn its own results into SQL. The Google Places stage of the pipeline above is
itself four distinct steps, and step 4 must NEVER trigger step 1 again:

1. **Places research call** — one Text Search call per venue (never per-field, never
   repeated), writes a local JSON cache file (`san-diego-places-dry-run-<date>.json` is the
   San Diego example) capturing the full result set needed to certify a match:
   `google_place_id`, `formatted_address`, `maps_lat`/`lng`, `websiteUri`,
   `addressComponents` (for country verification), `viewport` (for area-venue radius
   proposals) — never just the bare geocode.
2. **Cached enrichment artifact** — that JSON file IS the authoritative research result from
   that point forward. It is read, re-read, and reasoned about as many times as needed; it is
   never treated as a "dry run to be redone" once real API calls already produced it.
3. **Human/automated match certification** — every result gets a tier (EXACT,
   HIGH_CONFIDENCE_PARENT_VENUE, AMBIGUOUS_NEEDS_REVIEW, UNRESOLVED) from structural risk
   flags (multi-location chains, parent-venue/sub-experience wording, recurring events with
   no fixed venue, area/district/market venues, "various operators" experiences) plus a
   country cross-check (never accepted on name similarity alone). Ambiguous rows are resolved
   FROM THE CACHED DATA already returned (address, neighborhood, parent venue, country,
   item context) — a new API call is only ever justified when the cache genuinely contains no
   information capable of resolving the question, and even then it's a targeted single
   lookup for that one venue, never a full re-run.
4. **Production apply** — an UPDATE built strictly from what step 3 certified. If the apply
   step's own catalog reconstruction produces a candidate that isn't in the cache at all,
   that means the catalog drifted since step 1 ran — the apply script must refuse and say so,
   never silently re-query Places to paper over the drift.

Any item the cache can't certify (a confirmed wrong match, an org address standing in for an
event site, a zero-result event with no fixed venue) is excluded from the apply patch and
left untouched (NULL) rather than forced — a future corrected or targeted pass handles it,
never a guess baked into production.

## Part 6 — METRO_LAUNCH_CERTIFICATION and the bare-command definition (required, recorded 2026-09-07)

Jerry's correction after the San Diego editorial repair cycle: even after 7-8 rounds of manual
checking, he kept finding obviously generic items ("Go shopping at all the stores at the mall")
that had technically passed every existing gate, plus ~44-47/149 items opening with "Order," zero
tags on every item at initial launch, and lists that existed in `curated_lists` but never appeared
on Home because no corresponding `public.lists`/`public.list_items` rows existed. **The required
result of a metro build is now one of exactly two outcomes: `READY TO ACTIVATE`, or `BLOCKED` with
only genuine human-decision blockers.** It is not acceptable for Winston to stop after research,
catalog creation, or SQL generation and leave Jerry to discover additional missing production
layers manually.

### What a bare "Winston, build out `<metro>`" now means

`agent-service/playbooks/metroLaunchCertification.ts`'s `certifyMetroLaunch()` is the single, final,
fail-closed stage every autonomous metro build must reach before reporting done. A bare build
command runs through all 23 steps below — Winston should never require Jerry to remember which
hidden table is missing:

1. Geography definition
2. Neighborhood coverage
3. Broad discovery
4. Category/geography audit
5. Targeted gap research
6. Verification/current-open checks
7. Distinctive-item qualification (`editorialDistinctiveness.ts`'s `checkDistinctiveExperience()` —
   see below)
8. OpenAI CheckOff editorial (Winston's exclusive provider — never Claude-authored, see
   `agent-service/specialists/remoteAiExecutor.ts`'s `SPECIALIST_EXCLUSIVE_PROVIDER`)
9. Editorial self-repair/certification (`EDITORIAL_GATE` + `DISTINCTIVE_EXPERIENCE_GATE`)
10. Venue-name quoting (`VENUE_QUOTING_GATE`)
11. Duplicate certification (`CATALOG_GATE`'s duplicate checks)
12. 6-8 canonical tags/item (`TAG_CERTIFICATION_GATE`)
13. Metadata enrichment (`METADATA_COMPLETENESS_GATE`)
14. Google Places cached enrichment (the 4-step pipeline in Part 5)
15. Geo/website certification (`GEO_ENRICHMENT_GATE`)
16. Seasonal flagship-list creation
17. Justified themed-list creation
18. Curated-list structures where the current app architecture requires them
    (`CURATED_LIST_LAYER_GATE`)
19. Official `public.lists` + `public.list_items` Home structures (`HOME_LIST_CERTIFICATION_GATE`)
20. Image/hero readiness
21. Actual Home-query visibility validation (the decisive check inside
    `HOME_LIST_CERTIFICATION_GATE` — a row with every field correct that the real runtime query
    still doesn't return is NOT Home-ready)
22. Launch certification (`certifyMetroLaunch()`)
23. Activation package (the Part 3 launch-day checklist, staged and ready — not applied)

### The distinctive-experience test — semantic, not lexical

The San Diego editorial failure was semantic, not lexical: **"could this sentence still work if I
swapped in ten other businesses of the same type? If yes, it fails."** Banning one phrase or
rotating synonyms never satisfies this — "shop at the mall," "browse the stores," "eat at the
restaurant," "have a drink at the bar," "see art at the museum," "visit the beach," and "experience
the nightlife" all remain unacceptable regardless of verb ("explore"/"discover"/"savor"/
"experience"/"enjoy"/"check out" included). `checkDistinctiveExperience()` in
`agent-service/playbooks/editorialDistinctiveness.ts` matches the underlying CONCEPT (a generic
verb synonym + a generic category noun, with no specific qualifying detail — a number, a quoted
term, a specific compound-hyphenated descriptor like "shark-bitten," or a named product/feature —
rescuing it). A venue is never entitled to an item merely for coverage: when no distinctive hook
can be found, Winston returns to research or rejects the venue with `REJECT_NO_DISTINCTIVE_EXPERIENCE`.

### Mandatory venue quoting

Every destination business/venue/attraction/landmark/named place in a final item body must be
wrapped in literal single quotes (`'Cori Pastificio Trattoria'`, `'Hennessey's Tavern'` — the
venue's own apostrophe does not break the wrapping-quote detection, since the check is "does the
exact substring `'<venue name>'` appear," not "are there exactly two quote characters").
`checkVenueQuoted()` validates this per item; `VENUE_QUOTING_GATE` certifies the whole catalog.

### Opening-word distribution is a HARD gate now, separate from EDITORIAL_GATE's advisory note

`metroCatalog.ts`'s existing `EDITORIAL_GATE` deliberately keeps its own batch-level opening-word
check advisory-only (per an earlier 2026-09-06 instruction: don't contort genuinely specific
per-item wording into artificial lexical diversity). That carve-out is UNCHANGED at the per-item
pass, but Jerry's 2026-09-07 correction adds a separate, ALWAYS-HARD gate at final certification:
`evaluateOpeningDistributionGate()` in `editorialDistinctiveness.ts`, default max share 15% (same
threshold, tighten only for a documented, compelling reason). San Diego's real ~44-47/149 "Order"
items (~30%) were each individually valid and still unacceptable at the batch level — this gate
exists specifically so that can never happen again, independent of per-item specificity.
Semantic specificity still comes first: never satisfy this gate by rotating synonyms while leaving
the underlying sentences equally generic — fix it by finding more genuinely distinct hooks.

### Tags are mandatory before certification (6-8, not the Item Intake exactly-8 rule)

San Diego launched with ZERO tags on every item. `agent-service/playbooks/metroTagCertification.ts`'s
`evaluateTagCertificationGate()` is now a required, hard-failing part of `certifyMetroLaunch()`:
every item needs 6-8 valid canonical `public.tags.name` values (prefer 8 when 8 are genuinely
relevant — never padded with filler), verified against a live query or, when live verification is
unavailable, the current verified canonical tag snapshot — this module never invents, singularizes,
or pluralizes a tag name (the real lesson: `cocktails` exists in production, `cocktail` did not).
This is DISTINCT from `itemIntake.ts`'s `validateTagSelection()`, which retains its stricter,
unchanged exactly-8 (5 tier-1 + 3 tier-2) methodology for the individual phone/ChatGPT Item Intake
flow specifically.

**Known gap, recorded honestly:** the `agent_service` DB role does not currently have `SELECT` on
`public.tags` (confirmed via a live permission-denied error, 2026-09-07). Either grant it, or Jerry
must supply a fresh tag export before each metro build — this module refuses to fabricate a
vocabulary rather than silently working around the missing grant.

### SQL execution compatibility

Every generated Jerry-run production patch should pass `agent-service/playbooks/sqlPatchSafety.ts`'s
`checkSqlPatchSafety()` before being handed to Jerry: no `CREATE TEMP TABLE`/`CREATE TEMPORARY
TABLE` dependency (Supabase's SQL Editor does not guarantee a temp table survives across separate
executions — prefer a single atomic `DO $$ ... $$;` block with inline datasets and fail-closed
`RAISE EXCEPTION` assertions instead), and no `MIN(<identifier column>)` used to resolve a supposedly
unique match (UUIDs have no meaningful order — `MIN()` on one silently picks an arbitrary row). When
a match must resolve exactly once, use `buildUniqueMatchAssertion()`'s count -> assert count = 1 ->
select pattern, never a bare `SELECT ... INTO`, `LIMIT 1`, or `MIN(id)`.

### List architecture — Home visibility is governed by `public.lists`, not `curated_lists` alone

The single biggest San Diego discovery: rows in `curated_lists`/`curated_list_items`/
`curated_list_metros` are NOT sufficient for a Home-visible official/themed list. The real,
confirmed runtime read path (`screens/HomeScreen.jsx`) is `public.lists WHERE is_official = true
AND is_public = true AND metro_id = <metro>`, with membership from `public.list_items`. Before
generating launch SQL for any Home-visible content, Winston must inspect the actual current
app/admin read path and confirm exactly which tables/columns/filters control visibility — never
rely on naming assumptions like `is_featured`/`featured_experiences`/`curated_lists` alone.
`agent-service/playbooks/homeListCertification.ts` encodes this as two SEPARATE certifications
(`HOME_LIST_CERTIFICATION_GATE` for the real `public.lists`/`public.list_items` layer,
`CURATED_LIST_LAYER_GATE` for the legacy/curated-definition layer when the app still requires it) —
"the row exists" is never conflated with "the actual runtime query would return it"; the gate's
decisive final check is exactly that: does a live simulation of the real Home query actually return
this list.

**Required launch list package** (default scope, per Part 4 item 7-9, made concrete): one primary
current seasonal/flagship list (`is_public=true`, `is_official=true`, correct `metro_id`, correct
`starts_at`/`ends_at`, `is_featured_eligible=true` where appropriate, ~30 balanced items), plus 2-4
justified themed lists (`is_official=true`, `is_public=true`, correct `metro_id` and date window,
generally `is_featured_eligible=false` — San Diego's Fall Nights & Hidden San Diego, San Diego Fall
Coast & Outdoors, Fall Markets/Art & Local Finds precedent). A genuine cross-border/special
extension (San Diego's Tijuana list) is handled separately, never blindly treated as an ordinary
themed list.

### Images are part of launch readiness, not a post-activation discovery

A metro is not `READY_TO_ACTIVATE` if a Home-visible list card required an image and doesn't have
one — `homeListCertification.ts`'s `requiresImage`/`hasImage` fields make this an explicit,
certifiable field rather than something Jerry finds after activation via the Home Screen admin.
When an image cannot be selected/uploaded automatically, Winston must surface the exact remaining
human action, never silently mark the list ready anyway.

### The self-repair loop, bounded

For every automatable failure category (research gap, weak item, generic wording, duplicate,
missing/invalid tags, missing metadata, ambiguous geo match, list count mismatch, missing
official-list mirror, missing Home-visibility field), Winston repairs and reruns the specific
failing gate internally rather than asking Jerry to re-run the whole pipeline —
`metroLaunchCertification.ts`'s `runWithBoundedRetries()` bounds this at
`DEFAULT_MAX_REPAIR_ATTEMPTS` (3) so it can never loop forever. Once the retry budget is exhausted
without a PASS, that is reported as a genuine `BLOCKED` reason, never silently treated as success.

### Dynamic production state, never a hardcoded historical fact

Never hardcode a fact like "San Diego should currently have 143 items" into a certification
check — real production state legitimately changes, and a hardcoded number causes false failures
(this happened multiple times during San Diego). Query expected state dynamically, or pass an
explicitly frozen launch snapshot into the certification stage with a stated justification —
`assertExplicitProductionStateSource()` enforces that a frozen snapshot is always a deliberate,
justified choice, never an implicit stale assumption.

### The write boundary is unchanged — do not expand DB privileges to make Winston "more autonomous"

Where Winston is not authorized to write `public.*` directly, the answer is still one clean,
self-certifying, production-safe SQL patch that tells Jerry exactly what to run — never dozens of
tiny patches where one atomic patch can safely do the whole stage, and never a request to expand
standing DB privileges just to remove that human step.

### Required METRO_LAUNCH_CERTIFICATION gate categories

`certifyMetroLaunch()` requires every one of these gate keys to be present AND passing —
a gate that's simply missing (never run) blocks the same as an explicit FAIL:

| Category | Gate keys |
|---|---|
| Catalog | `CATALOG_GATE`, `LOCATION_GATE` |
| Editorial | `ITEM_CERTIFICATION_GATE`, `PRESENTATION_GATE`, `EDITORIAL_GATE`, `DISTINCTIVE_EXPERIENCE_GATE`, `VENUE_QUOTING_GATE`, `OPENING_DISTRIBUTION_GATE` |
| Tags | `TAG_CERTIFICATION_GATE` |
| Metadata | `METADATA_COMPLETENESS_GATE` |
| Geo | `GEO_ENRICHMENT_GATE` |
| Lists | `HOME_LIST_CERTIFICATION_GATE` |

Final output is either `READY_TO_ACTIVATE` with a concise summary (catalog count, geo
coverage/exceptions, tags complete, metadata complete, official/themed list counts, images
complete, runtime Home-query PASS), or `BLOCKED` with only the true human-decision blockers listed
by name — never a vague "needs more work."

## Part 7 — ITEM_CERTIFICATION_LOOP: per-item certification, not batch-only editorial gates (required, recorded 2026-09-07)

San Diego proved batch-level editorial gates are **necessary but not sufficient**. Even after
7-8 editorial passes and a batch `EDITORIAL_GATE` PASS, Jerry manually rewrote another ~15-20
San Diego items because individual rows were still generic, obvious, or didn't capture the
actual memorable thing at that specific venue. A catalog can pass every batch-wide check
(duplicates, opener repetition, geography, category distribution, tags, metadata, unsupported
language) while still containing individually mediocre items — batch statistics can't see a
single row's quality.

**The permanent fix: Winston never generates the final 100-200 item catalog by asking one model
call to rewrite a large batch.** For every candidate that survives qualification, Winston runs a
bounded `ITEM_CERTIFICATION_LOOP` (`agent-service/playbooks/itemCertificationLoop.ts`,
`runItemCertificationLoop()`) — one venue, one research/editorial/critique problem, worked
end-to-end before moving to the next candidate:

1. Identify the exact venue.
2. Read accumulated research evidence for that venue.
3. Ask: what is the actual distinctive thing a visitor should do there?
4. If evidence is insufficient, perform targeted research for that ONE venue/item
   (`performTargetedResearch` — never a shared, generic research pass across many venues at once).
5. Select the strongest specific hook (`selectHook` — explicitly allowed to report
   `hookFound: false` and reject the venue outright rather than force a weak hook to hit a
   coverage quota).
6. Verify that exact hook is still current (`verifyHookCurrent`) before writing anything.
7. Write the CheckOff item with OpenAI, one item at a time (`writeItem` — the
   `SPECIALIST_EXCLUSIVE_PROVIDER.checkoff_editor = 'openai'` lock in `remoteAiExecutor.ts`
   still applies here exactly as it does for any other CheckOff editorial call).
8. Critique that individual item independently (`critiqueItem` — a separate call/prompt from
   `writeItem`, never the same call self-grading its own output).
9. If the critique says it's generic, venue-level, unsupported, awkward, or replaceable with
   another same-category venue, research and rewrite it — not a superficial reword of the same
   weak hook.
10. Repeat within a bounded retry limit (`DEFAULT_MAX_ITEM_CERTIFICATION_ATTEMPTS = 3`,
    overridable) — never an unbounded loop.
11. Only then mark the item `ITEM_CERTIFIED`. Exhausting the retry budget without passing
    reports `EXHAUSTED_RETRIES`, a genuine per-item blocker, never silently treated as success.

### The 9 certification questions

Every final item must answer YES to all nine (`evaluateItemCritique()` combines them — any single
NO fails certification, no partial credit):

1. A concrete thing to do/order/find/see/ride/photograph/attend/experience exists.
2. That thing is more specific than the venue's general purpose.
3. The distinctive detail is research-supported.
4. It is current.
5. Swapping the venue name with 10 competitors would make the sentence nonsensical or clearly
   wrong — computed deterministically via `checkDistinctiveExperience()` from
   `editorialDistinctiveness.ts` (reused, never reimplemented), never left to the AI critique
   step to self-report.
6. The sentence tells a visitor something useful they likely wouldn't know from the category
   alone.
7. It sounds like CheckOff, not tourism-board or Google-Maps copy.
8. The destination venue/place is correctly single-quoted — computed deterministically via
   `checkVenueQuoted()` (also reused from `editorialDistinctiveness.ts`).
9. The sentence is concise enough for the app.

Worked examples (from the venue-research methodology, not phrase-banning):

- FAIL: `Browse more than 200 stores at 'Fashion Valley Mall'.` — factual, but only tells the
  visitor the definition of a mall. A bare count of the venue's own generic category ("200
  stores") does not rescue it; `editorialDistinctiveness.ts`'s `QUALIFYING_DETAIL_PATTERN` was
  tightened (`GENERIC_COUNT_NOUN_EXCLUSION`) specifically so this exact sentence keeps failing.
  Correct methodology: research the mall for an actual hook (an unusual retailer, an
  architectural feature, a local-specific element, a food hall, art, a seasonal installation, a
  luxury cluster). If nothing sufficiently distinctive exists, **reject the venue** rather than
  fill a geographic/category quota.
- FAIL: `Explore exhibits at 'Museum X'.` / PASS: `See Bethany Hamilton's shark-bitten surfboard
  at 'California Surf Museum'.`
- FAIL: `Grab a drink at 'Bar X'.` / PASS: `Enter 'Raised by Wolves' through the rotating
  fireplace and order from the hidden cocktail bar.`

### Research cost is explicitly accepted, and preferred over a larger mediocre catalog

"A 120-item metro where all 120 are genuinely good is much better than a 180-item metro
containing 40 generic filler items" (Jerry, 2026-09-07). Individual OpenAI/web research calls
per candidate item are explicitly sanctioned — optimize intelligently, but never at the expense
of CheckOff item quality.

### Ordering: individual certification runs BEFORE batch-wide gates, never instead of them

`metroLaunchCertification.ts`'s `REQUIRED_GATE_CATEGORIES.Editorial` lists
`ITEM_CERTIFICATION_GATE` first, deliberately: `evaluateItemCertificationGate()`
(`itemCertificationLoop.ts`) fails the whole catalog if even one item lacks its own
`ITEM_CERTIFIED` record — a batch-wide PASS on `EDITORIAL_GATE`/`DISTINCTIVE_EXPERIENCE_GATE`/
etc. never substitutes for missing per-item certification. The existing batch-wide gates
(duplicates, opener repetition, geography, category distribution, tags, metadata, unsupported
language) still run after every item certifies individually — never instead of it.

### Preserved per-item research-evidence artifacts

Every `ItemCertificationRecord` (`itemCertificationLoop.ts`) is the durable, structured evidence
for that one item — enough for Winston to repair a single bad item later without rerunning the
entire metro: venue name, chosen hook (with its supporting fact/source and reasoning), every
rejected hook (with the reason it was rejected — currency failure or critique failure), the
currency check result, the final body, the certification outcome, and the full per-attempt
history (hook, body, critique) for every attempt made.

## Part 8 — real driver wiring: the bare command owns the whole sequence (required, recorded 2026-09-07)

Everything in Parts 6-7 previously existed only as pure-logic library functions nothing in the
actual runtime ever called — a bare `metro_launch` run stopped at the old `M6_5_CHECKOFF_EDITOR`
stage and jumped straight to `LAUNCH_READINESS_BOUNDARY` with a synthetic, hardcoded gate
evidence object. `agent-service/specialists/metroLaunchDriver.ts` (`driveMetroLaunch()`) now owns
the whole sequence itself — no separate command, no manual per-stage invocation:

`M6_5_CHECKOFF_EDITOR` (write, one item at a time) →
**`M7_ITEM_CERTIFICATION`** (the real `ITEM_CERTIFICATION_LOOP`, per candidate: independent
critique call → deterministic swap-test/quoting check via `evaluateItemCritique()` → on failure,
a real rewrite call with the rejection reasons, bounded at `MAX_ITEM_CERTIFICATION_ATTEMPTS = 3` →
`ITEM_CERTIFIED` or `EXHAUSTED_RETRIES`, never filler) →
**`M8_BATCH_CERTIFICATION`** (deterministic: `DISTINCTIVE_EXPERIENCE_GATE`/`VENUE_QUOTING_GATE`/
`OPENING_DISTRIBUTION_GATE` via `certifyEditorialDistinctiveness()`, `ITEM_CERTIFICATION_GATE`,
`TAG_CERTIFICATION_GATE` via `resolveCanonicalTagVocabulary()` live-DB-then-snapshot,
`METADATA_COMPLETENESS_GATE` via `evaluateItemMetadata()`, `GEO_ENRICHMENT_GATE`) →
**`M9_HOME_LIST_MIRROR`** (builds the real launch list package — primary seasonal + themed lists
+ curated mirror — generates the one atomic SQL patch, and certifies against real runtime state
when `MetroDriverDeps.verifyHomeListRows` is wired to a real read path) →
**`M10_METRO_LAUNCH_CERTIFICATION`** (image readiness evaluated here, alongside everything else,
never early — plus the Item-Intake-shaped `CATALOG_GATE`/`LOCATION_GATE`/`PRESENTATION_GATE`/
`EDITORIAL_GATE`, built from the same certified items — then `certifyMetroLaunch()` produces the
final `READY_TO_ACTIVATE`/`BLOCKED` report) → `LAUNCH_READINESS_BOUNDARY` (unchanged: public
launch is always a human decision, but the decision packet now carries the REAL report instead of
a synthetic placeholder).

**Image selection never stops the pipeline early.** `IMAGE_READINESS_GATE`
(`agent-service/playbooks/imageReadiness.ts`) is just one more required gate, evaluated at M10
alongside every other one. When it is the ONLY failing required gate, `certifyMetroLaunch()` sets
`imageSelectionOnlyBlock: true` and the report reads `"BLOCKED — image selection required"` with
the exact Home cards still needing one — never a generic "needs more work," and never reached by
skipping every other phase of work.

**Tags never block a build just because `agent_service` still lacks `SELECT` on `public.tags`.**
`agent-service/specialists/tagVocabularyProvider.ts`'s `resolveCanonicalTagVocabulary()` tries a
live query first, falls back to a versioned, justified `VerifiedTagSnapshot`, and only fails
closed (blocking `TAG_CERTIFICATION_GATE`, never inventing a tag list) when neither is available —
which, as of 2026-09-07, is still the honest live state (no snapshot has been captured yet).

**A real, pre-existing driver bug was fixed while wiring this in**: `stepEditor` (M6_5) used to
check only for `outcome.kind === 'BLOCKED'` when deciding whether checkoff_editor failed for a
batch — an evidence-validation failure (`kind === 'NEEDS_JERRY'`, e.g. missing a newly-required
`tags` evidence key) fell through that check entirely, was silently dropped, and because
`remaining` is recomputed from `checkoffizedItems` every call, the SAME failing candidate(s) were
reprocessed identically forever, never escalating and never advancing — a real infinite-looking
loop, caught while adding the `tags` evidence requirement for M7. Fixed: any non-`ACCEPTED` result
now stops the stage and reports the run's real status (`BLOCKED` or `NEEDS_JERRY`), while still
keeping whatever candidates DID succeed in that batch.

**Verified end-to-end**: `agent-service/specialists/viennaDryRun.test.ts` drives a synthetic,
fully-fake Vienna project through the real driver (`driveMetroLaunch()`) — never a hand-called
library function — and proves every phase above actually runs, that a deliberately generic first
draft is really rejected by critique and really rewritten (the self-repair proof), that the
Home-list SQL patch is really generated, that the run genuinely `BLOCKED — image selection
required` with every other real gate passing, and that resuming with images resolved reaches a
genuine `READY_TO_ACTIVATE` while the human launch-approval boundary stays exactly where it was.

**Known remaining gap**: `GEO_ENRICHMENT_GATE` legitimately fails until a real Google Places
integration (`metroGeoEnrichment.ts`, referenced but not yet built) exists — `MetroDriverDeps.hasRunGooglePlacesPass`
defaults to `false` and is never faked true. This, plus `HOME_LIST_CERTIFICATION_GATE` needing a
real `verifyHomeListRows` read path and image selection needing a human, are the genuine reasons a
real bare Vienna command would still stop for Jerry during (not just at the end of) a build.

## Part 9 — real geo enrichment and real Home-list DB reads (required, recorded 2026-09-07)

Pre-Vienna closure: the two remaining technical blockers (GEO_ENRICHMENT_GATE always failing because
no real Places integration existed, and HOME_LIST_CERTIFICATION_GATE only ever certifying against
synthetic/in-memory rows) are now closed.

### Real, cached Google Places enrichment

`agent-service/playbooks/metroGeoEnrichment.ts` (pure — no I/O) extracts and generalizes the exact
match-classification logic already proven in `scripts/generate-san-diego-places-dry-run.ts`
(name-similarity via Levenshtein + substring boost, structural risk flags, country-match check) into
six permanent tiers: `EXACT`, `HIGH_CONFIDENCE_PARENT_VENUE`, `AMBIGUOUS_NEEDS_REVIEW`,
`REJECTED_WRONG_MATCH`, `NO_CANONICAL_VENUE` (events/routes/districts/multi-operator — an explicit,
intentional exception, never a failure and never forced into a confident tier), and `UNRESOLVED`.
`evaluateGeoEnrichmentCertificationGate()` PASSes only when every item is `EXACT`/
`HIGH_CONFIDENCE_PARENT_VENUE`/`NO_CANONICAL_VENUE` — this replaces the old placeholder
`hasRunGooglePlacesPass` boolean flag as the real `GEO_ENRICHMENT_GATE`.

`agent-service/specialists/metroGeoEnrichmentDriver.ts` (I/O) owns the real Places Text Search call
(`buildRealPlacesLookup()`, gated on `GOOGLE_PLACES_API_KEY`) and a metro-scoped cache
(`InMemoryGeoEnrichmentCacheStore` for tests, `FileGeoEnrichmentCacheStore` — durable JSON under
`scripts/output/geo-enrichment-cache/`, the same artifact-caching convention already used throughout
this repo — for real runs) so a paid lookup for a given venue happens AT MOST ONCE per metro, ever,
across every later re-certification or resumed run. `enrichMetroCatalogGeo()` is wired into
`M8_BATCH_CERTIFICATION` in the real driver; `state.geoEnrichmentPaidCalls`/`geoEnrichmentCacheHits`
track cost per metro. `viennaDryRun.test.ts`'s third test proves a driver re-entry through M8 makes
ZERO additional paid calls.

### Real Home-list DB read path

`agent-service/specialists/homeListReadPath.ts` queries the actual `public.lists`/`public.list_items`
(joined through `public.metro_areas` and `public.items`) and `public.curated_lists`/
`public.curated_list_items` structures — never a synthetic stand-in — and is now the DEFAULT
`MetroDriverDeps.verifyHomeListRows` implementation (a caller may still inject its own, e.g. in
tests). As of 2026-09-07, `agent_service` has no `SELECT` grant on `public.lists`/`public.list_items`
either (confirmed live: `permission denied for table lists`/`list_items`) — the read path is real and
ready, and reports that exact, actionable gap in `HOME_LIST_CERTIFICATION_GATE`'s reason the moment
it's hit, rather than silently returning an empty or fake-passing result.

### Tag snapshot — still an open production input, not a methodology gap

`agent-service/specialists/tagVocabularyProvider.ts`'s live-then-snapshot fallback is fully
implemented (Phase 2W), but no `VerifiedTagSnapshot` has actually been captured into this repo — a
full search turned up only `docs/metro-launch-audit/17_pull_tag_vocabulary_for_smart_tagging.sql`
(a query to RUN, whose output was never pasted back) and no file anywhere containing the real
production tag list. This is not something Winston can close on its own without either (a) a live
`SELECT` grant on `public.tags`, or (b) Jerry supplying the actual captured tag export — inventing a
plausible-looking list here would violate the explicit "never invent a tag" rule this whole module
exists to enforce.

## Provenance

Built and verified against the Denver/Boulder/Longmont launch cycle, 2026-08-21 —
`docs/metro-launch-audit/` in this repo holds the full audit trail (10+ files), the generation
pass, two follow-up fix passes, the production apply (commit `929bfb6302bbb65bcdfc0e3149cedebea94f4363`),
and the Nederland/Eldora incremental addition. This document is the distilled, reusable process —
that folder is the historical record of the run that proved it.
