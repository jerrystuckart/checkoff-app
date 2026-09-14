// agent-service/playbooks/operatorReviewBoundaries.ts
//
// M9 two-pass list curation — Phase 5 (commit 5/7): where Jerry's approval
// (the existing NEEDS_JERRY/escalate() pattern in metroLaunchDriver.ts) is
// required, defined as real, enforced, testable logic rather than only a
// design note. Pure, no I/O — this module is a decision table + predicate
// function; wiring its output into metroLaunchDriver.ts's actual escalate()
// call sites is a follow-up integration step (see this phase's own commit
// message for why that wiring is deliberately deferred, matching Phase 3's
// same conservative choice about metroLaunchDriver.ts's real size/risk).
//
// The list below is exactly the action set named in this task's Phase 5
// instructions — nothing added, nothing dropped. Every action not on this
// list defaults to NOT requiring approval (routine candidate scoring and
// report generation must never over-escalate), which this module also
// verifies with a real, enforced default rather than an implicit assumption.

export type OperatorReviewAction =
  | 'CREATE_NEW_LIST_CONCEPT'
  | 'REMOVE_OR_REPLACE_COMPLETED_LIST'
  | 'CONCEPT_WITH_SUBSTANTIAL_OVERLAP'
  | 'LIST_NEEDS_WEAK_ITEMS_TO_MEET_PREFERRED_SIZE'
  | 'UNSUPPORTED_SECRET_DESIGNATION'
  | 'MARKET_BOUNDARY_EXCEPTION'
  | 'REOPEN_COMPLETED_METRO'
  | 'AMBIGUOUS_DIFFICULTY_10_OR_25'
  // Explicitly named as NOT requiring approval, per this phase's own
  // instruction ("routine candidate scoring and report generation must NOT
  // require approval") — included in the same enum so a caller can request
  // a decision for ANY action it's about to take and get a real answer,
  // rather than needing to already know which actions are exempt.
  | 'ROUTINE_CANDIDATE_SCORING'
  | 'ROUTINE_REPORT_GENERATION'
  | 'ROUTINE_LIST_FIT_SCORING'

export interface OperatorReviewDecision {
  action: OperatorReviewAction
  requiresApproval: boolean
  reason: string
  /** The existing driver-level mechanism this ties into, when one already exists — never invented fresh where a precedent is already established. */
  tiesIntoExistingMechanism: string | null
}

const BOUNDARY_TABLE: Record<OperatorReviewAction, Omit<OperatorReviewDecision, 'action'>> = {
  CREATE_NEW_LIST_CONCEPT: {
    requiresApproval: true,
    reason: 'Creating a new list concept is a durable, launch-facing editorial decision — listConceptDiscovery.ts\'s CREATE verdict means "this concept passes automated coherence/depth checks," never "this concept is live." A real list is only ever created after Jerry\'s explicit review.',
    tiesIntoExistingMechanism: 'NEEDS_JERRY / escalate() (metroLaunchDriver.ts)',
  },
  REMOVE_OR_REPLACE_COMPLETED_LIST: {
    requiresApproval: true,
    reason: 'Removing or replacing an existing completed production list is irreversible-by-default (per evaluateItemForListMembership\'s own COMPLETED-list-refuses-changes-unless-reopened guardrail, listFitScoring.ts) — the reopen decision itself is Jerry\'s call, not automatic.',
    tiesIntoExistingMechanism: 'reopen-stage / --reopen-from-launch-boundary (metroLaunchDriver.ts)',
  },
  CONCEPT_WITH_SUBSTANTIAL_OVERLAP: {
    requiresApproval: true,
    reason: 'A proposed concept with substantial overlap against an already-accepted concept (listConceptDiscovery.ts\'s own REQUIRES_JERRY verdict) risks two lists partially describing the same experience — a real Munich case (Beer Gardens/Day Trips share 3-4 items) that stayed defensible only because both were reviewed, not auto-created.',
    tiesIntoExistingMechanism: 'NEEDS_JERRY / escalate() (metroLaunchDriver.ts)',
  },
  LIST_NEEDS_WEAK_ITEMS_TO_MEET_PREFERRED_SIZE: {
    requiresApproval: true,
    reason: 'A list that cannot reach its preferred size with genuinely qualifying items (enforcePreferredSizeWithoutFiller\'s belowPreferred=true case, listFitScoring.ts) must never be padded automatically — accepting weaker items to hit a count is exactly the failure mode this whole calibration analysis found in Winston\'s original build, and only Jerry can accept that tradeoff deliberately.',
    tiesIntoExistingMechanism: 'NEEDS_JERRY / escalate() (metroLaunchDriver.ts)',
  },
  UNSUPPORTED_SECRET_DESIGNATION: {
    requiresApproval: true,
    reason: 'Marking an item is_secret=true without evidence clearing categoryPolicy.ts\'s evaluateSecretEvidence bar (a concrete, sourced mechanic — never "hidden gem"/"local favorite" wording alone) must never happen automatically; per 14-difficulty-and-secret-remediation-plan.md, even the two strongest real Munich candidates (Haus im Tal, \'Boazn\' at Ludwigsbrücke) require explicit human-reviewed verification before flipping the flag.',
    tiesIntoExistingMechanism: 'NEEDS_JERRY / escalate() (metroLaunchDriver.ts)',
  },
  MARKET_BOUNDARY_EXCEPTION: {
    requiresApproval: true,
    reason: 'An item outside the metro\'s explicit geographic scope (e.g. the real Dachau/Starnberg contradiction — both explicitly excluded in m0.json yet live in production and now in featured-eligible lists) requires an explicit exception, mirroring the existing approvedCategoryExceptions / ITEM_GEO_METRO_CONSISTENCY_GATE precedent — never a silent pass.',
    tiesIntoExistingMechanism: 'approvedCategoryExceptions / ITEM_GEO_METRO_CONSISTENCY_GATE (metroLaunchDriver.ts)',
  },
  REOPEN_COMPLETED_METRO: {
    requiresApproval: true,
    reason: 'Reopening a metro whose launch already reached a completed/certified boundary is a deliberate operator action by design (reopen-stage\'s own existing precedent) — never triggered automatically by a downstream finding.',
    tiesIntoExistingMechanism: 'reopen-stage / --reopen-from-launch-boundary (metroLaunchDriver.ts)',
  },
  AMBIGUOUS_DIFFICULTY_10_OR_25: {
    requiresApproval: true,
    reason: 'A difficulty evaluation that itself returns REQUIRES_REVIEW confidence (difficultyEvidence.ts\'s evaluateDifficultyEvidence — e.g. the real SAP Garden low-intensity-activity case, or the Surftown MUC 10-vs-25 travel-distance boundary case) is, by the rubric\'s own design, not something a pure function should assert confidently — it goes to Jerry rather than defaulting to either band.',
    tiesIntoExistingMechanism: 'NEEDS_JERRY / escalate() (metroLaunchDriver.ts) — gated on difficultyEvidence.ts\'s own confidence field',
  },
  ROUTINE_CANDIDATE_SCORING: {
    requiresApproval: false,
    reason: 'Per-candidate READY/HOLD/REJECT scoring (seedPortfolioAudit.ts\'s evaluateSeedCandidate) and per-item-per-list fit scoring (listFitScoring.ts\'s scoreItemForList/evaluateItemForListMembership) are routine, deterministic, fully-reasoned outputs — escalating every scoring call would defeat the entire point of an automated audit stage. Only specific downstream CONSEQUENCES of that scoring (creating a list, marking a secret, padding a list) require approval, never the scoring itself.',
    tiesIntoExistingMechanism: null,
  },
  ROUTINE_REPORT_GENERATION: {
    requiresApproval: false,
    reason: 'Generating a SeedPortfolioAuditReport, a list-concept-discovery report, or a portfolio-repetition-review report is observational — it never mutates anything and never needs Jerry\'s approval to produce; only acting on a report\'s findings (in the ways enumerated above) does.',
    tiesIntoExistingMechanism: null,
  },
  ROUTINE_LIST_FIT_SCORING: {
    requiresApproval: false,
    reason: 'An individual ItemListFitDecision (INCLUDE/EXCLUDE/HOLD for one item against one already-approved list) is routine per-item curation work, not a standing-rules change — HOLD itself already routes to explicit review by construction (never silently resolved either way) without needing a SEPARATE Jerry-approval gate on top of the HOLD verdict.',
    tiesIntoExistingMechanism: null,
  },
}

/**
 * Real, enforced boundary lookup — the single source of truth for whether
 * `action` requires Jerry's explicit approval before proceeding. Never a
 * bare boolean the caller has to trust blind: always paired with a reason
 * and (when one exists) the existing driver mechanism it ties into.
 */
export function evaluateOperatorReviewBoundary(action: OperatorReviewAction): OperatorReviewDecision {
  return { action, ...BOUNDARY_TABLE[action] }
}

/** Convenience: every action requiring approval, for documentation/reporting. */
export function actionsRequiringApproval(): OperatorReviewAction[] {
  return (Object.keys(BOUNDARY_TABLE) as OperatorReviewAction[]).filter((a) => BOUNDARY_TABLE[a].requiresApproval)
}

/** Convenience: every action that must NEVER require approval — verified here as real enforced behavior, not just documentation, per this phase's explicit "verify this stays true" instruction. */
export function actionsThatMustNeverRequireApproval(): OperatorReviewAction[] {
  return ['ROUTINE_CANDIDATE_SCORING', 'ROUTINE_REPORT_GENERATION', 'ROUTINE_LIST_FIT_SCORING']
}
