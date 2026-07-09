import { useState, useEffect, useRef } from 'react'
import * as Location from 'expo-location'
import { supabase } from './supabase'

/**
 * useNearby()
 *
 * Gets user GPS location and returns nearby location-specific items
 * sorted by ring weight then distance from neighborhood center.
 *
 * Architecture: DB fetch and distance calculation are intentionally separated.
 *   - fetchItems()      → queries Supabase ONCE, caches raw rows in rawItemsRef
 *   - calcDistances()   → pure math, called on every GPS update (no DB hit)
 *
 * This means the list re-sorts and re-labels as the user walks around without
 * hammering the database on every GPS tick.
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

// Ring radius thresholds in meters
// Core=8mi, Near=20mi, Metro=40mi, Destination=500mi max
const RING_RADII = [12875, 32187, 64374, 96561]

// Max distance for Destination ring — ~500 miles (driveable / 1 state over).
// Items beyond this are excluded from Nearby entirely.
const MAX_DESTINATION_M = 804672

function distMeters(lat1, lng1, lat2, lng2) {
  const R    = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lng2 - lng1) * Math.PI / 180
  const a    = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
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
  const coordsRef      = useRef(null)  // latest user coords — used by manual refresh
  const showAlcoholRef = useRef(true)  // ref mirror so watcher closure always sees current value

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

  // ── DB fetch — called once on mount ─────────────────────────────────────
  async function fetchItems() {
    const { data: locationItems, error } = await supabase
      .from('items')
      .select(`
        id, body, checkin_type, ring_weight, is_universal, has_alcohol,
        difficulty, photo_required,
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
    rawItemsRef.current = locationItems ?? []
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
          dist   = distMeters(userLat, userLng, itemLat, itemLng)
          dLabel = distLabel(dist)
        }

        // Compute ring dynamically from actual distance
        let dynamicRing = item.ring_weight ?? 0
        if (dist !== null) {
          if      (dist < RING_RADII[0])     dynamicRing = 0   // Core
          else if (dist < RING_RADII[1])     dynamicRing = 1   // Near
          else if (dist < RING_RADII[2])     dynamicRing = 2   // Metro
          else if (dist < MAX_DESTINATION_M) dynamicRing = 3   // Destination
          else                               dynamicRing = -1  // Too far — exclude
        }

        return {
          id:               item.id,
          listItemId:       item.id,
          body:             item.body,
          checkinType:      item.checkin_type,
          checkin_type:     item.checkin_type,
          ring_weight:      dynamicRing,
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
      .filter(item => item !== null && item.ring_weight !== -1)
      .sort((a, b) => {
        if (a.ring_weight !== b.ring_weight) return a.ring_weight - b.ring_weight
        return a.dist_m - b.dist_m
      })

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
  async function requestLocation() {
    setLoading(true)
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') {
      setLocError('Location permission denied. Enable it in Settings to see nearby items.')
      setLoading(false)
      return
    }

    try {
      // Fetch items from DB first (once). GPS is requested in parallel via
      // getCurrentPositionAsync which typically resolves fast on a warm device.
      const [rawItems, pos] = await Promise.all([
        fetchItems(),
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      ])

      coordsRef.current = pos.coords
      calcDistances(pos.coords, rawItems)

      // Watch continuously. 25m distanceInterval means distance labels stay
      // accurate as the user walks. timeInterval: 10000 ensures the watcher
      // fires at least every 10s even if the user is standing still —
      // critical for re-acquiring a fresh iOS GPS fix after the app resumes.
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
    } catch(e) {
      // GPS timeout — try last known position
      try {
        const last = await Location.getLastKnownPositionAsync()
        if (last) {
          coordsRef.current = last.coords
          // Fetch items if we haven't yet (fetchItems may have failed too)
          if (!rawItemsRef.current) await fetchItems()
          if (rawItemsRef.current) calcDistances(last.coords, rawItemsRef.current)
        } else {
          setLocError('Could not get your location. Make sure location services are on.')
          setLoading(false)
        }
      } catch {
        setLocError('Could not get your location. Make sure location services are on.')
        setLoading(false)
      }
    }
  }

  // Manual refresh via pull-to-refresh — recalculates distances from cached
  // data instantly (no DB hit), then re-fetches items in the background to
  // pick up any new items that may have been added since mount.
  function refresh() {
    setRefreshing(true)
    if (coordsRef.current && rawItemsRef.current) {
      // Instant redraw with cached data
      calcDistances(coordsRef.current, rawItemsRef.current)
    }
    // Also re-fetch items from DB to pick up any newly added items
    fetchItems()
      .then(rawItems => {
        if (coordsRef.current) calcDistances(coordsRef.current, rawItems)
      })
      .catch(e => {
        console.warn('useNearby refresh error:', e.message)
        setRefreshing(false)
      })
  }

  return { items, loading, locError, location: coordsRef.current, refreshing, refresh, showAlcohol }
}
