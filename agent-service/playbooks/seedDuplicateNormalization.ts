// agent-service/playbooks/seedDuplicateNormalization.ts
//
// Seed Portfolio Audit (M5_75_SEED_PORTFOLIO_AUDIT), adjustment 6 — an EARLY
// duplicate pass over the RAW, pre-editorial candidate seed. This is
// deliberately independent of, and does NOT replace, venueDuplicateDetection.ts's
// M8/M8.5 late pass (that module clusters CERTIFIED items by resolved Google
// Place ID after editorial writing — it stays completely untouched as the
// final safety net; see its own doc).
//
// This module runs earlier, on data that mostly does NOT have a resolved
// Place ID yet (Places lookup happens during M8 geo enrichment, well after
// this stage) — so it detects clusters by every signal actually available at
// the raw-candidate stage: Place ID when present, normalized venue name
// (Unicode/case/punctuation-insensitive), and address, THEN flags "multiple
// proposed actions at one real-world venue" for explicit review.
//
// Deliberately, like duplicateClusterResolution.ts, this module NEVER
// auto-merges. A cluster is only ever a REPORT — two candidates that are
// separate brands/counters sharing a location but represent materially
// different experiences must never be silently merged or silently kept as
// if reviewed; they are flagged, same as a same-experience pair, and the
// caller (the audit report's candidate-decision pass) is responsible for
// routing every cluster member through explicit evaluation.

import { experienceSimilarity } from './existingInventoryReconciliation'

export interface SeedDuplicateCandidate {
  name: string
  address?: string | null
  placeId?: string | null
  /** The specific experience/claim text — same field RawCandidate already carries as claimSupported. */
  claimSupported: string
}

export type SeedDuplicateClusterReason = 'SAME_PLACE_ID' | 'SAME_NORMALIZED_NAME' | 'SAME_ADDRESS'

export interface SeedDuplicateCluster {
  reason: SeedDuplicateClusterReason
  members: string[]
  /** Lowest/highest pairwise experienceSimilarity across the cluster's claimSupported text — informational only, exactly like duplicateClusterResolution.ts's minPairwiseSimilarity discipline. Never used by this module to decide anything. */
  minPairwiseSimilarity: number
  maxPairwiseSimilarity: number
  note: string
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const NOISE_WORDS = new Set(['the', 'a', 'an'])

function normalizedVenueKey(name: string): string {
  return normalizeText(name)
    .split(' ')
    .filter((w) => w && !NOISE_WORDS.has(w))
    .join(' ')
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    if (key === null || key === '') continue
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  return groups
}

function similarityStats(members: readonly SeedDuplicateCandidate[]): { min: number; max: number } {
  if (members.length < 2) return { min: 1, max: 1 }
  const venueWords = new Set(normalizedVenueKey(members[0]!.name).split(' ').filter(Boolean))
  const pairs: number[] = []
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      pairs.push(experienceSimilarity(members[i]!.claimSupported, members[j]!.claimSupported, venueWords))
    }
  }
  return { min: Math.min(...pairs), max: Math.max(...pairs) }
}

/**
 * Detects, on the raw pre-editorial seed, every group of candidates that
 * plausibly resolve to the same real-world venue — by Place ID (when
 * available), normalized name, and normalized address. Never merges, never
 * drops — every returned cluster is a "flag for explicit review" record.
 * A candidate appearing in more than one cluster (e.g. same Place ID AND
 * same normalized name) is intentional — both signals corroborate the same
 * real-world venue and both are worth surfacing.
 */
export function detectSeedDuplicateClusters(candidates: readonly SeedDuplicateCandidate[]): SeedDuplicateCluster[] {
  const clusters: SeedDuplicateCluster[] = []

  const byPlaceId = groupBy(candidates, (c) => c.placeId ?? null)
  for (const [placeId, members] of byPlaceId) {
    if (members.length < 2) continue
    const stats = similarityStats(members)
    clusters.push({
      reason: 'SAME_PLACE_ID',
      members: members.map((m) => m.name),
      minPairwiseSimilarity: stats.min,
      maxPairwiseSimilarity: stats.max,
      note: `${members.length} candidates share Google Place ID ${placeId} — same real-world venue. Flagged for explicit review: never auto-merged, may legitimately be distinct experiences at the same address (e.g. separate brands/counters sharing a location).`,
    })
  }

  const byName = groupBy(candidates, (c) => normalizedVenueKey(c.name))
  for (const [name, members] of byName) {
    if (members.length < 2) continue
    const stats = similarityStats(members)
    clusters.push({
      reason: 'SAME_NORMALIZED_NAME',
      members: members.map((m) => m.name),
      minPairwiseSimilarity: stats.min,
      maxPairwiseSimilarity: stats.max,
      note: `${members.length} candidates normalize to the same venue name ("${name}") — flagged for explicit review, never auto-merged.`,
    })
  }

  const byAddress = groupBy(candidates, (c) => (c.address ? normalizeText(c.address) : null))
  for (const [, members] of byAddress) {
    if (members.length < 2) continue
    // Only worth reporting as an ADDRESS cluster when it isn't already fully
    // covered by an identical-name cluster above (avoids reporting the same
    // exact pair twice under two reasons when name already caught it).
    const alreadyCoveredByName = members.every((m) => byName.get(normalizedVenueKey(m.name))?.length === members.length)
    if (alreadyCoveredByName) continue
    const stats = similarityStats(members)
    clusters.push({
      reason: 'SAME_ADDRESS',
      members: members.map((m) => m.name),
      minPairwiseSimilarity: stats.min,
      maxPairwiseSimilarity: stats.max,
      note: `${members.length} candidates with different names share the same normalized address — multiple proposed actions at one real-world venue. Flagged for explicit review: may be separate brands/counters at one location (kept distinct) or a mis-split of one venue (needs a human/scoring-rubric call), never silently resolved either way.`,
    })
  }

  return clusters
}

/** Convenience: the set of candidate names appearing in ANY detected cluster — every one of these requires explicit review before it can be READY (see seedPortfolioAudit.ts's evaluateSeedCandidate). */
export function candidateNamesInAnyCluster(clusters: readonly SeedDuplicateCluster[]): Set<string> {
  return new Set(clusters.flatMap((c) => c.members))
}
