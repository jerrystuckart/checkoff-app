// agent-service/playbooks/listFitScoring.ts
//
// M9_HOME_LIST_MIRROR — adjustment 9 (catalog/list separation), commit 4/5.
// Pure, independent per-item-per-list fit scoring. Catalog inclusion
// (M7-M8.75 certification into the retained catalog) must never by itself
// imply seasonal/themed-list inclusion — the two are separate editorial
// decisions. An item must be able to score zero fit for every list and
// still remain a perfectly valid catalog item belonging to none of them.
//
// This module is intentionally independent of, and does not replace,
// homeListThemes.ts's existing pattern/tag/category matching
// (buildEditorialThemedLists/selectFlagshipList) — those already decide
// WHICH items match a theme's definition at all. This module adds a
// second, explicit, auditable SCORE + REASON on top of an already-matched
// (or candidate) item/list pairing, so a low-confidence match can be
// dropped with a documented reason rather than silently included just
// because the item is in the certified catalog.
//
// Fully isolated: no I/O, never invoked against a live run's persisted
// public.lists/public.list_items — see metroLaunchDriverListFitScoring.test.ts
// for fixture-based unit coverage only.

import type { RealDbCategory } from './metroCatalog'
import { normalizedVenueKey } from './seedDuplicateNormalization'

export interface ListFitCandidate {
  candidateName: string
  venueName: string
  dbCategory: RealDbCategory
  finalTags: readonly string[]
  finalBody: string
}

export interface ListFitListDefinition {
  title: string
  /** Real production categories this list is editorially about — a match here is strong, independent evidence of fit. */
  categories?: readonly RealDbCategory[]
  /** Tags (M7.5 TAG_ASSIGNMENT) this list is editorially about — a match is independent evidence of fit. */
  tags?: readonly string[]
  /** Word-boundary regex patterns against the item's own body/venue text — independent evidence of fit. */
  patterns?: readonly RegExp[]
}

export type ListFitVerdict = 'INCLUDE' | 'EXCLUDE'

export interface ListFitScore {
  candidateName: string
  listTitle: string
  /** 0-1 — the SHARE of independent signals (category/tags/patterns) that matched, never a count of how many list slots remain or how "complete" the catalog is. Catalog membership itself contributes nothing to this score. */
  score: number
  verdict: ListFitVerdict
  reason: string
}

/** Below this score, an item does not fit a list well enough to include — deliberately conservative (a bare single weak keyword match should not be enough on its own for most lists with more than one signal type configured). */
export const DEFAULT_LIST_FIT_INCLUDE_THRESHOLD = 0.34

/**
 * Scores ONE candidate against ONE list definition — pure, independent of
 * whatever else has already decided this candidate belongs in the
 * certified catalog. A list definition with NO configured signals
 * (categories/tags/patterns all omitted) always scores 0 — an
 * unconfigured list is never a silent "include everything" default.
 */
export function scoreItemForList(item: ListFitCandidate, list: ListFitListDefinition): ListFitScore {
  const signals: Array<{ name: string; matched: boolean }> = []

  if (list.categories && list.categories.length > 0) {
    signals.push({ name: `category (${item.dbCategory})`, matched: list.categories.includes(item.dbCategory) })
  }
  if (list.tags && list.tags.length > 0) {
    const matchedTag = item.finalTags.find((t) => list.tags!.includes(t))
    signals.push({ name: matchedTag ? `tag "${matchedTag}"` : 'tags', matched: Boolean(matchedTag) })
  }
  if (list.patterns && list.patterns.length > 0) {
    const text = `${item.venueName} ${item.finalBody}`.toLowerCase()
    const matchedPattern = list.patterns.find((p) => p.test(text))
    signals.push({ name: matchedPattern ? `text pattern ${matchedPattern}` : 'text pattern', matched: Boolean(matchedPattern) })
  }

  if (signals.length === 0) {
    return { candidateName: item.candidateName, listTitle: list.title, score: 0, verdict: 'EXCLUDE', reason: `List "${list.title}" has no configured fit signals (categories/tags/patterns) — an unconfigured list never silently includes an item.` }
  }

  const matchedCount = signals.filter((s) => s.matched).length
  const score = matchedCount / signals.length
  const verdict: ListFitVerdict = score >= DEFAULT_LIST_FIT_INCLUDE_THRESHOLD ? 'INCLUDE' : 'EXCLUDE'
  const matchedNames = signals.filter((s) => s.matched).map((s) => s.name)

  return {
    candidateName: item.candidateName,
    listTitle: list.title,
    score,
    verdict,
    reason:
      verdict === 'INCLUDE'
        ? `${matchedCount}/${signals.length} independent fit signal(s) matched for "${list.title}": ${matchedNames.join(', ')}.`
        : `Only ${matchedCount}/${signals.length} independent fit signal(s) matched for "${list.title}" — below the fit threshold. Being in the certified catalog does not by itself qualify an item for this list.`,
  }
}

/** Scores every (item, list) pair — the full independent fit matrix. */
export function scoreItemsForLists(items: readonly ListFitCandidate[], lists: readonly ListFitListDefinition[]): ListFitScore[] {
  return items.flatMap((item) => lists.map((list) => scoreItemForList(item, list)))
}

// ---------------------------------------------------------------------------
// M9_HOME_LIST_MIRROR — PASS B: Membership Curation (Munich calibration
// Phase 3, commit 3/7). Extends this module's existing, currently-ADDITIVE
// scoreItemForList (recorded for audit but never confirmed to actually gate
// buildHomeListPlan's real membership — see
// docs/metro-launch-audit/munich/calibration-analysis/12-m9-training-requirements.md)
// into a real, ENFORCED per-item-per-list decision record — the
// ItemListFitDecision shape proposed in that doc, built here as real code
// rather than only a design note. Every existing export above (scoreItemForList,
// scoreItemsForLists, filterCandidatesByListFit) is untouched and still
// works exactly as before; this section is purely additive.
//
// Runs ONLY on concepts/lists that already cleared PASS A
// (listConceptDiscovery.ts) — this module never discovers or approves a new
// list identity, it only decides membership for a list whose CONCEPT is
// already accepted.
// ---------------------------------------------------------------------------

export type ListFitDiversityContribution = 'CATEGORY_BALANCING' | 'GEOGRAPHIC_BALANCING' | 'NEITHER' | 'BOTH'
export type ItemListMembershipVerdict = 'INCLUDE' | 'EXCLUDE' | 'HOLD'

/**
 * The real editorial "shape" a list requires beyond generic category/tag/
 * pattern fit — each kind gates a DIFFERENT specific evidence requirement,
 * per the Munich calibration analysis's own per-list findings
 * (11-list-portfolio-scorecards.md): Hidden-Gems-type lists need a
 * documented discovery basis (58% of Munich's real Hidden Gems list did
 * NOT have one — a real, measured gap this gate targets); After-Dark-type
 * lists need meaningfully-nighttime-specific experiences, not just "is this
 * a bar" (Munich After Dark's own 4 softest members: Frisches Bier,
 * Paulaner Bräuhaus, Higgins Ale Works, Zero Dosage); food/local-flavor
 * lists need a concrete order/product/ritual; day-trip lists need to
 * account for real travel/completion effort.
 */
export type ListMembershipKind = 'SEASONAL' | 'THEMED' | 'HIDDEN_GEMS' | 'AFTER_DARK' | 'FOOD_LOCAL_FLAVOR' | 'DAY_TRIP' | 'OTHER'

/** A list's own lifecycle status — "existing completed production lists remain unchanged unless explicitly reopened" (ties into the existing reopen-stage/--reopen-from-launch-boundary mechanisms). */
export interface ListMembershipListContext extends ListFitListDefinition {
  kind: ListMembershipKind
  status?: 'ACTIVE' | 'COMPLETED'
  /** Must be true for ANY membership change to be permitted on a COMPLETED list — mirrors the existing reopen-stage precedent (see metroLaunchDriver.ts's --reopen-from-launch-boundary). */
  reopened?: boolean
  /** A brand-new, not-yet-created list identity (no real listId yet) — carried through so the decision record can say `proposedListIdentity` instead of a null listId with no explanation. */
  proposedListIdentity?: string
  listId?: string | null
}

/**
 * A Hidden-Gems-type item's basis for being "discovered," never accepted on
 * wording alone (reuses Phase 2's secret-evidence discipline conceptually —
 * SOME defensible basis is required even for a non-secret "overlooked"
 * item). VERIFIED_SECRET_MECHANIC is for the rare case that ALSO clears
 * categoryPolicy.ts's real evaluateSecretEvidence bar — the other 4 are
 * legitimate discovery bases that are not secret mechanics at all (e.g. the
 * real Neues Rathaus plague-dragon case: a famous, fully public building
 * with one overlooked carved detail).
 */
export type DiscoveryBasisCategory = 'PHYSICALLY_CONCEALED_ACCESS' | 'OFF_MENU_OR_BROWSE_DISCOVERY' | 'OVERLOOKED_DETAIL_ON_FAMOUS_LANDMARK' | 'NEIGHBORHOOD_FAVORITE_NOT_FAMOUS' | 'VERIFIED_SECRET_MECHANIC'

export interface ItemListFitDecisionInput {
  item: ListFitCandidate
  list: ListMembershipListContext
  /** Real, upstream signal (e.g. from categoryPolicy.ts's category-percentage evaluation) that this item's category is currently under-target for the catalog as a whole — contributes to diversityContribution, never invented here. */
  isCategoryUnderrepresented?: boolean
  /** Real, upstream signal that this item is one of few/only items in its neighborhood — contributes to diversityContribution. */
  isSingleOrFewItemNeighborhood?: boolean
  /** Required (non-null) for a HIDDEN_GEMS-kind list's item to INCLUDE — see DiscoveryBasisCategory. */
  discoveryBasis?: { category: DiscoveryBasisCategory; detail: string } | null
  /** Required for an AFTER_DARK-kind list's item to INCLUDE cleanly — missing entirely routes to HOLD (an explicit judgment was never made); explicitly false still may INCLUDE (matches real Munich precedent for a legitimate bar/nightlife item with no time-gated claim) but carries a softWarning rather than a silent pass. */
  nighttimeSpecific?: { value: boolean; detail: string } | null
  /** Required (non-empty) for a FOOD_LOCAL_FLAVOR-kind list's item to INCLUDE — a concrete order/product/ritual/market-interaction/locally-distinctive action, never "this is a nice restaurant." */
  concreteLocalFlavorAction?: string | null
  /** Required for a DAY_TRIP-kind list's item — reuses difficultyEvidence.ts's travel-level vocabulary so day-trip membership and difficulty evidence never disagree about what "requires travel" means. NONE (or missing) EXCLUDEs — a day-trip list item must account for real travel/completion effort. */
  travelEffort?: { level: 'NONE' | 'CLOSE_IN_OUTER_NEIGHBORHOOD' | 'SURROUNDING_MUNICIPALITY'; detail: string } | null
}

export interface ItemListFitDecision {
  listId: string | null
  proposedListIdentity?: string
  /** candidateName today — becomes a real production UUID once resolved (never body-text matching once a UUID is available; see the Phase 4 SQL-generation safeguards this decision record feeds). */
  itemId: string
  verdict: ItemListMembershipVerdict
  fitScore: number
  fitReason: string
  /** The list-specific qualitative claim scoreItemForList's category/tag/pattern signals cannot express on their own — e.g. for Hidden Gems, WHY this item's claim is a genuine discovery, not just that its category matched. */
  listSpecificEvidence: string
  diversityContribution: ListFitDiversityContribution
  geographicContribution?: string
  /** REQUIRED whenever verdict is EXCLUDE for an item that was seriously considered (catalog-eligible, list-adjacent category/tags) — never required for an item with zero plausible relevance to begin with. */
  exclusionReason?: string
  /** Set for an INCLUDE that clears the list's basic fit bar but is a real, flagged soft spot (e.g. a bar with no nighttime-specific claim) — never silently indistinguishable from a fully-justified INCLUDE. */
  softWarning?: string
}

/**
 * PASS B entry point — the real, enforced per-item-per-list decision.
 * Catalog inclusion and active/approved status are NEVER, by themselves,
 * evidence of list fit here — this function only ever looks at `input`'s
 * own fields (the item's category/tags/body-text fit, plus whatever
 * list-kind-specific evidence the caller supplies); it has no notion of
 * "is this item in the catalog" or "is this item active" at all, which is
 * exactly how catalog-inclusion-never-implies-list-inclusion is enforced —
 * there is structurally no field this function could accidentally read to
 * shortcut that judgment.
 */
export function evaluateItemForListMembership(input: ItemListFitDecisionInput): ItemListFitDecision {
  const { item, list } = input
  const listId = list.listId ?? null

  if (list.status === 'COMPLETED' && !list.reopened) {
    return {
      listId,
      proposedListIdentity: list.proposedListIdentity,
      itemId: item.candidateName,
      verdict: 'EXCLUDE',
      fitScore: 0,
      fitReason: `List "${list.title}" is a completed production list and has not been explicitly reopened — no membership change is permitted.`,
      listSpecificEvidence: '',
      diversityContribution: 'NEITHER',
      exclusionReason: `List "${list.title}" is COMPLETED and reopened is not true — existing completed production lists remain unchanged unless explicitly reopened.`,
    }
  }

  const base = scoreItemForList(item, list)

  const isCategoryUnderrepresented = Boolean(input.isCategoryUnderrepresented)
  const isSingleOrFewItemNeighborhood = Boolean(input.isSingleOrFewItemNeighborhood)
  const diversityContribution: ListFitDiversityContribution = isCategoryUnderrepresented && isSingleOrFewItemNeighborhood ? 'BOTH' : isCategoryUnderrepresented ? 'CATEGORY_BALANCING' : isSingleOrFewItemNeighborhood ? 'GEOGRAPHIC_BALANCING' : 'NEITHER'

  const decisionBase = {
    listId,
    proposedListIdentity: list.proposedListIdentity,
    itemId: item.candidateName,
    fitScore: base.score,
    diversityContribution,
    geographicContribution: isSingleOrFewItemNeighborhood ? `Contributes real geographic reach — a single/few-item neighborhood, not a catalog-only placeholder.` : undefined,
  }

  if (base.verdict === 'EXCLUDE') {
    return { ...decisionBase, verdict: 'EXCLUDE', fitReason: base.reason, listSpecificEvidence: '', exclusionReason: base.reason }
  }

  // Base fit (category/tag/pattern) passed — now the list-kind-specific
  // enforced evidence requirement, per list kind. Seasonal/Themed/Other
  // have no additional requirement beyond base fit (seasonal and themed
  // fit are ALREADY separate judgments by construction — each list this
  // function is called for carries its own independent categories/tags/
  // patterns, so a seasonal list's inclusion of an item never depends on
  // whether that item ALSO fits some themed list, and vice versa).
  switch (list.kind) {
    case 'HIDDEN_GEMS': {
      if (!input.discoveryBasis) {
        return {
          ...decisionBase,
          verdict: 'HOLD',
          fitReason: base.reason,
          listSpecificEvidence: '',
          exclusionReason: `Hidden-Gems-type list requires a documented discovery basis (PHYSICALLY_CONCEALED_ACCESS / OFF_MENU_OR_BROWSE_DISCOVERY / OVERLOOKED_DETAIL_ON_FAMOUS_LANDMARK / NEIGHBORHOOD_FAVORITE_NOT_FAMOUS / VERIFIED_SECRET_MECHANIC) — category/tag fit alone is never sufficient (the real Munich Hidden Gems list shipped with ~58% of its members having no discovery mechanic at all; this gate exists so a future list does not repeat that).`,
        }
      }
      return {
        ...decisionBase,
        verdict: 'INCLUDE',
        fitReason: base.reason,
        listSpecificEvidence: `Discovery basis (${input.discoveryBasis.category}): ${input.discoveryBasis.detail}`,
      }
    }
    case 'AFTER_DARK': {
      if (!input.nighttimeSpecific) {
        return {
          ...decisionBase,
          verdict: 'HOLD',
          fitReason: base.reason,
          listSpecificEvidence: '',
          exclusionReason: `After-Dark-type list requires an explicit nighttimeSpecific judgment (true/false + detail) — "is this a bar" alone is never sufficient; the judgment must be made deliberately, not defaulted from a category match.`,
        }
      }
      if (!input.nighttimeSpecific.value) {
        return {
          ...decisionBase,
          verdict: 'INCLUDE',
          fitReason: base.reason,
          listSpecificEvidence: `Bar/nightlife category fit, but NOT structurally nighttime-specific: ${input.nighttimeSpecific.detail}`,
          softWarning: `This item's claim has no time gate and could truthfully be completed in daytime — the real Munich After Dark list included comparable cases (Frisches Bier, Paulaner Bräuhaus, Higgins Ale Works, Zero Dosage) as its softest members. Included as a legitimate bar/nightlife pick, not as a fully time-gated experience.`,
        }
      }
      return { ...decisionBase, verdict: 'INCLUDE', fitReason: base.reason, listSpecificEvidence: `Structurally nighttime-specific: ${input.nighttimeSpecific.detail}` }
    }
    case 'FOOD_LOCAL_FLAVOR': {
      if (!input.concreteLocalFlavorAction || input.concreteLocalFlavorAction.trim() === '') {
        return {
          ...decisionBase,
          verdict: 'HOLD',
          fitReason: base.reason,
          listSpecificEvidence: '',
          exclusionReason: `Food/local-flavor-type list requires a concrete order/product/ritual/market-interaction/locally-distinctive action — category fit alone ("this is a restaurant") is never sufficient (the real Café Maria case: "settle in for coffee" has no specific order and was excluded from the final Cafés/Markets list).`,
        }
      }
      return { ...decisionBase, verdict: 'INCLUDE', fitReason: base.reason, listSpecificEvidence: `Concrete local-flavor action: ${input.concreteLocalFlavorAction}` }
    }
    case 'DAY_TRIP': {
      if (!input.travelEffort || input.travelEffort.level === 'NONE') {
        return {
          ...decisionBase,
          verdict: 'EXCLUDE',
          fitReason: base.reason,
          listSpecificEvidence: '',
          exclusionReason: `Day-trip-type list requires the item to account for real travel/completion effort beyond central-metro reach — this item's travel level is ${input.travelEffort?.level ?? 'unspecified (treated as NONE)'}.`,
        }
      }
      return { ...decisionBase, verdict: 'INCLUDE', fitReason: base.reason, listSpecificEvidence: `Travel effort (${input.travelEffort.level}): ${input.travelEffort.detail}` }
    }
    default:
      return { ...decisionBase, verdict: 'INCLUDE', fitReason: base.reason, listSpecificEvidence: base.reason }
  }
}

/**
 * "A list may stay below its preferred size rather than accept filler" —
 * enforced, not just documented: this is the ONLY sanctioned way to reach a
 * target size, and it never manufactures items. A caller that has more
 * `weakCandidatesAvailable` than the size gap must NOT pass them in as
 * `includedCount` — this function only reports the honest outcome of
 * whatever the caller already, separately decided were genuinely
 * qualifying (INCLUDE-verdict) items.
 */
export function enforcePreferredSizeWithoutFiller(includedCount: number, preferredSize: number, weakCandidatesAvailable = 0): { finalSize: number; belowPreferred: boolean; reason: string } {
  const belowPreferred = includedCount < preferredSize
  return {
    finalSize: includedCount,
    belowPreferred,
    reason: belowPreferred
      ? `List stays at ${includedCount} genuinely qualifying item(s), below the ${preferredSize}-item preferred size, rather than accept ${weakCandidatesAvailable} weaker candidate(s) as filler.`
      : `Reached ${includedCount} item(s), at/above the ${preferredSize}-item preferred size, with no filler.`,
  }
}

// ---------------------------------------------------------------------------
// Final portfolio review — repetitive venues/actions/neighborhoods/
// experience-types, checked ACROSS a finished list's membership (after
// every per-item decision above), per the Munich calibration's own findings
// (e.g. Munich After Dark's 3 separate brewery/beer-specific items, Cafés/
// Markets' 3 separate Viktualienmarkt-stand items — legitimate individually,
// worth surfacing as a portfolio-level signal even when not disqualifying).
// ---------------------------------------------------------------------------

export interface PortfolioReviewItem {
  candidateName: string
  venueName: string
  dbCategory: RealDbCategory
  neighborhoodName: string
  finalBody: string
}

export type PortfolioRepetitionKind = 'DUPLICATE_VENUE' | 'CATEGORY_CONCENTRATION' | 'NEIGHBORHOOD_CONCENTRATION' | 'REPEATED_OPENING_WORD'

export interface PortfolioRepetitionFinding {
  kind: PortfolioRepetitionKind
  detail: string
  affectedCandidateNames: string[]
}

function firstWord(body: string): string {
  const match = body.trim().match(/^[A-Za-zÀ-ÿ]+/)
  return match ? match[0]!.toLowerCase() : ''
}

/**
 * Detects same-venue duplicates (reusing seedDuplicateNormalization.ts's
 * exact venue-key logic — never a second normalization routine), category
 * over-concentration, neighborhood over-concentration, and a repeated
 * opening-word pattern across a list's final membership. Every finding is
 * informational, never auto-resolved — this mirrors seedDuplicateNormalization.ts's
 * own "flag for explicit review, never merge" discipline one stage later,
 * at the list-portfolio level instead of the catalog-duplicate level.
 */
export function detectPortfolioRepetition(members: readonly PortfolioReviewItem[], config: { categoryConcentrationThreshold?: number; neighborhoodConcentrationThreshold?: number; openingWordConcentrationThreshold?: number } = {}): PortfolioRepetitionFinding[] {
  const categoryThreshold = config.categoryConcentrationThreshold ?? 0.6
  const neighborhoodThreshold = config.neighborhoodConcentrationThreshold ?? 0.5
  const openingWordThreshold = config.openingWordConcentrationThreshold ?? 0.3
  const findings: PortfolioRepetitionFinding[] = []
  if (members.length === 0) return findings

  const byVenueKey = new Map<string, PortfolioReviewItem[]>()
  for (const m of members) {
    const key = normalizedVenueKey(m.venueName)
    byVenueKey.set(key, [...(byVenueKey.get(key) ?? []), m])
  }
  for (const [, group] of byVenueKey) {
    if (group.length > 1) {
      findings.push({ kind: 'DUPLICATE_VENUE', detail: `${group.length} members normalize to the same venue ("${group[0]!.venueName}") — same real-world venue appearing more than once in this one list.`, affectedCandidateNames: group.map((g) => g.candidateName) })
    }
  }

  const byCategory = new Map<RealDbCategory, PortfolioReviewItem[]>()
  for (const m of members) byCategory.set(m.dbCategory, [...(byCategory.get(m.dbCategory) ?? []), m])
  for (const [category, group] of byCategory) {
    const share = group.length / members.length
    if (share >= categoryThreshold) {
      findings.push({ kind: 'CATEGORY_CONCENTRATION', detail: `${group.length}/${members.length} (${(share * 100).toFixed(0)}%) of this list's members are "${category}" — worth a deliberate check that this is genuine list identity, not accidental imbalance.`, affectedCandidateNames: group.map((g) => g.candidateName) })
    }
  }

  const byNeighborhood = new Map<string, PortfolioReviewItem[]>()
  for (const m of members) byNeighborhood.set(m.neighborhoodName, [...(byNeighborhood.get(m.neighborhoodName) ?? []), m])
  for (const [neighborhood, group] of byNeighborhood) {
    const share = group.length / members.length
    if (share >= neighborhoodThreshold) {
      findings.push({ kind: 'NEIGHBORHOOD_CONCENTRATION', detail: `${group.length}/${members.length} (${(share * 100).toFixed(0)}%) of this list's members are in "${neighborhood}" — worth checking whether this list should be more geographically dispersed.`, affectedCandidateNames: group.map((g) => g.candidateName) })
    }
  }

  const byOpeningWord = new Map<string, PortfolioReviewItem[]>()
  for (const m of members) {
    const word = firstWord(m.finalBody)
    if (!word) continue
    byOpeningWord.set(word, [...(byOpeningWord.get(word) ?? []), m])
  }
  for (const [word, group] of byOpeningWord) {
    const share = group.length / members.length
    if (share >= openingWordThreshold && group.length >= 2) {
      findings.push({ kind: 'REPEATED_OPENING_WORD', detail: `${group.length}/${members.length} (${(share * 100).toFixed(0)}%) of this list's members open with "${word}" — a voice-variety pass (M8.75-style) may be worth running on this list specifically.`, affectedCandidateNames: group.map((g) => g.candidateName) })
    }
  }

  return findings
}

/** Convenience: candidate names an INCLUDE-scoring item set narrows a proposed membership list down to — never adds names beyond `proposedCandidateNames`, only removes ones that don't independently score INCLUDE for this specific list. An item present in `items` but absent from every list's INCLUDE set legitimately belongs to zero lists. */
export function filterCandidatesByListFit(proposedCandidateNames: readonly string[], items: readonly ListFitCandidate[], list: ListFitListDefinition): { included: string[]; excluded: ListFitScore[] } {
  const byName = new Map(items.map((i) => [i.candidateName, i]))
  const included: string[] = []
  const excluded: ListFitScore[] = []
  for (const name of proposedCandidateNames) {
    const item = byName.get(name)
    if (!item) continue // not enough data to score — never silently included on missing data.
    const score = scoreItemForList(item, list)
    if (score.verdict === 'INCLUDE') included.push(name)
    else excluded.push(score)
  }
  return { included, excluded }
}
