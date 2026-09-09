// Chief Phase 2AB — bounded, deterministic geo SECOND PASS. Runs only
// against an already-fetched, already-cached Places result (never a new
// paid call) for a candidate whose PRIMARY classification
// (classifyPlacesMatch) came back AMBIGUOUS_NEEDS_REVIEW,
// REJECTED_WRONG_MATCH, or UNRESOLVED. Looks for STRONG corroborating
// structural evidence the primary pass's plain name-similarity score
// doesn't see — real district/postal-code agreement, and real German<->
// English tourism-vocabulary equivalence — and upgrades the
// classification ONLY when that evidence is genuinely strong. Never
// invents confidence: a candidate this pass can't corroborate keeps its
// original classification, unchanged, for the driver to then treat as a
// genuine drop (see catalogPruning in metroLaunchDriver.ts), never a
// silently-accepted guess.

import { nameSimilarity, levenshtein, type PlacesMatchClassification, type PlacesResultLike } from './metroGeoEnrichment'

// ---------------------------------------------------------------------------
// Vienna district corroboration — a real postal-code <-> district-name
// mapping (1010-1230 = districts 1-23), checked against whatever
// district/neighborhood text is already known for the candidate.
// ---------------------------------------------------------------------------

// Most district names are the same proper noun in English and German —
// only district 1 has a genuinely different, commonly-used English
// name ("Inner City"). Multiple names per district are checked via the
// array; extractViennaDistrict matches any of them.
const VIENNA_DISTRICT_NAMES: Readonly<Record<number, readonly string[]>> = {
  1: ['innere stadt', 'inner city'], 2: ['leopoldstadt'], 3: ['landstrasse'], 4: ['wieden'], 5: ['margareten'], 6: ['mariahilf'],
  7: ['neubau'], 8: ['josefstadt'], 9: ['alsergrund'], 10: ['favoriten'], 11: ['simmering'], 12: ['meidling'],
  13: ['hietzing'], 14: ['penzing'], 15: ['rudolfsheim-funfhaus'], 16: ['ottakring'], 17: ['hernals'],
  18: ['wahring'], 19: ['dobling'], 20: ['brigittenau'], 21: ['floridsdorf'], 22: ['donaustadt'], 23: ['liesing'],
}

function stripDiacriticsLocal(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Extracts a Vienna district number (1-23) from free text — either a "10XX" postal code or an ordinal/name mention ("2nd district", "Leopoldstadt"). Returns null when nothing recognizable is present — never a guess. */
export function extractViennaDistrict(text: string | null | undefined): number | null {
  if (!text) return null
  const postal = text.match(/\b1(\d{2})0\b/) // 1010, 1020, ..., 1230
  if (postal) {
    const n = Number(postal[1])
    if (n >= 1 && n <= 23) return n
  }
  const ordinal = text.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+district\b/i)
  if (ordinal) {
    const n = Number(ordinal[1])
    if (n >= 1 && n <= 23) return n
  }
  const normalized = stripDiacriticsLocal(text)
  for (const [num, names] of Object.entries(VIENNA_DISTRICT_NAMES)) {
    if (names.some((name) => normalized.includes(name))) return Number(num)
  }
  return null
}

/** True only when BOTH sides name a real, specific Vienna district AND they agree — never a corroboration signal when either side is silent. */
export function districtsCorroborate(candidateContext: string | null | undefined, placesAddress: string | null | undefined): boolean {
  const a = extractViennaDistrict(candidateContext)
  const b = extractViennaDistrict(placesAddress)
  return a !== null && b !== null && a === b
}

// ---------------------------------------------------------------------------
// German<->English tourism-vocabulary equivalence — a small, deliberately
// bounded dictionary of real translation pairs seen in practice (Vienna,
// 2026-09-09: "Freyung organic market" vs. the real "Bio-Markt Freyung").
// Never a general-purpose translator — only substitutes a WHOLE word for
// its known equivalent, checked in both directions.
// ---------------------------------------------------------------------------

// Common given/saint names that recur in Austrian landmark compounds
// (Karlskirche = "Karl's church" = St. Charles's Church) — a real
// translation, not a spelling variant, so the fuzzy edit-distance
// tolerance in sharedSignificantWordCount can't catch it on its own.
// Deliberately small and bounded to names actually seen in real Vienna
// landmark names, never a general name-translation table.
const DE_EN_NAME_PAIRS: ReadonlyArray<[string, string]> = [
  ['karl', 'charles'],
  ['franz', 'francis'],
  ['josef', 'joseph'],
  ['maria', 'mary'],
  ['stephan', 'stephen'],
  ['peter', 'peter'],
  ['marx', 'marx'],
]

const DE_EN_PAIRS: ReadonlyArray<[string, string]> = [
  ['markt', 'market'],
  ['bio', 'organic'],
  ['kirche', 'church'],
  ['platz', 'square'],
  ['garten', 'garden'],
  ['park', 'park'],
  ['palais', 'palace'],
  ['schloss', 'palace'],
  ['museum', 'museum'],
  ['cafe', 'cafe'],
  ['restaurant', 'restaurant'],
  ['brucke', 'bridge'],
  ['turm', 'tower'],
  ['halle', 'hall'],
  ['strasse', 'street'],
  ['gasse', 'lane'],
  ['wien', 'vienna'],
  ['wiener', 'viennese'],
]

// German compound nouns join two real words with no space or separator
// ("Stephansdom" = "Stephans" + "dom" = "St. Stephen's Cathedral";
// "Karlskirche" = "Karls" + "kirche" = "St. Charles's Church") — a real,
// common, well-defined pattern for Austrian/German landmark names, not
// a general-purpose compound splitter. Splits a token that ends with a
// known suffix noun into [prefix, translated-suffix], stripping a
// linking "s"/"es" the German genitive commonly inserts.
const COMPOUND_SUFFIXES: ReadonlyArray<[string, string]> = [
  ['kirche', 'church'],
  ['dom', 'cathedral'],
  ['friedhof', 'cemetery'],
  ['platz', 'square'],
  ['markt', 'market'],
  ['garten', 'garden'],
  ['palais', 'palace'],
  ['schloss', 'palace'],
  ['turm', 'tower'],
  ['halle', 'hall'],
  ['oper', 'opera'],
  ['orchester', 'orchestra'],
  ['residenz', 'residence'],
]

function splitGermanCompound(token: string): string[] {
  for (const [suffix, en] of COMPOUND_SUFFIXES) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
      let prefix = token.slice(0, token.length - suffix.length)
      if (prefix.endsWith('es')) prefix = prefix.slice(0, -2)
      else if (prefix.endsWith('s')) prefix = prefix.slice(0, -1)
      return prefix ? [prefix, en] : [en]
    }
  }
  return [token]
}

/**
 * Deliberately ONE-DIRECTIONAL (German -> English only), never a
 * symmetric swap. An earlier version translated whichever side matched
 * EITHER column, which meant a German token translated TO English and
 * the already-English token on the other side translated BACK to
 * German — normalizing the two sides to DIFFERENT canonical forms
 * instead of the SAME one, so they never actually matched
 * ("Karlskirche" -> "karl"->"charles" but "St. Charles's Church" ->
 * "charles"->"karl" — misses each other entirely). Always converging on
 * English fixes that: an already-English token is simply left alone.
 */
function translateTokens(text: string): string[] {
  const normalized = stripDiacriticsLocal(text)
  const rawTokens = normalized.split(/[^a-z0-9]+/).filter(Boolean)
  return rawTokens.flatMap(splitGermanCompound).map((t) => {
    for (const [de, en] of DE_EN_PAIRS) {
      if (t === de) return en
    }
    for (const [de, en] of DE_EN_NAME_PAIRS) {
      if (t === de) return en
    }
    return t
  })
}

/** The higher of the plain name similarity and the similarity after normalizing known German<->English tourism-vocabulary pairs on BOTH sides — never lower than the plain score, so this can only help, never hurt, an already-decent match. */
export function translatedNameSimilarity(a: string, b: string): number {
  const plain = nameSimilarity(a, b)
  const translated = nameSimilarity(translateTokens(a).join(' '), translateTokens(b).join(' '))
  return Math.max(plain, translated)
}

// Generic tourism/venue-genre vocabulary — found live: "Vienna Hofburg
// Orchestra – Strauss & Mozart Concert" vs. the WRONG Places result
// "Vienna Premium Orchestra - Mozart & Strauss Concerts" shares 4 words
// (vienna/orchestra/mozart/strauss) while the actually-DISTINGUISHING
// words ("Hofburg" vs. "Premium") are completely different — Vienna
// genuinely has multiple competing "Mozart & Strauss concert" orchestra
// companies, so generic genre words are worthless as corroboration on
// their own. Excluded from the significant-word count entirely; only a
// real proper-noun-shaped word (a venue's own distinctive name) counts.
const GENERIC_STOPWORDS = new Set([
  'vienna', 'wien', 'wiener', 'viennese', 'austria', 'austrian',
  'orchestra', 'orchester', 'concert', 'concerts', 'konzert', 'mozart', 'strauss',
  'museum', 'museums', 'palace', 'palais', 'schloss', 'church', 'churches', 'kirche',
  'park', 'parks', 'garden', 'gardens', 'garten', 'market', 'markt', 'restaurant',
  'restaurants', 'cafe', 'hall', 'halle', 'theater', 'theatre', 'theatres',
  'district', 'bezirk', 'stadt', 'city', 'centre', 'center', 'central',
])

/**
 * Real, whole-WORD overlap after translation — deliberately word-level,
 * never character-level, because Levenshtein/substring similarity alone
 * is fooled by coincidental substrings (found live: "Café Central" vs.
 * the wrong Places result "DECENTRAL" scores 0.64 similarity purely
 * because "central" sits inside "decentral" — but as whole WORDS,
 * "central" (a token on its own) never equals "decentral" (one compound
 * token), so this correctly finds zero overlap). Only words of length
 * >= 4 that are NOT in GENERIC_STOPWORDS count — a shared genre word
 * ("orchestra", "concert") between two different real businesses is not
 * evidence they're the SAME business; a shared distinctive/proper-noun
 * word ("Hummel", "Redtenbach", "Musikverein") is.
 */
export function sharedSignificantWordCount(a: string, b: string): number {
  const wa = [...new Set(translateTokens(a).filter((w) => w.length >= 4 && !GENERIC_STOPWORDS.has(w)))]
  const wb = [...new Set(translateTokens(b).filter((w) => w.length >= 4 && !GENERIC_STOPWORDS.has(w)))]
  let count = 0
  for (const x of wa) {
    for (const y of wb) {
      // Exact match always counts. A bounded fuzzy match (edit distance
      // <= 1) counts ONLY for longer words (length >= 6) — this catches
      // real German<->English transliteration spelling variants of the
      // SAME proper noun ("Stephans"/"stephan" vs. "Stephen", after
      // compound-splitting) without being loose enough to conflate two
      // genuinely different short/common words.
      if (x === y || (x.length >= 6 && y.length >= 6 && levenshtein(x, y) <= 1)) {
        count++
        break
      }
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// The second pass itself.
// ---------------------------------------------------------------------------

export interface GeoSecondPassInput {
  /** The name actually used for the primary match (canonicalVenueName.ts's resolved name) — re-compared here with the added corroboration signals. */
  matchName: string
  /** Free text carrying whatever district/neighborhood context is already known for this candidate — never fetched fresh, only what's already on hand. */
  neighborhoodContext: string | null
  primaryClassification: PlacesMatchClassification
  topResult: PlacesResultLike | null
}

export interface GeoSecondPassResult {
  classification: PlacesMatchClassification
  reason: string
  /** True only when this pass actually changed the classification — false means the original stands, unchanged, ready for the driver to treat as a genuine drop if still not confident. */
  upgraded: boolean
}

const REJECTABLE_TIERS: readonly PlacesMatchClassification[] = ['AMBIGUOUS_NEEDS_REVIEW', 'REJECTED_WRONG_MATCH']

/**
 * Never touches EXACT/HIGH_CONFIDENCE_PARENT_VENUE/NO_CANONICAL_VENUE
 * (already confident or an accepted exception) and never rescues
 * UNRESOLVED (no topResult exists to corroborate against — that needs a
 * new lookup, out of scope for a no-paid-call second pass). Only
 * AMBIGUOUS_NEEDS_REVIEW/REJECTED_WRONG_MATCH are eligible.
 *
 * REQUIRES real whole-WORD overlap (sharedSignificantWordCount >= 1) as
 * a hard precondition, always — a district match or a high edit-
 * distance score is NEVER sufficient alone. This is deliberately strict
 * after a real false positive: "Café Central" vs. the wrong Places
 * result "DECENTRAL" scored 0.64 name similarity (a coincidental
 * substring) and would have been wrongly upgraded by district-match
 * alone. Word-level overlap correctly finds zero shared words for that
 * pair, so it stays rejected — exactly the desired outcome ("null is
 * better than a wrong venue").
 */
export function resolveGeoSecondPass(input: GeoSecondPassInput): GeoSecondPassResult {
  if (!REJECTABLE_TIERS.includes(input.primaryClassification) || !input.topResult) {
    return { classification: input.primaryClassification, reason: 'not eligible for second-pass review', upgraded: false }
  }

  const sharedWords = sharedSignificantWordCount(input.matchName, input.topResult.name)
  const districtMatch = districtsCorroborate(input.neighborhoodContext, input.topResult.formattedAddress)
  const translatedSim = translatedNameSimilarity(input.matchName, input.topResult.name)
  const originalSim = nameSimilarity(input.matchName, input.topResult.name)

  if (sharedWords === 0) {
    return {
      classification: input.primaryClassification,
      reason: `Second pass: no real shared significant word between "${input.matchName}" and "${input.topResult.name}" — a district match or edit-distance score alone is never sufficient corroboration. Original classification stands.`,
      upgraded: false,
    }
  }

  // At least one genuine shared word, PLUS either real district
  // agreement or a strong overall similarity — either one, on top of
  // the word-overlap gate, is real corroboration; neither alone (as
  // proven above) is.
  if (sharedWords >= 1 && districtMatch && translatedSim >= 0.4) {
    return {
      classification: 'EXACT',
      reason: `Second pass: ${sharedWords} shared significant word(s), district corroborated (${input.neighborhoodContext} matches ${input.topResult.formattedAddress}), translation-aware similarity ${translatedSim.toFixed(2)} (vs. plain ${originalSim.toFixed(2)}) — confirmed, not guessed.`,
      upgraded: true,
    }
  }
  // Two or more genuinely distinctive shared words (already filtered
  // through GENERIC_STOPWORDS, so these are never coincidental industry
  // jargon) is real corroboration on its own — no additional overall-
  // string-similarity floor required, since a plain Levenshtein
  // comparison over the FULL string is easily thrown off by word
  // reordering ("Redtenbach Kulturverein" vs. "Kulturverein Redtenbach")
  // even when the actual identifying content is unambiguous.
  if (sharedWords >= 2) {
    return {
      classification: 'EXACT',
      reason: `Second pass: ${sharedWords} shared distinctive words — confirmed without needing district corroboration or overall string similarity (translation-aware similarity ${translatedSim.toFixed(2)} vs. plain ${originalSim.toFixed(2)}).`,
      upgraded: true,
    }
  }

  return {
    classification: input.primaryClassification,
    reason: `Second pass found ${sharedWords} shared word(s) but not enough additional corroboration (district match: ${districtMatch}, translated similarity ${translatedSim.toFixed(2)}) — original classification stands.`,
    upgraded: false,
  }
}
