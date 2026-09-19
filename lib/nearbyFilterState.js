// Nearby Redesign (2026-09-19) — pure filter-combination and
// clear-filter state logic for the redesigned Nearby (DiscoverScreen.jsx)
// screen. No React, no Supabase — see lib/tagSelection.js / lib/
// savedItemsState.js for the established precedent of keeping this class
// of decision logic React-free and directly node:test-able.
//
// Filter independence (explicit product requirement): search text,
// category, Saved, and Not Done are four INDEPENDENT dimensions.
// Clearing one must never silently reset another. This fixes a real
// existing bug: the previous clearSearch() in DiscoverScreen.jsx reset
// activeCategoryName back to 'All' as a side effect of clearing search
// text — this module's clearSearchState() explicitly does NOT touch
// category (or Saved/Not Done), and clearCategoryState() explicitly does
// NOT touch search text/tags/Saved/Not Done.

/**
 * computeVisibleNearbyItems({ items, savedOnly, notDoneOnly, savedItemIds, completedItemIds })
 *
 * Applies the Saved and Not Done filters as an AND — both are
 * independent boolean gates over whatever base item list category/search
 * has already produced (that base-list logic is unchanged, still lives in
 * DiscoverScreen.jsx's existing displayItems useMemo). This function is
 * ONLY the Saved/Not-Done gate, added fresh in this pass.
 *
 * "Not Done" hides a completed item only when explicitly selected —
 * completed items remain visible (de-emphasized in the UI, not filtered)
 * by default, i.e. when notDoneOnly is false.
 *
 * @param {object} params
 * @param {Array<{id: string|number}>} params.items
 * @param {boolean} params.savedOnly
 * @param {boolean} params.notDoneOnly
 * @param {Set<string|number>} params.savedItemIds
 * @param {Set<string|number>} params.completedItemIds
 * @returns {Array}
 */
export function computeVisibleNearbyItems({ items, savedOnly, notDoneOnly, savedItemIds, completedItemIds }) {
  const saved = savedItemIds ?? new Set()
  const completed = completedItemIds ?? new Set()
  return (items ?? []).filter(item => {
    if (item == null) return false
    if (savedOnly && !saved.has(item.id)) return false
    if (notDoneOnly && completed.has(item.id)) return false
    return true
  })
}

/**
 * clearSearchState()
 *
 * Returns the partial state update for "clear search" — search text,
 * suggestions, active tag chips, and any tag-driven result set. Does NOT
 * include activeCategoryName, savedOnly, or notDoneOnly — callers must
 * not reset those from this update.
 *
 * @returns {{ searchText: string, suggestions: Array, activeTags: Array, tagResultItems: null, tagMatchData: { counts: {} } }}
 */
export function clearSearchState() {
  return {
    searchText: '',
    suggestions: [],
    activeTags: [],
    tagResultItems: null,
    tagMatchData: { counts: {} },
  }
}

/**
 * clearCategoryState()
 *
 * Returns the partial state update for "clear category" — resets only
 * activeCategoryName back to 'All'. Does NOT include searchText,
 * suggestions, activeTags, tagResultItems, savedOnly, or notDoneOnly.
 *
 * @returns {{ activeCategoryName: string }}
 */
export function clearCategoryState() {
  return { activeCategoryName: 'All' }
}

/**
 * isAllFilterActive({ savedOnly, notDoneOnly, activeCategoryName })
 *
 * "All" (the filter-row pill) refers specifically to the Saved/Not-Done/
 * category dimension — it is the deterministic state where none of the
 * three are active. It is NOT a global reset button: search text/tags may
 * still be independently active while "All" reads as selected.
 *
 * @returns {boolean}
 */
export function isAllFilterActive({ savedOnly, notDoneOnly, activeCategoryName }) {
  return !savedOnly && !notDoneOnly && (!activeCategoryName || activeCategoryName === 'All')
}

/**
 * applyAllFilter()
 *
 * The "All" pill's own tap handler — returns the partial state update
 * that clears just the Saved/Not-Done/category dimension, per
 * isAllFilterActive's definition. Search text/tags are untouched.
 *
 * @returns {{ savedOnly: boolean, notDoneOnly: boolean, activeCategoryName: string }}
 */
export function applyAllFilter() {
  return { savedOnly: false, notDoneOnly: false, activeCategoryName: 'All' }
}
