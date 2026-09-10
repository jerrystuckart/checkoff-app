// agent-service/playbooks/existingInventoryReconciliation.ts
//
// Chief Phase 2AH — existing-production-inventory reconciliation. Second
// systemic gap exposed by the Green Bay build (2026-09-10): the real
// driver's M8/M10 stages always called metroCatalog.ts's
// checkForDuplicates() with a hardcoded `collidesWithProduction: []` —
// meaning CATALOG_GATE's production-dedup check, despite being fully
// implemented and tested, was NEVER actually exercised against real data
// by the driver. Combined with the fact that Green Bay already had 9
// real, live, already-certified-quality items sitting under Milwaukee's
// metro (from the existing "The Green Bay Leap" day-trip list), the
// pipeline independently re-discovered and re-certified 5 of those same
// venues from scratch with different item text, ready to ship as
// brand-new duplicate rows.
//
// This module is the reconciliation logic itself (pure — no DB access;
// see agent-service/specialists/existingInventoryReadPath.ts for the
// real query that supplies its input). Match priority, per Jerry's
// explicit instruction:
//   1. Google Place ID (exact, most authoritative — once geo enrichment
//      has resolved one for the candidate)
//   2. Canonical venue identity (name-normalized match — reuses the same
//      normalization approach as metroCatalog.ts's semantic-duplicate
//      detection, kept independent here rather than importing it, since
//      that module's normalizer takes metro-specific "generic word" sets
//      this module has no business assuming)
//   3. Address/geo proximity (lat/lng within a small radius)
//   4. Official website (normalized domain match)
//
// Classification, per Jerry's explicit instruction:
//   - Same venue + same CheckOff experience -> REUSE the existing item;
//     never create a duplicate row for it.
//   - Same venue + a materially different CheckOff experience -> may be
//     RETAINED as a distinct item (both survive).
// "Same experience" is judged by body-text similarity — a real semantic
// judgment call. This module does NOT call an AI model to make that
// judgment (matching itemCertificationLoop.ts's stated position: "same
// experience" vs. "distinct experience" is not something this codebase
// claims to have made fully deterministic) — it applies a documented,
// conservative heuristic and always reports its confidence in the
// result so a human can review borderline cases, never silently guesses
// past a clear near-duplicate/clear-difference split.

export interface ExistingProductionItem {
  id: string
  body: string
  googlePlaceId: string | null
  formattedAddress: string | null
  websiteUrl: string | null
  lat: number | null
  lng: number | null
  /** public.items.maps_query — carried through separately from the richer match methods above so metroLaunchDriver.ts's M10 stage can also feed it into metroCatalog.ts's existing (previously never-wired) checkForDuplicates() normalized-maps_query check, as defense-in-depth alongside this module's own matching. */
  mapsQuery: string | null
}

export interface ReconciliationCandidate {
  candidateName: string
  body: string
  googlePlaceId?: string | null
  formattedAddress?: string | null
  websiteUrl?: string | null
  lat?: number | null
  lng?: number | null
}

export type ReconciliationMatchedBy = 'google_place_id' | 'canonical_venue_identity' | 'address_geo' | 'website'

export interface ReconciliationMatch {
  candidateName: string
  existingItemId: string
  existingBody: string
  matchedBy: ReconciliationMatchedBy
  /** true when the proposed CheckOff experience is judged the same as the existing item's — REUSE. false when materially different — DISTINCT_SAME_VENUE, both retained. */
  sameExperience: boolean
  /** 0-1 word-overlap similarity score between normalized candidate/existing body text — the evidence behind sameExperience, always reported so a human can review a borderline call. */
  experienceSimilarity: number
}

export interface ReconciliationResult {
  /** Same venue + same experience — the existing production item should be reused; the candidate must NOT become a new row. */
  reused: ReconciliationMatch[]
  /** Same venue, materially different experience — both the existing item and this candidate are retained as distinct items. */
  distinctSameVenue: ReconciliationMatch[]
  /** No existing production item matched this candidate by any method — safe to treat as a genuinely new item. */
  unmatched: ReconciliationCandidate[]
}

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of', 'co', 'company', 'inc', 'llc'])

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeVenueName(rawName: string): string {
  const withoutQualifiers = rawName.replace(/\([^)]*\)/g, ' ').replace(/[""'']/g, '')
  const words = normalizeText(withoutQualifiers)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
  return words.join(' ')
}

/** Extracts a plausible venue name from an item body by pulling the FIRST single-quoted span — matches this codebase's own venue-quoting convention (checkVenueQuoted in editorialDistinctiveness.ts): every certified item body wraps its destination venue in literal single quotes. Falls back to the whole body, normalized, when no quoted span is found (never throws — a missing quote is a different gate's problem, not this module's). */
function extractVenueNameFromBody(body: string): string {
  const match = body.match(/'([^']+)'/)
  return normalizeVenueName(match ? match[1] : body)
}

function normalizeWebsite(url: string): string | null {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/** Haversine distance in meters — used only for a small-radius "same address" proximity check, never for ranking/sorting. */
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Chief Phase 2AH correction (2026-09-10, real Green Bay v2 run): the
 * original 75m radius produced real false positives on a dense downtown
 * block — three genuinely DIFFERENT businesses ('Heights Pub & Parlor',
 * 'The Rabbit Hole', 'Voyageurs Bakehouse') at 209/217/320 N Washington/
 * Broadway all geocoded within ~20m of 'Lion's Mouth Bookstore' (211 N
 * Washington St) or 'Titletown Brewing Co', because adjacent downtown
 * storefronts can sit meters apart. Tightened to 15m AND (see findMatch)
 * now requires the street NUMBER to also match when both addresses have
 * a parseable one — pure lat/lng proximity is no longer treated as
 * sufficient evidence on its own in a dense block.
 */
const SAME_VENUE_PROXIMITY_METERS = 15

/** Extracts a leading US-style street number from a formatted address ("217 N Washington St, ..." -> "217") — returns null when no such pattern is present (never treated as a mismatch on its own; only used to REJECT an otherwise-close geo match when both sides have one and they clearly differ). */
function extractStreetNumber(formattedAddress: string): string | null {
  const match = formattedAddress.trim().match(/^(\d+[A-Za-z]?)\b/)
  return match ? match[1] : null
}

/** Word-overlap (Jaccard-style) similarity between two item bodies, EXCLUDING the venue name's own words (shared by construction — "1919 Kitchen & Tap" appears in both bodies about that venue and carries zero signal about whether the two EXPERIENCES are the same). Returns 0-1. */
function experienceSimilarity(bodyA: string, bodyB: string, venueNameWords: ReadonlySet<string>): number {
  const wordsOf = (body: string) =>
    new Set(
      normalizeText(body.replace(/'[^']+'/g, ' '))
        .split(' ')
        .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !venueNameWords.has(w))
    )
  const a = wordsOf(bodyA)
  const b = wordsOf(bodyB)
  if (a.size === 0 && b.size === 0) return 1 // both bodies reduce to nothing but the venue name — indistinguishable, treat as same experience
  const intersection = [...a].filter((w) => b.has(w)).length
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : intersection / union
}

/** Above this similarity, two bodies about the same venue are judged the SAME experience (REUSE). Conservative — chosen so a real difference (e.g. "eat dinner" vs. "choose from 40 craft beers overlooking the atrium" at the same restaurant) reliably lands below it, per the actual Green Bay incident's own 5 rediscovered venues. */
const SAME_EXPERIENCE_SIMILARITY_THRESHOLD = 0.35

function findMatch(candidate: ReconciliationCandidate, existingItems: readonly ExistingProductionItem[]): { item: ExistingProductionItem; matchedBy: ReconciliationMatchedBy } | null {
  // 1. Google Place ID — exact, most authoritative.
  if (candidate.googlePlaceId) {
    const byPlaceId = existingItems.find((e) => e.googlePlaceId && e.googlePlaceId === candidate.googlePlaceId)
    if (byPlaceId) return { item: byPlaceId, matchedBy: 'google_place_id' }
  }

  // 2. Canonical venue identity — normalized name match, pulled from the quoted venue name in both bodies.
  const candidateVenue = extractVenueNameFromBody(candidate.body)
  if (candidateVenue) {
    const byName = existingItems.find((e) => extractVenueNameFromBody(e.body) === candidateVenue)
    if (byName) return { item: byName, matchedBy: 'canonical_venue_identity' }
  }

  // 3. Address/geo proximity. Street-number corroboration required
  // whenever both sides have a parseable one — pure coordinate proximity
  // alone is NOT sufficient evidence in a dense downtown block, where
  // adjacent different businesses can geocode within meters of each
  // other (see SAME_VENUE_PROXIMITY_METERS's doc for the real incident
  // this fixed).
  if (typeof candidate.lat === 'number' && typeof candidate.lng === 'number') {
    const candidateStreetNumber = candidate.formattedAddress ? extractStreetNumber(candidate.formattedAddress) : null
    const byGeo = existingItems.find((e) => {
      if (typeof e.lat !== 'number' || typeof e.lng !== 'number') return false
      if (distanceMeters(candidate.lat as number, candidate.lng as number, e.lat, e.lng) > SAME_VENUE_PROXIMITY_METERS) return false
      const existingStreetNumber = e.formattedAddress ? extractStreetNumber(e.formattedAddress) : null
      if (candidateStreetNumber && existingStreetNumber && candidateStreetNumber !== existingStreetNumber) return false // different street number within the radius — adjacent, not the same venue
      return true
    })
    if (byGeo) return { item: byGeo, matchedBy: 'address_geo' }
  }
  if (candidate.formattedAddress) {
    const normalizedAddr = normalizeText(candidate.formattedAddress)
    const byAddress = existingItems.find((e) => e.formattedAddress && normalizeText(e.formattedAddress) === normalizedAddr)
    if (byAddress) return { item: byAddress, matchedBy: 'address_geo' }
  }

  // 4. Website.
  if (candidate.websiteUrl) {
    const candidateDomain = normalizeWebsite(candidate.websiteUrl)
    if (candidateDomain) {
      const byWebsite = existingItems.find((e) => e.websiteUrl && normalizeWebsite(e.websiteUrl) === candidateDomain)
      if (byWebsite) return { item: byWebsite, matchedBy: 'website' }
    }
  }

  return null
}

export function reconcileAgainstExistingInventory(candidates: readonly ReconciliationCandidate[], existingItems: readonly ExistingProductionItem[]): ReconciliationResult {
  const reused: ReconciliationMatch[] = []
  const distinctSameVenue: ReconciliationMatch[] = []
  const unmatched: ReconciliationCandidate[] = []

  for (const candidate of candidates) {
    const found = existingItems.length > 0 ? findMatch(candidate, existingItems) : null
    if (!found) {
      unmatched.push(candidate)
      continue
    }
    const venueWords = new Set(extractVenueNameFromBody(candidate.body).split(' ').filter(Boolean))
    const similarity = experienceSimilarity(candidate.body, found.item.body, venueWords)
    const match: ReconciliationMatch = {
      candidateName: candidate.candidateName,
      existingItemId: found.item.id,
      existingBody: found.item.body,
      matchedBy: found.matchedBy,
      sameExperience: similarity >= SAME_EXPERIENCE_SIMILARITY_THRESHOLD,
      experienceSimilarity: similarity,
    }
    if (match.sameExperience) reused.push(match)
    else distinctSameVenue.push(match)
  }

  return { reused, distinctSameVenue, unmatched }
}
