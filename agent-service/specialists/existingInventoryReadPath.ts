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
// Chief Phase 2AO (2026-09-11) — the real Florence reconciliation gap: for
// an ALREADY-LAUNCHED metro, the original fetchExistingProductionItemsForRegion
// was the ONLY fetch path, and it is an inherently English-language string
// match (`ilike '%<term>%'` against formatted_address/neighborhood
// name/body). For Florence, whose real addresses say "Firenze" not
// "Florence," searching for "Florence" returned only 4/43 live items — a
// generic international-reconciliation bug, not a Florence-specific one
// (the same gap would hit Vienna/Wien, Milan/Milano, Munich/München, ...).
//
// Fixed with a priority order matching docs/metro-launch-playbook.md's own
// stated preference (metro/neighborhood ownership first, city-language
// string matching last, fallback-only):
//   1. fetchExistingProductionItemsForMetro — metro_id ownership, zero
//      address/language dependency. The correct, complete, deterministic
//      source for an ALREADY-LAUNCHED metro's own inventory (this IS what
//      "Florence's 43 items" means — every one of them already has a
//      neighborhood row under Florence's own metro_areas row, in whatever
//      language its formatted_address happens to be written in).
//   2. fetchExistingProductionItemsForRegion — unchanged in purpose (cross-
//      metro discovery, the Green Bay/Milwaukee case: content that might
//      still live under a DIFFERENT metro, where there is no metro_id to
//      join on) but now accepts MULTIPLE real alias terms combined with OR
//      (e.g. ["Florence", "Firenze"]) instead of a single English-only
//      term, so an international metro's own local-language text is never
//      silently invisible to this fallback either.
//   3. fetchExistingProductionInventoryForReconciliation — the new,
//      combined, generic entrypoint every metro build/enrichment/late-add
//      flow should call going forward: metro-scoped ownership (when the
//      metro already exists) UNIONed with cross-metro region-term
//      discovery, de-duplicated by id.
//
// READ-ONLY, same standing rule as homeListReadPath.ts — this module has
// no write path and never will. `agent_service` has confirmed SELECT
// access on public.items/public.neighborhoods (unlike public.tags/
// public.categories/public.lists/public.list_items, which are separately
// known gaps — see tagVocabularyProvider.ts/homeListReadPath.ts).

import { query as realQuery } from '../db'
import type { QueryResultRow } from 'pg'
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

function mapRow(r: RealExistingItemRow): ExistingProductionItem {
  return {
    id: r.id,
    body: r.body,
    googlePlaceId: r.google_place_id,
    formattedAddress: r.formatted_address,
    websiteUrl: r.website_url,
    lat: r.maps_lat,
    lng: r.maps_lng,
    mapsQuery: r.maps_query,
  }
}

/**
 * Injectable query function — defaults to the real `query()` from db.ts
 * (a real Postgres call). Tests inject a fake to prove the SQL this
 * module builds actually behaves correctly (e.g. a metro-scoped fetch
 * really does ignore address language) without needing a live database —
 * same discipline as every other real-I/O dependency in this codebase
 * (see metroLaunchDriver.ts's MetroDriverDeps).
 */
export type QueryFn = <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<T[]>

/**
 * The PRIMARY, deterministic source for an already-launched metro's own
 * inventory: every live item this metro's OWN neighborhoods table already
 * owns, via a metro_id join. No formatted_address text, no language, no
 * city-name matching of any kind — this is exactly what makes it immune
 * to the Florence/Firenze bug (and the same class of bug for any other
 * international metro) by construction, not by adding more alias words.
 */
export async function fetchExistingProductionItemsForMetro(metroSlug: string, queryFn: QueryFn = realQuery): Promise<ExistingProductionItem[]> {
  const slug = metroSlug.trim()
  if (slug.length === 0) {
    throw new Error('fetchExistingProductionItemsForMetro: metroSlug must be a real, non-empty metro_areas.slug value.')
  }
  const rows = await queryFn<RealExistingItemRow>(
    `select i.id, i.body, i.google_place_id, i.formatted_address, i.website_url, i.maps_lat, i.maps_lng, i.maps_query
     from public.items i
     join public.neighborhoods n on n.id = i.neighborhood_id
     join public.metro_areas m on m.id = n.metro_id
     where i.is_active = true and m.slug = $1`,
    [slug]
  )
  return rows.map(mapRow)
}

/**
 * Cross-metro discovery fetch (Green Bay/Milwaukee pattern) — items that
 * might already exist for this real-world region under a DIFFERENT
 * metro's ownership, or for a metro that doesn't have its own metro_areas
 * row yet at all. Still necessarily a string-matching fallback (there is
 * no metro_id to join on when the content lives somewhere else) — but now
 * accepts MULTIPLE real, specific alias terms (e.g. ["Florence",
 * "Firenze"], never a generic word) combined with OR, instead of a single
 * English-only term. Every term is validated with the SAME length/
 * specificity guard as before, individually.
 */
export async function fetchExistingProductionItemsForRegion(regionSearchTerms: string | readonly string[], queryFn: QueryFn = realQuery): Promise<ExistingProductionItem[]> {
  const rawTerms = Array.isArray(regionSearchTerms) ? regionSearchTerms : [regionSearchTerms]
  const terms = rawTerms.map((t) => t.trim()).filter((t) => t.length > 0)
  if (terms.length === 0) {
    throw new Error('fetchExistingProductionItemsForRegion: at least one real, specific search term is required.')
  }
  const tooShort = terms.filter((t) => t.length < 3)
  if (tooShort.length > 0) {
    throw new Error(`fetchExistingProductionItemsForRegion: term(s) too short/generic to search safely — supply a real, specific place name for each: ${tooShort.join(', ')}.`)
  }
  const params: string[] = []
  const conditions = terms.map((term) => {
    params.push(`%${term}%`)
    const idx = params.length
    return `(i.formatted_address ilike $${idx} or n.name ilike $${idx} or i.body ilike $${idx})`
  })
  const rows = await queryFn<RealExistingItemRow>(
    `select i.id, i.body, i.google_place_id, i.formatted_address, i.website_url, i.maps_lat, i.maps_lng, i.maps_query
     from public.items i
     left join public.neighborhoods n on n.id = i.neighborhood_id
     where i.is_active = true and (${conditions.join(' or ')})`,
    params
  )
  return rows.map(mapRow)
}

export interface FetchExistingProductionInventoryInput {
  /** The real, established metro_areas.slug for the metro being built/enriched, when it already exists (e.g. "florence"). Omit only when the metro genuinely doesn't have its own row yet — never guessed. */
  metroSlug?: string
  /** Real, specific place-name aliases for the cross-metro discovery fallback (e.g. ["Florence", "Firenze"] for an international metro whose own addresses are in the local language) — never a generic word, never invented. May be empty when metroSlug alone is sufficient (an already-launched metro reconciling against its own inventory has no need for cross-metro discovery). */
  regionSearchTerms: readonly string[]
}

/**
 * The combined, generic entrypoint every metro build/enrichment/late-add
 * flow should use going forward — see this module's header doc for the
 * priority order. De-duplicated by id: an item found by both the
 * metro-scoped and the region-term path is returned once.
 */
export async function fetchExistingProductionInventoryForReconciliation(input: FetchExistingProductionInventoryInput, queryFn: QueryFn = realQuery): Promise<ExistingProductionItem[]> {
  const [byMetro, byRegion] = await Promise.all([
    input.metroSlug ? fetchExistingProductionItemsForMetro(input.metroSlug, queryFn) : Promise.resolve([] as ExistingProductionItem[]),
    input.regionSearchTerms.length > 0 ? fetchExistingProductionItemsForRegion(input.regionSearchTerms, queryFn) : Promise.resolve([] as ExistingProductionItem[]),
  ])
  const byId = new Map<string, ExistingProductionItem>()
  for (const item of [...byMetro, ...byRegion]) byId.set(item.id, item)
  return [...byId.values()]
}
