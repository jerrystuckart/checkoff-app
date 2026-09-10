/**
 * Pure state-transition logic for Discover's tag-chip selection —
 * extracted from screens/DiscoverScreen.jsx's selectTag()/removeTag() so
 * these transitions have no access to React state setters at all.
 *
 * This exists because of a real production crash: an earlier refactor
 * removed the `bodyMatchIds` state entirely, but one call site inside
 * selectTag() — `setBodyMatchIds(null)` — was missed. Since the setter no
 * longer existed, tapping any suggested tag chip threw a ReferenceError
 * immediately (Hermes: "Property 'setBodyMatchIds' doesn't exist"),
 * crashing the app on every tag-chip tap. Nothing caught it because the
 * dead reference only executes at tap-time, not at parse/type-check time,
 * and no test exercised the tag-selection path at all.
 *
 * Pulling the actual state-shape logic here — with zero setState calls,
 * zero imports of anything React/RN — makes this class of bug structurally
 * impossible in this function (there's no setter to accidentally call) and
 * makes the transition itself directly unit-testable without a component
 * render harness (this project doesn't have one for RN screens).
 */

/**
 * applySelectTag(activeTags, tag)
 *
 * `tag` is a full {id, name} object (from tag-name search or post-checkin
 * lookup) — never just an id or name string; every call site in
 * DiscoverScreen already passes the full object.
 *
 * @returns {{ activeTags: Array, changed: boolean, clearSuggestions?: boolean, clearSearchText?: boolean }}
 *   `changed` is false (activeTags returned unmodified) when the tag is
 *   already selected — selecting it again is a no-op, not an error.
 */
export function applySelectTag(activeTags, tag) {
  if (activeTags.some(t => t.id === tag.id)) {
    return { activeTags, changed: false }
  }
  return {
    activeTags: [...activeTags, tag],
    changed: true,
    clearSuggestions: true,
    clearSearchText: true,
  }
}

/**
 * applyRemoveTag(activeTags, tagId)
 *
 * @returns {{ activeTags: Array, shouldClearResults: boolean }}
 *   `shouldClearResults` is true when removing this tag leaves zero active
 *   tags — the caller should reset tagResultItems/tagMatchData to the
 *   "use nearbyItems" state rather than re-fetching an empty tag list.
 */
export function applyRemoveTag(activeTags, tagId) {
  const nextActiveTags = activeTags.filter(t => t.id !== tagId)
  return {
    activeTags: nextActiveTags,
    shouldClearResults: nextActiveTags.length === 0,
  }
}
