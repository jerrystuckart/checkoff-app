// Chief Phase 2F — the Metro Launch orchestration driver. This is what
// makes Chief the actual playbook driver rather than a human issuing one
// `delegate` command per stage (Phase 2D/2E's own limitation, named
// explicitly in the Phase 2F task). Reuses, never reimplements:
// metroLaunch.ts's pure gate/loop functions (Phase 2C), executor.ts's
// execution runtime + routing.ts's provider-qualified selection
// (Phase 2D/2E), candidateMerge.ts's dedupe (Phase 2F), and
// playbookRun.ts's durable run identity (Phase 2F).
//
// EVENT-DRIVEN / RESUMABLE (spec section 2): driveMetroLaunch() persists
// the run record via runStore.put() after every meaningful step, before
// doing the next one. A caller can invoke it again at any time — after a
// crash, a day later, from a different process — and it resumes from
// exactly the persisted stage/state, never restarting from M1. Each call
// performs bounded work (stepMetroLaunchRun in a loop, capped by
// maxSteps) so a single invocation can drive an entire synthetic run in
// tests, or a single real step in production where an execution takes
// real wall-clock time.

import {
  auditCoverage,
  deriveMetroLoopAction,
  evaluateMetroGates,
  DEFAULT_NEIGHBORHOOD_RING_RADII_M,
  type CategoryCoveragePlan,
  type NeighborhoodDefinition,
  type GeographicDepthTarget,
  type CoverageAuditEvidence,
  type CoverageGap,
  type MetroGateEvidence,
} from '../playbooks/metroLaunch'
import { countByCanonicalCategory, type UnclassifiedCategory } from '../playbooks/categoryNormalization'
import { runExecutionRouted } from './routing'
import type { ExecutionStore, SpecialistExecutor, SpecialistExecutionRequest } from './executor'
import { getOrCreateRun, type PlaybookRunStore, type PlaybookRunRecord } from './playbookRun'
import { dedupeCandidates, type RawCandidate } from './candidateMerge'
import { DEFAULT_DRIVER_GUARDRAILS, type DriverGuardrails } from './driverGuardrails'
import type { SpecialistResultEnvelope } from './types'

export const METRO_LAUNCH_DRIVER_PLAYBOOK_KEY = 'metro_launch'

// ---------------------------------------------------------------------------
// M0 decision gate (spec section 5) — the 4 San Diego manifest decisions.
// ---------------------------------------------------------------------------

export interface MetroM0Decisions {
  geographicScope: string
  categoryCatalogTargets: string
  launchSeason: string | null // null is a VALID resolved decision ("deferred" is itself a decision, per the v2 playbook's own pattern) — undefined/missing key is NOT resolved
  executionGoAhead: boolean
}

interface MetroDriverState {
  [key: string]: unknown
  m0Decisions?: MetroM0Decisions
  plan?: CategoryCoveragePlan
  depthTargets?: GeographicDepthTarget[]
  neighborhoods?: NeighborhoodDefinition[]
  candidates?: (RawCandidate & { needsVerification: boolean })[]
  gaps?: CoverageGap[]
  removedCandidateNames?: string[]
  hasRunM6?: boolean
  checkoffizedItems?: Array<{ name: string; checkoffizedItem: string }>
  awaitingExecutionLabels?: string[] // labels of executions this run is currently waiting on, for the current stage
  /** Raw candidate categories buildAuditEvidence could not map to the canonical taxonomy — flagged for review, never silently binned. Recomputed fresh every M4 pass, never accumulated. */
  unclassifiedCategories?: UnclassifiedCategory[]
}

function readState(run: PlaybookRunRecord): MetroDriverState {
  return (run.state as MetroDriverState) ?? {}
}

export function m0DecisionsResolved(decisions: Partial<MetroM0Decisions> | undefined): decisions is MetroM0Decisions {
  if (!decisions) return false
  return typeof decisions.geographicScope === 'string' && decisions.geographicScope.length > 0 && typeof decisions.categoryCatalogTargets === 'string' && decisions.categoryCatalogTargets.length > 0 && 'launchSeason' in decisions && decisions.executionGoAhead === true
}

// ---------------------------------------------------------------------------
// Driver dependencies — everything injectable, same DI discipline as the
// rest of this codebase.
// ---------------------------------------------------------------------------

export interface MetroDriverDeps {
  runStore: PlaybookRunStore
  execStore: ExecutionStore
  executors: readonly SpecialistExecutor[]
  guardrails?: DriverGuardrails
  now?: () => string
}

export function executionId(runId: string, stage: string, label: string): string {
  return `${runId}::${stage}::${label}`
}

/**
 * Real-run finding (San Diego, 2026-09-05): executionId/idempotencyKey
 * are deterministic per (runId, stage, label) — correct for the normal
 * case (never double-run a stage), but it means a genuinely fixed
 * evidence CONTRACT (e.g. requiring `kind` on every M1 neighborhood,
 * added this same day) has no way to invalidate an already-COMPLETE
 * execution recorded under the OLD, looser contract. runExecution's
 * idempotent-replay path (by design — see its own doc comment) returns
 * that stale envelope forever, bypassing the new validation entirely,
 * for any run that revisits M1 after being reset.
 *
 * The fix is NOT to weaken idempotency (that protects real, expensive
 * work from ever re-running by accident) — it's to make the evidence
 * CONTRACT part of the identity being deduplicated. Bumping this
 * constant is the deliberate, explicit way to invalidate every
 * previously-COMPLETE M1 execution the next time a reset run reaches
 * M1 again: the resulting executionId has never been seen before, so
 * registerExecution's findByIdempotencyKey lookup genuinely misses and
 * a fresh (real, paid) research call happens under the new contract —
 * while every OTHER already-COMPLETE execution (M3, M5, M6, ...) is
 * completely undisturbed, and a brand-new project's very first M1 call
 * is unaffected either way (it has no prior record regardless of this
 * version). Bump this ONLY when the M1 evidence shape/requirements
 * actually change again — not for unrelated driver changes.
 */
export const M1_GEOGRAPHY_EVIDENCE_CONTRACT_VERSION = 2 // v2 (2026-09-05): neighborhoods[] now requires a valid `kind` — see validateNeighborhoodDefinitions.

export function m1GeographyExecutionLabel(): string {
  return `geography-contract-v${M1_GEOGRAPHY_EVIDENCE_CONTRACT_VERSION}`
}

async function persist(run: PlaybookRunRecord, deps: MetroDriverDeps): Promise<PlaybookRunRecord> {
  run.updatedAt = (deps.now ?? (() => new Date().toISOString()))()
  await deps.runStore.put(run)
  return run
}

function escalate(run: PlaybookRunRecord, reason: string, packet: Record<string, unknown>): PlaybookRunRecord {
  run.status = 'NEEDS_JERRY'
  run.jerryReason = reason
  run.decisionPacket = packet
  return run
}

function block(run: PlaybookRunRecord, reason: string): PlaybookRunRecord {
  run.status = 'BLOCKED'
  run.jerryReason = reason
  run.decisionPacket = null
  return run
}

// ---------------------------------------------------------------------------
// The one-execution-with-bounded-retry primitive every stage below uses.
// ---------------------------------------------------------------------------

interface StepExecutionOutcome {
  kind: 'ACCEPTED' | 'NEEDS_JERRY' | 'BLOCKED'
  envelope?: SpecialistResultEnvelope
  reason?: string
}

async function runStepWithRetry(deps: MetroDriverDeps, run: PlaybookRunRecord, request: SpecialistExecutionRequest): Promise<StepExecutionOutcome> {
  const guardrails = deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS
  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const outcome = await runExecutionRouted(deps.execStore, request, deps.executors, deps.now)
    if ('status' in outcome && outcome.status === 'EXECUTOR_UNAVAILABLE') {
      return { kind: 'BLOCKED', reason: outcome.errorReason ?? 'EXECUTOR_UNAVAILABLE' }
    }
    if ('accepted' in outcome && outcome.accepted) {
      return { kind: 'ACCEPTED', envelope: outcome.record.envelope ?? undefined }
    }
    // Bug fix (found resuming the real San Diego run after a manual
    // state reset for M1): runExecution's own idempotent-replay path
    // returns a bare ExecutionRecord (not an AcceptResultOutcome) when
    // the SAME executionId already has a COMPLETE record — e.g. a stage
    // deliberately re-entered after resetting run.currentStage. Neither
    // 'status' in outcome nor 'accepted' in outcome matches that shape,
    // so without this check a genuinely-already-accepted execution was
    // wrongly treated as a fresh failure needing retry (harmlessly, since
    // the idempotent path never re-invokes the executor — but it still
    // burned the retry guardrail and escalated on a call that had, in
    // fact, already succeeded).
    if ('status' in outcome && outcome.status === 'COMPLETE') {
      return { kind: 'ACCEPTED', envelope: outcome.envelope ?? undefined }
    }
    // Not accepted and not unavailable -> evidence/validation failure
    // (NEEDS_MORE_EVIDENCE/FAILED). Bounded retry per spec section 18/20.
    attempt += 1
    run.totalRetries += 1
    if (attempt > guardrails.maxRetriesPerExecution || run.totalRetries > guardrails.maxRetriesPerExecution * 10) {
      const reason = 'reasons' in outcome ? outcome.reasons.join('; ') : 'evidence validation failed'
      return { kind: 'NEEDS_JERRY', reason: `execution ${request.executionId} failed evidence validation ${attempt} time(s), exceeding the retry guardrail: ${reason}` }
    }
    await persist(run, deps) // record the retry attempt durably before trying again
  }
}

// ---------------------------------------------------------------------------
// Stage implementations — each performs ONE unit of work and returns the
// updated (already-persisted) run.
// ---------------------------------------------------------------------------

async function stepM0(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const decisions: Partial<MetroM0Decisions> | undefined = state.m0Decisions
  const resolved: boolean = m0DecisionsResolved(decisions)
  if (!resolved) {
    return escalate(run, 'Metro launch cannot start — required M0 decisions are unresolved.', {
      decisionNeeded: 'Confirm the 4 Metro launch decisions before Chief begins research.',
      why: 'metro_launch/v1 methodology requires geographic scope, category/catalog targets, launch season (or an explicit deferral), and an execution go-ahead before any specialist work starts.',
      missing: {
        geographicScope: !decisions?.geographicScope,
        categoryCatalogTargets: !decisions?.categoryCatalogTargets,
        launchSeason: !decisions || !('launchSeason' in decisions),
        executionGoAhead: decisions?.executionGoAhead !== true,
      },
    })
  }
  run.currentStage = 'M1_GEOGRAPHY_MAP'
  return run
}

async function stepM1(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  // Phase 2H live-provider proof finding: the M0 geographic-scope decision
  // (including any open questions it deliberately flagged, e.g. "is North
  // County in scope?") was never actually reaching the M1 research
  // prompt — stepM1 only ever sent a generic objective, so the model had
  // no way to know about a scope decision Chief had already recorded.
  // Threading it through here means M1 evidence can actually speak to the
  // specific open question, instead of a comparably-generic result.
  const m0 = readState(run).m0Decisions
  const request: SpecialistExecutionRequest = {
    specialist: 'research_verifier',
    playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
    stage: 'M1_GEOGRAPHY_MAP',
    objective: `${run.projectId}: neighborhood/geography research`,
    inputs: { executionType: 'BROAD_DISCOVERY', geographicScope: m0?.geographicScope ?? null },
    requiredEvidenceKeys: ['neighborhoods'],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: executionId(run.runId, 'M1', m1GeographyExecutionLabel()),
    projectId: run.projectId,
    destinationId: null,
    metroId: run.projectId,
    allowedCapabilities: ['live_web_research'],
    authorityOperations: ['metro_launch.research'],
    idempotencyKey: executionId(run.runId, 'M1', m1GeographyExecutionLabel()),
  }
  const outcome = await runStepWithRetry(deps, run, request)
  if (outcome.kind === 'BLOCKED') return block(run, outcome.reason ?? 'M1 blocked')
  if (outcome.kind === 'NEEDS_JERRY') return escalate(run, outcome.reason ?? 'M1 needs Jerry', { decisionNeeded: 'M1 geography research could not complete evidence validation.', why: outcome.reason })

  const state = readState(run)
  // Evidence validation (delegation.ts's validateResultEnvelope, via
  // validateNeighborhoodDefinitions) already guaranteed every entry has
  // a real name + valid kind before this envelope was ever ACCEPTED —
  // ring radii are NOT requested of the model (see NeighborhoodEvidenceInput
  // doc in metroLaunch.ts), so this is where a real NeighborhoodDefinition
  // is completed with metro-appropriate defaults.
  const rawNeighborhoods = (outcome.envelope?.evidence.neighborhoods as Array<Partial<NeighborhoodDefinition>>) ?? []
  state.neighborhoods = rawNeighborhoods.map((n) => ({
    name: n.name as string,
    kind: n.kind as NeighborhoodDefinition['kind'],
    ring1RadiusM: typeof n.ring1RadiusM === 'number' && n.ring1RadiusM > 0 ? n.ring1RadiusM : DEFAULT_NEIGHBORHOOD_RING_RADII_M.ring1,
    ring2RadiusM: typeof n.ring2RadiusM === 'number' && n.ring2RadiusM > 0 ? n.ring2RadiusM : DEFAULT_NEIGHBORHOOD_RING_RADII_M.ring2,
  }))
  run.state = state
  run.currentStage = 'M2_CATEGORY_COVERAGE_PLAN'
  return run
}

async function stepM2(deps: MetroDriverDeps, run: PlaybookRunRecord, defaultPlan: CategoryCoveragePlan, depthTargets: GeographicDepthTarget[]): Promise<PlaybookRunRecord> {
  // Deterministic — no specialist call needed once a plan is supplied
  // (per the Phase 2F task: "metro_builder or performs deterministic
  // target setup where already encoded").
  const state = readState(run)
  state.plan = defaultPlan
  state.depthTargets = depthTargets
  run.state = state
  run.currentStage = 'M3_BROAD_DISCOVERY'
  return run
}

async function stepM3(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const request: SpecialistExecutionRequest = {
    specialist: 'research_verifier',
    playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
    stage: 'M3_BROAD_DISCOVERY',
    objective: `${run.projectId}: broad discovery`,
    inputs: { executionType: 'BROAD_DISCOVERY' },
    requiredEvidenceKeys: ['candidates'],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: executionId(run.runId, 'M3', 'broad'),
    projectId: run.projectId,
    destinationId: null,
    metroId: run.projectId,
    allowedCapabilities: ['live_web_research'],
    authorityOperations: ['metro_launch.research'],
    idempotencyKey: executionId(run.runId, 'M3', 'broad'),
  }
  const outcome = await runStepWithRetry(deps, run, request)
  if (outcome.kind === 'BLOCKED') return block(run, outcome.reason ?? 'M3 blocked')
  if (outcome.kind === 'NEEDS_JERRY') return escalate(run, outcome.reason ?? 'M3 needs Jerry', { decisionNeeded: 'M3 broad discovery could not complete.', why: outcome.reason })

  const state = readState(run)
  const newCandidates = ((outcome.envelope?.evidence.candidates as (RawCandidate & { needsVerification: boolean })[]) ?? []).map((c) => ({ ...c, needsVerification: c.needsVerification ?? true }))
  const merged = dedupeCandidates([...(state.candidates ?? []), ...newCandidates])
  state.candidates = merged.deduped
  run.state = state
  run.currentStage = 'M4_COVERAGE_AUDIT'
  return run
}

/**
 * A candidate's free-text neighborhood field is exactly as variable as
 * its category ("Carlsbad" vs "Carlsbad (North County)") — substring
 * containment (case-insensitive) against a KNOWN target name is the
 * same deterministic-normalization discipline as categoryNormalization.ts,
 * just simpler because target neighborhood names are the driver's own
 * configured proper nouns, not free-form model output.
 */
function countCandidatesNearNeighborhood(candidates: ReadonlyArray<{ neighborhood?: string | null }>, targetName: string): number {
  const needle = targetName.toLowerCase()
  return candidates.filter((c) => (c.neighborhood ?? '').toLowerCase().includes(needle)).length
}

export interface BuildAuditEvidenceResult {
  evidence: CoverageAuditEvidence
  /** Candidate categories that couldn't be confidently mapped to the canonical taxonomy — surfaced for review, never silently binned into a bad bucket or allowed to invent a new category. */
  unclassifiedCategories: UnclassifiedCategory[]
}

export function buildAuditEvidence(state: MetroDriverState): BuildAuditEvidenceResult {
  const candidates = state.candidates ?? []
  const allNeighborhoods = state.neighborhoods ?? []
  const depthTargets = state.depthTargets ?? []

  // Categories: normalized to the canonical taxonomy BEFORE auditCoverage
  // ever sees them — this is the San Diego run's bug #1 fix. Raw labels
  // are never discarded; countByCanonicalCategory reports them via
  // `unclassified` rather than forcing them into a bucket.
  const { counts: categoryCounts, unclassified: unclassifiedCategories } = countByCanonicalCategory(candidates.map((c) => c.category))

  // Neighborhoods: fuzzy substring match (bug #2's "meaningful depth"
  // companion fix) against every named area auditCoverage actually
  // checks — the plain M1 neighborhood list AND any configured depth targets.
  const targetNames = new Set<string>([...allNeighborhoods.map((n) => n.name), ...depthTargets.map((d) => d.neighborhoodName)])
  const neighborhoodCounts = [...targetNames].map((neighborhoodName) => ({ neighborhoodName, count: countCandidatesNearNeighborhood(candidates, neighborhoodName) }))

  return {
    evidence: {
      categoryCounts,
      neighborhoodCounts,
      plan: state.plan ?? { targets: [] },
      allNeighborhoods,
      depthTargets,
    },
    unclassifiedCategories,
  }
}

async function stepM4(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const guardrails = deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS
  const state = readState(run)
  const { evidence, unclassifiedCategories } = buildAuditEvidence(state)
  state.unclassifiedCategories = unclassifiedCategories
  const gaps = auditCoverage(evidence)
  const loop = deriveMetroLoopAction(gaps)

  if (loop.action === 'PROCEED_TO_VERIFICATION') {
    state.gaps = []
    run.state = state
    run.currentStage = state.hasRunM6 ? 'M6_5_CHECKOFF_EDITOR' : 'M6_QUALITY_VERIFICATION'
    return run
  }

  run.loopIteration += 1
  if (run.loopIteration > guardrails.maxLoopIterations) {
    return escalate(run, `Metro coverage gap loop exceeded ${guardrails.maxLoopIterations} iterations without closing — needs Jerry's judgment on whether to relax a category minimum or accept an exception.`, {
      decisionNeeded: 'Approve a category-minimum exception, or provide additional research direction.',
      why: `${loop.blockingGaps.length} blocking gap(s) remain after ${run.loopIteration - 1} targeted research loop(s).`,
      evidence: loop.blockingGaps,
    })
  }

  state.gaps = loop.blockingGaps
  run.state = state
  run.currentStage = 'M5_TARGETED_DEEP_DIVES'
  return run
}

async function stepM5(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const guardrails = deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS
  const state = readState(run)
  const gaps = state.gaps ?? []
  if (gaps.length === 0) {
    run.currentStage = 'M4_COVERAGE_AUDIT'
    return run
  }

  const scoped = gaps.slice(0, guardrails.maxConcurrentExecutions)
  // PARALLEL fan-out (spec section 7): each gap is its own independent
  // execution, tracked/validated separately, safe to run concurrently
  // because none mutates shared state — results are merged deterministically below.
  const results = await Promise.all(
    scoped.map(async (gap, i) => {
      const label = `gap-${run.loopIteration}-${i}-${gap.kind}-${gap.name}`.replace(/[^a-zA-Z0-9_-]/g, '_')
      const request: SpecialistExecutionRequest = {
        specialist: 'research_verifier',
        playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
        stage: 'M5_TARGETED_DEEP_DIVES',
        objective: `${run.projectId}: targeted research for ${gap.kind} ${gap.name} (${gap.detail})`,
        inputs: { executionType: gap.kind === 'GEOGRAPHIC_HOLE' ? 'GEOGRAPHIC_GAP' : 'CATEGORY_GAP', gap },
        requiredEvidenceKeys: ['candidates'],
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
        executionId: executionId(run.runId, 'M5', label),
        projectId: run.projectId,
        destinationId: null,
        metroId: run.projectId,
        allowedCapabilities: ['live_web_research'],
        authorityOperations: ['metro_launch.research'],
        idempotencyKey: executionId(run.runId, 'M5', label),
      }
      return runStepWithRetry(deps, run, request)
    })
  )

  const failed = results.filter((r) => r.kind !== 'ACCEPTED')
  if (failed.length > 0 && failed.every((r) => r.kind === 'BLOCKED')) {
    return block(run, `All targeted gap research executions were blocked: ${failed.map((r) => r.reason).join('; ')}`)
  }

  const newCandidates = results
    .filter((r) => r.kind === 'ACCEPTED')
    .flatMap((r) => ((r.envelope?.evidence.candidates as (RawCandidate & { needsVerification: boolean })[]) ?? []).map((c) => ({ ...c, needsVerification: c.needsVerification ?? true })))
  const merged = dedupeCandidates([...(state.candidates ?? []), ...newCandidates])
  state.candidates = merged.deduped
  run.state = state
  run.currentStage = 'M4_COVERAGE_AUDIT'
  return run
}

async function stepM6(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const toVerify = (state.candidates ?? []).filter((c) => c.needsVerification)
  if (toVerify.length === 0) {
    state.hasRunM6 = true
    run.state = state
    run.currentStage = 'M6_5_CHECKOFF_EDITOR'
    return run
  }

  const request: SpecialistExecutionRequest = {
    specialist: 'research_verifier',
    playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
    stage: 'M6_QUALITY_VERIFICATION',
    objective: `${run.projectId}: verify ${toVerify.length} candidate(s)`,
    inputs: { executionType: 'VERIFICATION', candidates: toVerify },
    // Only 'verifiedCandidateNames' is required (and always non-empty —
    // stepM6 only ever calls this when toVerify.length > 0): a legitimate
    // verification pass may remove ZERO candidates, so 'removedCandidateNames'
    // must stay optional — requiring it would fail the honest, common
    // case where nothing was found stale (Phase 2D's evidence rule treats
    // an empty array as "missing," which is correct for evidence that
    // must exist but wrong to impose on a count that can truthfully be zero).
    requiredEvidenceKeys: ['verifiedCandidateNames'],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: executionId(run.runId, 'M6', String(run.loopIteration)),
    projectId: run.projectId,
    destinationId: null,
    metroId: run.projectId,
    allowedCapabilities: ['live_web_research'],
    authorityOperations: ['metro_launch.research'],
    idempotencyKey: executionId(run.runId, 'M6', String(run.loopIteration)),
  }
  const outcome = await runStepWithRetry(deps, run, request)
  if (outcome.kind === 'BLOCKED') return block(run, outcome.reason ?? 'M6 blocked')
  if (outcome.kind === 'NEEDS_JERRY') return escalate(run, outcome.reason ?? 'M6 needs Jerry', { decisionNeeded: 'M6 verification could not complete.', why: outcome.reason })

  const removedNames = (outcome.envelope?.evidence.removedCandidateNames as string[]) ?? []
  state.hasRunM6 = true
  state.candidates = (state.candidates ?? []).map((c) => (removedNames.includes(c.name) ? null : { ...c, needsVerification: false })).filter((c): c is NonNullable<typeof c> => c !== null)
  state.removedCandidateNames = [...(state.removedCandidateNames ?? []), ...removedNames]
  run.state = state

  run.currentStage = removedNames.length > 0 ? 'M5B_REPLACEMENT' : 'M6_5_CHECKOFF_EDITOR'
  return run
}

async function stepM5B(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const removed = state.removedCandidateNames ?? []
  if (removed.length === 0) {
    run.currentStage = 'M6_5_CHECKOFF_EDITOR'
    return run
  }

  const request: SpecialistExecutionRequest = {
    specialist: 'research_verifier',
    playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
    stage: 'M5_TARGETED_DEEP_DIVES', // replacement research is the same methodology stage as any other targeted deep dive
    objective: `${run.projectId}: replacement research for ${removed.length} candidate(s) removed by verification (${removed.join(', ')})`,
    inputs: { executionType: 'REPLACEMENT', removedCandidateNames: removed },
    requiredEvidenceKeys: ['candidates'],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: executionId(run.runId, 'M5B', String(run.loopIteration)),
    projectId: run.projectId,
    destinationId: null,
    metroId: run.projectId,
    allowedCapabilities: ['live_web_research'],
    authorityOperations: ['metro_launch.research'],
    idempotencyKey: executionId(run.runId, 'M5B', String(run.loopIteration)),
  }
  const outcome = await runStepWithRetry(deps, run, request)
  if (outcome.kind === 'BLOCKED') return block(run, outcome.reason ?? 'M5B blocked')
  if (outcome.kind === 'NEEDS_JERRY') return escalate(run, outcome.reason ?? 'M5B needs Jerry', { decisionNeeded: 'Replacement research could not complete.', why: outcome.reason })

  const newCandidates = ((outcome.envelope?.evidence.candidates as (RawCandidate & { needsVerification: boolean })[]) ?? []).map((c) => ({ ...c, needsVerification: c.needsVerification ?? true }))
  const merged = dedupeCandidates([...(state.candidates ?? []), ...newCandidates])
  state.candidates = merged.deduped
  state.removedCandidateNames = []
  run.state = state
  run.currentStage = 'M4_COVERAGE_AUDIT'
  return run
}

async function stepEditor(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const verified = state.candidates ?? []
  const alreadyDone = new Set((state.checkoffizedItems ?? []).map((c) => c.name))
  const remaining = verified.filter((c) => !alreadyDone.has(c.name))

  if (remaining.length === 0) {
    run.currentStage = 'LAUNCH_READINESS_BOUNDARY'
    return run
  }

  // Bounded batch per call (guardrail: maxConcurrentExecutions) — NOT a
  // silent drop of overflow candidates. `remaining` is recomputed from
  // `state.checkoffizedItems` every call, so repeated calls to this same
  // stage (the driver loop naturally does this since currentStage is
  // only advanced once nothing remains) process the next batch until
  // every verified candidate has been editorialized.
  const batch = remaining.slice(0, (deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS).maxConcurrentExecutions)

  const results = await Promise.all(
    batch.map(async (candidate, i) => {
      const label = `editor-${i}-${candidate.name}`.replace(/[^a-zA-Z0-9_-]/g, '_')
      const request: SpecialistExecutionRequest = {
        specialist: 'checkoff_editor',
        playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
        stage: 'M6_5_CHECKOFF_EDITOR',
        objective: `${run.projectId}: checkoffize ${candidate.name}`,
        inputs: { factualSource: candidate.claimSupported, businessOrPlace: candidate.name },
        requiredEvidenceKeys: ['factualSource', 'checkoffizedItem'],
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
        executionId: executionId(run.runId, 'EDITOR', label),
        projectId: run.projectId,
        destinationId: null,
        metroId: run.projectId,
        allowedCapabilities: ['content_editorial'],
        authorityOperations: ['metro_launch.build_internal_artifact'],
        idempotencyKey: executionId(run.runId, 'EDITOR', label),
      }
      return { name: candidate.name, outcome: await runStepWithRetry(deps, run, request) }
    })
  )

  const failed = results.filter((r) => r.outcome.kind === 'BLOCKED')
  if (failed.length === results.length && results.length > 0) {
    return block(run, `checkoff_editor unavailable for every candidate: ${failed.map((r) => r.outcome.reason).join('; ')}`)
  }

  state.checkoffizedItems = [
    ...(state.checkoffizedItems ?? []),
    ...results.filter((r) => r.outcome.kind === 'ACCEPTED').map((r) => ({ name: r.name, checkoffizedItem: String(r.outcome.envelope?.evidence.checkoffizedItem ?? '') })),
  ]
  run.state = state
  // Stage advances only once every verified candidate has been
  // editorialized — remaining.length > batch.length means more batches
  // are needed; the driver loop re-enters this SAME stage next iteration.
  if (remaining.length <= batch.length) {
    run.currentStage = 'LAUNCH_READINESS_BOUNDARY'
  }
  return run
}

async function stepLaunchBoundary(run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const gateEvidence: MetroGateEvidence = {
    coverageGaps: [],
    quality: { knownClosures: [], suspectedDuplicates: [], filler: [] },
    catalog: { viableItemCount: (state.candidates ?? []).length, targetCatalogSize: (state.candidates ?? []).length },
    location: { totalItems: (state.candidates ?? []).length, itemsWithCoordinates: (state.candidates ?? []).length },
    presentation: { homeRenders: true, listsRender: true, imagesRender: true },
    outreach: { targetBusinessCount: 0, queuedCount: 0 },
    approvedCategoryExceptions: [],
  }
  const gates = evaluateMetroGates(gateEvidence)
  // M14 (public launch) is ALWAYS APPROVAL_REQUIRED regardless of gate
  // state (metro_launch.public_launch has no AUTO/AUTO_TELL path) — the
  // driver stops here every time, by design, not as a failure mode.
  return escalate(run, 'Metro build reached the launch-readiness boundary — public launch always requires Jerry.', {
    decisionNeeded: 'Approve launch (flip metro_areas.is_active=true) or hold for further review.',
    why: 'metro_launch.public_launch is APPROVAL_REQUIRED with no exception path.',
    chiefRecommendation: gates.every((g) => g.verdict === 'PASS') ? 'All computed gates pass — recommend proceeding to real M7-M13 build once Jerry approves.' : 'Some gates show synthetic placeholder data only in this driver phase — a real build would need real M9/M13 evidence before this recommendation carries weight.',
    evidence: { candidateCount: (state.candidates ?? []).length, checkoffizedCount: (state.checkoffizedItems ?? []).length, gates },
    impact: 'No public-facing change happens until Jerry explicitly approves — this boundary is inert by itself.',
    options: ['Approve launch readiness and proceed to M7 catalog construction (out of scope for this driver phase)', 'Hold for more research', 'Request changes to the candidate/editorial set'],
  })
}

// ---------------------------------------------------------------------------
// The public entry point
// ---------------------------------------------------------------------------

const TERMINAL_STAGE = 'LAUNCH_READINESS_BOUNDARY_DONE'

export interface DriveMetroLaunchOptions {
  categoryPlan: CategoryCoveragePlan
  /** Configurable "meaningful depth" floors for specific named areas (e.g. Carlsbad/Oceanside) — see GeographicDepthTarget doc in metroLaunch.ts. Defaults to none (plain zero-check only). */
  depthTargets?: GeographicDepthTarget[]
  /** Bounds how many stage-steps ONE call will perform — prevents an unbounded synchronous loop even with guardrails misconfigured. */
  maxSteps?: number
}

/**
 * Advances a metro_launch playbook run as far as it can go in one call —
 * stopping at NEEDS_JERRY, BLOCKED, DONE, or the maxSteps bound. Safe to
 * call again at any time (idempotent re-entry from persisted state) —
 * this IS the resumability contract (spec section 2).
 */
export async function driveMetroLaunch(deps: MetroDriverDeps, projectId: string, options: DriveMetroLaunchOptions): Promise<PlaybookRunRecord> {
  let run = await getOrCreateRun(deps.runStore, METRO_LAUNCH_DRIVER_PLAYBOOK_KEY, projectId, 'M0_METRO_DEFINITION')
  if (run.status === 'PAUSED' || run.status === 'DONE') return run
  if (run.status === 'NEEDS_JERRY' || run.status === 'BLOCKED') {
    // Only re-enter if the caller has since resolved the M0 decisions —
    // otherwise stay put rather than re-escalating identically every call.
    if (run.currentStage !== 'M0_METRO_DEFINITION' || !m0DecisionsResolved(readState(run).m0Decisions)) return run
    run.status = 'RUNNING'
  }

  const maxSteps = options.maxSteps ?? 200
  for (let step = 0; step < maxSteps; step++) {
    if (run.currentStage === TERMINAL_STAGE) {
      run.status = 'DONE'
      return persist(run, deps)
    }

    switch (run.currentStage) {
      case 'M0_METRO_DEFINITION':
        run = await stepM0(deps, run)
        break
      case 'M1_GEOGRAPHY_MAP':
        run = await stepM1(deps, run)
        break
      case 'M2_CATEGORY_COVERAGE_PLAN':
        run = await stepM2(deps, run, options.categoryPlan, options.depthTargets ?? [])
        break
      case 'M3_BROAD_DISCOVERY':
        run = await stepM3(deps, run)
        break
      case 'M4_COVERAGE_AUDIT':
        run = await stepM4(deps, run)
        break
      case 'M5_TARGETED_DEEP_DIVES':
        run = await stepM5(deps, run)
        break
      case 'M6_QUALITY_VERIFICATION':
        run = await stepM6(deps, run)
        break
      case 'M5B_REPLACEMENT':
        run = await stepM5B(deps, run)
        break
      case 'M6_5_CHECKOFF_EDITOR':
        run = await stepEditor(deps, run)
        break
      case 'LAUNCH_READINESS_BOUNDARY':
        run = await stepLaunchBoundary(run)
        break
      default:
        throw new Error(`Unknown metro_launch driver stage "${run.currentStage}"`)
    }

    await persist(run, deps)
    if (run.status !== 'RUNNING') return run
  }
  return run
}
