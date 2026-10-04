// Destination Hub location section — pure decision logic (no React, no
// Supabase, no Expo) so it runs under plain `node --test`.
//
// Reuses, never reinterprets:
//   - zone membership: the same destination_zones center/radius_km haversine
//     predicate HomeScreen.jsx uses for its nearbyZone check.
//   - physical presence: lib/whatsGoodAtPlace.js isAtPlace() — the approved
//     foreground rule min(item.geo_radius_m, 150m) — applied to the nearest
//     located item exactly like useWhatsGood.js (topItem && isAtPlace).
//   - ordering/distance: lib/proximity.js proximitySort() (distM in meters,
//     rendered with formatDistanceLabel).
// Presence only means "you are here". Whether a check-off actually counts is
// still decided by ItemDetailScreen's own geofence/eligibility/photo/points
// flow — this module never grants or implies eligibility.

import { haversineMeters } from './distance.js'
import { isAtPlace } from './whatsGoodAtPlace.js'
import { proximitySort } from './proximity.js'

export const CLOSEST_COUNT = 2

/** Same predicate as HomeScreen.jsx's destination-zone hit test. */
export function isInsideAnyZone(location, zones) {
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return false
  return (zones ?? []).some(z =>
    z?.center_lat != null && z?.center_lng != null && z?.radius_km != null &&
    haversineMeters(location.latitude, location.longitude, z.center_lat, z.center_lng) <= z.radius_km * 1000
  )
}

/**
 * Flattens list_items rows (already mapped items attached as `.item`) from
 * every list of the Hub into ONE entry per item id (dedupe across lists),
 * remembering which lists contained it for window-scoped completion.
 * Inactive/unapproved/unlocated items are dropped.
 * @returns {Array<{item: object, listIds: string[]}>}
 */
export function buildHubExperiences(rows) {
  const byId = new Map()
  for (const row of rows ?? []) {
    const item = row?.item
    if (!item?.id) continue
    if (item.isActive === false || item.isApproved === false) continue
    if (item.is_universal) continue
    if (item.maps_lat == null || item.maps_lng == null) continue
    const entry = byId.get(item.id)
    if (entry) {
      if (row.list_id && !entry.listIds.includes(row.list_id)) entry.listIds.push(row.list_id)
    } else {
      byId.set(item.id, { item, listIds: row.list_id ? [row.list_id] : [] })
    }
  }
  return [...byId.values()]
}

/**
 * @param {object} p
 * @param {{latitude:number, longitude:number}|null} p.location
 * @param {Array} p.zones                this Hub's destination_zones rows
 * @param {object[]} p.items             deduped, mapped Hub items
 * @param {Set<string>} [p.completedIds]
 * @returns {{kind: 'at'|'closest', items: object[]}|null}
 *   items carry `distM`; `completed` marks existing check-offs.
 */
export function selectHubLocationSection({ location, zones, items, completedIds }) {
  if (!isInsideAnyZone(location, zones)) return null
  if (!items?.length) return null
  const { items: sorted } = proximitySort(items, location, { includeUniversal: false, interleave: false })
  const located = sorted.filter(i => i.distM != null)
  if (!located.length) return null
  const done = completedIds ?? new Set()
  const tag = i => ({ ...i, completed: done.has(i.id) })

  const top = located[0]
  if (isAtPlace(top, location)) return { kind: 'at', items: [tag(top)] }
  return { kind: 'closest', items: located.slice(0, CLOSEST_COUNT).map(tag) }
}
