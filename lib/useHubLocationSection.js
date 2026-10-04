// Data + location glue for the Destination Hub "You're at / Closest to you"
// section. All decisions live in lib/hubLocationSection.js (pure, tested);
// this hook only fetches Hub membership, subscribes to the shared location
// (lib/currentLocation.js, same source Home uses) and keeps completion
// current on focus.
//
// Renders nothing (returns null) until zones, items and a location fix are
// all known, so a wrong state never flashes, and never blocks the lists.
// No permission prompt is added here: useCurrentLocation()'s refresh uses
// the app's existing flow, and a denied/unavailable fix just yields null.
import { useEffect, useMemo, useState, useCallback } from 'react'
import * as Location from 'expo-location'
import { supabase } from './supabase'
import { useCurrentLocation } from './currentLocation'
import { mapRailItem } from './mapRailItem'
import { isItemInSeason } from './seasonFilter'
import { filterMaskedBonusDrops } from './bonusDrops'
import { isWithinWindow } from './seasonWindowPure'
import { buildHubExperiences, selectHubLocationSection } from './hubLocationSection'

const ITEM_COLS = `
  id, body, checkin_type, is_universal, difficulty, photo_required,
  maps_lat, maps_lng, geo_radius_m, is_secret, secret_reveal_text,
  website_url, maps_query, partner_id, has_alcohol, season_tag,
  allows_personal_note, personal_prompt_label, personal_place_label,
  active_cover_candidate_id, fallback_art_key, is_active, is_approved,
  categories(name, color_hex),
  neighborhoods!items_neighborhood_id_fkey(id, name),
  partners!items_partner_id_fkey(business_name, photo_url)
`

export function useHubLocationSection({ destinationId, destLists, userId, navigation }) {
  const { location, refreshLocation } = useCurrentLocation()
  const [zones, setZones] = useState(null)        // null = not loaded
  const [experiences, setExperiences] = useState(null) // [{item, listIds}]
  const [checkins, setCheckins] = useState([])    // [{item_id, checked_at}]
  const [focusTick, setFocusTick] = useState(0)

  // Stable key so a new array identity with the same lists doesn't refetch.
  const listIdsKey = (destLists ?? []).map(dl => dl.lists?.id).filter(Boolean).join(',')

  // Never prompts: only refresh when permission is ALREADY granted
  // (getForegroundPermissionsAsync is read-only). The shared store/watcher
  // keeps the fix current; with no permission we stay at null and the
  // section is omitted.
  const refreshIfPermitted = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync()
      if (status === 'granted') refreshLocation(false)
    } catch { /* no location -> no section */ }
  }, []) // eslint-disable-line

  useEffect(() => { refreshIfPermitted() }, [refreshIfPermitted])

  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => {
      refreshIfPermitted()
      setFocusTick(t => t + 1)
    })
    return () => unsub?.()
  }, [navigation]) // eslint-disable-line

  useEffect(() => {
    let cancelled = false
    setZones(null)
    if (!destinationId) return undefined
    ;(async () => {
      try {
        let q = supabase
          .from('destination_zones')
          .select('id, center_lat, center_lng, radius_km, is_active')
          .eq('destination_id', destinationId)
        if (!__DEV__) q = q.eq('is_active', true)
        const { data, error } = await q
        if (!cancelled) setZones(error ? [] : (data ?? []))
      } catch {
        if (!cancelled) setZones([])
      }
    })()
    return () => { cancelled = true }
  }, [destinationId])

  useEffect(() => {
    let cancelled = false
    setExperiences(null)
    const listIds = listIdsKey ? listIdsKey.split(',') : []
    if (!listIds.length) { setExperiences([]); return undefined }
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('list_items')
          .select(`list_id, items!inner(${ITEM_COLS})`)
          .in('list_id', listIds)
        if (error) throw error
        const live = (data ?? []).filter(r => r.items && r.items.is_active !== false && r.items.is_approved !== false)
        const seasonal = live.filter(r => isItemInSeason(r.items))
        const mapped = seasonal.map(r => ({ list_id: r.list_id, item: mapRailItem(r.items) }))
        // Locked Bonus Drops stay hidden until unlocked, same as Home's rail.
        const visible = new Set((await filterMaskedBonusDrops(mapped.map(m => m.item), userId)).map(i => i.id))
        const rows = mapped.filter(m => visible.has(m.item.id))
        if (!cancelled) setExperiences(buildHubExperiences(rows))
      } catch {
        if (!cancelled) setExperiences([])
      }
    })()
    return () => { cancelled = true }
  }, [listIdsKey, userId])

  // Completion: re-read on mount and whenever the Hub regains focus (e.g.
  // returning from ItemDetail after a check-off).
  const itemIdsKey = (experiences ?? []).map(e => e.item.id).join(',')
  useEffect(() => {
    let cancelled = false
    if (!userId || !itemIdsKey) { setCheckins([]); return undefined }
    ;(async () => {
      try {
        const { data } = await supabase
          .from('check_ins')
          .select('item_id, checked_at')
          .eq('user_id', userId)
          .in('item_id', itemIdsKey.split(','))
        if (!cancelled) setCheckins(data ?? [])
      } catch {
        if (!cancelled) setCheckins([])
      }
    })()
    return () => { cancelled = true }
  }, [userId, itemIdsKey, focusTick])

  const completedIds = useMemo(() => {
    const listById = {}
    ;(destLists ?? []).forEach(dl => { if (dl.lists?.id) listById[dl.lists.id] = dl.lists })
    const done = new Set()
    for (const c of checkins) {
      const exp = (experiences ?? []).find(e => e.item.id === c.item_id)
      if (!exp) continue
      if (exp.listIds.some(id => {
        const l = listById[id]
        return l && isWithinWindow(c.checked_at, l.starts_at, l.ends_at)
      })) done.add(c.item_id)
    }
    return done
  }, [checkins, experiences, destLists])

  return useMemo(() => {
    if (zones === null || experiences === null || !location) return null
    return selectHubLocationSection({
      location, zones, items: experiences.map(e => e.item), completedIds,
    })
  }, [zones, experiences, location, completedIds])
}
