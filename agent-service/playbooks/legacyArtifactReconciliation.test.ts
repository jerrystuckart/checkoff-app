import { test } from 'node:test'
import assert from 'node:assert/strict'
import { determineCanonicalStage, validateLegacyArtifactChain, checkDapStaleness } from './legacyArtifactReconciliation'
import type { DVA1Artifact, DVA2Artifact, DAPArtifact } from './destinationHubLifecycle'

function dva1(overrides: Partial<DVA1Artifact> = {}): DVA1Artifact {
  return { provider: 'dva1_claude_project', destinationId: 'destination-x', destinationName: 'X', artifactRef: 'dva1-x', executedAt: '2026-08-01T00:00:00Z', contentHash: 'h1', score: 88, recommendationText: 'Good candidate', currentStrategyFit: 'FITS_CURRENT_STRATEGY', ...overrides }
}

function dva2(overrides: Partial<DVA2Artifact> = {}): DVA2Artifact {
  return { provider: 'dva2_claude_project', destinationId: 'destination-x', destinationName: 'X', artifactRef: 'dva2-x', executedAt: '2026-08-02T00:00:00Z', contentHash: 'h2', worthPursuing: 'YES', recommendedPriority: 'VIABLE_CREATE_DAP_WHEN_CAPACITY_ALLOWS', recommendedNextStep: 'BUILD_DAP_NOW', rationale: 'Solid', knownRisks: [], consumedDva1ArtifactRef: 'dva1-x', ...overrides }
}

function dap(overrides: Partial<DAPArtifact> = {}): DAPArtifact {
  return {
    provider: 'dap_claude_project',
    destinationId: 'destination-x',
    destinationName: 'X',
    artifactRef: 'dap-x',
    executedAt: '2026-08-03T00:00:00Z',
    contentHash: 'h3',
    consumedDva2ArtifactRef: 'dva2-x',
    extracted: {
      recommendedChampion: 'Chamber',
      secondaryChampions: [],
      decisionMakers: [],
      stakeholderOrganizations: [],
      fundingBudgetClues: [],
      likelyBuyer: null,
      estimatedSalesDifficulty: 'MEDIUM',
      timingConsiderations: [],
      politicalStakeholderComplexity: 'LOW',
      objectionsHurdles: [],
      destinationPainPoints: [],
      checkoffValueProposition: null,
      recommendedEntryStrategy: null,
      relationshipSequence: ['2026-08-18: send first touch'],
      recommendedOfferDirection: null,
      rightNowTask: { currentStage: 'Relationship Building', currentGoal: 'Warm intro', highestPriorityTask: 'Send email', targetDate: '2026-08-18', estimatedTime: '30 min', expectedResult: 'Door opened', whyItMatters: 'Unlocks the sequence' },
    },
    ...overrides,
  }
}

test('determineCanonicalStage: no artifacts at all -> NO_ARTIFACTS, next missing DVA1', () => {
  const r = determineCanonicalStage({})
  assert.equal(r.canonicalStage, 'NO_ARTIFACTS')
  assert.equal(r.nextMissingStage, 'DVA1')
  assert.equal(r.sufficientForRelationshipReadiness, false)
})

test('determineCanonicalStage: DVA-1 only, qualifying + fits strategy -> DVA1_COMPLETE, next DVA2', () => {
  const r = determineCanonicalStage({ dva1: dva1() })
  assert.equal(r.canonicalStage, 'DVA1_COMPLETE')
  assert.equal(r.nextMissingStage, 'DVA2')
})

test('determineCanonicalStage: DVA-1 only, WEAK_STRATEGIC_FIT -> DVA1_COMPLETE, no next stage (archived)', () => {
  const r = determineCanonicalStage({ dva1: dva1({ currentStrategyFit: 'WEAK_STRATEGIC_FIT' }) })
  assert.equal(r.canonicalStage, 'DVA1_COMPLETE')
  assert.equal(r.nextMissingStage, null)
})

test('determineCanonicalStage: DVA-2 with BUILD_DAP_NOW -> DVA2_COMPLETE, next DAP (Buena Vista shape)', () => {
  const r = determineCanonicalStage({ dva1: dva1(), dva2: dva2() })
  assert.equal(r.canonicalStage, 'DVA2_COMPLETE')
  assert.equal(r.nextMissingStage, 'DAP')
  assert.equal(r.sufficientForRelationshipReadiness, false)
})

test('determineCanonicalStage: DVA-2 with STOP_PURSUIT -> DVA2_COMPLETE, no next stage, never auto-runs DAP', () => {
  const r = determineCanonicalStage({ dva1: dva1(), dva2: dva2({ recommendedNextStep: 'STOP_PURSUIT' }) })
  assert.equal(r.canonicalStage, 'DVA2_COMPLETE')
  assert.equal(r.nextMissingStage, null)
})

test('determineCanonicalStage: DAP present -> DAP_COMPLETE, sufficient for relationship readiness, no next methodology stage', () => {
  const r = determineCanonicalStage({ dva1: dva1(), dva2: dva2(), dap: dap() })
  assert.equal(r.canonicalStage, 'DAP_COMPLETE')
  assert.equal(r.nextMissingStage, null)
  assert.equal(r.sufficientForRelationshipReadiness, true)
})

test('determineCanonicalStage: a DAP that exists despite its own DVA-2 recommending HOLD is still DAP_COMPLETE (Grand Lake shape) — the mid-stream-verification case', () => {
  const r = determineCanonicalStage({ dva1: dva1(), dva2: dva2({ recommendedNextStep: 'HOLD_DAP_UNTIL_ISSUE_RESOLVED' }), dap: dap() })
  assert.equal(r.canonicalStage, 'DAP_COMPLETE')
  assert.equal(r.sufficientForRelationshipReadiness, true)
  assert.match(r.reason, /mid-stream verification|superseded/)
})

test('validateLegacyArtifactChain: a clean, fully-linked chain has zero issues', () => {
  const issues = validateLegacyArtifactChain({ dva1: dva1(), dva2: dva2(), dap: dap() })
  assert.deepEqual(issues, [])
})

test('validateLegacyArtifactChain: DAP with no DVA-2 supplied is flagged as a WARNING gap, never silently accepted as a full chain', () => {
  const issues = validateLegacyArtifactChain({ dap: dap() })
  assert.equal(issues.some((i) => i.severity === 'WARNING' && /no independently supplied DVA-2/.test(i.message)), true)
})

test('validateLegacyArtifactChain: a DVA-2 that claims to consume a DIFFERENT destination\'s DVA-1 is caught, never silently accepted', () => {
  const issues = validateLegacyArtifactChain({ dva1: dva1(), dva2: dva2({ consumedDva1ArtifactRef: 'dva1-someone-else' }) })
  assert.equal(issues.some((i) => /Destination mismatch|different DVA-1/.test(i.message)), true)
})

test('validateLegacyArtifactChain: DAP existing despite DVA-2 HOLD is flagged as INFO, not silently hidden', () => {
  const issues = validateLegacyArtifactChain({ dva1: dva1(), dva2: dva2({ recommendedNextStep: 'HOLD_DAP_UNTIL_ISSUE_RESOLVED' }), dap: dap() })
  assert.equal(issues.some((i) => i.severity === 'INFO' && /HOLD_DAP_UNTIL_ISSUE_RESOLVED/.test(i.message)), true)
})

test('checkDapStaleness: a DAP whose target date has already passed relative to "now" is flagged stale', () => {
  const result = checkDapStaleness(dap(), '2026-09-05T00:00:00Z')
  assert.equal(result.stale, true)
  assert.ok(result.staleDates.includes('2026-08-18'))
})

test('checkDapStaleness: a DAP whose dates are still in the future is not stale', () => {
  const result = checkDapStaleness(dap(), '2026-08-10T00:00:00Z')
  assert.equal(result.stale, false)
})
