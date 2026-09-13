import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateItemNeighborhoodReferentialIntegrityGate,
  evaluateItemGeoMetroConsistencyGate,
  normalizeNeighborhoodName,
  looksLikeDescriptiveLabel,
  type ItemNeighborhoodReference,
  type ItemGeoRecord,
  type MetroGeoBoundary,
} from './itemNeighborhoodIntegrityGate'

const MUNICH_CANONICAL = ['Altstadt-Lehel', 'Ludwigsvorstadt-Isarvorstadt', 'Maxvorstadt', 'Schwabing', 'Au-Haidhausen', 'Sendling', 'Sendling-Westpark', 'Neuhausen-Nymphenburg']

// ---------------------------------------------------------------------------
// ITEM_NEIGHBORHOOD_REFERENTIAL_INTEGRITY_GATE
// ---------------------------------------------------------------------------

test('referential integrity gate: 1) 8 canonical neighborhoods + one item referencing a 9th descriptive/free-text label → BLOCKS', () => {
  const items: ItemNeighborhoodReference[] = [
    { itemName: 'Gasteig', neighborhoodName: 'Au-Haidhausen' },
    { itemName: 'P1 Club', neighborhoodName: 'Maximiliansplatz / near English Garden' },
  ]
  const result = evaluateItemNeighborhoodReferentialIntegrityGate(MUNICH_CANONICAL, items)
  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.unresolvedReferences.length, 1)
  assert.equal(result.unresolvedReferences[0].itemName, 'P1 Club')
})

test('referential integrity gate: 2) a regular hyphen vs. a non-breaking-hyphen variant of the same name must NOT be treated as two different neighborhoods', () => {
  const items: ItemNeighborhoodReference[] = [
    { itemName: 'Auer Dult', neighborhoodName: 'Au‑Haidhausen' }, // U+2011 non-breaking hyphen
    { itemName: 'Gasteig', neighborhoodName: 'Au-Haidhausen' }, // regular hyphen
  ]
  const result = evaluateItemNeighborhoodReferentialIntegrityGate(MUNICH_CANONICAL, items)
  assert.equal(result.verdict, 'PASS', JSON.stringify(result.unresolvedReferences))
  assert.equal(normalizeNeighborhoodName('Au‑Haidhausen'), normalizeNeighborhoodName('Au-Haidhausen'))
})

test('referential integrity gate: 3) descriptive/free-text labels can never pass as valid production neighborhood names — pattern-based, not a hardcoded blocklist', () => {
  const suspectLabels = ['near city center Munich', 'various', 'City Centre (former substation)', 'Old Town (Altstadt)', 'Hackenstraße, near Hofstatt', 'Sendlinger railway bridge', 'Lehel (near Kunstareal)', 'Central to northern side (adjacent to Old Town)']
  for (const label of suspectLabels) {
    const check = looksLikeDescriptiveLabel(label)
    assert.ok(check.suspect, `expected "${label}" to be flagged as a descriptive label`)
  }
  // Real, deliberate combined district names must NOT trip the heuristic.
  const realNames = ['Ludwigsvorstadt-Isarvorstadt', 'Au-Haidhausen', 'Sendling-Westpark', 'Schwabing', 'Neuhausen-Nymphenburg']
  for (const name of realNames) {
    const check = looksLikeDescriptiveLabel(name)
    assert.equal(check.suspect, false, `expected "${name}" to NOT be flagged (reason: ${check.reason})`)
  }

  // And the gate itself blocks on these labels even against a fresh, unrelated canonical model (covers "any future metro's stray labels too").
  const items: ItemNeighborhoodReference[] = suspectLabels.map((label, i) => ({ itemName: `item-${i}`, neighborhoodName: label }))
  const result = evaluateItemNeighborhoodReferentialIntegrityGate(['Downtown', 'Riverside'], items)
  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.unresolvedReferences.length, suspectLabels.length)
})

test('referential integrity gate: 5) every retained item in a valid fixture maps to exactly one frozen canonical neighborhood (positive case)', () => {
  const items: ItemNeighborhoodReference[] = [
    { itemName: 'Gasteig', neighborhoodName: 'Au-Haidhausen' },
    { itemName: 'La Certosa', neighborhoodName: 'Sendling' },
    { itemName: 'Westpark', neighborhoodName: 'Sendling-Westpark' },
    { itemName: 'Dantebad', neighborhoodName: 'Neuhausen-Nymphenburg' },
  ]
  const result = evaluateItemNeighborhoodReferentialIntegrityGate(MUNICH_CANONICAL, items)
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.unresolvedReferences.length, 0)
})

test('referential integrity gate: 6) a canonical neighborhood with zero items is explicitly ALLOWED — this gate never requires every canonical neighborhood to have coverage', () => {
  const items: ItemNeighborhoodReference[] = [{ itemName: 'Gasteig', neighborhoodName: 'Au-Haidhausen' }]
  // MUNICH_CANONICAL has 8 entries; only one is referenced by any item.
  const result = evaluateItemNeighborhoodReferentialIntegrityGate(MUNICH_CANONICAL, items)
  assert.equal(result.verdict, 'PASS', JSON.stringify(result.unresolvedReferences))
})

test('referential integrity gate: FAILs closed when no canonical model is supplied at all', () => {
  const result = evaluateItemNeighborhoodReferentialIntegrityGate(null, [{ itemName: 'Gasteig', neighborhoodName: 'Au-Haidhausen' }])
  assert.equal(result.verdict, 'FAIL')
})

// ---------------------------------------------------------------------------
// ITEM_GEO_METRO_CONSISTENCY_GATE
// ---------------------------------------------------------------------------

const MUNICH_BOUNDARY: MetroGeoBoundary = { centerLat: 48.1351, centerLng: 11.582, maxRadiusKm: 30 }

test('geo-metro consistency gate: 4) an item whose verified coordinates are genuinely far outside the metro (Dresden inside a Munich package) → BLOCKS', () => {
  const items: ItemGeoRecord[] = [
    { itemName: 'Munich Residenz', lat: 48.1418, lng: 11.5795 },
    { itemName: 'Frauenkirche', lat: 51.0519, lng: 13.7415, formattedAddress: 'Neumarkt, 01067 Dresden, Germany' },
  ]
  const result = evaluateItemGeoMetroConsistencyGate(MUNICH_BOUNDARY, items)
  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.violations.length, 1)
  assert.equal(result.violations[0].itemName, 'Frauenkirche')
  assert.ok(result.violations[0].distanceKm > 300)
})

test('geo-metro consistency gate: positive case — every item within the approved boundary passes cleanly', () => {
  const items: ItemGeoRecord[] = [
    { itemName: 'Munich Residenz', lat: 48.1418, lng: 11.5795 },
    { itemName: 'Nymphenburg Palace', lat: 48.1583, lng: 11.5033 },
    { itemName: 'Allianz Arena', lat: 48.2188, lng: 11.6247 },
  ]
  const result = evaluateItemGeoMetroConsistencyGate(MUNICH_BOUNDARY, items)
  assert.equal(result.verdict, 'PASS', JSON.stringify(result.violations))
})

test('geo-metro consistency gate: an explicit, named exception (approvedDistanceExceptions) allows an otherwise-out-of-range item, never an implicit pass', () => {
  const farItem: ItemGeoRecord = { itemName: 'Dachau Concentration Camp Memorial Site', lat: 48.2668, lng: 11.4675 }
  const withoutException = evaluateItemGeoMetroConsistencyGate(MUNICH_BOUNDARY, [farItem])
  // ~16km from center, within 30km, so use a tighter boundary to force the exception path.
  const tightBoundary: MetroGeoBoundary = { ...MUNICH_BOUNDARY, maxRadiusKm: 5 }
  const withoutExceptionTight = evaluateItemGeoMetroConsistencyGate(tightBoundary, [farItem])
  assert.equal(withoutExceptionTight.verdict, 'FAIL')

  const withException = evaluateItemGeoMetroConsistencyGate({ ...tightBoundary, approvedDistanceExceptions: [{ itemName: 'Dachau Concentration Camp Memorial Site', reason: 'Jerry-approved accepted nearby-destination boundary for a genuinely significant day-trip site.' }] }, [farItem])
  assert.equal(withException.verdict, 'PASS')
  assert.equal(withoutException.verdict, 'PASS') // sanity: within the wider default boundary regardless
})
