import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCoverCandidateVenueName } from './coverCandidateVenue.js'

const CRUST_RAVEN_BODY =
  "As you approach Crust's kitchen slip into 'The Raven' — order a cocktail inside the restaurant's moody hidden lounge"

const DOAKY_BODY = 'Order the fried-then-grilled jalapeños at "Doaky\'s Kitchen"'

test('relational partner name wins even when legacy text would also match (something else)', () => {
  const result = resolveCoverCandidateVenueName({
    partnerBusinessName: 'Red Zone Sports Grill',
    outreachTokenBusinessName: null,
    itemBody: "Order the fried-then-grilled jalapeños at 'Some Other Name'",
  })
  assert.equal(result.venueName, 'Red Zone Sports Grill')
  assert.equal(result.venueNameSource, 'partner')
})

test('outreach token business name resolves for a business-submission candidate with no partner row', () => {
  const result = resolveCoverCandidateVenueName({
    partnerBusinessName: null,
    outreachTokenBusinessName: '85 Local',
    itemBody: null,
  })
  assert.equal(result.venueName, '85 Local')
  assert.equal(result.venueNameSource, 'outreach_token')
})

test('legacy "at \'Venue\'" text fallback still resolves when no relational data exists (Doaky)', () => {
  const result = resolveCoverCandidateVenueName({
    partnerBusinessName: null,
    outreachTokenBusinessName: null,
    itemBody: DOAKY_BODY,
  })
  assert.equal(result.venueName, "Doaky's Kitchen")
  assert.equal(result.venueNameSource, 'legacy_text')
})

test('Crust-style prose with no " at \'...\'" clause and no relation safely returns missing, never invented', () => {
  const result = resolveCoverCandidateVenueName({
    partnerBusinessName: null,
    outreachTokenBusinessName: null,
    itemBody: CRUST_RAVEN_BODY,
  })
  assert.equal(result.venueName, null)
  assert.equal(result.venueNameSource, 'missing')
  assert.notEqual(result.venueName, 'Crust Simply Italian')
})

test('venueNameSource is reported correctly across all four resolution outcomes', () => {
  assert.equal(
    resolveCoverCandidateVenueName({ partnerBusinessName: 'X', outreachTokenBusinessName: 'Y', itemBody: null })
      .venueNameSource,
    'partner'
  )
  assert.equal(
    resolveCoverCandidateVenueName({ partnerBusinessName: null, outreachTokenBusinessName: 'Y', itemBody: null })
      .venueNameSource,
    'outreach_token'
  )
  assert.equal(
    resolveCoverCandidateVenueName({ partnerBusinessName: null, outreachTokenBusinessName: null, itemBody: DOAKY_BODY })
      .venueNameSource,
    'legacy_text'
  )
  assert.equal(
    resolveCoverCandidateVenueName({ partnerBusinessName: null, outreachTokenBusinessName: null, itemBody: null })
      .venueNameSource,
    'missing'
  )
})

test('genuinely orphaned item (no relation, no matching text, no body at all) stays a safe fallback', () => {
  const result = resolveCoverCandidateVenueName({
    partnerBusinessName: undefined,
    outreachTokenBusinessName: undefined,
    itemBody: undefined,
  })
  assert.equal(result.venueName, null)
  assert.equal(result.venueNameSource, 'missing')
})

test('blank/whitespace-only relational fields are treated as absent, not as a resolved name', () => {
  const result = resolveCoverCandidateVenueName({
    partnerBusinessName: '   ',
    outreachTokenBusinessName: '',
    itemBody: DOAKY_BODY,
  })
  assert.equal(result.venueName, "Doaky's Kitchen")
  assert.equal(result.venueNameSource, 'legacy_text')
})
