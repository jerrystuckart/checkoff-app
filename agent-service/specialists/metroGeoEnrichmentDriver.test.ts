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
