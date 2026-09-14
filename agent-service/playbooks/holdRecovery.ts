// agent-service/playbooks/holdRecovery.ts
//
// M9 two-pass list curation — Phase 6 (commit 6/7): the operator workflow
// for supplying missing evidence and reopening HOLD candidates (seed-stage
// duplicate/evidence HOLDs from seedPortfolioAudit.ts, list-concept HOLDs
// from listConceptDiscovery.ts, and list-membership HOLDs from
// listFitScoring.ts's evaluateItemForListMembership). Pure, no I/O.
//
// Design goals, each directly from this phase's own instructions:
//   - a reopened candidate retains its prior evidence and reason (never
//     discarded — HOLD's own reasons are exactly what a human needs to see
//     to supply the missing piece)
//   - it receives new evidence OR an explicit decision (not always both —
//     "these are two genuinely distinct experiences, keep both" is a valid
//     explicit decision with no new EVIDENCE attached, per
//     08-data-gaps-and-next-steps.md's item 2, the Kunst Oase/Vereinsheim
//     precedent question)
//   - it reenters at the EARLIEST NECESSARY stage, not always M0 — this is
//     the real content of this module: a mapping from HOLD reason kind to
//     the one stage that actually needs to rerun, following the existing
//     reopen-stage precedent's own philosophy of resuming close to where a
//     run was held rather than restarting everything
//   - it then passes through every later certification stage normally
//     (this module returns the exact remaining stage list, never lets a
//     caller skip ahead)
//   - it must never silently bypass certification: this module never
//     itself decides a HOLD becomes READY. Re-evaluation ALWAYS goes back
//     through the real, same deterministic gate function
//     (seedPortfolioAudit.ts's evaluateSeedCandidate, or
//     listFitScoring.ts's evaluateItemForListMembership) with whatever
//     input the reopened candidate now carries — a force-approval attempt
//     with no new evidence produces the IDENTICAL verdict as the original
//     HOLD, by construction (calling the same pure function with the same
//     input never changes its answer), which this module's own
//     verifyHoldNotBypassed helper makes an explicit, checkable assertion
//     rather than an implicit property nobody verifies.

export type MetroLaunchStage =
  | 'M0_METRO_DEFINITION'
  | 'M1_GEOGRAPHY_MAP'
  | 'M2_CATEGORY_COVERAGE_PLAN'
  | 'M3_BROAD_DISCOVERY'
  | 'M4_COVERAGE_AUDIT'
  | 'M5_TARGETED_DEEP_DIVES'
  | 'M6_QUALITY_VERIFICATION'
  | 'M5B_REPLACEMENT'
  | 'M5_75_SEED_PORTFOLIO_AUDIT'
  | 'M6_5_CHECKOFF_EDITOR'
  | 'M7_ITEM_CERTIFICATION'
  | 'M7_5_TAG_ASSIGNMENT'
  | 'M8_BATCH_CERTIFICATION'
  | 'M8_5_CATALOG_PRUNING'
  | 'M8_75_CATALOG_VOICE_PASS'
  | 'METRO_FINISHER_DEEP_RESEARCH'
  | 'METRO_FINISHER_INTEGRATION'
  | 'METRO_FINISHER_PACKET_EXECUTION'
  | 'M9_HOME_LIST_MIRROR'
  | 'M10_METRO_LAUNCH_CERTIFICATION'

/** The real driver stage sequence, in order — the single source of truth this module uses to compute "every later certification stage." */
export const METRO_LAUNCH_STAGE_ORDER: readonly MetroLaunchStage[] = [
  'M0_METRO_DEFINITION',
  'M1_GEOGRAPHY_MAP',
  'M2_CATEGORY_COVERAGE_PLAN',
  'M3_BROAD_DISCOVERY',
  'M4_COVERAGE_AUDIT',
  'M5_TARGETED_DEEP_DIVES',
  'M6_QUALITY_VERIFICATION',
  'M5B_REPLACEMENT',
  'M5_75_SEED_PORTFOLIO_AUDIT',
  'M6_5_CHECKOFF_EDITOR',
  'M7_ITEM_CERTIFICATION',
  'M7_5_TAG_ASSIGNMENT',
  'M8_BATCH_CERTIFICATION',
  'M8_5_CATALOG_PRUNING',
  'M8_75_CATALOG_VOICE_PASS',
  'METRO_FINISHER_DEEP_RESEARCH',
  'METRO_FINISHER_INTEGRATION',
  'METRO_FINISHER_PACKET_EXECUTION',
  'M9_HOME_LIST_MIRROR',
  'M10_METRO_LAUNCH_CERTIFICATION',
]

/**
 * Every distinct reason this codebase's own HOLD verdicts can currently be
 * produced for, each mapped to the EARLIEST stage that genuinely needs to
 * rerun to resolve it — never a blanket "back to M0." A seed-duplicate HOLD
 * doesn't need new geography (M1) or a new category plan (M2); it needs a
 * human decision recorded and, at most, a re-run of the seed audit itself.
 */
export type HoldReasonKind =
  | 'SEED_DUPLICATE_CLUSTER'
  | 'MISSING_OWNERSHIP_EVIDENCE'
  | 'MISSING_SECRET_EVIDENCE'
  | 'CATEGORY_OR_GEOGRAPHIC_GAP'
  | 'LIST_CONCEPT_WEAK_STRONG_FIT_RATIO'
  | 'LIST_MEMBERSHIP_MISSING_KIND_SPECIFIC_EVIDENCE'
  | 'AMBIGUOUS_DIFFICULTY'

const HOLD_REENTRY_STAGE: Record<HoldReasonKind, MetroLaunchStage> = {
  SEED_DUPLICATE_CLUSTER: 'M5_75_SEED_PORTFOLIO_AUDIT',
  MISSING_OWNERSHIP_EVIDENCE: 'M5_TARGETED_DEEP_DIVES',
  MISSING_SECRET_EVIDENCE: 'M5_TARGETED_DEEP_DIVES',
  CATEGORY_OR_GEOGRAPHIC_GAP: 'M4_COVERAGE_AUDIT',
  LIST_CONCEPT_WEAK_STRONG_FIT_RATIO: 'M9_HOME_LIST_MIRROR',
  LIST_MEMBERSHIP_MISSING_KIND_SPECIFIC_EVIDENCE: 'M9_HOME_LIST_MIRROR',
  AMBIGUOUS_DIFFICULTY: 'M6_5_CHECKOFF_EDITOR',
}

export interface HoldRecord {
  candidateName: string
  holdReasonKind: HoldReasonKind
  /** The original HOLD's own reasons — retained verbatim, never discarded, on reopen. */
  originalReasons: readonly string[]
  originalHeldAt: string
}

export interface HoldReopenRequest {
  hold: HoldRecord
  /** New evidence supplied for the specific gap the HOLD named — optional, since an explicit decision alone can also resolve a HOLD (see the module doc's Kunst Oase/Vereinsheim note). */
  newEvidence?: string
  /** An explicit human decision recorded WITHOUT necessarily new evidence (e.g. "these are two genuinely distinct experiences, keep both") — optional, but at least one of newEvidence/explicitDecision is required (see reopenHoldCandidate). */
  explicitDecision?: string
  reopenedBy: string
  reopenedAt: string
}

export interface HoldReopenResult {
  ok: boolean
  errors: string[]
  candidateName: string
  /** Prior evidence/reason, carried through unchanged — never dropped. */
  retainedReasons: readonly string[]
  reentryStage: MetroLaunchStage
  /** Every stage from reentryStage through M10, in order — "passes through all later certification stages normally," never skipped. */
  remainingStages: readonly MetroLaunchStage[]
  newEvidence?: string
  explicitDecision?: string
}

/**
 * Reopens a HOLD candidate. Does NOT itself decide the candidate's new
 * verdict — that is the job of re-running the real gate function
 * (evaluateSeedCandidate / evaluateItemForListMembership / list-concept
 * evaluation) with whatever new input this reopen produced, at
 * `reentryStage` and every stage after it. Requires at least one of
 * newEvidence/explicitDecision — a reopen with NEITHER is refused outright,
 * since "nothing changed" is not a valid reason to reopen anything.
 */
export function reopenHoldCandidate(request: HoldReopenRequest): HoldReopenResult {
  const errors: string[] = []
  if (!request.newEvidence && !request.explicitDecision) {
    errors.push('A HOLD reopen requires at least one of newEvidence or explicitDecision — reopening with neither would change nothing and must be refused.')
  }
  if (!request.reopenedBy || request.reopenedBy.trim() === '') {
    errors.push('reopenedBy is required — a reopen must be attributable to a real operator, never anonymous.')
  }

  const reentryStage = HOLD_REENTRY_STAGE[request.hold.holdReasonKind]
  const startIndex = METRO_LAUNCH_STAGE_ORDER.indexOf(reentryStage)
  const remainingStages = METRO_LAUNCH_STAGE_ORDER.slice(startIndex)

  return {
    ok: errors.length === 0,
    errors,
    candidateName: request.hold.candidateName,
    retainedReasons: request.hold.originalReasons,
    reentryStage,
    remainingStages,
    newEvidence: request.newEvidence,
    explicitDecision: request.explicitDecision,
  }
}

/**
 * Confirms a completed reopen did NOT skip any stage the candidate would
 * normally have to pass through — "does not rerun unrelated completed
 * work" (never includes a stage BEFORE reentryStage) and "passes through
 * all later certification stages normally" (every stage from reentryStage
 * through M10_METRO_LAUNCH_CERTIFICATION is present, in the correct order).
 */
export function verifyReopenStageCompleteness(result: HoldReopenResult): { ok: boolean; reason: string } {
  const expectedStartIndex = METRO_LAUNCH_STAGE_ORDER.indexOf(result.reentryStage)
  const expected = METRO_LAUNCH_STAGE_ORDER.slice(expectedStartIndex)
  const matches = expected.length === result.remainingStages.length && expected.every((s, i) => s === result.remainingStages[i])
  return matches
    ? { ok: true, reason: `remainingStages exactly matches every stage from ${result.reentryStage} through M10_METRO_LAUNCH_CERTIFICATION, in order — no unrelated completed work rerun, nothing skipped.` }
    : { ok: false, reason: `remainingStages does not exactly match the expected stage sequence from ${result.reentryStage} onward — this would either rerun unrelated completed work or silently skip a required stage.` }
}

/**
 * The anti-bypass guarantee, made explicit and checkable rather than
 * implicit: given the SAME gate-evaluation function, the SAME candidate
 * input, and NO new evidence, re-evaluating a reopened HOLD candidate must
 * produce the IDENTICAL verdict as the original — a force-approval attempt
 * with nothing new supplied cannot silently become READY/INCLUDE. This
 * holds by construction for any pure, deterministic gate function
 * (seedPortfolioAudit.ts's evaluateSeedCandidate, listFitScoring.ts's
 * evaluateItemForListMembership) — this function exists so that guarantee
 * is asserted in real, runnable code rather than left as an assumption
 * nobody checks.
 */
export function verifyHoldNotBypassed<TVerdict>(params: { hadNewEvidence: boolean; originalVerdict: TVerdict; reEvaluatedVerdict: TVerdict }): { ok: boolean; reason: string } {
  if (params.hadNewEvidence) {
    return { ok: true, reason: 'New evidence was supplied — the verdict is permitted (though not guaranteed) to change; this check only guards the NO-new-evidence case.' }
  }
  const unchanged = JSON.stringify(params.originalVerdict) === JSON.stringify(params.reEvaluatedVerdict)
  return unchanged
    ? { ok: true, reason: 'No new evidence was supplied and the re-evaluated verdict is identical to the original — certification was not silently bypassed.' }
    : { ok: false, reason: 'No new evidence was supplied, yet the re-evaluated verdict CHANGED from the original — this would be a certification bypass and must never happen. This indicates a bug in the caller (re-evaluation must reuse the exact same gate function and the exact same input) or in the gate function itself (it must be a pure, deterministic function of its input).' }
}
