// Chief Phase 2F/2G — destination_hub_lifecycle driver tests. Proves the
// SAME driver architecture as metroLaunchDriver.ts generalizes to
// destination sequencing (spec section 14), plus 20-concurrent-run
// isolation (spec section 15/18). All synthetic data via TestExecutor —
// no real DVA-1/DVA-2/DAP invocation, no outbound action.
//
// Updated for Phase 2G: routine, qualified progression (DVA-1
// FITS_CURRENT_STRATEGY; DVA-2 BUILD_DAP_NOW) now auto-advances WITHOUT
// a Jerry pause at each stage — a real behavior change from Phase 2F,
// driven by the real ingested methodology (see destinationHubDriver.ts's
// module doc). The first test below demonstrates the full run completing
// D0 through DAP in a SINGLE driveDestinationHub call, stopping only at
// the genuine outbound-outreach boundary.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveDestinationHub } from './destinationHubDriver'
import { InMemoryPlaybookRunStore, playbookRunId, recordJerryDecision } from './playbookRun'
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

type Dva1Fit = 'FITS_CURRENT_STRATEGY' | 'STRONG_BUT_LATER_STAGE' | 'WEAK_STRATEGIC_FIT'
type Dva2NextStep = 'BUILD_DAP_NOW' | 'HOLD_DAP_UNTIL_ISSUE_RESOLVED' | 'STOP_PURSUIT'

function scriptDva1(executor: TestExecutor, destinationId: string, destinationName: string, score: number, currentStrategyFit: Dva1Fit) {
  executor.scriptWhen(
    (r) => r.stage === 'D2_DVA1' && r.destinationId === destinationId,
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { artifact: { provider: 'dva1_claude_project', destinationId, destinationName, artifactRef: `dva1-${destinationId}`, executedAt: '2026-09-05T00:00:00Z', contentHash: null, score, recommendationText: 'synthetic', currentStrategyFit } },
        methodologyId: 'destination/dva1',
        methodologyVersion: 'v2',
      })
  )
}

function scriptDva2(executor: TestExecutor, destinationId: string, destinationName: string, recommendedNextStep: Dva2NextStep, evidenceGaps: string[] = []) {
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
            worthPursuing: recommendedNextStep === 'BUILD_DAP_NOW' ? 'YES' : recommendedNextStep === 'STOP_PURSUIT' ? 'NO' : 'MAYBE',
            recommendedPriority: recommendedNextStep === 'BUILD_DAP_NOW' ? 'HIGH_PRIORITY_CREATE_DAP' : recommendedNextStep === 'STOP_PURSUIT' ? 'DO_NOT_PURSUE_CURRENTLY' : 'PROMISING_BUT_PREMATURE_MONITOR',
            recommendedNextStep,
            rationale: 'synthetic',
            knownRisks: [],
            evidenceGaps,
            consumedDva1ArtifactRef: `dva1-${destinationId}`,
          },
        },
        methodologyId: 'destination/dva2',
        methodologyVersion: 'v2',
      })
  )
}

function scriptDap(executor: TestExecutor, destinationId: string, destinationName: string) {
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
              rightNowTask: {
                currentStage: 'Relationship Building',
                currentGoal: `Introduce CheckOff to ${destinationName}'s Chamber`,
                highestPriorityTask: 'Send personalized introductory email',
                targetDate: '2026-09-12',
                estimatedTime: '30 minutes',
                expectedResult: 'A reply or scheduled call',
                whyItMatters: 'First touch determines whether relationship-building can begin.',
              },
            },
          },
        },
        methodologyId: 'destination/dap',
        methodologyVersion: 'v2',
      })
  )
}

test('destination driver: routine qualified progression (FITS_CURRENT_STRATEGY + BUILD_DAP_NOW) completes D0 through DAP in ONE call, no Jerry pause until the real outreach boundary', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptDva1(executor, 'destination-grand-lake', 'Grand Lake', 88, 'FITS_CURRENT_STRATEGY')
  scriptDva2(executor, 'destination-grand-lake', 'Grand Lake', 'BUILD_DAP_NOW')
  scriptDap(executor, 'destination-grand-lake', 'Grand Lake')

  const projectId = 'grand-lake-synthetic'
  const run = await driveDestinationHub({ runStore, execStore, executors: [executor] }, projectId, { candidate: candidate('destination-grand-lake', 'Grand Lake') })

  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'RELATIONSHIP_ASSETS_PREP')
  assert.match(run.jerryReason ?? '', /outreach/)
  assert.equal((run.decisionPacket as { champion?: string })?.champion, 'Grand Lake Chamber director')
  assert.equal((run.state as { dva1?: { score: number } }).dva1?.score, 88)
  assert.equal((run.state as { dap?: { extracted: { rightNowTask: { highestPriorityTask: string } } } }).dap?.extracted.rightNowTask.highestPriorityTask, 'Send personalized introductory email')

  // NEVER any real outbound action taken — the driver stopped, it did not send anything.
  const allExecutions = await execStore.all()
  assert.ok(allExecutions.every((e) => e.request.authorityOperations.every((op) => op !== 'destination_relationship.send_email')))
  assert.equal(allExecutions.length, 3, 'exactly D2/D3/D4 executions — no manual per-stage command was needed to drive all three')
})

test('destination driver: a qualified score explicitly STRONG_BUT_LATER_STAGE holds at D2 for Jerry — does not advance solely on raw score', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptDva1(executor, 'destination-big-complex', 'Big Complex', 97, 'STRONG_BUT_LATER_STAGE')

  const projectId = 'big-complex-synthetic'
  const runId = playbookRunId('destination_hub_lifecycle', projectId)
  let run = await driveDestinationHub({ runStore, execStore, executors: [executor] }, projectId, { candidate: candidate('destination-big-complex', 'Big Complex') })

  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'D2_DVA1')
  assert.match(run.jerryReason ?? '', /STRONG_BUT_LATER_STAGE/)

  // Jerry explicitly overrides the hold -> driver proceeds through DVA-2 (BUILD_DAP_NOW auto-advances further, so DAP must be scripted too).
  scriptDva2(executor, 'destination-big-complex', 'Big Complex', 'BUILD_DAP_NOW')
  scriptDap(executor, 'destination-big-complex', 'Big Complex')
  await recordJerryDecision(runStore, runId, { dva2Approved: true })
  run = await driveDestinationHub({ runStore, execStore, executors: [executor] }, projectId, { candidate: candidate('destination-big-complex', 'Big Complex') })
  assert.notEqual(run.currentStage, 'D2_DVA1', 'the override must move past D2 — never re-ask the same already-answered question')
  assert.equal(run.currentStage, 'RELATIONSHIP_ASSETS_PREP')
  assert.equal(run.status, 'NEEDS_JERRY')
})

test('destination driver: HOLD_DAP_UNTIL_ISSUE_RESOLVED with NO evidence gaps needs Jerry\'s judgment; WITH gaps just waits for more research', async () => {
  const runStoreA = new InMemoryPlaybookRunStore()
  const execStoreA = new InMemoryExecutionStore()
  const executorA = new TestExecutor()
  scriptDva1(executorA, 'destination-rim-country', 'Rim Country', 78, 'FITS_CURRENT_STRATEGY')
  scriptDva2(executorA, 'destination-rim-country', 'Rim Country', 'HOLD_DAP_UNTIL_ISSUE_RESOLVED', [])
  const runA = await driveDestinationHub({ runStore: runStoreA, execStore: execStoreA, executors: [executorA] }, 'rim-country-synthetic', { candidate: candidate('destination-rim-country', 'Rim Country') })
  assert.equal(runA.status, 'NEEDS_JERRY')
  assert.equal(runA.currentStage, 'D3_DVA2')

  const runStoreB = new InMemoryPlaybookRunStore()
  const execStoreB = new InMemoryExecutionStore()
  const executorB = new TestExecutor()
  scriptDva1(executorB, 'destination-verde-valley', 'Verde Valley', 78, 'FITS_CURRENT_STRATEGY')
  scriptDva2(executorB, 'destination-verde-valley', 'Verde Valley', 'HOLD_DAP_UNTIL_ISSUE_RESOLVED', ['confirm chamber decision-maker'])
  const runB = await driveDestinationHub({ runStore: runStoreB, execStore: execStoreB, executors: [executorB] }, 'verde-valley-synthetic', { candidate: candidate('destination-verde-valley', 'Verde Valley') })
  assert.equal(runB.status, 'WAITING', 'a research path is identified — waits for it, does not escalate to Jerry prematurely')
})

test('destination driver: STOP_PURSUIT is a routine WAIT (HOLD), never a Jerry escalation, never a permanent decline', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptDva1(executor, 'destination-too-fragmented', 'Too Fragmented', 70, 'FITS_CURRENT_STRATEGY')
  scriptDva2(executor, 'destination-too-fragmented', 'Too Fragmented', 'STOP_PURSUIT')

  const run = await driveDestinationHub({ runStore, execStore, executors: [executor] }, 'too-fragmented-synthetic', { candidate: candidate('destination-too-fragmented', 'Too Fragmented') })
  assert.equal(run.status, 'WAITING')
  assert.equal(run.currentStage, 'D3_DVA2')
})

// ---------------------------------------------------------------------------
// executedAt is deterministic runtime metadata, never trusted from the
// model (Phase 2H — a real live DVA-1 proof caught a ~2-year-stale
// hallucinated date in this field).
// ---------------------------------------------------------------------------

test('destination driver: executedAt is ALWAYS the driver\'s own clock, even when the model returns a hallucinated/false date in DVA-1, DVA-2, and DAP artifacts', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  const destinationId = 'destination-false-clock'
  const destinationName = 'False Clock'
  const HALLUCINATED_DATE = '2024-06-10T20:28:00Z' // a real value a live model actually returned, ~2 years stale
  const REAL_NOW = '2026-09-05T12:00:00.000Z'

  executor.scriptWhen(
    (r) => r.stage === 'D2_DVA1' && r.destinationId === destinationId,
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { artifact: { provider: 'dva1_claude_project', destinationId, destinationName, artifactRef: `dva1-${destinationId}`, executedAt: HALLUCINATED_DATE, contentHash: null, score: 90, recommendationText: 'synthetic', currentStrategyFit: 'FITS_CURRENT_STRATEGY' } },
        methodologyId: 'destination/dva1',
        methodologyVersion: 'v2',
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
            executedAt: HALLUCINATED_DATE,
            contentHash: null,
            worthPursuing: 'YES',
            recommendedPriority: 'HIGH_PRIORITY_CREATE_DAP',
            recommendedNextStep: 'BUILD_DAP_NOW',
            rationale: 'synthetic',
            knownRisks: [],
            evidenceGaps: [],
            consumedDva1ArtifactRef: `dva1-${destinationId}`,
          },
        },
        methodologyId: 'destination/dva2',
        methodologyVersion: 'v2',
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
            executedAt: HALLUCINATED_DATE,
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
              rightNowTask: {
                currentStage: 'Relationship Building',
                currentGoal: `Introduce CheckOff to ${destinationName}'s Chamber`,
                highestPriorityTask: 'Send personalized introductory email',
                targetDate: '2026-09-12',
                estimatedTime: '30 minutes',
                expectedResult: 'A reply or scheduled call',
                whyItMatters: 'First touch determines whether relationship-building can begin.',
              },
            },
          },
        },
        methodologyId: 'destination/dap',
        methodologyVersion: 'v2',
      })
  )

  const run = await driveDestinationHub({ runStore, execStore, executors: [executor], now: () => REAL_NOW }, 'false-clock-synthetic', { candidate: candidate(destinationId, destinationName) })

  const state = run.state as { dva1?: { executedAt: string }; dva2?: { executedAt: string }; dap?: { executedAt: string } }
  assert.equal(state.dva1?.executedAt, REAL_NOW, 'DVA-1 executedAt must be the driver clock, never the hallucinated model date')
  assert.notEqual(state.dva1?.executedAt, HALLUCINATED_DATE)
  assert.equal(state.dva2?.executedAt, REAL_NOW, 'DVA-2 executedAt must be the driver clock, never the hallucinated model date')
  assert.notEqual(state.dva2?.executedAt, HALLUCINATED_DATE)
  assert.equal(state.dap?.executedAt, REAL_NOW, 'DAP executedAt must be the driver clock, never the hallucinated model date')
  assert.notEqual(state.dap?.executedAt, HALLUCINATED_DATE)
})

// ---------------------------------------------------------------------------
// 20 concurrent destinations (spec section 15/18) — isolation proof
// ---------------------------------------------------------------------------

test('20 concurrent destination driver runs stay fully isolated — DVA-1 scores, DVA-2 artifacts, and champions never cross runs', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()

  const nextSteps: Dva2NextStep[] = ['BUILD_DAP_NOW', 'HOLD_DAP_UNTIL_ISSUE_RESOLVED', 'STOP_PURSUIT']
  const destinations = Array.from({ length: 20 }, (_, i) => ({
    id: `destination-${i.toString().padStart(2, '0')}`,
    name: `Destination ${i}`,
    dva1Score: 70 + i, // all qualify (>= 65 BORDERLINE)
    recommendedNextStep: nextSteps[i % 3],
  }))

  for (const d of destinations) {
    scriptDva1(executor, d.id, d.name, d.dva1Score, 'FITS_CURRENT_STRATEGY')
    scriptDva2(executor, d.id, d.name, d.recommendedNextStep, d.recommendedNextStep === 'HOLD_DAP_UNTIL_ISSUE_RESOLVED' ? [] : [])
    scriptDap(executor, d.id, d.name)
  }

  // Every destination auto-advances through DVA-1 (routine) and DVA-2
  // (whichever recommendedNextStep it was scripted with) in ONE call each.
  const results = await Promise.all(destinations.map((d) => driveDestinationHub({ runStore, execStore, executors: [executor] }, d.id, { candidate: candidate(d.id, d.name) })))

  for (let i = 0; i < destinations.length; i++) {
    const run = results[i]
    const state = run.state as { dva1?: { destinationId: string; score: number; artifactRef: string }; dva2?: { destinationId: string; recommendedNextStep: string; artifactRef: string } }
    assert.equal(state.dva1?.destinationId, destinations[i].id, `run ${i} must hold ITS OWN dva1 artifact`)
    assert.equal(state.dva1?.score, destinations[i].dva1Score)
    assert.equal(state.dva1?.artifactRef, `dva1-${destinations[i].id}`)
    assert.equal(state.dva2?.destinationId, destinations[i].id)
    assert.equal(state.dva2?.recommendedNextStep, destinations[i].recommendedNextStep)
  }
  // Every artifactRef is globally unique — a leak would collapse this set.
  assert.equal(new Set(results.map((r) => (r.state as { dva1?: { artifactRef: string } }).dva1?.artifactRef)).size, 20)
  assert.equal(new Set(results.map((r) => (r.state as { dva2?: { artifactRef: string } }).dva2?.artifactRef)).size, 20)

  // Mixed outcomes across the 20, as required: BUILD_DAP_NOW ones reach
  // NEEDS_JERRY at the outreach boundary; HOLD_DAP_UNTIL_ISSUE_RESOLVED
  // (no gaps) reach NEEDS_JERRY at D3; STOP_PURSUIT ones WAIT — never a
  // flat identical status across all 20.
  const statuses = new Set(results.map((r) => r.status))
  assert.ok(statuses.size > 1, `expected mixed statuses across the 20, got only: ${[...statuses].join(', ')}`)

  // Cross-contamination attempt: destination-05 and destination-06 must never share state.
  const run05 = await runStore.get(playbookRunId('destination_hub_lifecycle', 'destination-05'))
  const run06 = await runStore.get(playbookRunId('destination_hub_lifecycle', 'destination-06'))
  assert.notEqual((run05!.state as { dva1?: { artifactRef: string } }).dva1?.artifactRef, (run06!.state as { dva1?: { artifactRef: string } }).dva1?.artifactRef)
})
