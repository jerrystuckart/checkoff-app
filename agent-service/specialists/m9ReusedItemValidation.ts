// agent-service/specialists/m9ReusedItemValidation.ts
//
// M9 wiring, Session 3, Phase 3 — the reused-item cross-check the handoff
// named as a prerequisite for safe SQL integration (Phase 5). Pure, no
// I/O — same discipline as listSqlGeneration.ts's resolveListItemsPreflight:
// the caller performs its own one-time production lookup (a real DB read
// this module cannot and must not perform itself); this module only
// VALIDATES the caller's resolution result and fails CLOSED before any
// item is treated as safe to link into a list.
//
// This is a genuinely ADDITIONAL layer on top of listSqlGeneration.ts's
// own preflight (which only ever checks "exactly one match, never zero,
// never ambiguous") — Phase 5's SQL generation still goes through that
// real, existing, already-audited preflight as the final, authoritative
// gate immediately before SQL is produced. This module runs EARLIER and
// checks things listSqlGeneration.ts has no way to know about on its own:
// whether the matched item is active, whether it belongs to the intended
// metro, and whether the concept it came from still has an unresolved
// venue-duplicate finding.

export interface M9ReusedItemResolution {
  candidateName: string
  conceptId: string
  /** Every production item id the caller's own one-time resolution query found for this candidate. Zero -> not found; 2+ -> ambiguous. Both fail closed, exactly like listSqlGeneration.ts's own ListSqlItemResolution. */
  matchedItemIds: readonly string[]
  /** Caller-supplied, when known — omit only when the caller's lookup genuinely could not determine this (never silently assumed true). */
  active?: boolean
  /** Caller-supplied real metro_areas.id the matched item currently belongs to, when known. */
  metroId?: string | null
}

export interface M9ReusedItemValidationInput {
  /** The real metro_areas.id this plan is being built for — required for the out-of-metro check to run at all; pass null only when genuinely unknown (the check is then skipped, never silently assumed to pass). */
  metroId: string | null
  resolutions: readonly M9ReusedItemResolution[]
  /** conceptIds whose ENFORCED artifact still shows an unresolved DUPLICATE_VENUE finding — defense in depth alongside the artifact's own gating (see runM9EnforcedCuration): even if a resolution somehow reached this module for such a concept, it is refused here too, never silently linked. */
  conceptsWithUnresolvedDuplicates: ReadonlySet<string>
}

export type M9ReusedItemFindingKind = 'NOT_FOUND' | 'AMBIGUOUS' | 'INACTIVE' | 'OUT_OF_METRO' | 'UNRESOLVED_DUPLICATE' | 'MULTIPLE_CANDIDATES_SAME_ITEM'

export interface M9ReusedItemValidationFinding {
  candidateName: string
  itemId: string | null
  kind: M9ReusedItemFindingKind
  /** Only MULTIPLE_CANDIDATES_SAME_ITEM is advisory (never blocks) — every other kind fails the whole preflight closed. */
  blocking: boolean
  detail: string
}

export interface M9ReusedItemValidationResult {
  ok: boolean
  /** candidateName -> production item id, ONLY for candidates that passed every blocking check. Never partially populated for a candidate that failed — a failed candidate simply has no entry here. */
  resolvedItemIdByCandidateName: Record<string, string>
  findings: M9ReusedItemValidationFinding[]
}

/**
 * Validates a caller-supplied set of item resolutions before they may be
 * treated as safe to link. Never invents or guesses a match — every
 * `matchedItemIds`/`active`/`metroId` value is exactly what the caller's
 * own one-time production lookup found. Fails closed: any blocking
 * finding means `ok: false` and NOTHING may be resolved from this call's
 * output, even the candidates that individually passed (Phase 5's own
 * "complete the entire preflight before producing destructive membership
 * operations" requirement — a partial preflight pass is not a pass).
 */
export function validateM9ReusedItems(input: M9ReusedItemValidationInput): M9ReusedItemValidationResult {
  const findings: M9ReusedItemValidationFinding[] = []
  const provisional: Record<string, string> = {}
  const candidateNamesByItemId = new Map<string, string[]>()

  for (const r of input.resolutions) {
    if (input.conceptsWithUnresolvedDuplicates.has(r.conceptId)) {
      findings.push({ candidateName: r.candidateName, itemId: null, kind: 'UNRESOLVED_DUPLICATE', blocking: true, detail: `Concept "${r.conceptId}" still has an unresolved venue-duplicate finding — refusing to resolve any of its members to a production item until that is cleared (SUPPLY_EVIDENCE or REJECT).` })
      continue
    }
    if (r.matchedItemIds.length === 0) {
      findings.push({ candidateName: r.candidateName, itemId: null, kind: 'NOT_FOUND', blocking: true, detail: 'No production item resolved this candidate — preflight fails closed before any mutation.' })
      continue
    }
    if (r.matchedItemIds.length > 1) {
      findings.push({ candidateName: r.candidateName, itemId: null, kind: 'AMBIGUOUS', blocking: true, detail: `${r.matchedItemIds.length} production items matched this candidate — ambiguous, preflight fails closed.` })
      continue
    }
    const itemId = r.matchedItemIds[0]!
    if (r.active === false) {
      findings.push({ candidateName: r.candidateName, itemId, kind: 'INACTIVE', blocking: true, detail: 'The matched production item is not active.' })
      continue
    }
    if (input.metroId !== null && r.metroId !== undefined && r.metroId !== null && r.metroId !== input.metroId) {
      findings.push({ candidateName: r.candidateName, itemId, kind: 'OUT_OF_METRO', blocking: true, detail: `The matched production item belongs to metro "${r.metroId}", not the intended metro "${input.metroId}" — no approved geographic exception was supplied for this resolution.` })
      continue
    }
    provisional[r.candidateName] = itemId
    candidateNamesByItemId.set(itemId, [...(candidateNamesByItemId.get(itemId) ?? []), r.candidateName])
  }

  // Advisory only, never blocking — two distinct candidateNames resolving
  // to the SAME real production item is unusual (most often a genuine
  // catalog-dedup case, e.g. two research passes independently rediscovering
  // one venue) but not itself unsafe; downstream SQL generation's own
  // de-duplication (listSqlGeneration.ts's generateListMembershipSql)
  // already collapses it to one membership row regardless.
  for (const [itemId, names] of candidateNamesByItemId) {
    if (names.length > 1) {
      findings.push({ candidateName: names.join(', '), itemId, kind: 'MULTIPLE_CANDIDATES_SAME_ITEM', blocking: false, detail: `${names.length} distinct candidate names all resolved to production item "${itemId}" — verify this is a genuine catalog-dedup case, not a resolution bug.` })
    }
  }

  const hasBlockingFinding = findings.some((f) => f.blocking)
  return {
    ok: !hasBlockingFinding,
    // Fail-closed at the WHOLE-preflight level, not per-candidate: a
    // partial pass is not a pass (Phase 5's own requirement) — if ANYTHING
    // blocking failed, nothing here is treated as resolved, even
    // candidates that individually cleared every check.
    resolvedItemIdByCandidateName: hasBlockingFinding ? {} : provisional,
    findings,
  }
}
