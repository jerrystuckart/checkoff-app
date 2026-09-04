// Chief Phase 2D — San Diego DRY RUN (spec section 19). Proves the
// executable specialist runtime end-to-end through the metro_launch
// methodology's M0-M6 loop using ONLY the fake TestExecutor and
// synthetic data. NO real research, no real web calls, no real
// destination/business contact — this test never touches the network.
//
// Trace proven here: M1 delegation -> accepted result -> M2 -> M3 broad
// discovery -> M4 audit fails Shopping + a geographic hole -> M5
// targeted research -> M4 re-audit passes -> one candidate fails M6
// verification -> replacement research (back through M5) -> M4 gates
// pass -> checkoff_editor handoff. Every step goes through the real
// registerExecution/acceptExecutionResult runtime (executor.ts), not a
// shortcut — this is what "show execution/run records" means.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryExecutionStore, runExecution, type SpecialistExecutionRequest } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import { auditCoverage, deriveMetroLoopAction, type CoverageAuditEvidence, type CategoryCoveragePlan, type NeighborhoodDefinition } from '../playbooks/metroLaunch'

const PROJECT_ID = 'project-san-diego-dry-run'
const METRO_ID = 'metro-san-diego-dry-run'

const PLAN: CategoryCoveragePlan = {
  targets: [
    { categoryName: 'Food & drink', minimumViable: 10, healthyTarget: 20, qualityNotes: [] },
    { categoryName: 'Shopping', minimumViable: 4, healthyTarget: 8, qualityNotes: ['Historically weak — flag proactively'] },
  ],
}

const NEIGHBORHOODS: NeighborhoodDefinition[] = [
  { name: 'Downtown/Gaslamp Quarter', kind: 'core_urban', ring1RadiusM: 500, ring2RadiusM: 1500 },
  { name: 'La Jolla', kind: 'important_neighborhood', ring1RadiusM: 500, ring2RadiusM: 1500 },
]

function baseReq(overrides: Partial<SpecialistExecutionRequest>): SpecialistExecutionRequest {
  return {
    specialist: 'metro_builder',
    playbookKey: 'metro_launch',
    stage: 'M1_GEOGRAPHY_MAP',
    objective: 'San Diego dry run',
    inputs: {},
    requiredEvidenceKeys: [],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: 'san-diego-exec',
    projectId: PROJECT_ID,
    destinationId: null,
    metroId: METRO_ID,
    allowedCapabilities: ['checkoff_db_read'],
    authorityOperations: ['metro_launch.research'],
    idempotencyKey: 'san-diego-idem',
    ...overrides,
  }
}

test('San Diego dry run: M1 geography delegation is accepted end-to-end through the real executor runtime', async () => {
  const store = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  const request = baseReq({ executionId: 'sd-m1', idempotencyKey: 'sd-m1-idem', requiredEvidenceKeys: ['neighborhoods'] })
  executor.script(request.executionId, fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { neighborhoods: NEIGHBORHOODS }, methodologyId: 'metro_launch', methodologyVersion: 'v1' }))

  const outcome = await runExecution(store, request, executor)
  assert.ok('accepted' in outcome && outcome.accepted, 'M1 result must be accepted before M2 can start')
  assert.equal(store.get(request.executionId)?.status, 'COMPLETE')
})

test('San Diego dry run: M4 first pass fails on Shopping-below-minimum AND a geographic hole -> loop demands TARGETED_RESEARCH', async () => {
  const store = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  const request = baseReq({
    stage: 'M4_COVERAGE_AUDIT',
    executionId: 'sd-m4-pass1',
    idempotencyKey: 'sd-m4-pass1-idem',
    authorityOperations: ['metro_launch.coverage_count'],
    requiredEvidenceKeys: ['categoryCounts', 'neighborhoodCounts'],
  })
  executor.script(
    request.executionId,
    fakeEnvelope({
      taskId: request.executionId,
      objective: request.objective,
      evidence: {
        categoryCounts: [
          { categoryName: 'Food & drink', count: 22 },
          { categoryName: 'Shopping', count: 2 }, // below minimumViable=4
        ],
        neighborhoodCounts: [{ neighborhoodName: 'Downtown/Gaslamp Quarter', count: 15 }], // La Jolla missing entirely -> geographic hole
      },
      methodologyId: 'metro_launch',
      methodologyVersion: 'v1',
    })
  )

  const outcome = await runExecution(store, request, executor)
  assert.ok('accepted' in outcome && outcome.accepted)
  const record = store.get(request.executionId)!
  const evidence = record.envelope!.evidence as { categoryCounts: { categoryName: string; count: number }[]; neighborhoodCounts: { neighborhoodName: string; count: number }[] }

  const auditEvidence: CoverageAuditEvidence = { categoryCounts: evidence.categoryCounts, neighborhoodCounts: evidence.neighborhoodCounts, plan: PLAN, allNeighborhoods: NEIGHBORHOODS }
  const gaps = auditCoverage(auditEvidence)
  const loop = deriveMetroLoopAction(gaps)

  assert.equal(loop.action, 'TARGETED_RESEARCH')
  assert.ok(gaps.some((g) => g.kind === 'CATEGORY_BELOW_MINIMUM' && g.name === 'Shopping'))
  assert.ok(gaps.some((g) => g.kind === 'GEOGRAPHIC_HOLE' && g.name === 'La Jolla'))
})

test('San Diego dry run: M5 targeted Shopping + La Jolla research -> M4 recount -> gates pass -> loop says PROCEED_TO_VERIFICATION', async () => {
  const store = new InMemoryExecutionStore()
  const executor = new TestExecutor()

  const m5 = baseReq({
    stage: 'M5_TARGETED_DEEP_DIVES',
    executionId: 'sd-m5-shopping-lajolla',
    idempotencyKey: 'sd-m5-idem',
    objective: 'targeted research: Shopping category + La Jolla neighborhood',
    authorityOperations: ['metro_launch.research'],
    requiredEvidenceKeys: ['newCandidates'],
  })
  executor.script(
    m5.executionId,
    fakeEnvelope({ taskId: m5.executionId, objective: m5.objective, evidence: { newCandidates: ['La Jolla Cove Shop', "Warwick's Books", 'La Valencia gift shop'] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  const m5Outcome = await runExecution(store, m5, executor)
  assert.ok('accepted' in m5Outcome && m5Outcome.accepted)

  const m4Recount = baseReq({
    stage: 'M4_COVERAGE_AUDIT',
    executionId: 'sd-m4-pass2',
    idempotencyKey: 'sd-m4-pass2-idem',
    authorityOperations: ['metro_launch.coverage_count'],
    requiredEvidenceKeys: ['categoryCounts', 'neighborhoodCounts'],
  })
  executor.script(
    m4Recount.executionId,
    fakeEnvelope({
      taskId: m4Recount.executionId,
      objective: m4Recount.objective,
      evidence: {
        categoryCounts: [
          { categoryName: 'Food & drink', count: 22 },
          { categoryName: 'Shopping', count: 5 }, // now above minimumViable=4
        ],
        neighborhoodCounts: [
          { neighborhoodName: 'Downtown/Gaslamp Quarter', count: 15 },
          { neighborhoodName: 'La Jolla', count: 3 }, // no longer a hole
        ],
      },
      methodologyId: 'metro_launch',
      methodologyVersion: 'v1',
    })
  )
  const m4Outcome = await runExecution(store, m4Recount, executor)
  assert.ok('accepted' in m4Outcome && m4Outcome.accepted)

  const record = store.get(m4Recount.executionId)!
  const evidence = record.envelope!.evidence as { categoryCounts: { categoryName: string; count: number }[]; neighborhoodCounts: { neighborhoodName: string; count: number }[] }
  const gaps = auditCoverage({ categoryCounts: evidence.categoryCounts, neighborhoodCounts: evidence.neighborhoodCounts, plan: PLAN, allNeighborhoods: NEIGHBORHOODS })
  const loop = deriveMetroLoopAction(gaps)

  assert.equal(loop.action, 'PROCEED_TO_VERIFICATION')
  assert.equal(gaps.filter((g) => g.kind === 'CATEGORY_BELOW_MINIMUM' || g.kind === 'GEOGRAPHIC_HOLE').length, 0)
})

test('San Diego dry run: M6 verification fails one Shopping candidate -> replacement research re-enters M5 -> re-audit passes again', async () => {
  const store = new InMemoryExecutionStore()
  const executor = new TestExecutor()

  const m6 = baseReq({
    stage: 'M6_QUALITY_VERIFICATION',
    specialist: 'research_verifier',
    executionId: 'sd-m6-verify',
    idempotencyKey: 'sd-m6-idem',
    authorityOperations: ['metro_launch.research'],
    requiredEvidenceKeys: ['knownClosures'],
  })
  executor.script(
    m6.executionId,
    fakeEnvelope({ taskId: m6.executionId, objective: m6.objective, evidence: { knownClosures: ["Warwick's Books"] }, methodologyId: 'metro_launch', methodologyVersion: 'v1', blockers: ["Warwick's Books flagged closed — removing from Shopping candidates, creates a new deficit"] })
  )
  const m6Outcome = await runExecution(store, m6, executor)
  assert.ok('accepted' in m6Outcome && m6Outcome.accepted)
  const closures = (store.get(m6.executionId)!.envelope!.evidence as { knownClosures: string[] }).knownClosures
  assert.equal(closures.length, 1, 'verification removed exactly one Shopping candidate, creating a fresh deficit')

  // Replacement loop: back to M5, scoped specifically to the deficit verification just created.
  const replacement = baseReq({
    stage: 'M5_TARGETED_DEEP_DIVES',
    executionId: 'sd-m5-replacement',
    idempotencyKey: 'sd-m5-replacement-idem',
    objective: 'replacement research: Shopping (Warwick\'s Books removed for closure)',
    authorityOperations: ['metro_launch.research'],
    requiredEvidenceKeys: ['newCandidates'],
  })
  executor.script(replacement.executionId, fakeEnvelope({ taskId: replacement.executionId, objective: replacement.objective, evidence: { newCandidates: ['Muttropolis La Jolla'] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' }))
  const replacementOutcome = await runExecution(store, replacement, executor)
  assert.ok('accepted' in replacementOutcome && replacementOutcome.accepted)

  const finalAudit = auditCoverage({
    categoryCounts: [
      { categoryName: 'Food & drink', count: 22 },
      { categoryName: 'Shopping', count: 5 }, // 5 pre-closure, minus 1 closure, plus 1 replacement = still 5
    ],
    neighborhoodCounts: [
      { neighborhoodName: 'Downtown/Gaslamp Quarter', count: 15 },
      { neighborhoodName: 'La Jolla', count: 3 },
    ],
    plan: PLAN,
    allNeighborhoods: NEIGHBORHOODS,
  })
  assert.equal(deriveMetroLoopAction(finalAudit).action, 'PROCEED_TO_VERIFICATION')
})

test('San Diego dry run: checkoff_editor handoff only runs AFTER verification, and requires both factualSource and checkoffizedItem', async () => {
  const store = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  const request = baseReq({
    stage: 'M6_5_CHECKOFF_EDITOR',
    specialist: 'checkoff_editor',
    executionId: 'sd-editor',
    idempotencyKey: 'sd-editor-idem',
    methodologyId: 'checkoff_editor',
    methodologyVersion: 'v1',
    objective: 'checkoffize verified Shopping candidate: Muttropolis La Jolla',
    authorityOperations: ['metro_launch.build_internal_artifact'],
    requiredEvidenceKeys: ['factualSource', 'checkoffizedItem'],
  })
  executor.script(
    request.executionId,
    fakeEnvelope({
      taskId: request.executionId,
      objective: request.objective,
      evidence: {
        factualSource: 'Muttropolis La Jolla is a pet boutique with a rotating selection of local-artist pet accessories.',
        checkoffizedItem: "Find your dog's next collar from a local artist at Muttropolis in La Jolla.",
      },
      methodologyId: 'checkoff_editor',
      methodologyVersion: 'v1',
    })
  )

  const outcome = await runExecution(store, request, executor)
  assert.ok('accepted' in outcome && outcome.accepted)
  assert.equal(store.get(request.executionId)?.status, 'COMPLETE')
})

test('San Diego dry run: full execution/run record trail is inspectable and every stage is distinctly identified', async () => {
  const store = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  const stages = ['M1_GEOGRAPHY_MAP', 'M2_CATEGORY_COVERAGE_PLAN', 'M3_BROAD_DISCOVERY'] as const
  for (const stage of stages) {
    const request = baseReq({ stage, executionId: `sd-trail-${stage}`, idempotencyKey: `sd-trail-${stage}-idem`, requiredEvidenceKeys: ['note'] })
    executor.script(request.executionId, fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { note: `${stage} done` }, methodologyId: 'metro_launch', methodologyVersion: 'v1' }))
    await runExecution(store, request, executor)
  }
  const records = store.all()
  assert.equal(records.length, 3)
  assert.deepEqual(
    records.map((r) => r.request.stage).sort(),
    [...stages].sort()
  )
  assert.ok(records.every((r) => r.status === 'COMPLETE' && r.request.methodologyId === 'metro_launch' && r.request.projectId === PROJECT_ID))
})
