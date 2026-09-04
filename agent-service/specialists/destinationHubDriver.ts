// Chief Phase 2F — the Destination Hub orchestration driver (spec
// section 14). Proves the SAME driver architecture generalizes beyond
// metro_launch: candidate -> D0 discovery -> D1 pre-screen -> D2 DVA-1
// -> [NEEDS_JERRY: DVA-2 never auto-starts] -> D3 DVA-2 -> GREEN ->
// [NEEDS_JERRY: DAP never auto-starts] -> D4 DAP -> D5 pipeline READY ->
// D6 stakeholder research -> D7 relationship ready/assets-prep ->
// [NEEDS_JERRY: sending outreach is APPROVAL_REQUIRED] — the driver
// stops there, before any real outbound action, by design every time.
//
// Real DVA-1/DVA-2/DAP execution remains EXECUTOR_UNAVAILABLE through
// RemoteAiExecutor until Jerry ingests the real methodologies
// (methodologyIngestion.ts) — this driver is exercised here with
// synthetic data via TestExecutor/MANUAL_EXECUTOR, exactly as spec
// section 14 asks ("even if real DVA execution remains blocked").
//
// Reuses, never reimplements: destinationHubLifecycle.ts's pure
// gate/validation functions (Phase 2C), destinationRelationship.ts's
// stage graph + asset-level model (Phase 2C correction), and the SAME
// executor/routing/playbookRun primitives the metro driver uses.

import { screenDiscoveryCandidate, evaluateDVA1Gate, validateDva2Input, routeDVA2Recommendation, validateDapInput, dapEntryConditionMet, type DiscoveryCandidate, type DVA1Artifact, type DVA2Artifact, type DAPArtifact } from '../playbooks/destinationHubLifecycle'
import { requiredAssetLevel } from '../playbooks/destinationRelationship'
import { runExecutionRouted } from './routing'
import type { ExecutionStore, SpecialistExecutor, SpecialistExecutionRequest } from './executor'
import { getOrCreateRun, type PlaybookRunStore, type PlaybookRunRecord } from './playbookRun'
import type { DriverGuardrails } from './driverGuardrails'

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
    methodologyVersion: 'v1',
    executionId: eid(run.runId, 'D2'),
    projectId: run.projectId,
    destinationId: state.candidate?.destinationId ?? null,
    metroId: null,
    allowedCapabilities: ['open_brain_read'],
    authorityOperations: ['destination_hub.dva1_screen'],
    idempotencyKey: eid(run.runId, 'D2'),
  }
  const outcome = await runExecutionRouted(deps.execStore, request, deps.executors, deps.now)
  if ('status' in outcome && outcome.status === 'EXECUTOR_UNAVAILABLE') return block(run, outcome.errorReason ?? 'DVA-1 executor unavailable')
  if (!('accepted' in outcome) || !outcome.accepted) {
    return escalate(run, 'DVA-1 execution did not produce valid evidence.', { decisionNeeded: 'Review DVA-1 execution failure.', why: 'reasons' in outcome ? outcome.reasons.join('; ') : 'unknown' })
  }

  const dva1 = outcome.record.envelope!.evidence.artifact as DVA1Artifact
  state.dva1 = dva1
  run.state = state
  const gate = evaluateDVA1Gate(dva1)
  // RETRIEVED, exact: DVA-2 never starts automatically, regardless of tier.
  // Advance the STAGE to D3_DVA2 now (when proposeDva2), so that once
  // Jerry approves (recordJerryDecision sets state.dva2Approved), the
  // driver resumes at D3_DVA2 — never re-runs stepD2Dva1 and re-asks the
  // same already-answered question a second time.
  if (gate.proposeDva2) run.currentStage = 'D3_DVA2'
  return escalate(run, `DVA-1 complete for ${dva1.destinationName}: score ${dva1.score} (${gate.tier}).`, {
    decisionNeeded: gate.proposeDva2 ? 'Approve moving forward to DVA-2.' : 'DVA-1 score is below threshold — confirm whether to archive or proceed anyway.',
    why: gate.reason,
    chiefRecommendation: gate.proposeDva2 ? 'Proceed to DVA-2.' : 'Archive — score below the DVA-1 threshold.',
    evidence: dva1,
  })
}

async function stepD3Dva2(deps: DestinationDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  if (!state.dva2Approved) {
    return escalate(run, 'DVA-2 requires explicit Jerry approval before it starts — no exception, regardless of DVA-1 tier.', { decisionNeeded: 'Approve DVA-2.', why: 'Retrieved rule: DVA-2 never starts automatically.' })
  }
  const request: SpecialistExecutionRequest = {
    specialist: 'destination_strategist',
    playbookKey: DESTINATION_HUB_DRIVER_PLAYBOOK_KEY,
    stage: 'D3_DVA2',
    objective: `${state.candidate?.destinationName}: DVA-2 deep opportunity analysis`,
    inputs: { destinationId: state.candidate?.destinationId, consumedDva1ArtifactRef: state.dva1?.artifactRef },
    requiredEvidenceKeys: ['artifact'],
    methodologyId: 'destination/dva2',
    methodologyVersion: 'v1',
    executionId: eid(run.runId, 'D3'),
    projectId: run.projectId,
    destinationId: state.candidate?.destinationId ?? null,
    metroId: null,
    allowedCapabilities: ['open_brain_read'],
    authorityOperations: ['destination_hub.draft_dva2'],
    idempotencyKey: eid(run.runId, 'D3'),
  }
  const outcome = await runExecutionRouted(deps.execStore, request, deps.executors, deps.now)
  if ('status' in outcome && outcome.status === 'EXECUTOR_UNAVAILABLE') return block(run, outcome.errorReason ?? 'DVA-2 executor unavailable')
  if (!('accepted' in outcome) || !outcome.accepted) {
    return escalate(run, 'DVA-2 execution did not produce valid evidence.', { decisionNeeded: 'Review DVA-2 execution failure.', why: 'reasons' in outcome ? outcome.reasons.join('; ') : 'unknown' })
  }

  const dva2 = outcome.record.envelope!.evidence.artifact as DVA2Artifact
  // HARD ISOLATION — never accept a DVA-2 that consumed the wrong DVA-1.
  const validation = validateDva2Input(state.dva1!, dva2)
  if (!validation.valid) return block(run, `DVA-2 identity validation failed: ${validation.reason}`)

  state.dva2 = dva2
  run.state = state
  const routing = routeDVA2Recommendation(dva2)
  if (routing.pipelineState !== 'READY') {
    return escalate(run, `DVA-2 recommendation for ${dva2.destinationName}: ${dva2.recommendation}.`, { decisionNeeded: 'Review DVA-2 outcome — not GREEN.', why: routing.reason, evidence: dva2 })
  }
  // GREEN — advance the stage now, same "never re-ask an already-answered
  // question" discipline as stepD2Dva1 above.
  run.currentStage = 'D4_DAP'
  return escalate(run, `DVA-2 GREEN for ${dva2.destinationName} — eligible to advance toward DAP.`, {
    decisionNeeded: 'Approve moving forward to DAP.',
    why: routing.reason,
    chiefRecommendation: 'Proceed to DAP.',
    evidence: dva2,
  })
}

async function stepD4Dap(deps: DestinationDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  if (!state.dapApproved) {
    return escalate(run, 'DAP requires explicit Jerry approval before it starts.', { decisionNeeded: 'Approve DAP.', why: 'DAP only starts after Jerry approves the DVA-2 GREEN handoff.' })
  }
  if (!dapEntryConditionMet(state.dva2!)) return block(run, 'DAP entry condition not met — DVA-2 is not GREEN.')

  const request: SpecialistExecutionRequest = {
    specialist: 'destination_strategist',
    playbookKey: DESTINATION_HUB_DRIVER_PLAYBOOK_KEY,
    stage: 'D4_DAP',
    objective: `${state.candidate?.destinationName}: Destination Action Plan`,
    inputs: { destinationId: state.candidate?.destinationId, consumedDva2ArtifactRef: state.dva2?.artifactRef },
    requiredEvidenceKeys: ['artifact'],
    methodologyId: 'destination/dap',
    methodologyVersion: 'v1',
    executionId: eid(run.runId, 'D4'),
    projectId: run.projectId,
    destinationId: state.candidate?.destinationId ?? null,
    metroId: null,
    allowedCapabilities: ['open_brain_read'],
    authorityOperations: ['destination_hub.draft_dap'],
    idempotencyKey: eid(run.runId, 'D4'),
  }
  const outcome = await runExecutionRouted(deps.execStore, request, deps.executors, deps.now)
  if ('status' in outcome && outcome.status === 'EXECUTOR_UNAVAILABLE') return block(run, outcome.errorReason ?? 'DAP executor unavailable')
  if (!('accepted' in outcome) || !outcome.accepted) {
    return escalate(run, 'DAP execution did not produce valid evidence.', { decisionNeeded: 'Review DAP execution failure.', why: 'reasons' in outcome ? outcome.reasons.join('; ') : 'unknown' })
  }

  const dap = outcome.record.envelope!.evidence.artifact as DAPArtifact
  const validation = validateDapInput(state.dva2!, dap)
  if (!validation.valid) return block(run, `DAP identity validation failed: ${validation.reason}`)

  state.dap = dap
  run.state = state
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
