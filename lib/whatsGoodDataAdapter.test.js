// What's Good V1 — whatsGoodDataAdapter.js unit tests. Every test injects a
// stub Supabase client — no production DB access, no network, ever.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleWhatsGoodCandidates } from './whatsGoodDataAdapter.js'
import { SEASON_WINDOWS } from './seasonFilter.js'

const NOW = new Date('2026-09-02T12:00:00.000Z')
const USER_ID = 'user-1'
const LOCATION = { latitude: 40.0, longitude: -105.0 }

/** A minimal chainable Supabase query-builder stub: every method returns itself, and it resolves like a promise. */
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

function makeItem(id, { lat = 40.0, lng = -105.0, season_tag = null } = {}) {
  return { id, maps_lat: lat, maps_lng: lng, season_tag }
}

function makeStubClient({
  items = [],
  checkins = [],
  exposures = [],
  momentumRows = [],
  bonusDropItemIds = [],
  itemsError = null,
  checkinsError = null,
  exposuresError = null,
  momentumError = null,
} = {}) {
  const calls = []
  const client = {
    from(table) {
      calls.push(`from:${table}`)
      if (table === 'items') return chainable({ data: items, error: itemsError })
      if (table === 'check_ins') return chainable({ data: checkins, error: checkinsError })
      if (table === 'whats_good_exposures') return chainable({ data: exposures, error: exposuresError })
      if (table === 'list_items') return chainable({ data: bonusDropItemIds.map((item_id) => ({ item_id })), error: null })
      throw new Error(`stub client: unexpected table "${table}"`)
    },
    rpc(name, params) {
      calls.push(`rpc:${name}`)
      assert.equal(name, 'get_whats_good_momentum_contributions')
      return Promise.resolve({ data: momentumRows, error: momentumError })
    },
  }
  return { client, calls }
}

function momentumRow(itemId, overrides = {}) {
  return {
    item_id: itemId,
    contribution_date: '2026-09-01',
    verification_method: 'live_location',
    contributor_count: 3,
    previous_window_contributor_total: 1,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Correct candidate assembly / Home Rail exclusion / ~15 cap
// ---------------------------------------------------------------------------

test('assembles candidates from items, nearest-first, excluding Home Rail', async () => {
  const items = [
    makeItem('rail-1', { lat: 40.001, lng: -105.001 }), // nearest, but Home Rail -> excluded
    makeItem('good-1', { lat: 40.002, lng: -105.002 }),
    makeItem('good-2', { lat: 40.003, lng: -105.003 }),
  ]
  const { client } = makeStubClient({ items, momentumRows: [] })
  const result = await assembleWhatsGoodCandidates({
    userId: USER_ID,
    userLocation: LOCATION,
    homeRailItemIds: ['rail-1'],
    now: NOW,
    client,
  })
  assert.deepEqual(result.candidates.map((c) => c.itemId), ['good-1', 'good-2'])
  assert.ok(result.candidates.every((c) => c.isHomeRail === false))
})

test('caps the candidate pool at 15 even when far more located items exist', async () => {
  const items = Array.from({ length: 40 }, (_, i) => makeItem(`item-${i}`, { lat: 40.0 + i * 0.001, lng: -105.0 }))
  const { client } = makeStubClient({ items, momentumRows: [] })
  const result = await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  assert.equal(result.candidates.length, 15)
  // Nearest-first: item-0 is closest, should be first.
  assert.equal(result.candidates[0].itemId, 'item-0')
})

test('fewer than 15 local candidates -> returns exactly that many, no padding', async () => {
  const items = [makeItem('a'), makeItem('b'), makeItem('c')]
  const { client } = makeStubClient({ items, momentumRows: [] })
  const result = await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  assert.equal(result.candidates.length, 3)
})

test('empty candidate list (no items at all, or all excluded as Home Rail) -> empty result, and skips the 3 dependent queries entirely', async () => {
  const items = [makeItem('rail-only')]
  const { client, calls } = makeStubClient({ items })
  const result = await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: ['rail-only'], now: NOW, client })
  assert.deepEqual(result.candidates, [])
  // list_items runs as part of eligibility filtering on the RAW pool
  // (before Home Rail exclusion even happens — matches the real order
  // Home Rail's own pool applies these filters in), so it fires even when
  // the candidate list ends up empty. check_ins (candidate-lifetime),
  // whats_good_exposures, and the momentum RPC — which all depend on a
  // non-empty final candidate list — must still never fire.
  assert.deepEqual(calls, ['from:items', 'from:list_items'], 'must not query check_ins (candidate lifetime)/exposures/momentum when there are zero final candidates')
})

// ---------------------------------------------------------------------------
// Lifetime checkoff mapping / exposure mapping
// ---------------------------------------------------------------------------

test('lifetime checkoff mapping: items present in the check_ins result are everCheckedOff=true, others false', async () => {
  const items = [makeItem('checked'), makeItem('unchecked')]
  const { client } = makeStubClient({ items, checkins: [{ item_id: 'checked' }], momentumRows: [] })
  const result = await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  const byId = Object.fromEntries(result.candidates.map((c) => [c.itemId, c]))
  assert.equal(byId.checked.everCheckedOff, true)
  assert.equal(byId.unchecked.everCheckedOff, false)
})

test('exposure mapping: item_id/last_shown_at rows map to lastShownAt Date objects, missing items get null', async () => {
  const items = [makeItem('shown'), makeItem('never-shown')]
  const { client } = makeStubClient({
    items,
    exposures: [{ item_id: 'shown', last_shown_at: '2026-08-30T00:00:00.000Z' }],
    momentumRows: [],
  })
  const result = await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  const byId = Object.fromEntries(result.candidates.map((c) => [c.itemId, c]))
  assert.ok(byId.shown.lastShownAt instanceof Date)
  assert.equal(byId.shown.lastShownAt.toISOString(), '2026-08-30T00:00:00.000Z')
  assert.equal(byId['never-shown'].lastShownAt, null)
})

// ---------------------------------------------------------------------------
// Momentum RPC: one call, correct grouping, no N+1
// ---------------------------------------------------------------------------

test('calls the momentum RPC exactly once for ALL candidates (no N+1)', async () => {
  const items = Array.from({ length: 10 }, (_, i) => makeItem(`item-${i}`))
  const { client, calls } = makeStubClient({ items, momentumRows: [] })
  await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  const rpcCalls = calls.filter((c) => c === 'rpc:get_whats_good_momentum_contributions')
  assert.equal(rpcCalls.length, 1)
})

test('momentum rows are grouped correctly per item before scoring', async () => {
  const items = [makeItem('item-a'), makeItem('item-b')]
  const momentumRows = [
    momentumRow('item-a', { contribution_date: '2026-09-01', verification_method: 'live_location', contributor_count: 2, previous_window_contributor_total: 1 }),
    momentumRow('item-a', { contribution_date: '2026-08-31', verification_method: 'qr_scan', contributor_count: 1, previous_window_contributor_total: 1 }),
    momentumRow('item-b', { contribution_date: '2026-09-01', verification_method: 'legacy', contributor_count: 3, previous_window_contributor_total: 0 }),
  ]
  const { client } = makeStubClient({ items, momentumRows })
  const result = await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  const byId = Object.fromEntries(result.candidates.map((c) => [c.itemId, c]))
  // item-a has 2 rows summing to 3 contributors, clears the floor -> positive score.
  assert.ok(byId['item-a'].momentumScore > 0)
  // item-b has 1 row with 3 contributors, clears the floor -> positive score too.
  assert.ok(byId['item-b'].momentumScore > 0)
})

test('empty RPC result -> momentum 0 for every candidate', async () => {
  const items = [makeItem('a'), makeItem('b')]
  const { client } = makeStubClient({ items, momentumRows: [] })
  const result = await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  assert.ok(result.candidates.every((c) => c.momentumScore === 0))
})

test('below-floor items are naturally absent from the RPC result (never sent at all) -> momentum 0, no special-casing needed', async () => {
  const items = [makeItem('below-floor'), makeItem('above-floor')]
  // Simulates the RPC's own floor behavior: below-floor item simply has no rows.
  const momentumRows = [momentumRow('above-floor')]
  const { client } = makeStubClient({ items, momentumRows })
  const result = await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  const byId = Object.fromEntries(result.candidates.map((c) => [c.itemId, c]))
  assert.equal(byId['below-floor'].momentumScore, 0)
  assert.ok(byId['above-floor'].momentumScore > 0)
})

// ---------------------------------------------------------------------------
// previous_window_contributor_total consistency validation
// ---------------------------------------------------------------------------

test('repeated previous_window_contributor_total values across an item\'s rows must agree — inconsistency throws rather than silently picking one', async () => {
  const items = [makeItem('inconsistent')]
  const momentumRows = [
    momentumRow('inconsistent', { contribution_date: '2026-09-01', previous_window_contributor_total: 2 }),
    momentumRow('inconsistent', { contribution_date: '2026-08-31', previous_window_contributor_total: 5 }), // disagrees
  ]
  const { client } = makeStubClient({ items, momentumRows })
  await assert.rejects(
    () => assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client }),
    /inconsistent previous_window_contributor_total/
  )
})

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

test('items query error propagates clearly', async () => {
  const { client } = makeStubClient({ itemsError: new Error('items query failed') })
  await assert.rejects(
    () => assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client }),
    /items query failed/
  )
})

test('check_ins query error propagates clearly', async () => {
  const { client } = makeStubClient({ items: [makeItem('a')], checkinsError: new Error('checkins failed') })
  await assert.rejects(
    () => assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client }),
    /checkins failed/
  )
})

test('exposures query error propagates clearly', async () => {
  const { client } = makeStubClient({ items: [makeItem('a')], exposuresError: new Error('exposures failed') })
  await assert.rejects(
    () => assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client }),
    /exposures failed/
  )
})

test('momentum RPC error propagates clearly', async () => {
  const { client } = makeStubClient({ items: [makeItem('a')], momentumError: new Error('rpc failed') })
  await assert.rejects(
    () => assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client }),
    /rpc failed/
  )
})

// ---------------------------------------------------------------------------
// No mutation of caller inputs
// ---------------------------------------------------------------------------

test('never mutates homeRailItemIds', async () => {
  const items = [makeItem('a')]
  const { client } = makeStubClient({ items, momentumRows: [] })
  const homeRailItemIds = ['rail-1', 'rail-2']
  const snapshot = [...homeRailItemIds]
  await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds, now: NOW, client })
  assert.deepEqual(homeRailItemIds, snapshot)
})

test('never mutates userLocation', async () => {
  const items = [makeItem('a')]
  const { client } = makeStubClient({ items, momentumRows: [] })
  const userLocation = { latitude: 40.0, longitude: -105.0 }
  const snapshot = { ...userLocation }
  await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation, homeRailItemIds: [], now: NOW, client })
  assert.deepEqual(userLocation, snapshot)
})

// ---------------------------------------------------------------------------
// REGRESSION: "Selected 3 but only 2 cards rendered" — root cause was the
// candidate pool including items Home Rail's own pool (rawNearbyItems)
// would have excluded (out of season, or a not-yet-unlocked Bonus Drop),
// so the selected ID existed but could never be hydrated/rendered
// screen-side. The fix is candidate-pool eligibility, proven here, not a
// UI-layer patch — see whatsGoodDataAdapter.js's module doc.
// ---------------------------------------------------------------------------

// Computed from the real current month, not hardcoded, so this test is
// correct regardless of which month it actually runs in — isItemInSeason()
// itself reads the real wall-clock date (a pre-existing design, not
// something this fix changes) rather than the injectable `now`.
const CURRENT_MONTH = new Date().getMonth() + 1
const OUT_OF_SEASON_TAG = Object.entries(SEASON_WINDOWS).find(([, months]) => !months.includes(CURRENT_MONTH))[0]
const IN_SEASON_TAG = Object.entries(SEASON_WINDOWS).find(([, months]) => months.includes(CURRENT_MONTH))[0]

test('REGRESSION: an out-of-season item is excluded from the candidate pool entirely (never selectable, never unhydratable)', async () => {
  const items = [makeItem('in-season', { season_tag: IN_SEASON_TAG }), makeItem('out-of-season', { season_tag: OUT_OF_SEASON_TAG }), makeItem('year-round', { season_tag: null })]
  const { client } = makeStubClient({ items, momentumRows: [] })
  const result = await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  const ids = result.candidates.map((c) => c.itemId)
  assert.ok(!ids.includes('out-of-season'), 'an out-of-season item must never enter the candidate pool')
  assert.ok(ids.includes('in-season'))
  assert.ok(ids.includes('year-round'), 'null season_tag = always in season')
})

test('REGRESSION: a not-yet-unlocked Bonus Drop item is excluded from the candidate pool; once checked off, it becomes eligible again', async () => {
  const items = [makeItem('locked-drop'), makeItem('unlocked-drop'), makeItem('normal-item')]

  const stillLocked = makeStubClient({ items, momentumRows: [], bonusDropItemIds: ['locked-drop', 'unlocked-drop'], checkins: [{ item_id: 'unlocked-drop' }] })
  const resultLocked = await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client: stillLocked.client })
  const idsLocked = resultLocked.candidates.map((c) => c.itemId)
  assert.ok(!idsLocked.includes('locked-drop'), 'a Bonus Drop the user has not checked off must never enter the candidate pool')
  assert.ok(idsLocked.includes('unlocked-drop'), 'a Bonus Drop the user HAS already checked off behaves as a normal item again')
  assert.ok(idsLocked.includes('normal-item'))
})

test('REGRESSION: no bonus-drop items exist at all -> the extra masking query short-circuits (list_items still queried once, check_ins bonus-drop lookup is skipped)', async () => {
  const items = [makeItem('a')]
  const { client, calls } = makeStubClient({ items, momentumRows: [], bonusDropItemIds: [] })
  await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  assert.equal(calls.filter((c) => c === 'from:list_items').length, 1)
  assert.equal(calls.filter((c) => c === 'from:check_ins').length, 1, 'only the lifetime-checkoff query should fire — the bonus-drop-checked lookup must short-circuit when there are no bonus-drop items at all')
})
