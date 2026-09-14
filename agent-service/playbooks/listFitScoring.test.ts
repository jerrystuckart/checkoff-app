import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  scoreItemForList,
  scoreItemsForLists,
  filterCandidatesByListFit,
  evaluateItemForListMembership,
  enforcePreferredSizeWithoutFiller,
  detectPortfolioRepetition,
  DEFAULT_LIST_FIT_INCLUDE_THRESHOLD,
  type ListFitCandidate,
  type ListFitListDefinition,
  type ListMembershipListContext,
  type PortfolioReviewItem,
} from './listFitScoring'

function item(overrides: Partial<ListFitCandidate> & { candidateName: string }): ListFitCandidate {
  return { venueName: overrides.candidateName, dbCategory: 'Food & drink', finalTags: [], finalBody: 'A body describing the venue.', ...overrides }
}

test('scoreItemForList: catalog inclusion never implies list inclusion — an unconfigured list always scores 0/EXCLUDE', () => {
  const result = scoreItemForList(item({ candidateName: 'Cafe A' }), { title: 'Empty List' })
  assert.equal(result.score, 0)
  assert.equal(result.verdict, 'EXCLUDE')
})

test('scoreItemForList: an item can independently score fit for zero lists (belongs to none)', () => {
  const nightlife: ListFitListDefinition = { title: 'After Dark', categories: ['Nightlife'], tags: ['cocktail-bar'] }
  const result = scoreItemForList(item({ candidateName: 'Quiet Bookstore', dbCategory: 'Shopping', finalTags: ['used-books'] }), nightlife)
  assert.equal(result.verdict, 'EXCLUDE')
})

test('scoreItemForList: strong multi-signal match scores INCLUDE with a clear reason', () => {
  const nightlife: ListFitListDefinition = { title: 'After Dark', categories: ['Nightlife'], tags: ['cocktail-bar'], patterns: [/\bspeakeasy\b/] }
  const result = scoreItemForList(item({ candidateName: 'Hidden Speakeasy', dbCategory: 'Nightlife', finalTags: ['cocktail-bar'], finalBody: 'Find the speakeasy behind the fridge door.' }), nightlife)
  assert.equal(result.verdict, 'INCLUDE')
  assert.equal(result.score, 1)
  assert.match(result.reason, /category/)
})

test('scoreItemForList: a single weak signal out of several configured falls below the threshold', () => {
  const nightlife: ListFitListDefinition = { title: 'After Dark', categories: ['Nightlife'], tags: ['cocktail-bar'], patterns: [/\bspeakeasy\b/] }
  const result = scoreItemForList(item({ candidateName: 'Rooftop Restaurant', dbCategory: 'Food & drink', finalTags: [], finalBody: 'A rooftop dinner spot with city views.' }), nightlife)
  assert.equal(result.score, 0)
  assert.equal(result.verdict, 'EXCLUDE')
  assert.ok(result.score < DEFAULT_LIST_FIT_INCLUDE_THRESHOLD)
})

test('scoreItemsForLists: full matrix covers every item x list pair', () => {
  const items = [item({ candidateName: 'A' }), item({ candidateName: 'B' })]
  const lists: ListFitListDefinition[] = [{ title: 'L1', categories: ['Food & drink'] }, { title: 'L2', categories: ['Shopping'] }]
  const matrix = scoreItemsForLists(items, lists)
  assert.equal(matrix.length, 4)
})

test('filterCandidatesByListFit: never adds names beyond the proposed set, only narrows — catalog/list separation in practice', () => {
  const artsList: ListFitListDefinition = { title: 'Arts & Culture Crawl', categories: ['Arts & Culture'] }
  const items = [item({ candidateName: 'Museum A', dbCategory: 'Arts & Culture' }), item({ candidateName: 'Cafe B', dbCategory: 'Food & drink' })]
  const { included, excluded } = filterCandidatesByListFit(['Museum A', 'Cafe B'], items, artsList)
  assert.deepEqual(included, ['Museum A'])
  assert.equal(excluded.length, 1)
  assert.equal(excluded[0]!.candidateName, 'Cafe B')
})

test('filterCandidatesByListFit: a candidate missing from the scoring data is never silently included', () => {
  const list: ListFitListDefinition = { title: 'L', categories: ['Food & drink'] }
  const { included, excluded } = filterCandidatesByListFit(['Unknown Item'], [], list)
  assert.deepEqual(included, [])
  assert.deepEqual(excluded, [])
})

test('idempotent: scoring the same item/list pair twice produces identical results', () => {
  const list: ListFitListDefinition = { title: 'After Dark', categories: ['Nightlife'], tags: ['cocktail-bar'] }
  const candidate = item({ candidateName: 'Speakeasy', dbCategory: 'Nightlife', finalTags: ['cocktail-bar'] })
  assert.deepEqual(scoreItemForList(candidate, list), scoreItemForList(candidate, list))
})

// ---------------------------------------------------------------------------
// PASS B — evaluateItemForListMembership (Munich calibration Phase 3),
// grounded in real Munich examples from the calibration analysis.
// ---------------------------------------------------------------------------

function afterDarkList(overrides: Partial<ListMembershipListContext> = {}): ListMembershipListContext {
  return { title: 'Munich After Dark', kind: 'AFTER_DARK', categories: ['Bar & drinks', 'Nightlife'], listId: 'list-after-dark', ...overrides }
}

test('evaluateItemForListMembership: real Schumann\'s Bar case — explicit before/after-midnight claim is a clean, structurally nighttime-specific INCLUDE, no softWarning', () => {
  const candidate = item({ candidateName: "Schumann's Bar", dbCategory: 'Bar & drinks', finalBody: "Show up after midnight, when 'Schumann's Bar' says it truly becomes a bar." })
  const decision = evaluateItemForListMembership({ item: candidate, list: afterDarkList(), nighttimeSpecific: { value: true, detail: 'Explicit before/after-midnight claim in the body.' } })
  assert.equal(decision.verdict, 'INCLUDE')
  assert.equal(decision.softWarning, undefined)
})

test('evaluateItemForListMembership: real Frisches Bier case — a legitimate bar with no time-gated claim still INCLUDEs (matches the real Munich outcome) but carries a softWarning, never silently indistinguishable from a fully-justified case', () => {
  const candidate = item({ candidateName: 'Frisches Bier', dbCategory: 'Bar & drinks', finalBody: "Choose a small-brewery pour from 14 rotating taps at 'Frisches Bier'." })
  const decision = evaluateItemForListMembership({ item: candidate, list: afterDarkList(), nighttimeSpecific: { value: false, detail: 'No time gate — could truthfully be completed at 2pm.' } })
  assert.equal(decision.verdict, 'INCLUDE')
  assert.ok(decision.softWarning && decision.softWarning.length > 0)
})

test('evaluateItemForListMembership: nighttimeSpecific entirely omitted routes to HOLD — "is this a bar" category match alone is never sufficient, the judgment must be made deliberately', () => {
  const candidate = item({ candidateName: 'Some Bar', dbCategory: 'Bar & drinks' })
  const decision = evaluateItemForListMembership({ item: candidate, list: afterDarkList() })
  assert.equal(decision.verdict, 'HOLD')
  assert.ok(decision.exclusionReason)
})

test('evaluateItemForListMembership: a generic restaurant is rejected from an After-Dark-type list at the BASE fit stage — category doesn\'t match, list-kind evidence is never even asked for', () => {
  const candidate = item({ candidateName: 'Generic Restaurant', dbCategory: 'Food & drink' })
  const decision = evaluateItemForListMembership({ item: candidate, list: afterDarkList() })
  assert.equal(decision.verdict, 'EXCLUDE')
  assert.ok(decision.exclusionReason)
})

function hiddenGemsList(overrides: Partial<ListMembershipListContext> = {}): ListMembershipListContext {
  return { title: 'Hidden Gems', kind: 'HIDDEN_GEMS', categories: ['Shopping', 'Bar & drinks', 'Misc'], listId: 'list-hidden-gems', ...overrides }
}

test('evaluateItemForListMembership: real Alva Morgaine case — a genuine (non-secret) discovery basis clears the Hidden-Gems gate', () => {
  const candidate = item({ candidateName: 'Alva Morgaine', dbCategory: 'Shopping', finalBody: "Find the strangest wearable treasure in the vintage cabinet of curiosities at 'Alva Morgaine'." })
  const decision = evaluateItemForListMembership({
    item: candidate,
    list: hiddenGemsList(),
    discoveryBasis: { category: 'OFF_MENU_OR_BROWSE_DISCOVERY', detail: 'A browse-and-choose mechanic in an openly public shop — the specific treasure is undetermined until the visitor looks.' },
  })
  assert.equal(decision.verdict, 'INCLUDE')
  assert.match(decision.listSpecificEvidence, /OFF_MENU_OR_BROWSE_DISCOVERY/)
})

test('evaluateItemForListMembership: a famous attraction is rejected from Hidden Gems without a discovery basis — category match alone is never enough (real Munich problem: ~58% of the shipped list had no discovery mechanic at all)', () => {
  const candidate = item({ candidateName: 'Famous Landmark', dbCategory: 'Misc' })
  const decision = evaluateItemForListMembership({ item: candidate, list: hiddenGemsList() })
  assert.equal(decision.verdict, 'HOLD')
  assert.ok(decision.exclusionReason?.includes('discovery basis'))
})

function localFlavorList(): ListMembershipListContext {
  return { title: 'Cafés, Markets & Local Flavor', kind: 'FOOD_LOCAL_FLAVOR', categories: ['Food & drink'], listId: 'list-local-flavor' }
}

test('evaluateItemForListMembership: real Café Maria case — "settle in for coffee," no specific order, HOLDs pending a concrete local-flavor action (matches its real exclusion from the final list)', () => {
  const candidate = item({ candidateName: 'Café Maria', dbCategory: 'Food & drink', finalBody: "Settle in for coffee at 'Café Maria'." })
  const decision = evaluateItemForListMembership({ item: candidate, list: localFlavorList() })
  assert.equal(decision.verdict, 'HOLD')
})

test('evaluateItemForListMembership: real Fausto Kaffeerösterei case — a concrete product+ritual INCLUDEs', () => {
  const candidate = item({ candidateName: 'Fausto Kaffeerösterei', dbCategory: 'Food & drink', finalBody: "Smell the roast and order a single-origin espresso at 'Fausto Kaffeerösterei'." })
  const decision = evaluateItemForListMembership({ item: candidate, list: localFlavorList(), concreteLocalFlavorAction: 'Order a single-origin espresso, roasted on-site.' })
  assert.equal(decision.verdict, 'INCLUDE')
})

function dayTripList(): ListMembershipListContext {
  return { title: 'Day Trips & Big Adventures', kind: 'DAY_TRIP', categories: ['Adventure', 'Food & drink', 'Bar & drinks', 'Play', 'Spa & self-care'], listId: 'list-day-trips' }
}

test('evaluateItemForListMembership: real Weihenstephan case — surrounding-municipality travel effort INCLUDEs a day-trip-type list', () => {
  const candidate = item({ candidateName: 'Weihenstephan', dbCategory: 'Bar & drinks', finalBody: "Tour the brewhouse and storage cellars, then finish with a guided tasting at 'Weihenstephan'." })
  const decision = evaluateItemForListMembership({ item: candidate, list: dayTripList(), travelEffort: { level: 'SURROUNDING_MUNICIPALITY', detail: 'Freising, ~35km N.' } })
  assert.equal(decision.verdict, 'INCLUDE')
})

test('evaluateItemForListMembership: a central-Munich item with NO travel effort is EXCLUDEd from a day-trip-type list — day trips must account for real travel/completion effort', () => {
  const candidate = item({ candidateName: 'Central Café', dbCategory: 'Food & drink' })
  const decision = evaluateItemForListMembership({ item: candidate, list: dayTripList(), travelEffort: { level: 'NONE', detail: 'Central Munich, no travel required.' } })
  assert.equal(decision.verdict, 'EXCLUDE')
})

test('evaluateItemForListMembership: catalog inclusion never implies list inclusion — an item with strong catalog standing but a category mismatch is EXCLUDEd from an unrelated list', () => {
  const candidate = item({ candidateName: 'Strong Catalog Item', dbCategory: 'Arts & Culture' })
  const decision = evaluateItemForListMembership({ item: candidate, list: localFlavorList() })
  assert.equal(decision.verdict, 'EXCLUDE')
})

test('evaluateItemForListMembership: a COMPLETED list not reopened refuses ANY membership change, even a strong match', () => {
  const candidate = item({ candidateName: 'Strong Match', dbCategory: 'Food & drink' })
  const decision = evaluateItemForListMembership({ item: candidate, list: { ...localFlavorList(), status: 'COMPLETED' }, concreteLocalFlavorAction: 'A great, specific ritual.' })
  assert.equal(decision.verdict, 'EXCLUDE')
  assert.match(decision.exclusionReason ?? '', /reopened/)
})

test('evaluateItemForListMembership: a COMPLETED list that IS explicitly reopened evaluates normally', () => {
  const candidate = item({ candidateName: 'Strong Match', dbCategory: 'Food & drink', finalBody: "Order the signature dish at 'Strong Match'." })
  const decision = evaluateItemForListMembership({ item: candidate, list: { ...localFlavorList(), status: 'COMPLETED', reopened: true }, concreteLocalFlavorAction: 'A great, specific ritual.' })
  assert.equal(decision.verdict, 'INCLUDE')
})

test('evaluateItemForListMembership: diversityContribution reflects real, upstream signals only — never invented by this function', () => {
  const candidate = item({ candidateName: 'Gans Woanders', dbCategory: 'Food & drink', finalBody: "Climb into the treehouse-like café at 'Gans Woanders'." })
  const decision = evaluateItemForListMembership({
    item: candidate,
    list: { title: 'Fall 2026 — Munich Metro', kind: 'SEASONAL', categories: ['Food & drink'], listId: 'list-fall' },
    isSingleOrFewItemNeighborhood: true,
  })
  assert.equal(decision.diversityContribution, 'GEOGRAPHIC_BALANCING')
  assert.ok(decision.geographicContribution)
})

test('evaluateItemForListMembership: seasonal and themed fit are genuinely separate judgments — the same item independently scores INCLUDE or EXCLUDE per list, proving these are two different checks not one collapsed one', () => {
  const candidate = item({ candidateName: 'Weihenstephan', dbCategory: 'Bar & drinks', finalBody: "Tour the brewhouse and storage cellars, then finish with a guided tasting at 'Weihenstephan'." })
  const seasonalDecision = evaluateItemForListMembership({ item: candidate, list: { title: 'Fall 2026 — Munich Metro', kind: 'SEASONAL', categories: ['Bar & drinks'], listId: 'list-fall' } })
  const dayTripDecision = evaluateItemForListMembership({ item: candidate, list: dayTripList(), travelEffort: { level: 'NONE', detail: 'No travel evidence supplied for this specific check.' } })
  assert.equal(seasonalDecision.verdict, 'INCLUDE', 'the seasonal list has no travel requirement at all')
  assert.equal(dayTripDecision.verdict, 'EXCLUDE', 'the SAME item, with no travel effort evidence, fails the day-trip-specific gate')
})

// ---------------------------------------------------------------------------
// enforcePreferredSizeWithoutFiller
// ---------------------------------------------------------------------------

test('enforcePreferredSizeWithoutFiller: reports staying below preferred size rather than padding — matches the real "a list may stay below preferred size" requirement', () => {
  const result = enforcePreferredSizeWithoutFiller(6, 8, 3)
  assert.equal(result.finalSize, 6)
  assert.equal(result.belowPreferred, true)
  assert.match(result.reason, /rather than accept/)
})

test('enforcePreferredSizeWithoutFiller: meeting/exceeding the preferred size with genuine items reports no filler needed', () => {
  const result = enforcePreferredSizeWithoutFiller(20, 20)
  assert.equal(result.belowPreferred, false)
})

// ---------------------------------------------------------------------------
// detectPortfolioRepetition — final portfolio review
// ---------------------------------------------------------------------------

function reviewItem(overrides: Partial<PortfolioReviewItem> & { candidateName: string }): PortfolioReviewItem {
  return { venueName: overrides.candidateName, dbCategory: 'Food & drink', neighborhoodName: 'Altstadt-Lehel', finalBody: `A specific claim at '${overrides.candidateName}'.`, ...overrides }
}

test('detectPortfolioRepetition: real Jochen Schweizer Arena case — the SAME venue appearing twice in one list is flagged as DUPLICATE_VENUE (informational, never auto-resolved)', () => {
  const members = [
    reviewItem({ candidateName: 'Jochen Schweizer Arena — Indoor Wind', venueName: 'Jochen Schweizer Arena' }),
    reviewItem({ candidateName: 'Jochen Schweizer Arena — Standing Wave', venueName: 'Jochen Schweizer Arena' }),
    reviewItem({ candidateName: 'Other Venue', venueName: 'Other Venue' }),
  ]
  const findings = detectPortfolioRepetition(members)
  const dup = findings.find((f) => f.kind === 'DUPLICATE_VENUE')
  assert.ok(dup)
  assert.equal(dup!.affectedCandidateNames.length, 2)
})

test('detectPortfolioRepetition: heavy category concentration is flagged', () => {
  const members = Array.from({ length: 10 }, (_, i) => reviewItem({ candidateName: `Bar ${i}`, dbCategory: 'Bar & drinks' }))
  const findings = detectPortfolioRepetition(members)
  assert.ok(findings.some((f) => f.kind === 'CATEGORY_CONCENTRATION'))
})

test('detectPortfolioRepetition: heavy neighborhood concentration is flagged (real Cafés/Markets case: 45% Altstadt-Lehel)', () => {
  const members = [...Array.from({ length: 6 }, (_, i) => reviewItem({ candidateName: `A${i}`, neighborhoodName: 'Altstadt-Lehel' })), ...Array.from({ length: 4 }, (_, i) => reviewItem({ candidateName: `B${i}`, neighborhoodName: 'Sendling' }))]
  const findings = detectPortfolioRepetition(members, { neighborhoodConcentrationThreshold: 0.5 })
  assert.ok(findings.some((f) => f.kind === 'NEIGHBORHOOD_CONCENTRATION' && f.detail.includes('Altstadt-Lehel')))
})

test('detectPortfolioRepetition: a repeated opening word across several members is flagged (mirrors the real M8.75 catalog-voice-pass pattern, applied at the list level)', () => {
  const members = [
    reviewItem({ candidateName: 'A', finalBody: "Order the signature dish at 'A'." }),
    reviewItem({ candidateName: 'B', finalBody: "Order the tasting flight at 'B'." }),
    reviewItem({ candidateName: 'C', finalBody: "Order a coffee at 'C'." }),
    reviewItem({ candidateName: 'D', finalBody: "Climb the wall at 'D'." }),
  ]
  const findings = detectPortfolioRepetition(members)
  const opening = findings.find((f) => f.kind === 'REPEATED_OPENING_WORD')
  assert.ok(opening)
  assert.equal(opening!.affectedCandidateNames.length, 3)
})

test('detectPortfolioRepetition: a genuinely diverse list produces no findings', () => {
  const members = [
    reviewItem({ candidateName: 'A', dbCategory: 'Food & drink', neighborhoodName: 'Altstadt-Lehel', finalBody: "Order the signature dish at 'A'." }),
    reviewItem({ candidateName: 'B', dbCategory: 'Bar & drinks', neighborhoodName: 'Sendling', finalBody: "Sip the house cocktail at 'B'." }),
    reviewItem({ candidateName: 'C', dbCategory: 'Adventure', neighborhoodName: 'Andechs', finalBody: "Climb the tallest route at 'C'." }),
    reviewItem({ candidateName: 'D', dbCategory: 'Arts & Culture', neighborhoodName: 'Maxvorstadt', finalBody: "Step into the maximalist chapel at 'D'." }),
  ]
  const findings = detectPortfolioRepetition(members)
  assert.deepEqual(findings, [])
})
