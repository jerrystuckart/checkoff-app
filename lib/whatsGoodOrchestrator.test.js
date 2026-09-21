// What's Good V1 — whatsGoodOrchestrator.js unit tests. Stubbed Supabase
// client and stubbed storage throughout — no production DB access.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getWhatsGoodSelection, __resetWhatsGoodRequestGenerationForTests } from './whatsGoodOrchestrator.js'

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
    // 2026-09-21 follow-up fix: a cache with no recorded location is now
    // incompatible whenever the caller (the real orchestrator always does)
    // supplies a currentLocation — see the dedicated test below. This test
    // is about the short-interruption guarantee itself, so it carries a
    // location that matches the current call.
    location: LOCATION,
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

// ---------------------------------------------------------------------------
// FIX (2026-09-21 follow-up field bug): cache compatibility now REQUIRES
// recorded location (and, when supplied, resolved metro identity) — a cache
// missing either is treated as incompatible and regenerated, never assumed
// fine just because it's recent. This is the actual remaining gap that let
// a Vienna item (Strudlhofstiege) survive in What's Good after a900be1.
// ---------------------------------------------------------------------------

test('Test 5 (orchestrator level): a cached session with no recorded location is INVALID once the real caller supplies userLocation -> regenerates a fresh selection instead of serving stale itemIds', async () => {
  const upsertCalls = []
  const client = makeStubClient({ items: [makeItem('fresh-a'), makeItem('fresh-b'), makeItem('fresh-c')], upsertCalls })
  const cachedPayload = JSON.stringify({
    itemIds: ['stale-cached-1'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000).toISOString(), // well within the short-interruption window
    fingerprint: 'whatever',
    // No `location` field at all.
  })
  const storage = makeStubStorage(cachedPayload)

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

  assert.equal(result.fromCache, false, 'a cache with no recorded location must not be trusted, even though it is recent')
  assert.ok(!result.itemIds.includes('stale-cached-1'))
  assert.deepEqual(result.itemIds.sort(), ['fresh-a', 'fresh-b', 'fresh-c'])
})

test('Test 6 (orchestrator level): a cached session whose resolvedMetroId is Vienna is INVALID for a Munich currentMetroId, even with recent, location-matching coordinates -> regenerates', async () => {
  const client = makeStubClient({ items: [makeItem('marienplatz', { maps_lat: 48.1374, maps_lng: 11.5755 })] })
  const cachedPayload = JSON.stringify({
    itemIds: ['strudlhofstiege'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000).toISOString(),
    fingerprint: 'munich-fp',
    location: MUNICH_LOC,
    resolvedMetroId: 'vienna-metro-id',
  })
  const storage = makeStubStorage(cachedPayload)

  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: MUNICH_LOC,
    currentMetroId: 'munich-metro-id',
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'munich-fp',
    now: NOW,
    client,
    storage,
  })

  assert.equal(result.fromCache, false, 'resolved metro identity mismatch must invalidate the cache independently of raw distance')
  assert.ok(!result.itemIds.includes('strudlhofstiege'))
})

test('a freshly-generated session persists the resolvedMetroId it was given, so a LATER call can compare against it', async () => {
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c')] })
  const storage = makeStubStorage()
  await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    currentMetroId: 'munich-metro-id',
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage,
  })
  const saved = JSON.parse(await storage.getItem())
  assert.equal(saved.resolvedMetroId, 'munich-metro-id')
})

test('the cache-hit path never writes to storage (extends existing exposure-skip coverage to the persisted session itself)', async () => {
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c')] })
  const cachedPayload = JSON.stringify({
    itemIds: ['cached-1'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000).toISOString(),
    fingerprint: 'fp',
    location: LOCATION,
    resolvedMetroId: 'munich-metro-id',
  })
  const storage = makeStubStorage(cachedPayload)
  let setItemCalls = 0
  const wrappedStorage = {
    ...storage,
    async setItem(...args) {
      setItemCalls++
      return storage.setItem(...args)
    },
  }
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    currentMetroId: 'munich-metro-id',
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: wrappedStorage,
  })
  assert.equal(result.fromCache, true)
  assert.equal(setItemCalls, 0, 'a cache hit must never rewrite the session cache')
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
    location: LOCATION, // must match/be within radius of the current call for this cache-hit test's premise to hold post-2026-09-21-fix
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
  const cachedPayload = JSON.stringify({ itemIds: ['cached-1'], generatedAt: NOW.toISOString(), fingerprint: 'fp', location: LOCATION })
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

// ---------------------------------------------------------------------------
// REGRESSION (2026-09-21 field bug): Munich/Vienna end-to-end — geographic
// eligibility, foreground-travel recompute, anonymous path, and the
// stale-request race condition.
// ---------------------------------------------------------------------------

const MUNICH_LOC = { latitude: 48.1351, longitude: 11.5820 }
const VIENNA_LOC = { latitude: 48.2082, longitude: 16.3738 } // ~355mi from Munich

test('Test 3: with Munich coordinates, assembling candidates end-to-end (adapter + orchestrator) never surfaces a Vienna item (e.g. Strudlhofstiege) — it is filtered out by geographic eligibility, not merely deprioritized', async () => {
  const client = makeStubClient({
    items: [
      makeItem('strudlhofstiege', { maps_lat: 48.21, maps_lng: 16.37 }), // Vienna
      makeItem('marienplatz', { maps_lat: 48.1374, maps_lng: 11.5755 }), // Munich
    ],
  })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: MUNICH_LOC,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'munich-fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.ok(!result.itemIds.includes('strudlhofstiege'), 'a ~355mi-away Vienna item must never be selected while physically in Munich')
  assert.ok(result.itemIds.includes('marienplatz'))
})

test('Test 7: foregrounding after travel from Vienna to Munich recomputes the What\'s Good selection (not just the metro header) — a fresh call for the new location produces a genuinely different, non-Vienna result', async () => {
  const storage = makeStubStorage()

  // First call: still in Vienna. Only a Vienna-local item is available.
  const viennaClient = makeStubClient({ items: [makeItem('strudlhofstiege', { maps_lat: 48.21, maps_lng: 16.37 })] })
  const viennaResult = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: VIENNA_LOC,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'vienna-fp',
    now: NOW,
    client: viennaClient,
    storage,
  })
  assert.deepEqual(viennaResult.itemIds, ['strudlhofstiege'])

  // App foregrounds later in Munich. New location -> new fingerprint -> the
  // adapter's own candidate pool (Munich-local only) — the cached Vienna
  // session must not be silently preserved, and the result must reflect
  // the new physical reality end to end.
  const munichClient = makeStubClient({ items: [makeItem('marienplatz', { maps_lat: 48.1374, maps_lng: 11.5755 })] })
  const later = new Date(NOW.getTime() + 10 * 60 * 1000) // 10 minutes later — beyond the short-interruption window too, but the location check must catch it even inside that window
  const munichResult = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: MUNICH_LOC,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'munich-fp',
    now: later,
    client: munichClient,
    storage,
  })
  assert.equal(munichResult.fromCache, false, 'the stale Vienna session must not be served for the new Munich context')
  assert.deepEqual(munichResult.itemIds, ['marienplatz'])
  assert.ok(!munichResult.itemIds.includes('strudlhofstiege'))
})

test('Test 11: the anonymous (no userId) path applies the exact same geographic eligibility filtering as the authenticated path', async () => {
  const client = makeStubClient({
    items: [
      makeItem('strudlhofstiege', { maps_lat: 48.21, maps_lng: 16.37 }),
      makeItem('marienplatz', { maps_lat: 48.1374, maps_lng: 11.5755 }),
    ],
  })
  const result = await getWhatsGoodSelection({
    userId: null,
    userLocation: MUNICH_LOC,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'munich-fp-anon',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.ok(!result.itemIds.includes('strudlhofstiege'), 'anonymous users must get the same geographic filtering as signed-in users')
  assert.ok(result.itemIds.includes('marienplatz'))
})

/** A chainable stub whose final resolution is delayed by `delayMs` — simulates a slow in-flight query. */
function delayedChainable(result, delayMs) {
  const handler = {
    select: () => handler,
    eq: () => handler,
    in: () => handler,
    not: () => handler,
    then: (resolve, reject) => {
      setTimeout(() => Promise.resolve(result).then(resolve, reject), delayMs)
    },
  }
  return handler
}

function makeDelayedStubClient(items, delayMs, upsertCalls = []) {
  return {
    from(table) {
      if (table === 'items') return delayedChainable({ data: items, error: null }, delayMs)
      if (table === 'check_ins') return chainable({ data: [], error: null })
      if (table === 'whats_good_exposures') {
        return {
          ...chainable({ data: [], error: null }),
          upsert(rows) {
            upsertCalls.push(rows)
            return Promise.resolve({ data: rows, error: null })
          },
        }
      }
      if (table === 'list_items') return chainable({ data: [], error: null })
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  }
}

test('Test 12: a stale in-flight request (started first, resolves LAST) must not overwrite a newer request\'s already-persisted result — the newer response always wins', async () => {
  __resetWhatsGoodRequestGenerationForTests()
  const storage = makeStubStorage()

  // Older call: for Vienna, but artificially slow (simulates a real network race).
  const viennaClient = makeDelayedStubClient([makeItem('strudlhofstiege', { maps_lat: 48.21, maps_lng: 16.37 })], 40)
  // Newer call: for Munich, fast.
  const munichClient = makeDelayedStubClient([makeItem('marienplatz', { maps_lat: 48.1374, maps_lng: 11.5755 })], 0)

  const viennaPromise = getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: VIENNA_LOC,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'vienna-fp',
    now: NOW,
    client: viennaClient,
    storage,
    forceRefresh: true,
  })

  const munichResult = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: MUNICH_LOC,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'munich-fp',
    now: NOW,
    client: munichClient,
    storage,
    forceRefresh: true,
  })

  const viennaResult = await viennaPromise

  assert.equal(munichResult.stale, false)
  assert.deepEqual(munichResult.itemIds, ['marienplatz'])
  assert.equal(viennaResult.stale, true, 'the older, slower call must be reported stale once a newer call has already completed')

  const savedRaw = await storage.getItem()
  const saved = JSON.parse(savedRaw)
  assert.deepEqual(saved.itemIds, ['marienplatz'], 'the stale Vienna response must never overwrite the newer Munich session-cache write')
})
