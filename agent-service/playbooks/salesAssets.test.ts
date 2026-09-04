import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOnePagerMarkdown, buildPitchDeckOutline, assetLevelReadyToGenerate } from './salesAssets'
import type { DAPArtifact, DVA1Artifact, DVA2Artifact } from './destinationHubLifecycle'

function dap(overrides: Partial<DAPArtifact['extracted']> = {}): DAPArtifact {
  return {
    provider: 'dap_claude_project',
    destinationId: 'destination-hood-river-or',
    destinationName: 'Hood River, OR',
    artifactRef: 'dap-hood-river-or-1',
    executedAt: '2026-09-08T00:00:00Z',
    contentHash: null,
    consumedDva2ArtifactRef: 'dva2-hood-river-or-1',
    extracted: {
      recommendedChampion: 'Hood River County Chamber of Commerce',
      secondaryChampions: [],
      decisionMakers: [],
      stakeholderOrganizations: [],
      fundingBudgetClues: ['Chamber fiscal year starts July 1'],
      likelyBuyer: 'Chamber CEO',
      estimatedSalesDifficulty: 'MEDIUM',
      timingConsiderations: ['Peak tourism season is June-September'],
      politicalStakeholderComplexity: 'MEDIUM',
      objectionsHurdles: ['App fatigue'],
      destinationPainPoints: ['Visitors miss experiences beyond the riverfront'],
      checkoffValueProposition: 'CheckOff surfaces the hidden layer of Hood River experiences.',
      recommendedEntryStrategy: 'Warm intro to the Chamber CEO.',
      relationshipSequence: [],
      recommendedOfferDirection: 'Standard Champion: $22,000/yr; founder Y1: $14,300.',
      rightNowTask: { currentStage: 'Relationship Building', currentGoal: 'g', highestPriorityTask: 't', targetDate: '2026-09-15', estimatedTime: '1 hour', expectedResult: 'r', whyItMatters: 'w' },
      ...overrides,
    },
  }
}

function dva1(): DVA1Artifact {
  return {
    provider: 'dva1_claude_project',
    destinationId: 'destination-hood-river-or',
    destinationName: 'Hood River, OR',
    artifactRef: 'dva1-hood-river-or-1',
    executedAt: '2026-09-08T00:00:00Z',
    contentHash: null,
    score: 92,
    recommendationText: '🟢 Elite Candidate',
    currentStrategyFit: 'FITS_CURRENT_STRATEGY',
  }
}

function dva2(): DVA2Artifact {
  return {
    provider: 'dva2_claude_project',
    destinationId: 'destination-hood-river-or',
    destinationName: 'Hood River, OR',
    artifactRef: 'dva2-hood-river-or-1',
    executedAt: '2026-09-08T00:00:00Z',
    contentHash: null,
    worthPursuing: 'YES',
    recommendedPriority: 'HIGH_PRIORITY_CREATE_DAP',
    recommendedNextStep: 'BUILD_DAP_NOW',
    rationale: 'Strong visitor economy and engaged Chamber leadership.',
    knownRisks: [],
    evidenceGaps: [],
    consumedDva1ArtifactRef: 'dva1-hood-river-or-1',
  }
}

test('buildOnePagerMarkdown: includes the real destination name, value proposition, and pain points', () => {
  const md = buildOnePagerMarkdown({ dva1: dva1(), dap: dap(), includePricing: false })
  assert.match(md, /Hood River, OR/)
  assert.match(md, /CheckOff surfaces the hidden layer/)
  assert.match(md, /miss experiences beyond the riverfront/)
})

test('buildOnePagerMarkdown: NEVER includes pricing when includePricing is false, even though the DAP has it on file', () => {
  const md = buildOnePagerMarkdown({ dva1: dva1(), dap: dap(), includePricing: false })
  assert.doesNotMatch(md, /\$22,000/)
})

test('buildOnePagerMarkdown: includes pricing ONLY when the caller explicitly opts in', () => {
  const md = buildOnePagerMarkdown({ dva1: dva1(), dap: dap(), includePricing: true })
  assert.match(md, /\$22,000/)
})

test('buildPitchDeckOutline: covers every required section — their destination, visitor challenges, CheckOff role, hub vision, participation/activation, opportunity, next step', () => {
  const sections = buildPitchDeckOutline({ dva1: dva1(), dva2: dva2(), dap: dap(), relationshipHistorySummary: 'Two prior emails, one call scheduled.', approvedOffer: null })
  const titles = sections.map((s) => s.title.toLowerCase())
  assert.ok(titles.some((t) => t.includes('why this destination')))
  assert.ok(titles.some((t) => t.includes('missing today')))
  assert.ok(titles.some((t) => t.includes('role')))
  assert.ok(titles.some((t) => t.includes('hub')))
  assert.ok(titles.some((t) => t.includes('participation')))
  assert.ok(titles.some((t) => t.includes('opportunity')))
  assert.ok(titles.some((t) => t.includes('next step')))
})

test('buildPitchDeckOutline: has NO investment/pricing section when no offer has been approved', () => {
  const sections = buildPitchDeckOutline({ dva1: dva1(), dva2: dva2(), dap: dap(), relationshipHistorySummary: '', approvedOffer: null })
  assert.ok(!sections.some((s) => s.title.toLowerCase().includes('investment')))
})

test('buildPitchDeckOutline: includes pricing ONLY when Jerry has explicitly approved an offer, and uses the approved numbers, not the DAP\'s raw suggestion', () => {
  const sections = buildPitchDeckOutline({ dva1: dva1(), dva2: dva2(), dap: dap(), relationshipHistorySummary: '', approvedOffer: { championPriceUsd: 20000, founderPriceUsd: 13000 } })
  const investment = sections.find((s) => s.title.toLowerCase().includes('investment'))
  assert.ok(investment)
  assert.match(investment!.content, /\$20,000/)
  assert.match(investment!.content, /\$13,000/)
})

test('assetLevelReadyToGenerate: LEVEL_3 pitch deck requires a qualified DAP; every lower level is always ready', () => {
  assert.equal(assetLevelReadyToGenerate('LEVEL_3_PITCH_DECK', false), false)
  assert.equal(assetLevelReadyToGenerate('LEVEL_3_PITCH_DECK', true), true)
  assert.equal(assetLevelReadyToGenerate('LEVEL_0_OUTREACH_MESSAGE', false), true)
  assert.equal(assetLevelReadyToGenerate('LEVEL_1_ONE_PAGER', false), true)
  assert.equal(assetLevelReadyToGenerate('LEVEL_2_VISUALS', false), true)
})
