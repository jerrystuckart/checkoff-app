import { useState, useEffect, useRef } from 'react'
import * as Location from 'expo-location'
import { supabase } from './supabase'
import { haversineMeters } from './distance'
import { filterMaskedBonusDrops } from './bonusDrops'
import { isItemInSeason } from './seasonFilter'
import { isWithinNearbyRadius } from './nearbyRanking'
import { useCurrentLocation } from './currentLocation'

/**
 * useNearby()
 *
 * Gets user GPS location and returns nearby location-specific items
 * within the automatic Nearby radius, sorted by distance.
 *
 * Architecture: DB fetch and distance calculation are intentionally separated.
 *   - fetchItems()      → queries Supabase ONCE, caches raw rows in rawItemsRef
 *   - calcDistances()   → pure math, called whenever location updates (no DB hit)
 *
 * This means the list re-sorts and re-labels as the user walks around without
 * hammering the database on every GPS tick.
 *
 * Location itself comes from lib/currentLocation.js's shared store, not a
 * private fetch here — that's what makes a manual pull-to-refresh (see
 * refresh() below) and the app-wide 5-minute foreground-stale check
 * actually update Nearby, instead of Nearby silently re-showing whatever
 * location it grabbed once at mount. A continuous expo-location watcher is
 * still kept locally for smooth live updates while this screen is
 * actively open and foregrounded — a real-time nicety the shared store
 * (deliberately coarser: staleness-gated, not continuous) doesn't attempt.
 */

// Approximate center coordinates for each metro's neighborhoods.
// These are fallback centers used when center_geo isn't in the DB.
// Format: { neighborhoodName: [lat, lng] }
const NEIGHBORHOOD_CENTERS = {
  // Phoenix Metro
  'Peoria':     [33.5806, -112.2374],
  'Glendale':   [33.5387, -112.1860],
  'Phoenix':    [33.4484, -112.0740],
  'Scottsdale': [33.4942, -111.9261],
  'Tempe':      [33.4255, -111.9400],
  'Mesa':       [33.4152, -111.8315],
  'Chandler':   [33.3062, -111.8413],
  'Gilbert':    [33.3528, -111.7890],
  'Surprise':   [33.6292, -112.3679],
  'Anthem':     [33.8565, -112.1258],
  // Milwaukee Metro
  'Milwaukee':  [43.0389, -87.9065],
  'Brookfield': [43.0606, -88.1065],
  'Waukesha':   [43.0117, -88.2315],
}

function distLabel(m) {
  if (m < 160)   return 'Right here'
  if (m < 1609)  return `${Math.round(m / 100) * 100}m away`
  const mi = m / 1609.34
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`
}

export function useNearby() {
  const [items, setItems]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [locError, setLocError]       = useState(null)
  const [userId, setUserId]           = useState(null)
  const [showAlcohol, setShowAlcohol] = useState(true)
  const [refreshing, setRefreshing]   = useState(false)

  const watchRef       = useRef(null)
  const rawItemsRef    = useRef(null)  // cached Supabase rows — DB is only hit once
  const coordsRef      = useRef(null)  // latest user coords — mirrors shared location + the live watcher
  const showAlcoholRef = useRef(true)  // ref mirror so watcher closure always sees current value

  const { location: sharedLocation, refreshLocation } = useCurrentLocation()

  // Keep ref in sync with state so the GPS watcher closure (captured once at
  // creation time) always reads the current alcohol pref without being recreated.
  useEffect(() => { showAlcoholRef.current = showAlcohol }, [showAlcohol])

  // When alcohol pref changes after items are loaded, re-filter in place
  // without hitting the DB or waiting for the next GPS tick.
  useEffect(() => {
    if (coordsRef.current && rawItemsRef.current) {
      calcDistances(coordsRef.current, rawItemsRef.current)
    }
  }, [showAlcohol])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id ?? null
      setUserId(uid)
      if (uid) {
        supabase.from('users').select('pref_show_alcohol').eq('id', uid).single()
          .then(({ data: p }) => { if (p) setShowAlcohol(p.pref_show_alcohol !== false) })
      }
    })
    requestLocation()
    return () => { if (watchRef.current) watchRef.current.remove() }
  }, [])

  // Any externally-triggered shared-location update — another screen's
  // manual refresh, or the app-wide 5-minute foreground-stale check —
  // makes Nearby recompute immediately too. This is what fixes "drove to
  // a new place, reopened the app, Nearby still shows the old location":
  // the foreground check (lib/currentLocation.js) updates the shared
  // store, and this effect picks it up without Nearby needing its own
  // AppState listener.
  useEffect(() => {
    if (sharedLocation && rawItemsRef.current) {
      coordsRef.current = sharedLocation
      calcDistances(sharedLocation, rawItemsRef.current)
    }
  }, [sharedLocation])

  // ── DB fetch — called once on mount ─────────────────────────────────────
  async function fetchItems() {
    const { data: locationItems, error } = await supabase
      .from('items')
      .select(`
        id, body, checkin_type, ring_weight, is_universal, has_alcohol,
        difficulty, photo_required, season_tag,
        partner_id, website_url, maps_query, neighborhood_id,
        maps_lat, maps_lng, geo_radius_m, is_secret, secret_reveal_text,
        categories ( name, color_hex ),
        neighborhoods!items_neighborhood_id_fkey ( name, metro_id ),
        partners!items_partner_id_fkey ( business_name )
      `)
      .eq('is_active', true)
      .eq('is_approved', true)
      .eq('is_universal', false)
      .not('neighborhood_id', 'is', null)

    if (error) {
      console.warn('fetchItems error:', error.message)
      return rawItemsRef.current ?? []
    }
    // Locked Bonus Drops must not leak into Nearby — they only exist inside
    // their own list until unlocked (or until this user has checked them
    // off, at which point they're normal). userId may still be null on the
    // very first call (this fires in parallel with the auth lookup); that
    // just means everything masks conservatively until the next fetch.
    const masked = await filterMaskedBonusDrops(locationItems ?? [], userId)
    rawItemsRef.current = masked.filter(isItemInSeason)
    return rawItemsRef.current
  }

  // ── Distance calc — called on every GPS update, pure math, no DB ────────
  // Uses showAlcoholRef (not showAlcohol state) so the watcher closure always
  // reads the freshest value without needing to be re-created.
  function calcDistances(coords, rawItems) {
    const { latitude: userLat, longitude: userLng } = coords

    const processed = rawItems
      .map(item => {
        const hoodName = item.neighborhoods?.name ?? ''

        // Use item's own coordinates if available, otherwise neighborhood center
        let itemLat = item.maps_lat
        let itemLng = item.maps_lng

        if (!itemLat || !itemLng) {
          const center = NEIGHBORHOOD_CENTERS[hoodName]
          if (center) {
            itemLat = center[0]
            itemLng = center[1]
          }
        }

        let dist   = null
        let dLabel = null

        if (itemLat && itemLng) {
          dist   = haversineMeters(userLat, userLng, itemLat, itemLng)
          dLabel = distLabel(dist)
        }

        // Hard geographic gate only — no bands. An item with a resolvable
        // distance beyond the automatic Nearby radius is excluded outright;
        // one with no resolvable coordinates can't be geographically
        // qualified, so it's left in (matches prior behavior) rather than
        // silently dropped.
        const withinRadius = dist === null || isWithinNearbyRadius(dist)

        return {
          id:               item.id,
          listItemId:       item.id,
          body:             item.body,
          checkinType:      item.checkin_type,
          checkin_type:     item.checkin_type,
          // ring_weight here is the raw admin-set content classification
          // (Core/Near/Metro/Destination, shown on ItemDetailScreen /
          // PartnerPreviewScreen) — passed through unmodified. It plays no
          // role in Nearby's own ranking or radius filtering.
          ring_weight:      item.ring_weight ?? 0,
          withinRadius,
          categoryName:     item.categories?.name ?? 'Misc',
          categoryColor:    item.categories?.color_hex ?? '#888780',
          neighborhoodName: hoodName || null,
          partner_id:       item.partner_id ?? null,
          partnerName:      item.partners?.business_name ?? null,
          website_url:      item.website_url ?? null,
          maps_query:       item.maps_query ?? null,
          maps_lat:         item.maps_lat ?? null,
          maps_lng:         item.maps_lng ?? null,
          geo_radius_m:     item.geo_radius_m ?? null,
          difficulty:          item.difficulty ?? 1,
          photoRequired:       item.photo_required ?? false,
          is_secret:           item.is_secret ?? false,
          secret_reveal_text:  item.secret_reveal_text ?? null,
          dist_m:           dist ?? (item.ring_weight ?? 0) * 15000,
          dist_label:       dLabel,
          has_alcohol:      item.has_alcohol ?? false,
          checked:          false,
          isUniversal:      false,
          hasExactLocation: !!(item.maps_lat && item.maps_lng),
        }
      })
      .filter(item => item !== null && item.withinRadius)
      .sort((a, b) => a.dist_m - b.dist_m)

    // Filter alcohol items — use ref so this always reflects current pref
    const alcoholFiltered = showAlcoholRef.current
      ? processed
      : processed.filter(item => !item.has_alcohol)

    // Deduplicate
    const seen    = new Set()
    const deduped = alcoholFiltered.filter(item => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })

    setItems(deduped)
    setRefreshing(false)
    setLoading(false)
  }

  // ── Location setup ───────────────────────────────────────────────────────
  // Initial fix comes from the shared store (force:false — reuses a
  // recent-enough fix from another screen if one already exists, otherwise
  // fetches since a never-set location always counts as stale). A
  // continuous watcher is layered on top purely for smooth live updates
  // while this screen stays open and foregrounded.
  async function requestLocation() {
    setLoading(true)
    try {
      const [rawItems, snapshot] = await Promise.all([
        fetchItems(),
        refreshLocation(false),
      ])

      if (!snapshot?.coords) {
        setLocError('Could not get your location. Make sure location services are on and permission is granted for CheckOff.')
        setLoading(false)
        return
      }

      coordsRef.current = snapshot.coords
      calcDistances(snapshot.coords, rawItems)

      // Watch continuously. 25m distanceInterval means distance labels stay
      // accurate as the user walks. timeInterval: 10000 ensures the watcher
      // fires at least every 10s even if the user is standing still.
      // Purely a live-update nicety for the active session — the shared
      // store (via the effect above) is what recovers from backgrounding.
      try {
        watchRef.current = await Location.watchPositionAsync(
          {
            accuracy:         Location.Accuracy.Balanced,
            distanceInterval: 25,    // update every 25 metres of movement
            timeInterval:     10000, // or at least every 10 seconds
          },
          loc => {
            coordsRef.current = loc.coords
            if (rawItemsRef.current) {
              calcDistances(loc.coords, rawItemsRef.current)
            }
          }
        )
      } catch (e) {
        // Non-fatal: the initial fix + shared-location updates still work
        // without the continuous watcher.
        console.warn('useNearby watchPositionAsync failed to start:', e?.message ?? e)
      }
    } catch (e) {
      console.warn('useNearby requestLocation error:', e?.message ?? e)
      setLocError('Could not get your location. Make sure location services are on and permission is granted for CheckOff.')
      setLoading(false)
    }
  }

  // Manual refresh via pull-to-refresh — forces a fresh DEVICE location
  // first (not a reuse of whatever coords happen to be cached), updates
  // the shared location store, then re-fetches items and recomputes
  // distances against the new fix. A failed GPS refresh keeps the last
  // known-good coords (see lib/currentLocation.js) rather than going blank.
  function refresh() {
    setRefreshing(true)
    refreshLocation(true)
      .then(snapshot => {
        if (snapshot?.coords) coordsRef.current = snapshot.coords
        return fetchItems()
      })
      .then(rawItems => {
        if (coordsRef.current) calcDistances(coordsRef.current, rawItems)
        else setRefreshing(false)
      })
      .catch(e => {
        console.warn('useNearby refresh error:', e.message)
        setRefreshing(false)
      })
  }

  return { items, loading, locError, location: coordsRef.current, refreshing, refresh, showAlcohol }
}
