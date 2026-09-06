// agent-service/playbooks/metroMetadataEnrichment.ts
//
// Reusable Winston metro phase: METADATA COMPLETENESS ENRICHMENT.
//
// San Diego reconciliation (2026-09-06) revealed the next systematic gap
// after the 149-item catalog itself was correct: every non-geo metadata
// column was sitting at its bare insert-time DEFAULT — never actually
// evaluated per item. A default that happens to be correct (has_alcohol
// = false for a coffee shop) is indistinguishable, at the DB level, from
// a default nobody ever looked at (has_alcohol = false for a cocktail
// bar, simply because no one checked). This module makes that
// distinction real: every function here returns not just a value, but
// an explicit `evaluated: true` marker and the evidence/reasoning behind
// it, so "the field says false" and "someone confirmed false" are never
// conflated again.
//
// Scope: the 7 fields that can be evaluated from the item's own content
// (category, body, venue name) — website_url, has_alcohol, checkin_type,
// difficulty, photo_required, is_secret, visit_profile_key. The 6
// Google-Places-dependent fields (google_place_id, formatted_address,
// maps_lat, maps_lng, geo_location, geo_radius_m) are a DELIBERATELY
// separate phase (see metroGeoEnrichment.ts) — they require an external
// API call, not content evaluation, and must never be conflated with
// this gate.
//
// Deterministic where a real, generalizable rule exists; explicitly
// flagged for targeted research/manual review where it doesn't — never
// silently guessing a specific value (a fabricated difficulty tier, an
// invented "secret" status) the way the original insert-time defaults
// silently did.

import type { RealDbCategory, StagingGateResult } from './metroCatalog'

export interface MetadataEnrichmentInput {
  candidateName: string
  body: string
  dbCategory: RealDbCategory
  /** Existing production value, if any — used only to decide whether an existing MANUAL edit should be preserved (see preserveManualOverride). */
  existing?: {
    hasAlcohol?: boolean
    checkinType?: string
    difficulty?: number
    photoRequired?: boolean
    isSecret?: boolean
    visitProfileKey?: string | null
    websiteUrl?: string | null
  }
}

export type EvaluationConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface FieldEvaluation<T> {
  evaluated: true
  value: T
  confidence: EvaluationConfidence
  reason: string
  /** true when an existing value was a genuine manual edit (differs from the bare schema default) and this evaluation deliberately preserved it rather than overwriting. */
  preservedManualOverride?: boolean
}

// ---------------------------------------------------------------------------
// has_alcohol
// ---------------------------------------------------------------------------

const ALCOHOL_KEYWORDS = [
  'cocktail', 'cocktails', 'beer', 'beers', 'wine', 'wines', 'mezcal', 'tequila', 'whiskey', 'whisky',
  'bourbon', 'rum', 'vodka', 'gin', 'ipa', 'lager', 'ale', 'stout', 'sangria', 'margarita', 'martini',
  'prosecco', 'champagne', 'cava', 'sake', 'brewery', 'brewing', 'distillery', 'winery', 'tasting room',
  'bar,', 'speakeasy', 'saloon', 'tavern', 'pint', 'draft', 'brew', 'spirits', 'oysters and champagne',
  'chapulines', 'aperitif', 'negroni', 'mimosa', 'sommelier',
]
const ALCOHOL_CATEGORIES = new Set(['Bar & drinks', 'Nightlife'])

export function determineHasAlcohol(input: Pick<MetadataEnrichmentInput, 'body' | 'dbCategory'>): FieldEvaluation<boolean> {
  const bodyLower = input.body.toLowerCase()
  const keywordHit = ALCOHOL_KEYWORDS.find((k) => bodyLower.includes(k))
  if (keywordHit) {
    return { evaluated: true, value: true, confidence: 'HIGH', reason: `Body names a specific alcoholic item/venue type ("${keywordHit}").` }
  }
  if (ALCOHOL_CATEGORIES.has(input.dbCategory)) {
    return { evaluated: true, value: true, confidence: 'MEDIUM', reason: `Category "${input.dbCategory}" is alcohol-serving by definition even though no specific drink is named in the body.` }
  }
  return { evaluated: true, value: false, confidence: 'HIGH', reason: 'No alcohol-related keyword in body and category is not an alcohol-serving category.' }
}

// ---------------------------------------------------------------------------
// photo_required
// ---------------------------------------------------------------------------

const PHOTO_REQUIRED_KEYWORDS = ['photo', 'snap a pic', 'selfie', 'picture with', 'photograph']

export function determinePhotoRequired(input: Pick<MetadataEnrichmentInput, 'body'>): FieldEvaluation<boolean> {
  const bodyLower = input.body.toLowerCase()
  const keywordHit = PHOTO_REQUIRED_KEYWORDS.find((k) => bodyLower.includes(k))
  if (keywordHit) {
    return { evaluated: true, value: true, confidence: 'HIGH', reason: `Body itself instructs a photo-taking action ("${keywordHit}").` }
  }
  return { evaluated: true, value: false, confidence: 'MEDIUM', reason: 'Body does not itself describe a photo-taking action — standard tap check-in is sufficient proof.' }
}

// ---------------------------------------------------------------------------
// checkin_type — derived from photo_required, not independently guessed.
// 'gps' is DELIBERATELY never auto-assigned here: it has zero production
// precedent across every metro in this repo (confirmed via a migration-
// history search, 2026-09-06) — inventing a new GPS-verify UX for 149
// items with no prior validation is out of scope for a metadata
// EVALUATION pass. Flagged as a product decision for a future dedicated
// pass, not a default this function silently fills in.
// ---------------------------------------------------------------------------

export function determineCheckinType(photoRequired: FieldEvaluation<boolean>): FieldEvaluation<'tap' | 'photo'> {
  if (photoRequired.value) {
    return { evaluated: true, value: 'photo', confidence: photoRequired.confidence, reason: 'Mirrors photo_required=true — the UI\'s photo-check-in badge should match the actual requirement.' }
  }
  return { evaluated: true, value: 'tap', confidence: 'HIGH', reason: 'photo_required=false and \'gps\' checkin_type has no production precedent in this repo — tap is the correct, evaluated default, not an unevaluated leftover.' }
}

// ---------------------------------------------------------------------------
// is_secret — keyword-based detection of genuinely hidden/speakeasy-style
// venues, the one place a "secret" reveal-on-arrival presentation has real
// precedent in this codebase (see components/home/EditorialCard.jsx,
// screens/NearbyScreen.jsx). Deliberately conservative: only flags venues
// whose own body text describes physical concealment (a hidden entrance,
// a concealed door/wall/shelf), not merely a metaphorically "hidden gem."
// ---------------------------------------------------------------------------

const SECRET_KEYWORDS = [
  'hidden entrance', 'hidden speakeasy', 'concealed', 'unmarked door', 'unmarked entrance', 'no sign',
  'password', 'secret entrance', 'rotating shelf', 'keg wall', 'phone booth entrance', 'behind the',
]

export function determineIsSecret(input: Pick<MetadataEnrichmentInput, 'body'>): FieldEvaluation<boolean> {
  const bodyLower = input.body.toLowerCase()
  const keywordHit = SECRET_KEYWORDS.find((k) => bodyLower.includes(k))
  if (keywordHit) {
    return { evaluated: true, value: true, confidence: 'MEDIUM', reason: `Body describes physical concealment ("${keywordHit}") — a genuine hidden-entrance venue, not merely a "hidden gem" turn of phrase. Recommend a human confirm before flipping is_secret=true, since this changes real check-in UX (reveal-on-arrival, cover-candidate exclusion).` }
  }
  return { evaluated: true, value: false, confidence: 'HIGH', reason: 'No physical-concealment language in body.' }
}

// ---------------------------------------------------------------------------
// difficulty — the app's real tiers are 1 / 5 / 10 / 25 (confirmed via
// DIFFICULTY_LABELS/DIFF_LABELS usage in ListScreen.jsx, LeaderboardScreen.jsx,
// SecretRevealScreen.jsx), not an arbitrary numeric scale. A genuinely
// deterministic assignment beyond "1 unless there's a strong, specific,
// checkable signal for something rarer" would require judgment this
// function refuses to fabricate — so it stays at 1 (HIGH confidence,
// evaluated) for the ordinary case, and only proposes a higher tier when a
// concrete, checkable signal is present (reservation-required exclusivity,
// a real cost/rarity marker, or a secret/hidden venue) — always at MEDIUM
// or LOW confidence, explicitly flagged for a human's final call rather
// than silently applied.
// ---------------------------------------------------------------------------

const RESERVATION_OR_EXCLUSIVITY_KEYWORDS = [
  'reservation', 'reservations required', 'michelin', 'exclusive', 'members-only', 'by appointment',
  'limited availability', 'sold out', 'hard to get',
]
const HIGH_EFFORT_ADVENTURE_KEYWORDS = [
  'hot air balloon', 'kayak', 'kayaking', 'jet boat', 'sea cave', 'guided tour', 'guided haunted',
  'whale watching', 'dolphin cruise', 'sailing', 'surf lesson', 'zipline',
]

export function determineDifficulty(input: Pick<MetadataEnrichmentInput, 'body' | 'dbCategory'>, isSecret: FieldEvaluation<boolean>): FieldEvaluation<1 | 5 | 10 | 25> {
  const bodyLower = input.body.toLowerCase()
  if (isSecret.value) {
    return { evaluated: true, value: 10, confidence: 'LOW', reason: 'Hidden/concealed-entrance venue — proposed higher tier reflects the extra effort of finding it, but the exact tier (5 vs 10) is a curatorial call, not derivable from text alone. Needs human confirmation.' }
  }
  const exclusivityHit = RESERVATION_OR_EXCLUSIVITY_KEYWORDS.find((k) => bodyLower.includes(k))
  if (exclusivityHit) {
    return { evaluated: true, value: 5, confidence: 'LOW', reason: `Body signals real exclusivity/planning effort ("${exclusivityHit}") — proposed a step above baseline, but the exact tier is a curatorial call. Needs human confirmation.` }
  }
  const adventureHit = HIGH_EFFORT_ADVENTURE_KEYWORDS.find((k) => bodyLower.includes(k))
  if (adventureHit) {
    return { evaluated: true, value: 5, confidence: 'LOW', reason: `Body describes a higher-effort/booked activity ("${adventureHit}") rather than a simple walk-in — proposed a step above baseline. Needs human confirmation.` }
  }
  return { evaluated: true, value: 1, confidence: 'HIGH', reason: 'Standard walk-in/order/visit experience — no signal of unusual rarity, cost, or effort beyond the baseline tier.' }
}

// ---------------------------------------------------------------------------
// visit_profile_key — maps to the 10 real keys defined in
// supabase/migrations/20260828_visit_detection_phase1.sql
// (quick_stop, retail, fast_casual, restaurant, bar, attraction, outdoor,
// event, landmark, manual_only). Category is the primary signal;
// within-category keyword refinement handles the genuine ambiguity (a
// "Food & drink" category covers everything from a coffee counter to a
// sit-down Michelin restaurant, which have very different real dwell
// times). manual_only is the explicit fallback for anything that doesn't
// cleanly fit rather than a guessed profile.
// ---------------------------------------------------------------------------

export type VisitProfileKey = 'quick_stop' | 'retail' | 'fast_casual' | 'restaurant' | 'bar' | 'attraction' | 'outdoor' | 'event' | 'landmark' | 'manual_only'

const QUICK_STOP_KEYWORDS = ['coffee', 'café', 'cafe', 'espresso', 'latte', 'doughnut', 'donut', 'bakery', 'ice cream', 'gelato', 'boba', 'juice', 'smoothie']
const FAST_CASUAL_KEYWORDS = ['taco', 'food truck', 'counter', 'walk-up', 'to-go', 'takeout', 'quick bite', 'fast casual']
const OUTDOOR_KEYWORDS = ['park', 'beach', 'trail', 'garden', 'pier', 'coastal', 'tide pool', 'kayak', 'hike', 'hiking', 'zoo safari', 'outdoor']
const LANDMARK_KEYWORDS = ['monument', 'landmark', 'historic', 'bridge', 'lighthouse', 'mural', 'statue']
const EVENT_KEYWORDS = ['festival', 'parade', 'game', 'match', 'concert', 'regatta', 'tournament', 'contest', 'live show']

export function determineVisitProfileKey(input: Pick<MetadataEnrichmentInput, 'body' | 'dbCategory'>): FieldEvaluation<VisitProfileKey | null> {
  const bodyLower = input.body.toLowerCase()
  const cat = input.dbCategory

  if (cat === 'Bar & drinks' || cat === 'Nightlife') {
    return { evaluated: true, value: 'bar', confidence: 'HIGH', reason: `Category "${cat}" maps directly to the bar dwell profile.` }
  }
  if (cat === 'Shopping') {
    return { evaluated: true, value: 'retail', confidence: 'HIGH', reason: 'Category "Shopping" maps directly to the retail dwell profile.' }
  }
  if (cat === 'Sports' || cat === 'Social') {
    const eventHit = EVENT_KEYWORDS.find((k) => bodyLower.includes(k))
    if (eventHit) return { evaluated: true, value: 'event', confidence: 'HIGH', reason: `Category "${cat}" and body confirms a one-off/scheduled event ("${eventHit}").` }
    return { evaluated: true, value: 'attraction', confidence: 'MEDIUM', reason: `Category "${cat}" without an explicit scheduled-event keyword — treated as a standing attraction (e.g. a stadium tour) rather than a one-off event.` }
  }
  if (cat === 'Food & drink') {
    const quickHit = QUICK_STOP_KEYWORDS.find((k) => bodyLower.includes(k))
    if (quickHit) return { evaluated: true, value: 'quick_stop', confidence: 'HIGH', reason: `Body names a quick-stop venue type ("${quickHit}").` }
    const fastCasualHit = FAST_CASUAL_KEYWORDS.find((k) => bodyLower.includes(k))
    if (fastCasualHit) return { evaluated: true, value: 'fast_casual', confidence: 'HIGH', reason: `Body names a fast-casual venue type ("${fastCasualHit}").` }
    return { evaluated: true, value: 'restaurant', confidence: 'MEDIUM', reason: 'Category "Food & drink" with no quick-stop/fast-casual signal — treated as a sit-down restaurant dwell profile.' }
  }
  if (cat === 'Adventure' || cat === 'Travel') {
    const outdoorHit = OUTDOOR_KEYWORDS.find((k) => bodyLower.includes(k))
    if (outdoorHit) return { evaluated: true, value: 'outdoor', confidence: 'HIGH', reason: `Body names an outdoor venue type ("${outdoorHit}").` }
    const landmarkHit = LANDMARK_KEYWORDS.find((k) => bodyLower.includes(k))
    if (landmarkHit) return { evaluated: true, value: 'landmark', confidence: 'HIGH', reason: `Body names a landmark-type venue ("${landmarkHit}").` }
    return { evaluated: true, value: 'attraction', confidence: 'MEDIUM', reason: `Category "${cat}" with no outdoor/landmark keyword — treated as an indoor/standing attraction.` }
  }
  if (cat === 'Arts & Culture' || cat === 'Spa & self-care') {
    return { evaluated: true, value: 'attraction', confidence: 'MEDIUM', reason: `Category "${cat}" maps to the attraction dwell profile (museum/gallery/theater/spa-style indoor dwell).` }
  }
  return { evaluated: true, value: 'manual_only', confidence: 'LOW', reason: `Category "${cat}" does not cleanly map to any of the 9 real dwell profiles — manual_only is the explicit, honest fallback rather than a guessed profile.` }
}

// ---------------------------------------------------------------------------
// website_url — genuinely requires targeted research. The candidate
// pipeline's own sourceUrls are citation DESCRIPTIONS ("Visit California /
// sandiego.org / Tripadvisor"), not parseable URLs (confirmed by direct
// inspection of all 149 San Diego/Tijuana records, 2026-09-06 — zero
// contained an http(s) URL) — so there is no deterministic extraction
// possible here. This function's only job is to make that explicit: it
// never fabricates a URL, and always returns evaluated=false with a
// concrete next step, distinct from every other field in this module.
// ---------------------------------------------------------------------------

export interface WebsiteResearchNeeded {
  evaluated: false
  reason: string
  nextStep: string
}

export function determineWebsiteUrl(input: Pick<MetadataEnrichmentInput, 'candidateName'>): WebsiteResearchNeeded {
  return {
    evaluated: false,
    reason: 'No parseable official-website URL exists in this candidate\'s provenance (sourceUrls are citation descriptions, not URLs) — this field cannot be evaluated deterministically.',
    nextStep: `Run one targeted lookup for "${input.candidateName}"'s official website (a real domain, not a review/aggregator page like Yelp/Tripadvisor/Instagram) and record it with its source.`,
  }
}

// ---------------------------------------------------------------------------
// Full per-item enrichment record + preservation of Jerry's manual edits.
// ---------------------------------------------------------------------------

export interface MetadataEnrichmentResult {
  candidateName: string
  hasAlcohol: FieldEvaluation<boolean>
  photoRequired: FieldEvaluation<boolean>
  checkinType: FieldEvaluation<'tap' | 'photo'>
  isSecret: FieldEvaluation<boolean>
  difficulty: FieldEvaluation<1 | 5 | 10 | 25>
  visitProfileKey: FieldEvaluation<VisitProfileKey | null>
  websiteUrl: WebsiteResearchNeeded
}

/**
 * Applies the deterministic rules above to one item, then checks each
 * result against any existing production value: if the existing value
 * is a genuine MANUAL edit (differs from the bare schema default — e.g.
 * difficulty=10 when the default is 1, photo_required=true when the
 * default is false) it is preserved verbatim rather than overwritten,
 * per "preserve Jerry's existing manual overrides unless strong evidence
 * says they are invalid." A value that merely MATCHES the default is
 * NOT treated as a manual edit — there's no way to tell "confirmed false"
 * from "never touched" from the value alone, which is exactly the gap
 * this whole module exists to close.
 */
export function evaluateItemMetadata(input: MetadataEnrichmentInput): MetadataEnrichmentResult {
  const hasAlcohol = withPreservedOverride(determineHasAlcohol(input), input.existing?.hasAlcohol, false)
  const photoRequired = withPreservedOverride(determinePhotoRequired(input), input.existing?.photoRequired, false)
  const isSecret = withPreservedOverride(determineIsSecret(input), input.existing?.isSecret, false)
  const difficultyRaw = determineDifficulty(input, isSecret)
  const difficulty = withPreservedOverride(difficultyRaw, input.existing?.difficulty as 1 | 5 | 10 | 25 | undefined, 1)
  // checkin_type is derived from the (possibly preserved) photo_required, so a
  // preserved photo_required=true override still correctly yields checkin_type='photo'.
  const checkinType = determineCheckinType(photoRequired)
  const visitProfileKey = withPreservedOverride(determineVisitProfileKey(input), input.existing?.visitProfileKey as VisitProfileKey | null | undefined, null)
  const websiteUrl = determineWebsiteUrl(input)

  return { candidateName: input.candidateName, hasAlcohol, photoRequired, checkinType, isSecret, difficulty, visitProfileKey, websiteUrl }
}

function withPreservedOverride<T>(evaluation: FieldEvaluation<T>, existingValue: T | null | undefined, schemaDefault: T): FieldEvaluation<T> {
  if (existingValue === undefined || existingValue === null) return evaluation
  const isManualOverride = JSON.stringify(existingValue) !== JSON.stringify(schemaDefault)
  if (!isManualOverride) return evaluation
  return {
    evaluated: true,
    value: existingValue,
    confidence: 'HIGH',
    reason: `Preserved Jerry's existing manual override (${JSON.stringify(existingValue)}, differs from the bare schema default ${JSON.stringify(schemaDefault)}) rather than overwriting with this pass's evaluated value (${JSON.stringify(evaluation.value)}).`,
    preservedManualOverride: true,
  }
}

// ---------------------------------------------------------------------------
// Reusable metro_launch gate — "every final item has been EVALUATED for
// this pass's 7 fields," not merely "the columns hold some value" (every
// column always holds SOME value, even an unevaluated default — that's
// exactly the gap San Diego's reconciliation exposed). A future bare
// "Winston, build out <city>" cannot be reported launch-ready while this
// gate hasn't run, per docs/metro-launch-playbook.md Part 5.
// ---------------------------------------------------------------------------

export function evaluateMetadataCompletenessGate(results: readonly MetadataEnrichmentResult[]): StagingGateResult {
  if (results.length === 0) {
    return { key: 'METADATA_COMPLETENESS_GATE', verdict: 'FAIL', reason: 'No items were evaluated at all — this gate cannot pass on an empty set.' }
  }
  const unevaluated: string[] = []
  for (const r of results) {
    const fields: Array<[string, { evaluated: boolean }]> = [
      ['hasAlcohol', r.hasAlcohol],
      ['photoRequired', r.photoRequired],
      ['checkinType', r.checkinType],
      ['isSecret', r.isSecret],
      ['difficulty', r.difficulty],
      ['visitProfileKey', r.visitProfileKey],
    ]
    for (const [name, field] of fields) {
      if (!field.evaluated) unevaluated.push(`${r.candidateName}.${name}`)
    }
  }
  if (unevaluated.length > 0) {
    return {
      key: 'METADATA_COMPLETENESS_GATE',
      verdict: 'FAIL',
      reason: `${unevaluated.length} field(s) across ${results.length} item(s) were never evaluated: ${unevaluated.slice(0, 10).join(', ')}${unevaluated.length > 10 ? ', ...' : ''}.`,
    }
  }
  const needingWebsiteResearch = results.filter((r) => !r.websiteUrl.evaluated).length
  const lowConfidence = results.reduce((n, r) => n + [r.hasAlcohol, r.photoRequired, r.isSecret, r.difficulty, r.visitProfileKey].filter((f) => f.confidence === 'LOW').length, 0)
  return {
    key: 'METADATA_COMPLETENESS_GATE',
    verdict: 'PASS',
    reason: `All ${results.length} item(s) evaluated for has_alcohol/photo_required/checkin_type/is_secret/difficulty/visit_profile_key. ${needingWebsiteResearch} item(s) still need a targeted website_url research pass (tracked separately, not a gate failure — see determineWebsiteUrl). ${lowConfidence} evaluated field(s) are LOW confidence and worth a human glance before applying, but every field was genuinely looked at, not left at an unevaluated default.`,
  }
}

/**
 * Placeholder for the SEPARATE, Google-Places-dependent geo enrichment
 * phase (google_place_id, formatted_address, maps_lat, maps_lng,
 * geo_location, geo_radius_m) — deliberately NOT implemented here. This
 * gate exists so metro_launch's launch-readiness check has a single,
 * real place to call once that phase exists, instead of silently
 * skipping geo completeness the same way metadata completeness was
 * silently skipped before this module existed. Always FAILs today by
 * design — there is no fabricated "geo enrichment not needed" escape
 * hatch.
 */
export function evaluateGeoEnrichmentGate(hasRunGooglePlacesPass: boolean, evidence: string): StagingGateResult {
  if (!hasRunGooglePlacesPass) {
    return {
      key: 'GEO_ENRICHMENT_GATE',
      verdict: 'FAIL',
      reason: 'Google Places enrichment pass (google_place_id, formatted_address, maps_lat, maps_lng, geo_location, geo_radius_m) has not been run yet — see metroGeoEnrichment.ts. Not required for a soft/staged launch, but required before this gate can PASS for a full launch-readiness report.',
    }
  }
  return { key: 'GEO_ENRICHMENT_GATE', verdict: 'PASS', reason: evidence }
}
