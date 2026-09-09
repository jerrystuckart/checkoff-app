// agent-service/specialists/metroGeoEnrichmentDriver.ts
//
// Chief Phase 2X — the real, cached Google Places enrichment I/O layer.
// Pure classification logic lives in ../playbooks/metroGeoEnrichment.ts
// (no I/O there, per this repo's standing split); this module owns the
// actual HTTP call, the cache that makes a paid lookup happen AT MOST
// ONCE per venue across an entire metro build (including every re-run
// of certification), and the per-metro paid-call counter Jerry asked
// for.
//
// The real Places Text Search call (buildRealPlacesLookup) is the same
// shape already proven in scripts/generate-san-diego-places-dry-run.ts —
// extracted here as the permanent, reusable implementation instead of a
// one-off script. It is never called directly by a test; every test
// injects a fake PlacesLookupFn, exactly like every other specialist in
// this codebase injects its executor.

import { classifyPlacesMatch, type ClassifyMatchResult, type GeoEnrichmentItemResult, type PlacesResultLike } from '../playbooks/metroGeoEnrichment'

// ---------------------------------------------------------------------------
// Cache — keyed by (metroId, cacheKey). A cache HIT means the paid Places
// call is never repeated for that venue again, for the life of the
// metro build (apply AND every later re-certification).
// ---------------------------------------------------------------------------

export interface CachedPlacesLookup {
  cacheKey: string
  query: string
  fetchedAt: string
  topResult: PlacesResultLike | null
  apiError: string | null
}

export interface GeoEnrichmentCacheStore {
  get(metroId: string, cacheKey: string): Promise<CachedPlacesLookup | null>
  put(metroId: string, entry: CachedPlacesLookup): Promise<void>
  all(metroId: string): Promise<CachedPlacesLookup[]>
}

export class InMemoryGeoEnrichmentCacheStore implements GeoEnrichmentCacheStore {
  private byMetro = new Map<string, Map<string, CachedPlacesLookup>>()

  async get(metroId: string, cacheKey: string): Promise<CachedPlacesLookup | null> {
    return this.byMetro.get(metroId)?.get(cacheKey) ?? null
  }
  async put(metroId: string, entry: CachedPlacesLookup): Promise<void> {
    if (!this.byMetro.has(metroId)) this.byMetro.set(metroId, new Map())
    this.byMetro.get(metroId)!.set(entry.cacheKey, entry)
  }
  async all(metroId: string): Promise<CachedPlacesLookup[]> {
    return [...(this.byMetro.get(metroId)?.values() ?? [])]
  }
}

/**
 * A local-JSON-file cache — the same durable-artifact pattern already
 * used throughout this repo (scripts/output/*.json) — so a real metro
 * build's Places cache survives across separate `npm run chief` process
 * invocations, not just within one in-memory run. One file per metro.
 */
export class FileGeoEnrichmentCacheStore implements GeoEnrichmentCacheStore {
  constructor(private readonly dir: string = 'scripts/output/geo-enrichment-cache') {}

  private path(metroId: string): string {
    return `${this.dir}/${metroId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
  }

  private async readAll(metroId: string): Promise<Record<string, CachedPlacesLookup>> {
    const fs = await import('node:fs/promises')
    try {
      const raw = await fs.readFile(this.path(metroId), 'utf8')
      return JSON.parse(raw) as Record<string, CachedPlacesLookup>
    } catch {
      return {}
    }
  }

  async get(metroId: string, cacheKey: string): Promise<CachedPlacesLookup | null> {
    const all = await this.readAll(metroId)
    return all[cacheKey] ?? null
  }

  async put(metroId: string, entry: CachedPlacesLookup): Promise<void> {
    const fs = await import('node:fs/promises')
    const all = await this.readAll(metroId)
    all[entry.cacheKey] = entry
    await fs.mkdir(this.dir, { recursive: true })
    await fs.writeFile(this.path(metroId), JSON.stringify(all, null, 2))
  }

  async all(metroId: string): Promise<CachedPlacesLookup[]> {
    return Object.values(await this.readAll(metroId))
  }
}

// ---------------------------------------------------------------------------
// The real Places call — network I/O, never invoked by a test directly.
// ---------------------------------------------------------------------------

export type PlacesLookupFn = (query: string, biasLat: number, biasLng: number) => Promise<{ topResult: PlacesResultLike | null; apiError: string | null }>

const EARTH_R_M = 6371000
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(a))
}

interface RawPlacesApiResult {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
  websiteUri?: string
  addressComponents?: Array<{ shortText: string; longText: string; types: string[] }>
  viewport?: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } }
}

/**
 * The real, network-calling implementation — one Places Text Search
 * call per invocation (never batched behind the caller's back; the
 * cache above is what prevents repeats, not batching). Requires
 * GOOGLE_PLACES_API_KEY to be set; throws a clear, actionable error if
 * it is not, rather than silently returning empty results.
 */
export function buildRealPlacesLookup(apiKey: string | undefined = process.env.GOOGLE_PLACES_API_KEY): PlacesLookupFn {
  return async (query, biasLat, biasLng) => {
    if (!apiKey) {
      return { topResult: null, apiError: 'GOOGLE_PLACES_API_KEY is not configured — cannot perform real Places enrichment.' }
    }
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.websiteUri,places.addressComponents,places.viewport',
        },
        body: JSON.stringify({ textQuery: query, locationBias: { circle: { center: { latitude: biasLat, longitude: biasLng }, radius: 20000 } } }),
      })
      if (!res.ok) {
        const text = await res.text()
        return { topResult: null, apiError: `Places API error (${res.status}): ${text}` }
      }
      const json = (await res.json()) as { places?: RawPlacesApiResult[] }
      const top = json.places?.[0]
      if (!top) return { topResult: null, apiError: null }
      const country = top.addressComponents?.find((c) => c.types?.includes('country'))?.shortText ?? null
      const viewportRadiusM = top.viewport ? Math.round(haversineMeters(top.viewport.low.latitude, top.viewport.low.longitude, top.viewport.high.latitude, top.viewport.high.longitude) / 2) : null
      return {
        topResult: {
          placeId: top.id ?? null,
          name: top.displayName?.text ?? '',
          formattedAddress: top.formattedAddress ?? null,
          lat: top.location?.latitude ?? null,
          lng: top.location?.longitude ?? null,
          websiteUri: top.websiteUri ?? null,
          country,
          viewportRadiusM,
        },
        apiError: null,
      }
    } catch (err) {
      return { topResult: null, apiError: err instanceof Error ? err.message : String(err) }
    }
  }
}

// ---------------------------------------------------------------------------
// The enrichment pass — cache-first, classification via the pure module,
// paid-call counting.
// ---------------------------------------------------------------------------

export interface GeoEnrichmentCandidate {
  /** Identity key — used for the cache, the output record, and cross-referencing against itemCertifications/state.candidates. Kept as the RAW discovery name so every other stage's keying stays consistent. */
  candidateName: string
  body: string
  mapsQuery: string
  expectedCountry: string
  biasLat: number
  biasLng: number
  /**
   * The name actually compared against the Places result for name-
   * similarity scoring (classifyPlacesMatch) — defaults to candidateName
   * when omitted. Vienna, 2026-09-09: candidateName is often a long,
   * compound M3 discovery label ("Musikverein (Golden Hall, Brahms Hall,
   * New Halls)") that scores low similarity against the real Places
   * name purely from the parenthetical bloat, even for a genuinely
   * correct match — the SAME root cause as the venue-quoting and tag
   * bugs. Callers that already resolved a clean canonical venue name
   * (canonicalVenueName.ts) should pass it here.
   */
  matchName?: string
}

export interface GeoEnrichmentRecord extends GeoEnrichmentItemResult {
  match: ClassifyMatchResult
  fromCache: boolean
  placeId: string | null
  formattedAddress: string | null
  lat: number | null
  lng: number | null
  websiteUrl: string | null
  geoRadiusM: number | null
}

export interface GeoEnrichmentRunResult {
  records: GeoEnrichmentRecord[]
  paidCallsMade: number
  cacheHits: number
}

function cacheKeyFor(candidate: GeoEnrichmentCandidate): string {
  return candidate.mapsQuery.trim().toLowerCase()
}

/**
 * Runs Places enrichment for a full candidate set: every candidate whose
 * cache key already has a cached lookup for this metro reuses it (ZERO
 * paid calls) — a fresh call is made ONLY for a genuine cache miss. Safe
 * to call again for the same metro (apply, then re-certification, then
 * a repair pass) without ever re-paying for a venue already looked up.
 */
export async function enrichMetroCatalogGeo(metroId: string, candidates: readonly GeoEnrichmentCandidate[], deps: { cache: GeoEnrichmentCacheStore; lookup: PlacesLookupFn; now?: () => string }): Promise<GeoEnrichmentRunResult> {
  const now = deps.now ?? (() => new Date().toISOString())
  const records: GeoEnrichmentRecord[] = []
  let paidCallsMade = 0
  let cacheHits = 0

  for (const candidate of candidates) {
    const cacheKey = cacheKeyFor(candidate)
    let cached = await deps.cache.get(metroId, cacheKey)
    let fromCache = true
    if (!cached) {
      fromCache = false
      paidCallsMade += 1
      const { topResult, apiError } = await deps.lookup(candidate.mapsQuery, candidate.biasLat, candidate.biasLng)
      cached = { cacheKey, query: candidate.mapsQuery, fetchedAt: now(), topResult, apiError }
      await deps.cache.put(metroId, cached)
    } else {
      cacheHits += 1
    }

    const match = classifyPlacesMatch({ candidateName: candidate.matchName ?? candidate.candidateName, body: candidate.body, expectedCountry: candidate.expectedCountry, topResult: cached.topResult, apiError: cached.apiError })
    records.push({
      candidateName: candidate.candidateName,
      classification: match.classification,
      reason: match.reason,
      match,
      fromCache,
      placeId: cached.topResult?.placeId ?? null,
      formattedAddress: cached.topResult?.formattedAddress ?? null,
      lat: cached.topResult?.lat ?? null,
      lng: cached.topResult?.lng ?? null,
      websiteUrl: cached.topResult?.websiteUri ?? null,
      geoRadiusM: match.proposedGeoRadiusM,
    })
  }

  return { records, paidCallsMade, cacheHits }
}
