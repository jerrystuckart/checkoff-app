#!/usr/bin/env -S npx tsx
// scripts/generate-san-diego-places-dry-run.ts
//
// Google Places DRY RUN for the already-reconciled 149-item San Diego/
// Tijuana catalog. Captures google_place_id, formatted_address,
// maps_lat/lng, geo_location (derivable from lat/lng), geo_radius_m
// (proposed only where Places' own viewport data justifies a specific
// value — otherwise left to the existing 500m app default), and
// website_url — ALL from one Places Text Search call per venue, per
// Jerry's explicit "do not do 149 separate website lookups" instruction.
//
// READ-ONLY. Never writes to `items` or any other table — this is a
// research pass only, producing a local JSON review file for human
// verification before any apply script is written.
//
// Does NOT use scripts/geocode-san-diego-items.js's Supabase read path
// (no SUPABASE_SERVICE_ROLE_KEY configured in this environment) — pulls
// the same 149-item candidate set straight from local pipeline state
// (agent.tasks via sanDiegoReconciliationShared, the same source the
// write patch and metadata patch both used), so no live DB read is
// needed at all for this phase.
//
// Match-confidence discipline (never accept on name similarity alone):
//   - Structural risk flags computed BEFORE calling Places: multi-
//     location chains, parent-venue/sub-experience wording ("X at Y",
//     "inside Y"), recurring events (no single fixed venue), area/
//     district/park/market venues, "(various operators)" experiences.
//   - Every result cross-checked against the candidate's expected
//     country (US for San Diego, Mexico for Tijuana) via Places'
//     addressComponents — a country mismatch is NEVER accepted
//     regardless of name similarity.
//   - Four tiers: EXACT, HIGH_CONFIDENCE_PARENT_VENUE, AMBIGUOUS_NEEDS_
//     REVIEW, UNRESOLVED. Any structural risk flag or country mismatch
//     forces AMBIGUOUS_NEEDS_REVIEW at minimum, regardless of how close
//     the name match looks.
//
// Usage: npx tsx scripts/generate-san-diego-places-dry-run.ts
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { loadEnvFile, buildFinalRecords } from './sanDiegoReconciliationShared'
import { MEXICO_NEIGHBORHOODS } from './metroCatalogSanDiegoConfig'

loadEnvFile('.env')

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY
const MAX_CALLS = 200

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[a.length][b.length]
}
function similarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  // One name fully contains the other as a substring (e.g. "Zuma" inside
  // "Zuma San Diego", "Legoland California" inside "LEGOLAND California
  // Resort") — a strong same-entity signal Places' own suffixing/branding
  // conventions produce constantly. Plain edit-distance-over-max-length
  // punishes this heavily just for length difference, which was flooding
  // the AMBIGUOUS tier with correct matches. Score high regardless of the
  // length gap, with a small penalty for how much extra text surrounds it.
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length)
    const longer = Math.max(na.length, nb.length)
    return 0.75 + 0.25 * (shorter / longer)
  }
  const dist = levenshtein(na, nb)
  return 1 - dist / Math.max(na.length, nb.length)
}

const EARTH_R_M = 6371000
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(a))
}

// ---------------------------------------------------------------------------
// Structural risk flags — computed from the candidate's own name/body,
// BEFORE any Places call. These are the exact categories Jerry called out
// as requiring extra scrutiny, never a name-similarity-only accept.
// ---------------------------------------------------------------------------

interface RiskFlags {
  variousOperators: boolean
  multiLocationChain: boolean
  parentSubVenue: boolean
  recurringEvent: boolean
  areaOrDistrict: boolean
}

function computeRiskFlags(candidateName: string, body: string): RiskFlags {
  const nameLower = candidateName.toLowerCase()
  const bodyLower = body.toLowerCase()
  return {
    variousOperators: /\(various operators\)/i.test(candidateName),
    multiLocationChain: /\b(third|second|fourth|multiple) location/i.test(candidateName) || /\blocations?\b/i.test(candidateName),
    parentSubVenue: /\bat\b .+ (hotel|building|park|golf course|marina|resort)/i.test(bodyLower) || /\binside\b/i.test(bodyLower),
    recurringEvent: /\b(festival|parade|regatta|tournament|contest|classic|marathon|skate event)\b/i.test(nameLower) || /\b(festival|parade|regatta|tournament)\b/i.test(bodyLower),
    areaOrDistrict: /\b(park|district|quarter|market|zona)\b/i.test(nameLower) && !/restaurant|café|cafe/i.test(nameLower),
  }
}

type MatchTier = 'EXACT' | 'HIGH_CONFIDENCE_PARENT_VENUE' | 'AMBIGUOUS_NEEDS_REVIEW' | 'UNRESOLVED'

interface PlacesResult {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
  websiteUri?: string
  addressComponents?: Array<{ shortText: string; longText: string; types: string[] }>
  viewport?: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } }
}

let callCount = 0
async function textSearch(query: string, biasLat: number, biasLng: number): Promise<PlacesResult[]> {
  callCount++
  if (callCount > MAX_CALLS) throw new Error(`MAX_CALLS (${MAX_CALLS}) exceeded — aborting before call #${callCount}.`)
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY!,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.websiteUri,places.addressComponents,places.viewport',
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: { circle: { center: { latitude: biasLat, longitude: biasLng }, radius: 20000 } },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Places API error (${res.status}) for "${query}": ${text}`)
  }
  const json = (await res.json()) as { places?: PlacesResult[] }
  return json.places ?? []
}

function countryOf(result: PlacesResult): string | null {
  const c = result.addressComponents?.find((c) => c.types?.includes('country'))
  return c?.shortText ?? null
}

function viewportRadiusM(result: PlacesResult): number | null {
  if (!result.viewport) return null
  const { low, high } = result.viewport
  const diagonalM = haversineMeters(low.latitude, low.longitude, high.latitude, high.longitude)
  return Math.round(diagonalM / 2)
}

interface DryRunRow {
  candidateName: string
  mapsQuery: string
  expectedCountry: 'US' | 'MX'
  riskFlags: RiskFlags
  placesResultCount: number
  topResult: { name: string; formattedAddress: string | null; placeId: string | null; lat: number | null; lng: number | null; websiteUri: string | null; country: string | null } | null
  nameSimilarity: number | null
  countryMatch: boolean | null
  matchTier: MatchTier
  proposedGeoRadiusM: number | null
  reason: string
}

async function main() {
  if (!GOOGLE_PLACES_API_KEY) {
    console.error('FATAL: GOOGLE_PLACES_API_KEY not configured — cannot run the Places dry run.')
    process.exitCode = 1
    return
  }

  const sd = await buildFinalRecords('san-diego', [])
  const tj = await buildFinalRecords('san-diego-tijuana-extension', [])
  const allRecords = [...sd.records, ...tj.records]

  const neighborhoods = JSON.parse(readFileSync('scripts/output/san-diego-neighborhoods-with-radii.json', 'utf8')) as Array<{ name: string; lat: number; lng: number }>
  const neighborhoodByName = new Map(neighborhoods.map((n) => [n.name, n]))
  const SD_FALLBACK_BIAS = { lat: 32.7157, lng: -117.1611 }
  const TJ_FALLBACK_BIAS = { lat: 32.5149, lng: -117.0382 }

  const rows: DryRunRow[] = []

  for (const r of allRecords) {
    const isMexico = MEXICO_NEIGHBORHOODS.has(r.neighborhoodName ?? '')
    const expectedCountry: 'US' | 'MX' = isMexico ? 'MX' : 'US'
    const bias = neighborhoodByName.get(r.neighborhoodName ?? '') ?? (isMexico ? TJ_FALLBACK_BIAS : SD_FALLBACK_BIAS)
    const riskFlags = computeRiskFlags(r.candidateName, r.body)

    let places: PlacesResult[] = []
    let apiError: string | null = null
    try {
      places = await textSearch(r.mapsQuery, bias.lat, bias.lng)
    } catch (e) {
      apiError = e instanceof Error ? e.message : String(e)
    }

    if (apiError || places.length === 0) {
      rows.push({
        candidateName: r.candidateName,
        mapsQuery: r.mapsQuery,
        expectedCountry,
        riskFlags,
        placesResultCount: 0,
        topResult: null,
        nameSimilarity: null,
        countryMatch: null,
        matchTier: 'UNRESOLVED',
        proposedGeoRadiusM: null,
        reason: apiError ? `Places API error: ${apiError}` : 'Places returned zero results for this query.',
      })
      continue
    }

    const top = places[0]
    const nameSim = similarity(r.candidateName, top.displayName?.text ?? '')
    const country = countryOf(top)
    const countryMatch = country ? country === expectedCountry : null
    const viewportR = viewportRadiusM(top)
    const proposedGeoRadiusM = riskFlags.areaOrDistrict || riskFlags.multiLocationChain ? viewportR : null

    let matchTier: MatchTier
    let reason: string
    if (riskFlags.variousOperators) {
      matchTier = 'AMBIGUOUS_NEEDS_REVIEW'
      reason = '"(various operators)" experience — no single canonical business to resolve to; Places result (if any) is at best a general-area proxy, never accepted as the definitive venue.'
    } else if (riskFlags.recurringEvent) {
      matchTier = 'AMBIGUOUS_NEEDS_REVIEW'
      reason = 'Recurring/scheduled event, not a fixed standing venue — Places result is the host location at best, needs human confirmation it is the correct host site for THIS event.'
    } else if (countryMatch === false) {
      matchTier = 'AMBIGUOUS_NEEDS_REVIEW'
      reason = `Country mismatch: expected ${expectedCountry}, Places returned ${country} — never accepted regardless of name similarity.`
    } else if (countryMatch === null) {
      matchTier = 'AMBIGUOUS_NEEDS_REVIEW'
      reason = 'Places result had no parseable country component — cannot verify San Diego vs Tijuana correctness, needs human review.'
    } else if (nameSim >= 0.75) {
      matchTier = 'EXACT'
      reason = `Name similarity ${nameSim.toFixed(2)} and country confirmed (${country}).`
    } else if ((riskFlags.parentSubVenue || riskFlags.areaOrDistrict || riskFlags.multiLocationChain) && nameSim >= 0.35) {
      matchTier = 'HIGH_CONFIDENCE_PARENT_VENUE'
      reason = `Name similarity only ${nameSim.toFixed(2)} but candidate is a sub-experience/area/chain (${Object.entries(riskFlags).filter(([, v]) => v).map(([k]) => k).join(', ')}) and country confirmed (${country}) — Places likely resolved the parent venue/area correctly, not a wrong match.`
    } else {
      matchTier = 'AMBIGUOUS_NEEDS_REVIEW'
      reason = `Name similarity only ${nameSim.toFixed(2)} with no structural explanation for the gap — needs a human to confirm this is really the same venue before accepting.`
    }

    rows.push({
      candidateName: r.candidateName,
      mapsQuery: r.mapsQuery,
      expectedCountry,
      riskFlags,
      placesResultCount: places.length,
      topResult: {
        name: top.displayName?.text ?? '',
        formattedAddress: top.formattedAddress ?? null,
        placeId: top.id ?? null,
        lat: top.location?.latitude ?? null,
        lng: top.location?.longitude ?? null,
        websiteUri: top.websiteUri ?? null,
        country,
      },
      nameSimilarity: Number(nameSim.toFixed(3)),
      countryMatch,
      matchTier,
      proposedGeoRadiusM,
      reason,
    })
  }

  // ── Report ──
  const byTier = (t: MatchTier) => rows.filter((r) => r.matchTier === t)
  const exact = byTier('EXACT')
  const parentVenue = byTier('HIGH_CONFIDENCE_PARENT_VENUE')
  const ambiguous = byTier('AMBIGUOUS_NEEDS_REVIEW')
  const unresolved = byTier('UNRESOLVED')
  const websitesObtained = rows.filter((r) => r.topResult?.websiteUri).length
  const websitesMissing = rows.length - websitesObtained
  const countryViolations = rows.filter((r) => r.countryMatch === false)

  const report = {
    generatedAt: new Date().toISOString(),
    totalItems: rows.length,
    placesApiCallsMade: callCount,
    summary: {
      exactMatches: exact.length,
      highConfidenceParentVenueMatches: parentVenue.length,
      ambiguousNeedsHumanReview: ambiguous.length,
      unresolved: unresolved.length,
      websitesObtained,
      websitesMissing,
      caVsMexicoCountryViolations: countryViolations.length,
    },
    countryViolationDetail: countryViolations.map((r) => ({ candidateName: r.candidateName, expectedCountry: r.expectedCountry, gotCountry: r.topResult?.country, formattedAddress: r.topResult?.formattedAddress })),
    unresolvedDetail: unresolved.map((r) => ({ candidateName: r.candidateName, mapsQuery: r.mapsQuery, reason: r.reason })),
    ambiguousDetail: ambiguous.map((r) => ({ candidateName: r.candidateName, mapsQuery: r.mapsQuery, topResultName: r.topResult?.name, nameSimilarity: r.nameSimilarity, reason: r.reason })),
    parentVenueDetail: parentVenue.map((r) => ({ candidateName: r.candidateName, topResultName: r.topResult?.name, nameSimilarity: r.nameSimilarity, riskFlags: r.riskFlags })),
    allRows: rows,
  }

  mkdirSync('scripts/output', { recursive: true })
  const outPath = `scripts/output/san-diego-places-dry-run-${new Date().toISOString().slice(0, 10)}.json`
  writeFileSync(outPath, JSON.stringify(report, null, 2))

  console.error(`\nWrote ${outPath}`)
  console.error(`Places API calls made: ${callCount}`)
  console.error(`EXACT: ${exact.length}, HIGH_CONFIDENCE_PARENT_VENUE: ${parentVenue.length}, AMBIGUOUS_NEEDS_REVIEW: ${ambiguous.length}, UNRESOLVED: ${unresolved.length}`)
  console.error(`Websites obtained: ${websitesObtained}, missing: ${websitesMissing}`)
  console.error(`CA vs Mexico country violations: ${countryViolations.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
