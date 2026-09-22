// What's Good V1 — whatsGoodDataAdapter.js unit tests. Every test injects a
// stub Supabase client — no production DB access, no network, ever.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleWhatsGoodCandidates, verifyNearbyForRender, isEligibleForWhatsGood, isEligibleUniversalExperience, findWhatsGoodContractViolations } from './whatsGoodDataAdapter.js'
import { MAX_NEARBY_RADIUS_M } from './nearbyRanking.js'
import { SEASON_WINDOWS } from './seasonFilter.js'
import { COVERAGE_MODE } from './whatsGoodCoverageMode.js'

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

// ---------------------------------------------------------------------------
// REGRESSION (Bug 1 — obsolete logged-out Home): anonymous callers (no
// userId) must never hit check_ins / whats_good_exposures / the momentum
// RPC — all three are unreachable for anon (self-row RLS with no session,
// or an RPC that explicitly rejects unauthenticated calls; see
// supabase/migrations/20260902_whats_good_momentum_rpc.sql). This module
// must produce a valid, non-personalized candidate list for anon instead of
// erroring.
// ---------------------------------------------------------------------------

test('REGRESSION: anonymous (userId=null) never queries check_ins, whats_good_exposures, or the momentum RPC', async () => {
  const items = [makeItem('a'), makeItem('b')]
  const { client, calls } = makeStubClient({ items })
  const result = await assembleWhatsGoodCandidates({ userId: null, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  assert.equal(result.candidates.length, 2)
  assert.ok(!calls.includes('from:check_ins'), 'anon must never query check_ins')
  assert.ok(!calls.includes('from:whats_good_exposures'), 'anon must never query whats_good_exposures')
  assert.ok(!calls.includes('rpc:get_whats_good_momentum_contributions'), 'anon must never call the momentum RPC (it rejects unauthenticated calls)')
})

test('REGRESSION: anonymous candidates are well-formed — never checked off, never shown, momentum-neutral', async () => {
  const items = [makeItem('a')]
  const { client } = makeStubClient({ items })
  const result = await assembleWhatsGoodCandidates({ userId: null, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  assert.equal(result.candidates[0].everCheckedOff, false)
  assert.equal(result.candidates[0].lastShownAt, null)
  assert.equal(result.candidates[0].momentumScore, 0)
})

test('REGRESSION: anonymous callers still get bonus-drop masking via the userId-gated check_ins lookup inside maskBonusDrops (locked drops excluded, unmasked items unaffected)', async () => {
  const items = [makeItem('locked-drop'), makeItem('normal-item')]
  const { client } = makeStubClient({ items, bonusDropItemIds: ['locked-drop'] })
  const result = await assembleWhatsGoodCandidates({ userId: null, userLocation: LOCATION, homeRailItemIds: [], now: NOW, client })
  const ids = result.candidates.map((c) => c.itemId)
  assert.ok(!ids.includes('locked-drop'), 'anon can never have checked off a Bonus Drop, so it must stay masked')
  assert.ok(ids.includes('normal-item'))
})

// ---------------------------------------------------------------------------
// Candidate-pool geographic cap (2026-09-21 fix, re-verified as part of the
// follow-up fix): the fresh-fetch candidate query has no metro/city filter
// at the database level — it relies entirely on this maxDistance cap
// (MAX_NEARBY_RADIUS_M, same cutoff Nearby enforces) to keep a sparse
// metro's candidate expansion from reaching into another metro entirely.
// ---------------------------------------------------------------------------

test('REGRESSION: a real-world Munich/Vienna distance (~355mi, the actual Strudlhofstiege scenario) is excluded from the fresh candidate pool by the maxDistance cap, not merely deprioritized', async () => {
  const MUNICH = { latitude: 48.1351, longitude: 11.5820 }
  const items = [
    makeItem('strudlhofstiege', { lat: 48.21, lng: 16.37 }), // Vienna — ~355mi away
    makeItem('marienplatz', { lat: 48.1374, lng: 11.5755 }), // Munich — genuinely nearby
  ]
  const { client } = makeStubClient({ items, momentumRows: [] })
  const result = await assembleWhatsGoodCandidates({ userId: USER_ID, userLocation: MUNICH, homeRailItemIds: [], now: NOW, client })
  const ids = result.candidates.map((c) => c.itemId)
  assert.ok(!ids.includes('strudlhofstiege'), 'an item ~355mi away must never enter the candidate pool at all')
  assert.ok(ids.includes('marienplatz'))
})

// ---------------------------------------------------------------------------
// verifyNearbyForRender — the FINAL, unconditional render gate (2026-09-21
// follow-up field fix). Pure function, tested directly per this repo's
// pure-logic-extraction convention (no RN render harness).
// ---------------------------------------------------------------------------

const MUNICH = { latitude: 48.1351, longitude: 11.5820 }
const VIENNA_COORDS = { lat: 48.21, lng: 16.37 } // ~355mi from Munich

test('Test 2: a mixed fresh Munich/Vienna item set -> verifyNearbyForRender keeps only the Munich item', () => {
  const items = [
    { id: 'strudlhofstiege', maps_lat: VIENNA_COORDS.lat, maps_lng: VIENNA_COORDS.lng },
    { id: 'marienplatz', maps_lat: 48.1374, maps_lng: 11.5755 },
  ]
  const result = verifyNearbyForRender(items, MUNICH)
  const ids = result.map((i) => i.id)
  assert.deepEqual(ids, ['marienplatz'])
})

test('Test 3 (render gate): the real Strudlhofstiege item (Vienna coordinates) cannot appear for a Munich current-location input, even if it somehow reached this final step', () => {
  const items = [{ id: 'strudlhofstiege', maps_lat: VIENNA_COORDS.lat, maps_lng: VIENNA_COORDS.lng }]
  const result = verifyNearbyForRender(items, MUNICH)
  assert.deepEqual(result, [])
})

test('Test 7: the final gate rejects an out-of-radius item even if it carries a high relevance/personalization marker — geography is unconditional, ranking cannot bypass it', () => {
  const items = [
    { id: 'strudlhofstiege', maps_lat: VIENNA_COORDS.lat, maps_lng: VIENNA_COORDS.lng, momentumScore: 999, everCheckedOff: true, isHighlyRelevant: true },
    { id: 'marienplatz', maps_lat: 48.1374, maps_lng: 11.5755, momentumScore: 0 },
  ]
  const result = verifyNearbyForRender(items, MUNICH)
  assert.deepEqual(result.map((i) => i.id), ['marienplatz'], 'a high relevance/momentum score must not exempt an out-of-radius item from the geographic gate')
})

test('Test 8: coordinate-less (non-Universal) items cannot appear in location-based What\'s Good cards', () => {
  const items = [
    { id: 'no-coords', maps_lat: null, maps_lng: null },
    { id: 'zero-zero', maps_lat: 0, maps_lng: 0 }, // "Null Island" footgun
    { id: 'marienplatz', maps_lat: 48.1374, maps_lng: 11.5755 },
  ]
  const result = verifyNearbyForRender(items, MUNICH)
  assert.deepEqual(result.map((i) => i.id), ['marienplatz'])
})

test('Test 9: insufficient eligible items after the gate -> fewer results, never backfilled from another city', () => {
  const items = [
    { id: 'strudlhofstiege', maps_lat: VIENNA_COORDS.lat, maps_lng: VIENNA_COORDS.lng },
    { id: 'marienplatz', maps_lat: 48.1374, maps_lng: 11.5755 },
  ]
  const result = verifyNearbyForRender(items, MUNICH)
  assert.equal(result.length, 1, 'only the genuinely-nearby item survives — the gate must not pad the result back up using the rejected Vienna item')
})

test('Test 10: a user actually IN Vienna still sees the real Strudlhofstiege item survive the gate (critical overcorrection guard)', () => {
  const items = [{ id: 'strudlhofstiege', maps_lat: VIENNA_COORDS.lat, maps_lng: VIENNA_COORDS.lng }]
  const userInVienna = { latitude: 48.2082, longitude: 16.3738 }
  const result = verifyNearbyForRender(items, userInVienna)
  assert.deepEqual(result.map((i) => i.id), ['strudlhofstiege'])
})

// ---------------------------------------------------------------------------
// REGRESSION (2026-09-21 second follow-up field bug): What's Good was
// showing generic is_universal=true filler in place of real Munich venues.
// Root cause: this gate used to explicitly EXEMPT Universal items ("not a
// location-based card, always passes") — the exact leak that let the
// orchestrator's now-removed Universal top-up sail through. What's Good is
// place-based by definition, so a Universal item is now NEVER eligible,
// under any fallback tier, no matter what coordinates/distance it carries.
// This is a deliberate behavior REVERSAL from the prior "Universal item
// passes the gate" test this block replaces.
// ---------------------------------------------------------------------------

test('a Universal item is REJECTED by the gate, even with usable coordinates well within range — What\'s Good is place-based only, Universal items are never eligible under any fallback tier', () => {
  const items = [
    { id: 'universal-1', is_universal: true, maps_lat: null, maps_lng: null },
    { id: 'universal-2', is_universal: true, maps_lat: 48.1374, maps_lng: 11.5755 }, // even with real Munich coords
    { id: 'marienplatz', maps_lat: 48.1374, maps_lng: 11.5755 },
  ]
  const result = verifyNearbyForRender(items, MUNICH)
  assert.deepEqual(result.map((i) => i.id), ['marienplatz'], 'no Universal item may ever appear in a What\'s Good render, regardless of its coordinates')
})

test('userLocation itself unusable -> every item is rejected, including Universal ones (Universal is no longer exempt)', () => {
  const items = [
    { id: 'universal-1', is_universal: true },
    { id: 'marienplatz', maps_lat: 48.1374, maps_lng: 11.5755 },
  ]
  assert.deepEqual(verifyNearbyForRender(items, null), [])
  assert.deepEqual(verifyNearbyForRender(items, {}), [])
})

// ---------------------------------------------------------------------------
// isEligibleForWhatsGood — the shared per-item predicate verifyNearbyForRender
// and the dev-time assertion (findWhatsGoodContractViolations) both use, so
// they can never drift from each other.
// ---------------------------------------------------------------------------

test('isEligibleForWhatsGood: a legitimate local item using generic fallback ARTWORK (no cover_image / photo fields at all) remains eligible — artwork resolution is unrelated to eligibility', () => {
  // Deliberately carries no image/cover-photo fields whatsoever, proving
  // this fix does not conflate "uses fallback artwork" (a rendering
  // concern, handled entirely elsewhere) with "is a Universal item" (an
  // eligibility concern, handled here). Only is_universal/coords/distance
  // matter to this predicate.
  const realLocalItemWithNoPhoto = { id: 'marienplatz', maps_lat: 48.1374, maps_lng: 11.5755, is_universal: false }
  assert.equal(isEligibleForWhatsGood(realLocalItemWithNoPhoto, MUNICH), true)
})

test('isEligibleForWhatsGood: is_universal is checked before coordinates/distance are even looked at', () => {
  const universalWithGreatCoords = { id: 'universal-1', is_universal: true, maps_lat: MUNICH.latitude, maps_lng: MUNICH.longitude }
  assert.equal(isEligibleForWhatsGood(universalWithGreatCoords, MUNICH), false)
})

test('isEligibleForWhatsGood: camelCase isUniversal/mapsLat/mapsLng shape is honored identically to snake_case', () => {
  assert.equal(isEligibleForWhatsGood({ id: 'u', isUniversal: true }, MUNICH), false)
  assert.equal(isEligibleForWhatsGood({ id: 'm', isUniversal: false, mapsLat: 48.1374, mapsLng: 11.5755 }, MUNICH), true)
})

// ---------------------------------------------------------------------------
// findWhatsGoodContractViolations — the dev-time structural assertion
// lib/useWhatsGood.js runs (__DEV__-gated) immediately before setSelectedItems.
// ---------------------------------------------------------------------------

test('findWhatsGoodContractViolations: returns an empty array when every item already satisfies the contract (the expected steady state)', () => {
  const items = [{ id: 'marienplatz', maps_lat: 48.1374, maps_lng: 11.5755, is_universal: false }]
  assert.deepEqual(findWhatsGoodContractViolations(items, MUNICH), [])
})

test('findWhatsGoodContractViolations: flags a Universal item and an out-of-radius item by id, by name, if either ever slipped past the primary gate', () => {
  const items = [
    { id: 'universal-1', is_universal: true },
    { id: 'strudlhofstiege', maps_lat: VIENNA_COORDS.lat, maps_lng: VIENNA_COORDS.lng },
    { id: 'marienplatz', maps_lat: 48.1374, maps_lng: 11.5755 },
  ]
  assert.deepEqual(findWhatsGoodContractViolations(items, MUNICH).sort(), ['strudlhofstiege', 'universal-1'])
})

// ---------------------------------------------------------------------------
// Structural test: nothing can append to a list AFTER verifyNearbyForRender
// runs — verifyNearbyForRender/isEligibleForWhatsGood is a pure filter, so
// its output can only ever be a subset of its input, never a superset.
// ---------------------------------------------------------------------------

test('structural: verifyNearbyForRender can only ever remove items, never add — its output is always a subset of its input', () => {
  const items = [
    { id: 'marienplatz', maps_lat: 48.1374, maps_lng: 11.5755 },
    { id: 'universal-1', is_universal: true },
    { id: 'strudlhofstiege', maps_lat: VIENNA_COORDS.lat, maps_lng: VIENNA_COORDS.lng },
  ]
  const inputIds = new Set(items.map((i) => i.id))
  const result = verifyNearbyForRender(items, MUNICH)
  assert.ok(result.length <= items.length)
  assert.ok(result.every((i) => inputIds.has(i.id)), 'every output item must have been present in the input — nothing new can be appended')
})

test('an item exactly at the maxDistance boundary is treated as in-range (<=, matching MAX_NEARBY_RADIUS_M semantics), one meter beyond is rejected', () => {
  // A point due east of Munich at exactly MAX_NEARBY_RADIUS_M, and one just past it.
  const metersPerDegreeLng = 111320 * Math.cos((MUNICH.latitude * Math.PI) / 180)
  const atBoundaryLng = MUNICH.longitude + MAX_NEARBY_RADIUS_M / metersPerDegreeLng
  const beyondBoundaryLng = MUNICH.longitude + (MAX_NEARBY_RADIUS_M + 5000) / metersPerDegreeLng
  const items = [
    { id: 'at-boundary', maps_lat: MUNICH.latitude, maps_lng: atBoundaryLng },
    { id: 'beyond-boundary', maps_lat: MUNICH.latitude, maps_lng: beyondBoundaryLng },
  ]
  const result = verifyNearbyForRender(items, MUNICH)
  assert.ok(!result.map((i) => i.id).includes('beyond-boundary'), 'clearly beyond the cap must be rejected')
})

// ---------------------------------------------------------------------------
// 2026-09-22 coverage-mode policy fix — mode-aware verifyNearbyForRender /
// findWhatsGoodContractViolations. Every test ABOVE this line calls
// verifyNearbyForRender/findWhatsGoodContractViolations WITHOUT a
// `coverageMode` option, which defaults to SUPPORTED_SUFFICIENT — the exact
// prior absolute-rejection behavior, unchanged. These new tests exercise the
// other 4 modes explicitly.
// ---------------------------------------------------------------------------

const universal = (id, overrides = {}) => ({ id, is_universal: true, ...overrides })
const local = (id, overrides = {}) => ({ id, maps_lat: 48.1374, maps_lng: 11.5755, ...overrides })

test('isEligibleUniversalExperience: true for a real Universal item with an id, false for a non-Universal item or one with no id', () => {
  assert.equal(isEligibleUniversalExperience(universal('u1')), true)
  assert.equal(isEligibleUniversalExperience({ id: 'not-universal', is_universal: false }), false)
  assert.equal(isEligibleUniversalExperience({ is_universal: true }), false, 'no id at all -> not a valid navigation/detail destination')
  assert.equal(isEligibleUniversalExperience({ id: 'camel', isUniversal: true }), true, 'camelCase isUniversal honored identically')
})

test('SUPPORTED_SUFFICIENT (default): unchanged — Universal always rejected, local place contract enforced exactly as before', () => {
  const items = [local('marienplatz'), universal('u1')]
  const result = verifyNearbyForRender(items, MUNICH, { coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT })
  assert.deepEqual(result.map((i) => i.id), ['marienplatz'])
})

test('SUPPORTED_SPARSE: every eligible local item admitted first, then Universal items fill only the remaining slots up to targetCount', () => {
  const items = [local('marienplatz'), universal('u1'), universal('u2'), universal('u3')]
  const result = verifyNearbyForRender(items, MUNICH, { coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE, targetCount: 3 })
  assert.deepEqual(result.map((i) => i.id), ['marienplatz', 'u1', 'u2'], 'local first, then exactly enough Universal to reach targetCount — u3 is excess and excluded')
})

test('SUPPORTED_SPARSE: a local item failing the place contract (out of radius) is still dropped — sparse mode never relaxes the local contract', () => {
  const items = [local('marienplatz'), { id: 'strudlhofstiege', maps_lat: VIENNA_COORDS.lat, maps_lng: VIENNA_COORDS.lng }, universal('u1')]
  const result = verifyNearbyForRender(items, MUNICH, { coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE, targetCount: 3 })
  assert.ok(!result.map((i) => i.id).includes('strudlhofstiege'))
  assert.deepEqual(result.map((i) => i.id), ['marienplatz', 'u1'])
})

test('SUPPORTED_SPARSE: a Universal item never displaces an already-eligible local item, even when there are exactly targetCount locals', () => {
  const items = [local('a'), local('b'), local('c'), universal('u1')]
  const result = verifyNearbyForRender(items, MUNICH, { coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE, targetCount: 3 })
  assert.deepEqual(result.map((i) => i.id), ['a', 'b', 'c'], 'no remaining slots -> Universal excluded, all 3 locals kept')
})

test('SUPPORTED_SPARSE: never the same Universal item twice within one computation', () => {
  const dupUniversal = universal('u1')
  const items = [local('marienplatz'), dupUniversal, dupUniversal]
  const result = verifyNearbyForRender(items, MUNICH, { coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE, targetCount: 3 })
  assert.deepEqual(result.map((i) => i.id), ['marienplatz', 'u1'])
})

test('SUPPORTED_SPARSE: local-before-universal ordering is enforced by the validator itself, even if the input order is reversed (universal first)', () => {
  const items = [universal('u1'), universal('u2'), local('marienplatz')]
  const result = verifyNearbyForRender(items, MUNICH, { coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE, targetCount: 3 })
  assert.deepEqual(result.map((i) => i.id), ['marienplatz', 'u1', 'u2'])
})

test('SUPPORTED_SPARSE: an invalid Universal item (no id) never counts toward or fills a slot', () => {
  const items = [local('marienplatz'), { is_universal: true /* no id */ }, universal('u2')]
  const result = verifyNearbyForRender(items, MUNICH, { coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE, targetCount: 3 })
  assert.deepEqual(result.map((i) => i.id), ['marienplatz', 'u2'])
})

test('UNSUPPORTED: rejects ALL place-based/local items outright, even one with valid-looking in-radius coordinates — this mode means no eligible local inventory at all', () => {
  const items = [local('marienplatz'), universal('u1'), universal('u2')]
  const result = verifyNearbyForRender(items, MUNICH, { coverageMode: COVERAGE_MODE.UNSUPPORTED, targetCount: 3 })
  assert.deepEqual(result.map((i) => i.id), ['u1', 'u2'], 'a local item must never render in UNSUPPORTED mode, regardless of its own coordinates')
})

test('UNSUPPORTED: San Francisco example — Universal items only, up to targetCount, never a distant metro (Phoenix) item even if present in the candidate pool', () => {
  const items = [universal('u1'), universal('u2'), universal('u3'), universal('u4'), { id: 'phoenix-place', maps_lat: 33.4484, maps_lng: -112.0740 }]
  const SF = { latitude: 37.7749, longitude: -122.4194 }
  const result = verifyNearbyForRender(items, SF, { coverageMode: COVERAGE_MODE.UNSUPPORTED, targetCount: 3 })
  assert.deepEqual(result.map((i) => i.id), ['u1', 'u2', 'u3'])
  assert.ok(!result.map((i) => i.id).includes('phoenix-place'), 'a distant metro item must never substitute for Universal content in UNSUPPORTED mode')
})

test('UNSUPPORTED: never the same Universal item twice, and honestly returns fewer than targetCount when fewer Universal items exist', () => {
  const dupUniversal = universal('u1')
  const result = verifyNearbyForRender([dupUniversal, dupUniversal], MUNICH, { coverageMode: COVERAGE_MODE.UNSUPPORTED, targetCount: 3 })
  assert.deepEqual(result.map((i) => i.id), ['u1'])
})

test('PENDING_LOCATION: rejects everything — empty result, no local or Universal content, no matter what candidates are passed in', () => {
  const items = [local('marienplatz'), universal('u1')]
  assert.deepEqual(verifyNearbyForRender(items, MUNICH, { coverageMode: COVERAGE_MODE.PENDING_LOCATION }), [])
})

test('LOCATION_UNAVAILABLE: rejects everything — empty result, honest no-fabricated-content state', () => {
  const items = [local('marienplatz'), universal('u1')]
  assert.deepEqual(verifyNearbyForRender(items, null, { coverageMode: COVERAGE_MODE.LOCATION_UNAVAILABLE }), [])
})

test('structural: a Universal card admitted by verifyNearbyForRender carries no distance/coordinate fields of its own — matches the existing place/Universal card-type split (components/home/EditorialCard.jsx already renders null distance for is_universal items)', () => {
  const items = [universal('u1')]
  const result = verifyNearbyForRender(items, MUNICH, { coverageMode: COVERAGE_MODE.UNSUPPORTED, targetCount: 3 })
  assert.equal(result.length, 1)
  assert.equal(result[0].maps_lat, undefined)
  assert.equal(result[0].maps_lng, undefined)
  assert.equal(result[0].is_universal, true)
})

test('structural: a well-formed Universal card (as HomeScreen.jsx\'s loadNearbyRail() actually produces it) survives the gate with its real display fields intact', () => {
  const richUniversalCard = universal('u1', { body: 'Try something new today', checkin_type: 'photo', difficulty: 'easy' })
  const result = verifyNearbyForRender([richUniversalCard], MUNICH, { coverageMode: COVERAGE_MODE.UNSUPPORTED, targetCount: 3 })
  assert.equal(result[0].body, 'Try something new today')
  assert.equal(result[0].checkin_type, 'photo')
})

test('findWhatsGoodContractViolations: SUPPORTED_SPARSE mode flags an excess Universal item beyond the remaining slots, but not the locals or the admitted Universal items', () => {
  const items = [local('marienplatz'), universal('u1'), universal('u2'), universal('excess')]
  const violations = findWhatsGoodContractViolations(items, MUNICH, { coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE, targetCount: 3 })
  assert.deepEqual(violations, ['excess'])
})

test('findWhatsGoodContractViolations: UNSUPPORTED mode flags a local item as a violation, even with valid coordinates', () => {
  const items = [local('marienplatz'), universal('u1')]
  const violations = findWhatsGoodContractViolations(items, MUNICH, { coverageMode: COVERAGE_MODE.UNSUPPORTED, targetCount: 3 })
  assert.deepEqual(violations, ['marienplatz'])
})

test('findWhatsGoodContractViolations: PENDING_LOCATION/LOCATION_UNAVAILABLE flag every item as a violation (nothing should ever render)', () => {
  const items = [local('marienplatz'), universal('u1')]
  assert.deepEqual(findWhatsGoodContractViolations(items, MUNICH, { coverageMode: COVERAGE_MODE.PENDING_LOCATION }).sort(), ['marienplatz', 'u1'])
  assert.deepEqual(findWhatsGoodContractViolations(items, MUNICH, { coverageMode: COVERAGE_MODE.LOCATION_UNAVAILABLE }).sort(), ['marienplatz', 'u1'])
})

// ---------------------------------------------------------------------------
// Structural: no fallback branch can bypass the mode-aware validator — its
// output remains a pure function of (items, userLocation, options) in every
// mode, so nothing can append after it runs (extends the pre-existing
// subset guarantee to every mode, not just the default).
// ---------------------------------------------------------------------------

test('structural: verifyNearbyForRender is a pure subset filter in every coverage mode — its output can never contain an id absent from its input', () => {
  const items = [local('marienplatz'), universal('u1'), universal('u2'), { id: 'strudlhofstiege', maps_lat: VIENNA_COORDS.lat, maps_lng: VIENNA_COORDS.lng }]
  const inputIds = new Set(items.map((i) => i.id))
  for (const coverageMode of Object.values(COVERAGE_MODE)) {
    const result = verifyNearbyForRender(items, MUNICH, { coverageMode, targetCount: 3 })
    assert.ok(result.every((i) => inputIds.has(i.id)), `mode ${coverageMode}: every output item must have been present in the input`)
  }
})
