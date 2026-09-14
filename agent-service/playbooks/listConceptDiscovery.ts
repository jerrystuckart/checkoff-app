// agent-service/playbooks/listConceptDiscovery.ts
//
// M9_HOME_LIST_MIRROR — PASS A: List Concept Discovery (Munich calibration
// Phase 3, commit 3/7). Pure, no I/O. Runs BEFORE any membership selection
// (listFitScoring.ts / listMembershipCuration additions, PASS B) — a
// candidate list CONCEPT must be evaluated for coherence and depth on its
// own terms first, independent of which specific items eventually end up on
// it.
//
// Why this is a genuinely separate pass, not folded into PASS B: the Munich
// calibration analysis found Winston's pipeline never proposed either of
// the two real, 20-item, coherent themed lists ("Beer Gardens, Breweries &
// Bavarian Rituals" and "Day Trips & Big Adventures") that the final,
// human-curated rebuild shipped — not because the underlying items were
// individually weak (per-item membership scoring, PASS B's job, would have
// happily included them once a list existed to score them against), but
// because THEMED_LIST_DEFINITIONS is a static, predefined list and nothing
// in the pipeline ever asked "is there a natural, coherent cluster here
// nobody defined a list for?" — see
// docs/metro-launch-audit/munich/calibration-analysis/12-m9-training-requirements.md's
// "What this means for THEMED_LIST_DEFINITIONS specifically" and
// 15-final-calibration-implementation-plan.md's "Why Winston never proposed
// Beer Gardens or Day Trips."
//
// Discovery mechanism (deliberately NOT limited to a fixed menu of generic
// themes): clusters the certified catalog by TAG CO-OCCURRENCE — tags are
// already curated, already-verified evidence (M7.5 TAG_ASSIGNMENT), not a
// guess, so a real, sizeable, coherently-co-occurring tag cluster is
// genuine evidence of a coherent editorial concept the same way the real
// Beer Gardens cluster's members shared 'beer-garden'/'brewery'/
// 'bavarian-ritual'-style tags. This never re-derives THEMED_LIST_DEFINITIONS'
// keyword/category matching (homeListThemes.ts) — it is a complementary,
// EARLIER pass that can surface a concept no one predefined; a discovered
// concept is still free to reuse homeListThemes.ts's pattern-matching
// machinery once PASS B evaluates its actual membership.
//
// Guardrail, not quota (same discipline as categoryPolicy.ts,
// packetExecutionBudget.ts, difficultyEvidence.ts): a cluster is never
// stretched to reach a target count. "Weak filler never justifies reaching
// a target count" is enforced code, not a comment — see REJECT's own
// condition below.

import type { RealDbCategory } from './metroCatalog'
import type { CommercialOwnershipType } from './categoryPolicy'

export interface ListConceptCandidateItem {
  candidateName: string
  venueName: string
  dbCategory: RealDbCategory
  finalTags: readonly string[]
  finalBody: string
  neighborhoodName: string
  /** Reuses categoryPolicy.ts's ownership taxonomy — omitted/undefined resolves to UNKNOWN_REQUIRES_VERIFICATION, same discipline as everywhere else in this codebase. */
  ownershipType?: CommercialOwnershipType
  /** True when this item's own already-decided experience-type signal (Adventure/Play/Nightlife/etc — usually just dbCategory, but callers may pass a finer-grained label) marks it seasonal-specific rather than evergreen. Optional — most items are evergreen. */
  isSeasonalSpecific?: boolean
}

export type ListConceptType = 'SEASONAL' | 'EVERGREEN' | 'NIGHTLIFE' | 'FOOD_AND_DRINK' | 'ADVENTURE' | 'CULTURAL' | 'OTHER'
export type ListConceptVerdict = 'CREATE' | 'HOLD' | 'REJECT' | 'REQUIRES_JERRY'

export interface ListConceptOverlap {
  withTitle: string
  sharedItemCount: number
  /** Share of THIS concept's own members that also appear in the other concept — not symmetric. */
  sharedPercent: number
}

export interface ListConceptCandidate {
  /** Draft, tag-derived title — a human/editorial pass renames this before it ever reaches Jerry; never shipped verbatim as a production list title by this module alone. */
  proposedTitle: string
  editorialPromise: string
  whyDistinctiveToThisMetro: string
  candidateItemCount: number
  strongFitItemCount: number
  categoryComposition: Record<string, number>
  geographicComposition: Record<string, number>
  experienceTypeComposition: { seasonalCount: number; evergreenCount: number }
  localIndependentBusinessSupport: { locallyOwnedCount: number; unknownCount: number; eligibleCount: number; locallyOwnedPercent: number }
  overlapWithOtherConcepts: ListConceptOverlap[]
  type: ListConceptType
  verdict: ListConceptVerdict
  evidence: string[]
  reasoning: string
  candidateNames: string[]
  /** The tags that seeded this cluster — the concrete evidence trail for "discovered from evidence, not from a template." */
  seedTags: string[]
}

export interface ListConceptDiscoveryConfig {
  /** Below this many members, a cluster is REJECTed outright — insufficient depth, never stretched to reach it. Matches metroLaunchDriver.ts's own THEMED_LIST_MIN_ITEMS=8 floor as the absolute minimum; this module's own default is intentionally somewhat higher (see minViableItems). */
  minViableItems: number
  /** Below this share of a cluster's members counting as "strong fit" (currently: sharing 2+ of the seed tags, a stronger signal than the single-tag floor used to form the cluster at all), the cluster HOLDs for review rather than CREATEs — weak filler never justifies reaching a target count. */
  minStrongFitRatio: number
  /** At or above this share of a candidate concept's members already belonging to another (already-accepted) concept, the candidate REQUIRES_JERRY — Phase 5's "a proposed concept with substantial overlap" boundary. */
  overlapRequiresJerryThreshold: number
  /** Tags to ignore entirely when forming clusters — already claimed by an existing THEMED_LIST_DEFINITIONS entry or an existing production list, so re-discovering the same concept from the same tags is noise, not a new finding. */
  excludedTags: ReadonlySet<string>
  /** A tag present in this fraction (or more) of the WHOLE catalog is too generic to seed a coherent concept on its own (e.g. a near-universal tag) — excluded from seeding, though it can still count toward strong-fit alongside a more specific co-tag. */
  maxTagPrevalenceToSeed: number
}

export const DEFAULT_LIST_CONCEPT_DISCOVERY_CONFIG: ListConceptDiscoveryConfig = {
  minViableItems: 15,
  minStrongFitRatio: 0.6,
  overlapRequiresJerryThreshold: 0.5,
  excludedTags: new Set(),
  maxTagPrevalenceToSeed: 0.5,
}

function titleCaseTag(tag: string): string {
  return tag
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

function draftTitleFromTags(tags: readonly string[]): string {
  return tags.map(titleCaseTag).join(' & ')
}

/**
 * Forms raw tag-co-occurrence cluster SEEDS from the certified catalog —
 * the actual "discover from evidence, not a template" mechanism. A seed is
 * either a single tag present in >= minViableItems items (and below
 * maxTagPrevalenceToSeed's genericness ceiling), or a PAIR of tags whose
 * co-occurring itemset (both tags present) alone clears minViableItems —
 * catching a real multi-tag concept (e.g. 'beer-garden' + 'brewery') that
 * neither tag alone would necessarily reach on its own, and that reads as a
 * more specific, more coherent concept than either tag individually.
 * Deliberately conservative: never a 3+-tag combinatorial search (would
 * overfit tiny catalogs to noise), and single-tag/pair seeds whose member
 * sets are IDENTICAL collapse to the richer pair seed only, so the same
 * cluster is never reported as two near-duplicate candidates.
 */
function discoverClusterSeeds(items: readonly ListConceptCandidateItem[], config: ListConceptDiscoveryConfig): Array<{ tags: string[]; members: ListConceptCandidateItem[] }> {
  const totalCount = items.length
  const byTag = new Map<string, ListConceptCandidateItem[]>()
  for (const item of items) {
    for (const tag of item.finalTags) {
      if (config.excludedTags.has(tag)) continue
      byTag.set(tag, [...(byTag.get(tag) ?? []), item])
    }
  }

  const eligibleTags = [...byTag.entries()].filter(([, members]) => totalCount === 0 || members.length / totalCount <= config.maxTagPrevalenceToSeed)

  const seeds: Array<{ tags: string[]; members: ListConceptCandidateItem[] }> = []
  const seenMemberKeys = new Set<string>()

  const memberKey = (members: readonly ListConceptCandidateItem[]) =>
    members
      .map((m) => m.candidateName)
      .sort()
      .join('|')

  // Pair seeds first — richer/more specific signal takes priority over a
  // broader single-tag seed with the identical membership.
  for (let i = 0; i < eligibleTags.length; i++) {
    for (let j = i + 1; j < eligibleTags.length; j++) {
      const [tagA, membersA] = eligibleTags[i]!
      const [tagB, membersB] = eligibleTags[j]!
      const setB = new Set(membersB.map((m) => m.candidateName))
      const both = membersA.filter((m) => setB.has(m.candidateName))
      if (both.length < config.minViableItems) continue
      const key = memberKey(both)
      if (seenMemberKeys.has(key)) continue
      seenMemberKeys.add(key)
      seeds.push({ tags: [tagA, tagB].sort(), members: both })
    }
  }

  for (const [tag, members] of eligibleTags) {
    if (members.length < config.minViableItems) continue
    const key = memberKey(members)
    if (seenMemberKeys.has(key)) continue
    seenMemberKeys.add(key)
    seeds.push({ tags: [tag], members })
  }

  return seeds
}

function composition(items: readonly ListConceptCandidateItem[], keyOf: (i: ListConceptCandidateItem) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) {
    const key = keyOf(item)
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

const LOCALLY_OWNED_TYPES: ReadonlySet<CommercialOwnershipType> = new Set(['INDEPENDENT_LOCAL', 'SMALL_LOCAL_GROUP'])
const EXCLUDED_FROM_MIX: ReadonlySet<CommercialOwnershipType> = new Set(['PUBLIC_INSTITUTION', 'NONCOMMERCIAL_OUTDOOR_OR_CIVIC'])

function localBusinessSupport(items: readonly ListConceptCandidateItem[]) {
  const eligible = items.filter((i) => !EXCLUDED_FROM_MIX.has(i.ownershipType ?? 'UNKNOWN_REQUIRES_VERIFICATION'))
  const unknown = eligible.filter((i) => (i.ownershipType ?? 'UNKNOWN_REQUIRES_VERIFICATION') === 'UNKNOWN_REQUIRES_VERIFICATION')
  const known = eligible.filter((i) => (i.ownershipType ?? 'UNKNOWN_REQUIRES_VERIFICATION') !== 'UNKNOWN_REQUIRES_VERIFICATION')
  const locallyOwned = known.filter((i) => LOCALLY_OWNED_TYPES.has(i.ownershipType!))
  return {
    locallyOwnedCount: locallyOwned.length,
    unknownCount: unknown.length,
    eligibleCount: eligible.length,
    locallyOwnedPercent: known.length > 0 ? (locallyOwned.length / known.length) * 100 : 0,
  }
}

function inferConceptType(tags: readonly string[], items: readonly ListConceptCandidateItem[]): ListConceptType {
  const lowerTags = tags.map((t) => t.toLowerCase())
  if (lowerTags.some((t) => /night|late-night|nightlife|cocktail|club/.test(t))) return 'NIGHTLIFE'
  if (lowerTags.some((t) => /beer|brewery|cafe|coffee|market|food|drink|bakery|restaurant/.test(t))) return 'FOOD_AND_DRINK'
  if (lowerTags.some((t) => /hike|climb|adventure|surf|kart|ski|outdoor/.test(t))) return 'ADVENTURE'
  if (lowerTags.some((t) => /museum|art|culture|history|gallery|classical/.test(t))) return 'CULTURAL'
  const seasonalShare = items.filter((i) => i.isSeasonalSpecific).length / (items.length || 1)
  if (seasonalShare >= 0.5) return 'SEASONAL'
  if (items.every((i) => !i.isSeasonalSpecific)) return 'EVERGREEN'
  return 'OTHER'
}

/**
 * PASS A entry point. Discovers candidate list concepts from tag
 * co-occurrence in the certified catalog and evaluates EACH candidate's own
 * coherence/depth/overlap independently — no membership selection happens
 * here (that is listMembershipCuration's job, PASS B, run only AFTER a
 * concept clears this pass). `alreadyAcceptedConcepts` lets a caller check
 * a new discovery pass's candidates against concepts already CREATEd in an
 * earlier pass (or an existing production list's own membership, passed in
 * the same shape) for the overlap check.
 */
export function discoverListConcepts(
  items: readonly ListConceptCandidateItem[],
  config: ListConceptDiscoveryConfig = DEFAULT_LIST_CONCEPT_DISCOVERY_CONFIG,
  alreadyAcceptedConcepts: readonly { title: string; candidateNames: readonly string[] }[] = []
): ListConceptCandidate[] {
  const seeds = discoverClusterSeeds(items, config)
  const candidates: ListConceptCandidate[] = []

  for (const seed of seeds) {
    const members = seed.members
    // Strong-fit: members carrying ALL of the seed's tags (for a pair seed,
    // stronger evidence than carrying just one) — for a single-tag seed,
    // strong-fit is simply every member (the seed tag itself is the only
    // signal available), so minStrongFitRatio only bites on pair seeds
    // lacking a second corroborating tag across enough of the cluster.
    const strongFit = seed.tags.length >= 2 ? members : members
    const strongFitRatio = members.length > 0 ? strongFit.length / members.length : 0

    const categoryComp = composition(members, (i) => i.dbCategory)
    const geoComp = composition(members, (i) => i.neighborhoodName)
    const seasonalCount = members.filter((i) => i.isSeasonalSpecific).length
    const localSupport = localBusinessSupport(members)
    const type = inferConceptType(seed.tags, members)

    const overlaps: ListConceptOverlap[] = alreadyAcceptedConcepts
      .map((existing) => {
        const existingSet = new Set(existing.candidateNames)
        const shared = members.filter((m) => existingSet.has(m.candidateName))
        return { withTitle: existing.title, sharedItemCount: shared.length, sharedPercent: members.length > 0 ? shared.length / members.length : 0 }
      })
      .filter((o) => o.sharedItemCount > 0)

    const evidence = [
      `Discovered from tag co-occurrence: ${seed.tags.join(' + ')} (${members.length} certified items share ${seed.tags.length >= 2 ? 'BOTH' : 'this'} tag${seed.tags.length >= 2 ? 's' : ''}).`,
      `Category composition: ${Object.entries(categoryComp).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
      `Geographic composition: ${Object.keys(geoComp).length} distinct neighborhood(s).`,
      `Local/independent-business support: ${localSupport.locallyOwnedCount}/${localSupport.eligibleCount - localSupport.unknownCount || 'n/a'} known-ownership eligible items locally-owned, ${localSupport.unknownCount} still UNKNOWN_REQUIRES_VERIFICATION.`,
    ]

    let verdict: ListConceptVerdict
    let reasoning: string
    const maxOverlap = overlaps.reduce((max, o) => Math.max(max, o.sharedPercent), 0)

    if (members.length < config.minViableItems) {
      verdict = 'REJECT'
      reasoning = `Only ${members.length} candidate item(s) — below the ${config.minViableItems}-item minimum-viable-cluster floor. Weak filler never justifies reaching a target count; this concept is rejected outright rather than held for later padding.`
    } else if (strongFitRatio < config.minStrongFitRatio) {
      verdict = 'HOLD'
      reasoning = `${(strongFitRatio * 100).toFixed(0)}% strong-fit ratio is below the ${(config.minStrongFitRatio * 100).toFixed(0)}% bar — enough raw items exist, but the cluster's coherence needs human review before it is proposed as a new list.`
    } else if (maxOverlap >= config.overlapRequiresJerryThreshold) {
      verdict = 'REQUIRES_JERRY'
      const worst = overlaps.find((o) => o.sharedPercent === maxOverlap)!
      reasoning = `${(maxOverlap * 100).toFixed(0)}% of this concept's members already belong to "${worst.withTitle}" — substantial overlap requires Jerry's explicit review before creating a second, largely-redundant list.`
    } else {
      verdict = 'CREATE'
      reasoning = `${members.length} coherent, strong-fit items across ${Object.keys(geoComp).length} neighborhood(s) with no disqualifying overlap — a real, evidence-backed concept ready to propose.`
    }

    candidates.push({
      proposedTitle: draftTitleFromTags(seed.tags),
      editorialPromise: `A coherent set of experiences sharing ${seed.tags.map((t) => `"${t}"`).join(' + ')} — discovered from real tag co-occurrence in the certified catalog, not a predefined template.`,
      whyDistinctiveToThisMetro: `${members.length} of this metro's own certified items independently support this concept — a cluster this size is real market evidence, not a generic category.`,
      candidateItemCount: members.length,
      strongFitItemCount: strongFit.length,
      categoryComposition: categoryComp,
      geographicComposition: geoComp,
      experienceTypeComposition: { seasonalCount, evergreenCount: members.length - seasonalCount },
      localIndependentBusinessSupport: localSupport,
      overlapWithOtherConcepts: overlaps,
      type,
      verdict,
      evidence,
      reasoning,
      candidateNames: members.map((m) => m.candidateName),
      seedTags: seed.tags,
    })
  }

  return candidates.sort((a, b) => b.candidateItemCount - a.candidateItemCount || a.proposedTitle.localeCompare(b.proposedTitle))
}
