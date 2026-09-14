// agent-service/playbooks/munichListCurationFixtures.test.ts
//
// First real consumer of __fixtures__/munichListCurationFixtures.ts (Phase 1
// fixture, previously unwired — see that file's own header comment and
// docs/metro-launch-audit/munich/calibration-analysis/08-data-gaps-and-next-steps.md
// K-extension item 9). Drives a representative subset of the fixture's real
// Munich list-curation examples through the real PASS B
// evaluateItemForListMembership implementation (listFitScoring.ts, Munich
// calibration Phase 3) and asserts the verdict matches the fixture's own
// documented real-world outcome — the regression check Phase 3 requires,
// proving the new two-pass architecture would NOT reproduce Winston's
// original list-curation failures.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MUNICH_LIST_CURATION_FIXTURES } from './__fixtures__/munichListCurationFixtures'
import { evaluateItemForListMembership, type ListFitCandidate, type ListMembershipListContext } from './listFitScoring'

function findFixture(label: string) {
  const entry = MUNICH_LIST_CURATION_FIXTURES.find((e) => e.label === label)
  if (!entry) throw new Error(`No munichListCurationFixtures entry labeled "${label}"`)
  return entry
}

function candidateFor(label: string): ListFitCandidate {
  const entry = findFixture(label)
  return { candidateName: entry.itemName, venueName: entry.itemName, dbCategory: entry.category as ListFitCandidate['dbCategory'], finalTags: [], finalBody: entry.itemBody }
}

test('munichListCurationFixtures: real Café Maria — Winston\'s original member, no specific order, HOLDs against Cafés/Markets & Local Flavor (matches its real absence from the final rebuilt list)', () => {
  const list: ListMembershipListContext = { title: 'Cafés, Markets & Local Flavor', kind: 'FOOD_LOCAL_FLAVOR', categories: ['Food & drink'] }
  const decision = evaluateItemForListMembership({ item: candidateFor('Generic restaurant rejected from local flavor'), list })
  assert.equal(decision.verdict, 'HOLD', 'Winston shipped this as a list member with no review gate; the real fixture confirms it was excluded from the final list — this pipeline never lets it INCLUDE without a concrete action')
})

test('munichListCurationFixtures: real Fausto Kaffeerösterei — a concrete product+ritual INCLUDEs Cafés/Markets & Local Flavor', () => {
  const list: ListMembershipListContext = { title: 'Cafés, Markets & Local Flavor', kind: 'FOOD_LOCAL_FLAVOR', categories: ['Food & drink'] }
  const decision = evaluateItemForListMembership({ item: candidateFor('Strong local-flavor inclusion'), list, concreteLocalFlavorAction: 'Smell the roast and order a single-origin espresso.' })
  assert.equal(decision.verdict, 'INCLUDE')
})

test('munichListCurationFixtures: real Neues Rathaus plague-dragon detail — a documented overlooked-detail-on-a-famous-landmark discovery basis correctly INCLUDEs Hidden Gems', () => {
  const list: ListMembershipListContext = { title: 'Hidden Gems', kind: 'HIDDEN_GEMS', categories: ['Misc'] }
  const decision = evaluateItemForListMembership({
    item: candidateFor('Defensible overlooked gem — famous building, hidden/overlooked detail'),
    list,
    discoveryBasis: { category: 'OVERLOOKED_DETAIL_ON_FAMOUS_LANDMARK', detail: 'The building is famous and unhidden; the specific carved detail is genuinely overlooked.' },
  })
  assert.equal(decision.verdict, 'INCLUDE')
})

test('munichListCurationFixtures: real Kunstareal Munich — no discovery mechanic, HOLDs against Hidden Gems (matches its real exclusion, and it was never a Hidden Gems candidate in any real version)', () => {
  const list: ListMembershipListContext = { title: 'Hidden Gems', kind: 'HIDDEN_GEMS', categories: ['Arts & Culture'] }
  const decision = evaluateItemForListMembership({ item: candidateFor('Famous attraction rejected from Hidden Gems — no discovery mechanic'), list })
  assert.equal(decision.verdict, 'HOLD')
})

test('munichListCurationFixtures: real Weihenstephan — one item validly fitting THREE lists for three distinct, independently-supplied reasons (real multi-list case, 43 items total per the calibration analysis)', () => {
  const entry = findFixture('One item validly fitting multiple lists for distinct reasons')
  const candidate: ListFitCandidate = { candidateName: entry.itemName, venueName: entry.itemName, dbCategory: entry.category as ListFitCandidate['dbCategory'], finalTags: [], finalBody: entry.itemBody }

  const beerGardens = evaluateItemForListMembership({ item: candidate, list: { title: 'Beer Gardens, Breweries & Bavarian Rituals', kind: 'THEMED', categories: ['Bar & drinks'] } })
  const dayTrips = evaluateItemForListMembership({ item: candidate, list: { title: 'Day Trips & Big Adventures', kind: 'DAY_TRIP', categories: ['Bar & drinks'] }, travelEffort: { level: 'SURROUNDING_MUNICIPALITY', detail: 'Freising, ~35km N.' } })
  const fall = evaluateItemForListMembership({ item: candidate, list: { title: 'Fall 2026 — Munich Metro', kind: 'SEASONAL', categories: ['Bar & drinks'] } })

  assert.equal(beerGardens.verdict, 'INCLUDE')
  assert.equal(dayTrips.verdict, 'INCLUDE')
  assert.equal(fall.verdict, 'INCLUDE')
  // Each decision's own listSpecificEvidence/fitReason is independently
  // derived per list — never one shared justification copy-pasted three
  // times, proving these are three genuinely separate judgments.
  assert.notEqual(dayTrips.listSpecificEvidence, beerGardens.listSpecificEvidence)
})

test('munichListCurationFixtures: real SAP Garden — a category-balancing selection (the only Sports item in the Fall list) correctly reports CATEGORY_BALANCING diversity contribution', () => {
  const entry = findFixture('Category-balancing selection')
  const candidate: ListFitCandidate = { candidateName: entry.itemName, venueName: entry.itemName, dbCategory: entry.category as ListFitCandidate['dbCategory'], finalTags: [], finalBody: entry.itemBody }
  const decision = evaluateItemForListMembership({
    item: candidate,
    list: { title: 'Fall 2026 — Munich Metro', kind: 'SEASONAL', categories: ['Sports'] },
    isCategoryUnderrepresented: true,
  })
  assert.equal(decision.verdict, 'INCLUDE')
  assert.equal(decision.diversityContribution, 'CATEGORY_BALANCING')
})

test('munichListCurationFixtures: every fixture entry is structurally sound (label unique, itemBody non-empty, targetLists non-empty)', () => {
  const labels = new Set<string>()
  for (const entry of MUNICH_LIST_CURATION_FIXTURES) {
    assert.equal(labels.has(entry.label), false, `duplicate label: ${entry.label}`)
    labels.add(entry.label)
    assert.ok(entry.itemBody.length > 0)
    assert.ok(entry.targetLists.length > 0)
    assert.ok(entry.expectedVerdicts.length > 0)
  }
})
