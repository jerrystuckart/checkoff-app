import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSearchText, textIncludesNormalized } from './searchNormalize.js'

test('normalizeSearchText: German umlaut, bare-Latin, and transliteration forms all collapse identically', () => {
  const a = normalizeSearchText('Hüftgold')
  const b = normalizeSearchText('Huftgold')
  const c = normalizeSearchText('Hueftgold')
  assert.equal(a, b)
  assert.equal(b, c)
  assert.equal(a, 'huftgold')
})

test('normalizeSearchText: German transliteration helper cases (ä/ö/ü/ß)', () => {
  assert.equal(normalizeSearchText('Änderung'), normalizeSearchText('Aenderung'))
  assert.equal(normalizeSearchText('Öffnungszeiten'), normalizeSearchText('Oeffnungszeiten'))
  assert.equal(normalizeSearchText('Über'), normalizeSearchText('Ueber'))
  assert.equal(normalizeSearchText('Straße'), normalizeSearchText('Strasse'))
})

test('normalizeSearchText: lowercases and strips generic diacritics beyond German', () => {
  assert.equal(normalizeSearchText('café'), 'cafe')
  assert.equal(normalizeSearchText('Café'), 'cafe')
})

test('normalizeSearchText: non-string input returns empty string, never throws', () => {
  assert.equal(normalizeSearchText(null), '')
  assert.equal(normalizeSearchText(undefined), '')
  assert.equal(normalizeSearchText(42), '')
})

test('textIncludesNormalized: matches across accent/transliteration variants', () => {
  const normalizedQuery = normalizeSearchText('hueftgold')
  assert.ok(textIncludesNormalized('Try the Hüftgold plate', normalizedQuery))
  assert.ok(textIncludesNormalized('Huftgold special', normalizedQuery))
  assert.ok(!textIncludesNormalized('Nothing related here', normalizedQuery))
})

test('textIncludesNormalized: empty/missing needle or haystack never matches', () => {
  assert.equal(textIncludesNormalized('anything', ''), false)
  assert.equal(textIncludesNormalized(null, 'x'), false)
  assert.equal(textIncludesNormalized(undefined, 'x'), false)
})
