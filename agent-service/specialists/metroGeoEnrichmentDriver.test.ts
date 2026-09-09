import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enrichMetroCatalogGeo, InMemoryGeoEnrichmentCacheStore, buildRealPlacesLookup, type GeoEnrichmentCandidate, type PlacesLookupFn } from './metroGeoEnrichmentDriver'

function candidate(overrides: Partial<GeoEnrichmentCandidate> = {}): GeoEnrichmentCandidate {
  return { candidateName: 'California Surf Museum', body: 'See the shark-bitten surfboard.', mapsQuery: 'California Surf Museum, Oceanside', expectedCountry: 'US', biasLat: 33.19, biasLng: -117.38, ...overrides }
}

function fakeLookup(calls: string[]): PlacesLookupFn {
  return async (query) => {
    calls.push(query)
    return { topResult: { placeId: 'p1', name: 'California Surf Museum', formattedAddress: '312 Pier View Way', lat: 33.19, lng: -117.38, websiteUri: 'https://surfmuseum.org', country: 'US', viewportRadiusM: null }, apiError: null }
  }
}

test('enrichMetroCatalogGeo: a fresh candidate makes exactly one paid call', async () => {
  const calls: string[] = []
  const cache = new InMemoryGeoEnrichmentCacheStore()
  const result = await enrichMetroCatalogGeo('vienna-dry-run', [candidate()], { cache, lookup: fakeLookup(calls) })
  assert.equal(result.paidCallsMade, 1)
  assert.equal(result.cacheHits, 0)
  assert.equal(calls.length, 1)
  assert.equal(result.records[0].classification, 'EXACT')
})

test('enrichMetroCatalogGeo: REGRESSION — re-running the exact same candidate set never repeats a paid lookup', async () => {
  const calls: string[] = []
  const cache = new InMemoryGeoEnrichmentCacheStore()
  const lookup = fakeLookup(calls)

  const first = await enrichMetroCatalogGeo('vienna-dry-run', [candidate()], { cache, lookup })
  assert.equal(first.paidCallsMade, 1)

  // Simulate a later re-certification pass (or a resumed run) against the SAME metro/cache.
  const second = await enrichMetroCatalogGeo('vienna-dry-run', [candidate()], { cache, lookup })
  assert.equal(second.paidCallsMade, 0, 'zero paid calls on the second pass — the cache must be reused')
  assert.equal(second.cacheHits, 1)
  assert.equal(calls.length, 1, 'the underlying Places lookup function was invoked exactly once, ever')
  assert.equal(second.records[0].classification, 'EXACT')
})

test('enrichMetroCatalogGeo: a genuinely new candidate in a later pass still makes its own real call, without re-calling for the already-cached one', async () => {
  const calls: string[] = []
  const cache = new InMemoryGeoEnrichmentCacheStore()
  const lookup = fakeLookup(calls)

  await enrichMetroCatalogGeo('vienna-dry-run', [candidate()], { cache, lookup })
  const second = await enrichMetroCatalogGeo('vienna-dry-run', [candidate(), candidate({ candidateName: 'Cafe Sperl', mapsQuery: 'Cafe Sperl, Vienna' })], { cache, lookup })

  assert.equal(second.paidCallsMade, 1, 'only the new candidate triggers a real call')
  assert.equal(second.cacheHits, 1)
  assert.equal(calls.length, 2, 'total real calls across both passes: one per unique venue, never per pass')
})

test('enrichMetroCatalogGeo: cache is scoped per metro — the same venue name in a different metro still gets its own real call', async () => {
  const calls: string[] = []
  const cache = new InMemoryGeoEnrichmentCacheStore()
  const lookup = fakeLookup(calls)

  await enrichMetroCatalogGeo('metro-a', [candidate()], { cache, lookup })
  const result = await enrichMetroCatalogGeo('metro-b', [candidate()], { cache, lookup })
  assert.equal(result.paidCallsMade, 1, 'a different metro id must not incorrectly reuse another metro\'s cache')
})

test('enrichMetroCatalogGeo: a cached API error is also reused, never silently retried into a new paid call', async () => {
  let callCount = 0
  const cache = new InMemoryGeoEnrichmentCacheStore()
  const lookup: PlacesLookupFn = async () => {
    callCount++
    return { topResult: null, apiError: 'rate limited' }
  }
  const first = await enrichMetroCatalogGeo('vienna-dry-run', [candidate()], { cache, lookup })
  assert.equal(first.records[0].classification, 'UNRESOLVED')
  const second = await enrichMetroCatalogGeo('vienna-dry-run', [candidate()], { cache, lookup })
  assert.equal(second.paidCallsMade, 0)
  assert.equal(callCount, 1)
  assert.equal(second.records[0].classification, 'UNRESOLVED')
})

test('buildRealPlacesLookup: returns a clear, actionable error instead of a silent empty result when no API key is configured', async () => {
  const lookup = buildRealPlacesLookup(undefined)
  const result = await lookup('Some Venue', 0, 0)
  assert.equal(result.topResult, null)
  assert.match(result.apiError ?? '', /GOOGLE_PLACES_API_KEY is not configured/)
})

// ---------------------------------------------------------------------------
// matchName (Chief Phase 2Z geo fix) — the candidate identity used for
// caching/output stays the RAW candidateName; only the name-similarity
// match itself uses matchName when supplied.
// ---------------------------------------------------------------------------

test('enrichMetroCatalogGeo: matchName, when supplied, is what drives the classification — not candidateName', async () => {
  const cache = new InMemoryGeoEnrichmentCacheStore()
  const lookup: PlacesLookupFn = async () => ({
    topResult: { placeId: 'p1', name: 'Musikverein Wien', formattedAddress: 'Musikvereinspl. 1, 1010 Wien', lat: 48.2, lng: 16.37, websiteUri: null, country: 'AT', viewportRadiusM: null },
    apiError: null,
  })
  const raw = candidate({ candidateName: 'Musikverein (Golden Hall, Brahms Hall, New Halls)', matchName: 'Musikverein', mapsQuery: 'Musikverein (Golden Hall, Brahms Hall, New Halls), Innere Stadt', expectedCountry: 'AT' })
  const result = await enrichMetroCatalogGeo('vienna-dry-run', [raw], { cache, lookup })
  assert.equal(result.records[0].classification, 'EXACT', 'the clean canonical name matches well even though the raw compound label would not')
  assert.equal(result.records[0].candidateName, 'Musikverein (Golden Hall, Brahms Hall, New Halls)', 'the RAW name remains the identity key in the output record')
})

test('enrichMetroCatalogGeo: without matchName, candidateName is used for the match — unchanged, backward-compatible default', async () => {
  const cache = new InMemoryGeoEnrichmentCacheStore()
  const lookup: PlacesLookupFn = async () => ({
    topResult: { placeId: 'p1', name: 'California Surf Museum', formattedAddress: 'Oceanside, CA', lat: 33.19, lng: -117.38, websiteUri: null, country: 'US', viewportRadiusM: null },
    apiError: null,
  })
  const result = await enrichMetroCatalogGeo('vienna-dry-run', [candidate()], { cache, lookup })
  assert.equal(result.records[0].classification, 'EXACT')
})

test('enrichMetroCatalogGeo: matchName does NOT change the cache key — mapsQuery alone still governs caching (never re-pay for a lookup on a resumed run)', async () => {
  let calls = 0
  const cache = new InMemoryGeoEnrichmentCacheStore()
  const lookup: PlacesLookupFn = async () => {
    calls++
    return { topResult: { placeId: 'p1', name: 'Musikverein Wien', formattedAddress: 'x', lat: 48.2, lng: 16.37, websiteUri: null, country: 'AT', viewportRadiusM: null }, apiError: null }
  }
  const withoutMatchName = candidate({ candidateName: 'Musikverein (Golden Hall, Brahms Hall, New Halls)', mapsQuery: 'Musikverein (Golden Hall, Brahms Hall, New Halls), Innere Stadt' })
  await enrichMetroCatalogGeo('vienna-dry-run', [withoutMatchName], { cache, lookup })
  assert.equal(calls, 1)

  // Same mapsQuery, now WITH matchName added — must hit the cache, never re-query.
  const withMatchName = { ...withoutMatchName, matchName: 'Musikverein' }
  const second = await enrichMetroCatalogGeo('vienna-dry-run', [withMatchName], { cache, lookup })
  assert.equal(calls, 1, 'adding matchName must never trigger a fresh paid call for an already-cached query')
  assert.equal(second.records[0].fromCache, true)
})

test('enrichMetroCatalogGeo: the bounded second pass (Chief Phase 2AB) runs automatically and upgrades a corroborated ambiguous match — never a new paid call', async () => {
  let calls = 0
  const cache = new InMemoryGeoEnrichmentCacheStore()
  const lookup: PlacesLookupFn = async () => {
    calls++
    // A weak plain-similarity match against the raw compound label, but
    // a real district + distinctive-word match against the canonical name.
    return { topResult: { placeId: 'p1', name: 'Musikverein Wien', formattedAddress: 'Musikvereinspl. 1, 1010 Wien, Austria', lat: 48.2, lng: 16.37, websiteUri: null, country: 'AT', viewportRadiusM: null }, apiError: null }
  }
  const c = candidate({
    candidateName: 'Musikverein (Golden Hall, Brahms Hall, New Halls)',
    matchName: 'Musikverein',
    neighborhood: 'Innere Stadt (1st district)',
    mapsQuery: 'Musikverein (Golden Hall, Brahms Hall, New Halls), Innere Stadt',
  })
  const result = await enrichMetroCatalogGeo('vienna-second-pass', [c], { cache, lookup })
  assert.equal(calls, 1)
  assert.equal(result.records[0].classification, 'EXACT', `expected the second pass to upgrade this, got: ${JSON.stringify(result.records[0])}`)
  assert.match(result.records[0].reason, /Second pass/)
})

test('enrichMetroCatalogGeo: the second pass never upgrades a genuinely wrong match, even with a matching district (the real "Café Central" -> "DECENTRAL" false-positive regression)', async () => {
  const cache = new InMemoryGeoEnrichmentCacheStore()
  const lookup: PlacesLookupFn = async () => ({
    topResult: { placeId: 'p1', name: 'DECENTRAL', formattedAddress: 'Freyung 3/1, 1010 Wien, Austria', lat: 48.2, lng: 16.37, websiteUri: null, country: 'AT', viewportRadiusM: null },
    apiError: null,
  })
  const c = candidate({ candidateName: 'Café Central', matchName: 'Café Central', neighborhood: '1st district (Innere Stadt)', mapsQuery: 'Café Central, 1st district' })
  const result = await enrichMetroCatalogGeo('vienna-second-pass-2', [c], { cache, lookup })
  assert.notEqual(result.records[0].classification, 'EXACT')
})
