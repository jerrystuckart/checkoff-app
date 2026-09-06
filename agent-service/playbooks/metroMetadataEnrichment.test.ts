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
// has_alcohol — an ITEM property, not a venue property (2026-09-06 correction)
// ---------------------------------------------------------------------------

test('determineHasAlcohol: body names a specific cocktail -> true, HIGH confidence', () => {
  const r = determineHasAlcohol({ body: 'Order the Chanterelle cocktail at Jeune et Jolie.', dbCategory: 'Bar & drinks' })
  assert.equal(r.value, true)
  assert.equal(r.confidence, 'HIGH')
})

test('determineHasAlcohol: a bar/nightlife category with NO named drink -> false (category alone never forces true)', () => {
  const r = determineHasAlcohol({ body: 'Dance at Rich\'s.', dbCategory: 'Bar & drinks' })
  assert.equal(r.value, false)
})

test('determineHasAlcohol: "Order a tiki cocktail at False Idol" -> true', () => {
  const r = determineHasAlcohol({ body: 'Order a tiki cocktail at False Idol, San Diego\'s top-ranked occasion bar.', dbCategory: 'Bar & drinks' })
  assert.equal(r.value, true)
})

test('determineHasAlcohol: "Order a local craft beer at Bosiger Beer" -> true', () => {
  const r = determineHasAlcohol({ body: 'Order a local craft beer at Bosiger Beer inside Plaza Fiesta.', dbCategory: 'Bar & drinks' })
  assert.equal(r.value, true)
})

test('determineHasAlcohol: "Order the Paella Negra" at a restaurant that also serves alcohol -> false, the dish itself is not alcohol', () => {
  const r = determineHasAlcohol({ body: 'Order the Paella Negra at Telefèric Barcelona.', dbCategory: 'Food & drink' })
  assert.equal(r.value, false)
})

test('determineHasAlcohol: coffee shop, no alcohol keyword, non-alcohol category -> false', () => {
  const r = determineHasAlcohol({ body: 'Order a lavender latte at Bird Rock Coffee Roasters.', dbCategory: 'Food & drink' })
  assert.equal(r.value, false)
  assert.equal(r.confidence, 'HIGH')
})

// The exact substring-false-positive regression the correction called out.
for (const word of ['Whaley', 'whale', 'Daley', 'Valley', 'tamale', 'gallery']) {
  test(`determineHasAlcohol REGRESSION: "${word}" never triggers a false positive via the embedded substring "ale"`, () => {
    const r = determineHasAlcohol({ body: `Visit the ${word} exhibit downtown.`, dbCategory: 'Arts & Culture' })
    assert.equal(r.value, false)
  })
}

test('determineHasAlcohol REGRESSION: a genuine standalone "ale" still triggers true', () => {
  const r = determineHasAlcohol({ body: 'Order a pale ale at the local brewery taproom.', dbCategory: 'Bar & drinks' })
  assert.equal(r.value, true)
})

test('determineHasAlcohol REGRESSION: "gin" does not fire inside "imagine" or "original"', () => {
  const r1 = determineHasAlcohol({ body: 'Imagine the possibilities at this art installation.', dbCategory: 'Arts & Culture' })
  assert.equal(r1.value, false)
  const r2 = determineHasAlcohol({ body: 'Try the original recipe at this bakery.', dbCategory: 'Food & drink' })
  assert.equal(r2.value, false)
})

test('determineHasAlcohol REGRESSION: "rum" does not fire inside "drum" or "forum"', () => {
  const r1 = determineHasAlcohol({ body: 'Play the drum circle at the beach.', dbCategory: 'Adventure' })
  assert.equal(r1.value, false)
  const r2 = determineHasAlcohol({ body: 'Attend the public forum downtown.', dbCategory: 'Social' })
  assert.equal(r2.value, false)
})

test('determineHasAlcohol: touring a winery with no drink named -> false (venue-type word alone is not an item action)', () => {
  const r = determineHasAlcohol({ body: 'Tour the historic winery grounds.', dbCategory: 'Travel' })
  assert.equal(r.value, false)
})

test('determineHasAlcohol: a wine tasting IS the item action -> true', () => {
  const r = determineHasAlcohol({ body: 'Join a wine tasting flight at the vineyard.', dbCategory: 'Food & drink' })
  assert.equal(r.value, true)
})

// ---------------------------------------------------------------------------
// photo_required / checkin_type — unchanged behavior
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
// is_secret — NEVER inferred from wording (2026-09-06 correction)
// ---------------------------------------------------------------------------

test('determineIsSecret: no explicit paid config -> false, HIGH confidence, regardless of body', () => {
  const r = determineIsSecret(undefined)
  assert.equal(r.value, false)
  assert.equal(r.confidence, 'HIGH')
})

test('determineIsSecret: an EXPLICIT paid/business-configured flag IS preserved as true', () => {
  const r = determineIsSecret(true)
  assert.equal(r.value, true)
  assert.equal(r.preservedManualOverride, true)
})

test('determineIsSecret: signature does not accept body at all — hidden-entrance wording cannot influence it', () => {
  // TypeScript itself enforces this (the function only takes a boolean | undefined) —
  // this test documents the intent: there is no parameter through which "Noble
  // Experiment"-style concealed-entrance wording could reach this function.
  assert.equal(determineIsSecret.length, 1)
})

// ---------------------------------------------------------------------------
// difficulty — completion-EFFORT rubric, not prestige (2026-09-06 correction)
// ---------------------------------------------------------------------------

test('determineDifficulty: ordinary item -> 1, HIGH confidence', () => {
  const r = determineDifficulty({ body: 'Order a burger.', dbCategory: 'Food & drink' })
  assert.equal(r.value, 1)
  assert.equal(r.confidence, 'HIGH')
})

test('determineDifficulty: a concealed/hidden-entrance venue alone does NOT raise the tier', () => {
  const r = determineDifficulty({ body: 'Enter Noble Experiment through the concealed keg wall to find this hidden speakeasy.', dbCategory: 'Bar & drinks' })
  assert.equal(r.value, 1)
})

test('determineDifficulty: "Michelin-starred" alone does NOT raise the tier (prestige is not effort)', () => {
  const r = determineDifficulty({ body: 'Order the tasting menu at this Michelin-starred restaurant.', dbCategory: 'Food & drink' })
  assert.equal(r.value, 1)
})

test('determineDifficulty: genuine reservation-only exclusivity -> proposes 5, LOW confidence', () => {
  const r = determineDifficulty({ body: 'Book the reservation-only omakase counter.', dbCategory: 'Food & drink' })
  assert.equal(r.value, 5)
  assert.equal(r.confidence, 'LOW')
})

test('determineDifficulty: booked adventure activity (hot air balloon) -> proposes 5', () => {
  const r = determineDifficulty({ body: 'Soar above the coast on a hot air balloon ride.', dbCategory: 'Adventure' })
  assert.equal(r.value, 5)
})

test('determineDifficulty: guided kayak / whale watch can reasonably be 5', () => {
  const r1 = determineDifficulty({ body: 'Paddle through the sea caves on a guided kayaking tour.', dbCategory: 'Adventure' })
  assert.equal(r1.value, 5)
  const r2 = determineDifficulty({ body: 'Spot gray whales on a whale watching cruise.', dbCategory: 'Adventure' })
  assert.equal(r2.value, 5)
})

test('determineDifficulty: skydiving -> proposes 10, LOW confidence', () => {
  const r = determineDifficulty({ body: 'Jump out of a plane on a tandem skydiving experience.', dbCategory: 'Adventure' })
  assert.equal(r.value, 10)
  assert.equal(r.confidence, 'LOW')
})

test('determineDifficulty: never proposes 25 automatically', () => {
  const bodies = [
    'Enter through the hidden entrance for a members-only tasting.',
    'Book the sold-out chef\'s table experience.',
    'Skydive over the coast.',
  ]
  for (const body of bodies) {
    const r = determineDifficulty({ body, dbCategory: 'Adventure' })
    assert.notEqual(r.value, 25)
  }
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

// Adventure-activity reclassification (2026-09-06 correction): booked,
// operator-scheduled activities should be 'event', not 'outdoor'/'attraction'.
for (const [body, label] of [
  ['Spot gray whales on a whale watching cruise.', 'whale watching'],
  ['Cruise with dolphins on a dolphin cruise.', 'dolphin cruise'],
  ['Speed across the bay on a jet boat ride.', 'jet boat'],
  ['Soar above the coast on a hot air balloon ride.', 'hot air balloon'],
  ['Glide over the cliffs paragliding.', 'paragliding'],
  ['Soar with a hang gliding lesson.', 'hang gliding'],
  ['Dive with great whites on a shark diving excursion.', 'shark diving'],
  ['Fly through the canopy on a zip line course.', 'zip line'],
] as const) {
  test(`determineVisitProfileKey: "${label}" reclassified from outdoor/attraction to event`, () => {
    const r = determineVisitProfileKey({ body, dbCategory: 'Adventure' })
    assert.equal(r.value, 'event')
  })
}

// ---------------------------------------------------------------------------
// website_url — always requires research, never fabricated
// ---------------------------------------------------------------------------

test('determineWebsiteUrl: always evaluated=false, defers to the Google Places phase', () => {
  const r = determineWebsiteUrl({ candidateName: 'By The Sea' })
  assert.equal(r.evaluated, false)
  assert.match(r.nextStep, /Google Places/)
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
    existing: { difficulty: 10, photoRequired: true, hasAlcohol: false },
  })
  assert.equal(r.difficulty.value, 10)
  assert.equal(r.difficulty.preservedManualOverride, true)
  assert.equal(r.photoRequired.value, true)
  assert.equal(r.photoRequired.preservedManualOverride, true)
  // checkin_type must follow the PRESERVED photo_required, not the freshly-evaluated one.
  assert.equal(r.checkinType.value, 'photo')
  // is_secret is untouched by any of this — no paid config was passed, so it's false.
  assert.equal(r.isSecret.value, false)
})

test('evaluateItemMetadata: existing value that merely MATCHES the default is NOT treated as a manual override', () => {
  const r = evaluateItemMetadata({
    candidateName: 'Some Restaurant',
    body: 'Order the tasting menu.',
    dbCategory: 'Food & drink',
    existing: { difficulty: 1, hasAlcohol: false, photoRequired: false },
  })
  assert.equal(r.difficulty.preservedManualOverride, undefined)
  assert.equal(r.hasAlcohol.preservedManualOverride, undefined)
})

test('evaluateItemMetadata: hidden-speakeasy wording never sets is_secret=true even with no existing data', () => {
  const r = evaluateItemMetadata({ candidateName: 'Noble Experiment', body: 'Enter Noble Experiment through the concealed keg wall to find this hidden speakeasy.', dbCategory: 'Bar & drinks' })
  assert.equal(r.isSecret.value, false)
  assert.equal(r.difficulty.value, 1)
})

test('evaluateItemMetadata: an explicit isSecretConfigured=true IS preserved', () => {
  const r = evaluateItemMetadata({ candidateName: 'Some Paid Secret Venue', body: 'Find the hidden reveal.', dbCategory: 'Food & drink', existing: { isSecretConfigured: true } })
  assert.equal(r.isSecret.value, true)
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
