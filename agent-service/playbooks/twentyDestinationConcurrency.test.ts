// Chief Phase 2D — 20-destination concurrency/isolation test (spec
// section 25). Proves portfolio scale isolation across BOTH layers this
// codebase actually has: the dossier/portfolio-ranking layer
// (destinationDossier.ts, already exercised at 5 destinations by
// destinationDossier.test.ts) and the NEW executor runtime layer
// (executor.ts) — 20 simultaneous destinations, each with its own DVA-1
// execution, none of which may leak into another's record or dossier.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleDossier, rankPortfolioActions, type DossierInputs, type PortfolioEntry } from './destinationDossier'
import type { DVA1Artifact } from './destinationHubLifecycle'
import { InMemoryExecutionStore, registerExecution, acceptExecutionResult, type SpecialistExecutionRequest } from '../specialists/executor'
import { fakeEnvelope } from '../specialists/testExecutor'

const DESTINATION_IDS = Array.from({ length: 20 }, (_, i) => `destination-${i.toString().padStart(2, '0')}`)

function dva1For(destId: string): DVA1Artifact {
  return {
    provider: 'dva1_claude_project',
    destinationId: destId,
    destinationName: `Destination ${destId}`,
    artifactRef: `dva1-${destId}`,
    executedAt: '2026-09-04T00:00:00Z',
    contentHash: null,
    score: 70 + (parseInt(destId.slice(-2), 10) % 25), // spread across tiers, deterministic
    recommendationText: 'x',
  }
}

function dossierInputsFor(destId: string): DossierInputs {
  return {
    destinationId: destId,
    destinationName: `Destination ${destId}`,
    dva1: dva1For(destId),
    dva2: null,
    dap: null,
    contacts: [{ destinationId: destId, contactId: `champion-${destId}`, role: 'Chamber director', sentiment: 'POSITIVE', promisesMade: [], introducedBy: null, isChampion: true, isBlocker: false }],
    relationshipStage: null,
    lastContactAt: null,
    lastInboundAt: null,
    nextFollowUpAt: null,
    nextMeetingAt: null,
    outstandingPromises: [],
    product: { contentBuildStatus: 'none', hasDestinationImagery: false, listCount: 0, businessCount: 0, activationReady: false },
    timing: { tourismSeason: null, fiscalBudgetTiming: null, upcomingEvents: [], nextActionDate: null },
  }
}

test('20 concurrent destination dossiers stay fully isolated — no champion, DVA-1 score, or artifact ref crosses destinations', () => {
  const dossiers = DESTINATION_IDS.map((id) => assembleDossier(dossierInputsFor(id)))

  for (let i = 0; i < DESTINATION_IDS.length; i++) {
    assert.equal(dossiers[i].destinationId, DESTINATION_IDS[i])
    assert.equal(dossiers[i].evaluation.dva1.artifactRef, `dva1-${DESTINATION_IDS[i]}`)
    assert.equal(dossiers[i].people.champions[0]?.contactId, `champion-${DESTINATION_IDS[i]}`)
  }

  // Every artifactRef and champion contactId is globally unique across the 20 — a real leak would collapse this set.
  assert.equal(new Set(dossiers.map((d) => d.evaluation.dva1.artifactRef)).size, 20)
  assert.equal(new Set(dossiers.map((d) => d.people.champions[0]?.contactId)).size, 20)
})

test('20 concurrent DVA-1 executions in the SAME execution store never let one destination\'s result satisfy another\'s execution', () => {
  const store = new InMemoryExecutionStore()
  const requests: SpecialistExecutionRequest[] = DESTINATION_IDS.map((id) => ({
    specialist: 'destination_strategist',
    playbookKey: 'destination_hub_lifecycle',
    stage: 'D2_DVA1',
    objective: `DVA-1 for ${id}`,
    inputs: {},
    requiredEvidenceKeys: ['artifact'],
    methodologyId: 'destination/dva1',
    methodologyVersion: 'v1',
    executionId: `exec-${id}`,
    projectId: 'project-portfolio-scale',
    destinationId: id,
    metroId: null,
    allowedCapabilities: ['open_brain_read'],
    authorityOperations: ['destination_hub.dva1_screen'],
    idempotencyKey: `idem-${id}`,
  }))

  for (const request of requests) {
    registerExecution(store, request, 'MANUAL_EXECUTOR')
  }
  assert.equal(store.all().length, 20)

  // Cross-contamination attempt FIRST, before destination 05's own execution
  // is ever completed: destination 06's identity must never satisfy 05's
  // still-open execution.
  const crossRequest = requests[5]
  assert.throws(
    () =>
      acceptExecutionResult(
        store,
        { executionId: crossRequest.executionId, projectId: crossRequest.projectId, destinationId: DESTINATION_IDS[6], metroId: null, playbookKey: crossRequest.playbookKey, stage: crossRequest.stage, methodologyId: crossRequest.methodologyId, methodologyVersion: crossRequest.methodologyVersion },
        fakeEnvelope({ taskId: crossRequest.executionId, objective: crossRequest.objective, evidence: { artifact: dva1For(DESTINATION_IDS[6]) }, methodologyId: 'destination/dva1', methodologyVersion: 'v1' })
      ),
    /Execution identity mismatch/
  )
  assert.notEqual(store.get(crossRequest.executionId)?.status, 'COMPLETE', 'the rejected cross-destination attempt must not have completed 05\'s execution')

  // Now accept each destination's OWN result correctly, including 05's.
  for (const request of requests) {
    const outcome = acceptExecutionResult(
      store,
      { executionId: request.executionId, projectId: request.projectId, destinationId: request.destinationId, metroId: null, playbookKey: request.playbookKey, stage: request.stage, methodologyId: request.methodologyId, methodologyVersion: request.methodologyVersion },
      fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { artifact: dva1For(request.destinationId!) }, methodologyId: 'destination/dva1', methodologyVersion: 'v1' })
    )
    assert.equal(outcome.accepted, true)
  }
  assert.ok(store.all().every((r) => r.status === 'COMPLETE'))
})

test('portfolio ranking over 20 destinations surfaces only the ones with a real next action — never a flat 20-item dump', () => {
  const now = new Date('2026-09-04T12:00:00Z')
  const entries: PortfolioEntry[] = DESTINATION_IDS.map((id, i) => ({
    destinationId: id,
    destinationName: `Destination ${id}`,
    dva1Status: 'RECEIVED',
    dva2Recommendation: null,
    dapStatus: 'NOT_STARTED',
    relationshipStage: null,
    requiredAssetLevel: null,
    // Only 3 of the 20 have anything urgent: one needs Jerry, one has a follow-up due, one is stale.
    waitingOn: i === 0 ? 'JERRY' : i === 2 ? 'US' : 'THEM',
    nextFollowUpAt: i === 1 ? '2026-09-04T00:00:00Z' : null,
    nextMeetingAt: null,
    budgetWindowOpeningAt: null,
    staleDays: i === 2 ? 30 : null,
  }))

  const ranked = rankPortfolioActions(entries, now)
  assert.equal(ranked.length, 3)
  assert.deepEqual(
    ranked.map((r) => r.destinationId),
    [DESTINATION_IDS[0], DESTINATION_IDS[1], DESTINATION_IDS[2]]
  )
})
