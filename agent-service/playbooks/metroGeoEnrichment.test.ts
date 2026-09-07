import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPlacesMatch, evaluateGeoEnrichmentCertificationGate, nameSimilarity, computeGeoRiskFlags, type PlacesResultLike } from './metroGeoEnrichment'

function result(overrides: Partial<PlacesResultLike> = {}): PlacesResultLike {
  return { placeId: 'place-1', name: 'California Surf Museum', formattedAddress: '312 Pier View Way, Oceanside, CA', lat: 33.19, lng: -117.38, websiteUri: 'https://surfmuseum.org', country: 'US', viewportRadiusM: null, ...overrides }
}

test('classifyPlacesMatch: UNRESOLVED when the Places call itself errored', () => {
  const r = classifyPlacesMatch({ candidateName: 'California Surf Museum', body: 'x', expectedCountry: 'US', topResult: null, apiError: 'network timeout' })
  assert.equal(r.classification, 'UNRESOLVED')
  assert.match(r.reason, /network timeout/)
})

test('classifyPlacesMatch: UNRESOLVED when Places returned zero results', () => {
  const r = classifyPlacesMatch({ candidateName: 'California Surf Museum', body: 'x', expectedCountry: 'US', topResult: null })
  assert.equal(r.classification, 'UNRESOLVED')
})

test('classifyPlacesMatch: EXACT for a strong name match with confirmed country', () => {
  const r = classifyPlacesMatch({ candidateName: 'California Surf Museum', body: 'See the surfboard.', expectedCountry: 'US', topResult: result() })
  assert.equal(r.classification, 'EXACT')
})

test('classifyPlacesMatch: REJECTED_WRONG_MATCH on a definite country mismatch, regardless of name similarity', () => {
  const r = classifyPlacesMatch({ candidateName: 'California Surf Museum', body: 'x', expectedCountry: 'MX', topResult: result({ country: 'US' }) })
  assert.equal(r.classification, 'REJECTED_WRONG_MATCH')
  assert.match(r.reason, /Country mismatch/)
})

test('classifyPlacesMatch: REJECTED_WRONG_MATCH on a very low name similarity with no structural excuse', () => {
  const r = classifyPlacesMatch({ candidateName: 'California Surf Museum', body: 'x', expectedCountry: 'US', topResult: result({ name: 'Fuzzy Wuzzy Pet Grooming' }) })
  assert.equal(r.classification, 'REJECTED_WRONG_MATCH')
})

test('classifyPlacesMatch: NO_CANONICAL_VENUE for a "(various operators)" experience — never a wrong-match rejection, never forced confident either', () => {
  const r = classifyPlacesMatch({ candidateName: 'Kayak Tours (various operators)', body: 'Paddle the bay.', expectedCountry: 'US', topResult: result({ name: 'Some Random Kayak Co' }) })
  assert.equal(r.classification, 'NO_CANONICAL_VENUE')
})

test('classifyPlacesMatch: NO_CANONICAL_VENUE for a recurring/scheduled event', () => {
  const r = classifyPlacesMatch({ candidateName: 'Downtown Food Festival', body: 'Attend the annual food festival.', expectedCountry: 'US', topResult: result({ name: 'Downtown Plaza' }) })
  assert.equal(r.classification, 'NO_CANONICAL_VENUE')
})

test('classifyPlacesMatch: HIGH_CONFIDENCE_PARENT_VENUE for a sub-experience/area candidate with moderate (not exact-tier) similarity', () => {
  const r = classifyPlacesMatch({
    candidateName: 'Sunset Cliffs Natural Park',
    body: 'Watch the sunset inside the Hillcrest Overlook building.',
    expectedCountry: 'US',
    topResult: result({ name: 'Sunset Point Overlook' }),
  })
  assert.equal(r.classification, 'HIGH_CONFIDENCE_PARENT_VENUE')
})

test('classifyPlacesMatch: AMBIGUOUS_NEEDS_REVIEW for a moderate similarity gap with no structural explanation', () => {
  const r = classifyPlacesMatch({ candidateName: 'Blue Door Cafe', body: 'x', expectedCountry: 'US', topResult: result({ name: 'Blue Awning Coffee House' }) })
  assert.equal(r.classification, 'AMBIGUOUS_NEEDS_REVIEW')
})

test('classifyPlacesMatch: AMBIGUOUS_NEEDS_REVIEW when the country cannot be parsed at all', () => {
  const r = classifyPlacesMatch({ candidateName: 'California Surf Museum', body: 'x', expectedCountry: 'US', topResult: result({ country: null }) })
  assert.equal(r.classification, 'AMBIGUOUS_NEEDS_REVIEW')
})

test('classifyPlacesMatch: never forces a low-confidence match into EXACT just because a result exists', () => {
  const r = classifyPlacesMatch({ candidateName: 'Very Specific Local Diner', body: 'x', expectedCountry: 'US', topResult: result({ name: 'Completely Different Chain Store' }) })
  assert.notEqual(r.classification, 'EXACT')
  assert.notEqual(r.classification, 'HIGH_CONFIDENCE_PARENT_VENUE')
})

test('nameSimilarity: exact match scores 1, unrelated strings score low', () => {
  assert.equal(nameSimilarity('Zuma', 'Zuma'), 1)
  assert.ok(nameSimilarity('Zuma', 'Zuma San Diego') > 0.7, 'substring containment should score high, not penalized heavily for length')
  assert.ok(nameSimilarity('Zuma', 'Completely Unrelated Business Name') < 0.3)
})

test('computeGeoRiskFlags: detects each structural category independently', () => {
  assert.equal(computeGeoRiskFlags('Taco Spot (various operators)', 'x').variousOperators, true)
  assert.equal(computeGeoRiskFlags('Third location of Taco Spot', 'x').multiLocationChain, true)
  assert.equal(computeGeoRiskFlags('Some Venue', 'Order tacos inside the Grand Hotel').parentSubVenue, true)
  assert.equal(computeGeoRiskFlags('Annual Chili Festival', 'x').recurringEvent, true)
  assert.equal(computeGeoRiskFlags('Gaslamp Quarter', 'x').areaOrDistrict, true)
})

test('evaluateGeoEnrichmentCertificationGate: fails closed on an empty set', () => {
  assert.equal(evaluateGeoEnrichmentCertificationGate([]).verdict, 'FAIL')
})

test('evaluateGeoEnrichmentCertificationGate: PASSes when every item is confidently enriched or an explicit exception', () => {
  const result = evaluateGeoEnrichmentCertificationGate([
    { candidateName: 'A', classification: 'EXACT', reason: 'ok' },
    { candidateName: 'B', classification: 'HIGH_CONFIDENCE_PARENT_VENUE', reason: 'ok' },
    { candidateName: 'C', classification: 'NO_CANONICAL_VENUE', reason: 'event' },
  ])
  assert.equal(result.verdict, 'PASS')
})

test('evaluateGeoEnrichmentCertificationGate: FAILs on even one AMBIGUOUS/REJECTED/UNRESOLVED item', () => {
  const result = evaluateGeoEnrichmentCertificationGate([
    { candidateName: 'A', classification: 'EXACT', reason: 'ok' },
    { candidateName: 'B', classification: 'AMBIGUOUS_NEEDS_REVIEW', reason: 'needs review' },
  ])
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.reason, /B \(AMBIGUOUS_NEEDS_REVIEW/)
})
