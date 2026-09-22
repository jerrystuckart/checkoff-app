// Right Here Hero redesign (Phase 2/5, 2026-09-22) — pure decision helpers
// extracted from components/home/WhatsTheThingHero.jsx so they're testable
// without an RN render harness (this repo's established convention — see
// lib/whatsGoodCoverageMode.js / .test.js for the precedent this mirrors).

/**
 * Should the one-time "what is this card" explainer show automatically the
 * first time the Right Here hero renders? Mirrors lib/useOnboarding.js's
 * "null means never seen" convention exactly.
 *
 * @param {string|null} storedValue  raw AsyncStorage.getItem() result for
 *   the explainer's dismissal key — null means it has never been dismissed.
 * @returns {boolean}
 */
export function shouldAutoShowExplainer(storedValue) {
  return storedValue === null
}

/**
 * Dedupe guard for the 'right_here_viewed' analytics event so it fires
 * once per distinct at-place item rather than on every re-render (e.g. the
 * card's own mount animation, a parent re-render from an unrelated state
 * change, etc). trackEvent.js's own DEBOUNCED_TYPES set is a 30-minute
 * per-subject window built for list_view/item_view; extending it wasn't a
 * simple additive change for this event's semantics (it should reset per
 * *distinct item shown*, not just cool down over time), so this guard is
 * local to the component instead, per the Phase 7 instruction to prefer a
 * local guard when extending trackEvent.js isn't a clean fit.
 *
 * @param {object} params
 * @param {boolean} params.compact  the compact (folded secondary) mode
 *   never counts as a "view" of the dominant hero — only dominant mode fires.
 * @param {string|number|null|undefined} params.itemId
 * @param {string|number|null} params.lastFiredItemId  itemId the event was
 *   last fired for this session (null if never fired yet).
 * @returns {boolean}
 */
export function shouldFireRightHereViewed({ compact, itemId, lastFiredItemId }) {
  if (compact) return false
  if (itemId === null || itemId === undefined) return false
  return itemId !== lastFiredItemId
}
