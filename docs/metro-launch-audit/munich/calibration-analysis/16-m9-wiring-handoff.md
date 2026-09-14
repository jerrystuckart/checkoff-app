# M9 Wiring Handoff — stopped at commit `fbf7a19`

Status: Parts 1–2 done (trace + characterization). Parts 3–10 (adapter, modes,
real wiring, e2e proof) **not started**. This doc is the continuation brief.

## Current live M9 call path

`driveMetroLaunch` loop reaches `currentStage === 'M9_HOME_LIST_MIRROR'` →
`stepM9HomeListMirror` (`metroLaunchDriver.ts:3483`):
1. Runs a second `OUT_OF_MARKET_CONTAMINATION_GATE` pass.
2. Requires `deps.canonicalNeighborhoods` — fails closed `BLOCKED` if absent.
3. Calls `buildHomeListPlan(state, flagshipListTitle)` (`metroLaunchDriver.ts:2537`):
   fixed menu only — one flagship list via `selectFlagshipList`, then
   `THEMED_LIST_DEFINITIONS` iterated through `buildEditorialThemedLists`,
   then Metro Finisher `CREATED` themed-list decisions, then one
   `CURATED_MIRROR`. **No concept discovery. No real fit-scoring** —
   `listFitScoring.ts`'s `scoreItemsForLists` exists but is additive/
   reporting-only, never gates membership.
4. Builds `newItems`/neighborhood SQL inputs, calls `buildHomeListSqlPatch`.
5. Sets `state.homeListPlan` and `state.homeListSqlPatch`.
6. Appends `HOME_LIST_CERTIFICATION_GATE` + curated-layer gate results.
7. Unconditionally sets `run.currentStage = 'M10_METRO_LAUNCH_CERTIFICATION'`
   — the loop falls straight into M10 in the **same** `driveMetroLaunch` call
   (status stays `RUNNING`), it does not stop and wait for a separate resume.

## `state.homeListPlan` shape (today)

```ts
homeListPlan?: HomeListPlanEntry[]   // metroLaunchDriver.ts:189
```
One flat array, no concept-discovery metadata, no per-item fit record, no
mode marker. **This is the one and only list-truth artifact today** — no
dual-source problem to reconcile, but also nothing to layer a "mode" flag
onto without extending the type.

## The 8 characterization tests (`agent-service/specialists/metroLaunchDriverM9Characterization.test.ts`)

1. Normal M9 entry builds a `homeListPlan` (flagship + curated-layer mirror) from the certified catalog.
2. `state.homeListPlan`/`state.homeListSqlPatch` are persisted to the run store, not just held in memory.
3. Re-invoking `driveMetroLaunch` after M9/M10 already ran does not duplicate or mutate the plan/patch.
4. M9 transitions into M10 in the same drive call — a `finalCertificationReport` is produced.
5. A run parked at `NEEDS_JERRY`/`LAUNCH_READINESS_BOUNDARY` is NOT touched by a fresh invocation without the reopen flag.
6. `reopenFromLaunchBoundary=true` re-enters a completed run and can re-derive the M9 artifacts.
7. Missing `deps.canonicalNeighborhoods` fails closed `BLOCKED`, never a partial SQL patch.
8. A certified item missing metadata/geo fails the whole package closed rather than shipping a partial one.

## Intentional behaviors these tests preserve (must not break during wiring)

- Fail-closed on missing canonical neighborhoods or incomplete item metadata — never a partial/silent SQL patch.
- A completed run at `LAUNCH_READINESS_BOUNDARY` is inert to a plain re-invocation; only the explicit reopen flag re-enters it.
- Re-running M9/M10 on an already-completed run doesn't duplicate or drift the artifacts.
- M9→M10 happens in one drive call, not a separate resume step.

## Behaviors expected to change once wiring lands

- `buildHomeListPlan`'s fixed-menu selection → replaced/gated by real `listConceptDiscovery.ts` output in `ENFORCED` mode.
- `scoreItemsForLists`'s reporting-only role → becomes gating via `evaluateItemForListMembership`; catalog membership stops implying list membership.
- A single unconditional M9→M10 fall-through → must add real `NEEDS_JERRY`/HOLD stops for new-concept approval, overlap, weak-depth-needs-filler, unresolved duplicates, etc. (`operatorReviewBoundaries.ts`).
- `state.homeListPlan`'s shape needs a mode marker (`LEGACY`/`SHADOW`/`ENFORCED`) and room for the concept-discovery + per-item-decision artifacts without breaking the 8 tests above.

## Files likely involved in the next slice

- `agent-service/specialists/metroLaunchDriver.ts` — `stepM9HomeListMirror`, `buildHomeListPlan`, `MetroDriverState.homeListPlan` type, stage-transition logic.
- New: `agent-service/specialists/m9ListCurationAdapter.ts` (orchestrates the playbooks below, keeps the driver thin).
- `agent-service/playbooks/listConceptDiscovery.ts`, `listFitScoring.ts`, `listSqlGeneration.ts`, `operatorReviewBoundaries.ts`, `holdRecovery.ts` — all exist, tested in isolation, zero call sites outside doc comments.
- `agent-service/playbooks/__fixtures__/munichGoldStandard.ts`, `munichListCurationFixtures.ts` — for the Part 9 integration tests.

## Key risks identified

- `stepM9HomeListMirror` is deep inside a 4,218-line file with an unconditional same-call fall-through into M10 — any new HOLD/NEEDS_JERRY exit must not accidentally still fall through.
- No existing mode-flag precedent on `MetroDriverDeps` for a three-way LEGACY/SHADOW/ENFORCED switch (closest analog is the boolean-ish `PacketExecutionBudget` config) — needs real design, not a copy-paste.
- SHADOW mode's "run both, mutate nothing" requirement means the new path must be provably side-effect-free when not authoritative — worth its own isolation test before ENFORCED is ever attempted.
- Proving "ENFORCED never silently falls back" and "M10 consumes the new artifact" both require genuine end-to-end tests, not unit tests of the pure modules — that's the bulk of the remaining effort.

## Confirmations

- **Worktree clean** relative to tonight's session state: only pre-existing, unrelated local modifications (`app.json`, `supabase/config.toml`, from before this task) and the expected untracked Munich/Florence artifacts from earlier tonight — nothing unexpected, nothing left dirty by this task.
- **Zero production writes** — all characterization tests run against `InMemoryPlaybookRunStore`/`InMemoryExecutionStore`/`TestExecutor`; the one real-DB call site (`verifyHomeListRows`) is stubbed to force `{failed: true}`, never actually invoked.
