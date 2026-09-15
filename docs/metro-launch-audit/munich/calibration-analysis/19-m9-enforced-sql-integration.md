# M9 ENFORCED — Safe SQL Integration, M10 Consumption, Default-Mode Decision (Session 3)

Continues [16](16-m9-wiring-handoff.md)→[18](18-m9-enforced-wiring.md). Session
2 delivered ENFORCED curation that parks a READY plan at
`M9_HOME_LIST_MIRROR`/`WAITING`, with no SQL path. This session (1) hardens
concept identity and evidence resolution, (2) closes the per-list-kind
evidence gap, (3) wires reused-item and completed-list validation, (4)
connects the approved plan to the existing safe SQL module, (5) makes M10
consume verified ENFORCED artifacts, and (6) decides whether ENFORCED can
become the default. **It cannot yet — see the Default-Mode Decision below.**

## Commits (7, in order)

1. `9908c7c` — Concept identity hardening (Prerequisite 1)
2. `c683960` — Structured evidence-resolution hardening (Prerequisite 2)
3. `2612fa6` — Per-list-kind evidence + reused-item cross-check (Phases 2 & 3)
4. `dda2ae0` — Completed-list replace/reopen resolution (Phase 4)
5. `60d1258` — Safe UUID-keyed SQL integration (Phase 5)
6. `f0d0882` — M10 artifact verification (Phase 6)
7. (this commit) — End-to-end tests, default-mode decision, documentation (Phases 1 & 7-8)

## PHASE 1 — Session 3 inputs/outputs trace

- **READY artifact from `runM9EnforcedCuration`**: `M9EnforcedCurationArtifact`
  (`m9EnforcedTypes.ts`) — `result.kind === 'READY'`,
  `finalApprovedMemberships: Record<conceptId, candidateName[]>`,
  `conceptVerdicts[]` (each with `conceptId`/`fingerprint`/`listKind`/
  `proposedTitle`/`memberDecisions`). This is the ONLY input Phase 5/6 read.
- **Final approved concept representation**: one `M9EnforcedConceptVerdict`
  per concept, `approvalState: 'APPROVED'`, keyed by the Prerequisite-1
  durable `conceptId` (metro+listKind+seedTags), not title text.
- **Final approved membership representation**:
  `finalApprovedMemberships[conceptId]: string[]` — certified `candidateName`
  values (not yet real UUIDs; `m9ReusedItemValidation.ts` resolves those).
- **Safe SQL generator inputs** (existing, `listSqlGeneration.ts`):
  `ListSqlGenerationInput { metroSlug, listTitle, resolutions: ListSqlItemResolution[] }`
  — `m9SafeSqlIntegration.ts`'s `buildM9SafeSqlPlan` is what builds this
  input from the artifact + caller-supplied real resolutions.
- **M10 inputs**: `state.homeListPlan` (`HomeListPlanEntry[]`),
  `state.batchCertificationGates`, `state.itemCertifications`, etc. —
  unchanged shape; ENFORCED now populates `state.homeListPlan` via
  `buildM9CompatibilityPlan`, structurally identical to what LEGACY writes.
- **Where `state.homeListPlan`/`state.homeListSqlPatch` are consumed**:
  `stepM10FinalCertification` (image readiness, `officialListsCount`/
  `themedListsCount` reporting, `finalReadyToApplyAudit`), and
  `readRealHomeListRows`/`evaluateHomeListCertificationGate` in the LEGACY/
  SHADOW-shared preamble of `stepM9HomeListMirror` (never reached by
  ENFORCED — see Phase 5's own scope boundary below).
- **LEGACY/SHADOW compatibility**: both are byte-for-byte unchanged —
  `state.homeListPlan`/`homeListSqlPatch` are still written by
  `buildHomeListPlan`/`buildHomeListSqlPatch` exactly as before; ENFORCED's
  own write path is a completely separate code branch that never calls
  either function.

**No second executable source of truth**: `state.homeListPlan` for an
ENFORCED run is ALWAYS `buildM9CompatibilityPlan(artifact, safeSqlPlan)` —
a pure, deterministic projection computed fresh every time from the
artifact, never hand-maintained or independently derived.

## Concept ID and fingerprint rules (Prerequisite 1)

- `conceptId = hash(metroSlug, listKind, normalized(seedTags))` — durable
  identity. Never derived from display title. Different metros, different
  list kinds, or different seed-tag sets always produce different ids.
- `conceptFingerprint = hash(conceptId, per-member {candidateName, dbCategory,
  finalTags, neighborhoodName}, editorialPromise, discoveryConfigFingerprint)`
  — content. Changes on membership change, per-item metadata change,
  editorial-promise change, or discovery-config change; conceptId stays put.
- A stored operator decision only applies when its `decidedForFingerprint`
  still equals the concept's current fingerprint — otherwise the decision
  is stale and the concept is outstanding again.
- Tests: `m9EnforcedTypes.test.ts` (9), collision/stability properties per
  the task's own list.

## Structured resolution rules (Prerequisite 2)

`M9OperatorResolutionAction`: `APPROVE | REJECT | SUPPLY_EVIDENCE |
REQUEST_RESEARCH | ACCEPT_EXCEPTION | REPLACE_CONCEPT | REOPEN`.

- `APPROVE` never resolves `EVIDENCE_REQUIRED`/`RESEARCH_REQUIRED`.
- `SUPPLY_EVIDENCE` requires a complete `M9StructuredEvidence` whose
  `issueResolved` equals the concept's real outstanding `reasonCode` —
  unrelated (even real) evidence is refused.
- `ACCEPT_EXCEPTION` is refused for every `reasonCode` this codebase
  produces today (`M9_EXCEPTION_ELIGIBLE_REASON_CODES` is empty, by
  deliberate policy).
- `REJECT` always resolves by exclusion, any `approvalSufficiency`.
- `REQUEST_RESEARCH` never itself resolves anything.
- Every decision requires non-empty `decisionText` and a real `decidedBy`.
- Tests: `m9ListCurationAdapterEvidenceResolution.test.ts` (9, direct unit),
  plus the Vereinsheim/Kunst Oase duplicate scenario end-to-end in
  `metroLaunchDriverM9Enforced.test.ts` (empty force-approval, nonempty-
  but-vague APPROVE, unrelated evidence, on-issue structured evidence,
  explicit REJECT — all refused/accepted exactly per the rules above).

## Exact safe SQL path

`stepM9HomeListMirror` (ENFORCED, `result.kind === 'READY'`) →
`deps.resolveM9ProductionItems`/`resolveM9ProductionLists` (real, caller-
supplied; **default to resolving nothing** — no real, verified Supabase
query has been written this session) → `buildM9SafeSqlPlan`
(`m9SafeSqlIntegration.ts`) →
  - `validateM9ReusedItems` (`m9ReusedItemValidation.ts`): NOT_FOUND /
    AMBIGUOUS / INACTIVE / OUT_OF_METRO / UNRESOLVED_DUPLICATE, whole-plan
    fail-closed.
  - `resolveM9CompletedListHandling` (`m9CompletedListResolution.ts`):
    CREATE_NEW / REUSE_EXISTING_ACTIVE / REUSE_EXISTING_REOPENED /
    BLOCKED_NEEDS_REOPEN.
  - `generateListMembershipSql`/`resolveListItemsPreflight`
    (`listSqlGeneration.ts`, **unchanged, Munich calibration Phase 4** —
    no second SQL generator was written) for every concept resolved to an
    ALREADY-EXISTING list.
→ if `ok`: `state.homeListPlan` (`buildM9CompatibilityPlan`) +
`state.homeListSqlPatch` (`safeSqlPlan.combinedSql`) +
`state.m9SqlValidationManifest` all written together, `run.currentStage =
'M10_METRO_LAUNCH_CERTIFICATION'` in the same drive call. If not: stays
`WAITING` at `M9_HOME_LIST_MIRROR`, `state.m9SafeSqlPlan` records exactly why.

**Scope boundary, load-bearing for the default-mode decision below**:
`listSqlGeneration.ts` only ever LINKS membership into a list that already
exists in production. A concept needing a genuinely new list is
`BLOCKED_NEW_LIST_NEEDED` — never routed through the unsafe legacy
`buildHomeListSqlPatch`/`NewItemSqlInput` path that creates lists/items.

## Exact M10 artifact verification

`stepM10FinalCertification`, gated on `state.m9SqlValidationManifest`'s
mere presence (the only signal distinguishing an ENFORCED-derived
`homeListPlan` from a LEGACY/SHADOW one):
1. `state.m9EnforcedCuration` still exists.
2. Its `inputCatalogFingerprint` still equals the manifest's recorded value.
3. Every concept's CURRENT `fingerprint` still equals what SQL was
   generated from (`manifest.conceptFingerprintsUsed`).
4. `state.homeListSqlPatch` is present.

Any mismatch → `BLOCKED` before M10 touches anything else. Proven by
hand-tampering `state.m9EnforcedCuration` after real SQL generation in
`metroLaunchDriverM9EnforcedSql.test.ts`'s third test.

## Completed-list compatibility behavior

`resolveM9CompletedListHandling` mirrors `listFitScoring.ts`'s own
per-item COMPLETED-list guardrail at the whole-list level: ACTIVE lists
reuse their UUID with no extra gate; COMPLETED lists require an explicit
`REOPEN`/`REPLACE_CONCEPT` resolution (a plain, even substantive,
`APPROVE` never satisfies it); a genuinely new concept gets `CREATE_NEW`
(no UUID, ever) and is never routed through the safe SQL path (see the
scope boundary above). Proven live through `driveMetroLaunch` in
`metroLaunchDriverM9EnforcedEndToEnd.test.ts`'s first test: COMPLETED +
approve-only stays blocked; COMPLETED + REOPEN generates real SQL.

## Exact full driver call path (Phase 7 proof)

`driveMetroLaunch` → `stepM9HomeListMirror` → `runM9EnforcedCuration` →
(if outstanding) `escalate()`/`block()`, parked at `M9_HOME_LIST_MIRROR` →
operator submits `deps.m9OperatorDecisionInputs` on a later call → re-entry
guard (`reopenM9Enforced`) resumes → re-evaluated, resolved → `READY` →
`buildM9SafeSqlPlan` → `GENERATED` → `state.homeListPlan`/
`homeListSqlPatch`/`m9SqlValidationManifest` written → `currentStage =
M10` in the SAME call → `stepM10FinalCertification` consistency check
passes → M10's own gates run → `finalCertificationReport` produced.
Proven end-to-end, no SQL executed, no production writes, in
`metroLaunchDriverM9EnforcedSql.test.ts` and
`metroLaunchDriverM9EnforcedEndToEnd.test.ts`.

## Test arithmetic

`npm run agent:test`: **1846 total = 1803 passed + 3 failed + 40 skipped +
0 todo.** All 3 failures are pre-existing `auditLive.test.ts` "live
acceptance" checks against real DB state — unrelated to this session
(same 3 failures present at the start of Session 1, confirmed each session).

`npx tsc --noEmit -p agent-service/tsconfig.json`: clean, zero errors.

**No SQL executed**: every test asserts against returned strings/statuses
from pure functions (`generateListMembershipSql`, `buildM9SafeSqlPlan`) —
nothing in this codebase's test suite opens a DB connection.

**Zero production writes**: every test uses
`InMemoryPlaybookRunStore`/`InMemoryExecutionStore`/`TestExecutor` and
fake, in-test resolver functions. No Munich or other production
item/list data was read or written by any code path this session touched.

## PHASE 8 — Default-mode decision: **LEGACY stays the default.**

ENFORCED is real, tested, and operational for its actual scope — but that
scope is narrower than a full metro launch, for reasons that are
architectural, not "not wired yet":

1. **No flagship/curated-mirror generation.** ENFORCED only ever produces
   THEMED-kind lists from `listConceptDiscovery.ts`'s tag-cluster
   discovery. It has no equivalent of LEGACY's `PRIMARY_SEASONAL`
   flagship list or `CURATED_MIRROR` full-catalog list. A metro launched
   entirely under ENFORCED today would ship an incomplete home-list plan
   compared to LEGACY, by design gap, not bug.
2. **No real production resolvers exist.** `deps.resolveM9ProductionItems`/
   `resolveM9ProductionLists` default to resolving nothing — no live
   Supabase query has been written or verified this session (deliberately:
   writing an unverified live query under this session's constraints
   would have been worse than not writing one). Every real invocation
   today parks at `WAITING` forever without a caller-supplied real
   implementation.
3. **The safe SQL module cannot create lists or items.** This is
   `listSqlGeneration.ts`'s own deliberate boundary (Munich calibration
   Phase 4), correctly respected rather than bypassed — but it means a
   first-ever metro launch (100% new lists, 100% new items) can NEVER
   complete via ENFORCED's safe path as it exists today. ENFORCED is
   currently only useful for a metro REFRESH (existing lists, existing
   items), not a first launch.
4. **No per-list-kind evidence pipeline exists upstream of M9.** Every
   `AFTER_DARK`/`HIDDEN_GEMS`/`FOOD_LOCAL_FLAVOR`/`DAY_TRIP`-classified
   concept correctly HOLDs/EXCLUDEs every member today (Phase 2's own
   honest, tested behavior) — meaning those four list kinds can never
   produce approved membership until `discoveryBasis`/`nighttimeSpecific`/
   `concreteLocalFlavorAction`/`travelEffort` are persisted somewhere in
   `MetroDriverState`.
5. `MARKET_BOUNDARY_EXCEPTION`/`UNSUPPORTED_SECRET_DESIGNATION`/
   `REMOVE_OR_REPLACE_COMPLETED_LIST` operator boundaries (named in Phase
   4 of the Session 2 task) still have no dedicated M9-ENFORCED detection
   logic — carried over, still true.

None of the "do not switch if" conditions from the task itself are
actually true anymore (no silent fallback, M10 can't consume mismatched
artifacts, the preflight that DOES exist is complete and fail-closed,
decisions are fingerprint-bound, in-flight runs are unaffected, and the
tests that exist ARE conclusive) — the blocker is pure scope: ENFORCED
does not yet do everything a metro launch needs. Per this task's own
instruction ("if ENFORCED cannot safely become the default... do not
compromise the safeguards to enable the switch"), the correct action is
to leave the default as **LEGACY** and report these five blockers
explicitly, rather than force a switch or weaken any of the real
safeguards built this session to make the numbers work.

**Recommended mode selection today**: `LEGACY` (default, unchanged) for
any real metro launch; `SHADOW` for diagnostic comparison on any real or
test metro; `ENFORCED` only for a deliberate, supervised trial on an
ALREADY-LAUNCHED metro's list refresh, with real
`resolveM9ProductionItems`/`resolveM9ProductionLists` implementations
wired in by the caller and every result inspected by a human before the
generated SQL is ever run by hand (this driver never executes SQL itself,
in any mode).

## What a Session 4 needs to close these gaps

1. A flagship/curated-mirror equivalent for ENFORCED (or an explicit,
   reviewed decision that ENFORCED never needs one — e.g. LEGACY continues
   to own those two list kinds forever, ENFORCED only owns discovered
   THEMED-family lists).
2. Real, verified `resolveM9ProductionItems`/`resolveM9ProductionLists`
   implementations against the actual Supabase schema (this session
   deliberately did not attempt this without being able to verify it live).
3. A decision on whether `listSqlGeneration.ts` should ever gain a safe
   create-list/create-item path, or whether ENFORCED accepts being
   refresh-only permanently.
4. Real per-item evidence collection (`discoveryBasis`/`nighttimeSpecific`/
   `concreteLocalFlavorAction`/`travelEffort`) somewhere upstream of M9,
   persisted in `MetroDriverState`, if Hidden Gems/After Dark/Food & Local
   Flavor/Day Trip curation via ENFORCED is ever in scope.
