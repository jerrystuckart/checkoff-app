// Visit Detection Stage 2 (2026-09-23) — pure client-side decision logic
// for the "Places you may have visited" inbox (screens/VisitInboxScreen.jsx).
// Split out the same way lib/tripModeCheckOffFlow.js is split from
// lib/tripMode.js: zero React Native / Supabase imports, loads under plain
// `node --test`. The real authorization boundary is server-side (the new
// verification_method = 'historical_visit_confirmed' branch in
// prevent_expired_list_checkins(), see
// supabase/migrations/20260923_visit_detection_stage2_confirm.sql) — this
// module only builds the client payload and the display-eligibility check;
// it does not and must not decide points or eligibility on its own.

/**
 * Whether a candidate_visits row should appear in the inbox at all.
 * Mirrors the server-side gate in prevent_expired_list_checkins() (status +
 * expiry) so the UI never offers something the server would reject anyway —
 * but the server check remains authoritative; this is a display-only mirror.
 *
 * @param {object} params
 * @param {string} params.status
 * @param {string|null} params.expiresAt  ISO timestamp
 * @param {string|null} [params.confirmedAt]
 * @param {string|null} [params.rejectedAt]
 * @param {Date} [params.now]
 * @returns {boolean}
 */
export function isCandidateVisitSuggestible({ status, expiresAt, confirmedAt = null, rejectedAt = null, now = new Date() }) {
  if (confirmedAt || rejectedAt) return false
  if (!['candidate', 'medium_confidence', 'high_confidence'].includes(status)) return false
  if (expiresAt && new Date(expiresAt) <= now) return false
  return true
}

/**
 * Builds the check_ins insert payload for confirming a specific candidate
 * visit. Standalone-item only, mirroring the server branch's own
 * requirement (list_item_id must be NULL) — candidate_visits are always
 * item-level. points_awarded is included for payload-shape completeness
 * only; the server trigger unconditionally overwrites it with a
 * server-derived value (items.difficulty), exactly like Trip Mode's own
 * points-derivation fix — never trusted from this client value.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.itemId
 * @param {string} params.candidateVisitId
 * @param {string|null} [params.photoUrl]
 * @param {number|null} [params.photoWidth]
 * @param {number|null} [params.photoHeight]
 * @param {string|null} [params.personalPlace]
 * @param {string|null} [params.personalNote]
 * @returns {object} check_ins insert payload
 */
export function buildVisitConfirmationPayload({
  userId,
  itemId,
  candidateVisitId,
  photoUrl = null,
  photoWidth = null,
  photoHeight = null,
  personalPlace = null,
  personalNote = null,
}) {
  if (!itemId) {
    throw new Error('Visit confirmation requires an item_id.')
  }
  if (!candidateVisitId) {
    throw new Error('Visit confirmation requires the specific candidate_visits.id being confirmed — there is no general confirmation path.')
  }

  return {
    user_id: userId,
    item_id: itemId,
    list_item_id: null,
    checkin_method: 'tap',
    points_awarded: 0, // overwritten server-side; see module header
    verification_method: 'historical_visit_confirmed',
    matched_candidate_visit_id: candidateVisitId,
    photo_url: photoUrl,
    photo_width: photoWidth,
    photo_height: photoHeight,
    personal_place: personalPlace,
    personal_note: personalNote,
  }
}

/**
 * Builds the candidate_visits update payload for dismissing ("Not this
 * time") a suggestion. No server-side trigger involvement needed — the
 * existing candidate_visits_update_own RLS policy (user_id = auth.uid())
 * already permits this; there is no points/authorization concern for a
 * dismiss, only for a confirm.
 *
 * @returns {{status: string, rejected_at: string}}
 */
export function buildVisitDismissalPayload() {
  return { status: 'rejected', rejected_at: new Date().toISOString() }
}

/**
 * Relative "when" label for an inbox row, e.g. "Today, ~2:15 PM",
 * "Yesterday, ~7:40 PM", "Sep 20, ~1:05 PM". Approximate ("~") because
 * arrival_at/departure_at bracket a dwell window, not one exact instant —
 * the label uses departure_at (when the visit was confirmed to have ended).
 *
 * @param {string} departureAtIso
 * @param {Date} [now]
 * @returns {string}
 */
export function formatVisitWhenLabel(departureAtIso, now = new Date()) {
  const departed = new Date(departureAtIso)
  const time = departed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayDiff = Math.round((startOfDay(now) - startOfDay(departed)) / 86400000)

  if (dayDiff === 0) return `Today, ~${time}`
  if (dayDiff === 1) return `Yesterday, ~${time}`
  const dateLabel = departed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${dateLabel}, ~${time}`
}

/**
 * Rows the inbox shows: still-pending, unexpired, NOT already checked off
 * (through any path, including after the visit was created), with a
 * notification-linked suggestion sorted first. Display mirror only — the
 * server rejects the confirm regardless (20260924 / 20260927 migrations).
 *
 * @param {object} params
 * @param {Array<{candidateVisitId:string,itemId:string,status:string,expiresAt:string|null,confirmedAt?:string|null,rejectedAt?:string|null}>} params.rows
 * @param {Set<string>} params.checkedOffItemIds
 * @param {string|null} [params.highlightId]
 * @param {Date} [params.now]
 */
export function selectInboxRows({ rows, checkedOffItemIds, highlightId = null, now = new Date() }) {
  const visible = (rows ?? []).filter(r =>
    isCandidateVisitSuggestible({ status: r.status, expiresAt: r.expiresAt, confirmedAt: r.confirmedAt ?? null, rejectedAt: r.rejectedAt ?? null, now })
    && !checkedOffItemIds?.has(r.itemId))
  return highlightId
    ? [...visible].sort((a, b) => (a.candidateVisitId === highlightId ? -1 : b.candidateVisitId === highlightId ? 1 : 0))
    : visible
}
