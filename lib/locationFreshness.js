/**
 * Pure, dependency-free location-freshness state machine — no React,
 * React Native, or Expo imports, so it can be unit-tested directly (the
 * project convention: pure decision logic lives here, the real device I/O
 * wrapper lives in lib/currentLocation.js — mirrors notifyEligibility.js /
 * visitEligibility.js already doing the same split for other features).
 *
 * The rule this encodes: refresh the actual device location first, then
 * everything that depends on it recomputes from the new value — this
 * module owns exactly the "when do we actually hit GPS" decision and the
 * "never erase a known-good fix on failure" guarantee.
 */

// One shared threshold for the whole app — see lib/currentLocation.js's
// module docstring for why this isn't duplicated per-feature.
export const LOCATION_STALE_AFTER_MS = 5 * 60 * 1000

export function isLocationStale(lastFetchedAtMs, nowMs = Date.now()) {
  if (lastFetchedAtMs == null) return true
  return nowMs - lastFetchedAtMs >= LOCATION_STALE_AFTER_MS
}

/**
 * createLocationStore({ initialState })
 *
 * Returns an independent store instance — lib/currentLocation.js creates
 * exactly one of these as the app-wide singleton, but tests create their
 * own so runs never share state.
 *
 * requestFreshLocation({ force, deviceFetch, now }):
 *   - force=false only calls `deviceFetch` if the current fix is stale (or
 *     there has never been one) — otherwise returns the cached snapshot
 *     immediately, no device call at all.
 *   - force=true always calls `deviceFetch`.
 *   - Concurrent calls (any mix of force/non-force) collapse into a single
 *     in-flight `deviceFetch` — never issues two device requests at once.
 *   - `deviceFetch` must resolve to `{latitude, longitude}` or `null`
 *     (or throw) — a null/failed fetch NEVER erases the previous
 *     known-good coords; the store simply keeps what it had.
 */
export function createLocationStore({ initialState } = {}) {
  let state = initialState ?? { coords: null, lastFetchedAt: null }
  let inFlight = null
  const listeners = new Set()

  function notify() {
    listeners.forEach(fn => fn(state))
  }

  function getSnapshot() {
    return state
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  // recordLocation(coords) — for a continuous foreground watcher pushing
  // live updates (each tick already IS a fresh device fix, so there's no
  // staleness gate or dedupe to apply here, unlike requestFreshLocation).
  // A falsy/missing coords is a no-op — same fail-safe rule: never erase a
  // known-good location.
  function recordLocation(coords) {
    if (!coords) return
    state = { coords, lastFetchedAt: Date.now() }
    notify()
  }

  async function requestFreshLocation({ force = false, deviceFetch, now = Date.now() } = {}) {
    if (!force && !isLocationStale(state.lastFetchedAt, now)) {
      return state
    }
    if (inFlight) return inFlight

    inFlight = (async () => {
      try {
        let coords = null
        try {
          coords = deviceFetch ? await deviceFetch() : null
        } catch {
          coords = null // fetch failure treated the same as "no fix" — fail safe, never throws out
        }
        if (coords) {
          state = { coords, lastFetchedAt: Date.now() }
          notify()
        }
        return state
      } finally {
        inFlight = null
      }
    })()

    return inFlight
  }

  return { getSnapshot, subscribe, requestFreshLocation, recordLocation }
}
