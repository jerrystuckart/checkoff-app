// What's Good V1 — lightweight client-side session persistence for the
// currently-displayed 3-item recommendation set. Uses this app's existing
// AsyncStorage convention directly (see lib/ThemeContext.js,
// lib/useOnboarding.js, lib/trackEvent.js) — no new storage abstraction.
//
// IMPLEMENTATION DEFAULT, NOT A PRODUCT DECISION: BACKGROUND_PRESERVE_MS_DEFAULT
// below is a conservative starting value for "how long counts as a short
// interruption." The exact threshold was explicitly left unrecorded as a
// product decision (see Decision Area 5, still JERRY_DECISION, in
// docs/whats-good-widget/product-discovery.md) — centralized here as one
// named constant specifically so it's easy to tune later without touching
// call sites.

import { haversineMeters } from './distance.js'
import { MAX_NEARBY_RADIUS_M } from './nearbyRanking.js'

const STORAGE_KEY = 'whats_good_session_v1'

/** IMPLEMENTATION DEFAULT — 5 minutes. Not a recorded product decision. */
export const BACKGROUND_PRESERVE_MS_DEFAULT = 5 * 60 * 1000

async function resolveStorage(storage) {
  if (storage) return storage
  const mod = await import('@react-native-async-storage/async-storage')
  return mod.default
}

/**
 * @param {{itemIds: string[], generatedAt: Date, fingerprint: string, location: {latitude: number, longitude: number}|null, resolvedMetroId?: string|null}} session
 * @param {object} [storage]  Injected storage (getItem/setItem); defaults to AsyncStorage.
 */
export async function saveWhatsGoodSession(session, storage) {
  const activeStorage = await resolveStorage(storage)
  const payload = JSON.stringify({
    itemIds: session.itemIds,
    generatedAt: session.generatedAt.toISOString(),
    fingerprint: session.fingerprint,
    location: session.location,
    // 2026-09-21 follow-up field bug fix — see shouldPreserveSession's rule 0
    // below: the resolved metro identity at the moment this session was
    // generated (e.g. lib/metroSelection.js's nearestMetroWithinBoundary()
    // result id), so a later cache-compatibility check can compare metro
    // IDENTITY, not merely raw GPS distance.
    resolvedMetroId: session.resolvedMetroId ?? null,
  })
  await activeStorage.setItem(STORAGE_KEY, payload)
}

/**
 * @param {object} [storage]
 * @returns {Promise<{itemIds: string[], generatedAt: Date, fingerprint: string|null, location: object|null, resolvedMetroId: string|null}|null>}
 *   null for missing OR corrupt/malformed cached state — this function
 *   never throws for bad cache content, it just treats it as "no cache."
 */
export async function loadWhatsGoodSession(storage) {
  const activeStorage = await resolveStorage(storage)
  let raw
  try {
    raw = await activeStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.itemIds) || typeof parsed.generatedAt !== 'string') return null
    const generatedAt = new Date(parsed.generatedAt)
    if (Number.isNaN(generatedAt.getTime())) return null
    return {
      itemIds: parsed.itemIds,
      generatedAt,
      fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : null,
      location: parsed.location ?? null,
      resolvedMetroId: typeof parsed.resolvedMetroId === 'string' ? parsed.resolvedMetroId : null,
    }
  } catch {
    return null // malformed JSON -> no cache, never throw
  }
}

/**
 * Pure decision function: should the cached session be kept as-is (true),
 * or is a fresh selection allowed (false)? Never mutates its inputs.
 *
 * Priority, per the approved behavior:
 *   0. FIX (2026-09-21 field bug, part 1): a session generated in a
 *      MATERIALLY different physical location (e.g. Vienna) is never
 *      preserved once the device has genuinely traveled somewhere far away
 *      (e.g. Munich), no matter how recently it was generated. Without this
 *      check, rule 1 below ("short interruption always preserves, regardless
 *      of context") was unconditional — it compared only elapsed time, never
 *      location — so a session saved right before a flight/drive, or one
 *      left over from a prior test/city session, kept being served for up
 *      to backgroundPreserveMs after a cold relaunch or foreground-return
 *      in the new city (a relaunch itself easily happens within that
 *      window). Reuses the same MAX_NEARBY_RADIUS_M "no longer in the
 *      nearby universe" cutoff Nearby already enforces (lib/nearbyRanking.js,
 *      read-only reference — untouched by this fix): anything beyond that
 *      is unambiguously a different physical context, not GPS jitter.
 *
 *      FIX (2026-09-21 field bug, part 2 — follow-up): part 1 above only
 *      fires when BOTH the cached session and the current call carry a
 *      location; a session with NO recorded location fell through to rule 1
 *      untouched, meaning it was still trusted-by-default for up to
 *      backgroundPreserveMs purely because it was recent — exactly the gap
 *      that let a Vienna session (Strudlhofstiege) keep surviving on a real
 *      device after landing in Munich. Per this fix, whenever the CALLER
 *      supplies a `currentLocation` (i.e. it actually knows where the device
 *      is right now), a cached session with no usable stored location is no
 *      longer assumed compatible — it is treated as INCOMPATIBLE and a fresh
 *      selection is required, regardless of age. A caller that omits
 *      `currentLocation` entirely (e.g. a location-agnostic call site, or
 *      legacy test coverage) is unaffected — this rule is opt-in by what the
 *      caller actually knows, never a trap for a caller that never claimed
 *      to check location.
 *
 *      FIX (2026-09-21 field bug, part 3 — resolved metro identity): raw
 *      lat/lng distance alone is a display-radius heuristic, not proof the
 *      device is in the same served metro — two metros could in principle
 *      sit within MAX_NEARBY_RADIUS_M of each other's edges, or a session's
 *      stored coordinates could be stale/imprecise in a way that still
 *      passes the raw-distance check. When the caller supplies
 *      `currentMetroId` (the CURRENT authoritative resolved metro — see
 *      lib/metroSelection.js's nearestMetroWithinBoundary()/resolveHomeMetro(),
 *      read-only references, reused not reimplemented), the cached session's
 *      own `resolvedMetroId` must be present AND equal to it. A session
 *      missing `resolvedMetroId` (never resolved, or cached before this
 *      field existed) is INCOMPATIBLE, same as a missing location. As with
 *      part 2, this is opt-in: a caller that omits `currentMetroId` skips
 *      this check entirely (no regression for callers that don't have a
 *      resolved metro handy).
 *   1. A short interruption (age <= backgroundPreserveMs) ALWAYS preserves
 *      the displayed 3, regardless of context — this is the unconditional
 *      stability guarantee ("short background -> foreground preserves the
 *      displayed 3") — but only once rule 0 above has already found the
 *      cache geographically compatible (or the caller opted out of that
 *      check by not supplying currentLocation/currentMetroId).
 *   2. Beyond that window, the cached set is preserved only if the current
 *      context fingerprint still matches the one it was generated from —
 *      otherwise a fresh selection is ALLOWED (not forced; a fresh
 *      selection may still land on largely the same items, since exposure
 *      rotation is itself gradual).
 *
 * @param {{itemIds: string[], generatedAt: Date, fingerprint: string|null, location?: {latitude:number, longitude:number}|null, resolvedMetroId?: string|null}|null} session
 * @param {{now: Date, currentFingerprint: string|null, currentLocation?: {latitude:number, longitude:number}|null, currentMetroId?: string|null, backgroundPreserveMs?: number}} options
 * @returns {boolean}
 */
export function shouldPreserveSession(session, { now, currentFingerprint, currentLocation = null, currentMetroId = null, backgroundPreserveMs = BACKGROUND_PRESERVE_MS_DEFAULT }) {
  if (!session) return false

  if (currentLocation && typeof currentLocation.latitude === 'number' && typeof currentLocation.longitude === 'number') {
    const sessionHasUsableLocation =
      session.location != null &&
      typeof session.location.latitude === 'number' && typeof session.location.longitude === 'number'

    // Part 2: the caller knows where the device is right now, but the
    // cache doesn't record where IT was generated — can't be verified as
    // compatible, so it isn't assumed to be. See the module doc above.
    if (!sessionHasUsableLocation) return false

    // Part 1 (original a900be1 fix): verified locations exist on both
    // sides — reject anything beyond the shared "nearby universe" radius.
    const movedM = haversineMeters(
      session.location.latitude, session.location.longitude,
      currentLocation.latitude, currentLocation.longitude
    )
    if (movedM > MAX_NEARBY_RADIUS_M) return false

    // Part 3: resolved metro IDENTITY, independent of the raw-distance
    // check above — only enforced when the caller actually supplies it.
    if (currentMetroId != null) {
      if (session.resolvedMetroId == null) return false
      if (session.resolvedMetroId !== currentMetroId) return false
    }
  }

  const ageMs = now.getTime() - session.generatedAt.getTime()
  if (ageMs >= 0 && ageMs <= backgroundPreserveMs) return true

  return session.fingerprint != null && currentFingerprint != null && session.fingerprint === currentFingerprint
}

export async function clearWhatsGoodSession(storage) {
  const activeStorage = await resolveStorage(storage)
  await activeStorage.removeItem(STORAGE_KEY)
}
