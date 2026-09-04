// HomeScreen 2026 Redesign — pure row selection for the compact Near You
// utility. Distance-first, not a recommendation set: takes whatever the
// existing proximitySort-based rail already produced (unchanged ranking)
// and exposes only the closest few for the compact Home treatment. The
// Nearby tab remains the full browse destination for the rest.

/** IMPLEMENTATION DEFAULT, not a product decision — 3 visible rows keeps the compact block short while still reading as "closest things," not a recommendation carousel. */
export const NEAR_YOU_COMPACT_ROW_COUNT = 3

/**
 * FINAL UI PASS BEFORE BUILD 144 — item 6: when the current item is
 * already showing as the What's the Thing hero, showing it AGAIN as the
 * first Near You row read as a bug ("current item in hero, same current
 * item again, 2 more nearby") rather than 4 distinct ideas. Excludes only
 * the exact item id — deliberately does NOT drop other items at the same
 * venue (a genuinely different CheckOff item there should still surface).
 * Filtering happens BEFORE the slice so excluding the top match still
 * yields a full `maxRows` of *other* nearby items, not one fewer.
 *
 * @param {Array} nearbyRailItems  already-sorted-by-proximity items (same array Home Rail already computes)
 * @param {number} [maxRows]
 * @param {string|null} [excludeItemId]  the active What's the Thing hero item's id, if any
 * @returns {Array}
 */
export function selectNearYouCompactRows(nearbyRailItems, maxRows = NEAR_YOU_COMPACT_ROW_COUNT, excludeItemId = null) {
  const items = nearbyRailItems ?? []
  const filtered = excludeItemId ? items.filter(item => item?.id !== excludeItemId) : items
  return filtered.slice(0, maxRows)
}
