// What's Good V1 — whatsGoodOrchestrator.js unit tests. Stubbed Supabase
// client and stubbed storage throughout — no production DB access.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getWhatsGoodSelection, __resetWhatsGoodRequestGenerationForTests } from './whatsGoodOrchestrator.js'
import { COVERAGE_MODE } from './whatsGoodCoverageMode.js'

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
    // 2026-09-22 coverage-mode policy fix: a cache is only ever trusted when
    // it carries the current schema (schemaVersion/coverageMode) — see
    // lib/whatsGoodSessionCache.test.js's dedicated schema-check tests.
    schemaVersion: 2,
    coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT,
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
    schemaVersion: 2,
    coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT,
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

// ---------------------------------------------------------------------------
// REGRESSION (2026-09-21 second follow-up field bug): What's Good was
// showing generic is_universal=true filler instead of real local venues.
// Root cause was two-fold: (1) this module's old fillWithUniversal()
// backfilled a personalized shortfall straight from Universal items, and
// (2) whatsGoodDataAdapter.js's verifyNearbyForRender() explicitly EXEMPTED
// Universal items from the final render gate ("not a location-based card"),
// so they sailed straight through what was supposed to be the unconditional
// last check. Both are fixed: fillWithUniversal is deleted (replaced with
// fillFromLocalPool, which only ever broadens within the SAME
// geographically-eligible local pool the adapter already assembled), and
// verifyNearbyForRender/isEligibleForWhatsGood now reject Universal items
// unconditionally. See decision `whats_good_v1_never_universal`.
//
// 2026-09-22 CORRECTION: `whats_good_v1_never_universal` was itself too
// absolute — see lib/whatsGoodCoverageMode.js. A genuine local shortage in a
// SUPPORTED metro (1-2 eligible local items, SUPPORTED_SPARSE) now
// legitimately gets a Universal TOP-UP for the remaining slots only, never
// displacing a local item. The test immediately below is intentionally
// UPDATED (not merely loosened) to assert this corrected behavior — it
// previously asserted the pre-correction absolute-rejection outcome.
// ---------------------------------------------------------------------------

test('UPDATED 2026-09-22 (was: "local-pool fallback fills a shortage... never from Universal"): a genuine SUPPORTED_SPARSE shortage (1 local candidate, real supported metro) now fills remaining slots with a Universal top-up, local item always first, never displaced', async () => {
  // Only 1 local (non-universal) candidate available in the adapter's own
  // query result -> selector returns at most 1 -> SUPPORTED_SPARSE mode
  // (1 <= count < target 3) -> the local item is kept AND the 2 remaining
  // slots are filled from allLocatedItems' Universal pool, deterministically
  // (sorted by id) and without duplicates.
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
  assert.deepEqual(result.itemIds, ['local-1', 'universal-1', 'universal-2'], 'SUPPORTED_SPARSE: the local item stays first, remaining slots filled with Universal items up to target count')
  assert.equal(result.coverageMode, COVERAGE_MODE.SUPPORTED_SPARSE)
})

test('a genuine local-inventory shortage with NO Universal items available in allLocatedItems still shows fewer cards, honestly, never backfilled from another metro', async () => {
  const client = makeStubClient({ items: [makeItem('local-1')] })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [makeItem('local-1')], // no Universal items at all
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.deepEqual(result.itemIds, ['local-1'])
})

test('local-pool fallback broadens within the adapter-assembled pool (up to CANDIDATE_POOL_SIZE=15) when the personalized top-3 is short but more local candidates exist', async () => {
  // 5 real local candidates exist in the pool; selectWhatsGood's top-3 cut
  // alone would only pick 3, but since ranked already contains all 5, a
  // shortage can never actually occur here -- this test instead proves the
  // NORMAL (non-shortage) path already surfaces exactly 3 real local ids,
  // never touching Universal, corroborating that fillFromLocalPool is only
  // a no-op safety net when the true adapter-level pool is this healthy.
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c'), makeItem('d'), makeItem('e')] })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [makeItem('universal-1', { is_universal: true })],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.equal(result.itemIds.length, 3)
  assert.ok(result.itemIds.every((id) => ['a', 'b', 'c', 'd', 'e'].includes(id)))
})

test('Universal items are never selected even when 3 real local candidates already exist', async () => {
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

test('debug.localFallbackUsed reports true only when the personalized top-3 was actually short', async () => {
  const shortClient = makeStubClient({ items: [makeItem('local-1')] })
  const shortResult = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client: shortClient,
    storage: makeStubStorage(),
  })
  assert.equal(shortResult.debug.localFallbackUsed, true)

  const fullClient = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c')] })
  const fullResult = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client: fullClient,
    storage: makeStubStorage(),
  })
  assert.equal(fullResult.debug.localFallbackUsed, false)
})

// 2026-09-22 CORRECTION: this test previously asserted that a genuinely
// empty local pool produces an empty result "never Universal-filled" — that
// was the pre-correction `whats_good_v1_never_universal` absolute rule.
// Zero eligible local items (regardless of Universal availability) is
// exactly the UNSUPPORTED coverage mode (e.g. San Francisco — confirmed via
// a read-only query during this fix: no metro_areas row within
// MAX_NEARBY_RADIUS_M of it), and UNSUPPORTED now legitimately shows
// Universal items as the SOLE content, never a local/place item. Updated,
// not loosened — the "never a distant-metro local item" guarantee this test
// also implicitly covered still holds (there are none in this fixture to
// begin with; see the dedicated UNSUPPORTED tests below for that guarantee
// explicitly).
test('UPDATED 2026-09-22 (was: "...never a Universal-filled one"): a genuinely empty local pool (UNSUPPORTED coverage mode) now produces a Universal-only result, up to target count', async () => {
  const client = makeStubClient({ items: [] })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [makeItem('universal-1', { is_universal: true }), makeItem('universal-2', { is_universal: true })],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.deepEqual(result.itemIds, ['universal-1', 'universal-2'])
  assert.equal(result.coverageMode, COVERAGE_MODE.UNSUPPORTED)
})

test('a genuinely empty local pool AND no Universal items available -> empty result, honestly (never backfilled from another metro)', async () => {
  const client = makeStubClient({ items: [] })
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
  assert.deepEqual(result.itemIds, [])
  assert.equal(result.coverageMode, COVERAGE_MODE.UNSUPPORTED)
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
    schemaVersion: 2,
    coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT,
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
  const cachedPayload = JSON.stringify({
    schemaVersion: 2,
    coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT,
    itemIds: ['cached-1'],
    generatedAt: NOW.toISOString(),
    fingerprint: 'fp',
    location: LOCATION,
  })
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

// ---------------------------------------------------------------------------
// 2026-09-22 coverage-mode policy fix — end-to-end orchestrator coverage.
// San Francisco (UNSUPPORTED — no supported metro at all, confirmed via a
// read-only Supabase query during this fix: no metro_areas row within
// MAX_NEARBY_RADIUS_M of San Francisco's coordinates), pending/unavailable
// location states, sparse-area local+Universal composition, and the
// coverage-mode-aware generation/stale-request guard.
// ---------------------------------------------------------------------------

const SF_LOC = { latitude: 37.7749, longitude: -122.4194 }

test('San Francisco (real coordinates, confirmed unsupported): no local candidates at all -> UNSUPPORTED mode, Universal-only result up to target count, never a distant-metro item', async () => {
  const client = makeStubClient({ items: [] }) // no items within MAX_NEARBY_RADIUS_M of SF
  const allLocatedItems = [
    makeItem('universal-1', { is_universal: true, maps_lat: null, maps_lng: null }),
    makeItem('universal-2', { is_universal: true, maps_lat: null, maps_lng: null }),
    makeItem('universal-3', { is_universal: true, maps_lat: null, maps_lng: null }),
    makeItem('phoenix-place', { maps_lat: 33.4484, maps_lng: -112.0740 }), // a distant metro's item, must never appear
  ]
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: SF_LOC,
    homeRailItemIds: [],
    allLocatedItems,
    currentFingerprint: 'sf-fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.equal(result.coverageMode, COVERAGE_MODE.UNSUPPORTED)
  assert.deepEqual(result.itemIds, ['universal-1', 'universal-2', 'universal-3'])
  assert.ok(!result.itemIds.includes('phoenix-place'), 'a distant metro item must never substitute for Universal content')
})

test('San Francisco with fewer than target Universal items available -> shows as many Universal items as exist, honestly, no padding', async () => {
  const client = makeStubClient({ items: [] })
  const allLocatedItems = [makeItem('universal-1', { is_universal: true, maps_lat: null, maps_lng: null })]
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: SF_LOC,
    homeRailItemIds: [],
    allLocatedItems,
    currentFingerprint: 'sf-fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.deepEqual(result.itemIds, ['universal-1'])
})

test('PENDING_LOCATION: never computes a selection, never trusts a cache, returns an empty result with coverageMode PENDING_LOCATION', async () => {
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c')] })
  const cachedPayload = JSON.stringify({
    schemaVersion: 2,
    coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT,
    itemIds: ['stale-cached'],
    generatedAt: NOW.toISOString(),
    fingerprint: 'fp',
    location: LOCATION,
  })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: null,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(cachedPayload),
    locationState: 'pending',
  })
  assert.deepEqual(result.itemIds, [])
  assert.equal(result.coverageMode, COVERAGE_MODE.PENDING_LOCATION)
})

test('LOCATION_UNAVAILABLE with no explicit selection: honest empty result, coverageMode LOCATION_UNAVAILABLE, no fabricated content', async () => {
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c')] })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: null,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
    locationState: 'unavailable',
    hasExplicitSelection: false,
  })
  assert.deepEqual(result.itemIds, [])
  assert.equal(result.coverageMode, COVERAGE_MODE.LOCATION_UNAVAILABLE)
})

test('LOCATION_UNAVAILABLE WITH an explicit selection: evaluated against that city\'s own coordinates, behaving per ITS coverage mode (here: SUPPORTED_SUFFICIENT)', async () => {
  // The caller (lib/useWhatsGood.js) is responsible for substituting the
  // explicitly-selected city's coordinates as `userLocation` when GPS is
  // unavailable — this orchestrator-level test proves that substituted
  // location is evaluated identically to a real 'ready' GPS fix once
  // hasExplicitSelection is true.
  const client = makeStubClient({
    items: [
      makeItem('a', { maps_lat: 48.1374, maps_lng: 11.5755 }),
      makeItem('b', { maps_lat: 48.1374, maps_lng: 11.5755 }),
      makeItem('c', { maps_lat: 48.1374, maps_lng: 11.5755 }),
    ],
  })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: MUNICH_LOC, // the explicitly-selected city's own coordinates
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
    locationState: 'unavailable',
    hasExplicitSelection: true,
  })
  assert.equal(result.coverageMode, COVERAGE_MODE.SUPPORTED_SUFFICIENT)
  assert.equal(result.itemIds.length, 3)
})

test('LOCATION_UNAVAILABLE WITH an explicit selection for an unsupported city: still UNSUPPORTED (Universal only), never fabricated local content', async () => {
  const client = makeStubClient({ items: [] })
  const allLocatedItems = [makeItem('universal-1', { is_universal: true, maps_lat: null, maps_lng: null })]
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: SF_LOC,
    homeRailItemIds: [],
    allLocatedItems,
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
    locationState: 'unavailable',
    hasExplicitSelection: true,
  })
  assert.equal(result.coverageMode, COVERAGE_MODE.UNSUPPORTED)
  assert.deepEqual(result.itemIds, ['universal-1'])
})

test('a stale SUPPORTED_SPARSE cache is recomputed once fresh inventory shows the current context is actually SUPPORTED_SUFFICIENT (Step 8 drift check, exercised end to end through the orchestrator)', async () => {
  const client = makeStubClient({ items: [makeItem('a'), makeItem('b'), makeItem('c'), makeItem('d')] }) // now plenty of local inventory
  const cachedPayload = JSON.stringify({
    schemaVersion: 2,
    coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE,
    itemIds: ['stale-local', 'stale-universal-1', 'stale-universal-2'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000).toISOString(), // within the short-interruption window
    fingerprint: 'totally-different-fp',
    location: LOCATION,
  })
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
  assert.equal(result.fromCache, false, 'stale sparse composition must be recomputed once local inventory has genuinely grown')
  assert.equal(result.coverageMode, COVERAGE_MODE.SUPPORTED_SUFFICIENT)
  assert.ok(!result.itemIds.includes('stale-universal-1'))
})

test('a still-genuinely-sparse cache IS preserved (drift check does not cause unnecessary recomputation when nothing has actually changed)', async () => {
  const client = makeStubClient({ items: [makeItem('local-1')] }) // still only 1 local item
  const cachedPayload = JSON.stringify({
    schemaVersion: 2,
    coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE,
    itemIds: ['local-1', 'universal-1', 'universal-2'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000).toISOString(),
    fingerprint: 'totally-different-fp',
    location: LOCATION,
  })
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
  assert.deepEqual(result.itemIds, ['local-1', 'universal-1', 'universal-2'])
})

test('an old-shaped cache (missing schemaVersion/coverageMode entirely — pre-2026-09-22) is invalidated and recomputed, never trusted regardless of how recent or otherwise-compatible it is', async () => {
  const client = makeStubClient({ items: [makeItem('fresh-a'), makeItem('fresh-b'), makeItem('fresh-c')] })
  const oldShapedPayload = JSON.stringify({
    itemIds: ['old-cached-1'],
    generatedAt: NOW.toISOString(), // brand new by age
    fingerprint: 'fp',
    location: LOCATION, // matches exactly
    resolvedMetroId: null,
    // no schemaVersion, no coverageMode at all — the exact pre-fix shape
  })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(oldShapedPayload),
  })
  assert.equal(result.fromCache, false)
  assert.deepEqual(result.itemIds.sort(), ['fresh-a', 'fresh-b', 'fresh-c'])
})

test('a freshly-persisted session always carries the current schemaVersion and the real coverageMode it was computed under', async () => {
  const client = makeStubClient({ items: [makeItem('a')] }) // SUPPORTED_SPARSE (1 local item)
  const storage = makeStubStorage()
  await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: [],
    allLocatedItems: [makeItem('universal-1', { is_universal: true, maps_lat: null, maps_lng: null })],
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage,
  })
  const saved = JSON.parse(await storage.getItem())
  assert.equal(saved.schemaVersion, 2)
  assert.equal(saved.coverageMode, COVERAGE_MODE.SUPPORTED_SPARSE)
})

test('generation guard extends to coverage mode, not just the item list: an older, slower UNSUPPORTED (San Francisco) call resolving AFTER a newer SUPPORTED_SUFFICIENT (Munich) call must not overwrite the newer coverageMode in the persisted session', async () => {
  __resetWhatsGoodRequestGenerationForTests()
  const storage = makeStubStorage()

  const sfClient = makeDelayedStubClient([], 40) // UNSUPPORTED — slow
  const munichClient = makeDelayedStubClient(
    [makeItem('marienplatz', { maps_lat: 48.1374, maps_lng: 11.5755 }), makeItem('b', { maps_lat: 48.1374, maps_lng: 11.5755 }), makeItem('c', { maps_lat: 48.1374, maps_lng: 11.5755 })],
    0
  ) // SUPPORTED_SUFFICIENT — fast

  const sfPromise = getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: SF_LOC,
    homeRailItemIds: [],
    allLocatedItems: [makeItem('universal-1', { is_universal: true, maps_lat: null, maps_lng: null })],
    currentFingerprint: 'sf-fp',
    now: NOW,
    client: sfClient,
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

  const sfResult = await sfPromise

  assert.equal(munichResult.stale, false)
  assert.equal(munichResult.coverageMode, COVERAGE_MODE.SUPPORTED_SUFFICIENT)
  assert.equal(sfResult.stale, true, 'the older, slower UNSUPPORTED call must be reported stale once the newer call has already completed')

  const saved = JSON.parse(await storage.getItem())
  assert.equal(saved.coverageMode, COVERAGE_MODE.SUPPORTED_SUFFICIENT, 'the stale UNSUPPORTED response must never overwrite the newer, already-persisted coverageMode')
})

// ---------------------------------------------------------------------------
// REGRESSION (2026-09-23 field bug — real-device screenshot): Home showed a
// resolved Munich metro + Near You showing real Munich items at 0.4mi + an
// "unsupported city" What's Good card, all at once. Root cause: coverage
// mode was derived from `ranked.length` (post-Home-Rail-exclusion), which
// can hit 0 even in a fully supported metro when the nearest local items are
// already on the Home Rail. Fixed by deriving coverage mode from the
// adapter's separately-computed, pre-exclusion `eligibleLocalCount` instead.
// ---------------------------------------------------------------------------

test('REGRESSION (screenshot state): resolved Munich metro, all eligible local items already on Home Rail (ranked/candidates -> 0), but full eligible inventory >= target -> SUPPORTED_SUFFICIENT, never UNSUPPORTED, composition is local-only', async () => {
  const MUNICH_ITEMS_LOC = { latitude: 48.1351, longitude: 11.5820 }
  const client = makeStubClient({
    items: [
      makeItem('marienplatz', { maps_lat: 48.1374, maps_lng: 11.5755 }),
      makeItem('viktualienmarkt', { maps_lat: 48.1353, maps_lng: 11.5763 }),
      makeItem('englischer-garten', { maps_lat: 48.1642, maps_lng: 11.6056 }),
    ],
  })
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: MUNICH_ITEMS_LOC,
    currentMetroId: 'munich-metro-id',
    // All 3 eligible local items are already shown on the Home Rail — this
    // is exactly the screenshot scenario: the candidate pool (post-
    // exclusion) is empty, but real local inventory obviously exists.
    homeRailItemIds: ['marienplatz', 'viktualienmarkt', 'englischer-garten'],
    allLocatedItems: [],
    currentFingerprint: 'munich-fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.equal(result.coverageMode, COVERAGE_MODE.SUPPORTED_SUFFICIENT, 'must never derive UNSUPPORTED merely because personalization/Home-Rail-exclusion emptied the candidate pool')
  assert.deepEqual(result.itemIds, [], 'no Universal filler either — SUPPORTED_SUFFICIENT with a fully-excluded local pool honestly shows fewer/no cards, never fabricated content')
})

test('sparse supported inventory (1-2 eligible local items, personalization/candidates empty) -> SUPPORTED_SPARSE, local-first then Universal top-up', async () => {
  const client = makeStubClient({
    items: [makeItem('local-only-1', { maps_lat: 48.1374, maps_lng: 11.5755 })],
  })
  const allLocatedItems = [
    makeItem('local-only-1', { maps_lat: 48.1374, maps_lng: 11.5755 }),
    makeItem('universal-1', { is_universal: true, maps_lat: null, maps_lng: null }),
    makeItem('universal-2', { is_universal: true, maps_lat: null, maps_lng: null }),
  ]
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: { latitude: 48.1351, longitude: 11.5820 },
    currentMetroId: 'munich-metro-id',
    // This one item is already on Home Rail -> candidates/ranked = 0, but
    // eligibleLocalCount = 1 -> SUPPORTED_SPARSE, not UNSUPPORTED.
    homeRailItemIds: ['local-only-1'],
    allLocatedItems,
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.equal(result.coverageMode, COVERAGE_MODE.SUPPORTED_SPARSE)
  assert.deepEqual(result.itemIds, ['universal-1', 'universal-2'], 'local item itself is excluded from candidates (Home Rail), but Universal top-up still fills the remaining slots per SUPPORTED_SPARSE composition')
})

test('San Francisco (zero eligible local inventory at all) still correctly yields UNSUPPORTED, universal-only composition — no regression from the authoritative-count change', async () => {
  const client = makeStubClient({ items: [] })
  const allLocatedItems = [
    makeItem('universal-1', { is_universal: true, maps_lat: null, maps_lng: null }),
    makeItem('universal-2', { is_universal: true, maps_lat: null, maps_lng: null }),
  ]
  const result = await getWhatsGoodSelection({
    userId: USER_ID,
    userLocation: SF_LOC,
    currentMetroId: null,
    homeRailItemIds: [],
    allLocatedItems,
    currentFingerprint: 'sf-fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.equal(result.coverageMode, COVERAGE_MODE.UNSUPPORTED)
  assert.deepEqual(result.itemIds, ['universal-1', 'universal-2'])
})

test('an items-query error during candidate assembly propagates as a rejection, never silently treated as eligibleLocalCount: 0 / UNSUPPORTED', async () => {
  const failingClient = {
    from(table) {
      if (table === 'items') {
        return {
          select: () => failingClient.from('items'),
          eq: () => failingClient.from('items'),
          not: () => failingClient.from('items'),
          then: (_resolve, reject) => Promise.resolve().then(() => reject(new Error('items query failed'))),
        }
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ not: () => ({ not: () => Promise.resolve({ data: [], error: null }) }) }) }) }) }) }
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  }
  await assert.rejects(
    () => getWhatsGoodSelection({
      userId: USER_ID,
      userLocation: LOCATION,
      homeRailItemIds: [],
      allLocatedItems: [],
      currentFingerprint: 'fp',
      now: NOW,
      client: failingClient,
      storage: makeStubStorage(),
    }),
    /items query failed/
  )
})

test('anonymous (no userId) follows the exact same coverage-mode rules as authenticated — UNSUPPORTED/San Francisco Universal-only composition', async () => {
  const client = makeStubClient({ items: [] })
  const allLocatedItems = [makeItem('universal-1', { is_universal: true, maps_lat: null, maps_lng: null })]
  const result = await getWhatsGoodSelection({
    userId: null,
    userLocation: SF_LOC,
    homeRailItemIds: [],
    allLocatedItems,
    currentFingerprint: 'fp',
    now: NOW,
    client,
    storage: makeStubStorage(),
  })
  assert.equal(result.coverageMode, COVERAGE_MODE.UNSUPPORTED)
  assert.deepEqual(result.itemIds, ['universal-1'])
})
