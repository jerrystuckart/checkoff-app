// Chief Phase 2AO (2026-09-11) — regression coverage for the real
// international-reconciliation bug: fetchExistingProductionItemsForRegion
// was the ONLY fetch path for an already-launched metro's own inventory,
// and it is inherently an English-language string match against
// formatted_address/neighborhood name/body. Florence's real addresses say
// "Firenze," not "Florence" — searching "Florence" found only 4/43 live
// items. These tests use an injected fake QueryFn (no real database) to
// prove the fix: fetchExistingProductionItemsForMetro (metro_id ownership)
// finds every item regardless of address language, and the combined
// fetchExistingProductionInventoryForReconciliation never drops an item
// just because its own address text isn't in the search term's language.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchExistingProductionItemsForMetro,
  fetchExistingProductionItemsForRegion,
  fetchExistingProductionInventoryForReconciliation,
  type QueryFn,
} from './existingInventoryReadPath'

interface FakeRow {
  id: string
  body: string
  google_place_id: string | null
  formatted_address: string | null
  website_url: string | null
  maps_lat: number | null
  maps_lng: number | null
  maps_query: string | null
}

const FLORENCE_ITEMS: FakeRow[] = [
  { id: 'fi-1', body: "Order the schiacciata at 'S.Forno'.", google_place_id: 'p1', formatted_address: 'Via Santa Monaca, 3r, 50124 Firenze FI, Italy', website_url: null, maps_lat: 43.77, maps_lng: 11.25, maps_query: null },
  { id: 'fi-2', body: "See the David at 'Galleria dell'Accademia'.", google_place_id: 'p2', formatted_address: 'Via Ricasoli, 58-60, 50129 Firenze FI, Italy', website_url: null, maps_lat: 43.78, maps_lng: 11.26, maps_query: null },
  { id: 'fi-3', body: "Cross 'Ponte Vecchio' at sunset.", google_place_id: 'p3', formatted_address: 'Ponte Vecchio, 50125 Firenze FI, Italy', website_url: null, maps_lat: 43.77, maps_lng: 11.25, maps_query: null },
]
const VIENNA_ITEM: FakeRow = { id: 'vi-1', body: "Order a Sachertorte at 'Café Sacher'.", google_place_id: 'p4', formatted_address: 'Philharmoniker Str. 4, 1010 Wien, Austria', website_url: null, maps_lat: 48.2, maps_lng: 16.37, maps_query: null }

function fakeQuery(metroSlugToItems: Record<string, FakeRow[]>, regionMatchableRows: FakeRow[] = []): QueryFn {
  return (async (text: string, params: unknown[] = []) => {
    if (text.includes('join public.metro_areas')) {
      // metro-scoped: params[0] is the slug
      const slug = params[0] as string
      return (metroSlugToItems[slug] ?? []) as unknown[]
    }
    // region-term ilike search: each param is a %term% pattern; match any row whose
    // formatted_address/body contains any term (case-insensitive), same semantics as the real ILIKE.
    const terms = params.map((p) => String(p).replace(/%/g, '').toLowerCase())
    return regionMatchableRows.filter((row) => terms.some((t) => (row.formatted_address ?? '').toLowerCase().includes(t) || row.body.toLowerCase().includes(t))) as unknown[]
  }) as QueryFn
}

test('fetchExistingProductionItemsForMetro: finds every item regardless of address language — the real fix (no ilike/city-name matching at all)', async () => {
  const q = fakeQuery({ florence: FLORENCE_ITEMS })
  const result = await fetchExistingProductionItemsForMetro('florence', q)
  assert.equal(result.length, 3, 'all 3 Firenze-addressed items must be found — none hidden by address language')
  assert.deepEqual(
    result.map((r) => r.id).sort(),
    ['fi-1', 'fi-2', 'fi-3']
  )
})

test('fetchExistingProductionItemsForMetro: refuses an empty slug rather than silently returning everything', async () => {
  await assert.rejects(() => fetchExistingProductionItemsForMetro('', fakeQuery({})), /real, non-empty metro_areas\.slug/)
})

test('fetchExistingProductionItemsForRegion: a search for the ENGLISH name alone misses Firenze-addressed items — this is the exact bug, still true of this fallback path on its own', async () => {
  const q = fakeQuery({}, FLORENCE_ITEMS)
  const result = await fetchExistingProductionItemsForRegion('Florence', q)
  assert.equal(result.length, 0, 'proves the bug: "Florence" alone does not match "Firenze" addresses — this is exactly why fetchExistingProductionItemsForMetro must be the PRIMARY source for an already-launched metro')
})

test('fetchExistingProductionItemsForRegion: now accepts MULTIPLE real alias terms — supplying the real local-language alias closes the gap for the fallback path itself', async () => {
  const q = fakeQuery({}, FLORENCE_ITEMS)
  const result = await fetchExistingProductionItemsForRegion(['Florence', 'Firenze'], q)
  assert.equal(result.length, 3, 'with the real alias term supplied, all 3 items are found')
})

test('fetchExistingProductionItemsForRegion: still rejects a too-short/generic term, per-term, even inside a multi-term list', async () => {
  await assert.rejects(() => fetchExistingProductionItemsForRegion(['Florence', 'FI'], fakeQuery({})), /too short\/generic/)
})

test('fetchExistingProductionInventoryForReconciliation: the combined entrypoint finds all 3 Florence items from metro ownership ALONE — no region term needed for an already-launched metro', async () => {
  const q = fakeQuery({ florence: FLORENCE_ITEMS }, [])
  const result = await fetchExistingProductionInventoryForReconciliation({ metroSlug: 'florence', regionSearchTerms: [] }, q)
  assert.equal(result.length, 3)
})

test('fetchExistingProductionInventoryForReconciliation: de-duplicates an item found by BOTH the metro-scoped and region-term path', async () => {
  const q = fakeQuery({ florence: FLORENCE_ITEMS }, FLORENCE_ITEMS)
  const result = await fetchExistingProductionInventoryForReconciliation({ metroSlug: 'florence', regionSearchTerms: ['Florence', 'Firenze'] }, q)
  assert.equal(result.length, 3, 'each item appears once, never duplicated across the two sources')
})

test('fetchExistingProductionInventoryForReconciliation: still finds cross-metro content (Green Bay/Milwaukee pattern) via region terms when metroSlug is omitted (metro does not exist yet)', async () => {
  const q = fakeQuery({}, [VIENNA_ITEM])
  const result = await fetchExistingProductionInventoryForReconciliation({ regionSearchTerms: ['Wien'] }, q)
  assert.equal(result.length, 1)
  assert.equal(result[0]!.id, 'vi-1')
})

test('fetchExistingProductionInventoryForReconciliation: an item that is region-matchable in the WRONG language is still found once metroSlug ownership is available, proving the metro-scoped path is now the load-bearing fix, not the alias list', async () => {
  // Deliberately supply only the WRONG-language term (no "Firenze") to prove the
  // region path alone would still miss these — metro ownership is what saves it.
  const q = fakeQuery({ florence: FLORENCE_ITEMS }, [])
  const result = await fetchExistingProductionInventoryForReconciliation({ metroSlug: 'florence', regionSearchTerms: ['Florence'] }, q)
  assert.equal(result.length, 3, 'metro ownership alone is sufficient — the region term contributes nothing extra here and that is fine')
})
