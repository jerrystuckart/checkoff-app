import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileAgainstExistingInventory, type ExistingProductionItem, type ReconciliationCandidate } from './existingInventoryReconciliation'

// Direct regression coverage for the second systemic gap the Green Bay
// build exposed: 9 real, live, already-certified production items sat
// under Milwaukee's metro (the "Green Bay Leap" list) and the driver
// never checked for them at all, independently re-discovering/re-
// certifying 5 of the same venues from scratch.

const existingGreenBayItems: ExistingProductionItem[] = [
  { id: 'existing-1919', body: "Eat at '1919 Kitchen & Tap' inside Lambeau Field on a non-game day — the building hits different when it's quiet", googlePlaceId: 'ChIJVX4b_VH6AogRjL1TW2opsU8', formattedAddress: '1265 Lombardi Ave, Green Bay, WI 54304, USA', websiteUrl: null, lat: 44.5015057, lng: -88.0602601, mapsQuery: '1919 Kitchen & Tap, Green Bay' },
  { id: 'existing-citydeck', body: "Walk the 'CityDeck' along the Fox River at dusk and admit Green Bay is prettier than you expected", googlePlaceId: 'ChIJIZ3NNLT6AogR5IFjyqMYQYo', formattedAddress: '301 N Washington St, Green Bay, WI 54301, USA', websiteUrl: null, lat: 44.5168939, lng: -88.0154409, mapsQuery: 'CityDeck, Green Bay' },
]

test('reconcileAgainstExistingInventory: same venue + same experience (google_place_id match, near-identical body) is REUSED, not duplicated', () => {
  const candidates: ReconciliationCandidate[] = [
    { candidateName: '1919 Kitchen & Tap', body: "Eat at '1919 Kitchen & Tap' inside Lambeau Field when it's quiet on a non-game day.", googlePlaceId: 'ChIJVX4b_VH6AogRjL1TW2opsU8' },
  ]
  const result = reconcileAgainstExistingInventory(candidates, existingGreenBayItems)
  assert.equal(result.reused.length, 1)
  assert.equal(result.distinctSameVenue.length, 0)
  assert.equal(result.unmatched.length, 0)
  assert.equal(result.reused[0].existingItemId, 'existing-1919')
  assert.equal(result.reused[0].matchedBy, 'google_place_id')
})

test('reconcileAgainstExistingInventory: same venue but a MATERIALLY DIFFERENT proposed experience is retained as DISTINCT_SAME_VENUE, never silently dropped', () => {
  // The actual real-world case from the Green Bay incident: the pipeline
  // independently proposed a genuinely different hook at the same venue.
  const candidates: ReconciliationCandidate[] = [
    { candidateName: '1919 Kitchen & Tap (new)', body: "Choose from 40 craft beers while overlooking Lambeau's Atrium at '1919 Kitchen & Tap'.", googlePlaceId: 'ChIJVX4b_VH6AogRjL1TW2opsU8' },
  ]
  const result = reconcileAgainstExistingInventory(candidates, existingGreenBayItems)
  assert.equal(result.reused.length, 0, 'a genuinely different experience at the same venue must never be silently reused/dropped')
  assert.equal(result.distinctSameVenue.length, 1)
  assert.equal(result.distinctSameVenue[0].existingItemId, 'existing-1919')
  assert.equal(result.distinctSameVenue[0].matchedBy, 'google_place_id')
})

test('reconcileAgainstExistingInventory: canonical venue identity (quoted name) matches even without a google_place_id — REUSED when the wording is near-identical', () => {
  // Deliberately near-verbatim rewording (same content, same specific
  // hook) — the "same experience" case, distinct from the
  // materially-different-hook test above.
  const candidates: ReconciliationCandidate[] = [{ candidateName: 'CityDeck riverfront', body: "Walk the 'CityDeck' along the Fox River at dusk — admit Green Bay is prettier than expected." }]
  const result = reconcileAgainstExistingInventory(candidates, existingGreenBayItems)
  assert.equal(result.reused.length, 1, `expected a REUSE match, got: ${JSON.stringify(result)}`)
  assert.equal(result.reused[0].matchedBy, 'canonical_venue_identity')
  assert.equal(result.reused[0].existingItemId, 'existing-citydeck')
})

test('reconcileAgainstExistingInventory: address/geo proximity is a real, independent match method — found even when the venue name is spelled completely differently', () => {
  // A genuinely different-sounding candidate name/body at the SAME real
  // coordinates as an existing item — proves the address/geo method
  // itself works (matchedBy), independent of whether the resulting
  // match is judged REUSE or DISTINCT_SAME_VENUE (a separate, later
  // judgment covered by the dedicated same-experience tests above).
  const candidates: ReconciliationCandidate[] = [{ candidateName: 'The Riverwalk Boardwalk', body: "Stroll the riverside boardwalk downtown at dusk.", lat: 44.51689, lng: -88.01543 }] // ~2m from CityDeck's real coordinates
  const result = reconcileAgainstExistingInventory(candidates, existingGreenBayItems)
  const allMatches = [...result.reused, ...result.distinctSameVenue]
  assert.equal(allMatches.length, 1, `expected exactly one match (reused or distinct), got: ${JSON.stringify(result)}`)
  assert.equal(allMatches[0].matchedBy, 'address_geo')
  assert.equal(allMatches[0].existingItemId, 'existing-citydeck')
  assert.equal(result.unmatched.length, 0)
})

test('reconcileAgainstExistingInventory: website domain match works as the true last-resort method (only when the venue name itself is spelled differently and no coordinates are available)', () => {
  // Deliberately DIFFERENT quoted venue names/no coordinates on either
  // side, so neither the google_place_id, canonical-name, nor
  // address/geo methods can fire — proving the website check is a real,
  // independently-reachable fourth tier, not dead code shadowed by an
  // earlier method.
  const withWebsite: ExistingProductionItem[] = [{ id: 'existing-web', body: "Order the tasting flight at 'The Original Taproom'.", googlePlaceId: null, formattedAddress: null, websiteUrl: 'https://www.example-venue.com', lat: null, lng: null, mapsQuery: null }]
  const candidates: ReconciliationCandidate[] = [{ candidateName: 'Renamed Taproom Under New Ownership', body: "Order the tasting flight at 'Renamed Taproom Under New Ownership'.", websiteUrl: 'http://example-venue.com/menu' }]
  const result = reconcileAgainstExistingInventory(candidates, withWebsite)
  assert.equal(result.reused.length, 1)
  assert.equal(result.reused[0].matchedBy, 'website')
})

test('reconcileAgainstExistingInventory: a genuinely new venue with no match at all is UNMATCHED — safe to treat as new', () => {
  const candidates: ReconciliationCandidate[] = [{ candidateName: 'Brand New Taproom', body: "Order the seasonal flight at 'Brand New Taproom'.", googlePlaceId: 'p-totally-different' }]
  const result = reconcileAgainstExistingInventory(candidates, existingGreenBayItems)
  assert.equal(result.reused.length, 0)
  assert.equal(result.distinctSameVenue.length, 0)
  assert.equal(result.unmatched.length, 1)
  assert.equal(result.unmatched[0].candidateName, 'Brand New Taproom')
})

test('reconcileAgainstExistingInventory: an empty existing-inventory list matches nothing (never a crash, never a false match)', () => {
  const candidates: ReconciliationCandidate[] = [{ candidateName: 'Anything', body: "Do a thing at 'Anything'." }]
  const result = reconcileAgainstExistingInventory(candidates, [])
  assert.equal(result.unmatched.length, 1)
  assert.equal(result.reused.length, 0)
  assert.equal(result.distinctSameVenue.length, 0)
})
