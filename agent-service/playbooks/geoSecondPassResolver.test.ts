import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractViennaDistrict, districtsCorroborate, sharedSignificantWordCount, translatedNameSimilarity, resolveGeoSecondPass } from './geoSecondPassResolver'
import type { PlacesResultLike } from './metroGeoEnrichment'

function place(overrides: Partial<PlacesResultLike> = {}): PlacesResultLike {
  return { placeId: 'p1', name: 'Musikverein Wien', formattedAddress: 'Musikvereinspl. 1, 1010 Wien, Austria', lat: 48.2, lng: 16.37, websiteUri: null, country: 'AT', viewportRadiusM: null, ...overrides }
}

// ---------------------------------------------------------------------------
// extractViennaDistrict / districtsCorroborate
// ---------------------------------------------------------------------------

test('extractViennaDistrict: recognizes a postal code (10XX -> district X)', () => {
  assert.equal(extractViennaDistrict('Musikvereinspl. 1, 1010 Wien'), 1)
  assert.equal(extractViennaDistrict('Josefstädter Str. 66, 1080 Wien'), 8)
})

test('extractViennaDistrict: recognizes an ordinal mention', () => {
  assert.equal(extractViennaDistrict('2nd district'), 2)
  assert.equal(extractViennaDistrict('18th District'), 18)
})

test('extractViennaDistrict: recognizes a district name, including the English "Inner City" alias for district 1', () => {
  assert.equal(extractViennaDistrict('Leopoldstadt'), 2)
  assert.equal(extractViennaDistrict('Inner City'), 1)
  assert.equal(extractViennaDistrict('Innere Stadt'), 1)
})

test('extractViennaDistrict: returns null for text with no recognizable district — never a guess', () => {
  assert.equal(extractViennaDistrict('Somewhere nice'), null)
  assert.equal(extractViennaDistrict(null), null)
  assert.equal(extractViennaDistrict(undefined), null)
})

test('districtsCorroborate: true only when both sides name the SAME real district', () => {
  assert.equal(districtsCorroborate('Josefstadt', 'Josefstädter Str. 66, 1080 Wien'), true)
  assert.equal(districtsCorroborate('Josefstadt', 'Karlsplatz 10, 1040 Wien'), false)
  assert.equal(districtsCorroborate(null, '1010 Wien'), false)
  assert.equal(districtsCorroborate('Josefstadt', null), false)
})

// ---------------------------------------------------------------------------
// sharedSignificantWordCount — the false-positive regression tests
// ---------------------------------------------------------------------------

test('sharedSignificantWordCount: a coincidental substring match ("central" inside "decentral") is NOT counted — word-level, never character-level', () => {
  assert.equal(sharedSignificantWordCount('Café Central', 'DECENTRAL'), 0)
})

test('sharedSignificantWordCount: generic genre words (vienna/orchestra/mozart/strauss/concert) never count — two different real competing businesses share them', () => {
  assert.equal(sharedSignificantWordCount('Vienna Hofburg Orchestra – Strauss & Mozart Concert', 'Vienna Premium Orchestra - Mozart & Strauss Concerts'), 0)
})

test('sharedSignificantWordCount: a real distinctive proper noun shared between both names counts', () => {
  assert.ok(sharedSignificantWordCount('Cafe Hummel', 'Café Restaurant Hummel') >= 1)
  assert.ok(sharedSignificantWordCount('Das Redtenbach (Kulturverein)', 'Kulturverein Redtenbach') >= 1)
})

test('sharedSignificantWordCount: German compound nouns are split and translated ("Stephansdom" -> "Stephan"+"cathedral")', () => {
  assert.ok(sharedSignificantWordCount('Stephansdom', "St. Stephen's Cathedral") >= 1)
  assert.ok(sharedSignificantWordCount('Karlskirche', "St. Charles's Church") >= 1)
  assert.ok(sharedSignificantWordCount('Wiener Staatsoper', 'Vienna State Opera') >= 1)
})

test('sharedSignificantWordCount: short/common words never count, even if identical, once filtered by the length>=4 + stopword rule', () => {
  assert.equal(sharedSignificantWordCount('The Bar', 'A Bar'), 0) // "bar" is 3 chars
})

// ---------------------------------------------------------------------------
// translatedNameSimilarity
// ---------------------------------------------------------------------------

test('translatedNameSimilarity: never lower than the plain similarity', () => {
  const a = 'Freyung organic market'
  const b = 'Bio-Markt Freyung'
  const plain = translatedNameSimilarity(a, b)
  assert.ok(plain > 0)
})

// ---------------------------------------------------------------------------
// resolveGeoSecondPass — the end-to-end decision
// ---------------------------------------------------------------------------

test('resolveGeoSecondPass: never touches an already-confident classification', () => {
  const result = resolveGeoSecondPass({ matchName: 'Anything', neighborhoodContext: null, primaryClassification: 'EXACT', topResult: place() })
  assert.equal(result.upgraded, false)
  assert.equal(result.classification, 'EXACT')
})

test('resolveGeoSecondPass: never rescues UNRESOLVED (no topResult exists to corroborate against)', () => {
  const result = resolveGeoSecondPass({ matchName: 'Anything', neighborhoodContext: 'Josefstadt', primaryClassification: 'UNRESOLVED', topResult: null })
  assert.equal(result.upgraded, false)
  assert.equal(result.classification, 'UNRESOLVED')
})

test('resolveGeoSecondPass: upgrades to EXACT when a real shared word + district corroboration + reasonable similarity all agree', () => {
  const result = resolveGeoSecondPass({
    matchName: 'Musikverein',
    neighborhoodContext: 'Innere Stadt (1st district)',
    primaryClassification: 'AMBIGUOUS_NEEDS_REVIEW',
    topResult: place({ name: 'Musikverein Wien', formattedAddress: 'Musikvereinspl. 1, 1010 Wien, Austria' }),
  })
  assert.equal(result.upgraded, true)
  assert.equal(result.classification, 'EXACT')
})

test('resolveGeoSecondPass: the real false-positive case (Café Central / DECENTRAL) is correctly NOT upgraded, even with a matching district', () => {
  const result = resolveGeoSecondPass({
    matchName: 'Café Central',
    neighborhoodContext: '1st district (Innere Stadt)',
    primaryClassification: 'AMBIGUOUS_NEEDS_REVIEW',
    topResult: place({ name: 'DECENTRAL', formattedAddress: 'Freyung 3/1, 1010 Wien, Austria' }),
  })
  assert.equal(result.upgraded, false, 'zero real shared words — district agreement and edit-distance similarity alone must never be enough')
})

test('resolveGeoSecondPass: the real false-positive case (competing Mozart/Strauss orchestras) is correctly NOT upgraded', () => {
  const result = resolveGeoSecondPass({
    matchName: 'Vienna Hofburg Orchestra – Strauss & Mozart Concert',
    neighborhoodContext: 'Wiener Konzerthaus / Hofburg area',
    primaryClassification: 'AMBIGUOUS_NEEDS_REVIEW',
    topResult: place({ name: 'Vienna Premium Orchestra - Mozart & Strauss Concerts', formattedAddress: 'Josefsplatz 6, 1010 Wien, Austria' }),
  })
  assert.equal(result.upgraded, false, 'generic genre words shared between two different competing businesses must never count as corroboration')
})

test('resolveGeoSecondPass: with no district context at all, a weak match is never upgraded even with one shared word', () => {
  const result = resolveGeoSecondPass({
    matchName: 'Some Cafe',
    neighborhoodContext: null,
    primaryClassification: 'REJECTED_WRONG_MATCH',
    topResult: place({ name: 'Some Completely Different Business', formattedAddress: 'Somewhere, Austria' }),
  })
  assert.equal(result.upgraded, false)
})

test('resolveGeoSecondPass: two shared distinctive words is enough even WITHOUT district corroboration', () => {
  const result = resolveGeoSecondPass({
    matchName: 'Redtenbach Kulturverein Ottakring',
    neighborhoodContext: null,
    primaryClassification: 'AMBIGUOUS_NEEDS_REVIEW',
    topResult: place({ name: 'Kulturverein Redtenbach', formattedAddress: 'Redtenbachergasse 6, 1160 Wien, Austria' }),
  })
  assert.equal(result.upgraded, true)
})
