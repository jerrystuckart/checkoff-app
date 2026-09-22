// What's Good V1 / "What's the Thing" — the HomeScreen-facing hook.
//
// Location now comes from the shared lib/currentLocation.js store — the
// SAME location HomeScreen's own Near-You-rail userLocation and
// useNearby()'s Discover/Nearby both use. This hook previously owned an
// entirely independent location fetch + its own AppState foreground-
// refresh cooldown (a third competing GPS implementation, alongside Home
// Rail's and useNearby()'s own); that independence meant a real trip could
// leave What's Good showing a different (stale) location than Home Rail
// was already showing, and meant three separate GPS calls could fire on
// the same foreground transition. Centralizing here also means a Home
// pull-to-refresh (which force-refreshes the shared location) now updates
// What's the Thing too, with no extra wiring in this file.
//
// This is now the ONLY Home experience — it used to be gated behind the
// `whats_good_v1` feature flag (disabled globally, Jerry-only override),
// which meant it never rendered for a logged-out user (isFlagEnabled()
// short-circuits without a userId) and rarely rendered for an ordinary
// signed-in one either. The flag gate has been removed entirely so this
// hook is always active, for both authenticated and anonymous users; see
// screens/HomeScreen.jsx for the removal of the corresponding legacy
// top-of-Home branch. `userId` may be null (anonymous) — every downstream
// data call that requires a signed-in user (checkoff history, exposure
// tracking, momentum) degrades gracefully for anon rather than erroring;
// see lib/whatsGoodDataAdapter.js and lib/whatsGoodExposureWriter.js.

import { useEffect, useRef, useState } from 'react'
import { proximitySort } from './proximity.js'
import { isAtPlace } from './whatsGoodAtPlace.js'
import { computeContextFingerprint } from './whatsGoodContextFingerprint.js'
import { getWhatsGoodSelection } from './whatsGoodOrchestrator.js'
import { verifyNearbyForRender, findWhatsGoodContractViolations } from './whatsGoodDataAdapter.js'
import { COVERAGE_MODE, WHATS_GOOD_TARGET_COUNT } from './whatsGoodCoverageMode.js'
import { setCurrentAtPlaceItemId } from './atPlacePresenceTracker'
import { useCurrentLocation } from './currentLocation'

/** IMPLEMENTATION DEFAULT — how many nearest items feed the context fingerprint. */
const NEAREST_FINGERPRINT_COUNT = 15

/**
 * @param {object} params
 * @param {string|null} params.userId
 * @param {Array} params.rawNearbyItems  Already-loaded item pool from
 *   HomeScreen (same shape loadNearbyRail() already produces) — reused
 *   directly, never re-fetched here.
 * @param {string[]} params.homeRailItemIds  The current Home Rail 5 IDs.
 * @param {string|null} [params.currentMetroId]  The CURRENT authoritative
 *   resolved metro id, as HomeScreen.jsx already resolves and keeps in sync
 *   via lib/metroSelection.js's nearestMetroWithinBoundary() (read-only
 *   reference, reused not reimplemented here — and NOT a candidate-query
 *   filter: this hook still stays purely location/rail-driven, see the
 *   structural guard in lib/homeMetroResolutionMunichFix.test.js). This
 *   value is an opaque identity token passed straight through to the
 *   orchestrator's session-cache compatibility check ONLY (2026-09-21
 *   follow-up field fix — resolved metro identity, not merely raw GPS
 *   distance, decides whether a CACHED result may be reused; it never
 *   scopes or filters the candidate pool itself). Optional; a caller that
 *   omits it simply skips that extra cache-compatibility check.
 * @param {'pending'|'ready'|'unavailable'} [params.locationState]  2026-09-22
 *   coverage-mode policy fix. HomeScreen.jsx already computes this exact
 *   classification once per resolution (its own `locationState` local var,
 *   used to call lib/metroSelection.js's resolveHomeMetro()) — this hook
 *   reuses that same classification rather than re-deriving it, since
 *   lib/currentLocation.js (read-only, untouched by this fix) exposes only
 *   a coordinate-or-null snapshot, not a pending-vs-unavailable distinction.
 *   Optional; when omitted, this hook infers 'ready' if a location is
 *   already present or 'pending' otherwise — the same behavior this hook
 *   had before this fix (it simply never ran its selection effect without a
 *   location), just now expressed as an explicit, correctly-labeled
 *   coverage mode instead of an implicit no-op.
 * @param {{id: string, center_lat: number, center_lng: number}|null} [params.explicitMetroChoice]
 *   HomeScreen.jsx's own currently-resolved metro object (its 'explicit'
 *   persisted-choice state) — reused as-is, not a new concept. Only
 *   consulted when `locationState` is 'unavailable': its coordinates
 *   substitute for GPS so an explicitly-chosen city still gets its OWN
 *   supported/sparse/unsupported coverage mode (Step 4 mode 5) instead of
 *   an honest-but-avoidable empty state. Ignored in every other locationState.
 * @param {object} [params.navigation]  For focus-triggered refresh.
 * @returns {{
 *   enabled: boolean, loading: boolean, items: Array, atPlaceItem: object|null,
 *   debug: {
 *     userLocation: object|null,
 *     homeRailItemIds: string[],
 *     candidatePool: Array,
 *     selectedItemIds: string[],
 *     fromCache: boolean,
 *     fingerprintBefore: string|null,
 *     fingerprintAfter: string|null,
 *     atPlaceItemId: string|null,
 *   },
 * }}  `debug` is tester instrumentation only — see the "Morning Tester
 *   Enable" work. It is always computed (cheap; no extra queries); no
 *   caller currently renders it (the Home "Tester Debug" panel that used
 *   to display it, components/WhatsGoodDebugPanel.jsx, was removed) but
 *   the field is kept since it costs nothing to compute and nothing else
 *   depends on it being absent.
 */
export function useWhatsGood({ userId, rawNearbyItems, homeRailItemIds, currentMetroId = null, locationState: locationStateProp, explicitMetroChoice = null, navigation }) {
  const enabled = true
  const { location: gpsLocation, refreshLocation } = useCurrentLocation()

  // 2026-09-22 coverage-mode policy fix. See this hook's own JSDoc above
  // for why `locationStateProp` (not re-derived here) is the authoritative
  // classification when the caller supplies it. `hasExplicitSelection` and
  // `effectiveLocation` implement Step 4 mode 5: an 'unavailable' GPS fix
  // with a deliberately-selected city still gets evaluated against THAT
  // city's own coordinates, never fabricated content.
  const locationState = locationStateProp ?? (gpsLocation ? 'ready' : 'pending')
  const hasExplicitSelection =
    explicitMetroChoice != null &&
    typeof explicitMetroChoice.center_lat === 'number' &&
    typeof explicitMetroChoice.center_lng === 'number'
  const userLocation =
    locationState === 'ready'
      ? gpsLocation
      : locationState === 'unavailable' && hasExplicitSelection
        ? { latitude: explicitMetroChoice.center_lat, longitude: explicitMetroChoice.center_lng }
        : null

  const [selectedItems, setSelectedItems] = useState([])
  const [atPlaceItem, setAtPlaceItem] = useState(null)
  const [loading, setLoading] = useState(false)
  const [debugInfo, setDebugInfo] = useState({
    userLocation: null,
    homeRailItemIds: [],
    candidatePool: [],
    selectedItemIds: [],
    fromCache: false,
    fingerprintBefore: null,
    fingerprintAfter: null,
    atPlaceItemId: null,
  })

  const previousFingerprintRef = useRef(null)
  const homeRailKey = (homeRailItemIds ?? []).join(',') // stable primitive — avoids re-running effects on every new array reference

  // Clears the shared at-place presence signal on unmount so a stale
  // "still at-place" value never outlives this hook.
  useEffect(() => {
    return () => setCurrentAtPlaceItemId(null)
  }, [])

  // 1. Initial location fix (force:false — reuses a recent-enough fix
  // another screen already has). Always runs — no flag/userId gate — so an
  // anonymous user gets the same location-aware behavior as a signed-in one.
  useEffect(() => {
    refreshLocation(false)
  }, [refreshLocation])

  // 2. Navigation-focus refresh, respecting the same shared 5-minute
  // staleness policy as the app-wide foreground refresh — no separate
  // AppState listener/cooldown needed here anymore; lib/currentLocation.js
  // owns that centrally, and useCurrentLocation()'s subscription means this
  // hook picks up any resulting update (from Home's pull-to-refresh, the
  // foreground check, or this focus refresh) automatically.
  useEffect(() => {
    if (!enabled) return undefined
    const unsubscribeFocus = navigation?.addListener?.('focus', () => refreshLocation(false))
    return () => unsubscribeFocus?.()
  }, [enabled, refreshLocation, navigation])

  // 3. Derive nearest/at-place context from already-loaded items + the
  // location this hook owns, then run the orchestrator (which itself
  // decides whether the session cache makes recomputation unnecessary).
  useEffect(() => {
    if (!enabled) return undefined

    // PENDING_LOCATION, or LOCATION_UNAVAILABLE with no explicit selection
    // to fall back on (Step 4 modes 1 and 5) — `userLocation` above is
    // already null in both cases. Explicitly clear any previously-rendered
    // items rather than silently leaving stale content on screen (the
    // no-fabricated-content guarantee applies to a location that was LOST,
    // not just one that never resolved) — the orchestrator is never even
    // called, matching "PENDING_LOCATION: render NEITHER local nor
    // universal" / "LOCATION_UNAVAILABLE: no fabricated content."
    if (!userLocation) {
      setSelectedItems([])
      setAtPlaceItem(null)
      setCurrentAtPlaceItemId(null)
      setLoading(locationState === 'pending')
      return undefined
    }
    if (!rawNearbyItems?.length) return undefined

    const { items: sorted } = proximitySort(rawNearbyItems, userLocation, { includeUniversal: false, interleave: false })
    const nearestItemIds = sorted.slice(0, NEAREST_FINGERPRINT_COUNT).map((i) => i.id)
    const topItem = sorted[0] ?? null
    const atPlace = topItem && isAtPlace(topItem, userLocation) ? topItem : null
    setAtPlaceItem(atPlace)
    // Visit Reminder V1/V1.5 — lets useNotifications.js's foreground handler
    // suppress an at-place-related push/local reminder banner while this
    // exact card is already on screen. See lib/atPlacePresenceTracker.js.
    setCurrentAtPlaceItemId(atPlace?.id ?? null)

    const fingerprint = computeContextFingerprint({ nearestItemIds, atPlaceItemId: atPlace?.id ?? null })
    const fingerprintBefore = previousFingerprintRef.current
    const homeRailItemIdsArray = homeRailKey ? homeRailKey.split(',') : []

    let cancelled = false
    setLoading(true)
    getWhatsGoodSelection({
      userId,
      userLocation,
      currentMetroId,
      homeRailItemIds: homeRailItemIdsArray,
      allLocatedItems: rawNearbyItems,
      currentFingerprint: fingerprint,
      now: new Date(),
      locationState,
      hasExplicitSelection,
    })
      .then(({ itemIds, fromCache, debug, backupItemIds, coverageMode }) => {
        if (cancelled) return
        const effectiveCoverageMode = coverageMode ?? COVERAGE_MODE.SUPPORTED_SUFFICIENT
        const byId = new Map(rawNearbyItems.map((i) => [i.id, i]))

        const hydrated = []
        const unhydratableIds = []
        for (const id of itemIds) {
          const item = byId.get(id)
          if (item) hydrated.push(item)
          else unhydratableIds.push(id)
        }

        // Explicit report + deterministic refill, never a silent 3->2
        // degrade. Root cause of the original bug is fixed at the source
        // (lib/whatsGoodDataAdapter.js now applies the same season/bonus-
        // drop eligibility Home Rail's own pool does) — this is the
        // documented safety net for any OTHER reason hydration could fail
        // (e.g. an item deleted between selection and render).
        if (unhydratableIds.length > 0) {
          console.warn(
            `useWhatsGood: ${unhydratableIds.length} selected item(s) could not be hydrated from rawNearbyItems (${unhydratableIds.join(', ')}) — refilling deterministically from backupItemIds.`
          )
          for (const backupId of backupItemIds ?? []) {
            if (hydrated.length >= itemIds.length) break
            const backupItem = byId.get(backupId)
            if (backupItem && !hydrated.some((h) => h.id === backupId)) hydrated.push(backupItem)
          }
          if (hydrated.length < itemIds.length) {
            console.warn(`useWhatsGood: could not fully refill — showing ${hydrated.length} of ${itemIds.length} selected items.`)
          }
        }

        // FINAL, MODE-AWARE geographic/eligibility gate (2026-09-21
        // follow-up field bug fix; made context-aware 2026-09-22 — see
        // whatsGoodDataAdapter.js's verifyNearbyForRender() doc). Re-
        // verifies usable coordinates + current distance for every
        // hydrated LOCAL card independently of where its ID came from
        // (fresh candidate query, session cache, or a fallback-tier top-up),
        // and enforces which of local/Universal composition is even allowed
        // for the CURRENT coverage mode, so a bug anywhere upstream (a
        // stale cache slipping past shouldPreserveSession, a ranking step,
        // an over-eager fallback) can never put an out-of-radius local card,
        // an out-of-mode Universal card, or a distant-metro card on screen.
        const verified = verifyNearbyForRender(hydrated, userLocation, { coverageMode: effectiveCoverageMode, targetCount: WHATS_GOOD_TARGET_COUNT })
        if (verified.length < hydrated.length) {
          console.warn(
            `useWhatsGood: final coverage-mode gate (${effectiveCoverageMode}) rejected ${hydrated.length - verified.length} of ${hydrated.length} hydrated item(s) — showing ${verified.length} instead of backfilling from elsewhere.`
          )
        }

        // DEV-only structural assertion (2026-09-21 second follow-up fix;
        // made mode-aware 2026-09-22) — findWhatsGoodContractViolations is
        // the exact same pure predicate verifyNearbyForRender just filtered
        // with, so this should always be empty; it exists as a regression
        // trip-wire (and is unit-tested directly in
        // whatsGoodDataAdapter.test.js) so a future change that
        // accidentally appends items AFTER verifyNearbyForRender, or
        // reintroduces an out-of-mode Universal-item leak, fails loudly in
        // dev rather than silently reaching production.
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          const violations = findWhatsGoodContractViolations(verified, userLocation, { coverageMode: effectiveCoverageMode, targetCount: WHATS_GOOD_TARGET_COUNT })
          if (violations.length > 0) {
            console.warn(
              `useWhatsGood: DEV ASSERTION FAILED — ${violations.length} item(s) in the final rendered list violate the What's Good place-based geographic contract (coordinate-less, out-of-radius, or Universal): ${violations.join(', ')}`
            )
          }
        }

        setSelectedItems(verified)
        previousFingerprintRef.current = fingerprint
        setDebugInfo({
          userLocation,
          homeRailItemIds: homeRailItemIdsArray,
          candidatePool: debug?.candidatePool ?? [],
          selectedItemIds: itemIds,
          fromCache,
          fingerprintBefore,
          fingerprintAfter: fingerprint,
          atPlaceItemId: atPlace?.id ?? null,
        })
      })
      .catch((e) => {
        console.warn('useWhatsGood selection error:', e?.message ?? e)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [enabled, userLocation, locationState, hasExplicitSelection, rawNearbyItems, homeRailKey, userId, currentMetroId])

  return { enabled, loading, items: selectedItems, atPlaceItem, debug: debugInfo }
}
