import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  determineHasAlcohol,
  determinePhotoRequired,
  determineCheckinType,
  determineIsSecret,
  determineDifficulty,
  determineVisitProfileKey,
  determineWebsiteUrl,
  evaluateItemMetadata,
  evaluateMetadataCompletenessGate,
  evaluateGeoEnrichmentGate,
} from './metroMetadataEnrichment'

// ---------------------------------------------------------------------------
// has_alcohol
// ---------------------------------------------------------------------------

test('determineHasAlcohol: body names a specific cocktail -> true, HIGH confidence', () => {
  const r = determineHasAlcohol({ body: 'Order the Chanterelle cocktail at Jeune et Jolie.', dbCategory: 'Bar & drinks' })
  assert.equal(r.value, true)
  assert.equal(r.confidence, 'HIGH')
})

test('determineHasAlcohol: Bar & drinks category with no named drink -> true, MEDIUM confidence', () => {
  const r = determineHasAlcohol({ body: 'Visit the rooftop lounge for sunset views.', dbCategory: 'Bar & drinks' })
  assert.equal(r.value, true)
  assert.equal(r.confidence, 'MEDIUM')
})

test('determineHasAlcohol: coffee shop, no alcohol keyword, non-alcohol category -> false', () => {
  const r = determineHasAlcohol({ body: 'Order a lavender latte at Bird Rock Coffee Roasters.', dbCategory: 'Food & drink' })
  assert.equal(r.value, false)
  assert.equal(r.confidence, 'HIGH')
})

// ---------------------------------------------------------------------------
// photo_required / checkin_type
// ---------------------------------------------------------------------------

test('determinePhotoRequired: body instructs a photo -> true', () => {
  const r = determinePhotoRequired({ body: 'Snap a selfie with the giant anchor downtown.' })
  assert.equal(r.value, true)
})

test('determinePhotoRequired: ordinary body -> false, MEDIUM confidence', () => {
  const r = determinePhotoRequired({ body: 'Order the BTS Burger at By The Sea.' })
  assert.equal(r.value, false)
  assert.equal(r.confidence, 'MEDIUM')
})

test('determineCheckinType: mirrors photo_required=true -> photo', () => {
  const photoRequired = determinePhotoRequired({ body: 'Take a photo with the mural.' })
  const r = determineCheckinType(photoRequired)
  assert.equal(r.value, 'photo')
})

test('determineCheckinType: photo_required=false -> tap, never gps (no production precedent)', () => {
  const photoRequired = determinePhotoRequired({ body: 'Order the tacos.' })
  const r = determineCheckinType(photoRequired)
  assert.equal(r.value, 'tap')
})

// ---------------------------------------------------------------------------
// is_secret
// ---------------------------------------------------------------------------

test('determineIsSecret: hidden speakeasy language -> true, MEDIUM confidence (human should confirm)', () => {
  const r = determineIsSecret({ body: 'Enter Noble Experiment through the concealed keg wall to find this hidden speakeasy.' })
  assert.equal(r.value, true)
  assert.equal(r.confidence, 'MEDIUM')
})

test('determineIsSecret: "hidden gem" turn of phrase alone does NOT trigger true', () => {
  const r = determineIsSecret({ body: 'This hidden gem serves the best tacos in town.' })
  assert.equal(r.value, false)
})

test('determineIsSecret: ordinary venue -> false, HIGH confidence', () => {
  const r = determineIsSecret({ body: 'Watch Orca Encounter at SeaWorld San Diego.' })
  assert.equal(r.value, false)
  assert.equal(r.confidence, 'HIGH')
})

// ---------------------------------------------------------------------------
// difficulty
// ---------------------------------------------------------------------------

test('determineDifficulty: ordinary item -> 1, HIGH confidence', () => {
  const isSecret = determineIsSecret({ body: 'Order a burger.' })
  const r = determineDifficulty({ body: 'Order a burger.', dbCategory: 'Food & drink' }, isSecret)
  assert.equal(r.value, 1)
  assert.equal(r.confidence, 'HIGH')
})

test('determineDifficulty: secret venue -> proposes 10, LOW confidence (flagged for human)', () => {
  const isSecret = determineIsSecret({ body: 'Enter through the hidden entrance behind the bookshelf.' })
  const r = determineDifficulty({ body: 'Enter through the hidden entrance behind the bookshelf.', dbCategory: 'Bar & drinks' }, isSecret)
  assert.equal(r.value, 10)
  assert.equal(r.confidence, 'LOW')
})

test('determineDifficulty: reservation-required exclusivity -> proposes 5, LOW confidence', () => {
  const isSecret = determineIsSecret({ body: 'Reserve a table at the Michelin-starred restaurant.' })
  const r = determineDifficulty({ body: 'Reserve a table at the Michelin-starred restaurant.', dbCategory: 'Food & drink' }, isSecret)
  assert.equal(r.value, 5)
  assert.equal(r.confidence, 'LOW')
})

test('determineDifficulty: booked adventure activity -> proposes 5, LOW confidence', () => {
  const isSecret = determineIsSecret({ body: 'Paddle through the sea caves with a kayaking tour.' })
  const r = determineDifficulty({ body: 'Paddle through the sea caves with a kayaking tour.', dbCategory: 'Adventure' }, isSecret)
  assert.equal(r.value, 5)
})

// ---------------------------------------------------------------------------
// visit_profile_key
// ---------------------------------------------------------------------------

test('determineVisitProfileKey: Bar & drinks -> bar, HIGH confidence', () => {
  const r = determineVisitProfileKey({ body: 'Order a cocktail.', dbCategory: 'Bar & drinks' })
  assert.equal(r.value, 'bar')
  assert.equal(r.confidence, 'HIGH')
})

test('determineVisitProfileKey: Shopping -> retail', () => {
  const r = determineVisitProfileKey({ body: 'Browse the boutique.', dbCategory: 'Shopping' })
  assert.equal(r.value, 'retail')
})

test('determineVisitProfileKey: Food & drink with coffee keyword -> quick_stop', () => {
  const r = determineVisitProfileKey({ body: 'Order a latte at the coffee counter.', dbCategory: 'Food & drink' })
  assert.equal(r.value, 'quick_stop')
})

test('determineVisitProfileKey: Food & drink with taco/food-truck keyword -> fast_casual', () => {
  const r = determineVisitProfileKey({ body: 'Order tacos at the food truck.', dbCategory: 'Food & drink' })
  assert.equal(r.value, 'fast_casual')
})

test('determineVisitProfileKey: Food & drink with no quick/fast signal -> restaurant, MEDIUM confidence', () => {
  const r = determineVisitProfileKey({ body: 'Order the tasting menu.', dbCategory: 'Food & drink' })
  assert.equal(r.value, 'restaurant')
  assert.equal(r.confidence, 'MEDIUM')
})

test('determineVisitProfileKey: Adventure with park keyword -> outdoor', () => {
  const r = determineVisitProfileKey({ body: 'Walk through the botanical garden park.', dbCategory: 'Adventure' })
  assert.equal(r.value, 'outdoor')
})

test('determineVisitProfileKey: Adventure with monument keyword -> landmark', () => {
  const r = determineVisitProfileKey({ body: 'Visit the historic monument.', dbCategory: 'Adventure' })
  assert.equal(r.value, 'landmark')
})

test('determineVisitProfileKey: Sports with game keyword -> event', () => {
  const r = determineVisitProfileKey({ body: 'Watch the game at the stadium.', dbCategory: 'Sports' })
  assert.equal(r.value, 'event')
})

test('determineVisitProfileKey: Arts & Culture -> attraction', () => {
  const r = determineVisitProfileKey({ body: 'Tour the museum.', dbCategory: 'Arts & Culture' })
  assert.equal(r.value, 'attraction')
})

test('determineVisitProfileKey: Misc -> manual_only, LOW confidence, never a guessed profile', () => {
  const r = determineVisitProfileKey({ body: 'Do the thing.', dbCategory: 'Misc' })
  assert.equal(r.value, 'manual_only')
  assert.equal(r.confidence, 'LOW')
})

// ---------------------------------------------------------------------------
// website_url — always requires research, never fabricated
// ---------------------------------------------------------------------------

test('determineWebsiteUrl: always evaluated=false, never invents a URL', () => {
  const r = determineWebsiteUrl({ candidateName: 'By The Sea' })
  assert.equal(r.evaluated, false)
  assert.match(r.nextStep, /By The Sea/)
})

// ---------------------------------------------------------------------------
// evaluateItemMetadata — full integration + manual-override preservation
// ---------------------------------------------------------------------------

test('evaluateItemMetadata: The Goods manual override (difficulty=10, photo_required=true) is preserved verbatim, not overwritten', () => {
  const r = evaluateItemMetadata({
    candidateName: 'The Goods',
    body: 'Order artisan doughnuts, including gluten-free or vegan options, at The Goods, 2965 State St, Carlsbad.',
    dbCategory: 'Food & drink',
    existing: { difficulty: 10, photoRequired: true, hasAlcohol: false, isSecret: false },
  })
  assert.equal(r.difficulty.value, 10)
  assert.equal(r.difficulty.preservedManualOverride, true)
  assert.equal(r.photoRequired.value, true)
  assert.equal(r.photoRequired.preservedManualOverride, true)
  // checkin_type must follow the PRESERVED photo_required, not the freshly-evaluated one.
  assert.equal(r.checkinType.value, 'photo')
})

test('evaluateItemMetadata: existing value that merely MATCHES the default is NOT treated as a manual override', () => {
  const r = evaluateItemMetadata({
    candidateName: 'Some Restaurant',
    body: 'Order the tasting menu.',
    dbCategory: 'Food & drink',
    existing: { difficulty: 1, hasAlcohol: false, photoRequired: false, isSecret: false },
  })
  assert.equal(r.difficulty.preservedManualOverride, undefined)
  assert.equal(r.hasAlcohol.preservedManualOverride, undefined)
})

test('evaluateItemMetadata: no existing data at all still produces a fully evaluated record', () => {
  const r = evaluateItemMetadata({ candidateName: 'New Venue', body: 'Order a burger.', dbCategory: 'Food & drink' })
  assert.equal(r.hasAlcohol.evaluated, true)
  assert.equal(r.photoRequired.evaluated, true)
  assert.equal(r.checkinType.evaluated, true)
  assert.equal(r.isSecret.evaluated, true)
  assert.equal(r.difficulty.evaluated, true)
  assert.equal(r.visitProfileKey.evaluated, true)
  assert.equal(r.websiteUrl.evaluated, false)
})

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

test('evaluateMetadataCompletenessGate: PASSes when every item is fully evaluated (website_url research need does not block it)', () => {
  const results = [
    evaluateItemMetadata({ candidateName: 'A', body: 'Order a burger.', dbCategory: 'Food & drink' }),
    evaluateItemMetadata({ candidateName: 'B', body: 'Order a cocktail.', dbCategory: 'Bar & drinks' }),
  ]
  const gate = evaluateMetadataCompletenessGate(results)
  assert.equal(gate.verdict, 'PASS')
  assert.match(gate.reason, /2 item\(s\) still need a targeted website_url research pass/)
})

test('evaluateMetadataCompletenessGate: FAILs on an empty result set', () => {
  const gate = evaluateMetadataCompletenessGate([])
  assert.equal(gate.verdict, 'FAIL')
})

test('evaluateMetadataCompletenessGate: FAILs if any of the 6 non-website fields was never evaluated', () => {
  const results = [
    evaluateItemMetadata({ candidateName: 'A', body: 'Order a burger.', dbCategory: 'Food & drink' }),
  ]
  // Simulate a field that was never actually evaluated (evaluated: false) — the gate must
  // catch this even though a "value" is still technically present, per the whole point of
  // this module: a present value is not proof of evaluation.
  ;(results[0] as any).hasAlcohol = { evaluated: false, value: false }
  const gate = evaluateMetadataCompletenessGate(results)
  assert.equal(gate.verdict, 'FAIL')
  assert.match(gate.reason, /A\.hasAlcohol/)
})

test('evaluateGeoEnrichmentGate: FAILs by default with no fabricated "not needed" escape hatch', () => {
  const gate = evaluateGeoEnrichmentGate(false, '')
  assert.equal(gate.verdict, 'FAIL')
})

test('evaluateGeoEnrichmentGate: PASSes once the Google Places pass has actually run', () => {
  const gate = evaluateGeoEnrichmentGate(true, '149/149 items geocoded.')
  assert.equal(gate.verdict, 'PASS')
})
