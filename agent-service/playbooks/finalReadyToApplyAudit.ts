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
//   - Home list counts reconcile
//   - reused production items are linked additively only
//   - SQL is atomic and safe
//   - package has not been executed unless explicitly confirmed
//
// A gate result that's simply missing from the input is treated the same
// as a real failure — never silently skipped, matching the same discipline
// certifyMetroLaunch() already uses for its own required gate categories.

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
  /** True when every planned Home list's expected item count matches what was actually linked (flagship count, themed list counts, reused-item links all accounted for). */
  homeListCountsReconcile?: boolean
  homeListCountMismatches?: readonly string[]
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

  if (input.homeListCountsReconcile === undefined) reasons.push(missing('Home list count reconciliation'))
  else if (!input.homeListCountsReconcile) reasons.push(`Home list count mismatch: ${(input.homeListCountMismatches ?? []).join('; ') || 'see detail'}.`)

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
