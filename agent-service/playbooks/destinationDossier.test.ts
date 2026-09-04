import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertAllSameDestination, assembleDossier, rankPortfolioActions, filterByWaitingOn, type DossierInputs, type PortfolioEntry } from './destinationDossier'
import type { DVA1Artifact, DVA2Artifact } from './destinationHubLifecycle'
import type { DestinationContactContext } from './destinationRelationship'

function dva1For(destId: string, name: string): DVA1Artifact {
  return {
    provider: 'dva1_claude_project',
    destinationId: destId,
    destinationName: name,
    artifactRef: `dva1-${destId}`,
    executedAt: '2026-09-04T00:00:00Z',
    contentHash: null,
    score: 90,
    recommendationText: 'x',
  }
}

function contactFor(destId: string, contactId: string, overrides: Partial<DestinationContactContext> = {}): DestinationContactContext {
  return { destinationId: destId, contactId, role: null, sentiment: 'UNKNOWN', promisesMade: [], introducedBy: null, isChampion: false, isBlocker: false, ...overrides }
}

function baseDossierInputs(destId: string, name: string): DossierInputs {
  return {
    destinationId: destId,
    destinationName: name,
    dva1: dva1For(destId, name),
    dva2: null,
    dap: null,
    contacts: [contactFor(destId, `contact-${destId}`)],
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

// ---------------------------------------------------------------------------
// Cross-destination isolation — the hard requirement
// ---------------------------------------------------------------------------

test('assertAllSameDestination: passes when every item matches', () => {
  assert.doesNotThrow(() => assertAllSameDestination('dest-a', [{ destinationId: 'dest-a' }, { destinationId: 'dest-a' }]))
})

test('assertAllSameDestination: throws on a single mismatched item — never silently drops it', () => {
  assert.throws(() => assertAllSameDestination('dest-a', [{ destinationId: 'dest-a' }, { destinationId: 'dest-b' }]), /Cross-destination contamination/)
})

test('assembleDossier: refuses to assemble when a DVA-1 artifact belongs to a different destination', () => {
  const inputs = baseDossierInputs('dest-a', 'Destination A')
  inputs.dva1 = dva1For('dest-WRONG', 'Somewhere Else')
  assert.throws(() => assembleDossier(inputs), /Cross-destination contamination/)
})

test('assembleDossier: refuses to assemble when a contact belongs to a different destination', () => {
  const inputs = baseDossierInputs('dest-a', 'Destination A')
  inputs.contacts = [contactFor('dest-WRONG', 'someone')]
  assert.throws(() => assembleDossier(inputs), /Cross-destination contamination/)
})

test('assembleDossier: "Give me the full picture on X" — a clean dossier assembles correctly with only its own destination\'s data', () => {
  const inputs = baseDossierInputs('grand-lake', 'Grand Lake')
  const dossier = assembleDossier(inputs)
  assert.equal(dossier.destinationId, 'grand-lake')
  assert.equal(dossier.evaluation.dva1.status, 'RECEIVED')
  assert.equal(dossier.evaluation.dva1.score, 90)
  assert.equal(dossier.evaluation.dva2.status, 'NOT_STARTED')
})

// ---------------------------------------------------------------------------
// Contact identity vs. destination relationship context
// ---------------------------------------------------------------------------

test('same global contact can have DIFFERENT relationship contexts for two different destinations', () => {
  const contexts: DestinationContactContext[] = [
    contactFor('willcox', 'jane-smith', { role: 'Chamber Director', sentiment: 'POSITIVE', isChampion: true }),
    contactFor('buena-vista', 'jane-smith', { role: 'Consultant', sentiment: 'NEUTRAL', isChampion: false }),
  ]
  const willcoxContext = contexts.find((c) => c.destinationId === 'willcox' && c.contactId === 'jane-smith')
  const buenaVistaContext = contexts.find((c) => c.destinationId === 'buena-vista' && c.contactId === 'jane-smith')
  assert.equal(willcoxContext?.isChampion, true)
  assert.equal(buenaVistaContext?.isChampion, false)
  assert.notEqual(willcoxContext?.sentiment, buenaVistaContext?.sentiment)
})

// ---------------------------------------------------------------------------
// Portfolio ranking
// ---------------------------------------------------------------------------

function portfolioEntry(overrides: Partial<PortfolioEntry> = {}): PortfolioEntry {
  return {
    destinationId: 'dest-a',
    destinationName: 'Destination A',
    dva1Status: 'RECEIVED',
    dva2Recommendation: null,
    dapStatus: 'NOT_STARTED',
    relationshipStage: null,
    requiredAssetLevel: null,
    waitingOn: null,
    nextFollowUpAt: null,
    nextMeetingAt: null,
    budgetWindowOpeningAt: null,
    staleDays: null,
    ...overrides,
  }
}

test('rankPortfolioActions: needing Jerry ranks above everything else', () => {
  const now = new Date('2026-09-04T12:00:00Z')
  const entries = [
    portfolioEntry({ destinationId: 'follow-up-due', nextFollowUpAt: '2026-09-04T00:00:00Z' }),
    portfolioEntry({ destinationId: 'needs-jerry', waitingOn: 'JERRY' }),
  ]
  const ranked = rankPortfolioActions(entries, now)
  assert.equal(ranked[0].destinationId, 'needs-jerry')
})

test('rankPortfolioActions: follow-up due today/overdue ranks above at-risk staleness', () => {
  const now = new Date('2026-09-04T12:00:00Z')
  const entries = [
    portfolioEntry({ destinationId: 'stale', waitingOn: 'US', staleDays: 20 }),
    portfolioEntry({ destinationId: 'due', nextFollowUpAt: '2026-09-01T00:00:00Z' }),
  ]
  const ranked = rankPortfolioActions(entries, now)
  assert.equal(ranked[0].destinationId, 'due')
})

test('rankPortfolioActions: a destination with nothing urgent produces no action item — never dumps everything', () => {
  const entries = [portfolioEntry({ waitingOn: 'THEM' })]
  assert.deepEqual(rankPortfolioActions(entries), [])
})

test('filterByWaitingOn: correctly isolates each bucket', () => {
  const entries = [portfolioEntry({ destinationId: 'a', waitingOn: 'US' }), portfolioEntry({ destinationId: 'b', waitingOn: 'THEM' })]
  assert.deepEqual(
    filterByWaitingOn(entries, 'THEM').map((e) => e.destinationId),
    ['b']
  )
})

// ---------------------------------------------------------------------------
// Concurrency: five destinations at different lifecycle stages,
// simultaneously — none of their evidence/artifacts/contacts leak into
// another's dossier.
// ---------------------------------------------------------------------------

test('five concurrent destinations remain fully isolated from each other', () => {
  const destinations = ['willcox', 'buena-vista', 'rim-country', 'grand-lake', 'san-diego-experience']
  const dossiers = destinations.map((id, i) => {
    const inputs = baseDossierInputs(id, `Destination ${i}`)
    inputs.dva1 = dva1For(id, `Destination ${i}`)
    inputs.contacts = [contactFor(id, `champion-${id}`, { isChampion: true })]
    return assembleDossier(inputs)
  })

  // Every dossier's own data is scoped correctly...
  for (let i = 0; i < destinations.length; i++) {
    assert.equal(dossiers[i].destinationId, destinations[i])
    assert.equal(dossiers[i].evaluation.dva1.artifactRef, `dva1-${destinations[i]}`)
    assert.equal(dossiers[i].people.champions[0]?.contactId, `champion-${destinations[i]}`)
  }

  // ...and no dossier's champion/artifact matches a DIFFERENT destination's.
  for (let i = 0; i < dossiers.length; i++) {
    for (let j = 0; j < dossiers.length; j++) {
      if (i === j) continue
      assert.notEqual(dossiers[i].evaluation.dva1.artifactRef, dossiers[j].evaluation.dva1.artifactRef)
      assert.notEqual(dossiers[i].people.champions[0]?.contactId, dossiers[j].people.champions[0]?.contactId)
    }
  }
})

test('a maliciously-mixed input (Destination A\'s DVA-1 attached to Destination B\'s dossier request) is refused, not silently accepted', () => {
  const inputs = baseDossierInputs('buena-vista', 'Buena Vista')
  inputs.dva1 = dva1For('willcox', 'Willcox') // wrong destination's artifact
  assert.throws(() => assembleDossier(inputs))
})
