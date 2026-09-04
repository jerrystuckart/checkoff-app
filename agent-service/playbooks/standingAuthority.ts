// Chief Phase 2A — Standing Authority Model.
//
// A single, data-driven policy table Chief consults before acting —
// never a scattered set of ad-hoc `if` checks buried in playbook logic.
// Every operation a playbook (or any future Chief capability) might
// perform is registered here exactly once, with exactly one authority
// level. Adding a new operation is a deliberate, reviewed code change to
// this table, never something a playbook definition invents inline.
//
// This is a SIBLING to (not a replacement for) the existing Phase 1D
// ActionPolicy system in actionPolicyTypes.ts — that system gates
// per-task-type autonomous *execution* (claim/execute/verify a single
// task via actionExecution.ts). This module gates playbook *operations*
// (a named unit of work a playbook step performs, e.g. "record a
// deterministic classification," "send outbound email"), which is a
// finer grain than ActionType and applies across every playbook, not
// just the ones with a registered ActionHandler. Where the two overlap
// conceptually (AUTO_ALLOWED / APPROVAL_REQUIRED), the levels are kept
// intentionally aligned so Chief never says two different things about
// the same capability depending on which system asked.
//
// THREE LEVELS (per the Phase 2A spec):
//   AUTO             — Chief performs this without asking Jerry first.
//   AUTO_TELL        — designed for now, NOT ACTIVATED. A future policy
//                       flip could let Chief perform these and just tell
//                       Jerry afterward (in the daily brief), but every
//                       entry at this level today still resolves to
//                       APPROVAL_REQUIRED behavior until Jerry explicitly
//                       flips AUTO_TELL_ACTIVE below — see evaluateAuthority.
//   APPROVAL_REQUIRED — Chief may prepare/recommend but never acts;
//                       requires Jerry.
//
// Extending to a new playbook (Destination Hub build, Metro launch,
// photo moderation, cling fulfillment, etc.) means adding new operation
// keys here — the table, not the engine, is what generalizes.

export type AuthorityLevel = 'AUTO' | 'AUTO_TELL' | 'APPROVAL_REQUIRED'

/**
 * Global kill switch for the AUTO_TELL tier. Per the explicit Phase 2A
 * instruction ("Do not activate outbound autonomy yet if current policy
 * still requires approval"), this stays false — AUTO_TELL operations are
 * DESIGNED, registered, and testable, but evaluateAuthority() downgrades
 * them to APPROVAL_REQUIRED behavior while this is false. Flipping this
 * to true is a deliberate, separate, Jerry-approved policy change, never
 * something a playbook or this module does on its own.
 */
export const AUTO_TELL_ACTIVE = false

/**
 * The full closed set of operations any Chief playbook may perform,
 * mapped to a fixed authority level. Grouped by the Phase 2A spec's own
 * categories — the grouping is documentation only, evaluateAuthority()
 * reads the flat map.
 */
export const STANDING_AUTHORITY: Readonly<Record<string, AuthorityLevel>> = Object.freeze({
  // --- AUTO: read/search, deterministic task state, evidence, classification ---
  'operational.read_state': 'AUTO',
  'operational.create_task': 'AUTO',
  'operational.update_task_state': 'AUTO',
  'operational.attach_evidence': 'AUTO',
  'operational.classify_deterministic_event': 'AUTO',
  'operational.schedule_followup_task': 'AUTO',
  'operational.mark_unblocked_from_evidence': 'AUTO',
  'operational.reconcile_duplicate_task': 'AUTO',
  'business_outreach.record_sent': 'AUTO',
  'business_outreach.record_evidence': 'AUTO',
  'business_outreach.classify_response': 'AUTO',
  'business_outreach.record_item_confirmed': 'AUTO',
  'business_outreach.record_photo_submitted': 'AUTO',
  'business_outreach.recommend_photo_action': 'AUTO', // surfacing a recommendation is AUTO; acting on it is not (see below)
  'business_outreach.create_cling_fulfillment_task': 'AUTO',
  'business_outreach.schedule_followup': 'AUTO',
  'business_outreach.mark_complete': 'AUTO',
  'business_outreach.secret_branch_route': 'AUTO', // routing to the non-spoiler branch is deterministic (is_secret is structured data)

  // --- Photo Moderation (Chief Phase 2B) ---
  'photo_moderation.detect_candidate': 'AUTO',
  'photo_moderation.create_moderation_task': 'AUTO',
  'photo_moderation.gather_context': 'AUTO',
  'photo_moderation.assess_recommend': 'AUTO',
  'photo_moderation.reconcile_evidence': 'AUTO',
  'photo_moderation.secret_item_escalate': 'AUTO', // deciding TO escalate for a secret item is deterministic; the escalated exception itself is APPROVAL_REQUIRED (see business_outreach.secret_item_exception above)

  // --- Metro Launch (Chief Phase 2C) ---
  'metro_launch.research': 'AUTO',
  'metro_launch.coverage_count': 'AUTO',
  'metro_launch.identify_gap': 'AUTO',
  'metro_launch.create_draft_task': 'AUTO',
  'metro_launch.build_internal_artifact': 'AUTO',
  'metro_launch.deterministic_db_bookkeeping': 'AUTO',
  'metro_launch.stage_catalog_write': 'AUTO', // staged (is_active=false) writes only — see gate/APPROVAL_REQUIRED entries below for anything public-facing
  'metro_launch.public_launch': 'APPROVAL_REQUIRED',
  'metro_launch.destructive_data_change': 'APPROVAL_REQUIRED',

  // --- Destination Hub Lifecycle (Chief Phase 2C) ---
  'destination_hub.research': 'AUTO',
  'destination_hub.dva1_screen': 'AUTO',
  'destination_hub.draft_dva2': 'AUTO',
  'destination_hub.draft_dap': 'AUTO',
  'destination_hub.build_internal_artifact': 'AUTO',
  'destination_hub.stakeholder_research': 'AUTO',
  'destination_hub.content_inventory': 'AUTO',
  'destination_hub.public_launch': 'APPROVAL_REQUIRED',
  'destination_hub.commercial_offer': 'APPROVAL_REQUIRED',
  'destination_hub.pricing_change': 'APPROVAL_REQUIRED',
  'destination_hub.partner_commitment': 'APPROVAL_REQUIRED',
  'destination_hub.relationship_sensitive_communication': 'APPROVAL_REQUIRED',
  'destination_hub.hub_activation': 'APPROVAL_REQUIRED',

  // --- Destination Relationship Manager (Chief Phase 2C correction) ---
  'destination_relationship.identify_contact': 'AUTO',
  'destination_relationship.select_channel': 'AUTO',
  'destination_relationship.draft_outreach': 'AUTO', // drafting only — sending is send_email below
  'destination_relationship.classify_reply': 'AUTO',
  'destination_relationship.schedule_followup': 'AUTO',
  'destination_relationship.track_sentiment': 'AUTO',
  'destination_relationship.gather_meeting_evidence': 'AUTO', // pre-call brief assembly from DVA/DAP/contact/email history
  'destination_relationship.send_email': 'APPROVAL_REQUIRED',
  'destination_relationship.create_calendar_event': 'APPROVAL_REQUIRED',
  'destination_relationship.change_pricing': 'APPROVAL_REQUIRED',
  'destination_relationship.commercial_commitment': 'APPROVAL_REQUIRED',
  'destination_relationship.accept_contract': 'APPROVAL_REQUIRED',
  'destination_relationship.relationship_sensitive_promise': 'APPROVAL_REQUIRED',

  // --- AUTO_TELL: designed, not yet activated ---
  'business_outreach.send_routine_thank_you': 'AUTO_TELL',
  'business_outreach.send_receipt_acknowledgment': 'AUTO_TELL',
  'business_outreach.send_photo_received_ack': 'AUTO_TELL',
  'business_outreach.send_cling_received_ack': 'AUTO_TELL',

  // --- APPROVAL_REQUIRED: kept with Jerry ---
  'photo_moderation.approve': 'APPROVAL_REQUIRED',
  'photo_moderation.reject': 'APPROVAL_REQUIRED',
  'photo_moderation.add_to_rotation': 'APPROVAL_REQUIRED',
  'photo_moderation.remove_from_rotation': 'APPROVAL_REQUIRED',
  'photo_moderation.set_primary': 'APPROVAL_REQUIRED',
  'business_outreach.send_outbound_email': 'APPROVAL_REQUIRED',
  'business_outreach.resolve_item_correction': 'APPROVAL_REQUIRED',
  'business_outreach.approve_reject_photo': 'APPROVAL_REQUIRED',
  'business_outreach.select_primary_photo': 'APPROVAL_REQUIRED',
  'business_outreach.monetization_partner_reply': 'APPROVAL_REQUIRED',
  'business_outreach.secret_item_exception': 'APPROVAL_REQUIRED',
  'operational.destructive_db_operation': 'APPROVAL_REQUIRED',
  'operational.public_global_feature_rollout': 'APPROVAL_REQUIRED',
  'operational.new_vendor_spend': 'APPROVAL_REQUIRED',
  'operational.relationship_sensitive_reply': 'APPROVAL_REQUIRED',
})

export class UnknownAuthorityOperationError extends Error {
  constructor(public readonly operation: string) {
    super(
      `No standing authority entry for operation "${operation}" — every Chief operation must be explicitly registered ` +
        `in STANDING_AUTHORITY before it can be evaluated. Add it there first (a deliberate, reviewed decision), ` +
        `never treat an unregistered operation as implicitly AUTO.`
    )
    this.name = this.constructor.name
  }
}

/**
 * The ONLY way a playbook/engine should decide whether it may act
 * without asking Jerry. Refuses (throws) for an unregistered operation
 * rather than defaulting to any particular level — an operation Chief
 * doesn't yet have a documented policy for is never silently treated as
 * safe.
 *
 * AUTO_TELL resolves to false (i.e. "you may not act unattended") while
 * AUTO_TELL_ACTIVE is false — see that constant's own doc.
 */
export function evaluateAuthority(operation: string): { level: AuthorityLevel; mayActWithoutJerry: boolean } {
  const level = STANDING_AUTHORITY[operation]
  if (level === undefined) throw new UnknownAuthorityOperationError(operation)

  const mayActWithoutJerry = level === 'AUTO' || (level === 'AUTO_TELL' && AUTO_TELL_ACTIVE)
  return { level, mayActWithoutJerry }
}

/** Convenience predicate for call sites that only need the yes/no answer. */
export function mayActWithoutJerry(operation: string): boolean {
  return evaluateAuthority(operation).mayActWithoutJerry
}
