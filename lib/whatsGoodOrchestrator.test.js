// What's Good V1 — whatsGoodOrchestrator.js unit tests. Stubbed Supabase
// client and stubbed storage throughout — no production DB access.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getWhatsGoodSelection } from './whatsGoodOrchestrator.js'

const NOW = new Date('2026-09-02T12:00:00.000Z')
const USER_ID = 'user-1'
const LOCATION = { latitude: 40.0, longitude: -105.0 }

function chainable(result) {
  const handler = {
    select: () => handler,
    eq: () => handler,
    in: () => handler,
    not: () => handler,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return handler
}

function makeItem(id, overrides = {}) {
  return { id, maps_lat: 40.0, maps_lng: -105.0, is_universal: false, ...overrides }
}

function makeStubClient({ items = [], checkins = [], exposures = [], momentumRows = [], upsertCalls = [] } = {}) {
  return {
    from(table) {
      if (table === 'items') return chainable({ data: items, error: null })
      if (table === 'check_ins') return chainable({ data: checkins, error: null })
      if (table === 'whats_good_exposures') {
        return {
          ...chainable({ data: exposures, error: null }),
          upsert(rows) {
            upsertCalls.push(rows)
            return Promise.resolve({ data: rows, error: null })
          },
        }
      }
      if (table === 'list_items') return chainable({ data: [], error: null }) // no Bonus Drops in these fixtures
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: () => Promise.resolve({ data: momentumRows, error: null }),
  }
}

function makeStubStorage(initial = null) {
  let value = initial
  return {
    async getItem() {
      return value
    },
    async setItem(_key, val) {
      value = val
    },
    async removeItem() {
      value = null
    },
  }
}

test('end to end: assembles candidates, ranks, writes exposure, saves session', async () => {
  const upsertCalls = []
  const client = makeStubClient({
    items: [makeItem('a'), makeItem('b'), makeItem('c')],
    upsertCalls,
  })
  const storage = makeStubStorage()

  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp-1',
    now: NOW,
    client,
    storage,
  })

  assert.equal(result.fromCache, false)
  assert.equal(result.itemIds.length, 3)
  assert.equal(upsertCalls.length, 1, 'exposure must be written exactly once')
  assert.equal(upsertCalls[0].length, 3, 'exposure recorded for exactly the 3 displayed items, not the whole pool')

  const savedRaw = await storage.getItem()
  const saved = JSON.parse(savedRaw)
  assert.deepEqual(saved.itemIds, result.itemIds)
  assert.equal(saved.fingerprint, 'fp-1')
})

test('cached session is preserved (short interruption) -> adapter/exposure/session-save are all skipped', async () => {
  const upsertCalls = []
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c')], upsertCalls })
  const cachedPayload = JSON.stringify({
    itemIds: ['cached-1', 'cached-2', 'cached-3'],
    generatedAt: new Date(NOW.getTime() - 60 * 1000).toISOString(), // 1 minute ago
    fingerprint: 'whatever',
  })
  const storage = makeStubStorage(cachedPayload)

  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'totally-different-fingerprint',
    now: NOW,
    client,
    storage,
  })

  assert.equal(result.fromCache, true)
  assert.deepEqual(result.itemIds, ['cached-1', 'cached-2', 'cached-3'])
  assert.equal(upsertCalls.length, 0, 'must not write exposure when serving from cache')
})

test('forceRefresh bypasses the cache even for a fresh session', async () => {
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c')] })
  const cachedPayload = JSON.stringify({
    itemIds: ['cached-1'],
    generatedAt: NOW.toISOString(),
    fingerprint: 'fp-1',
  })
  const storage = makeStubStorage(cachedPayload)

  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp-1',
    now: NOW,
    client,
    storage,
    forceRefresh: true,
  })

  assert.equal(result.fromCache, false)
})

test('Home Rail 5 exclusion survives end to end', async () => {
  const client = makeStubClient({ items: [makeItem('rail-1'), makeItem('good-1'), makeItem('good-2'), makeItem('good-3')] })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: ['rail-1'],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.ok(!result.itemIds.includes('rail-1'))
})

test('Universal fallback fills only an actual shortage, never displaces local candidates', async () => {
  // Only 1 local (non-universal) candidate available -> selector returns
  // at most 1 -> Universal fallback should fill the remaining 2 slots.
  const client = makeStubClient({ items: [makeItem('local-1')] })
  const allLocatedItems = [
    makeItem('local-1'),
    makeItem('universal-1', { is_universal: true, maps_lat: null, maps_lng: null }),
    makeItem('universal-2', { is_universal: true, maps_lat: null, maps_lng: null }),
    makeItem('universal-3', { is_universal: true, maps_lat: null, maps_lng: null }),
  ]
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems,
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.equal(result.itemIds.length, 3)
  assert.ok(result.itemIds.includes('local-1'), 'the one real local candidate must still be included, not displaced')
  const universalUsed = result.itemIds.filter((id) => id.startsWith('universal-'))
  assert.equal(universalUsed.length, 2, 'exactly the shortage (2) should be filled from Universal, not more')
})

test('Universal fallback is not invoked at all when 3 real local candidates already exist', async () => {
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c')] })
  const allLocatedItems = [makeItem('a'), makeItem('b'), makeItem('c'), makeItem('universal-1', { is_universal: true })]
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems,
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.ok(!result.itemIds.includes('universal-1'))
})

// ---------------------------------------------------------------------------
// Tester instrumentation (debug payload)
// ---------------------------------------------------------------------------

test('debug payload includes the full candidate pool with freshnessClass and momentumScore, never a userId', async () => {
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c')] })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.equal(result.debug.fromCache, false)
  assert.equal(result.debug.candidatePool.length, 3)
  for (const c of result.debug.candidatePool) {
    assert.ok('itemId' in c && 'everCheckedOff' in c && 'lastShownAt' in c && 'momentumScore' in c && 'freshnessClass' in c)
    assert.ok(!('userId' in c), 'candidate pool debug rows must never carry a userId')
  }
})

test('debug payload for a cache hit reports fromCache=true and an empty candidate pool (nothing recomputed)', async () => {
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c')] })
  const cachedPayload = JSON.stringify({
    itemIds: ['cached-1'],
    generatedAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
    fingerprint: 'fp-cached',
  })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp-different',
    now: NOW,
    client,
    storage: makeStubStorage(cachedPayload),
  })
  assert.equal(result.debug.fromCache, true)
  assert.deepEqual(result.debug.candidatePool, [])
})

test('no candidates at all -> empty result, no exposure write, no session save', async () => {
  const upsertCalls = []
  const client = makeStubClient({ items: [], upsertCalls })
  const storage = makeStubStorage()
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage,
  })
  assert.deepEqual(result.itemIds, [])
  assert.equal(upsertCalls.length, 0)
  assert.equal(await storage.getItem(), null)
})

// ---------------------------------------------------------------------------
// REGRESSION: deterministic refill safety net (backupItemIds) — see
// lib/useWhatsGood.js's hydration step, which consumes this if a selected
// ID still somehow can't be rendered even after the root-cause eligibility
// fix in whatsGoodDataAdapter.js.
// ---------------------------------------------------------------------------

test('backupItemIds contains the next-ranked candidates beyond the selected 3, in ranked order, never overlapping the selected set', async () => {
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c'), makeItem('d'), makeItem('e')] })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.equal(result.itemIds.length, 3)
  assert.ok(result.backupItemIds.length > 0)
  for (const id of result.backupItemIds) {
    assert.ok(!result.itemIds.includes(id), 'a backup ID must never duplicate an already-selected ID')
  }
})

test('backupItemIds is empty when there are no extra candidates beyond the selected set', async () => {
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c')] })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.deepEqual(result.backupItemIds, [])
})

test('cache-hit path returns an empty backupItemIds array (nothing was recomputed to draw backups from)', async () => {
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c')] })
  const cachedPayload = JSON.stringify({ itemIds: ['cached-1'], generatedAt: NOW.toISOString(), fingerprint: 'fp' })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(cachedPayload),
  })
  assert.equal(result.fromCache, true)
  assert.deepEqual(result.backupItemIds, [])
})
