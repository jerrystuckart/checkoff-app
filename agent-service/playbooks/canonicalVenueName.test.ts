import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractCanonicalVenueOptions, resolveDefaultCanonicalVenueName, resolveConfirmedCanonicalVenueName } from './canonicalVenueName'

test('extractCanonicalVenueOptions: a bundled discovery label ("(incl. X, Y)") extracts primary + alternatives', () => {
  const result = extractCanonicalVenueOptions('Hofburg Palace Complex (incl. Sisi Museum, Spanish Riding School)')
  assert.equal(result.primary, 'Hofburg Palace Complex')
  assert.deepEqual(result.alternatives, ['Sisi Museum', 'Spanish Riding School'])
})

test('extractCanonicalVenueOptions: a plain (non-bundle) parenthetical is stripped with no alternatives extracted', () => {
  const result = extractCanonicalVenueOptions('Schönbrunn Palace and Gardens (est. 1642)')
  assert.equal(result.primary, 'Schönbrunn Palace and Gardens')
  assert.deepEqual(result.alternatives, [])
})

test('extractCanonicalVenueOptions: no parenthetical at all — primary is the trimmed label unchanged, no alternatives', () => {
  const result = extractCanonicalVenueOptions('Cafe Sperl')
  assert.equal(result.primary, 'Cafe Sperl')
  assert.deepEqual(result.alternatives, [])
})

test('extractCanonicalVenueOptions: "featuring" and "including" are recognized bundle markers, not just "incl."', () => {
  assert.deepEqual(extractCanonicalVenueOptions('Naschmarkt (featuring Falafel Stand, Käsestand)').alternatives, ['Falafel Stand', 'Käsestand'])
  assert.deepEqual(extractCanonicalVenueOptions('Prater (including Riesenrad)').alternatives, ['Riesenrad'])
})

test('extractCanonicalVenueOptions: never guesses a shorter "true" name — deterministic cleanup only, no fuzzy inference', () => {
  // "Hofburg Palace Complex" is NOT shortened to "Hofburg" by cleanup
  // alone — that would require a verified name from a higher tier.
  const result = extractCanonicalVenueOptions('Hofburg Palace Complex')
  assert.equal(result.primary, 'Hofburg Palace Complex')
})

// ---------------------------------------------------------------------------
// resolveDefaultCanonicalVenueName
// ---------------------------------------------------------------------------

test('resolveDefaultCanonicalVenueName: prefers a verified Google Places name (tier 1) over everything else', () => {
  const name = resolveDefaultCanonicalVenueName({
    discoveryName: 'Hofburg Palace Complex (incl. Sisi Museum, Spanish Riding School)',
    placesName: 'Hofburg',
    researchVenueName: 'Hofburg Imperial Palace',
  })
  assert.equal(name, 'Hofburg')
})

test('resolveDefaultCanonicalVenueName: falls back to a verified research name (tier 2) when no Places name is available', () => {
  const name = resolveDefaultCanonicalVenueName({ discoveryName: 'Hofburg Palace Complex (incl. Sisi Museum, Spanish Riding School)', researchVenueName: 'Hofburg' })
  assert.equal(name, 'Hofburg')
})

test('resolveDefaultCanonicalVenueName: falls back to deterministic cleanup (tier 3) when neither Places nor research name is available', () => {
  const name = resolveDefaultCanonicalVenueName({ discoveryName: 'Hofburg Palace Complex (incl. Sisi Museum, Spanish Riding School)' })
  assert.equal(name, 'Hofburg Palace Complex')
})

test('resolveDefaultCanonicalVenueName: blank-string overrides are treated as absent, not used', () => {
  const name = resolveDefaultCanonicalVenueName({ discoveryName: 'Cafe Sperl', placesName: '  ', researchVenueName: '' })
  assert.equal(name, 'Cafe Sperl')
})

// ---------------------------------------------------------------------------
// resolveConfirmedCanonicalVenueName
// ---------------------------------------------------------------------------

test('resolveConfirmedCanonicalVenueName: the editor choosing the default name is confirmed', () => {
  assert.equal(resolveConfirmedCanonicalVenueName('Hofburg Palace Complex', 'Hofburg Palace Complex', ['Sisi Museum', 'Spanish Riding School']), 'Hofburg Palace Complex')
})

test('resolveConfirmedCanonicalVenueName: the editor choosing a legitimate bundled alternative is confirmed — bundles resolve to ONE actual venue, not the compound', () => {
  assert.equal(resolveConfirmedCanonicalVenueName('Sisi Museum', 'Hofburg Palace Complex', ['Sisi Museum', 'Spanish Riding School']), 'Sisi Museum')
  assert.equal(resolveConfirmedCanonicalVenueName('Spanish Riding School', 'Hofburg Palace Complex', ['Sisi Museum', 'Spanish Riding School']), 'Spanish Riding School')
})

test('resolveConfirmedCanonicalVenueName: an invented name not in the allowed set is rejected (null) — never fuzzy-accepted', () => {
  assert.equal(resolveConfirmedCanonicalVenueName('Hofburg', 'Hofburg Palace Complex', ['Sisi Museum', 'Spanish Riding School']), null)
})

test('resolveConfirmedCanonicalVenueName: the editor echoing the FULL raw compound/bundled label back (instead of resolving/splitting to one real venue) is rejected — never creates one compound canonical name', () => {
  const result = resolveConfirmedCanonicalVenueName(
    'Hofburg Palace Complex (incl. Sisi Museum, Spanish Riding School)',
    'Hofburg Palace Complex',
    ['Sisi Museum', 'Spanish Riding School']
  )
  assert.equal(result, null)
})

test('resolveConfirmedCanonicalVenueName: a missing/empty choice falls back to the default name (backward compatible)', () => {
  assert.equal(resolveConfirmedCanonicalVenueName(undefined, 'Cafe Sperl', []), 'Cafe Sperl')
  assert.equal(resolveConfirmedCanonicalVenueName('', 'Cafe Sperl', []), 'Cafe Sperl')
  assert.equal(resolveConfirmedCanonicalVenueName('   ', 'Cafe Sperl', []), 'Cafe Sperl')
})

test('resolveConfirmedCanonicalVenueName: whitespace around a valid choice is tolerated', () => {
  assert.equal(resolveConfirmedCanonicalVenueName('  Cafe Sperl  ', 'Cafe Sperl', []), 'Cafe Sperl')
})

// ---------------------------------------------------------------------------
// Apostrophe venue names — must survive cleanup and validation unchanged,
// since checkVenueQuoted's own doc explicitly handles a venue name that
// itself contains an apostrophe (e.g. "Hennessey's Tavern").
// ---------------------------------------------------------------------------

test('apostrophe venue names pass through extraction and confirmation untouched', () => {
  const options = extractCanonicalVenueOptions("Hennessey's Tavern (incl. Rooftop Bar)")
  assert.equal(options.primary, "Hennessey's Tavern")
  assert.deepEqual(options.alternatives, ['Rooftop Bar'])
  assert.equal(resolveConfirmedCanonicalVenueName("Hennessey's Tavern", options.primary, options.alternatives), "Hennessey's Tavern")
})
