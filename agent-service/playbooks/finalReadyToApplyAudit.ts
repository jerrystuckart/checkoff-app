// agent-service/playbooks/finalReadyToApplyAudit.ts
//
// Chief Phase 2AK (2026-09-10, methodology hardening postmortem) — the
// single, required, final consolidation Winston must produce before ever
// saying "ready to apply." Composes the individual gate results already
// computed elsewhere in the pipeline (this module runs no checks itself —
// it aggregates and enforces PRESENCE, exactly like
// metroLaunchCertification.ts's own missing-gate-is-a-failure discipline)
// into one concise verdict covering every item Jerry's hardening
// instruction named:
//   - no out-of-market contamination
//   - no unresolved duplicate venue conflicts
//   - all retained items certified
//   - all intended neighborhoods created (or explicitly, honestly reported empty)
//   - all new items have required Places data
//   - all list titles are user-facing (no internal "Themed list:"-style prefix)
//   - Home lists are correctly planned and packaged (PRE_APPLY — required always)
//   - reused production items are linked additively only
//   - SQL is atomic and safe
//   - package has not been executed unless explicitly confirmed
//
// A gate result that's simply missing from the input is treated the same
// as a real failure — never silently skipped, matching the same discipline
// certifyMetroLaunch() already uses for its own required gate categories.
//
// Chief Phase 2AM (2026-09-11) — PRE_APPLY vs. POST_APPLY, corrected after
// a real bug: `homeListCountsReconcile` used to be wired directly to
// HOME_LIST_CERTIFICATION_GATE, a live public.lists/public.list_items READ
// that can only PASS after Jerry has actually run the generated SQL. That
// made this audit permanently BLOCKED for every brand-new metro's own
// not-yet-applied package — rows the package is ABOUT to create can never
// pre-exist. Fixed: `homeList.packageValid` (PRE_APPLY, homeListCertification.ts's
// HOME_LIST_PACKAGE_VALIDATION_GATE — validates the generated SQL package
// itself, no DB read) is always required; `homeList.liveVerificationValid`
// (POST_APPLY, the real read) is only required once `executionState` is no
// longer 'GENERATED' — i.e. once execution has actually happened. Before
// that, absence of production rows is the expected, correct state and
// never blocks READY_TO_APPLY.

import type { ExecutionState } from './executionStateLanguage'

export interface FinalReadyToApplyInput {
  outOfMarketContaminationVerdict?: 'PASS' | 'FAIL'
  /** True only when every same-Place-ID cluster has an explicit keep/drop resolution recorded (see venueDuplicateDetection.ts) — a cluster merely being REPORTED is not the same as being RESOLVED. */
  allDuplicateClustersResolved?: boolean
  unresolvedDuplicateClusterCount?: number
  allItemsCertified?: boolean
  uncertifiedItemCount?: number
  /** From evaluateNeighborhoodCompletenessGate — always present/PASS by that gate's own design, included here so its emptyNeighborhoods list is part of the one final report. */
  emptyNeighborhoods?: readonly string[]
  placesCompletenessVerdict?: 'PASS' | 'FAIL'
  /** List titles that still carry an internal-only prefix (e.g. "Themed list: X") — must be empty. */
  listTitlesWithInternalPrefix?: readonly string[]
  /**
   * Chief Phase 2AM (2026-09-11) — split into an always-required PRE_APPLY
   * check (does the generated package itself correctly create the intended
   * lists?) and an executionState-gated POST_APPLY check (do the rows
   * actually exist in production yet?). Before execution, absence of
   * production rows must never block readiness — see this module's own
   * doc and homeListCertification.ts's PRE_APPLY/POST_APPLY split.
   */
  homeList?: {
    /** PRE_APPLY — from homeListCertification.ts's HOME_LIST_PACKAGE_VALIDATION_GATE (derivePackageValidationFromSql), never a live DB read. Always required, regardless of executionState. */
    packageValid: boolean
    packageIssues?: readonly string[]
    /**
     * POST_APPLY — from HOME_LIST_CERTIFICATION_GATE's real
     * public.lists/public.list_items read. Only REQUIRED (its own absence
     * only counts as a failure) once `executionState` is no longer
     * 'GENERATED' — i.e. once Jerry has actually run the SQL. Before that,
     * omitting it entirely is the expected, correct state, never a
     * blocker.
     */
    liveVerificationValid?: boolean
    liveVerificationIssues?: readonly string[]
  }
  /** True when every reused existing-production item was linked via an ADDITIVE list_items row only — never an UPDATE/modification to the item or to another metro's own list. */
  reusedItemsAdditiveOnly?: boolean
  sqlSafetyVerdict?: 'PASS' | 'FAIL'
  sqlSafetyIssues?: readonly string[]
  /** The real, current state of this package — GENERATED unless execution has actually been confirmed. Never assumed APPLIED/VERIFIED without an explicit, separate confirmation. */
  executionState: ExecutionState
}

export interface FinalReadyToApplyResult {
  verdict: 'READY_TO_APPLY' | 'BLOCKED'
  reasons: string[]
  executionState: ExecutionState
}

function missing(label: string): string {
  return `${label}: result missing — treated as a failure, never silently skipped.`
}

export function evaluateFinalReadyToApplyAudit(input: FinalReadyToApplyInput): FinalReadyToApplyResult {
  const reasons: string[] = []

  if (input.outOfMarketContaminationVerdict === undefined) reasons.push(missing('Out-of-market contamination check'))
  else if (input.outOfMarketContaminationVerdict === 'FAIL') reasons.push('Out-of-market contamination detected — must be resolved before packaging.')

  if (input.allDuplicateClustersResolved === undefined) reasons.push(missing('Duplicate venue cluster resolution'))
  else if (!input.allDuplicateClustersResolved) reasons.push(`${input.unresolvedDuplicateClusterCount ?? 'some'} same-Place-ID cluster(s) surfaced but not yet explicitly resolved (keep/drop decided) — reported is not the same as resolved.`)

  if (input.allItemsCertified === undefined) reasons.push(missing('Item certification completeness'))
  else if (!input.allItemsCertified) reasons.push(`${input.uncertifiedItemCount ?? 'some'} retained item(s) lack a real ITEM_CERTIFIED record.`)

  if (input.emptyNeighborhoods === undefined) reasons.push(missing('Neighborhood completeness report'))
  // Empty neighborhoods themselves never block — see neighborhoodCompletenessGate.ts. Presence of the report is what's required here.

  if (input.placesCompletenessVerdict === undefined) reasons.push(missing('Google Places completeness'))
  else if (input.placesCompletenessVerdict === 'FAIL') reasons.push('One or more items are missing required Google Places fields.')

  if (input.listTitlesWithInternalPrefix === undefined) reasons.push(missing('List title hygiene check'))
  else if (input.listTitlesWithInternalPrefix.length > 0) reasons.push(`List title(s) still carry an internal-only prefix, never allowed in public.lists.title: ${input.listTitlesWithInternalPrefix.join(', ')}.`)

  if (input.homeList === undefined) {
    reasons.push(missing('Home list readiness (PRE_APPLY package validation)'))
  } else {
    // PRE_APPLY — always required, regardless of executionState. Validates
    // the generated package itself would create the intended lists
    // correctly; never a live DB read, so a brand-new metro with no
    // production rows yet can still pass this.
    if (!input.homeList.packageValid) {
      reasons.push(`Home list PRE_APPLY package validation failed: ${(input.homeList.packageIssues ?? []).join('; ') || 'see detail'}.`)
    }
    // POST_APPLY — only required once the package has actually been
    // executed (executionState !== 'GENERATED'). Before that, the real
    // rows are not expected to exist yet, and omitting this check
    // entirely is the correct, non-blocking state.
    if (input.executionState !== 'GENERATED') {
      if (input.homeList.liveVerificationValid === undefined) {
        reasons.push(missing('Home list POST_APPLY live verification (required once the package has been applied)'))
      } else if (!input.homeList.liveVerificationValid) {
        reasons.push(`Home list POST_APPLY verification failed — expected production row(s) not found: ${(input.homeList.liveVerificationIssues ?? []).join('; ') || 'see detail'}.`)
      }
    }
  }

  if (input.reusedItemsAdditiveOnly === undefined) reasons.push(missing('Reused-item additive-only check'))
  else if (!input.reusedItemsAdditiveOnly) reasons.push('One or more reused existing-production items were linked in a way that is not purely additive (a real, blocking safety concern).')

  if (input.sqlSafetyVerdict === undefined) reasons.push(missing('SQL safety check'))
  else if (input.sqlSafetyVerdict === 'FAIL') reasons.push(`SQL safety check failed: ${(input.sqlSafetyIssues ?? []).join('; ') || 'see detail'}.`)

  const verdict: 'READY_TO_APPLY' | 'BLOCKED' = reasons.length === 0 ? 'READY_TO_APPLY' : 'BLOCKED'
  return {
    verdict,
    executionState: input.executionState,
    reasons:
      verdict === 'READY_TO_APPLY'
        ? [
            `All required checks passed. Package execution state: ${input.executionState} — ${
              input.executionState === 'GENERATED' ? 'NOT executed against production; applying it is a separate, deliberate human action.' : input.executionState === 'APPLIED' ? 'applied to production, not yet independently re-verified by a live read.' : 'confirmed live in production via a real read-path query.'
            }`,
          ]
        : reasons,
  }
}
