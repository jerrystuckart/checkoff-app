import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  qualifyCandidate,
  determineCategory,
  validateTagSelection,
  checkForDuplicate,
  buildItemIntakeSql,
  validateItemIntakeCandidate,
  type ItemIntakeProposal,
} from './itemIntake'

// ---------------------------------------------------------------------------
// Golden fixtures (per the "Item Intake golden tests" requirement,
// Winston Night Shift 2026-09) — at least 10 real intake scenarios,
// including the "generic tacos" regression the whole hard-rejection rule
// exists to prevent.
// ---------------------------------------------------------------------------

// 1. Restaurant with a signature dish
test('golden 1 — restaurant with a signature dish qualifies', () => {
  const result = qualifyCandidate({ venueName: 'Fort Oak', claimedHook: 'signature dish is the 40-day dry-aged ribeye' })
  assert.equal(result.qualifies, true)
})

// 2. Bar with a secret/signature cocktail
test('golden 2 — bar with a named signature cocktail qualifies', () => {
  const result = qualifyCandidate({ venueName: 'Realm of the 52 Remedies', claimedHook: 'apothecary-inspired herbal cocktail menu, house specialty is the Golden Hour' })
  assert.equal(result.qualifies, true)
})

// 3. Hidden room/speakeasy
test('golden 3 — hidden entrance/feature qualifies', () => {
  const result = qualifyCandidate({ venueName: 'Raised by Wolves', claimedHook: 'entrance is hidden behind a rotating bookshelf' })
  assert.equal(result.qualifies, true)
})

// 4. Coffee shop with an unusual specialty
test('golden 4 — coffee shop with a named specialty drink qualifies', () => {
  const result = qualifyCandidate({ venueName: 'Black Mizu Café', claimedHook: 'signature drink is the White Miso Caramel Latte' })
  assert.equal(result.qualifies, true)
})

// 5. Activity venue
test('golden 5 — activity venue with a specific named activity qualifies', () => {
  const result = qualifyCandidate({ venueName: 'Barrio Glassworks', claimedHook: 'offers a hands-on glassblowing class where you make your own piece' })
  assert.equal(result.qualifies, true)
})

// 6. Bar whose CheckOff item is a drink, but business-wide tags include pool/darts/foosball —
// tested at the module level via validateTagSelection: the point is the module never restricts
// tag proposals to drink-only words, it validates whatever whole-venue tags are proposed.
test('golden 6 — tag validation accepts a business-wide tag mix (drink + pool/darts/foosball), not drink-only tags', () => {
  const known = new Set(['bar', 'cocktail', 'dive-bar', 'pool-tables', 'darts', 'foosball', 'karaoke', 'late-night', 'local-favorite', 'casual'])
  const result = validateTagSelection({
    tier1: ['bar', 'cocktail', 'dive-bar', 'pool-tables', 'darts'],
    tier2: ['karaoke', 'late-night', 'local-favorite'],
    knownRealTagNames: known,
  })
  assert.equal(result.valid, true)
  assert.equal(result.tier1.length, 5)
})

// 7. Screenshot-only resolved venue — this module doesn't do venue resolution itself
// (that's ChatGPT's job in the phone workflow), so the golden test here proves the
// pipeline works identically regardless of how the venue name/hook arrived.
test('golden 7 — a candidate resolved from a screenshot (venue name + hook already extracted) validates the same as any other input', () => {
  const result = validateItemIntakeCandidate({
    venueName: 'Peohe’s',
    claimedHook: 'signature dish is the Halibut Maiʻa, a 30-year guest favorite',
    rawCategoryHint: 'Seafood restaurant',
    tagProposal: {
      tier1: ['seafood', 'restaurant', 'waterfront', 'dinner', 'romantic'],
      tier2: ['views', 'coronado', 'date-night'],
      knownRealTagNames: new Set(['seafood', 'restaurant', 'waterfront', 'dinner', 'romantic', 'views', 'coronado', 'date-night']),
    },
    duplicateCheck: { candidateMapsQuery: 'Peohe’s, Coronado', candidateHook: 'Order the Halibut Maiʻa', existingItemsAtVenue: [] },
  })
  assert.equal(result.accepted, true)
})

// 8. Ambiguous venue requiring clarification — this module's qualifyCandidate correctly
// rejects when no real hook was ever resolved (the upstream ambiguity should have stopped
// the pipeline before this point, but if it reaches here with claimedHook: null, it must fail).
test('golden 8 — an unresolved/ambiguous venue with no hook is rejected, not guessed', () => {
  const result = qualifyCandidate({ venueName: 'Some Restaurant (ambiguous — multiple locations, unclear which one)', claimedHook: null })
  assert.equal(result.qualifies, false)
})

// 9. Submitted venue with NO genuinely special item -> rejection
test('golden 9 — a venue with only generic marketing-adjective claims is rejected (no SQL should ever be generated for this)', () => {
  const result = qualifyCandidate({ venueName: 'Generic Grill & Bar', claimedHook: 'good food, popular with locals, tasty burgers' })
  assert.equal(result.qualifies, false)
  assert.match(result.reason, /generic/i)
})

// 9b. The exact "generic tacos" regression named in the requirements.
test('golden 9b — "serves tacos" alone never qualifies (the generic-tacos regression)', () => {
  const result = qualifyCandidate({ venueName: 'Some Taco Shop', claimedHook: 'serves tacos' })
  assert.equal(result.qualifies, false)
})

test('golden 9c — a NAMED specific taco with a real detail does qualify (the fix, not just a stricter rejection)', () => {
  const result = qualifyCandidate({ venueName: 'Aqui Es Texcoco', claimedHook: 'signature dish is the barbacoa de borrego, a specific lamb barbacoa' })
  assert.equal(result.qualifies, true)
})

// 10. Existing exact duplicate
test('golden 10 — an exact duplicate (same venue, same hook already covered) is flagged, not re-inserted', () => {
  const result = checkForDuplicate({
    candidateMapsQuery: 'Cori Pastificio Trattoria, North Park',
    candidateHook: 'Order the cacio e pepe doughnuts',
    existingItemsAtVenue: [{ mapsQuery: 'Cori Pastificio Trattoria, North Park', body: 'Order the cacio e pepe doughnuts at Cori Pastificio Trattoria.' }],
  })
  assert.equal(result.verdict, 'EXACT_DUPLICATE')
})

// 11. Same venue with a distinct second CheckOff experience — same venue, different hook,
// must NOT be auto-rejected as a duplicate (needs human review, per "same venue != duplicate").
test('golden 11 — same venue, genuinely different hook, is flagged for review, never auto-rejected as duplicate', () => {
  const result = checkForDuplicate({
    candidateMapsQuery: 'Chicano Park, Barrio Logan',
    candidateHook: 'Visit the museum celebrating the park’s muralists',
    existingItemsAtVenue: [{ mapsQuery: 'Chicano Park, Barrio Logan', body: 'See the largest collection of Chicano murals at Chicano Park.' }],
  })
  assert.equal(result.verdict, 'SAME_VENUE_NEEDS_REVIEW')
})

// 12. Missing Google coordinates -> correct null/location-later behavior.
test('golden 12 — generated SQL never includes coordinates, only a strong maps_query', () => {
  const proposal: ItemIntakeProposal = {
    venueName: 'Fort Oak',
    checkoffizedItem: 'Order the 40-day dry-aged ribeye at Fort Oak.',
    categoryName: 'Food & drink',
    neighborhoodName: 'Mission Hills',
    checkinType: 'tap',
    mapsQuery: 'Fort Oak, Mission Hills, San Diego, CA',
    hasAlcohol: false,
    isRecurring: false,
    tier1Tags: ['steakhouse', 'restaurant', 'dinner', 'upscale', 'dry-aged'],
    tier2Tags: ['local-favorite', 'date-night', 'michelin'],
  }
  const sql = buildItemIntakeSql(proposal)
  assert.ok(!/maps_lat|maps_lng|geo_location/.test(sql), 'SQL must never set coordinate columns')
  assert.match(sql, /maps_query/)
  assert.match(sql, /Fort Oak, Mission Hills, San Diego, CA/)
})

// ---------------------------------------------------------------------------
// Additional unit coverage
// ---------------------------------------------------------------------------

test('determineCategory: an unrecognized category hint fails rather than guessing', () => {
  const result = determineCategory('Some Unclear Business Type')
  assert.equal(result.failed, true)
})

test('determineCategory: a recognizable category hint maps to a real production category', () => {
  const result = determineCategory('Cocktail Bar')
  assert.equal(result.failed, false)
  assert.equal(result.dbCategory, 'Bar & drinks')
})

test('validateTagSelection: rejects a proposal containing an unknown tag name — never silently drops it', () => {
  const known = new Set(['bar', 'cocktail', 'restaurant'])
  const result = validateTagSelection({
    tier1: ['bar', 'cocktail', 'restaurant', 'invented-tag-xyz', 'another-fake'],
    tier2: ['fake1', 'fake2', 'fake3'],
    knownRealTagNames: known,
  })
  assert.equal(result.valid, false)
  assert.ok(result.unknownNames.includes('invented-tag-xyz'))
})

test('validateTagSelection: rejects a proposal with the wrong tier split (must be 5 + 3)', () => {
  const known = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  const result = validateTagSelection({
    tier1: ['a', 'b', 'c', 'd'], // only 4, should be 5
    tier2: ['e', 'f', 'g', 'h'], // 4, should be 3
    knownRealTagNames: known,
  })
  assert.equal(result.valid, false)
})

test('validateItemIntakeCandidate: full pipeline rejects when ANY stage fails (category unresolvable), even if qualification passes', () => {
  const result = validateItemIntakeCandidate({
    venueName: 'Test Venue',
    claimedHook: 'signature dish is a specific named thing',
    rawCategoryHint: 'Completely Unrecognizable Category Type',
    tagProposal: {
      tier1: ['a', 'b', 'c', 'd', 'e'],
      tier2: ['f', 'g', 'h'],
      knownRealTagNames: new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
    },
    duplicateCheck: { candidateMapsQuery: 'Test Venue, Somewhere', candidateHook: 'x', existingItemsAtVenue: [] },
  })
  assert.equal(result.accepted, false)
  assert.match(result.summary, /category/)
})

test('validateItemIntakeCandidate: accepts a fully valid candidate end to end', () => {
  const result = validateItemIntakeCandidate({
    venueName: 'Nómada',
    claimedHook: 'signature dish is wood-fired oysters topped with hoja santa and smoked cotija',
    rawCategoryHint: 'Regional Mexican restaurant',
    tagProposal: {
      tier1: ['restaurant', 'mexican', 'seafood', 'oyster-bar', 'dinner'],
      tier2: ['carlsbad', 'date-night', 'craft-cocktails'],
      knownRealTagNames: new Set(['restaurant', 'mexican', 'seafood', 'oyster-bar', 'dinner', 'carlsbad', 'date-night', 'craft-cocktails']),
    },
    duplicateCheck: { candidateMapsQuery: 'Nómada, Carlsbad', candidateHook: 'Order the wood-fired oysters', existingItemsAtVenue: [] },
  })
  assert.equal(result.accepted, true)
})
