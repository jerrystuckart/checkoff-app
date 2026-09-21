// OTA Update Restart Banner (2026-09-20) — pure, React-free "restart now"
// tap-handler logic, extracted so it's unit-testable with plain node:test
// (no RN render harness exists in this repo — see lib/savedItemsState.js's
// shouldStartToggle for the same in-flight-guard-as-pure-function idiom).
//
// components/UpdateRestartBanner.jsx owns the actual React state
// (useState for isReloading) and the real Updates.reloadAsync call; this
// module owns the guard/retry POLICY: never start a second reload while
// one is in flight, and always leave the app usable (reset the guard) if
// the reload attempt itself throws/rejects.

/**
 * @param {boolean} isReloading  current in-flight state
 * @returns {boolean} true if a new reload attempt should proceed
 */
export function shouldStartReload(isReloading) {
  return isReloading !== true
}

/**
 * Runs a "Restart now" tap through the in-flight guard.
 *
 * - If a reload is already in flight, this is a no-op (reloadFn is NOT
 *   called again) — satisfies "repeated taps are ignored."
 * - Otherwise calls reloadFn() exactly once. On success, isReloading is
 *   left true (the app is about to unmount/reload, so there's nothing
 *   useful to reset to).
 * - On failure (reloadFn throws or its returned promise rejects), the
 *   error is caught, isReloading is reset to false so the user can retry,
 *   and the app never crashes or shows an unhandled rejection.
 *
 * @param {object} params
 * @param {() => Promise<void>} params.reloadFn  e.g. Updates.reloadAsync
 * @param {boolean} params.isReloading  current in-flight state
 * @param {(next: boolean) => void} params.setIsReloading  React state setter
 * @returns {Promise<{ attempted: boolean, success?: boolean, error?: unknown }>}
 */
export async function attemptReload({ reloadFn, isReloading, setIsReloading }) {
  if (!shouldStartReload(isReloading)) {
    return { attempted: false }
  }

  setIsReloading(true)
  try {
    await reloadFn()
    return { attempted: true, success: true }
  } catch (error) {
    setIsReloading(false)
    return { attempted: true, success: false, error }
  }
}
