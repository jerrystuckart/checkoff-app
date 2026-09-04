// Visit Reminder V1 — pure eligibility rule for the "Did you CheckOff the
// Thing?" high-confidence departure notification. This function is the
// single source of truth for the same rule
// supabase/migrations/20260902_visit_reminder_v1_notify_trigger.sql's AFTER
// INSERT trigger implements in SQL — SQL and JS can't share code directly,
// so this pure function exists specifically so the rule gets real automated
// test coverage (see notifyEligibility.test.js). If the rule ever changes,
// change both places; the SQL file's own comments point back here.
//
// Reuses the existing confidence system exactly — introduces no new
// threshold. strongCandidateBelow is the caller-supplied
// visit_confidence_bands.strong_candidate_below value, not a constant here.
//
// AUDIT FINDING this implements: candidate_visits.status alone is NOT a
// safe filter for "high-confidence" — handleDeparture() (see
// lib/visitDetection/candidateVisitTracker.js) collapses both the weaker
// high_confidence band (score 70-84) and the notify_eligible band (score
// >=85, bandForScore()'s own name for exactly this use case) into the same
// stored status string 'high_confidence'. This rule reads confidence_score
// directly against strongCandidateBelow to reproduce bandForScore()'s real
// notify_eligible cutoff, not the collapsed status column.

/**
 * @param {object} params
 * @param {number|null} params.confidenceScore  candidate_visits.confidence_score
 * @param {number|null} params.strongCandidateBelow  visit_confidence_bands.strong_candidate_below
 * @param {boolean} params.isTester  users.visit_detection_tester
 * @param {boolean} params.realtimeNotificationsEnabled  resolved realtime_nearby_checkoff_notifications for this user (per-user override > global > false)
 * @param {boolean} params.silentModeEnabled  resolved candidate_visit_silent_mode for this user
 * @param {boolean} params.alreadyCheckedOffDuringVisit  true if a check_ins row exists for this item/user with checked_at >= candidate_visits.arrival_at
 * @param {boolean} [params.alreadyNotified]  true if candidate_visits.notification_sent_at is already set for this row
 * @returns {{eligible: boolean, reason: string}}
 */
export function isNotifyEligibleCandidateVisit({
  confidenceScore,
  strongCandidateBelow,
  isTester,
  realtimeNotificationsEnabled,
  silentModeEnabled,
  alreadyCheckedOffDuringVisit,
  alreadyNotified = false,
}) {
  if (alreadyNotified) return { eligible: false, reason: 'already_notified' }
  if (confidenceScore == null || strongCandidateBelow == null) {
    return { eligible: false, reason: 'missing_score_or_threshold' }
  }
  if (confidenceScore < strongCandidateBelow) {
    return { eligible: false, reason: 'below_notify_eligible_threshold' }
  }
  if (!isTester) return { eligible: false, reason: 'not_tester' }
  if (!realtimeNotificationsEnabled) return { eligible: false, reason: 'realtime_notifications_disabled' }
  if (silentModeEnabled) return { eligible: false, reason: 'silent_mode' }
  if (alreadyCheckedOffDuringVisit) return { eligible: false, reason: 'already_checked_off' }
  return { eligible: true, reason: 'notify_eligible' }
}

/** The exact push copy for this notification type — kept as one named export so the queue processor and any test/documentation reference the same literal strings. */
export const CANDIDATE_VISIT_NOTIFICATION_TYPE = 'candidate_visit_high_confidence'
export const CANDIDATE_VISIT_NOTIFICATION_TITLE = 'Did you CheckOff the Thing?'
export const CANDIDATE_VISIT_NOTIFICATION_BODY = 'You were just at a CheckOff spot 👀'
