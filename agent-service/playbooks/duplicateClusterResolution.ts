// agent-service/playbooks/duplicateClusterResolution.ts
//
// Chief Phase 3C, Phase A — METRO_FINISHER_PACKET_EXECUTION's automatic
// resolution of a DUPLICATE_REVIEW_PACKET work item (same Google Place ID
// cluster — see venueDuplicateDetection.ts's VenueCluster). This module
// answers ONE question per cluster: given the member bodies (existing
// and/or newly-proposed), is this a real duplicate we can auto-resolve,
// or does it need a human?
//
// Pure — no I/O, no AI call. Reuses existingInventoryReconciliation.ts's
// own experienceSimilarity()/SAME_EXPERIENCE_SIMILARITY_THRESHOLD (the
// SAME word-overlap heuristic already trusted throughout this codebase
// for "is this the same CheckOff experience?") rather than inventing a
// second similarity metric — a decisive score either way (comfortably
// above or comfortably below the threshold) is auto-resolved; only a
// genuinely borderline score, or internally inconsistent place data,
// is escalated.
//
// Verdicts:
//   KEEP_BOTH         — materially distinct experiences at the same venue.
//   DROP_DUPLICATE    — same experience, near-identical framing; keep the
//                        stronger (longer/more specific) body, drop the rest.
//   MERGE_NOT_SUPPORTED — evidence conflicts (e.g. members disagree on
//                        their own Place ID) or venue data is otherwise
//                        inconsistent — never guessed past.
//   NEEDS_HUMAN_REVIEW — genuinely subjective/borderline; reserved for
//                        real ambiguity, never a default.

import { experienceSimilarity, SAME_EXPERIENCE_SIMILARITY_THRESHOLD } from './existingInventoryReconciliation'

export type DuplicateClusterVerdict = 'KEEP_BOTH' | 'DROP_DUPLICATE' | 'MERGE_NOT_SUPPORTED' | 'NEEDS_HUMAN_REVIEW'

export interface DuplicateClusterMember {
  /** Opaque identity — an existing production item id, or a candidateName for a not-yet-certified Finisher lead. Never assumed to be one or the other by this module. */
  id: string
  venueName: string
  body: string
  /** Null is legitimate for a not-yet-geo-enriched candidate — treated as "unknown," never as a mismatch on its own. */
  placeId: string | null
}

export interface DuplicateClusterResolutionResult {
  verdict: DuplicateClusterVerdict
  reason: string
  /** Set only for DROP_DUPLICATE — which member to keep vs. which to drop. */
  keepId?: string
  dropIds?: string[]
  /** The lowest pairwise experienceSimilarity observed across the cluster — always reported so a human can review a borderline call, same discipline as ReconciliationMatch.experienceSimilarity. */
  minPairwiseSimilarity?: number
}

/**
 * Above this, a pair is decisively the SAME experience — comfortably
 * above SAME_EXPERIENCE_SIMILARITY_THRESHOLD (0.35), never right at the
 * boundary, so a genuine tie doesn't get silently auto-resolved.
 */
const DECISIVE_SAME_MARGIN = 0.15
const DECISIVE_SAME_THRESHOLD = SAME_EXPERIENCE_SIMILARITY_THRESHOLD + DECISIVE_SAME_MARGIN

/**
 * Below this, a pair is decisively DISTINCT — comfortably under the
 * threshold, same reasoning as DECISIVE_SAME_THRESHOLD above.
 */
const DECISIVE_DISTINCT_MARGIN = 0.15
const DECISIVE_DISTINCT_THRESHOLD = Math.max(0, SAME_EXPERIENCE_SIMILARITY_THRESHOLD - DECISIVE_DISTINCT_MARGIN)

function venueWordsOf(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  )
}

/**
 * Resolves one same-Place-ID cluster. Never silently drops a member —
 * the caller (METRO_FINISHER_PACKET_EXECUTION) is responsible for
 * actually applying DROP_DUPLICATE to package state; this function only
 * makes the call.
 */
export function resolveDuplicateCluster(members: readonly DuplicateClusterMember[]): DuplicateClusterResolutionResult {
  if (members.length < 2) {
    return { verdict: 'KEEP_BOTH', reason: 'Fewer than 2 members — not a real cluster, nothing to resolve.' }
  }

  const knownPlaceIds = new Set(members.map((m) => m.placeId).filter((p): p is string => p !== null))
  if (knownPlaceIds.size > 1) {
    return {
      verdict: 'MERGE_NOT_SUPPORTED',
      reason: `Cluster members disagree on their own Google Place ID (${[...knownPlaceIds].join(', ')}) — venue identity data is internally inconsistent; refusing to auto-merge past a data conflict.`,
    }
  }

  // Pairwise experienceSimilarity across every member, excluding the
  // shared venue name's own words (reuses the EXACT signature/heuristic
  // existingInventoryReconciliation.ts already trusts).
  const venueWords = venueWordsOf(members[0]!.venueName)
  const pairs: number[] = []
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      pairs.push(experienceSimilarity(members[i]!.body, members[j]!.body, venueWords))
    }
  }
  const minSimilarity = Math.min(...pairs)
  const maxSimilarity = Math.max(...pairs)

  if (maxSimilarity <= DECISIVE_DISTINCT_THRESHOLD) {
    return {
      verdict: 'KEEP_BOTH',
      minPairwiseSimilarity: minSimilarity,
      reason: `Every pairwise experience-similarity score (max ${maxSimilarity.toFixed(2)}) is comfortably below the "same experience" threshold (${SAME_EXPERIENCE_SIMILARITY_THRESHOLD}) — these are materially distinct experiences at the same venue, kept as separate items.`,
    }
  }

  if (minSimilarity >= DECISIVE_SAME_THRESHOLD) {
    // Same experience, decisively — keep the strongest (longest/most
    // specific) body, drop the rest. Never a quality judgment beyond
    // length as a proxy for specificity; a human reviewing the report
    // still sees exactly which body was kept and why.
    const strongest = [...members].sort((a, b) => b.body.length - a.body.length)[0]!
    return {
      verdict: 'DROP_DUPLICATE',
      keepId: strongest.id,
      dropIds: members.filter((m) => m.id !== strongest.id).map((m) => m.id),
      minPairwiseSimilarity: minSimilarity,
      reason: `Every pairwise experience-similarity score (min ${minSimilarity.toFixed(2)}) is comfortably above the "same experience" threshold (${SAME_EXPERIENCE_SIMILARITY_THRESHOLD}) — this is the same CheckOff experience described more than once. Kept "${strongest.id}" (longest/most specific body) and dropped the rest.`,
    }
  }

  return {
    verdict: 'NEEDS_HUMAN_REVIEW',
    minPairwiseSimilarity: minSimilarity,
    reason: `Pairwise experience-similarity scores span ${minSimilarity.toFixed(2)}-${maxSimilarity.toFixed(2)}, straddling the "same experience" threshold (${SAME_EXPERIENCE_SIMILARITY_THRESHOLD}) without a decisive margin either way — genuinely ambiguous, reserved for a real human editorial call rather than an automatic guess.`,
  }
}
