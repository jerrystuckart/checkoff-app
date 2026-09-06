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
//
// PRODUCT RULE CORRECTIONS (Jerry, 2026-09-06 — see the San Diego
// metadata enrichment methodology update):
//
// 1. has_alcohol is an ITEM property, not a venue property — true only
//    when COMPLETING THE CHECKOFF ITEM ITSELF requires ordering/
//    consuming/engaging with alcohol ("Order a tiki cocktail at False
//    Idol" -> true; "Order the Paella Negra" at a place that also
//    serves alcohol -> false; "Dance at Rich's" -> false even though
//    Rich's is a bar). Category can never independently force true
//    anymore. All keyword matching uses whole-word regex (\b...\b) —
//    the previous plain substring check let "ale" fire inside "whale",
//    "Whaley", "Daley", "tamale", etc.
// 2. is_secret is NEVER inferred from wording (hidden doors, speakeasy
//    language, concealed entrances) — it's a separate paid Pro/Premium
//    business feature. This module only ever preserves an EXPLICIT
//    existing paid/business-configured secret flag; it never sets
//    is_secret=true on its own for any reason.
// 3. difficulty follows a completion-EFFORT rubric, not a prestige
//    rubric: 1 = normal walk-in, 5 = meaningful cost/reservation/
//    planning/travel/moderate physical effort/booked activity/limited
//    access, 10 = major commitment/high effort/cost/unusual activity
//    (skydiving), 25 = reserved for true Secret Items — NEVER
//    auto-assigned during normal intake, is_secret status included. A
//    concealed entrance alone (Noble Experiment, Oculto 477, etc.) does
//    NOT bump difficulty; "Michelin" alone does NOT bump difficulty.
// 4. photo_required/checkin_type: unchanged from the original design —
//    photo only when the task itself requires photo proof or an
//    existing explicit override says so; otherwise tap; 'gps' still
//    never auto-assigned.
// 5. visit_profile_key: booked, operator-scheduled adventure activities
//    (whale watching, dolphin cruise, jet boat, hot air balloon,
//    paragliding, hang gliding, shark diving, zip line, guided
//    climbing) are reclassified to 'event' — their real visit behavior
//    is a fixed-duration scheduled activity, not open-ended outdoor
//    dwell or indoor attraction browsing — checked BEFORE the generic
//    category fallback.
// 6. website_url: no per-item research in this pass. Deferred to the
//    Google Places enrichment phase (captured alongside google_place_id
//    et al.); only items Places can't resolve get individual targeted
//    research afterward.

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
    /** An EXPLICIT existing paid/business-configured Secret Item flag — never a guess, never derived from wording. Absent/undefined means "no known paid config," which evaluates to false, not "unknown." */
    isSecretConfigured?: boolean
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

// Deliberately DRINK NOUNS only — never a venue-type word (brewery,
// winery, distillery, tasting room, bar, saloon, tavern, speakeasy).
// Touring a winery or dancing at a bar doesn't itself require ordering
// alcohol; naming a specific drink does. Matched with \b...\b word
// boundaries so "ale" can never fire inside "whale"/"Whaley"/"Daley"/
// "tamale" — \b only matches at a transition between a word character
// and a non-word character (or string start/end), and none of those
// words contain such a transition around their embedded "ale" letters.
const ALCOHOL_ITEM_KEYWORDS = [
  'cocktail', 'cocktails', 'beer', 'beers', 'wine', 'wines', 'mezcal', 'tequila', 'whiskey', 'whisky',
  'bourbon', 'rum', 'vodka', 'gin', 'ipa', 'lager', 'ale', 'stout', 'sangria', 'margarita', 'martini',
  'prosecco', 'champagne', 'cava', 'sake', 'pint', 'spirits', 'aperitif', 'negroni', 'mimosa', 'sommelier',
  'hazy ipa', 'craft beer', 'wine tasting', 'beer flight', 'cocktail menu',
]

function wordBoundaryPattern(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i')
}

const ALCOHOL_ITEM_PATTERNS = ALCOHOL_ITEM_KEYWORDS.map((k) => ({ keyword: k, pattern: wordBoundaryPattern(k) }))

export function determineHasAlcohol(input: Pick<MetadataEnrichmentInput, 'body' | 'dbCategory'>): FieldEvaluation<boolean> {
  const hit = ALCOHOL_ITEM_PATTERNS.find(({ pattern }) => pattern.test(input.body))
  if (hit) {
    return { evaluated: true, value: true, confidence: 'HIGH', reason: `Completing this item itself requires ordering/consuming a specific alcoholic drink ("${hit.keyword}").` }
  }
  return {
    evaluated: true,
    value: false,
    confidence: 'HIGH',
    reason: `No specific alcoholic drink named as part of the item's own task — has_alcohol is an item property, not a venue property, so category ("${input.dbCategory}") alone (e.g. a bar or nightlife venue) never sets this true on its own.`,
  }
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
// is_secret — NEVER inferred from wording, ever (2026-09-06 product
// correction). is_secret marks a paid Pro/Premium business feature (a
// business-configured reveal-on-arrival experience), not an editorial
// judgment about whether a venue's OWN description sounds hidden or
// speakeasy-styled. Noble Experiment, Raised by Wolves, Oculto 477,
// False Idol, Realm of the 52 Remedies, etc. may describe concealed
// entrances in their item wording — that is flavor text, not a signal
// this function is allowed to act on. The ONLY way this returns true is
// an explicit existing paid/business-configured flag passed in — never
// derived from `body` at all, on purpose (no `body` parameter exists).
// ---------------------------------------------------------------------------

export function determineIsSecret(existingConfiguredSecret: boolean | undefined): FieldEvaluation<boolean> {
  if (existingConfiguredSecret) {
    return {
      evaluated: true,
      value: true,
      confidence: 'HIGH',
      reason: 'Preserved an existing EXPLICIT paid/business-configured Secret Item flag — is_secret is never inferred from item wording (hidden doors, speakeasy language, concealed entrances), only from real Pro/Premium business configuration.',
      preservedManualOverride: true,
    }
  }
  return {
    evaluated: true,
    value: false,
    confidence: 'HIGH',
    reason: 'is_secret is a separate paid Pro/Premium business feature, not an editorial classification — never inferred from hidden-entrance/speakeasy wording, regardless of how the item itself is written.',
  }
}

// ---------------------------------------------------------------------------
// difficulty — the app's real tiers are 1 / 5 / 10 / 25 (confirmed via
// DIFFICULTY_LABELS/DIFF_LABELS usage in ListScreen.jsx, LeaderboardScreen.jsx,
// SecretRevealScreen.jsx). This is a COMPLETION-EFFORT rubric, not a
// prestige rubric (2026-09-06 product correction):
//   1  = normal, easy walk-in/order/visit
//   5  = materially harder: meaningful cost, reservation/planning,
//        special timing, travel, moderate physical effort, a booked
//        activity, or limited access
//   10 = major commitment / high effort / high cost / unusual activity
//        (e.g. skydiving)
//   25 = reserved for true Secret Items / special premium experiences —
//        NEVER auto-assigned during normal metro intake, regardless of
//        is_secret status.
// "Michelin" alone does NOT imply tier 5 (prestige isn't effort). A
// concealed/hidden entrance alone does NOT imply a higher tier either
// (per the is_secret correction above — a normal hidden-bar visit stays
// at baseline unless it independently carries a real effort signal like
// a reservation requirement). Stays at 1 (HIGH confidence) unless a
// concrete, checkable effort signal is present, always flagged LOW
// confidence for a human's final call rather than silently applied.
// ---------------------------------------------------------------------------

const TIER5_EXCLUSIVITY_KEYWORDS = [
  'reservation-only', 'reservations required', 'reservation required', 'members-only', 'by appointment',
  'limited availability', 'sold out', 'hard to get', 'advance booking required', 'must book in advance',
]
const TIER5_ADVENTURE_KEYWORDS = [
  'hot air balloon', 'kayak', 'kayaking', 'jet boat', 'guided tour', 'guided haunted',
  'whale watching', 'dolphin cruise', 'sailing', 'surf lesson', 'zip line', 'zipline', 'paragliding',
  'hang gliding',
]
// Deliberately excludes bare "sea cave" — a genuine kayak/guided sea-cave TOUR is
// already caught via "kayak"/"guided tour" above; a bare, non-booked walk-through
// sea cave (e.g. Sunny Jim's Sea Cave — descend a tunnel through a beachfront shop,
// no booking, no guide) is a normal walk-in, not a booked adventure activity.
const TIER10_MAJOR_COMMITMENT_KEYWORDS = ['skydiv', 'shark diving', 'scuba certification']

export function determineDifficulty(input: Pick<MetadataEnrichmentInput, 'body' | 'dbCategory'>): FieldEvaluation<1 | 5 | 10 | 25> {
  const bodyLower = input.body.toLowerCase()
  const tier10Hit = TIER10_MAJOR_COMMITMENT_KEYWORDS.find((k) => bodyLower.includes(k))
  if (tier10Hit) {
    return { evaluated: true, value: 10, confidence: 'LOW', reason: `Body describes a major-commitment/high-risk activity ("${tier10Hit}") — proposed the top non-secret tier, but the exact tier is a curatorial call. Needs human confirmation.` }
  }
  const exclusivityHit = TIER5_EXCLUSIVITY_KEYWORDS.find((k) => bodyLower.includes(k))
  if (exclusivityHit) {
    return { evaluated: true, value: 5, confidence: 'LOW', reason: `Body signals real reservation/exclusivity effort ("${exclusivityHit}") — proposed a step above baseline. "Michelin" alone is deliberately NOT treated as an effort signal (prestige isn't effort). Needs human confirmation.` }
  }
  const adventureHit = TIER5_ADVENTURE_KEYWORDS.find((k) => bodyLower.includes(k))
  if (adventureHit) {
    return { evaluated: true, value: 5, confidence: 'LOW', reason: `Body describes a booked/moderate-physical-effort activity ("${adventureHit}") rather than a simple walk-in — proposed a step above baseline. Needs human confirmation.` }
  }
  return { evaluated: true, value: 1, confidence: 'HIGH', reason: 'Standard walk-in/order/visit experience — no signal of meaningful cost, reservation effort, travel, or physical exertion beyond the baseline tier. A concealed/hidden entrance alone does not raise this — see the is_secret correction.' }
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
// Booked, operator-scheduled adventure activities — a fixed-duration
// scheduled activity, closer to the 'event' dwell profile (20/75 min,
// per visit_detection_profiles) than open-ended outdoor park dwell or
// indoor attraction browsing. Checked BEFORE the generic outdoor/
// landmark keyword lists below (2026-09-06 correction — these were
// previously falling through to generic 'outdoor'/'attraction').
const ADVENTURE_ACTIVITY_EVENT_KEYWORDS = [
  'whale watching', 'dolphin cruise', 'jet boat', 'hot air balloon', 'paragliding', 'hang gliding',
  'shark diving', 'zip line', 'zipline', 'guided climbing', 'rock climbing', 'kayaking tour', 'sailing tour',
]
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
    const adventureEventHit = ADVENTURE_ACTIVITY_EVENT_KEYWORDS.find((k) => bodyLower.includes(k))
    if (adventureEventHit) {
      return { evaluated: true, value: 'event', confidence: 'HIGH', reason: `Body names a booked, operator-scheduled adventure activity ("${adventureEventHit}") — real visit behavior is a fixed-duration scheduled activity, not open-ended outdoor dwell or attraction browsing.` }
    }
    const outdoorHit = OUTDOOR_KEYWORDS.find((k) => bodyLower.includes(k))
    if (outdoorHit) return { evaluated: true, value: 'outdoor', confidence: 'HIGH', reason: `Body names an outdoor venue type ("${outdoorHit}").` }
    const landmarkHit = LANDMARK_KEYWORDS.find((k) => bodyLower.includes(k))
    if (landmarkHit) return { evaluated: true, value: 'landmark', confidence: 'HIGH', reason: `Body names a landmark-type venue ("${landmarkHit}").` }
    return { evaluated: true, value: 'attraction', confidence: 'MEDIUM', reason: `Category "${cat}" with no adventure-event/outdoor/landmark keyword — treated as an indoor/standing attraction.` }
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
    nextStep: `Capture "${input.candidateName}"'s website during the Google Places enrichment phase (alongside google_place_id/formatted_address/maps_lat/maps_lng/geo_location/geo_radius_m) — Places returns an official website field wherever the business has one on file. Only run an individual targeted lookup afterward if Places can't resolve this venue at all, or returns no usable website.`,
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
  // is_secret takes ONLY an explicit paid/business-configured flag — never `input`/`body` at
  // all, so there is no code path by which wording could influence this field.
  const isSecret = determineIsSecret(input.existing?.isSecretConfigured)
  const difficultyRaw = determineDifficulty(input)
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
