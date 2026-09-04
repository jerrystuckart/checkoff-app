// Chief Phase 2D — Destination DVA/DAP DRY RUN (spec section 18). Proves
// the executable specialist runtime handles the DVA-1 -> gate -> DVA-2 ->
// gate -> DAP handoff end-to-end through MANUAL_EXECUTOR (the only
// working executor type for these three methodologies today — see
// destinationExecutorGap.ts) with hard cross-destination isolation
// enforced by the runtime itself, not just by the pure validators. NO
// real destination outreach, no real DVA-1/DVA-2/DAP Project invocation.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryExecutionStore, acceptExecutionResult, type SpecialistExecutionRequest } from '../specialists/executor'
import { beginManualExecution, submitManualResult } from '../specialists/manualExecutor'
import { fakeEnvelope } from '../specialists/testExecutor'
import { classifyDVA1Score, evaluateDVA1Gate, validateDva2Input, routeDVA2Recommendation, validateDapInput, dapEntryConditionMet, type DVA1Artifact, type DVA2Artifact, type DAPArtifact } from './destinationHubLifecycle'

const PROJECT_ID = 'project-destination-dry-run'

function dvaReq(overrides: Partial<SpecialistExecutionRequest>): SpecialistExecutionRequest {
  return {
    specialist: 'destination_strategist',
    playbookKey: 'destination_hub_lifecycle',
    stage: 'D2_DVA1',
    objective: 'DVA-1 dry run',
    inputs: {},
    requiredEvidenceKeys: ['artifact'],
    methodologyId: 'destination/dva1',
    methodologyVersion: 'v1',
    executionId: 'dva-exec',
    projectId: PROJECT_ID,
    destinationId: 'destination-grand-lake',
    metroId: null,
    allowedCapabilities: ['open_brain_read'],
    authorityOperations: ['destination_hub.dva1_screen'],
    idempotencyKey: 'dva-idem',
    ...overrides,
  }
}

test('DVA/DAP dry run: DVA-1 runs through MANUAL_EXECUTOR (the only working path today) and gates to propose DVA-2', () => {
  const store = new InMemoryExecutionStore()
  const request = dvaReq({ executionId: 'gl-dva1', idempotencyKey: 'gl-dva1-idem' })
  const { assignmentPackage } = beginManualExecution(store, request)

  assert.equal(assignmentPackage.methodologyId, 'destination/dva1')
  assert.ok(assignmentPackage.instructions.includes('destination/dva1/v1'))

  const dva1Artifact: DVA1Artifact = {
    provider: 'dva1_claude_project',
    destinationId: 'destination-grand-lake',
    destinationName: 'Grand Lake',
    artifactRef: 'dva1-artifact-grand-lake-1',
    executedAt: '2026-09-04T00:00:00Z',
    contentHash: null,
    score: 86,
    recommendationText: 'Strong seasonal tourism identity, accessible chamber contact.',
  }

  const outcome = submitManualResult(store, request.executionId, fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { artifact: dva1Artifact }, methodologyId: 'destination/dva1', methodologyVersion: 'v1' }))
  assert.equal(outcome.accepted, true)

  const gate = evaluateDVA1Gate(dva1Artifact)
  assert.equal(classifyDVA1Score(86), 'EXCELLENT')
  assert.equal(gate.proposeDva2, true)
  assert.ok(gate.reason.toLowerCase().includes('jerry'), 'DVA-1 -> DVA-2 always still names the Jerry-approval requirement')
})

test('DVA/DAP dry run: DVA-2 correctly consumes THIS destination\'s DVA-1 artifact and routes GREEN toward DAP', () => {
  const store = new InMemoryExecutionStore()
  const dva1Artifact: DVA1Artifact = {
    provider: 'dva1_claude_project',
    destinationId: 'destination-grand-lake',
    destinationName: 'Grand Lake',
    artifactRef: 'dva1-artifact-grand-lake-1',
    executedAt: '2026-09-04T00:00:00Z',
    contentHash: null,
    score: 86,
    recommendationText: 'Strong seasonal tourism identity.',
  }

  const dva2Request = dvaReq({ stage: 'D3_DVA2', executionId: 'gl-dva2', idempotencyKey: 'gl-dva2-idem', methodologyId: 'destination/dva2', methodologyVersion: 'v1', authorityOperations: ['destination_hub.draft_dva2'] })
  beginManualExecution(store, dva2Request)

  const dva2Artifact: DVA2Artifact = {
    provider: 'dva2_claude_project',
    destinationId: 'destination-grand-lake',
    destinationName: 'Grand Lake',
    artifactRef: 'dva2-artifact-grand-lake-1',
    executedAt: '2026-09-04T01:00:00Z',
    contentHash: null,
    recommendation: 'GREEN',
    rationale: 'Accessible champion, real budget, low political complexity.',
    knownRisks: [],
    consumedDva1ArtifactRef: dva1Artifact.artifactRef,
  }

  const validation = validateDva2Input(dva1Artifact, dva2Artifact)
  assert.equal(validation.valid, true)

  const outcome = submitManualResult(store, dva2Request.executionId, fakeEnvelope({ taskId: dva2Request.executionId, objective: dva2Request.objective, evidence: { artifact: dva2Artifact }, methodologyId: 'destination/dva2', methodologyVersion: 'v1' }))
  assert.equal(outcome.accepted, true)

  const routing = routeDVA2Recommendation(dva2Artifact)
  assert.equal(routing.pipelineState, 'READY')
  assert.equal(routing.requiresJerry, true)
  assert.equal(dapEntryConditionMet(dva2Artifact), true)
})

test('DVA/DAP dry run: HARD ISOLATION — a DVA-2 artifact naming a DIFFERENT destination\'s DVA-1 is rejected by the pure validator', () => {
  const dva1Willcox: DVA1Artifact = {
    provider: 'dva1_claude_project',
    destinationId: 'destination-willcox',
    destinationName: 'Willcox',
    artifactRef: 'dva1-artifact-willcox-1',
    executedAt: '2026-09-04T00:00:00Z',
    contentHash: null,
    score: 91,
    recommendationText: 'Elite.',
  }
  const dva2ClaimingGrandLake: DVA2Artifact = {
    provider: 'dva2_claude_project',
    destinationId: 'destination-grand-lake', // MISMATCH — claims Grand Lake while consuming Willcox's DVA-1
    destinationName: 'Grand Lake',
    artifactRef: 'dva2-artifact-mismatch',
    executedAt: '2026-09-04T01:00:00Z',
    contentHash: null,
    recommendation: 'GREEN',
    rationale: 'n/a',
    knownRisks: [],
    consumedDva1ArtifactRef: dva1Willcox.artifactRef,
  }
  const validation = validateDva2Input(dva1Willcox, dva2ClaimingGrandLake)
  assert.equal(validation.valid, false)
  assert.match(validation.reason, /Destination mismatch/)
})

test('DVA/DAP dry run: HARD ISOLATION — the executor runtime itself refuses a DVA-2 result submitted against the wrong destination execution', () => {
  const store = new InMemoryExecutionStore()
  const request = dvaReq({ stage: 'D3_DVA2', executionId: 'gl-dva2-runtime', idempotencyKey: 'gl-dva2-runtime-idem', methodologyId: 'destination/dva2', methodologyVersion: 'v1', destinationId: 'destination-grand-lake', authorityOperations: ['destination_hub.draft_dva2'] })
  beginManualExecution(store, request)

  assert.throws(
    () =>
      acceptExecutionResult(
        store,
        { executionId: request.executionId, projectId: request.projectId, destinationId: 'destination-willcox', metroId: null, playbookKey: request.playbookKey, stage: request.stage, methodologyId: request.methodologyId, methodologyVersion: request.methodologyVersion },
        fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { artifact: {} }, methodologyId: 'destination/dva2', methodologyVersion: 'v1' })
      ),
    /Execution identity mismatch/
  )
})

test('DVA/DAP dry run: YELLOW with evidence gaps holds for more research, never escalates to Jerry prematurely', () => {
  const dva2Yellow: DVA2Artifact = {
    provider: 'dva2_claude_project',
    destinationId: 'destination-rim-country',
    destinationName: 'Rim Country',
    artifactRef: 'dva2-artifact-rim-country-1',
    executedAt: '2026-09-04T01:00:00Z',
    contentHash: null,
    recommendation: 'YELLOW',
    rationale: 'Promising but stakeholder access unclear.',
    knownRisks: ['no confirmed chamber contact'],
    evidenceGaps: ['confirm chamber/CVB decision-maker contact'],
    consumedDva1ArtifactRef: 'dva1-artifact-rim-country-1',
  }
  const routing = routeDVA2Recommendation(dva2Yellow)
  assert.equal(routing.pipelineState, 'WAITING')
  assert.equal(routing.requiresJerry, false)
})

test('DVA/DAP dry run: RED with no stated disposition defaults to HOLD, never silently DECLINEd', () => {
  const dva2Red: DVA2Artifact = {
    provider: 'dva2_claude_project',
    destinationId: 'destination-verde-valley',
    destinationName: 'Verde Valley',
    artifactRef: 'dva2-artifact-verde-valley-1',
    executedAt: '2026-09-04T01:00:00Z',
    contentHash: null,
    recommendation: 'RED',
    rationale: 'Geography too fragmented for current wave.',
    knownRisks: ['multi-jurisdiction stakeholder complexity'],
    consumedDva1ArtifactRef: 'dva1-artifact-verde-valley-1',
  }
  const routing = routeDVA2Recommendation(dva2Red)
  assert.equal(routing.pipelineState, 'HOLD')
  assert.equal(routing.requiresJerry, false)
})

test('DVA/DAP dry run: DAP correctly consumes this destination\'s GREEN DVA-2 and extracts operational fields', () => {
  const store = new InMemoryExecutionStore()
  const dva2Artifact: DVA2Artifact = {
    provider: 'dva2_claude_project',
    destinationId: 'destination-grand-lake',
    destinationName: 'Grand Lake',
    artifactRef: 'dva2-artifact-grand-lake-1',
    executedAt: '2026-09-04T01:00:00Z',
    contentHash: null,
    recommendation: 'GREEN',
    rationale: 'Ready.',
    knownRisks: [],
    consumedDva1ArtifactRef: 'dva1-artifact-grand-lake-1',
  }

  const dapRequest = dvaReq({ stage: 'D4_DAP', executionId: 'gl-dap', idempotencyKey: 'gl-dap-idem', methodologyId: 'destination/dap', methodologyVersion: 'v1', authorityOperations: ['destination_hub.draft_dap'] })
  beginManualExecution(store, dapRequest)

  const dapArtifact: DAPArtifact = {
    provider: 'dap_claude_project',
    destinationId: 'destination-grand-lake',
    destinationName: 'Grand Lake',
    artifactRef: 'dap-artifact-grand-lake-1',
    executedAt: '2026-09-04T02:00:00Z',
    contentHash: null,
    consumedDva2ArtifactRef: dva2Artifact.artifactRef,
    extracted: {
      recommendedChampion: 'Grand Lake Area Chamber director',
      secondaryChampions: [],
      decisionMakers: ['Town board'],
      stakeholderOrganizations: ['Chamber of Commerce'],
      fundingBudgetClues: ['annual tourism marketing line item'],
      likelyBuyer: 'Chamber',
      estimatedSalesDifficulty: 'MEDIUM',
      timingConsiderations: ['budget approved each spring'],
      politicalStakeholderComplexity: 'LOW',
      objectionsHurdles: [],
      destinationPainPoints: ['limited digital discovery for visitors'],
      checkoffValueProposition: 'Turns lake-town visitors into active explorers',
      recommendedEntryStrategy: 'chamber director introduction',
      relationshipSequence: ['chamber director', 'town board liaison'],
      recommendedOfferDirection: 'Champion tier',
    },
  }

  const validation = validateDapInput(dva2Artifact, dapArtifact)
  assert.equal(validation.valid, true)
  assert.equal(dapEntryConditionMet(dva2Artifact), true)

  const outcome = submitManualResult(store, dapRequest.executionId, fakeEnvelope({ taskId: dapRequest.executionId, objective: dapRequest.objective, evidence: { artifact: dapArtifact }, methodologyId: 'destination/dap', methodologyVersion: 'v1' }))
  assert.equal(outcome.accepted, true)
  assert.equal(dapArtifact.extracted.recommendedChampion, 'Grand Lake Area Chamber director')
})
