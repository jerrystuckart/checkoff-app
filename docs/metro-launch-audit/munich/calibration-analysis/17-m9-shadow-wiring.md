# M9 SHADOW Wiring — Session 1 complete

Continues from [16-m9-wiring-handoff.md](16-m9-wiring-handoff.md) (commits
`fbf7a19`/`e0f7b40`). This session's scope: adapter construction and
LEGACY/SHADOW live-driver wiring only. No ENFORCED behavior, no
approval/HOLD transitions, no safe SQL replacement, no change to the
default authoritative plan.

## What landed

1. **`agent-service/specialists/m9ListCurationAdapter.ts`** (new, standalone —
   never imports from `metroLaunchDriver.ts`) — `runM9ShadowCuration`:
   - Runs PASS A (`listConceptDiscovery.discoverListConcepts`) against the
     real certified catalog, excluding the legacy plan's `CURATED_MIRROR`
     entry from the overlap check (it mirrors the whole catalog by design,
     so comparing overlap against it would REQUIRES_JERRY every concept for
     a reason with no editorial signal).
   - Runs PASS B (`listFitScoring.evaluateItemForListMembership`) for every
     CREATE-verdict concept, evaluated generically as list kind `THEMED`
     (the driver does not yet persist any of the per-kind evidence —
     discoveryBasis/nighttimeSpecific/concreteLocalFlavorAction/travelEffort
     — PASS B needs for a more specific kind; that's later, ENFORCED-track
     work).
   - Builds a `M9ShadowComparisonArtifact`: full PASS A/B output, concept
     differences (does a discovered concept correspond to any existing
     legacy list?), membership differences (for concepts that do), HOLD/
     REQUIRES_JERRY findings, and `validationFailures`.
   - **No-throw contract**: every internal call is wrapped so a PASS A/B
     exception is captured as a `validationFailures` entry, never thrown
     past this function's boundary.

2. **`metroLaunchDriver.ts` wiring**:
   - `MetroDriverDeps.m9CurationMode?: 'LEGACY' | 'SHADOW'` (default
     `'LEGACY'`) — TypeScript itself is the enforcement that `'ENFORCED'`
     can't be passed; there's no separate runtime fail-closed branch.
   - `MetroDriverState.m9ShadowCuration?: M9ShadowComparisonArtifact` —
     populated only in SHADOW, overwritten fresh each M9 pass, never
     accumulated.
   - The call sits inside `stepM9HomeListMirror`, after the legacy `plan`
     is already built AND after the same fail-closed missing-metadata check
     the legacy SQL path uses (reuses the exact same validated `newItems`
     pool), but before `buildHomeListSqlPatch` — so a SHADOW failure can
     never be confused with a real legacy SQL failure, and SHADOW only ever
     evaluates a catalog the legacy path has itself already accepted.
   - Wrapped in the driver's own try/catch as defense in depth on top of
     the adapter's no-throw contract.
   - `state.homeListPlan`/`state.homeListSqlPatch` and the unconditional
     M9→M10 fall-through are completely untouched in both modes.

3. **Tests**:
   - All 8 pre-existing M9 characterization tests
     (`metroLaunchDriverM9Characterization.test.ts`) pass unchanged — proof
     LEGACY behavior is byte-for-byte identical to before this session.
   - New `metroLaunchDriverM9ShadowWiring.test.ts` proves, end-to-end
     through the real `driveMetroLaunch` entry point (no adapter mocking):
     - SHADOW mode against a real 40-item catalog (15 sharing a
       `canal-crawl` tag not in any `THEMED_LIST_DEFINITIONS` entry)
       discovers that concept as a genuine CREATE verdict with a real PASS B
       decision for every member, and reports it has no THEMED-kind legacy
       analogue.
     - LEGACY mode never populates `state.m9ShadowCuration` at all.
     - `state.homeListPlan`/`state.homeListSqlPatch` are `deepEqual`/
       `equal` between a LEGACY run and a SHADOW run given identical
       inputs — the required LEGACY/SHADOW authoritative-artifact
       equivalence regression assertion.
     - Run `status`/`currentStage` are identical between modes (SHADOW
       introduces no new HOLD/NEEDS_JERRY outcome).
     - Omitting `m9CurationMode` is byte-for-byte identical to explicitly
       passing `'LEGACY'`.

## Verification

- `npx tsc --noEmit -p agent-service/tsconfig.json` — clean.
- `npm run agent:test` — 1778 tests, 1735 pass, 40 skipped, **3 pre-existing
  failures** in `auditLive.test.ts` (real live-DB "live acceptance" checks,
  byte-for-byte identical file to base commit `fbf7a19` — confirmed
  unrelated to this session's changes).
- Zero production writes: every test in this session runs against
  `InMemoryPlaybookRunStore`/`InMemoryExecutionStore`/`TestExecutor`, same
  as the Part 1-2 characterization tests.

## Commits (this session)

1. `62925e3` — Add M9 two-pass list-curation adapter (SHADOW-only, Session 1)
2. `86cf8c1` — Wire M9 SHADOW mode into the live metroLaunchDriver.ts M9 step
3. (this commit) — End-to-end shadow invocation tests + documentation

## What's still not done (future session)

Everything the handoff doc's "Behaviors expected to change once wiring
lands" section named: `buildHomeListPlan`'s fixed-menu selection is still
the only thing that ever reaches `state.homeListPlan`; `scoreItemsForLists`
is still reporting-only; there is still no real HOLD/NEEDS_JERRY exit tied
to the new system's findings; `operatorReviewBoundaries.ts`/
`holdRecovery.ts` are still unwired; ENFORCED mode does not exist.
