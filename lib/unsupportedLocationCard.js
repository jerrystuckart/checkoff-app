// Phase 4 — "unsupported location" card policy layer.
//
// CONTEXT: lib/whatsGoodCoverageMode.js's UNSUPPORTED mode (valid, resolved
// location, but no supported metro within range) already composes
// Universal-only items via the existing orchestrator/adapter pipeline — see
// that module's doc. Until this fix, a user in that mode either saw nothing
// (0 Universal items available) or saw ordinary-looking "What's Good" cards
// with no indication they were outside CheckOff's coverage area. This
// module is the single place that decides what copy/state to show for that
// mode — components/home/WhatsGoodDiscovery.jsx and
// components/home/UnsupportedLocationCard.jsx render whatever this
// function returns rather than re-deriving the policy themselves.
//
// Pure, no I/O — mirrors lib/whatsGoodCoverageMode.js's own pure-function
// convention.

import { COVERAGE_MODE } from './whatsGoodCoverageMode.js'

/** Verbatim copy — no hyphens anywhere per the public-copy requirement. */
export const UNSUPPORTED_LOCATION_TITLE = "We haven't unlocked this city yet"
export const UNSUPPORTED_LOCATION_BODY =
  'CheckOff does not have a complete local guide here yet. You can still try something that works anywhere.'

/**
 * @param {object} params
 * @param {string} params.coverageMode  One of COVERAGE_MODE's values, as
 *   returned by lib/useWhatsGood.js's `coverageMode`.
 * @param {Array} [params.items]  The hook's already-composed `items` — for
 *   UNSUPPORTED mode these are Universal-only (see whatsGoodCoverageMode.js
 *   doc). Never re-fetched or re-filtered here, only counted/passed through.
 * @returns {{
 *   shouldRender: boolean,
 *   title: string|null,
 *   body: string|null,
 *   universalItems: Array,
 *   showTryAnywhereAction: boolean,
 * }}
 */
export function deriveUnsupportedLocationCardState({ coverageMode, items }) {
  const universalItems = Array.isArray(items) ? items.filter((item) => Boolean(item?.is_universal)) : []

  if (coverageMode !== COVERAGE_MODE.UNSUPPORTED) {
    return {
      shouldRender: false,
      title: null,
      body: null,
      universalItems: [],
      showTryAnywhereAction: false,
    }
  }

  return {
    shouldRender: true,
    title: UNSUPPORTED_LOCATION_TITLE,
    body: UNSUPPORTED_LOCATION_BODY,
    universalItems,
    showTryAnywhereAction: universalItems.length > 0,
  }
}
