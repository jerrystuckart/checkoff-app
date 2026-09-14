import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverListConcepts, DEFAULT_LIST_CONCEPT_DISCOVERY_CONFIG, type ListConceptCandidateItem, type ListConceptDiscoveryConfig } from './listConceptDiscovery'

function item(overrides: Partial<ListConceptCandidateItem> & { candidateName: string }): ListConceptCandidateItem {
  return {
    venueName: overrides.candidateName,
    dbCategory: 'Food & drink',
    finalTags: [],
    finalBody: `A real experience at '${overrides.candidateName}'.`,
    neighborhoodName: 'Altstadt-Lehel',
    ...overrides,
  }
}

// Unrelated filler items with no shared tags — real production catalogs are
// hundreds of items, so a real cluster's own tag(s) are a MINORITY of the
// whole catalog (this is exactly what maxTagPrevalenceToSeed guards
// against: a tag present on nearly every item is too generic to seed a
// concept on its own). Padding the pool this way in tests matches real
// usage (discoverListConcepts runs against the WHOLE certified catalog, not
// a pre-filtered cluster) rather than weakening the genericness guard.
function unrelatedFiller(count: number): ListConceptCandidateItem[] {
  return Array.from({ length: count }, (_, i) => item({ candidateName: `Unrelated Filler ${i + 1}`, finalTags: ['unrelated-tag'], dbCategory: 'Arts & Culture', neighborhoodName: 'Maxvorstadt' }))
}

// A synthetic-but-Munich-grounded 20-item Beer Gardens & Breweries cluster,
// modeled directly on the real, 20-item "Beer Gardens, Breweries & Bavarian
// Rituals" list from calibration-analysis/09-final-list-rebuild-analysis.md
// and 11-list-portfolio-scorecards.md — 13 Food & drink / 7 Bar & drinks,
// spread across many neighborhoods including several surrounding
// municipalities (Andechs, Aying, Freising, Fürstenfeldbruck, Erding).
function beerGardenCluster(): ListConceptCandidateItem[] {
  const neighborhoods = ['Altstadt-Lehel', 'Sendling', 'Andechs', 'Aying', 'Freising', 'Fürstenfeldbruck', 'Erding', 'Ludwigsvorstadt-Isarvorstadt']
  const out: ListConceptCandidateItem[] = []
  for (let i = 0; i < 20; i++) {
    out.push(
      item({
        candidateName: `Beer Garden Venue ${i + 1}`,
        dbCategory: i < 13 ? 'Food & drink' : 'Bar & drinks',
        finalTags: ['beer-garden', 'bavarian-ritual'],
        neighborhoodName: neighborhoods[i % neighborhoods.length]!,
        ownershipType: i % 3 === 0 ? 'INDEPENDENT_LOCAL' : undefined,
      })
    )
  }
  return out
}

// A weak cluster — enough raw items to clear a naive count floor, but no
// second corroborating tag, deliberately kept BELOW minViableItems so it is
// REJECTed as insufficient depth rather than stretched to reach a target.
function weakCluster(count: number): ListConceptCandidateItem[] {
  return Array.from({ length: count }, (_, i) => item({ candidateName: `Weak Venue ${i + 1}`, finalTags: ['misc-tag'] }))
}

test('listConceptDiscovery: a real, 20-item, two-tag-corroborated cluster (modeled on the real Beer Gardens list) discovers a strong list concept and CREATEs', () => {
  const candidates = discoverListConcepts([...beerGardenCluster(), ...unrelatedFiller(30)])
  const beerGarden = candidates.find((c) => c.seedTags.includes('beer-garden') && c.seedTags.includes('bavarian-ritual'))
  assert.ok(beerGarden, 'expected a pair-seeded cluster from beer-garden + bavarian-ritual')
  assert.equal(beerGarden!.candidateItemCount, 20)
  assert.equal(beerGarden!.verdict, 'CREATE')
  assert.equal(beerGarden!.type, 'FOOD_AND_DRINK')
  assert.ok(Object.keys(beerGarden!.geographicComposition).length >= 5, 'real Beer Gardens list is geographically dispersed across many neighborhoods')
})

test('listConceptDiscovery: a generic concept with insufficient depth is REJECTed outright, never stretched to reach a target count', () => {
  const candidates = discoverListConcepts([...weakCluster(5), ...unrelatedFiller(30)])
  // 5 items sharing one generic tag never clears the default 15-item floor.
  assert.equal(candidates.length, 0, 'a 5-item single-tag cluster never even forms a reportable seed below the minimum')
})

test('listConceptDiscovery: a cluster right at the floor but generated ONLY via a single, weaker tag signal is reported with candidateItemCount reflecting real evidence, not padded', () => {
  const items = [...weakCluster(15), ...unrelatedFiller(30)]
  const candidates = discoverListConcepts(items)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]!.candidateItemCount, 15)
  assert.notEqual(candidates[0]!.verdict, 'REJECT')
})

test('listConceptDiscovery: recognizes a coherent 20-item cluster with the correct category/geographic composition breakdown', () => {
  const candidates = discoverListConcepts([...beerGardenCluster(), ...unrelatedFiller(30)])
  const beerGarden = candidates.find((c) => c.candidateItemCount === 20)!
  assert.equal(beerGarden.categoryComposition['Food & drink'], 13)
  assert.equal(beerGarden.categoryComposition['Bar & drinks'], 7)
})

test('listConceptDiscovery: a candidate concept with substantial overlap against an already-accepted concept REQUIRES_JERRY rather than auto-creating a redundant list', () => {
  const items = [...beerGardenCluster(), ...unrelatedFiller(30)]
  const alreadyAccepted = [{ title: 'Day Trips & Big Adventures', candidateNames: items.slice(0, 12).map((i) => i.candidateName) }]
  const candidates = discoverListConcepts(items, DEFAULT_LIST_CONCEPT_DISCOVERY_CONFIG, alreadyAccepted)
  const beerGarden = candidates.find((c) => c.candidateItemCount === 20)!
  assert.equal(beerGarden.verdict, 'REQUIRES_JERRY')
  assert.ok(beerGarden.overlapWithOtherConcepts.some((o) => o.withTitle === 'Day Trips & Big Adventures'))
})

test('listConceptDiscovery: excludedTags prevents re-discovering a concept already claimed by an existing THEMED_LIST_DEFINITIONS entry or production list', () => {
  const items = [...beerGardenCluster(), ...unrelatedFiller(30)]
  const config: ListConceptDiscoveryConfig = { ...DEFAULT_LIST_CONCEPT_DISCOVERY_CONFIG, excludedTags: new Set(['beer-garden', 'bavarian-ritual']) }
  const candidates = discoverListConcepts(items, config)
  assert.equal(candidates.length, 0, 'both seeding tags are excluded, so no cluster should be (re-)discovered')
})

test('listConceptDiscovery: this pass produces ONLY concept-level judgments — no candidateNames selection/membership judgment happens here (separation from PASS B)', () => {
  const candidates = discoverListConcepts([...beerGardenCluster(), ...unrelatedFiller(30)])
  const beerGarden = candidates.find((c) => c.candidateItemCount === 20)!
  // candidateNames here is simply "every item that matched the discovery
  // seed" — it is NOT a per-item fit/verdict decision (no fitScore,
  // fitReason, diversityContribution, etc. anywhere on this shape). That is
  // exactly the distinction PASS B (listMembershipCuration) exists to add —
  // asserted here structurally, not just by convention.
  assert.equal(beerGarden.candidateNames.length, 20)
  assert.equal('fitScore' in beerGarden, false)
  assert.equal('diversityContribution' in beerGarden, false)
})

test('listConceptDiscovery: local/independent-business support is computed honestly — UNKNOWN_REQUIRES_VERIFICATION items are never silently counted as locally owned', () => {
  const items = [...weakCluster(15), ...unrelatedFiller(30)] // none of the 15 have ownershipType set -> all UNKNOWN_REQUIRES_VERIFICATION
  const candidates = discoverListConcepts(items)
  const c = candidates[0]!
  assert.equal(c.localIndependentBusinessSupport.locallyOwnedCount, 0)
  assert.equal(c.localIndependentBusinessSupport.unknownCount, 15)
})

test('listConceptDiscovery: a nightlife-tagged cluster is classified as the NIGHTLIFE concept type', () => {
  const items = [...Array.from({ length: 16 }, (_, i) => item({ candidateName: `Nightlife Venue ${i + 1}`, dbCategory: 'Nightlife', finalTags: ['nightlife', 'late-night'] })), ...unrelatedFiller(30)]
  const candidates = discoverListConcepts(items)
  assert.equal(candidates[0]!.type, 'NIGHTLIFE')
})
