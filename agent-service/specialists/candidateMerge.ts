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

/**
 * Two candidates are the SAME thing only if the venue identity (name,
 * and address when both have one) matches AND the specific claim/
 * experience is substantially the same — matching venue alone is
 * deliberately NOT enough (one venue, multiple distinct items is
 * explicitly allowed, per spec section 8).
 */
export function candidatesAreSameThing(a: RawCandidate, b: RawCandidate): boolean {
  const ka = candidateKey(a)
  const kb = candidateKey(b)
  if (ka.normalizedName !== kb.normalizedName) return false
  if (ka.normalizedAddress && kb.normalizedAddress && ka.normalizedAddress !== kb.normalizedAddress) return false
  // Same venue: only a real dupe if the claim also substantially overlaps
  // (exact match after normalization, or one contains the other — cheap,
  // deterministic, no fuzzy-matching dependency).
  return ka.normalizedClaim === kb.normalizedClaim || ka.normalizedClaim.includes(kb.normalizedClaim) || kb.normalizedClaim.includes(ka.normalizedClaim)
}

export interface DedupeResult<T extends RawCandidate> {
  deduped: T[]
  /** Each group's surviving representative index (within `deduped`) plus every raw input that collapsed into it — for audit trail, never silently discarded. */
  mergedGroups: Array<{ kept: T; discarded: T[] }>
}

/**
 * Deterministic dedupe across one or more research passes' candidate
 * lists. First occurrence in input order wins as the kept representative
 * — callers that want a different tie-break (e.g. highest
 * verificationConfidence) should pre-sort before calling this.
 */
export function dedupeCandidates<T extends RawCandidate>(candidates: readonly T[]): DedupeResult<T> {
  const deduped: T[] = []
  const groups: Array<{ kept: T; discarded: T[] }> = []

  for (const candidate of candidates) {
    const existingGroupIndex = deduped.findIndex((kept) => candidatesAreSameThing(kept, candidate))
    if (existingGroupIndex === -1) {
      deduped.push(candidate)
      groups.push({ kept: candidate, discarded: [] })
    } else if (deduped[existingGroupIndex] !== candidate) {
      groups[existingGroupIndex].discarded.push(candidate)
    }
  }

  return { deduped, mergedGroups: groups.filter((g) => g.discarded.length > 0) }
}

/** Merges dedupe results from multiple research passes (e.g. broad discovery + a targeted gap pass) into one coverage-countable set. */
export function mergeCandidateSets<T extends RawCandidate>(...sets: Array<readonly T[]>): DedupeResult<T> {
  return dedupeCandidates(sets.flat())
}
