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
