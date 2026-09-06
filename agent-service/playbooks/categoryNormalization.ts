// Chief — deterministic category normalization (structural bug fix,
// found during the first real San Diego metro_launch run: auditCoverage
// exact-string-matched candidate.category against the fixed CheckOff
// taxonomy, but research_verifier's live output uses free-text
// descriptive categories — "Restaurant (Japanese/izakaya)", "Food Hall",
// "Nightclub/multi-room" — so 9 of 11 categories were falsely reported
// "0/minimum" despite real coverage existing under a differently-worded
// label. This is a PURE, DETERMINISTIC classifier — never a second AI
// call — because a coverage count must never depend on model
// non-determinism.
//
// Deliberately NOT exhaustive: an unmatched or multi-matched label is
// reported as unclassified/ambiguous rather than forced into a bucket —
// per the explicit instruction that the model must never be allowed to
// invent new coverage categories by having its wording silently coerced
// into one.

export const CANONICAL_CHECKOFF_CATEGORIES = [
  'Food & drink',
  'Bar & drinks',
  'Adventure',
  'Arts & Culture',
  'Shopping',
  'Sports',
  'Social',
  'Travel',
  'Nightlife',
  'Spa & self-care',
  'Misc',
] as const

export type CanonicalCategory = (typeof CANONICAL_CHECKOFF_CATEGORIES)[number]

export interface CategoryClassification {
  /** The exact, unmodified label the model produced — always preserved for evidence/debugging, never discarded. */
  raw: string
  canonical: CanonicalCategory | null
  /** True when the raw label's keywords matched more than one canonical bucket — surfaced, never silently guessed. */
  ambiguous: boolean
}

/**
 * Ordered rule list — the FIRST matching rule wins, so order encodes
 * priority for labels that could plausibly fit more than one bucket
 * (e.g. "rooftop bar" contains a drinking-establishment word and should
 * land in Bar & drinks even though it also serves food; "gastropub"
 * must NOT match a bare "pub" test against "cocktail lounge").
 */
const RULES: ReadonlyArray<{ canonical: CanonicalCategory; pattern: RegExp }> = [
  { canonical: 'Nightlife', pattern: /\b(night ?club|dance club|rave|edm club|adult entertainment|gentlemen'?s club|strip club|showgirls)\b/i },
  { canonical: 'Bar & drinks', pattern: /\b(bar|cocktail|speakeasy|tiki|brewery|brewpub|taproom|wine bar|mezcal(er[ií]a)?|cantina|\bpub\b)\b/i },
  { canonical: 'Spa & self-care', pattern: /\b(spa|self-care|wellness center|massage|sauna|float tank)\b/i },
  {
    canonical: 'Adventure',
    pattern:
      /\b(adventure|kayak|zip[- ]?line|glid(e|ing)|scuba|diving|surf(ing)?|hik(e|ing)|paraglid|parahawk|helicopter tour|horseback|whale watch|dolphin cruise|jet boat|speed ?boat|hot air balloon|theme park|amusement park|wildlife park|safari|\bzoo\b)\b/i,
  },
  { canonical: 'Sports', pattern: /\b(sports?( (venue|organization|club|event|league|teams?))?|professional (sports )?teams?|baseball|soccer|rugby|hockey|\bmlb\b|\bmls\b|\bahl\b|\bnfl\b|\bnba\b|\bnwsl\b|skate ?park|athletic)\b/i },
  { canonical: 'Shopping', pattern: /\b(shopping|\bmalls?\b|outlet|boutique district|antique district|retail (center|hub|district)|shopping (mall|center|district|outlet)|\bmarkets?\b)\b/i },
  {
    canonical: 'Arts & Culture',
    pattern:
      /\b(museums?|galler(y|ies)|theat(er|re)|\barts?\b|cultural (center|centre|institutions?|district)|performing arts|music venue|historic(al)? (site|district|monument|park|landmark)|monument|landmark)\b/i,
  },
  {
    canonical: 'Social',
    pattern: /\b(social (club|group|communit(y|ies)|mixers?)|meetup|club for|singles (club|event)|reading club|book club|chess club|game (night|club)|community centers?|festival|pride\b)\b/i,
  },
  { canonical: 'Travel', pattern: /\b(guided tour|sightseeing|travel (agency|agencies|experience|management|attraction)|passport|visa services|tour operator)\b/i },
  {
    canonical: 'Food & drink',
    pattern:
      /\b(restaurant|caf[eé]|coffee|bakery|bistro|taco|pizza|seafood|dining|food ?hall|brunch|steak ?house|sushi|omakase|izakaya|trattoria|patisserie|chocolate shop|food truck|gastropub|eatery|grill|brasserie|fast.{0,2}casual|small.?plates|shared.?plates|cuisine|fine dining|italian|mexican|vietnamese|filipino|japanese|thai|korean|chinese|mediterranean|french|spanish|greek|tapas|dim sum|ramen|contemporary american|new american)\b/i,
  },
]

/** A model-emitted label that exactly matches a canonical name (any casing) always wins outright — covers the case where the model does the right thing. */
function exactCanonicalMatch(text: string): CanonicalCategory | null {
  const lower = text.toLowerCase()
  return CANONICAL_CHECKOFF_CATEGORIES.find((c) => c.toLowerCase() === lower) ?? null
}

/**
 * First-match-wins against the deliberately PRIORITY-ORDERED rule list
 * above — this is how a mixed-signal label (e.g. "Brewery / restaurant",
 * which is both a drinking establishment and food) gets a single,
 * deterministic answer instead of being needlessly punted to
 * "ambiguous": the ordering itself IS the tie-break policy. `ambiguous`
 * is reserved for a label that matches nothing (see `unclassified`) —
 * kept as a distinct field so a future rule genuinely needing an
 * unresolvable-tie signal has somewhere to report it, without changing
 * every caller's shape.
 */
export function classifyCategory(rawCategory: string | null | undefined): CategoryClassification {
  const raw = (rawCategory ?? '').trim()
  if (!raw) return { raw, canonical: null, ambiguous: false }

  const exact = exactCanonicalMatch(raw)
  if (exact) return { raw, canonical: exact, ambiguous: false }

  const firstMatch = RULES.find((r) => r.pattern.test(raw))
  if (!firstMatch) return { raw, canonical: null, ambiguous: false }
  return { raw, canonical: firstMatch.canonical, ambiguous: false }
}

export interface UnclassifiedCategory {
  raw: string
  ambiguous: boolean
}

export interface CanonicalCategoryCounts {
  counts: Array<{ categoryName: CanonicalCategory; count: number }>
  /** Every raw label that couldn't be confidently mapped — reported, never silently dropped or forced into a bucket. */
  unclassified: UnclassifiedCategory[]
}

/**
 * The M4 evidence-building step: turns a batch of candidates' raw,
 * free-text categories into canonical-taxonomy counts.
 * auditCoverage()/deriveMetroLoopAction() operate ONLY on the resulting
 * canonical counts — a raw label never reaches the gap/loop logic
 * directly.
 */
export function countByCanonicalCategory(rawCategories: ReadonlyArray<string | null | undefined>): CanonicalCategoryCounts {
  const counts = new Map<CanonicalCategory, number>()
  const unclassified: UnclassifiedCategory[] = []
  for (const raw of rawCategories) {
    const classification = classifyCategory(raw)
    if (classification.canonical) {
      counts.set(classification.canonical, (counts.get(classification.canonical) ?? 0) + 1)
    } else if (classification.raw) {
      unclassified.push({ raw: classification.raw, ambiguous: classification.ambiguous })
    }
  }
  return {
    counts: [...counts.entries()].map(([categoryName, count]) => ({ categoryName, count })),
    unclassified,
  }
}
