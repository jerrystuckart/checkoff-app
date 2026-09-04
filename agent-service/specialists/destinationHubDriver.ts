// Chief Phase 2F — the Destination Hub orchestration driver (spec
// section 14). Proves the SAME driver architecture generalizes beyond
// metro_launch: candidate -> D0 discovery -> D1 pre-screen -> D2 DVA-1 ->
// D3 DVA-2 -> D4 DAP -> D5 pipeline READY -> D6 stakeholder research ->
// D7 relationship ready/assets-prep -> [NEEDS_JERRY: sending outreach is
// APPROVAL_REQUIRED] — the driver stops there, before any real outbound
// action, by design every time.
//
// REVISED Phase 2G (real methodology ingestion): DVA-1->DVA-2 and
// DVA-2->DAP are NO LONGER blanket Jerry-approval gates. Per the real
// ingested instructions (methodologies/destination/{dva1,dva2}/v2.md),
// "awaiting Jerry's approval" in the source text described the old
// manual multi-Claude-Project hand-off, not a substantive founder-
// judgment rule — see each methodology's own
// v2.legacy-operator-instructions.md. Routine, qualified progression
// (evaluateDVA1Gate's requiresJerry=false / routeDVA2Recommendation's
// requiresJerry=false) now advances automatically within the SAME driver
// pass; Jerry is asked only for the genuine judgment calls the real
// methodology actually names (DVA-1's STRONG_BUT_LATER_STAGE Current-
// Strategy Fit; DVA-2's HOLD_DAP_UNTIL_ISSUE_RESOLVED with no further
// research path). `state.dva2Approved`/`state.dapApproved` remain as the
// OVERRIDE mechanism for those genuine hold cases — never required for
// the routine case.
//
// Once real DVA-1/DVA-2/DAP methodologies are ingested and marked
// complete (done, Phase 2G), RemoteAiExecutor can run them for real once
// a qualified AI provider is configured — see the Phase 2G final report
// for exact readiness state. This driver is exercised here with
// synthetic data via TestExecutor/MANUAL_EXECUTOR.
//
// Reuses, never reimplements: destinationHubLifecycle.ts's pure
// gate/validation functions (Phase 2C, revised Phase 2G),
// destinationRelationship.ts's stage graph + asset-level model, and the
// SAME executor/routing/playbookRun primitives the metro driver uses.

import {
  screenDiscoveryCandidate,
  evaluateDVA1Gate,
  validateDva2Input,
  routeDVA2Recommendation,
  validateDapInput,
  dapEntryConditionMet,
  detectStaleOperationalDates,
  type DiscoveryCandidate,
  type DVA1Artifact,
  type DVA2Artifact,
  type DAPArtifact,
  type ExternalArtifactRef,
} from '../playbooks/destinationHubLifecycle'
import { requiredAssetLevel } from '../playbooks/destinationRelationship'
import { runExecutionRouted } from './routing'
import type { ExecutionStore, SpecialistExecutor, SpecialistExecutionRequest, AcceptResultOutcome, ExecutionRecord } from './executor'
import { getOrCreateRun, type PlaybookRunStore, type PlaybookRunRecord } from './playbookRun'
import type { DriverGuardrails } from './driverGuardrails'
import type { SpecialistResultEnvelope } from './types'

// ---------------------------------------------------------------------------
// runExecutionRouted's return type (AcceptResultOutcome | ExecutionRecord)
// has THREE distinct real shapes a caller must handle: a freshly-accepted
// result (`accepted` in outcome), an EXECUTOR_UNAVAILABLE/BLOCKED
// ExecutionRecord, and — the case the destination driver actually hits in
// practice, since D2/D3/D4 deliberately reuse the SAME executionId across
// resumed calls (unlike the metro driver's always-fresh per-call labels)
// — an IDEMPOTENT REPLAY: the execution was already COMPLETE on a prior
// call, so runExecution() short-circuits and hands back the bare
// ExecutionRecord instead of a fresh AcceptResultOutcome. Missing this
// case would make a resumed, already-completed stage look like a fresh
// failure. This helper normalizes all three.
// ---------------------------------------------------------------------------

type ResolvedOutcome = { kind: 'ACCEPTED'; envelope: SpecialistResultEnvelope } | { kind: 'UNAVAILABLE'; reason: string } | { kind: 'FAILED'; reason: string }

function resolveOutcome(outcome: AcceptResultOutcome | ExecutionRecord): ResolvedOutcome {
  if ('status' in outcome) {
    if (outcome.status === 'EXECUTOR_UNAVAILABLE') return { kind: 'UNAVAILABLE', reason: outcome.errorReason ?? 'EXECUTOR_UNAVAILABLE' }
    if (outcome.status === 'COMPLETE' && outcome.envelope) return { kind: 'ACCEPTED', envelope: outcome.envelope }
    return { kind: 'FAILED', reason: outcome.errorReason ?? `execution status ${outcome.status}` }
  }
  if (outcome.accepted) return { kind: 'ACCEPTED', envelope: outcome.record.envelope! }
  return { kind: 'FAILED', reason: outcome.reasons.join('; ') || 'evidence validation failed' }
}

export const DESTINATION_HUB_DRIVER_PLAYBOOK_KEY = 'destination_hub_lifecycle'

interface DestinationDriverState {
  [key: string]: unknown
  candidate?: DiscoveryCandidate & { destinationId: string; destinationName: string }
  dva1?: DVA1Artifact
  dva2?: DVA2Artifact
  dap?: DAPArtifact
  dva2Approved?: boolean
  dapApproved?: boolean
}

function readState(run: PlaybookRunRecord): DestinationDriverState {
  return (run.state as DestinationDriverState) ?? {}
}

export interface DestinationDriverDeps {
  runStore: PlaybookRunStore
  execStore: ExecutionStore
  executors: readonly SpecialistExecutor[]
  guardrails?: DriverGuardrails
  now?: () => string
}

function eid(runId: string, stage: string): string {
  return `${runId}::${stage}`
}

/**
 * `executedAt` is execution metadata, not analytical content — it must
 * never be trusted from model output. A real live DVA-1 proof (Phase 2H)
 * caught the model returning a hallucinated date (~2 years stale) for
 * this field despite instructions to report the actual timestamp; a
 * model has no reliable clock and no business asserting when the
 * orchestrator itself ran something. This unconditionally OVERWRITES
 * whatever the model put in evidence.artifact.executedAt with the real
 * completion time the driver observed — same `deps.now` clock (DI'd for
 * tests) already used for run.updatedAt. Any model-authored date that
 * belongs in the narrative (e.g. "as of early 2026...") stays wherever
 * the model put it inside fullReportMarkdown/extracted content —
 * untouched — this only ever overrides the dedicated metadata field.
 */
function stampExecutedAt<T extends ExternalArtifactRef>(artifact: T, deps: DestinationDriverDeps): T {
  return { ...artifact, executedAt: (deps.now ?? (() => new Date().toISOString()))() }
}

/**
 * Production-integrity pass — upstream artifact facts are immutable.
 * state.dva1/state.dva2 are handed to a LATER stage's request only as a
 * deep-cloned snapshot, never the live reference, so nothing downstream
 * (a buggy specialist implementation, a future driver change) can ever
 * mutate the canonical run.state object those values live in. The
 * driver's own step functions already never write to a field other than
 * their own stage's (stepD3Dva2 only ever assigns state.dva2, never
 * state.dva1) — this is the defense-in-depth complement to that
 * structural guarantee, not a replacement for it.
 */
function deepCloneJson<T>(value: T): T {
  return structuredClone(value)
}

async function persist(run: PlaybookRunRecord, deps: DestinationDriverDeps): Promise<PlaybookRunRecord> {
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

/**
 * A routine, no-Jerry-needed hold — distinct from escalate() (needs
 * Jerry) and block() (genuinely stuck). Used when a real methodology
 * outcome (e.g. DVA-2's STOP_PURSUIT, or HOLD_DAP_UNTIL_ISSUE_RESOLVED
 * with a research path already identified) means there is nothing more
 * for the driver to auto-do right now, but nothing is wrong either —
 * without this, the bounded step loop would otherwise spin through
 * idempotent no-op re-runs of the same stage up to its step cap.
 */
function wait(run: PlaybookRunRecord, reason: string): PlaybookRunRecord {
  run.status = 'WAITING'
  run.jerryReason = null
  run.decisionPacket = null
  const state = readState(run)
  state.lastWaitReason = reason
  run.state = state
  return run
}

async function stepD0(run: PlaybookRunRecord, candidate: DiscoveryCandidate & { destinationId: string; destinationName: string }): Promise<PlaybookRunRecord> {
  const state = readState(run)
  state.candidate = candidate
  run.state = state
  const screen = screenDiscoveryCandidate(candidate)
  if (screen.pipelineState !== 'READY') {
    return escalate(run, `D0 discovery did not clear ${candidate.destinationName} for pre-DVA screening.`, { decisionNeeded: 'Review discovery screen outcome.', why: screen.reason, evidence: screen })
  }
  run.currentStage = 'D1_PRE_DVA_SCREENING'
  return run
}

async function stepD1(run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  run.currentStage = 'D2_DVA1'
  return run
}

async function stepD2Dva1(deps: DestinationDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const request: SpecialistExecutionRequest = {
    specialist: 'destination_strategist',
    playbookKey: DESTINATION_HUB_DRIVER_PLAYBOOK_KEY,
    stage: 'D2_DVA1',
    objective: `${state.candidate?.destinationName}: DVA-1 screen`,
    inputs: { destinationId: state.candidate?.destinationId, destinationName: state.candidate?.destinationName },
    requiredEvidenceKeys: ['artifact'],
    methodologyId: 'destination/dva1',
    methodologyVersion: 'v2',
    executionId: eid(run.runId, 'D2'),
    projectId: run.projectId,
    destinationId: state.candidate?.destinationId ?? null,
    metroId: null,
    allowedCapabilities: ['open_brain_read'],
    authorityOperations: ['destination_hub.dva1_screen'],
    idempotencyKey: eid(run.runId, 'D2'),
  }
  const resolved = resolveOutcome(await runExecutionRouted(deps.execStore, request, deps.executors, deps.now))
  if (resolved.kind === 'UNAVAILABLE') return block(run, resolved.reason)
  if (resolved.kind === 'FAILED') return escalate(run, 'DVA-1 execution did not produce valid evidence.', { decisionNeeded: 'Review DVA-1 execution failure.', why: resolved.reason })

  const dva1 = stampExecutedAt(resolved.envelope.evidence.artifact as DVA1Artifact, deps)
  state.dva1 = dva1
  run.state = state
  const gate = evaluateDVA1Gate(dva1)

  if (!gate.requiresJerry) {
    // Routine — either qualifies and fits current strategy (auto-advance,
    // per the real methodology's own framing: "routine qualified
    // progression should not require Jerry just to move a file to the
    // next stage") or is archived (also routine, nothing to decide).
    if (gate.proposeDva2) run.currentStage = 'D3_DVA2'
    return run
  }
  if (state.dva2Approved) {
    // Jerry already reviewed this genuine STRONG_BUT_LATER_STAGE hold and
    // explicitly chose to proceed anyway — never re-ask.
    run.currentStage = 'D3_DVA2'
    return run
  }
  return escalate(run, `DVA-1 complete for ${dva1.destinationName}: score ${dva1.score} (${gate.tier}), Current-Strategy Fit: ${gate.currentStrategyFit}.`, {
    decisionNeeded: 'This destination qualifies for DVA-2 but is explicitly a later-stage opportunity — confirm whether to pursue now or hold.',
    why: gate.reason,
    chiefRecommendation: 'Hold — CheckOff is prioritizing smaller weekend destinations for the current expansion wave.',
    evidence: dva1,
  })
}

async function stepD3Dva2(deps: DestinationDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const request: SpecialistExecutionRequest = {
    specialist: 'destination_strategist',
    playbookKey: DESTINATION_HUB_DRIVER_PLAYBOOK_KEY,
    stage: 'D3_DVA2',
    objective: `${state.candidate?.destinationName}: DVA-2 deep opportunity analysis`,
    // Phase 2H — a real live proof exposed this passing only
    // consumedDva1ArtifactRef, a bare string, never the actual DVA-1
    // report. DVA-2's own methodology text opens by validating/revising
    // DVA-1's findings — impossible without seeing them. The model was
    // silently reinventing "DVA-1 Recap" numbers from scratch instead of
    // reading the real artifact, producing internally inconsistent
    // output. Passing the full artifact (including fullReportMarkdown)
    // gives the model the actual prior-stage evidence to build on.
    inputs: { destinationId: state.candidate?.destinationId, consumedDva1ArtifactRef: state.dva1?.artifactRef, consumedDva1Artifact: state.dva1 ? deepCloneJson(state.dva1) : null },
    requiredEvidenceKeys: ['artifact'],
    methodologyId: 'destination/dva2',
    methodologyVersion: 'v2',
    executionId: eid(run.runId, 'D3'),
    projectId: run.projectId,
    destinationId: state.candidate?.destinationId ?? null,
    metroId: null,
    allowedCapabilities: ['open_brain_read'],
    authorityOperations: ['destination_hub.draft_dva2'],
    idempotencyKey: eid(run.runId, 'D3'),
  }
  const resolved = resolveOutcome(await runExecutionRouted(deps.execStore, request, deps.executors, deps.now))
  if (resolved.kind === 'UNAVAILABLE') return block(run, resolved.reason)
  if (resolved.kind === 'FAILED') return escalate(run, 'DVA-2 execution did not produce valid evidence.', { decisionNeeded: 'Review DVA-2 execution failure.', why: resolved.reason })

  const dva2 = stampExecutedAt(resolved.envelope.evidence.artifact as DVA2Artifact, deps)
  // HARD ISOLATION — never accept a DVA-2 that consumed the wrong DVA-1.
  const validation = validateDva2Input(state.dva1!, dva2)
  if (!validation.valid) return block(run, `DVA-2 identity validation failed: ${validation.reason}`)

  state.dva2 = dva2
  run.state = state
  const routing = routeDVA2Recommendation(dva2)

  if (!routing.requiresJerry) {
    // BUILD_DAP_NOW -> routine auto-advance. STOP_PURSUIT or a
    // researchable HOLD -> routine, nothing for Jerry to decide, but
    // also nothing more to auto-do right now — WAIT cleanly rather than
    // spinning through idempotent no-op re-runs of this same stage.
    if (routing.pipelineState === 'READY') {
      run.currentStage = 'D4_DAP'
      return run
    }
    return wait(run, routing.reason)
  }
  if (state.dapApproved) {
    run.currentStage = 'D4_DAP'
    return run
  }
  return escalate(run, `DVA-2 for ${dva2.destinationName}: ${dva2.recommendedNextStep} (priority: ${dva2.recommendedPriority}).`, {
    decisionNeeded: 'DVA-2 recommends holding until a specific issue is resolved, with no further research path identified — needs your judgment.',
    why: routing.reason,
    evidence: dva2,
  })
}

async function stepD4Dap(deps: DestinationDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  if (!dapEntryConditionMet(state.dva2!)) return block(run, 'DAP entry condition not met — DVA-2 Recommended Next Step is not "Build DAP now".')

  const request: SpecialistExecutionRequest = {
    specialist: 'destination_strategist',
    playbookKey: DESTINATION_HUB_DRIVER_PLAYBOOK_KEY,
    stage: 'D4_DAP',
    objective: `${state.candidate?.destinationName}: Destination Action Plan`,
    // Phase 2H — same real defect as D3's consumedDva1Artifact above:
    // DAP's own methodology text says "Use only the information
    // contained in the DVA-2 report provided" — it MUST receive the
    // actual report, not a bare artifactRef string it cannot dereference.
    inputs: { destinationId: state.candidate?.destinationId, consumedDva2ArtifactRef: state.dva2?.artifactRef, consumedDva2Artifact: state.dva2 ? deepCloneJson(state.dva2) : null },
    requiredEvidenceKeys: ['artifact'],
    methodologyId: 'destination/dap',
    methodologyVersion: 'v2',
    executionId: eid(run.runId, 'D4'),
    projectId: run.projectId,
    destinationId: state.candidate?.destinationId ?? null,
    metroId: null,
    allowedCapabilities: ['open_brain_read'],
    authorityOperations: ['destination_hub.draft_dap'],
    idempotencyKey: eid(run.runId, 'D4'),
  }
  const resolved = resolveOutcome(await runExecutionRouted(deps.execStore, request, deps.executors, deps.now))
  if (resolved.kind === 'UNAVAILABLE') return block(run, resolved.reason)
  if (resolved.kind === 'FAILED') return escalate(run, 'DAP execution did not produce valid evidence.', { decisionNeeded: 'Review DAP execution failure.', why: resolved.reason })

  const dap = stampExecutedAt(resolved.envelope.evidence.artifact as DAPArtifact, deps)
  const validation = validateDapInput(state.dva2!, dap)
  if (!validation.valid) return block(run, `DAP identity validation failed: ${validation.reason}`)

  state.dap = dap
  run.state = state

  // Production-integrity pass — even with runtimeDateContextLine telling
  // the model the real date, a live proof showed it can still anchor its
  // OWN plan dates (rightNowTask, relationshipSequence) to a stale
  // internal calendar. Catch that here rather than silently advancing
  // past a plan Jerry could act on with dates already in the past.
  const staleCheck = detectStaleOperationalDates(dap, (deps.now ?? (() => new Date().toISOString()))())
  if (staleCheck.stale) {
    return escalate(run, `DAP for ${dap.destinationName} proposed operational dates that are materially stale relative to the actual runtime date.`, {
      decisionNeeded: 'Review DAP\'s proposed dates before acting on this plan — they appear to be based on a stale model calendar assumption, not the real current date.',
      why: staleCheck.reason,
      evidence: { rightNowTask: dap.extracted.rightNowTask, staleDates: staleCheck.staleDates },
    })
  }

  run.currentStage = 'D5_PIPELINE_STATE'
  return run
}

async function stepD5(run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  run.currentStage = 'D6_STAKEHOLDER_RESEARCH'
  return run
}

async function stepD6(run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  if (!state.dap?.extracted.recommendedChampion) {
    return escalate(run, 'DAP did not identify a recommended champion — stakeholder research cannot proceed automatically.', { decisionNeeded: 'Provide champion/stakeholder direction.', why: 'DAP.extracted.recommendedChampion is empty.' })
  }
  run.currentStage = 'RELATIONSHIP_ASSETS_PREP'
  return run
}

async function stepAssetsPrep(run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const level = requiredAssetLevel('ASSETS_PREP', !!state.dap)
  const packet = {
    decisionNeeded: 'Approve initial outreach to the DAP-recommended champion.',
    why: 'destination_relationship.send_email is APPROVAL_REQUIRED with no exception path — Chief drafts and prepares, Jerry sends.',
    chiefRecommendation: `Send a ${level} outreach to ${state.dap?.extracted.recommendedChampion} via the DAP-recommended entry strategy.`,
    champion: state.dap?.extracted.recommendedChampion,
    entryStrategy: state.dap?.extracted.recommendedEntryStrategy,
    valueProposition: state.dap?.extracted.checkoffValueProposition,
    assetLevel: level,
  }
  return escalate(run, `${state.candidate?.destinationName} relationship is ready for initial outreach — sending requires Jerry.`, packet)
}

// ---------------------------------------------------------------------------
// The public entry point
// ---------------------------------------------------------------------------

export interface DriveDestinationHubOptions {
  candidate: DiscoveryCandidate & { destinationId: string; destinationName: string }
  maxSteps?: number
}

export async function driveDestinationHub(deps: DestinationDriverDeps, projectId: string, options: DriveDestinationHubOptions): Promise<PlaybookRunRecord> {
  let run = await getOrCreateRun(deps.runStore, DESTINATION_HUB_DRIVER_PLAYBOOK_KEY, projectId, 'D0_DISCOVERY')
  if (run.status === 'PAUSED' || run.status === 'DONE') return run
  if (run.status === 'NEEDS_JERRY' || run.status === 'BLOCKED') return run // driver never silently re-escalates identically — caller must recordJerryDecision first

  const maxSteps = options.maxSteps ?? 50
  for (let step = 0; step < maxSteps; step++) {
    switch (run.currentStage) {
      case 'D0_DISCOVERY':
        run = await stepD0(run, options.candidate)
        break
      case 'D1_PRE_DVA_SCREENING':
        run = await stepD1(run)
        break
      case 'D2_DVA1':
        run = await stepD2Dva1(deps, run)
        break
      case 'D3_DVA2':
        run = await stepD3Dva2(deps, run)
        break
      case 'D4_DAP':
        run = await stepD4Dap(deps, run)
        break
      case 'D5_PIPELINE_STATE':
        run = await stepD5(run)
        break
      case 'D6_STAKEHOLDER_RESEARCH':
        run = await stepD6(run)
        break
      case 'RELATIONSHIP_ASSETS_PREP':
        run = await stepAssetsPrep(run)
        break
      default:
        throw new Error(`Unknown destination_hub_lifecycle driver stage "${run.currentStage}"`)
    }
    await persist(run, deps)
    if (run.status !== 'RUNNING') return run
  }
  return run
}
