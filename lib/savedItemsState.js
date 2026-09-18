// Saved Items V1 (2026-09-18) — pure, React-free state logic for the
// shared Saved-items provider (lib/SavedItemsContext.js). Mirrors this
// repo's established hook-owns-policy / lib-stays-pure split (see
// lib/useCoverCandidateCTA.js + lib/coverCandidateEligibility.js,
// lib/useWhatsGood.js + lib/whatsGoodOrchestrator.js): the hook/provider
// owns React state (useState/useEffect/refs) and Supabase calls; this
// module owns the actual decision/derivation logic so it can be unit
// tested with plain node:test, no RN render harness needed.
//
// Nothing in this file imports React or Supabase. Every function is a
// pure transform: given inputs, return an output (a new Set, or a
// decision), with no side effects.

/**
 * Builds the initial savedItemIds Set from a bulk fetch's rows.
 * @param {Array<{ item_id: string }>} rows
 * @returns {Set<string>}
 */
export function buildSavedIdsFromRows(rows) {
  const ids = new Set()
  for (const row of rows ?? []) {
    if (row?.item_id) ids.add(row.item_id)
  }
  return ids
}

/**
 * Optimistically applies a save/unsave to a Set, returning a NEW Set
 * (never mutates the input) so React can diff it as a fresh reference.
 * @param {Set<string>} currentIds
 * @param {string} itemId
 * @param {'save'|'unsave'} action
 * @returns {Set<string>}
 */
export function applyOptimisticUpdate(currentIds, itemId, action) {
  const next = new Set(currentIds)
  if (action === 'save') {
    next.add(itemId)
  } else {
    next.delete(itemId)
  }
  return next
}

/**
 * Decides whether a toggle should actually fire a network call, given the
 * item's CURRENT local saved state and whether an operation for this item
 * is already in flight.
 *
 * - Prevents duplicate simultaneous requests for the same item (a second
 *   toggle call for an itemId already in `inFlightIds` is a no-op).
 * - Idempotent: a toggle is always the opposite of current state, so this
 *   is really just the "already in flight" guard — kept as its own
 *   function so the in-flight rule is independently testable.
 *
 * @param {Set<string>} inFlightIds
 * @param {string} itemId
 * @returns {boolean} true if the toggle should proceed
 */
export function shouldStartToggle(inFlightIds, itemId) {
  return !inFlightIds.has(itemId)
}

/**
 * Decides whether an explicit saveItem()/unsaveItem() call (not a
 * toggle) should actually fire a network call — idempotent against the
 * CURRENT known state: don't fire an insert if already saved, don't fire
 * a delete if already unsaved (unless explicitly recovering from stale
 * state, which callers signal via `force`).
 *
 * @param {Set<string>} currentIds
 * @param {string} itemId
 * @param {'save'|'unsave'} action
 * @param {boolean} [force]
 * @returns {boolean}
 */
export function shouldIssueWrite(currentIds, itemId, action, force = false) {
  if (force) return true
  const alreadySaved = currentIds.has(itemId)
  if (action === 'save') return !alreadySaved
  return alreadySaved
}

/**
 * Classifies a Supabase insert error for saved_items as either a
 * benign "already saved" convergence (composite-PK conflict) or a real
 * failure that should roll back the optimistic update.
 *
 * Postgres unique_violation is '23505'; PostgREST sometimes surfaces a
 * 409 conflict status instead depending on the exact race. Both count
 * as "already saved" — a duplicate insert converges to Saved rather
 * than surfacing as a failure.
 *
 * @param {{ code?: string, status?: number } | null} error
 * @returns {boolean} true if this error means "already saved, treat as success"
 */
export function isBenignDuplicateInsertError(error) {
  if (!error) return false
  if (error.code === '23505') return true
  if (error.status === 409) return true
  return false
}

/**
 * A delete matching zero rows is not a Postgres/PostgREST error — it's a
 * successful no-op. This function exists purely so call sites have one
 * documented, testable place asserting "deleting an already-absent row
 * converges to unsaved" rather than treating a zero-count delete as a
 * failure. Given a Supabase delete result (`{ error }`), only a real
 * `error` should trigger rollback — an empty/zero-count success must not.
 *
 * @param {{ error?: any } | null} deleteResult
 * @returns {boolean} true if this result should be treated as success
 */
export function isDeleteConvergedToUnsaved(deleteResult) {
  return !deleteResult?.error
}

/**
 * Pure reducer for the provider's in-flight operations map. Returns a
 * NEW Set/Map-like structure (callers pass a Set of itemIds currently in
 * flight) rather than mutating the input.
 */
export function markInFlight(inFlightIds, itemId) {
  const next = new Set(inFlightIds)
  next.add(itemId)
  return next
}

export function clearInFlight(inFlightIds, itemId) {
  const next = new Set(inFlightIds)
  next.delete(itemId)
  return next
}

/**
 * Resets all Saved state on logout/account switch — returns the fresh
 * "empty, not loading-stale-data" state shape the provider should apply
 * immediately, before any re-fetch for a new user begins.
 */
export function resetState() {
  return {
    savedItemIds: new Set(),
    inFlightIds:  new Set(),
    loading:      false,
  }
}
