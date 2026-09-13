// Regression coverage for the 2026-09-13 Vienna "MORGEN 1040" bug: a user
// physically standing inside an item's own venue saw it missing from Nearby
// "All" and Home "Near You", while a tag/search filter surfaced it instantly
// at "Right here". Root cause: lib/useNearby.js and screens/HomeScreen.jsx
// both issued unbounded .select() queries capped at PostgREST's default
// 1000-row response limit, silently excluding any item past that row count
// from the candidate set BEFORE distance was ever computed — while tag/text
// search always queried a small bounded `.in(id, [...])` list and never hit
// the cap. This file chains the actual production pipeline pieces (paginated
// fetch -> geo ranking -> Home-compact slicing) against a realistic
// 1458-row candidate pool with the target item deliberately placed past row
// 1000, exactly reproducing the live counts confirmed against production.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchAllRows } from './supabasePagination.js'
import { rankNearbyItems, isWithinNearbyRadius } from './nearbyRanking.js'
import { selectNearYouCompactRows } from './nearYouCompact.js'

const MI = 1609.34

function fakeQuery(allRows) {
  return {
    range(from, to) {
      return Promise.resolve({ data: allRows.slice(from, to + 1), error: null })
    },
  }
}

// Builds a realistic candidate pool: 1457 filler items plus item A, all with
// a computed dist_m as if distance had already been calculated post-fetch.
// Item A sits at row 1401 (matching the confirmed live MORGEN position),
// deliberately outside the first 1000 rows of "whatever the DB's default
// order happened to be".
function buildCandidatePool() {
  const rows = []
  for (let i = 0; i < 1457; i++) {
    // Spread fillers from ~600m to a few miles out, never at/near 0.
    const distM = 600 + (i % 50) * 80  // 600m .. ~4.5km
    rows.push({ id: `filler-${i}`, dist_m: distM })
  }
  const itemA = { id: 'item-a-morgen', dist_m: 2, body: 'MORGEN 1040' }  // effectively "Right here"
  rows.splice(1401, 0, itemA)
  return rows
}

test('Nearby "All": a paginated fetch retrieves an item placed past row 1000, and geo ranking puts it first', async () => {
  const pool = buildCandidatePool()
  assert.equal(pool.length, 1458)

  const { data: fetched, error } = await fetchAllRows(() => fakeQuery(pool), { pageSize: 1000 })
  assert.equal(error, null)
  assert.equal(fetched.length, 1458, 'the full candidate set must survive pagination, not just the first page')

  const withinRadius = fetched.filter(item => isWithinNearbyRadius(item.dist_m))
  const ranked = rankNearbyItems(withinRadius, {})  // no tag filter -> empty match-count map

  assert.equal(ranked[0].id, 'item-a-morgen', 'the closest item must rank first even though it was fetched from beyond page 1')
})

test('Home "Near You": the same paginated+ranked pool, sliced AFTER ranking, still surfaces the item first', async () => {
  const pool = buildCandidatePool()
  const { data: fetched } = await fetchAllRows(() => fakeQuery(pool), { pageSize: 1000 })
  const ranked = rankNearbyItems(fetched.filter(item => isWithinNearbyRadius(item.dist_m)), {})

  const compact = selectNearYouCompactRows(ranked, 3, null)
  assert.equal(compact.length, 3)
  assert.equal(compact[0].id, 'item-a-morgen', 'Home compact rail must show the physically-closest item first, not an item ~0.8-1mi out')
})

test('a tag filter containing the item still returns it first (relevance can reorder, never re-exclude)', async () => {
  const pool = buildCandidatePool()
  const { data: fetched } = await fetchAllRows(() => fakeQuery(pool), { pageSize: 1000 })
  const withinRadius = fetched.filter(item => isWithinNearbyRadius(item.dist_m))

  // Tag filter matches item A plus a handful of far-away items with more
  // tag matches — geography must still win (bounded relevance discount).
  const tagMatchCounts = { 'item-a-morgen': 1, 'filler-0': 7, 'filler-1': 7 }
  const ranked = rankNearbyItems(withinRadius, tagMatchCounts)
  assert.equal(ranked[0].id, 'item-a-morgen')
})

test('removing the tag filter does not make the item disappear — it is in the base candidate set, not only the filtered one', async () => {
  const pool = buildCandidatePool()
  const { data: fetched } = await fetchAllRows(() => fakeQuery(pool), { pageSize: 1000 })
  const withinRadius = fetched.filter(item => isWithinNearbyRadius(item.dist_m))

  const withTag    = rankNearbyItems(withinRadius, { 'item-a-morgen': 1 })
  const withoutTag = rankNearbyItems(withinRadius, {})

  assert.ok(withTag.some(i => i.id === 'item-a-morgen'))
  assert.ok(withoutTag.some(i => i.id === 'item-a-morgen'), 'clearing the tag filter must not drop the item from the candidate set')
})

test('result limits are applied strictly after geo ranking, not before — a 3-row Home slice of a 1458-item pool still finds the nearest item', async () => {
  const pool = buildCandidatePool()
  const { data: fetched } = await fetchAllRows(() => fakeQuery(pool), { pageSize: 1000 })

  // Sanity: if a limit were (incorrectly) applied to the RAW fetch before
  // ranking, item A (inserted at raw index 1401) would already be gone here.
  assert.ok(fetched.some(i => i.id === 'item-a-morgen'), 'raw fetch must be complete before any ranking or slicing happens')

  const ranked = rankNearbyItems(fetched.filter(item => isWithinNearbyRadius(item.dist_m)), {})
  const top3 = selectNearYouCompactRows(ranked, 3, null)
  assert.equal(top3[0].id, 'item-a-morgen')
  assert.equal(top3.length, 3)
})

test('an out-of-radius item never wins even if it would otherwise sort early', () => {
  const items = [
    { id: 'far', dist_m: 101 * MI },   // just past the 100mi hard cutoff
    { id: 'near', dist_m: 3 * MI },
  ]
  const withinRadius = items.filter(item => isWithinNearbyRadius(item.dist_m))
  assert.equal(withinRadius.length, 1)
  assert.equal(withinRadius[0].id, 'near')
})
