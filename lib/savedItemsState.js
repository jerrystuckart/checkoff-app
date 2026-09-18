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
 * Postgres unique_violation is '23505' — the ONLY code treated as benign,
 * matching this codebase's own established convention everywhere else a
 * duplicate-insert race is handled (e.g.
 * screens/ItemDetailScreen.jsx's check_ins insert handler:
 * `if (error.code === '23505')`).
 *
 * Item Detail Corrective Pass (2026-09-18) — REMOVED a prior blanket
 * `error.status === 409` branch that was found, on tracing the reported
 * "Detail Save looks filled but never persists" bug, to be the actual
 * root cause: PostgREST surfaces MANY constraint violations as HTTP 409,
 * not just a duplicate-PK race — most notably a foreign_key_violation
 * ('23503') on saved_items.item_id's `REFERENCES public.items(id)`
 * constraint. Under the old code, ANY 409 (including a genuine FK-
 * violation failure, e.g. from a caller-supplied item_id that doesn't
 * exist in `items`) was misclassified as "already saved" — runMutation's
 * `if (error && !isBenignDuplicateInsertError(error)) throw error` then
 * never threw, so the optimistic "filled" bookmark was never rolled back,
 * no error was ever surfaced to the user, and — because the classifier
 * said "success" — no row was ever actually written to `saved_items`
 * either. That exactly reproduces the reported symptom: the bookmark
 * shows filled, but the save never persists and never shows up in the
 * Lists tab's Saved screen. This was not exclusive to any one screen —
 * ItemDetailScreen.jsx, EditorialCard.jsx's SaveToggle, and
 * WhatsTheThingHero.jsx's own save toggle all call the exact same shared
 * `toggleSaved`/`runMutation` — but Detail's own item objects (assembled
 * by several different screens' own item-shaping code) are the least
 * uniformly guaranteed to always carry a genuine, currently-live
 * `items.id`, making Detail the most exposed surface for this class of
 * failure in practice.
 *
 * @param {{ code?: string } | null} error
 * @returns {boolean} true if this error means "already saved, treat as success"
 */
export function isBenignDuplicateInsertError(error) {
  if (!error) return false
  return error.code === '23505'
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
