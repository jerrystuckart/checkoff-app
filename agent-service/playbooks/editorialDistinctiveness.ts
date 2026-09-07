// agent-service/playbooks/editorialDistinctiveness.ts
//
// Chief Phase 2U — permanent Winston metro-launch behavior, converted
// from the San Diego post-launch editorial lessons. Even after 7-8
// rounds of checking, Jerry kept finding items that passed
// metroCatalog.ts's EDITORIAL_GATE (no repeated-template opener, no
// unbacked ranking filler) but were still generic: "Go shopping at all
// the stores at the mall," "Have a drink at the bar," "See the art at
// the museum." EDITORIAL_GATE's word-bag check treats any word it
// doesn't recognize as "concrete" — but "shopping"/"stores"/"mall" ARE
// already in its generic-word sets, and the bug was that a bare
// action-only opener like "go"/"grab"/"stop by" slipped through as the
// one "concrete" word, since it isn't itself a venue-category noun.
//
// This module adds THREE things EDITORIAL_GATE does not do, per Jerry's
// explicit 2026-09-07 correction:
//   1. REJECT_NO_DISTINCTIVE_EXPERIENCE — a real semantic test ("could
//      this sentence still work if I swapped in ten other businesses of
//      the same type?"), implemented as an explicit phrase-template
//      library of the exact unacceptable CONCEPTS Jerry named (shop at
//      the mall, eat at the restaurant, drink at the bar, see art at the
//      museum, visit the beach, experience the nightlife), matched
//      independent of verb ("explore"/"discover"/"savor"/"experience"/
//      "enjoy"/"check out" are all still generic if the underlying
//      concept is still "go to this category of place and do the
//      category thing"). Synonym rotation never satisfies this — the gate
//      matches the CONCEPT (category noun + generic category verb), not
//      one banned word.
//   2. Mandatory venue-name single-quoting — every destination
//      business/venue/attraction/landmark named in the body must be
//      wrapped in literal single quotes ('Cori Pastificio Trattoria'),
//      including venues whose own name already contains an apostrophe
//      ('Hennessey's Tavern').
//   3. A HARD (not advisory) opening-word distribution gate — San Diego
//      had ~44-47/149 items opening with "Order" (~30%), each
//      individually valid, but the batch was still unacceptable. This
//      revises metroCatalog.ts's own note that "the 15% threshold is
//      only a warning" — Jerry's 2026-09-07 correction: that carve-out
//      let a real bad batch through, so a SEPARATE, hard,
//      certification-blocking gate now exists here, while EDITORIAL_GATE
//      itself is untouched (still advisory at the per-item pass, for the
//      reason documented there — a healthy batch that's independently
//      specific per item shouldn't be contorted into artificial lexical
//      diversity). The final metro certification always runs THIS gate,
//      hard.

import type { StagingGateResult } from './metroCatalog'

// ---------------------------------------------------------------------------
// 1. REJECT_NO_DISTINCTIVE_EXPERIENCE — generic-concept phrase templates.
// ---------------------------------------------------------------------------

export const REJECT_NO_DISTINCTIVE_EXPERIENCE = 'REJECT_NO_DISTINCTIVE_EXPERIENCE'

/**
 * Each entry is a (generic-verb-concept, generic-category-noun) pair.
 * Matched as: ANY verb synonym from the concept's list, followed
 * (anywhere later in the sentence, not necessarily adjacent) by ANY noun
 * synonym from the concept's list. This is deliberately CONCEPT-shaped,
 * not phrase-shaped — "Go shopping at all the stores at the mall,"
 * "Browse the shops at the mall," and "Discover the boutiques at this
 * shopping center" are the SAME failing concept (shop + mall/retail
 * category noun) even though no two of those sentences share a verb.
 *
 * A sentence only fails a concept when NEITHER the verb clause nor the
 * noun clause is qualified by a specific, checkable fact (a proper noun
 * beyond the venue itself, a number, a named product/dish/feature) —
 * see `hasQualifyingSpecificDetail` below. "Try the cacio e pepe
 * doughnuts at 'Cori Pastificio Trattoria'" never matches any of these
 * concepts at all (no generic category noun present); "Shop the
 * handmade leather goods at 'X'" WOULD match the shop/mall concept's
 * verb+category-noun pair on its own, but the specific product
 * ("handmade leather goods") is exactly the kind of qualifying detail
 * that should make it a false hit — see the worked examples in the test
 * file for exactly where the line is drawn.
 */
interface GenericConcept {
  key: string
  verbs: string[]
  nouns: string[]
}

const GENERIC_CONCEPTS: GenericConcept[] = [
  { key: 'shop-at-the-mall', verbs: ['shop', 'shopping', 'browse', 'browsing', 'explore', 'discover', 'wander', 'stroll'], nouns: ['mall', 'shopping center', 'shopping mall', 'stores', 'shops', 'boutiques', 'retailers'] },
  { key: 'eat-at-the-restaurant', verbs: ['eat', 'dine', 'grab a bite', 'have a meal', 'try the food', 'enjoy the food'], nouns: ['restaurant', 'eatery', 'diner', 'food'] },
  { key: 'drink-at-the-bar', verbs: ['have a drink', 'grab a drink', 'get a drink', 'drink', 'sip'], nouns: ['bar', 'pub', 'tavern', 'lounge'] },
  { key: 'see-art-at-the-museum', verbs: ['see', 'view', 'check out', 'look at', 'admire'], nouns: ['art', 'exhibits', 'exhibit', 'artwork', 'museum', 'gallery'] },
  { key: 'visit-the-beach', verbs: ['visit', 'go to', 'head to', 'check out', 'stop by', 'experience', 'enjoy'], nouns: ['beach', 'shoreline', 'coastline', 'waterfront'] },
  { key: 'experience-the-nightlife', verbs: ['experience', 'enjoy', 'check out', 'dive into', 'immerse yourself in'], nouns: ['nightlife', 'night scene', 'club scene'] },
  { key: 'browse-the-market', verbs: ['browse', 'explore', 'wander', 'stroll', 'check out'], nouns: ['market', 'marketplace', 'vendors', 'stalls'] },
]

/**
 * A phrase counts as "qualifying" (rescues an otherwise-generic concept
 * match) only when it names something a competitor of the same category
 * could NOT interchangeably claim: a specific dish/product/feature name,
 * a number, a proper noun beyond the venue's own name, or a quoted term.
 * Deliberately excludes generic intensifiers ("amazing," "best,"
 * "unique") — those are exactly the words that make a sentence SOUND
 * specific without actually being swappable-proof, which is the whole
 * failure mode this module exists to catch.
 */
// A hyphenated compound adjective ("shark-bitten," "hand-forged,"
// "wood-fired," "glass-blown") is a broad, reliable signal of a
// specific, one-of-a-kind descriptor — generic template language almost
// never uses one, since it would require actually knowing the specific
// object/detail being described.
const HYPHENATED_COMPOUND_DESCRIPTOR_PATTERN = /\b[a-z]+-[a-z]+\b/i
const QUALIFYING_DETAIL_PATTERN = /\d|"[^"]+"|['’][^'’]{2,}['’]|\b(handmade|artisan-made|vintage|antique|limited[- ]edition|since \d{4})\b/i

function normalizeForConceptMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface DistinctiveExperienceCheck {
  pass: boolean
  matchedConcept: string | null
  reason: string
}

/**
 * The "swap in ten other businesses" test, operationalized: does this
 * body match a known generic verb+category-noun concept with no
 * qualifying specific detail rescuing it? This can never be a perfect
 * substitute for human judgment on true edge cases, but it reliably
 * catches the exact failure patterns Jerry named, independent of
 * synonym choice.
 *
 * `venueName`, when supplied, is stripped from the body BEFORE the
 * qualifying-detail scan — the mandatory single-quoted venue name (see
 * checkVenueQuoted below) would otherwise itself satisfy the "quoted
 * term" qualifying-detail rule on every item, defeating this whole gate
 * once quoting is universal. The venue's own name is never, by itself,
 * the specific hook that rescues a generic sentence.
 */
export function checkDistinctiveExperience(body: string, venueName?: string): DistinctiveExperienceCheck {
  const normalized = normalizeForConceptMatch(body)
  const quoteNormalizedBody = normalizeQuotes(body)
  const bodyForQualifyingScan = venueName ? quoteNormalizedBody.split(`'${normalizeQuotes(venueName).trim()}'`).join(' ') : body
  const hasQualifyingDetail = QUALIFYING_DETAIL_PATTERN.test(bodyForQualifyingScan) || HYPHENATED_COMPOUND_DESCRIPTOR_PATTERN.test(bodyForQualifyingScan)

  for (const concept of GENERIC_CONCEPTS) {
    const verbHit = concept.verbs.find((v) => normalized.includes(normalizeForConceptMatch(v)))
    const nounHit = concept.nouns.find((n) => normalized.includes(normalizeForConceptMatch(n)))
    if (verbHit && nounHit) {
      if (hasQualifyingDetail) continue // a specific, checkable detail rescues this sentence — not swappable across ten competitors
      return {
        pass: false,
        matchedConcept: concept.key,
        reason: `Matches the generic "${concept.key}" concept (verb-equivalent "${verbHit}" + category noun "${nounHit}") with no specific, checkable detail rescuing it — this sentence would still work if you swapped in ten other businesses of the same type. ${REJECT_NO_DISTINCTIVE_EXPERIENCE}`,
      }
    }
  }
  return { pass: true, matchedConcept: null, reason: 'No generic verb+category-noun concept matched, or a qualifying specific detail rescues the match.' }
}

// ---------------------------------------------------------------------------
// 2. Mandatory venue-name single-quoting.
// ---------------------------------------------------------------------------

/** Normalizes curly quotes to straight quotes so a body using either is still recognized — the rule is "wrapped in single quotes," not "wrapped in exactly one Unicode codepoint." */
function normalizeQuotes(text: string): string {
  return text.replace(/[‘’]/g, "'")
}

export interface VenueQuotingCheck {
  pass: boolean
  reason: string
}

/**
 * Checks that the exact venue name appears in the body wrapped in a
 * leading and trailing single quote — a literal substring match, which
 * correctly handles a venue name that itself contains an apostrophe
 * ('Hennessey's Tavern' — three quote characters total, two of them the
 * wrapping pair and one the venue's own possessive) because the check
 * is "does '<venueName>' appear," not "are there exactly two quote
 * characters."
 */
export function checkVenueQuoted(body: string, venueName: string): VenueQuotingCheck {
  const normalizedBody = normalizeQuotes(body)
  const normalizedVenue = normalizeQuotes(venueName).trim()
  const wrapped = `'${normalizedVenue}'`
  if (normalizedBody.includes(wrapped)) {
    return { pass: true, reason: `Venue name appears correctly single-quoted: ${wrapped}` }
  }
  return { pass: false, reason: `Venue name "${venueName}" does not appear wrapped in single quotes in the body — expected to find ${wrapped} (straight or curly quotes both accepted).` }
}

// ---------------------------------------------------------------------------
// 3. Hard opening-word distribution gate — same computation as
//    metroCatalog.ts's advisory batch check, exposed here as a
//    standalone, certification-blocking gate. Default threshold matches
//    the existing 15% convention; overridable only for a documented,
//    compelling reason (never to quietly relax it for a bad batch).
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_OPENING_WORD_SHARE = 0.15
const MIN_BATCH_SIZE_FOR_DISTRIBUTION_CHECK = 10

function firstWordOf(body: string): string {
  const m = body.trim().match(/^[A-Za-z']+/)
  return m ? m[0].toLowerCase() : ''
}

export interface OpeningWordDistributionEvidence {
  bodies: readonly string[]
  maxShare?: number
}

export function evaluateOpeningDistributionGate(evidence: OpeningWordDistributionEvidence): StagingGateResult {
  const maxShare = evidence.maxShare ?? DEFAULT_MAX_OPENING_WORD_SHARE
  if (evidence.bodies.length < MIN_BATCH_SIZE_FOR_DISTRIBUTION_CHECK) {
    return { key: 'OPENING_DISTRIBUTION_GATE', verdict: 'PASS', reason: `Batch of ${evidence.bodies.length} is below the ${MIN_BATCH_SIZE_FOR_DISTRIBUTION_CHECK}-item minimum for a meaningful distribution check — gate does not apply.` }
  }
  const counts = new Map<string, number>()
  for (const body of evidence.bodies) {
    const w = firstWordOf(body)
    if (w) counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  const violations: string[] = []
  for (const [word, count] of counts) {
    const share = count / evidence.bodies.length
    if (share > maxShare) {
      violations.push(`"${word}" opens ${count}/${evidence.bodies.length} items (${(share * 100).toFixed(0)}%, over the ${(maxShare * 100).toFixed(0)}% max)`)
    }
  }
  if (violations.length > 0) {
    return {
      key: 'OPENING_DISTRIBUTION_GATE',
      verdict: 'FAIL',
      reason: `${violations.join('; ')}. This is a HARD certification failure regardless of whether each individual item is otherwise specific (San Diego precedent: ~44-47/149 items opened with "Order," each individually valid, but the batch was still unacceptable). Fix by finding more specific, varied hooks per venue — never by synonym-rotating the opening verb alone; semantic specificity still comes first.`,
    }
  }
  return { key: 'OPENING_DISTRIBUTION_GATE', verdict: 'PASS', reason: `No opening word exceeds ${(maxShare * 100).toFixed(0)}% of ${evidence.bodies.length} items.` }
}

// ---------------------------------------------------------------------------
// Combined per-metro certification, covering all three checks above for
// a full catalog. Distinct from metroCatalog.ts's EDITORIAL_GATE (which
// stays as-is, including its own advisory opening-word note) — this is
// the additional, stricter certification layer METRO_LAUNCH_CERTIFICATION
// actually gates on.
// ---------------------------------------------------------------------------

export interface DistinctivenessCertificationItem {
  candidateName: string
  venueName: string
  body: string
}

export interface DistinctivenessCertificationResult {
  gates: StagingGateResult[]
  distinctiveFailures: Array<{ candidateName: string; reason: string }>
  quotingFailures: Array<{ candidateName: string; reason: string }>
}

export function certifyEditorialDistinctiveness(items: readonly DistinctivenessCertificationItem[], maxOpeningShare?: number): DistinctivenessCertificationResult {
  const distinctiveFailures: Array<{ candidateName: string; reason: string }> = []
  const quotingFailures: Array<{ candidateName: string; reason: string }> = []

  for (const item of items) {
    const distinctiveness = checkDistinctiveExperience(item.body, item.venueName)
    if (!distinctiveness.pass) distinctiveFailures.push({ candidateName: item.candidateName, reason: distinctiveness.reason })

    const quoting = checkVenueQuoted(item.body, item.venueName)
    if (!quoting.pass) quotingFailures.push({ candidateName: item.candidateName, reason: quoting.reason })
  }

  const distinctiveGate: StagingGateResult =
    distinctiveFailures.length === 0
      ? { key: 'DISTINCTIVE_EXPERIENCE_GATE', verdict: 'PASS', reason: `All ${items.length} items pass the distinctive-experience test — none match a generic swap-in-ten-competitors concept.` }
      : { key: 'DISTINCTIVE_EXPERIENCE_GATE', verdict: 'FAIL', reason: distinctiveFailures.map((f) => `${f.candidateName}: ${f.reason}`).join(' | ') }

  const quotingGate: StagingGateResult =
    quotingFailures.length === 0
      ? { key: 'VENUE_QUOTING_GATE', verdict: 'PASS', reason: `All ${items.length} items correctly single-quote their destination venue name.` }
      : { key: 'VENUE_QUOTING_GATE', verdict: 'FAIL', reason: quotingFailures.map((f) => `${f.candidateName}: ${f.reason}`).join(' | ') }

  const openingGate = evaluateOpeningDistributionGate({ bodies: items.map((i) => i.body), maxShare: maxOpeningShare })

  return { gates: [distinctiveGate, quotingGate, openingGate], distinctiveFailures, quotingFailures }
}
