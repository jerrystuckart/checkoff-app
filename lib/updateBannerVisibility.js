// OTA Update Restart Banner (2026-09-20) — pure, React-free decision logic
// for whether the "CheckOff just got better" restart banner should be
// visible right now. Mirrors this repo's established hook-owns-policy /
// lib-stays-pure split (see lib/useCoverCandidateCTA.js +
// lib/coverCandidateEligibility.js, lib/savedItemsState.js): the component
// (components/UpdateRestartBanner.jsx) owns React state (Updates.useUpdates(),
// AppState, navigation route tracking) and calls Updates.reloadAsync(); this
// module owns the actual show/hide decision and the unsafe-route rule so
// both can be unit tested with plain node:test, no RN render harness needed.
//
// Nothing in this file imports React, react-navigation, or expo-updates.

// Route names that represent a mid-flow-destructive workflow where an
// unexpected JS reload (Updates.reloadAsync() unmounts and remounts the
// whole app) could silently lose unsaved user work. Chosen per the task's
// explicit examples — "completing a check-off, uploading/selecting a
// photo, editing/submitting a form, entering an invite code, creating/
// editing a list" — matched against this app's ACTUAL Stack.Screen name=
// values in App.jsx:
//
//   - PhotoCheckIn            — in-progress photo capture/upload for a check-off
//   - CoverCandidateCapture   — in-progress photo capture for a cover-photo submission
//   - CreateList               — list-creation form (multi-step, unsaved state)
//   - JoinList                 — invite-code entry form
//   - ListSummary               — the check-off completion/submission flow's summary step
//
// Deliberately EXCLUDED: ItemDetail. Check It Off is reachable from
// ItemDetail, but most time spent on that screen has no unsaved work in
// flight — the screen itself is a browsing/reading surface, not a form.
// Tapping "Restart now" is the user's own explicit choice; a stray,
// not-yet-started Check It Off tap on ItemDetail isn't "in flight" the way
// an open camera roll picker or a half-filled invite-code field is. If a
// future pass adds a cleanly-detectable "submission actively in flight"
// state to ItemDetail, that should gate the banner instead of a blanket
// route exclusion.
export const UNSAFE_UPDATE_BANNER_ROUTES = [
  'PhotoCheckIn',
  'CoverCandidateCapture',
  'CreateList',
  'JoinList',
  'ListSummary',
]

/**
 * @param {string|null|undefined} routeName
 * @returns {boolean} true if the update banner must stay hidden/deferred
 *   while this route is the active screen.
 */
export function isUnsafeRouteForUpdateBanner(routeName) {
  if (!routeName) return false
  return UNSAFE_UPDATE_BANNER_ROUTES.includes(routeName)
}

/**
 * Decides whether the OTA update-restart banner should be visible.
 *
 * @param {object} params
 * @param {boolean} params.isUpdatePending  true once expo-updates has
 *   fully downloaded a new update and it's ready to apply on reload
 *   (Updates.useUpdates()'s isUpdatePending).
 * @param {string|null|undefined} params.currentRouteName  the active
 *   React Navigation route name, or null/undefined if not yet known.
 * @param {boolean} params.dismissed  whether the user has tapped "Later"
 *   for the CURRENTLY pending update (session-scoped; see
 *   components/UpdateRestartBanner.jsx for how this is (re)armed when a
 *   newer update becomes pending).
 * @returns {boolean}
 */
export function shouldShowUpdateBanner({ isUpdatePending, currentRouteName, dismissed }) {
  if (!isUpdatePending) return false
  if (dismissed) return false
  if (isUnsafeRouteForUpdateBanner(currentRouteName)) return false
  return true
}
