// agent-service/specialists/existingInventoryReadPath.ts
//
// Chief Phase 2AH — the real read path behind
// MetroDriverDeps.fetchExistingProductionInventory. Second systemic gap
// from the Green Bay incident (2026-09-10): Green Bay already had 9 real,
// live, already-certified production items sitting under MILWAUKEE's
// metro (the "Green Bay Leap" day-trip list) — a real, common pattern
// (a destination gets represented from a neighboring metro's day-trip
// content before it becomes its own metro) that the driver never checked
// for at all. This queries production for exactly that: items whose
// formatted_address/neighborhood name matches the metro actually being
// built, REGARDLESS of which metro's neighborhoods table row currently
// owns them.
//
// READ-ONLY, same standing rule as homeListReadPath.ts — this module has
// no write path and never will. `agent_service` has confirmed SELECT
// access on public.items/public.neighborhoods (unlike public.tags/
// public.categories/public.lists/public.list_items, which are separately
// known gaps — see tagVocabularyProvider.ts/homeListReadPath.ts).

import { query } from '../db'
import type { ExistingProductionItem } from '../playbooks/existingInventoryReconciliation'

interface RealExistingItemRow {
  id: string
  body: string
  google_place_id: string | null
  formatted_address: string | null
  website_url: string | null
  maps_lat: number | null
  maps_lng: number | null
  maps_query: string | null
}

/**
 * Fetches real, live, is_active production items whose formatted_address
 * or owning-neighborhood name mentions `regionSearchTerm` — deliberately
 * NOT scoped to any particular metro_id, since the entire point is to
 * find items a DIFFERENT metro may already own for this same real-world
 * place (exactly the Green Bay/Milwaukee situation). `regionSearchTerm`
 * should be a real, specific place name (e.g. "Green Bay"), never a
 * generic word — an empty/near-empty search term would match far too
 * broadly, so callers must supply something specific (see
 * metroLaunchDriver.ts's stepM8BatchCertification, which derives it from
 * the real metroAreaFacts.name for this run, never a guess).
 */
export async function fetchExistingProductionItemsForRegion(regionSearchTerm: string): Promise<ExistingProductionItem[]> {
  const term = regionSearchTerm.trim()
  if (term.length < 3) {
    throw new Error(`fetchExistingProductionItemsForRegion: regionSearchTerm "${regionSearchTerm}" is too short/generic to search safely — supply a real, specific place name.`)
  }
  const like = `%${term}%`
  const rows = await query<RealExistingItemRow>(
    `select i.id, i.body, i.google_place_id, i.formatted_address, i.website_url, i.maps_lat, i.maps_lng, i.maps_query
     from public.items i
     left join public.neighborhoods n on n.id = i.neighborhood_id
     where i.is_active = true
       and (i.formatted_address ilike $1 or n.name ilike $1 or i.body ilike $1)`,
    [like]
  )
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    googlePlaceId: r.google_place_id,
    formattedAddress: r.formatted_address,
    websiteUrl: r.website_url,
    lat: r.maps_lat,
    lng: r.maps_lng,
    mapsQuery: r.maps_query,
  }))
}
