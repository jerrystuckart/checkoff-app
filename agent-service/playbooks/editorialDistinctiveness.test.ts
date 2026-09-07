import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkDistinctiveExperience, checkVenueQuoted, evaluateOpeningDistributionGate, certifyEditorialDistinctiveness, REJECT_NO_DISTINCTIVE_EXPERIENCE } from './editorialDistinctiveness'

// ---------------------------------------------------------------------------
// 1. REJECT_NO_DISTINCTIVE_EXPERIENCE — required regression cases.
// ---------------------------------------------------------------------------

test('generic mall item "Go shopping at all the stores at the mall" FAILS the distinctive-experience gate', () => {
  const result = checkDistinctiveExperience("Go shopping at all the stores at the mall")
  assert.equal(result.pass, false)
  assert.equal(result.matchedConcept, 'shop-at-the-mall')
  assert.match(result.reason, new RegExp(REJECT_NO_DISTINCTIVE_EXPERIENCE))
})

test('a bare count of the venue\'s own generic category ("more than 200 stores" at a mall) does NOT rescue an otherwise-generic sentence — Jerry\'s exact worked FAIL example', () => {
  const result = checkDistinctiveExperience("Browse more than 200 stores at 'Fashion Valley Mall'.", 'Fashion Valley Mall')
  assert.equal(result.pass, false)
  assert.equal(result.matchedConcept, 'shop-at-the-mall')
})

test('a digit that is NOT a bare count of the generic category still qualifies as a rescuing detail (e.g. a year, or a count of a named product)', () => {
  const yearRescue = checkDistinctiveExperience("Shop the vintage vinyl collection dating back to 1965 at 'Off the Record'.", 'Off the Record')
  assert.equal(yearRescue.pass, true)
})

test('generic restaurant/museum/bar versions fail even with synonym changes — synonym rotation never satisfies the gate', () => {
  const generic = [
    'Explore the shops at Westfield Mall',
    'Discover the boutiques at the shopping center',
    'Try the food at this restaurant',
    'Enjoy a meal at the local eatery',
    'Have a drink at the bar',
    'Sip something at this cozy pub',
    'See the art at the museum',
    'Check out the exhibits at the gallery',
    'Visit the beach',
    'Head to the coastline',
    'Experience the nightlife',
    'Immerse yourself in the club scene',
  ]
  for (const body of generic) {
    const result = checkDistinctiveExperience(body)
    assert.equal(result.pass, false, `expected "${body}" to fail — synonym rotation must not rescue a generic concept`)
  }
})

test('a genuinely specific product/object/ritual/activity passes', () => {
  const specific = [
    "Try the cacio e pepe doughnuts at 'Cori Pastificio Trattoria'",
    "See the shark-bitten surfboard at 'California Surf Museum'",
    "Order the Half Century Highball at 'Hennessey's Tavern'",
    "Shop the handmade leather goods at 'La Bufadora Market'",
    "Watch the glassblowers hand-forge a piece at 'Blue Sky Studio'",
  ]
  for (const body of specific) {
    const result = checkDistinctiveExperience(body)
    assert.equal(result.pass, true, `expected "${body}" to pass: ${result.reason}`)
  }
})

test('checkDistinctiveExperience: a body with no generic concept at all passes trivially', () => {
  assert.equal(checkDistinctiveExperience("Climb the lighthouse steps at 'Old Point Loma Lighthouse'").pass, true)
})

// ---------------------------------------------------------------------------
// 2. Venue-name single-quoting.
// ---------------------------------------------------------------------------

test('every final venue name is single-quoted', () => {
  const result = checkVenueQuoted("Try the cacio e pepe doughnuts at 'Cori Pastificio Trattoria'", 'Cori Pastificio Trattoria')
  assert.equal(result.pass, true)
})

test('an apostrophe-containing venue like Hennessey\'s is correctly represented and recognized', () => {
  const result = checkVenueQuoted("Order the Half Century Highball at 'Hennessey's Tavern'", "Hennessey's Tavern")
  assert.equal(result.pass, true)
})

test('checkVenueQuoted: fails when the venue name appears unquoted', () => {
  const result = checkVenueQuoted('Order the Half Century Highball at Hennessey\'s Tavern', "Hennessey's Tavern")
  assert.equal(result.pass, false)
  assert.match(result.reason, /does not appear wrapped in single quotes/)
})

test('checkVenueQuoted: accepts curly quotes as equivalent to straight quotes', () => {
  const result = checkVenueQuoted('Order the flight at ‘Coronado Brewing Co’', 'Coronado Brewing Co')
  assert.equal(result.pass, true)
})

// ---------------------------------------------------------------------------
// 3. Hard opening-word distribution gate.
// ---------------------------------------------------------------------------

test('no opening verb exceeds the configured distribution threshold — the real San Diego "Order" incident (~44/149, ~30%) fails hard', () => {
  const bodies = [
    ...Array.from({ length: 44 }, (_, i) => `Order the special dish number ${i} at 'Venue ${i}'`),
    ...Array.from({ length: 105 }, (_, i) => `See the exhibit number ${i} at 'Other Venue ${i}'`),
  ]
  const result = evaluateOpeningDistributionGate({ bodies })
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.reason, /"order" opens 44\/149 items \(30%/)
})

test('evaluateOpeningDistributionGate: a healthy long-tail distribution passes', () => {
  const openers = ['Order', 'See', 'Try', 'Watch', 'Climb', 'Ride', 'Taste', 'Explore', 'Visit', 'Grab', 'Sample', 'Tour']
  const bodies = Array.from({ length: 60 }, (_, i) => `${openers[i % openers.length]} something specific at 'Venue ${i}'`)
  const result = evaluateOpeningDistributionGate({ bodies })
  assert.equal(result.verdict, 'PASS')
})

test('evaluateOpeningDistributionGate: batches below the minimum size are exempt, not force-passed by dilution', () => {
  const bodies = Array.from({ length: 5 }, (_, i) => `Order item ${i} at 'Venue ${i}'`)
  const result = evaluateOpeningDistributionGate({ bodies })
  assert.equal(result.verdict, 'PASS')
  assert.match(result.reason, /below the .* minimum/)
})

test('evaluateOpeningDistributionGate: a tightened threshold is honored when explicitly supplied', () => {
  const distinctOpeners = ['See', 'Try', 'Watch', 'Climb', 'Ride', 'Taste', 'Explore', 'Visit', 'Grab', 'Sample', 'Tour', 'Browse', 'Sip', 'Tap', 'Snap', 'Walk', 'Feel']
  const bodies = [...Array.from({ length: 3 }, (_, i) => `Order item ${i} at 'Venue ${i}'`), ...distinctOpeners.map((w, i) => `${w} item ${i} at 'Venue ${i}'`)]
  // 3/20 = 15% for "Order," every other opener used exactly once — passes the default 15% max, but fails a tightened 10% max.
  assert.equal(bodies.length, 20)
  assert.equal(evaluateOpeningDistributionGate({ bodies }).verdict, 'PASS')
  assert.equal(evaluateOpeningDistributionGate({ bodies, maxShare: 0.1 }).verdict, 'FAIL')
})

// ---------------------------------------------------------------------------
// Combined certification.
// ---------------------------------------------------------------------------

test('certifyEditorialDistinctiveness: a clean catalog passes all three gates', () => {
  const items = [
    { candidateName: 'a', venueName: 'Cori Pastificio Trattoria', body: "Try the cacio e pepe doughnuts at 'Cori Pastificio Trattoria'" },
    { candidateName: 'b', venueName: 'California Surf Museum', body: "See the shark-bitten surfboard at 'California Surf Museum'" },
    { candidateName: 'c', venueName: "Hennessey's Tavern", body: "Order the Half Century Highball at 'Hennessey's Tavern'" },
  ]
  const result = certifyEditorialDistinctiveness(items)
  assert.ok(result.gates.every((g) => g.verdict === 'PASS'))
  assert.equal(result.distinctiveFailures.length, 0)
  assert.equal(result.quotingFailures.length, 0)
})

test('certifyEditorialDistinctiveness: catches both a generic item AND a separately missing quote in the same batch', () => {
  const items = [
    { candidateName: 'generic-one', venueName: 'Westfield UTC', body: "Go shopping at all the stores at 'Westfield UTC'" },
    { candidateName: 'unquoted-one', venueName: 'Cori Pastificio Trattoria', body: 'Try the cacio e pepe doughnuts at Cori Pastificio Trattoria' },
  ]
  const result = certifyEditorialDistinctiveness(items)
  const distinctiveGate = result.gates.find((g) => g.key === 'DISTINCTIVE_EXPERIENCE_GATE')!
  const quotingGate = result.gates.find((g) => g.key === 'VENUE_QUOTING_GATE')!
  assert.equal(distinctiveGate.verdict, 'FAIL')
  assert.equal(quotingGate.verdict, 'FAIL')
  assert.equal(result.distinctiveFailures.length, 1)
  assert.equal(result.distinctiveFailures[0].candidateName, 'generic-one')
  assert.equal(result.quotingFailures.length, 1)
  assert.equal(result.quotingFailures[0].candidateName, 'unquoted-one')
})
