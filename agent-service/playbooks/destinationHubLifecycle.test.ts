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
  contentInventoryIsCommercialOnly,
  buildPartnerFriendlyReview,
  proposalViolatesRetrievedRules,
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
    recommendation: 'GREEN',
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
// DVA-1 gate — external artifact, Chief only interprets the score
// ---------------------------------------------------------------------------

test('classifyDVA1Score: retrieved thresholds — 90+ Elite, 80-89 Excellent, 65-79 Borderline, <65 Archive', () => {
  assert.equal(classifyDVA1Score(95), 'ELITE')
  assert.equal(classifyDVA1Score(80), 'EXCELLENT')
  assert.equal(classifyDVA1Score(65), 'BORDERLINE')
  assert.equal(classifyDVA1Score(64), 'ARCHIVE')
})

test('dva1RequiresJerryApproval: always true, even for an Elite score — DVA-2 never starts automatically, retrieved exact rule', () => {
  assert.equal(dva1RequiresJerryApproval(dva1({ score: 100 })), true)
})

test('evaluateDVA1Gate: Elite score proposes DVA-2 but never claims to start it', () => {
  const decision = evaluateDVA1Gate(dva1({ score: 95 }))
  assert.equal(decision.tier, 'ELITE')
  assert.equal(decision.proposeDva2, true)
  assert.match(decision.reason, /Jerry must still explicitly approve/)
})

test('evaluateDVA1Gate: Archive score does not propose DVA-2', () => {
  const decision = evaluateDVA1Gate(dva1({ score: 40 }))
  assert.equal(decision.proposeDva2, false)
})

// ---------------------------------------------------------------------------
// DVA-2 — cross-destination validation (the critical new requirement)
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
// GREEN/YELLOW/RED routing
// ---------------------------------------------------------------------------

test('routeDVA2Recommendation: GREEN -> READY, still requires Jerry for the DAP handoff', () => {
  const result = routeDVA2Recommendation(dva2({ recommendation: 'GREEN' }))
  assert.equal(result.pipelineState, 'READY')
  assert.equal(result.requiresJerry, true)
})

test('routeDVA2Recommendation: YELLOW with evidence gaps -> WAITING, research first, not Jerry yet', () => {
  const result = routeDVA2Recommendation(dva2({ recommendation: 'YELLOW', evidenceGaps: ['budget confirmation'] }))
  assert.equal(result.pipelineState, 'WAITING')
  assert.equal(result.requiresJerry, false)
})

test('routeDVA2Recommendation: YELLOW with no evidence gaps -> WAITING, needs Jerry\'s judgment', () => {
  const result = routeDVA2Recommendation(dva2({ recommendation: 'YELLOW', evidenceGaps: [] }))
  assert.equal(result.pipelineState, 'WAITING')
  assert.equal(result.requiresJerry, true)
})

test('routeDVA2Recommendation: RED with an artifact-supported disposition uses it', () => {
  const result = routeDVA2Recommendation(dva2({ recommendation: 'RED', suggestedDisposition: 'WAVE_2' }))
  assert.equal(result.pipelineState, 'WAVE_2')
})

test('routeDVA2Recommendation: RED with NO stated disposition defaults to HOLD, never auto-DECLINE — do not permanently discard', () => {
  const result = routeDVA2Recommendation(dva2({ recommendation: 'RED', suggestedDisposition: undefined }))
  assert.equal(result.pipelineState, 'HOLD')
  assert.notEqual(result.pipelineState, 'DECLINE')
})

test('routeDVA2Recommendation: RED with an explicit DECLINE disposition requires Jerry (a permanent-feeling call)', () => {
  const result = routeDVA2Recommendation(dva2({ recommendation: 'RED', suggestedDisposition: 'DECLINE' }))
  assert.equal(result.pipelineState, 'DECLINE')
  assert.equal(result.requiresJerry, true)
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

test('dapEntryConditionMet: only a GREEN DVA-2 satisfies the DAP entry condition', () => {
  assert.equal(dapEntryConditionMet(dva2({ recommendation: 'GREEN' })), true)
  assert.equal(dapEntryConditionMet(dva2({ recommendation: 'YELLOW' })), false)
  assert.equal(dapEntryConditionMet(dva2({ recommendation: 'RED' })), false)
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

test('coarseStatusForStage: D2 (DVA-1) is always NEEDS_JERRY — DVA-2 never auto-starts', () => {
  assert.equal(coarseStatusForStage('D2_DVA1'), 'NEEDS_JERRY')
})

test('coarseStatusForStage: D14/D15 (close + activation) are NEEDS_JERRY', () => {
  assert.equal(coarseStatusForStage('D14_CLOSE_AGREEMENT'), 'NEEDS_JERRY')
  assert.equal(coarseStatusForStage('D15_HUB_ACTIVATION'), 'NEEDS_JERRY')
})

test('destination hub lifecycle: every declared authority operation is registered', () => {
  assert.doesNotThrow(() => verifyAuthorityCoverage())
})
