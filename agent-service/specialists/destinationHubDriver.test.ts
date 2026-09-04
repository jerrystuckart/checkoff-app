// Chief Phase 2F — destination_hub_lifecycle driver tests. Proves the
// SAME driver architecture as metroLaunchDriver.ts generalizes to
// destination sequencing (spec section 14), plus 20-concurrent-run
// isolation (spec section 15/18). All synthetic data via TestExecutor —
// no real DVA-1/DVA-2/DAP invocation, no outbound action.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveDestinationHub } from './destinationHubDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId, recordJerryDecision } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import type { DiscoveryCandidate } from '../playbooks/destinationHubLifecycle'

function candidate(destinationId: string, destinationName: string, overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate & { destinationId: string; destinationName: string } {
  return {
    destinationId,
    destinationName,
    name: destinationName,
    state: 'CO',
    manageableGeography: true,
    stakeholderComplexity: 'LOW',
    tourismIdentity: true,
    sufficientThingsToDo: true,
    localBusinessDensity: 'MEDIUM',
    compellingStoryFit: true,
    likelyDecisionMakerAccessible: true,
    ...overrides,
  }
}

function scriptDestination(executor: TestExecutor, destinationId: string, destinationName: string, dva1Score: number, dva2Recommendation: 'GREEN' | 'YELLOW' | 'RED') {
  executor.scriptWhen(
    (r) => r.stage === 'D2_DVA1' && r.destinationId === destinationId,
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { artifact: { provider: 'dva1_claude_project', destinationId, destinationName, artifactRef: `dva1-${destinationId}`, executedAt: '2026-09-05T00:00:00Z', contentHash: null, score: dva1Score, recommendationText: 'synthetic' } },
        methodologyId: 'destination/dva1',
        methodologyVersion: 'v1',
      })
  )
  executor.scriptWhen(
    (r) => r.stage === 'D3_DVA2' && r.destinationId === destinationId,
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          artifact: {
            provider: 'dva2_claude_project',
            destinationId,
            destinationName,
            artifactRef: `dva2-${destinationId}`,
            executedAt: '2026-09-05T01:00:00Z',
            contentHash: null,
            recommendation: dva2Recommendation,
            rationale: 'synthetic',
            knownRisks: [],
            consumedDva1ArtifactRef: `dva1-${destinationId}`,
          },
        },
        methodologyId: 'destination/dva2',
        methodologyVersion: 'v1',
      })
  )
  executor.scriptWhen(
    (r) => r.stage === 'D4_DAP' && r.destinationId === destinationId,
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          artifact: {
            provider: 'dap_claude_project',
            destinationId,
            destinationName,
            artifactRef: `dap-${destinationId}`,
            executedAt: '2026-09-05T02:00:00Z',
            contentHash: null,
            consumedDva2ArtifactRef: `dva2-${destinationId}`,
            extracted: {
              recommendedChampion: `${destinationName} Chamber director`,
              secondaryChampions: [],
              decisionMakers: [],
              stakeholderOrganizations: [],
              fundingBudgetClues: [],
              likelyBuyer: null,
              estimatedSalesDifficulty: null,
              timingConsiderations: [],
              politicalStakeholderComplexity: null,
              objectionsHurdles: [],
              destinationPainPoints: [],
              checkoffValueProposition: `CheckOff for ${destinationName}`,
              recommendedEntryStrategy: 'chamber introduction',
              relationshipSequence: [],
              recommendedOfferDirection: null,
            },
          },
        },
        methodologyId: 'destination/dap',
        methodologyVersion: 'v1',
      })
  )
}

test('destination driver: full synthetic sequence D0 -> DVA-1 -> [NEEDS_JERRY] -> DVA-2 GREEN -> [NEEDS_JERRY] -> DAP -> stakeholder research -> assets prep -> [NEEDS_JERRY: outreach send]', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptDestination(executor, 'destination-grand-lake', 'Grand Lake', 88, 'GREEN')

  const projectId = 'grand-lake-synthetic'
  const runId = playbookRunId('destination_hub_lifecycle', projectId)

  // D0 -> D1 -> D2 (DVA-1) -> NEEDS_JERRY (propose DVA-2). Stage is
  // already advanced to D3_DVA2 so resuming never re-asks this same
  // question — see stepD2Dva1's own doc.
  let run = await driveDestinationHub({ runStore, execStore, executors: [executor] }, projectId, { candidate: candidate('destination-grand-lake', 'Grand Lake') })
  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'D3_DVA2')
  assert.match(run.jerryReason ?? '', /DVA-1 complete/)
  assert.equal((run.state as { dva1?: { score: number } }).dva1?.score, 88)

  // Jerry approves DVA-2 -> driver runs it -> NEEDS_JERRY again (propose DAP), since GREEN
  await recordJerryDecision(runStore, runId, { dva2Approved: true })
  run = await driveDestinationHub({ runStore, execStore, executors: [executor] }, projectId, { candidate: candidate('destination-grand-lake', 'Grand Lake') })
  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'D4_DAP')
  assert.match(run.jerryReason ?? '', /GREEN/)

  // Jerry approves DAP -> driver runs it, then D5 -> D6 -> assets prep -> NEEDS_JERRY (outreach send)
  await recordJerryDecision(runStore, runId, { dapApproved: true })
  run = await driveDestinationHub({ runStore, execStore, executors: [executor] }, projectId, { candidate: candidate('destination-grand-lake', 'Grand Lake') })
  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'RELATIONSHIP_ASSETS_PREP')
  assert.match(run.jerryReason ?? '', /outreach/)
  assert.equal((run.decisionPacket as { champion?: string })?.champion, 'Grand Lake Chamber director')

  // NEVER any real outbound action taken — the driver stopped, it did not send anything.
  const allExecutions = await execStore.all()
  assert.ok(allExecutions.every((e) => e.request.authorityOperations.every((op) => op !== 'destination_relationship.send_email')))
})

test('destination driver: a DVA-2 RED with no disposition holds (never auto-declines) and never advances toward DAP without Jerry', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptDestination(executor, 'destination-verde-valley', 'Verde Valley', 82, 'RED')

  const projectId = 'verde-valley-synthetic'
  const runId = playbookRunId('destination_hub_lifecycle', projectId)

  let run = await driveDestinationHub({ runStore, execStore, executors: [executor] }, projectId, { candidate: candidate('destination-verde-valley', 'Verde Valley') })
  await recordJerryDecision(runStore, runId, { dva2Approved: true })
  run = await driveDestinationHub({ runStore, execStore, executors: [executor] }, projectId, { candidate: candidate('destination-verde-valley', 'Verde Valley') })

  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'D3_DVA2')
  assert.match(run.jerryReason ?? '', /RED/)
  assert.equal((run.state as { dapApproved?: boolean }).dapApproved, undefined)
})

// ---------------------------------------------------------------------------
// 20 concurrent destinations (spec section 15/18) — isolation proof
// ---------------------------------------------------------------------------

test('20 concurrent destination driver runs stay fully isolated — DVA-1 scores, artifacts, and champions never cross runs', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()

  const destinations = Array.from({ length: 20 }, (_, i) => ({
    id: `destination-${i.toString().padStart(2, '0')}`,
    name: `Destination ${i}`,
    // All >= 65 (BORDERLINE or better) so every one of the 20 legitimately
    // proposes DVA-2 — this test is specifically about isolation across
    // concurrent DVA-2 gates, not about the ARCHIVE-tier "never proposes
    // DVA-2 at all" behavior (covered separately by the DVA-1 gate tests
    // in destinationHubLifecycle.test.ts).
    dva1Score: 70 + i,
    dva2Recommendation: (['GREEN', 'YELLOW', 'RED'] as const)[i % 3],
  }))

  for (const d of destinations) {
    scriptDestination(executor, d.id, d.name, d.dva1Score, d.dva2Recommendation)
  }

  // Drive all 20 through D0->D2 (DVA-1) concurrently.
  const afterDva1 = await Promise.all(destinations.map((d) => driveDestinationHub({ runStore, execStore, executors: [executor] }, d.id, { candidate: candidate(d.id, d.name) })))

  for (let i = 0; i < destinations.length; i++) {
    const run = afterDva1[i]
    const state = run.state as { dva1?: { destinationId: string; score: number; artifactRef: string } }
    assert.equal(state.dva1?.destinationId, destinations[i].id, `run ${i} must hold ITS OWN dva1 artifact`)
    assert.equal(state.dva1?.score, destinations[i].dva1Score)
    assert.equal(state.dva1?.artifactRef, `dva1-${destinations[i].id}`)
  }
  // Every artifactRef is globally unique — a leak would collapse this set.
  assert.equal(new Set(afterDva1.map((r) => (r.state as { dva1?: { artifactRef: string } }).dva1?.artifactRef)).size, 20)

  // Approve DVA-2 for all 20 and continue — different recommendations route differently, still isolated.
  for (const d of destinations) {
    await recordJerryDecision(runStore, playbookRunId('destination_hub_lifecycle', d.id), { dva2Approved: true })
  }
  const afterDva2 = await Promise.all(destinations.map((d) => driveDestinationHub({ runStore, execStore, executors: [executor] }, d.id, { candidate: candidate(d.id, d.name) })))

  for (let i = 0; i < destinations.length; i++) {
    const run = afterDva2[i]
    const state = run.state as { dva2?: { destinationId: string; recommendation: string } }
    assert.equal(state.dva2?.destinationId, destinations[i].id)
    assert.equal(state.dva2?.recommendation, destinations[i].dva2Recommendation)
  }

  // Mixed pipeline outcomes across the 20, as required: some proceed toward DAP (GREEN), some hold for review (YELLOW/RED) — never a flat identical outcome.
  const greenCount = afterDva2.filter((r) => (r.state as { dva2?: { recommendation: string } }).dva2?.recommendation === 'GREEN').length
  const nonGreenCount = afterDva2.length - greenCount
  assert.ok(greenCount > 0 && nonGreenCount > 0)
  assert.ok(afterDva2.every((r) => r.status === 'NEEDS_JERRY'))

  // Cross-contamination attempt: resuming destination-05 must never see destination-06's state.
  const run05 = await runStore.get(playbookRunId('destination_hub_lifecycle', 'destination-05'))
  const run06 = await runStore.get(playbookRunId('destination_hub_lifecycle', 'destination-06'))
  assert.notEqual((run05!.state as { dva1?: { artifactRef: string } }).dva1?.artifactRef, (run06!.state as { dva1?: { artifactRef: string } }).dva1?.artifactRef)
})
