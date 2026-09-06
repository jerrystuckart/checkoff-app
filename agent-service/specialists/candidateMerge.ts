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
// Design reversal, backed by real data (San Diego + Tijuana runs,
// 2026-09-05). The original rule required name identity AND claim
// similarity, on the theory that a shared venue name alone isn't proof
// of being the same candidate. Real research_verifier output falsified
// that theory's practical value: across ~300 real candidates from two
// live runs, EVERY SINGLE same-name duplicate was a re-description of
// the identical real thing — never once a genuinely different named
// sub-experience sharing a venue's exact name. What the claim-based gate
// actually did in practice was fail to merge these re-descriptions,
// because research passes describe the same real venue in wildly
// inconsistent ways: a first attempt at fixing this with a token-overlap
// (Jaccard) similarity threshold still mis-split 8 real duplicate pairs,
// because plenty of genuine re-descriptions score as low as 0.0
// similarity (e.g. "Ranked #6, praised dishes" vs. "Critic's Pick for
// Top Overall Restaurant" — the SAME restaurant, zero shared words) —
// indistinguishable by claim text alone from the deliberately-distinct
// test fixture below, which also scores 0.0. There is no reliable
// claim-text signal that separates these two situations.
//
// So: an exact normalized name match (case/spacing/punctuation-
// insensitive) is now decisive on its own — the dominant, first-class
// signal explicitly required by product policy. "One venue, multiple
// distinct CheckOff items" is still fully supported, just via the
// mechanism the real pipeline actually uses for it: research_verifier
// names a genuinely distinct sub-experience DIFFERENTLY (e.g. "X — Live
// Glassblowing Demo" vs. "X — Make-Your-Own-Glass Class"), so
// normalizedName simply won't match and both survive untouched. Address
// is still checked when BOTH candidates have one, so two different real
// locations that happen to share an exact name (e.g. a chain) are never
// merged.
// ---------------------------------------------------------------------------

/**
 * Two candidates are the SAME thing whenever the venue/item identity —
 * exact normalized name, and address when both have one — matches. See
 * the design-reversal doc above for why claim text is no longer part of
 * this decision.
 */
export function candidatesAreSameThing(a: RawCandidate, b: RawCandidate): boolean {
  const ka = candidateKey(a)
  const kb = candidateKey(b)
  if (ka.normalizedName !== kb.normalizedName) return false
  if (ka.normalizedAddress && kb.normalizedAddress && ka.normalizedAddress !== kb.normalizedAddress) return false
  return true
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
