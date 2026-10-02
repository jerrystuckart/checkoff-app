// Explicit browsing-context intent set by a link (email, shared link) that names a metro, an item or a list.
//
// Precedence for "which metro is Home showing":
//   1. an explicit link intent (this module)            newest explicit action wins
//   2. a manual Switch City choice (HomeScreen.switchMetro clears this intent, so it wins if it is newer)
//   3. the persisted choice (AsyncStorage checkoff_selected_metro_slug)
//   4. current location / nearest metro
//   5. needs_selection (the city picker prompt)
// Current physical location never overrides an explicit link intent.
//
// The intent is IN MEMORY ONLY and TEMPORARY. It is not written to AsyncStorage, so a link never redefines the
// persisted choice: the next cold start resolves exactly as it did before the link.
//
// iOS keeps the JS process alive across backgrounding (even across a flight), so "in memory" alone is not
// "temporary". The intent therefore also expires (see evaluateExplicitMetroIntent):
//   - on resume from background once it is older than EXPLICIT_METRO_INTENT_MAX_AGE_MS, and
//   - on any fresh location that is more than EXPLICIT_METRO_INTENT_MAX_TRAVEL_M from where the intent was
//     set (the user has physically gone somewhere else).
// It never expires by timer while the app stays in the foreground, so a user browsing a linked metro is not
// flipped mid read, and an exact item or list link is never overridden while it is being opened.
//
// Pure JS (no React Native), so it loads under plain `node --test`.

import { haversineMeters } from './distance.js'

/** A link intent older than this is dropped when the app resumes from background. */
export const EXPLICIT_METRO_INTENT_MAX_AGE_MS = 60 * 60 * 1000
/** A fresh fix this far from where the intent was set means the user has travelled: drop the intent. */
export const EXPLICIT_METRO_INTENT_MAX_TRAVEL_M = 50 * 1000

let current = null
const listeners = new Set()

function notify() {
  for (const fn of [...listeners]) {
    try { fn(current) } catch { /* a bad listener must not break navigation */ }
  }
}

export function setExplicitMetro(metro, source = 'link', now = Date.now()) {
  if (!metro || !(metro.id || metro.slug)) return null
  // origin: where the device was when the link was opened. Filled in by stampExplicitMetroOrigin the first
  // time Home sees a location after the link, so travel can be measured against it.
  const next = { id: metro.id ?? null, slug: metro.slug ? String(metro.slug).toLowerCase() : null, name: metro.name ?? null, source, at: now, origin: null }
  const same = current && current.id === next.id && current.slug === next.slug
  current = next
  if (!same) notify()
  else notify() // re-notify so a screen that mounted after the first set still applies it
  return current
}

export function getExplicitMetro() {
  return current
}

// Records where the device was when the current intent was set (first location seen after the link). No-op
// when there is no intent, it already has an origin, or the location is unusable.
export function stampExplicitMetroOrigin(location) {
  if (!current || current.origin) return
  if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') return
  current = { ...current, origin: { latitude: location.latitude, longitude: location.longitude } }
}

/**
 * Pure expiry rule. `resumed` is true only when evaluating on a background to foreground transition (or a
 * cold init), the only moment age alone may drop the intent.
 * @returns {{active: boolean, reason: string}}
 */
export function evaluateExplicitMetroIntent(intent, { now = Date.now(), location = null, resumed = false } = {}) {
  if (!intent) return { active: false, reason: 'none' }
  if (resumed && now - intent.at >= EXPLICIT_METRO_INTENT_MAX_AGE_MS) return { active: false, reason: 'expired-age' }
  if (intent.origin && location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
    const movedM = haversineMeters(intent.origin.latitude, intent.origin.longitude, location.latitude, location.longitude)
    if (movedM > EXPLICIT_METRO_INTENT_MAX_TRAVEL_M) return { active: false, reason: 'expired-travel' }
  }
  return { active: true, reason: 'active' }
}

// Exact item / list links only retarget Home for the flow they open. When Home regains focus after that flow
// (it was left after the intent was set), the intent is no longer needed. A metro link stays (it is a browsing
// request) until it expires.
export function shouldClearExactLinkIntent(intent, { previousFocusAt = 0, lastBlurAt = 0 } = {}) {
  if (!intent) return false
  if (intent.source !== 'item_link' && intent.source !== 'list_link') return false
  return intent.at > previousFocusAt || (lastBlurAt > 0 && lastBlurAt >= intent.at - 2000)
}

// The intent if it is still valid, else null (and the singleton is cleared so subscribers re-resolve).
export function getActiveExplicitMetro(opts = {}) {
  if (!current) return null
  const verdict = evaluateExplicitMetroIntent(current, opts)
  if (verdict.active) return current
  clearExplicitMetro(verdict.reason)
  return null
}

export function clearExplicitMetro(reason = 'manual') {
  if (!current) return
  current = null
  notify(reason)
}

export function subscribeExplicitMetro(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Find the metro (from a list of active metros) an intent refers to.
export function metroForIntent(intent, metros) {
  if (!intent) return null
  const list = metros ?? []
  return list.find((m) => intent.id && m.id === intent.id)
    ?? list.find((m) => intent.slug && (m.slug ?? '').toLowerCase() === intent.slug)
    ?? null
}

// Test helper only.
export function __resetExplicitMetroForTests() {
  current = null
  listeners.clear()
}
