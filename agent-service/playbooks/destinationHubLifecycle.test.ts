import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  screenDiscoveryCandidate,
  classifyDVA1Score,
  dva1RequiresJerryApproval,
  evaluateDVA1Gate,
  validateDva2Input,
  routeDVA2Recommendation,
  validateDapInput,
  dapEntryConditionMet,
  detectStaleOperationalDates,
  contentInventoryIsCommercialOnly,
  buildPartnerFriendlyReview,
  proposalViolatesRetrievedRules,
  founderYear1Price,
  founderRenewalPrice,
  deriveDestinationLoopAction,
  coarseStatusForStage,
  verifyAuthorityCoverage,
  type DiscoveryCandidate,
  type DVA1Artifact,
  type DVA2Artifact,
  type DAPArtifact,
} from './destinationHubLifecycle'

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    name: 'Test Town',
    state: 'AZ',
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

function dva1(overrides: Partial<DVA1Artifact> = {}): DVA1Artifact {
  return {
    provider: 'dva1_claude_project',
    destinationId: 'dest-a',
    destinationName: 'Destination A',
    artifactRef: 'artifact-dva1-a-1',
    executedAt: '2026-09-04T00:00:00Z',
    contentHash: 'hash-a-1',
    score: 92,
    recommendationText: 'Strong candidate.',
    currentStrategyFit: 'FITS_CURRENT_STRATEGY',
    ...overrides,
  }
}

function dva2(overrides: Partial<DVA2Artifact> = {}): DVA2Artifact {
  return {
    provider: 'dva2_claude_project',
    destinationId: 'dest-a',
    destinationName: 'Destination A',
    artifactRef: 'artifact-dva2-a-1',
    executedAt: '2026-09-04T00:00:00Z',
    contentHash: 'hash-a-2',
    worthPursuing: 'YES',
    recommendedPriority: 'HIGH_PRIORITY_CREATE_DAP',
    recommendedNextStep: 'BUILD_DAP_NOW',
    rationale: 'Strong tourism ecosystem.',
    knownRisks: [],
    consumedDva1ArtifactRef: 'artifact-dva1-a-1',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// D0 — Discovery screening (never discards, routes to WAVE_2 instead)
// ---------------------------------------------------------------------------

test('screenDiscoveryCandidate: no tourism identity -> DECLINE', () => {
  assert.equal(screenDiscoveryCandidate(candidate({ tourismIdentity: false })).pipelineState, 'DECLINE')
})

test('screenDiscoveryCandidate: high stakeholder complexity is kept in pipeline as WAVE_2, never discarded', () => {
  assert.equal(screenDiscoveryCandidate(candidate({ stakeholderComplexity: 'HIGH' })).pipelineState, 'WAVE_2')
})

test('screenDiscoveryCandidate: no accessible decision-maker -> HOLD, not DECLINE', () => {
  assert.equal(screenDiscoveryCandidate(candidate({ likelyDecisionMakerAccessible: false })).pipelineState, 'HOLD')
})

test('screenDiscoveryCandidate: a clean candidate is READY', () => {
  assert.equal(screenDiscoveryCandidate(candidate()).pipelineState, 'READY')
})

// ---------------------------------------------------------------------------
// DVA-1 gate — real ingested methodology (Phase 2G). Score thresholds are
// unchanged/confirmed; Current-Strategy Fit is the real, separate gate
// that replaces the old "always requires Jerry" paraphrase.
// ---------------------------------------------------------------------------

test('classifyDVA1Score: exact rubric thresholds (methodologies/destination/dva1/v2.md "Calculate" section) — 90+ Elite, 80-89 Excellent, 65-79 Borderline, <65 Archive', () => {
  assert.equal(classifyDVA1Score(95), 'ELITE')
  assert.equal(classifyDVA1Score(80), 'EXCELLENT')
  assert.equal(classifyDVA1Score(65), 'BORDERLINE')
  assert.equal(classifyDVA1Score(64), 'ARCHIVE')
})

test('dva1RequiresJerryApproval: FALSE for a qualified score that fits the current expansion strategy — routine progression', () => {
  assert.equal(dva1RequiresJerryApproval(dva1({ score: 95, currentStrategyFit: 'FITS_CURRENT_STRATEGY' })), false)
})

test('dva1RequiresJerryApproval: TRUE for a qualified score that is explicitly STRONG_BUT_LATER_STAGE — the real substantive gate', () => {
  assert.equal(dva1RequiresJerryApproval(dva1({ score: 95, currentStrategyFit: 'STRONG_BUT_LATER_STAGE' })), true)
})

test('dva1RequiresJerryApproval: FALSE for a qualified score with WEAK_STRATEGIC_FIT — routine archive, nothing to decide', () => {
  assert.equal(dva1RequiresJerryApproval(dva1({ score: 95, currentStrategyFit: 'WEAK_STRATEGIC_FIT' })), false)
})

test('dva1RequiresJerryApproval: FALSE below the score threshold regardless of strategy fit — routine archive', () => {
  assert.equal(dva1RequiresJerryApproval(dva1({ score: 40, currentStrategyFit: 'STRONG_BUT_LATER_STAGE' })), false)
})

test('evaluateDVA1Gate: Elite score + FITS_CURRENT_STRATEGY -> auto-advance, no Jerry', () => {
  const decision = evaluateDVA1Gate(dva1({ score: 95, currentStrategyFit: 'FITS_CURRENT_STRATEGY' }))
  assert.equal(decision.tier, 'ELITE')
  assert.equal(decision.proposeDva2, true)
  assert.equal(decision.requiresJerry, false)
  assert.match(decision.reason, /routine progression/)
})

test('evaluateDVA1Gate: Elite score + STRONG_BUT_LATER_STAGE -> holds for Jerry, does NOT advance solely on raw score', () => {
  const decision = evaluateDVA1Gate(dva1({ score: 98, currentStrategyFit: 'STRONG_BUT_LATER_STAGE' }))
  assert.equal(decision.tier, 'ELITE')
  assert.equal(decision.proposeDva2, false)
  assert.equal(decision.requiresJerry, true)
  assert.match(decision.reason, /later-stage/)
})

test('evaluateDVA1Gate: qualified score + WEAK_STRATEGIC_FIT -> archived, no Jerry', () => {
  const decision = evaluateDVA1Gate(dva1({ score: 90, currentStrategyFit: 'WEAK_STRATEGIC_FIT' }))
  assert.equal(decision.proposeDva2, false)
  assert.equal(decision.requiresJerry, false)
})

test('evaluateDVA1Gate: Archive score does not propose DVA-2, no Jerry needed', () => {
  const decision = evaluateDVA1Gate(dva1({ score: 40, currentStrategyFit: 'FITS_CURRENT_STRATEGY' }))
  assert.equal(decision.proposeDva2, false)
  assert.equal(decision.requiresJerry, false)
})

// ---------------------------------------------------------------------------
// DVA-2 — cross-destination validation (the critical requirement, unchanged)
// ---------------------------------------------------------------------------

test('validateDva2Input: valid when DVA-2 consumes the same destination\'s own DVA-1 artifact', () => {
  const result = validateDva2Input(dva1(), dva2())
  assert.equal(result.valid, true)
})

test('validateDva2Input: INVALID when destinationId differs — Destination A\'s DVA-1 must never feed Destination B\'s DVA-2', () => {
  const wrongDestDva2 = dva2({ destinationId: 'dest-b', destinationName: 'Destination B' })
  const result = validateDva2Input(dva1(), wrongDestDva2)
  assert.equal(result.valid, false)
  assert.match(result.reason, /Destination mismatch/)
})

test('validateDva2Input: INVALID when DVA-2 claims to have consumed a different DVA-1 artifact than the one on file', () => {
  const staleDva2 = dva2({ consumedDva1ArtifactRef: 'artifact-dva1-a-OLD' })
  const result = validateDva2Input(dva1(), staleDva2)
  assert.equal(result.valid, false)
  assert.match(result.reason, /different DVA-1 artifact/)
})

// ---------------------------------------------------------------------------
// DVA-2 routing — real "Recommended Next Step" vocabulary (Section 24),
// replacing the unretrieved GREEN/YELLOW/RED paraphrase.
// ---------------------------------------------------------------------------

test('routeDVA2Recommendation: BUILD_DAP_NOW -> READY, auto-advances, no Jerry (routine qualified progression)', () => {
  const result = routeDVA2Recommendation(dva2({ recommendedNextStep: 'BUILD_DAP_NOW' }))
  assert.equal(result.pipelineState, 'READY')
  assert.equal(result.requiresJerry, false)
})

test('routeDVA2Recommendation: HOLD_DAP_UNTIL_ISSUE_RESOLVED with evidence gaps -> WAITING, research first, not Jerry yet', () => {
  const result = routeDVA2Recommendation(dva2({ recommendedNextStep: 'HOLD_DAP_UNTIL_ISSUE_RESOLVED', evidenceGaps: ['confirm chamber decision-maker'] }))
  assert.equal(result.pipelineState, 'WAITING')
  assert.equal(result.requiresJerry, false)
})

test('routeDVA2Recommendation: HOLD_DAP_UNTIL_ISSUE_RESOLVED with no evidence gaps -> WAITING, needs Jerry\'s judgment', () => {
  const result = routeDVA2Recommendation(dva2({ recommendedNextStep: 'HOLD_DAP_UNTIL_ISSUE_RESOLVED', evidenceGaps: [] }))
  assert.equal(result.pipelineState, 'WAITING')
  assert.equal(result.requiresJerry, true)
})

test('routeDVA2Recommendation: STOP_PURSUIT -> HOLD (never DECLINE), routine, no Jerry — do not permanently discard', () => {
  const result = routeDVA2Recommendation(dva2({ recommendedNextStep: 'STOP_PURSUIT' }))
  assert.equal(result.pipelineState, 'HOLD')
  assert.notEqual(result.pipelineState, 'DECLINE')
  assert.equal(result.requiresJerry, false)
})

// ---------------------------------------------------------------------------
// DAP — same cross-destination validation discipline
// ---------------------------------------------------------------------------

function dap(overrides: Partial<DAPArtifact> = {}): DAPArtifact {
  return {
    provider: 'dap_claude_project',
    destinationId: 'dest-a',
    destinationName: 'Destination A',
    artifactRef: 'artifact-dap-a-1',
    executedAt: '2026-09-04T00:00:00Z',
    contentHash: 'hash-a-3',
    consumedDva2ArtifactRef: 'artifact-dva2-a-1',
    extracted: {
      recommendedChampion: null,
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
      checkoffValueProposition: null,
      recommendedEntryStrategy: null,
      relationshipSequence: [],
      recommendedOfferDirection: null,
      rightNowTask: {
        currentStage: 'Relationship Building',
        currentGoal: 'Get on the Champion\'s radar',
        highestPriorityTask: 'Send initial low-key outreach email',
        targetDate: '2026-09-11',
        estimatedTime: '30 minutes',
        expectedResult: 'A reply or a scheduled call',
        whyItMatters: 'Nothing else in the plan can proceed without a first response.',
      },
    },
    ...overrides,
  }
}

test('validateDapInput: valid when DAP consumes the same destination\'s own DVA-2 artifact', () => {
  assert.equal(validateDapInput(dva2(), dap()).valid, true)
})

test('validateDapInput: INVALID when destinationId differs — DAP must belong to the same destination', () => {
  const wrongDap = dap({ destinationId: 'dest-b', destinationName: 'Destination B' })
  const result = validateDapInput(dva2(), wrongDap)
  assert.equal(result.valid, false)
})

test('validateDapInput: INVALID when DAP claims a stale/wrong DVA-2 artifact', () => {
  const staleDap = dap({ consumedDva2ArtifactRef: 'artifact-dva2-a-OLD' })
  const result = validateDapInput(dva2(), staleDap)
  assert.equal(result.valid, false)
})

// ---------------------------------------------------------------------------
// detectStaleOperationalDates — production-integrity pass. A real live
// proof caught the model proposing plan dates anchored to a stale
// internal calendar (mid-2024) during an execution actually running in
// 2026.
// ---------------------------------------------------------------------------

test('detectStaleOperationalDates: flags a rightNowTask.targetDate proposed by the model during a 2024-anchored hallucination while the run is actually in 2026', () => {
  const staleDap = dap({ extracted: { ...dap().extracted, rightNowTask: { ...dap().extracted.rightNowTask, targetDate: '2024-06-11' } } })
  const result = detectStaleOperationalDates(staleDap, '2026-09-08T12:00:00.000Z')
  assert.equal(result.stale, true)
  assert.ok(result.staleDates.includes('2024-06-11'))
  assert.match(result.reason ?? '', /2024-06-11/)
})

test('detectStaleOperationalDates: flags stale leading dates inside relationshipSequence entries too, not just rightNowTask', () => {
  const staleDap = dap({ extracted: { ...dap().extracted, relationshipSequence: ['2024-06-11: warm intro', '2024-06-25: follow up'] } })
  const result = detectStaleOperationalDates(staleDap, '2026-09-08T12:00:00.000Z')
  assert.equal(result.stale, true)
  assert.deepEqual(result.staleDates, ['2024-06-11', '2024-06-25'])
})

test('detectStaleOperationalDates: does NOT flag a targetDate that is genuinely near the actual runtime date', () => {
  const freshDap = dap({ extracted: { ...dap().extracted, rightNowTask: { ...dap().extracted.rightNowTask, targetDate: '2026-09-15' } } })
  const result = detectStaleOperationalDates(freshDap, '2026-09-08T12:00:00.000Z')
  assert.equal(result.stale, false)
  assert.deepEqual(result.staleDates, [])
})

test('detectStaleOperationalDates: a date just a few days in the past is NOT treated as materially stale (avoids false positives near a stage boundary)', () => {
  const nearDap = dap({ extracted: { ...dap().extracted, rightNowTask: { ...dap().extracted.rightNowTask, targetDate: '2026-09-05' } } })
  const result = detectStaleOperationalDates(nearDap, '2026-09-08T12:00:00.000Z')
  assert.equal(result.stale, false)
})

test('dapEntryConditionMet: only Recommended Next Step = Build DAP now satisfies the DAP entry condition', () => {
  assert.equal(dapEntryConditionMet(dva2({ recommendedNextStep: 'BUILD_DAP_NOW' })), true)
  assert.equal(dapEntryConditionMet(dva2({ recommendedNextStep: 'HOLD_DAP_UNTIL_ISSUE_RESOLVED' })), false)
  assert.equal(dapEntryConditionMet(dva2({ recommendedNextStep: 'STOP_PURSUIT' })), false)
})

test('DAP extracted fields require rightNowTask (Section 21 "RIGHT NOW") — the single next work-session task', () => {
  const artifact = dap()
  assert.equal(artifact.extracted.rightNowTask.currentGoal, 'Get on the Champion\'s radar')
  assert.ok(artifact.extracted.rightNowTask.highestPriorityTask.length > 0)
})

// ---------------------------------------------------------------------------
// Founder pricing model (DVA-2 v2.md Section 17 / DAP v2.md Section 2)
// ---------------------------------------------------------------------------

test('founderYear1Price: 35% below the standard Champion price', () => {
  assert.equal(founderYear1Price(8000), 5200)
})

test('founderRenewalPrice: 25% below the CURRENT standard price — a percentage, not a frozen dollar amount', () => {
  assert.equal(founderRenewalPrice(8000), 6000)
  // If standard pricing later rises, the renewal discount follows the NEW standard, not the original Year 1 price.
  assert.equal(founderRenewalPrice(10000), 7500)
})

// ---------------------------------------------------------------------------
// D9 — content build must not be commercial-only
// ---------------------------------------------------------------------------

test('contentInventoryIsCommercialOnly: true when only businesses are represented', () => {
  assert.equal(contentInventoryIsCommercialOnly({ places: 0, businesses: 12, trails: 0, parks: 0, photoOps: 0, landmarks: 0, uniqueExperiences: 0 }), true)
})

test('contentInventoryIsCommercialOnly: false once any non-commercial content exists', () => {
  assert.equal(contentInventoryIsCommercialOnly({ places: 2, businesses: 12, trails: 1, parks: 0, photoOps: 0, landmarks: 0, uniqueExperiences: 0 }), false)
})

// ---------------------------------------------------------------------------
// D10 — partner-friendly review
// ---------------------------------------------------------------------------

test('buildPartnerFriendlyReview: strips down to name/include/verifiedBy/comment only', () => {
  const internal = [{ name: 'Winery A', include: true, verifiedBy: 'Jerry', comment: 'strong fit' }]
  assert.deepEqual(Object.keys(buildPartnerFriendlyReview(internal)[0]).sort(), ['comment', 'include', 'name', 'verifiedBy'])
})

// ---------------------------------------------------------------------------
// D12 — proposal rules (retrieved, exact)
// ---------------------------------------------------------------------------

test('proposalViolatesRetrievedRules: flags cancellation-consequence and "already live" language', () => {
  assert.ok(proposalViolatesRetrievedRules('If the Chamber does not renew, the lists disappear.').length > 0)
  assert.ok(proposalViolatesRetrievedRules('already live and waiting').length > 0)
})

test('proposalViolatesRetrievedRules: clean proposal copy has zero violations', () => {
  assert.deepEqual(proposalViolatesRetrievedRules('Founding Destination Champion pricing is $5,200 for the first 12 months.'), [])
})

// ---------------------------------------------------------------------------
// Evidence gap -> research loop, stage->status, authority
// ---------------------------------------------------------------------------

test('deriveDestinationLoopAction: missing evidence -> RESEARCH_NEEDED, never guessed forward', () => {
  assert.equal(deriveDestinationLoopAction('D3_DVA2', ['likelyChampionOrBuyer']).action, 'RESEARCH_NEEDED')
})

test('deriveDestinationLoopAction: complete evidence -> PROCEED', () => {
  assert.equal(deriveDestinationLoopAction('D3_DVA2', []).action, 'PROCEED')
})

test('coarseStatusForStage: D2 (DVA-1) falls through to IN_PROGRESS — its real status now depends on the received artifact (evaluateDVA1Gate), not the stage name alone', () => {
  assert.equal(coarseStatusForStage('D2_DVA1'), 'IN_PROGRESS')
})

test('coarseStatusForStage: D14/D15 (close + activation) are NEEDS_JERRY', () => {
  assert.equal(coarseStatusForStage('D14_CLOSE_AGREEMENT'), 'NEEDS_JERRY')
  assert.equal(coarseStatusForStage('D15_HUB_ACTIVATION'), 'NEEDS_JERRY')
})

test('destination hub lifecycle: every declared authority operation is registered', () => {
  assert.doesNotThrow(() => verifyAuthorityCoverage())
})
