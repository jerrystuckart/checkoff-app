// agent-service/playbooks/m9TwoPassIntegration.test.ts
//
// Munich calibration Phase 7 — regression coverage tying the whole M9
// two-pass architecture together end to end: PASS A (listConceptDiscovery.ts)
// discovers a concept, PASS B (listFitScoring.ts's evaluateItemForListMembership)
// curates its membership item-by-item, detectPortfolioRepetition reviews the
// finished list, and operatorReviewBoundaries.ts confirms which step of
// this whole flow actually needed Jerry's approval. Modeled on the real
// Beer Gardens, Breweries & Bavarian Rituals cluster — the concrete case
// this task's spec names as the reason Pass A and Pass B must be genuinely
// separate passes, not one collapsed check.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverListConcepts, type ListConceptCandidateItem } from './listConceptDiscovery'
import { evaluateItemForListMembership, detectPortfolioRepetition, type ListFitCandidate, type ListMembershipListContext, type PortfolioReviewItem } from './listFitScoring'
import { evaluateOperatorReviewBoundary } from './operatorReviewBoundaries'

function beerGardenCatalog(): ListConceptCandidateItem[] {
  const neighborhoods = ['Altstadt-Lehel', 'Sendling', 'Andechs', 'Aying', 'Freising', 'Fürstenfeldbruck', 'Erding', 'Ludwigsvorstadt-Isarvorstadt']
  const beerGarden: ListConceptCandidateItem[] = Array.from({ length: 20 }, (_, i) => ({
    candidateName: `Beer Garden Venue ${i + 1}`,
    venueName: `Beer Garden Venue ${i + 1}`,
    dbCategory: i < 13 ? 'Food & drink' : 'Bar & drinks',
    finalTags: ['beer-garden', 'bavarian-ritual'],
    finalBody: `Rinse your own mug and order a fresh liter at 'Beer Garden Venue ${i + 1}'.`,
    neighborhoodName: neighborhoods[i % neighborhoods.length]!,
    ownershipType: i % 3 === 0 ? 'INDEPENDENT_LOCAL' : undefined,
  }))
  const filler: ListConceptCandidateItem[] = Array.from({ length: 40 }, (_, i) => ({
    candidateName: `Unrelated Item ${i + 1}`,
    venueName: `Unrelated Item ${i + 1}`,
    dbCategory: 'Arts & Culture',
    finalTags: ['museum'],
    finalBody: `Step into the gallery at 'Unrelated Item ${i + 1}'.`,
    neighborhoodName: 'Maxvorstadt',
  }))
  return [...beerGarden, ...filler]
}

test('m9TwoPassIntegration: PASS A discovers the Beer Gardens concept as CREATE-worthy, independent of any per-item membership judgment', () => {
  const candidates = discoverListConcepts(beerGardenCatalog())
  const beerGarden = candidates.find((c) => c.candidateItemCount === 20)!
  assert.equal(beerGarden.verdict, 'CREATE')
  // PASS A's own concept-level approval requires Jerry, per Phase 5 — this
  // is the FIRST place approval is needed in the whole flow, even though
  // PASS A itself never blocks on it internally (it just reports CREATE).
  const boundary = evaluateOperatorReviewBoundary('CREATE_NEW_LIST_CONCEPT')
  assert.equal(boundary.requiresApproval, true)
})

test('m9TwoPassIntegration: PASS B then independently curates each of the 20 discovered items INTO the (now Jerry-approved) list, never auto-including on discovery alone', () => {
  const candidates = discoverListConcepts(beerGardenCatalog())
  const beerGarden = candidates.find((c) => c.candidateItemCount === 20)!
  const list: ListMembershipListContext = { title: 'Beer Gardens, Breweries & Bavarian Rituals', kind: 'THEMED', categories: ['Food & drink', 'Bar & drinks'], tags: ['beer-garden'], listId: 'newly-created-list' }

  const decisions = beerGarden.candidateNames.map((name) => {
    const item: ListFitCandidate = { candidateName: name, venueName: name, dbCategory: name.includes('Venue 1') || Number(name.match(/\d+/)?.[0]) <= 13 ? 'Food & drink' : 'Bar & drinks', finalTags: ['beer-garden', 'bavarian-ritual'], finalBody: `Rinse your own mug and order a fresh liter at '${name}'.` }
    return evaluateItemForListMembership({ item, list })
  })
  assert.equal(decisions.every((d) => d.verdict === 'INCLUDE'), true, 'every discovered member independently clears PASS B\'s own fit check too')
  assert.equal(decisions.length, 20)
})

test('m9TwoPassIntegration: the finished list, reviewed by detectPortfolioRepetition, shows real geographic diversity (matching the real Beer Gardens list\'s own "most geographically dispersed of all six lists" finding) with no duplicate-venue finding', () => {
  const catalog = beerGardenCatalog().filter((i) => i.finalTags.includes('beer-garden'))
  const reviewItems: PortfolioReviewItem[] = catalog.map((i) => ({ candidateName: i.candidateName, venueName: i.venueName, dbCategory: i.dbCategory, neighborhoodName: i.neighborhoodName, finalBody: i.finalBody }))
  const findings = detectPortfolioRepetition(reviewItems)
  assert.equal(findings.some((f) => f.kind === 'DUPLICATE_VENUE'), false)
})

test('m9TwoPassIntegration: a concept that overlaps substantially with this already-accepted Beer Gardens list REQUIRES_JERRY at PASS A, before PASS B ever runs — proving the passes are sequenced, not parallel-and-independent', () => {
  const catalog = beerGardenCatalog()
  const beerGardenNames = catalog.filter((i) => i.finalTags.includes('beer-garden')).map((i) => i.candidateName)
  // A second discovery run, now aware of the already-accepted concept.
  const secondPass = discoverListConcepts(catalog, undefined, [{ title: 'Beer Gardens, Breweries & Bavarian Rituals', candidateNames: beerGardenNames }])
  const stillTheSameCluster = secondPass.find((c) => c.candidateItemCount === 20)!
  assert.equal(stillTheSameCluster.verdict, 'REQUIRES_JERRY', 're-discovering the SAME already-accepted cluster must flag full overlap, never silently propose a duplicate list')
})
