# M9 ENFORCED Wiring — Session 2 complete

Continues from [16-m9-wiring-handoff.md](16-m9-wiring-handoff.md) (Session 1
scope/trace) and [17-m9-shadow-wiring.md](17-m9-shadow-wiring.md) (Session 1
SHADOW wiring, commits `62925e3`..`8515826`). This session adds ENFORCED
mode. **Session 3's job, explicitly not started here: replace SQL
generation with a safe path fed by the ENFORCED artifact.**

## What landed (commits, in order)

1. `2a60123` — **m9EnforcedTypes.ts** (Phase 1): the discriminated
   `M9EnforcedResult` contract (READY/NEEDS_JERRY/HOLD/INVALID/ERROR),
   `M9RequiredDecision`, `M9OperatorDecisionInput`/`Record`, deterministic
   `computeM9ConceptId`/`computeM9ConceptFingerprint`/`computeM9CatalogFingerprint`
   (sha256-based, never derived from list-title text), and
   `M9EnforcedCurationArtifact`.
2. `937380c` — **runM9EnforcedCuration** (Phase 2, in
   `m9ListCurationAdapter.ts`): PASS A + speculative PASS B + duplicate
   detection per concept; malformed input → INVALID before either pass
   runs; a thrown exception → ERROR, never propagated; REJECT concepts
   auto-excluded; operator decision inputs with empty `decisionText`/
   `decidedBy` are refused outright; a stored decision only applies when
   its fingerprint still matches the concept's current membership.
3. `8e1d6f4` — **driver wiring** (Phase 3): `deps.m9CurationMode` extended
   to include `'ENFORCED'` (default still `'LEGACY'`);
   `state.m9EnforcedCuration`/`m9OperatorDecisions`/
   `m9RejectedOperatorDecisionInputs`; `stepM9HomeListMirror`'s new ENFORCED
   branch (never writes `state.homeListPlan`, returns before
   `buildHomeListSqlPatch`); re-entry guard for a run parked at
   `M9_HOME_LIST_MIRROR` under ENFORCED.
4. `dadd334` — **operator boundary wiring** (Phase 4):
   `M9RequiredDecision.tiesIntoExistingMechanism`, always sourced from
   `evaluateOperatorReviewBoundary()` (`operatorReviewBoundaries.ts`), never
   hand-written.
5. `988e729` — **holdRecovery.ts wiring** (Phase 5): evidence-mandatory
   resolutions route through `reopenHoldCandidate`/
   `verifyReopenStageCompleteness` (asserting reentry never lands earlier
   than M9 and never skips a stage); `verifyHoldNotBypassed` runs as an
   anti-bypass self-check on every still-outstanding concept across reruns.
6. (this commit) — end-to-end tests
   (`metroLaunchDriverM9Enforced.test.ts`) + this doc.

## Exact ENFORCED call path

`driveMetroLaunch` → `stepM9HomeListMirror` (after the shared, mode-
independent gates: second `OUT_OF_MARKET_CONTAMINATION_GATE` pass,
`canonicalNeighborhoods` presence, `newItems`/missing-metadata check) →
if `curationMode === 'ENFORCED'`: build `M9AdapterCertifiedItem[]` from the
same validated `newItems` pool LEGACY/SHADOW use → `runM9EnforcedCuration`
(`m9ListCurationAdapter.ts`) → persist `state.m9EnforcedCuration` +
merge `acceptedDecisions` into `state.m9OperatorDecisions` → map
`artifact.result.kind` to a run status → **return** (never reaches the
`buildHomeListSqlPatch` call below it).

## Exact blocking behavior

| `M9EnforcedResult.kind` | `run.status` | `run.currentStage` |
|---|---|---|
| `READY` | `WAITING` | `M9_HOME_LIST_MIRROR` (unchanged) |
| `NEEDS_JERRY` / `HOLD` | `NEEDS_JERRY` (via `escalate()`) | `M9_HOME_LIST_MIRROR` |
| `INVALID` / `ERROR` | `BLOCKED` (via `block()`) | `M9_HOME_LIST_MIRROR` |

NEEDS_JERRY and HOLD share one run-level status (existing vocabulary,
never a new one) — they're distinguished inside the persisted
`decisionPacket`/`state.m9EnforcedCuration.result` via
`approvalSufficient`/`evidenceMandatory`/`requiredDecisions[].approvalSufficiency`,
never by a different status value.

## How the M9→M10 fall-through is prevented

Structural, not conditional: the ENFORCED branch in `stepM9HomeListMirror`
**returns** in every one of its four outcomes (`WAITING` / `escalate()` /
`block()`), and that `return` statement sits textually *before*
`buildHomeListSqlPatch` is called and before the
`run.currentStage = 'M10_METRO_LAUNCH_CERTIFICATION'` line that follows it.
There is no code path from the ENFORCED branch that reaches that line.
LEGACY and SHADOW are completely unaffected — their own code is untouched
below the ENFORCED `if` block.

## Where an approved plan parks while awaiting safe SQL

`run.status = 'WAITING'`, `run.currentStage` stays
`'M9_HOME_LIST_MIRROR'`. `WAITING` is not a new status — it already exists
in `PlaybookRunStatus` (`playbookRun.ts`) and is already used by
`destinationRelationshipDriver.ts`/`destinationHubDriver.ts` for "cannot
proceed until something outside this run's control changes." Chosen over
`BLOCKED` (implies a bug/data problem — wrong here, the plan is genuinely
valid) and `NEEDS_JERRY` (implies an operator decision is missing — also
wrong, nothing is missing). `jerryReason`/`decisionPacket` are left `null`
(per `playbookRun.ts`'s own doc: reserved for `NEEDS_JERRY`); the
informative content lives in `state.m9EnforcedCuration` instead. No new
status was invented.

## How approvals are persisted and invalidated

`state.m9OperatorDecisions: Record<conceptId, M9OperatorDecisionRecord>`,
accumulated across the whole run, never reset. Each record carries
`decidedForFingerprint` — the concept's `computeM9ConceptFingerprint` at
decision time. On every ENFORCED pass, a stored decision is applied ONLY
when its `decidedForFingerprint` still equals the concept's freshly-
recomputed fingerprint; a catalog change that alters a concept's member
set changes the fingerprint and silently un-applies the stale decision
(the concept becomes outstanding again, `finalApprovedMemberships` loses
that entry) — proven in
`metroLaunchDriverM9Enforced.test.ts`'s stale-fingerprint test. A bare
force-approval (`decisionText: ''`) is rejected at input validation and
never becomes a stored record at all.

## HOLD and reopen behavior

- HOLD preserves all concept/membership evidence: `conceptVerdicts` (with
  `memberDecisions`, `duplicateFindings`, `overlapFindings`) is rebuilt
  fresh every pass from the real catalog — nothing is discarded between
  calls.
- NEEDS_JERRY/HOLD `decisionPacket` carries the exact
  `M9RequiredDecision[]` — real structured records, not booleans.
- Reopening (submitting a new `M9OperatorDecisionInput`) resumes at
  `M9_HOME_LIST_MIRROR` — the only stage any HOLD reason this session
  produces can resolve at (`holdRecovery.ts`'s own
  `HOLD_REENTRY_STAGE` table maps both `LIST_CONCEPT_WEAK_STRONG_FIT_RATIO`
  and `LIST_MEMBERSHIP_MISSING_KIND_SPECIFIC_EVIDENCE` there). No earlier
  stage (M0-M8.75) ever reruns — `driveMetroLaunch`'s new
  `reopenM9Enforced` re-entry guard only fires when `currentStage ===
  'M9_HOME_LIST_MIRROR'`.
- `reopenHoldCandidate`/`verifyReopenStageCompleteness` are called for
  real on every evidence-mandatory resolution; a violation of either
  invariant becomes `ERROR`, never a silent pass.
- `verifyHoldNotBypassed` runs on every still-outstanding concept across
  reruns with no fresh decision — a mismatch (rerun with nothing new
  silently changing the verdict) becomes `ERROR`.
- Rejected candidates cannot silently reenter: a `REJECTED` decision stays
  applied across reruns via the same fingerprint mechanism (proven in the
  rejected-concept test's third call).
- A bare force approval cannot clear an unresolved Vereinsheim/Kunst Oase-
  pattern duplicate: proven end-to-end in
  `metroLaunchDriverM9Enforced.test.ts` with two certified candidates
  sharing one `venueName` — `detectPortfolioRepetition` flags it,
  `approvalSufficiency` escalates to `EVIDENCE_REQUIRED`, an empty-text
  approval is refused, and only a real decision resolves it.

## Confirmation that LEGACY and SHADOW remain unchanged

Every one of Session 1's 8 characterization tests and 2 SHADOW-wiring
tests passes unmodified. `state.homeListPlan` is written for LEGACY/SHADOW
exactly as before (the only change is an `if (curationMode !== 'ENFORCED')`
guard around that one assignment). A dedicated sanity test in this
session's own file re-confirms both still reach
`LAUNCH_READINESS_BOUNDARY`/M10 in one drive call.

## Test arithmetic

`npm run agent:test`: **1786 total = 1743 passed + 3 failed + 40 skipped +
0 todo.** All 3 failures are pre-existing, unrelated `auditLive.test.ts`
"live acceptance" checks against real DB state — that file is byte-for-
byte identical to the Session-1-start commit (`fbf7a19`), confirmed via
diff. Every metroLaunchDriver/holdRecovery/listConceptDiscovery/
listFitScoring/operatorReviewBoundaries test passes, including all 8 new
ENFORCED end-to-end tests.

`npx tsc --noEmit -p agent-service/tsconfig.json`: clean, zero errors.

## Zero-production-write confirmation

Every test in this session runs against `InMemoryPlaybookRunStore`/
`InMemoryExecutionStore`/`TestExecutor`. `runM9EnforcedCuration` and
`m9EnforcedTypes.ts` perform no I/O at all (pure functions + one
`node:crypto` hash call). No Munich/production item or list data was
read, written, or referenced by name in any executable code path — the
Vereinsheim/Kunst Oase test data is fixture-only, matching the real
pattern already documented in `holdRecovery.test.ts`/
`munichGoldStandard.ts`, never a Munich-specific branch in
`m9ListCurationAdapter.ts` or `metroLaunchDriver.ts`.

## Consciously deferred / not implemented this session

- **SQL generation from the ENFORCED plan** — explicitly out of scope
  (Session 3). `state.m9EnforcedCuration.finalApprovedMemberships` is the
  handoff artifact Session 3 should consume; it never touches
  `buildHomeListSqlPatch`/`listSqlGeneration.ts` today.
- **REMOVE_OR_REPLACE_COMPLETED_LIST / REOPEN_COMPLETED_METRO** — would
  need a completed/active status on a legacy list (not present in
  `HomeListPlanEntry` or `M9AdapterLegacyListSummary` today); not
  fabricated this session.
- **MARKET_BOUNDARY_EXCEPTION** — deliberately not re-derived at M9;
  already gated earlier by M8's `ITEM_GEO_METRO_CONSISTENCY_GATE`, and
  re-checking it here would duplicate that gate rather than reuse it.
- **UNSUPPORTED_SECRET_DESIGNATION** — every concept is evaluated
  generically as list kind `'THEMED'` this session (no per-kind evidence
  — `discoveryBasis`/`nighttimeSpecific`/etc — is persisted anywhere in
  `MetroDriverState` yet), so a `HIDDEN_GEMS`-specific secret-basis check
  has no real trigger condition to attach to without inventing one.
- Per-list-kind membership evidence (Hidden Gems/After Dark/Food & Local
  Flavor/Day Trip) — same reason as above; every concept this session
  produces is `'THEMED'`.

## What Session 3 needs before it can safely begin

1. A safe SQL-generation path that consumes
   `state.m9EnforcedCuration.finalApprovedMemberships` (candidate names,
   not yet real `item_id`/`list_id` values) — `listSqlGeneration.ts`
   already exists, tested in isolation, zero call sites; Session 3's real
   work is wiring it the same way this session wired
   `listConceptDiscovery.ts`/`listFitScoring.ts`.
2. A decision on what happens to `finalApprovedMemberships` entries whose
   concept is `READY` but references items also present in
   `existingInventoryReconciliation.reused` (this session never
   cross-checked that — LEGACY's own `buildHomeListSqlPatch` already
   handles reused-item linking; Session 3 must decide whether ENFORCED's
   SQL path reuses that same logic or needs its own).
3. Real per-list-kind evidence plumbing if Hidden Gems/After Dark/Food &
   Local Flavor/Day Trip curation (not just generic THEMED) is in scope —
   currently no per-item `discoveryBasis`/`nighttimeSpecific`/
   `concreteLocalFlavorAction`/`travelEffort` exists anywhere in
   `MetroDriverState`.
4. A real decision on `REMOVE_OR_REPLACE_COMPLETED_LIST`/
   `REOPEN_COMPLETED_METRO` plumbing if ENFORCED is ever expected to touch
   an existing completed production list rather than only propose new ones.

Nothing above blocks Session 3 from *starting* — it blocks specific pieces
of scope Session 3 may or may not need, each named explicitly rather than
silently assumed.
