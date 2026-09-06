// Chief Phase 2F — candidate identity/normalization + dedupe (spec
// section 8). Pure functions, no I/O. Research passes will often
// rediscover the same place/item — this module is what lets the driver
// count coverage correctly without either double-counting the same
// candidate twice OR silently merging two genuinely different CheckOff
// items at the same venue (one venue can have multiple distinct items —
// e.g. "the birria ramen at X" and "trivia night at X" are NOT the same
// candidate even though `source`/address overlap).

export interface RawCandidate {
  name: string
  category: string | null
  neighborhood: string | null
  /** The specific experience/claim — what actually makes this candidate distinct from another one at the same venue. */
  claimSupported: string
  source: string
  address?: string | null
}

export interface NormalizedCandidateKey {
  /** Lowercased, punctuation-stripped, whitespace-collapsed venue/item name. */
  normalizedName: string
  normalizedAddress: string | null
  /** A coarse fingerprint of the SPECIFIC experience, not just the venue — this is what distinguishes two real items at one place. */
  normalizedClaim: string
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Drops common venue-name noise words that don't change identity (the/a/restaurant/cafe/etc are too generic to distinguish anything). */
const NOISE_WORDS = new Set(['the', 'a', 'an'])

function normalizeName(name: string): string {
  return normalizeText(name)
    .split(' ')
    .filter((w) => w && !NOISE_WORDS.has(w))
    .join(' ')
}

export function candidateKey(candidate: RawCandidate): NormalizedCandidateKey {
  return {
    normalizedName: normalizeName(candidate.name),
    normalizedAddress: candidate.address ? normalizeText(candidate.address) : null,
    normalizedClaim: normalizeText(candidate.claimSupported),
  }
}

// ---------------------------------------------------------------------------
// Claim similarity — the San Diego real-run fix (2026-09-05). Two
// research passes re-describing the SAME real venue/experience almost
// never produce identical or substring-overlapping claim text (spec
// section 8's original "exact match or containment" rule), so 251 raw
// San Diego candidates carried 51 literal-same-name duplicate rows
// (e.g. "Westfield UTC" x5, each with a differently-worded generic mall
// description) straight through dedupeCandidates untouched. A token-
// overlap (Jaccard) similarity check on the SIGNIFICANT words of each
// claim catches these re-descriptions — every real duplicate pair
// sampled from that run scored >= 0.176; the existing, deliberate
// "same venue, different specific experience" test fixture (a glass-
// class vs. a glassblowing demonstration) scores 0.0. 0.15 sits
// comfortably between the two with margin on both sides.
// ---------------------------------------------------------------------------

const CLAIM_SIMILARITY_MERGE_THRESHOLD = 0.15

const CLAIM_STOPWORDS = new Set(['the', 'a', 'an', 'and', 'with', 'at', 'in', 'of', 'is', 'to', 'for', 'over', 'near', 'on', 'as', 'this', 'that'])

function significantWords(text: string): Set<string> {
  return new Set(normalizeText(text)
    .split(' ')
    .filter((w) => w.length > 2 && !CLAIM_STOPWORDS.has(w)))
}

/** Jaccard similarity (0-1) of two claims' significant-word sets. Deterministic, no fuzzy-matching library — a plain set-overlap ratio. */
function claimSimilarity(a: string, b: string): number {
  const wa = significantWords(a)
  const wb = significantWords(b)
  if (wa.size === 0 || wb.size === 0) return 0
  let intersection = 0
  for (const w of wa) if (wb.has(w)) intersection += 1
  const union = wa.size + wb.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Two candidates are the SAME thing only if the venue identity (name,
 * and address when both have one) matches AND the specific claim/
 * experience is substantially the same — matching venue alone is
 * deliberately NOT enough (one venue, multiple distinct items is
 * explicitly allowed, per spec section 8). "Substantially the same"
 * now includes token-overlap similarity, not just exact/substring
 * match, specifically to catch re-worded re-descriptions of the same
 * real thing across separate research passes (see doc above) — while
 * still rejecting genuinely different experiences at one venue, which
 * share little to no claim vocabulary.
 */
export function candidatesAreSameThing(a: RawCandidate, b: RawCandidate): boolean {
  const ka = candidateKey(a)
  const kb = candidateKey(b)
  if (ka.normalizedName !== kb.normalizedName) return false
  if (ka.normalizedAddress && kb.normalizedAddress && ka.normalizedAddress !== kb.normalizedAddress) return false
  if (ka.normalizedClaim === kb.normalizedClaim) return true
  if (ka.normalizedClaim.includes(kb.normalizedClaim) || kb.normalizedClaim.includes(ka.normalizedClaim)) return true
  return claimSimilarity(a.claimSupported, b.claimSupported) >= CLAIM_SIMILARITY_MERGE_THRESHOLD
}

/**
 * How "complete" a candidate's own evidence is — used to pick which
 * member of a duplicate group survives as the canonical representative,
 * instead of arbitrarily keeping whichever happened to appear first.
 * Duck-types optional research-evidence fields (verificationConfidence,
 * freshnessDate) that RawCandidate itself doesn't declare (they belong
 * to the fuller ResearchCandidateEvidence shape one layer up) rather
 * than widening RawCandidate's own contract for a scoring heuristic.
 */
function candidateCompletenessScore(c: RawCandidate): number {
  const extra = c as RawCandidate & { verificationConfidence?: string; freshnessDate?: string | null }
  let score = c.claimSupported.length
  if (extra.verificationConfidence === 'HIGH') score += 1000
  else if (extra.verificationConfidence === 'MEDIUM') score += 500
  if (extra.freshnessDate) score += 100
  if (c.address) score += 50
  if (c.neighborhood) score += 20
  return score
}

export interface DedupeResult<T extends RawCandidate> {
  /** The canonical, deduplicated set — each entry additionally carries every distinct source URL merged into it, so provenance is never lost even though only one representative survives. */
  deduped: Array<T & { mergedSourceUrls: string[] }>
  /** Each group's surviving representative plus every raw input that collapsed into it — for audit trail, never silently discarded. */
  mergedGroups: Array<{ kept: T; discarded: T[] }>
}

/**
 * Deterministic dedupe across one or more research passes' candidate
 * lists. Within a duplicate group, the member with the most complete
 * evidence (candidateCompletenessScore) is kept as the canonical
 * representative — not simply whichever appeared first — and every
 * distinct source URL in the group is preserved on it.
 */
export function dedupeCandidates<T extends RawCandidate>(candidates: readonly T[]): DedupeResult<T> {
  const groups: T[][] = []

  for (const candidate of candidates) {
    const group = groups.find((g) => candidatesAreSameThing(g[0], candidate))
    if (group) group.push(candidate)
    else groups.push([candidate])
  }

  const deduped: Array<T & { mergedSourceUrls: string[] }> = []
  const mergedGroups: Array<{ kept: T; discarded: T[] }> = []

  for (const group of groups) {
    const best = group.reduce((a, b) => (candidateCompletenessScore(b) > candidateCompletenessScore(a) ? b : a))
    const mergedSourceUrls = [...new Set(group.map((m) => m.source).filter((s): s is string => Boolean(s)))]
    deduped.push({ ...best, mergedSourceUrls })
    if (group.length > 1) {
      mergedGroups.push({ kept: best, discarded: group.filter((m) => m !== best) })
    }
  }

  return { deduped, mergedGroups }
}

/** Merges dedupe results from multiple research passes (e.g. broad discovery + a targeted gap pass) into one coverage-countable set. */
export function mergeCandidateSets<T extends RawCandidate>(...sets: Array<readonly T[]>): DedupeResult<T> {
  return dedupeCandidates(sets.flat())
}

/**
 * The M6.5/launch-boundary quality gate's real duplicate check (replaces
 * the previous hardcoded `suspectedDuplicates: []` placeholder in
 * metroLaunchDriver.ts's stepLaunchBoundary). Run against the CANONICAL
 * (already-deduped) candidate set as a genuine safety net — on a
 * correctly-deduped set this should always return empty; a nonempty
 * result means either a gap in candidatesAreSameThing or candidates
 * added after the last dedupe pass, and the launch gate is meant to
 * catch exactly that rather than pass silently.
 */
export function findSuspectedDuplicates<T extends RawCandidate>(candidates: readonly T[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (candidatesAreSameThing(candidates[i], candidates[j])) pairs.push([candidates[i].name, candidates[j].name])
    }
  }
  return pairs
}
