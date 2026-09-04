// What's Good V1 — the HomeScreen-facing hook. Owns its OWN location
// state, deliberately separate from HomeScreen's existing one-shot
// `userLocation` (used by Home Rail's own sort/distance labels) — this is
// a scoping choice, not an oversight: replacing Home Rail's existing
// location fetch is a riskier change to code many other things already
// depend on, and wasn't asked for. This hook is fully additive; deleting
// it changes nothing else in HomeScreen. See the implementation-defaults
// list in the final report.
//
// AppState/navigation-focus refresh pattern mirrors the one already proven
// in lib/visitDetection/candidateVisitTracker.js's useCandidateVisitTracking
// (foreground-transition + cooldown, not continuous polling) rather than
// inventing a new pattern.
//
// Behind the `whats_good_v1` feature flag: when disabled, this hook does
// nothing at all beyond the one isFlagEnabled() check — no location
// tracking, no queries, no state — so HomeScreen's existing behavior is
// completely unaffected while the flag stays off.

import { useEffect, useRef, useState, useCallback } from 'react'
import { AppState } from 'react-native'
import * as Location from 'expo-location'
import { isFlagEnabled } from './featureFlags'
import { proximitySort } from './proximity.js'
import { isAtPlace } from './whatsGoodAtPlace.js'
import { computeContextFingerprint } from './whatsGoodContextFingerprint.js'
import { getWhatsGoodSelection } from './whatsGoodOrchestrator.js'
import { setCurrentAtPlaceItemId } from './atPlacePresenceTracker'

/** IMPLEMENTATION DEFAULT — lightweight foreground refresh cooldown, mirrors visitDetection's own AppState cooldown convention. Not a product decision. */
const CONTEXT_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000

/** IMPLEMENTATION DEFAULT — how many nearest items feed the context fingerprint. */
const NEAREST_FINGERPRINT_COUNT = 15

/**
 * @param {object} params
 * @param {string|null} params.userId
 * @param {Array} params.rawNearbyItems  Already-loaded item pool from
 *   HomeScreen (same shape loadNearbyRail() already produces) — reused
 *   directly, never re-fetched here.
 * @param {string[]} params.homeRailItemIds  The current Home Rail 5 IDs.
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
 *   Enable" work. It is always computed (cheap; no extra queries) but only
 *   meant to be RENDERED behind an additional tester-only gate by the
 *   caller (see components/WhatsGoodDebugPanel.jsx) — this hook itself
 *   doesn't gate rendering, since gating is a UI concern.
 */
export function useWhatsGood({ userId, rawNearbyItems, homeRailItemIds, navigation }) {
  const [enabled, setEnabled] = useState(false)
  const [userLocation, setUserLocation] = useState(null)
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

  const appStateRef = useRef(AppState.currentState)
  const lastRefreshRef = useRef(0)
  const previousFingerprintRef = useRef(null)
  const homeRailKey = (homeRailItemIds ?? []).join(',') // stable primitive — avoids re-running effects on every new array reference

  const refreshLocation = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync()
      if (status !== 'granted') return
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
      ]).catch(() => Location.getLastKnownPositionAsync({}))
      if (!pos?.coords) return
      setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
    } catch (e) {
      console.warn('useWhatsGood refreshLocation error:', e?.message ?? e)
    }
  }, [])

  // Clears the shared at-place presence signal whenever this hook becomes
  // disabled (flag turned off mid-session, or unmount) so a stale
  // "still at-place" value never outlives it.
  useEffect(() => {
    if (!enabled) setCurrentAtPlaceItemId(null)
    return () => setCurrentAtPlaceItemId(null)
  }, [enabled])

  // 1. Flag check (per-call, not cached across mounts — matches
  // isFlagEnabled()'s own internal caching) + initial location fetch.
  useEffect(() => {
    if (!userId) {
      setEnabled(false)
      setCurrentAtPlaceItemId(null)
      return
    }
    let cancelled = false
    isFlagEnabled(userId, 'whats_good_v1').then(async (isEnabled) => {
      if (cancelled) return
      setEnabled(isEnabled)
      if (isEnabled) await refreshLocation()
    })
    return () => {
      cancelled = true
    }
  }, [userId, refreshLocation])

  // 2. Foreground-transition + navigation-focus refresh, with a cooldown —
  // never continuous polling. Zero effect at all when disabled.
  useEffect(() => {
    if (!enabled) return undefined

    const maybeRefresh = () => {
      const nowMs = Date.now()
      if (nowMs - lastRefreshRef.current < CONTEXT_REFRESH_MIN_INTERVAL_MS) return
      lastRefreshRef.current = nowMs
      refreshLocation()
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        maybeRefresh()
      }
      appStateRef.current = nextState
    })

    const unsubscribeFocus = navigation?.addListener?.('focus', maybeRefresh)

    return () => {
      subscription.remove()
      unsubscribeFocus?.()
    }
  }, [enabled, refreshLocation, navigation])

  // 3. Derive nearest/at-place context from already-loaded items + the
  // location this hook owns, then run the orchestrator (which itself
  // decides whether the session cache makes recomputation unnecessary).
  useEffect(() => {
    if (!enabled || !userLocation || !rawNearbyItems?.length) return undefined

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
      homeRailItemIds: homeRailItemIdsArray,
      allLocatedItems: rawNearbyItems,
      currentFingerprint: fingerprint,
      now: new Date(),
    })
      .then(({ itemIds, fromCache, debug, backupItemIds }) => {
        if (cancelled) return
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

        setSelectedItems(hydrated)
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
  }, [enabled, userLocation, rawNearbyItems, homeRailKey, userId])

  return { enabled, loading, items: selectedItems, atPlaceItem, debug: debugInfo }
}
