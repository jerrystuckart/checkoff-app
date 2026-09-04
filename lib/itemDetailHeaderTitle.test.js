import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveItemDetailHeaderTitle, extractQuotedVenueFromBody } from './itemDetailHeaderTitle.js'

test('uses partnerName when present (real Partner-account business)', () => {
  assert.equal(resolveItemDetailHeaderTitle({ partnerName: 'Big Al\'s Pizza', body: 'Order the wings' }), 'Big Al\'s Pizza')
})

test('falls back to the quoted venue in body when there is no partnerName — the common case: ordinary featured businesses have no Partner row', () => {
  const result = resolveItemDetailHeaderTitle({
    partnerName: null,
    body: "Order the fried-then-grilled jumbo wings at 'Red Zone Sports Grill' — catch them for $1 each every Wednesday",
  })
  assert.equal(result, 'Red Zone Sports Grill')
})

test('partnerName wins over the quoted body clause when both exist', () => {
  const result = resolveItemDetailHeaderTitle({
    partnerName: 'Trusted Partner Name',
    body: "Order something at 'A Different Quoted Name'",
  })
  assert.equal(result, 'Trusted Partner Name')
})

test('whitespace-only partnerName is treated as absent, falls through to body extraction', () => {
  const result = resolveItemDetailHeaderTitle({ partnerName: '   ', body: "Try the tacos at 'Los Amigos'" })
  assert.equal(result, 'Los Amigos')
})

test('falls back to CheckOff for a universal item with no venue anywhere', () => {
  assert.equal(resolveItemDetailHeaderTitle({ partnerName: null, body: 'Swing on the swings' }), 'CheckOff')
})

test('never returns a truncated item body when neither source has a venue', () => {
  const result = resolveItemDetailHeaderTitle({ partnerName: null, body: 'Sample some Rattlesnake' })
  assert.equal(result, 'CheckOff')
})

test('handles a null item gracefully', () => {
  assert.equal(resolveItemDetailHeaderTitle(null), 'CheckOff')
  assert.equal(resolveItemDetailHeaderTitle(undefined), 'CheckOff')
})

test('extractQuotedVenueFromBody: handles curly double quotes', () => {
  assert.equal(extractQuotedVenueFromBody('Try the Secret Item at “Baba’s Burgers & Birds”'), 'Baba’s Burgers & Birds')
})

test('extractQuotedVenueFromBody: handles curly SINGLE quotes — real production case (Richter Aleworks) missed until this was added', () => {
  assert.equal(extractQuotedVenueFromBody('Ask the bartender why Amber is a Bitch at ‘Richter Aleworks’'), 'Richter Aleworks')
})

test('extractQuotedVenueFromBody: null when there is no quoted "at" clause', () => {
  assert.equal(extractQuotedVenueFromBody('Walk the full loop around the loop trail'), null)
})

test('extractQuotedVenueFromBody: mismatched quote style (documented real production case) falls through to null rather than a mangled name', () => {
  // Real body: `Try the Secret Item at "Baba's Burgers & Birds'` — open
  // straight-double, close straight-single (used precisely because the
  // venue name itself contains an apostrophe). No symmetric pattern
  // matches, so this must be null, not "Baba" (truncated at the apostrophe).
  const result = extractQuotedVenueFromBody(`Try the Secret Item at "Baba's Burgers & Birds'`)
  assert.equal(result, null)
})

test('extractQuotedVenueFromBody: null/undefined body never throws', () => {
  assert.equal(extractQuotedVenueFromBody(null), null)
  assert.equal(extractQuotedVenueFromBody(undefined), null)
  assert.equal(extractQuotedVenueFromBody(''), null)
})
