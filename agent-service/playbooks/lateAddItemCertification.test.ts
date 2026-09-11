import { test } from 'node:test'
import assert from 'node:assert/strict'
import { certifyLateAddItem, type LateAddItemInput } from './lateAddItemCertification'
import type { ExistingProductionItem } from './existingInventoryReconciliation'
import type { PlacesCompletenessItemInput } from './placesCompletenessGate'

function goodPlaces(overrides: Partial<PlacesCompletenessItemInput> = {}): PlacesCompletenessItemInput {
  return {
    candidateName: 'Forno Firenze schiacciata',
    classification: 'EXACT',
    googlePlaceId: 'place-forno-firenze',
    formattedAddress: 'Via del Fake 1, 50125 Firenze FI, Italy',
    mapsQuery: 'Forno Firenze, Via del Fake 1, Firenze',
    lat: 43.766,
    lng: 11.245,
    ...overrides,
  }
}

function goodInput(overrides: Partial<LateAddItemInput> = {}): LateAddItemInput {
  return {
    candidateName: 'Forno Firenze schiacciata',
    venueName: 'Forno Firenze',
    body: "Try the 'schiacciata' sandwich at 'Forno Firenze'.",
    dbCategory: 'Food & drink',
    tags: ['bakery', 'sandwich', 'local favorite', 'historic', 'casual', 'walkable'],
    neighborhoodName: 'Santo Spirito',
    places: goodPlaces(),
    existingProductionItems: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Required minimum: the duplicate short-circuit-to-REJECTED-with-
// reuseExistingItemId path — the exact mechanism the new Metro Finisher
// stage's enrichment/must-have candidates depend on to avoid creating a
// duplicate row when a real production match already exists.
// ---------------------------------------------------------------------------

test('certifyLateAddItem: a same-venue/same-experience match against existing production inventory short-circuits to REJECTED with reuseExistingItemId set', () => {
  const existing: ExistingProductionItem = {
    id: 'prod-item-1',
    body: "Try the 'schiacciata' sandwich at 'Forno Firenze'.",
    googlePlaceId: 'place-forno-firenze',
    formattedAddress: 'Via del Fake 1, 50125 Firenze FI, Italy',
    websiteUrl: null,
    lat: 43.766,
    lng: 11.245,
    mapsQuery: 'Forno Firenze, Via del Fake 1, Firenze',
  }
  const result = certifyLateAddItem(goodInput({ existingProductionItems: [existing] }))
  assert.equal(result.verdict, 'REJECTED')
  assert.equal(result.reuseExistingItemId, 'prod-item-1')
  assert.ok(result.reasons.some((r) => r.includes('reuse it, do not create a duplicate row')))
})

test('certifyLateAddItem: a same-venue but MATERIALLY DIFFERENT experience does not short-circuit to reuse — it is evaluated on its own merits', () => {
  const existingDifferentExperience: ExistingProductionItem = {
    id: 'prod-item-2',
    body: "Browse the vintage cookbook shelf at 'Forno Firenze'.",
    googlePlaceId: 'place-forno-firenze',
    formattedAddress: 'Via del Fake 1, 50125 Firenze FI, Italy',
    websiteUrl: null,
    lat: 43.766,
    lng: 11.245,
    mapsQuery: 'Forno Firenze, Via del Fake 1, Firenze',
  }
  const result = certifyLateAddItem(goodInput({ existingProductionItems: [existingDifferentExperience] }))
  assert.equal(result.reuseExistingItemId, undefined)
})

test('certifyLateAddItem: an empty existingProductionItems array (a real query that found nothing) is accepted, never treated as "check skipped"', () => {
  const result = certifyLateAddItem(goodInput({ existingProductionItems: [] }))
  assert.equal(result.reuseExistingItemId, undefined)
})

// ---------------------------------------------------------------------------
// Other required checks — never silently skipped for a "quick add."
// ---------------------------------------------------------------------------

test('certifyLateAddItem: REJECTS when no neighborhood assignment resolved', () => {
  const result = certifyLateAddItem(goodInput({ neighborhoodName: null }))
  assert.equal(result.verdict, 'REJECTED')
  assert.ok(result.reasons.some((r) => r.includes('No neighborhood assignment')))
})

test('certifyLateAddItem: REJECTS when no canonical production category resolved', () => {
  const result = certifyLateAddItem(goodInput({ dbCategory: null }))
  assert.equal(result.verdict, 'REJECTED')
  assert.ok(result.reasons.some((r) => r.includes('No canonical production category')))
})

test('certifyLateAddItem: REJECTS when tag count is outside the 6-8 canonical range', () => {
  const tooFew = certifyLateAddItem(goodInput({ tags: ['one', 'two'] }))
  assert.equal(tooFew.verdict, 'REJECTED')
  assert.ok(tooFew.reasons.some((r) => r.includes('6-8 canonical tags')))

  const tooMany = certifyLateAddItem(goodInput({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }))
  assert.equal(tooMany.verdict, 'REJECTED')
})

test('certifyLateAddItem: REJECTS when Google Places completeness fails (a required field missing)', () => {
  const result = certifyLateAddItem(goodInput({ places: goodPlaces({ googlePlaceId: null }) }))
  assert.equal(result.verdict, 'REJECTED')
})

test('certifyLateAddItem: REJECTS when the venue name is not quoted in the body (venue-quoting gate)', () => {
  const result = certifyLateAddItem(goodInput({ body: 'Try the schiacciata sandwich at Forno Firenze, no quotes here.' }))
  assert.equal(result.verdict, 'REJECTED')
  assert.ok(result.reasons.some((r) => r.toLowerCase().includes('venue quoting')))
})

test('certifyLateAddItem: a fully correct late add with no existing production conflict CERTIFIES', () => {
  const result = certifyLateAddItem(goodInput())
  assert.equal(result.verdict, 'CERTIFIED', JSON.stringify(result.reasons))
  assert.equal(result.reuseExistingItemId, undefined)
})
