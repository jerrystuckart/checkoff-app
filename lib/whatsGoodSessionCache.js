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
import { deriveCoverageMode } from './whatsGoodCoverageMode.js'

const STORAGE_KEY = 'whats_good_session_v1'

// 2026-09-22 coverage-mode policy fix — bumped from the implicit "no
// version at all" prior shape. A cached session missing this exact value
// (undefined, or any older number) is treated as an old-shaped cache and is
// never trusted, regardless of how recently it was written — see
// shouldPreserveSession's schema check below. This is a SCHEMA version for
// the cache's own stored shape, independent of
// lib/whatsGoodOrchestrator.js's `latestRequestGeneration` counter, which
// guards a completely different concern (in-flight async request
// ordering, not stored-cache shape compatibility).
const CURRENT_SESSION_SCHEMA_VERSION = 2

/** IMPLEMENTATION DEFAULT — 5 minutes. Not a recorded product decision. */
export const BACKGROUND_PRESERVE_MS_DEFAULT = 5 * 60 * 1000

async function resolveStorage(storage) {
  if (storage) return storage
  const mod = await import('@react-native-async-storage/async-storage')
  return mod.default
}

/**
 * @param {{itemIds: string[], generatedAt: Date, fingerprint: string, location: {latitude: number, longitude: number}|null, resolvedMetroId?: string|null, coverageMode?: string|null}} session
 * @param {object} [storage]  Injected storage (getItem/setItem); defaults to AsyncStorage.
 */
export async function saveWhatsGoodSession(session, storage) {
  const activeStorage = await resolveStorage(storage)
  const payload = JSON.stringify({
    schemaVersion: CURRENT_SESSION_SCHEMA_VERSION,
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
    // 2026-09-22 coverage-mode policy fix — the coverage mode this session
    // was generated under (see lib/whatsGoodCoverageMode.js's COVERAGE_MODE),
    // so a later cache-compatibility check can tell whether that mode can
    // still apply given the CURRENT context (see shouldPreserveSession
    // below) rather than blindly replaying a stale composition (e.g. a
    // SUPPORTED_SPARSE session's Universal filler after enough local
    // inventory has since appeared).
    coverageMode: session.coverageMode ?? null,
  })
  await activeStorage.setItem(STORAGE_KEY, payload)
}

/**
 * @param {object} [storage]
 * @returns {Promise<{itemIds: string[], generatedAt: Date, fingerprint: string|null, location: object|null, resolvedMetroId: string|null, coverageMode: string|null, schemaVersion: number|null}|null>}
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
      // Missing/older on an old-shaped cache (pre-this-fix) -> null, which
      // shouldPreserveSession's schema check below always rejects.
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : null,
      itemIds: parsed.itemIds,
      generatedAt,
      fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : null,
      location: parsed.location ?? null,
      resolvedMetroId: typeof parsed.resolvedMetroId === 'string' ? parsed.resolvedMetroId : null,
      coverageMode: typeof parsed.coverageMode === 'string' ? parsed.coverageMode : null,
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
 *
 *   2026-09-22 coverage-mode policy fix, part 4 (schema check): a session
 *   cached before this fix (or otherwise missing `schemaVersion`/
 *   `coverageMode`) is an OLD-SHAPED cache and is never trusted, regardless
 *   of age or location match — it was generated under the pre-fix absolute
 *   "never Universal" policy and cannot be known to be coverage-mode
 *   compatible with the current, mode-aware policy. Checked unconditionally
 *   (not gated on the caller supplying currentLocation/currentMetroId,
 *   unlike parts 2/3 above — a schema mismatch is a hygiene concern
 *   independent of geography).
 *
 *   2026-09-22 coverage-mode policy fix, part 5 (drift check): even when
 *   the cached session's location/metro are still compatible (parts 0-3
 *   above), its `coverageMode` may no longer be the CORRECT mode for the
 *   CURRENT eligible-local-count — e.g. a SUPPORTED_SPARSE session cached
 *   with 1 local item must be invalidated once a 2nd/3rd local item has
 *   since become available at the SAME location (the task's own example:
 *   "sparse-area cache after sufficient local inventory becomes available
 *   -> recompute"). This only runs when the caller supplies
 *   `currentEligibleLocalCount` and `targetCount` (both optional/opt-in,
 *   same pattern as parts 2/3 — a caller without a cheap fresh count handy
 *   simply skips this check; see lib/whatsGoodOrchestrator.js, which only
 *   pays for this recompute when the CACHED mode is SUPPORTED_SPARSE, the
 *   one mode whose correctness can silently drift without any location or
 *   metro change at all).
 *
 * @param {{itemIds: string[], generatedAt: Date, fingerprint: string|null, location?: {latitude:number, longitude:number}|null, resolvedMetroId?: string|null, coverageMode?: string|null, schemaVersion?: number|null}|null} session
 * @param {{now: Date, currentFingerprint: string|null, currentLocation?: {latitude:number, longitude:number}|null, currentMetroId?: string|null, backgroundPreserveMs?: number, currentEligibleLocalCount?: number|null, targetCount?: number|null}} options
 * @returns {boolean}
 */
export function shouldPreserveSession(session, {
  now,
  currentFingerprint,
  currentLocation = null,
  currentMetroId = null,
  backgroundPreserveMs = BACKGROUND_PRESERVE_MS_DEFAULT,
  currentEligibleLocalCount = null,
  targetCount = null,
}) {
  if (!session) return false

  // Part 4: old-shaped cache (pre-coverage-mode-fix, or otherwise missing
  // this schema's required fields) — never trusted. Unconditional, not
  // gated on currentLocation/currentMetroId being supplied.
  if (session.schemaVersion !== CURRENT_SESSION_SCHEMA_VERSION) return false
  if (session.coverageMode == null) return false

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

    // Part 5: coverage-mode drift check — only when the caller supplies a
    // fresh count to compare against. See module doc above.
    if (currentEligibleLocalCount != null && targetCount != null) {
      const freshMode = deriveCoverageMode({
        locationState: 'ready',
        eligibleLocalCount: currentEligibleLocalCount,
        targetCount,
        hasExplicitSelection: currentMetroId != null,
      })
      if (freshMode !== session.coverageMode) return false
    }
  }

  const ageMs = now.getTime() - session.generatedAt.getTime()
  if (ageMs >= 0 && ageMs <= backgroundPreserveMs) return true

  return session.fingerprint != null && currentFingerprint != null && session.fingerprint === currentFingerprint
}

/**
 * ADMIN DIAGNOSTICS PANEL (Phase 1, 2026-09-23) — a pure, read-only mirror
 * of shouldPreserveSession's exact same priority-ordered checks, but
 * returning WHY rather than just true/false. This function is NEVER called
 * from the hot decision path — shouldPreserveSession above remains the only
 * thing that actually gates cache-preservation behavior, unmodified and
 * byte-identical to before this addition. This function exists solely so
 * the admin-only diagnostics panel (components/home/UnsupportedLocationCard.jsx,
 * threaded through lib/whatsGoodOrchestrator.js's `debug` object) can show a
 * human-readable reason for the last cache decision, computed ALONGSIDE the
 * real call by the orchestrator, never in place of it.
 *
 * Any change to shouldPreserveSession's rules must be mirrored here too, or
 * this function's reason strings will drift from the real decision — see
 * this file's test suite, which exercises both functions in parallel for
 * every rule to catch that drift.
 *
 * @param {Parameters<typeof shouldPreserveSession>[0]} session
 * @param {Parameters<typeof shouldPreserveSession>[1]} options
 * @returns {{preserved: boolean, reason: string}}  `reason` is one of:
 *   'no-cached-session', 'schema-version-mismatch',
 *   'location-unknown-recompute', 'location-moved-beyond-radius',
 *   'metro-mismatch', 'coverage-mode-drift', 'preserved-short-interruption',
 *   'preserved-fingerprint-match', 'fingerprint-mismatch-recompute'.
 */
export function describeSessionPreservationDecision(session, {
  now,
  currentFingerprint,
  currentLocation = null,
  currentMetroId = null,
  backgroundPreserveMs = BACKGROUND_PRESERVE_MS_DEFAULT,
  currentEligibleLocalCount = null,
  targetCount = null,
}) {
  if (!session) return { preserved: false, reason: 'no-cached-session' }

  if (session.schemaVersion !== CURRENT_SESSION_SCHEMA_VERSION) {
    return { preserved: false, reason: 'schema-version-mismatch' }
  }
  if (session.coverageMode == null) {
    return { preserved: false, reason: 'schema-version-mismatch' }
  }

  if (currentLocation && typeof currentLocation.latitude === 'number' && typeof currentLocation.longitude === 'number') {
    const sessionHasUsableLocation =
      session.location != null &&
      typeof session.location.latitude === 'number' && typeof session.location.longitude === 'number'

    if (!sessionHasUsableLocation) {
      return { preserved: false, reason: 'location-unknown-recompute' }
    }

    const movedM = haversineMeters(
      session.location.latitude, session.location.longitude,
      currentLocation.latitude, currentLocation.longitude
    )
    if (movedM > MAX_NEARBY_RADIUS_M) {
      return { preserved: false, reason: 'location-moved-beyond-radius' }
    }

    if (currentMetroId != null) {
      if (session.resolvedMetroId == null || session.resolvedMetroId !== currentMetroId) {
        return { preserved: false, reason: 'metro-mismatch' }
      }
    }

    if (currentEligibleLocalCount != null && targetCount != null) {
      const freshMode = deriveCoverageMode({
        locationState: 'ready',
        eligibleLocalCount: currentEligibleLocalCount,
        targetCount,
        hasExplicitSelection: currentMetroId != null,
      })
      if (freshMode !== session.coverageMode) {
        return { preserved: false, reason: 'coverage-mode-drift' }
      }
    }
  }

  const ageMs = now.getTime() - session.generatedAt.getTime()
  if (ageMs >= 0 && ageMs <= backgroundPreserveMs) {
    return { preserved: true, reason: 'preserved-short-interruption' }
  }

  if (session.fingerprint != null && currentFingerprint != null && session.fingerprint === currentFingerprint) {
    return { preserved: true, reason: 'preserved-fingerprint-match' }
  }
  return { preserved: false, reason: 'fingerprint-mismatch-recompute' }
}

export async function clearWhatsGoodSession(storage) {
  const activeStorage = await resolveStorage(storage)
  await activeStorage.removeItem(STORAGE_KEY)
}
