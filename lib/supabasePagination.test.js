import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchAllRows } from './supabasePagination.js'

// A minimal fake PostgREST query builder: .range(from, to) resolves to a
// slice of `allRows`, exactly like Supabase's real client does.
function fakeQuery(allRows) {
  return {
    range(from, to) {
      return Promise.resolve({ data: allRows.slice(from, to + 1), error: null })
    },
  }
}

test('a candidate set under one page comes back whole', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i }))
  const { data, error } = await fetchAllRows(() => fakeQuery(rows), { pageSize: 1000 })
  assert.equal(error, null)
  assert.equal(data.length, 50)
})

// Direct regression for the Vienna MORGEN bug: a real-world-sized candidate
// pool (1458 rows, matching the confirmed live count) with the target item
// deliberately placed at row ~1401 — well past PostgREST's default 1000-row
// cap and past what a single unbounded .select() would ever return.
test('an item beyond the default 1000-row PostgREST cap is still returned', async () => {
  const rows = Array.from({ length: 1458 }, (_, i) => ({ id: i }))
  const morgenIndex = 1401
  rows[morgenIndex] = { id: 'morgen-1040', body: 'MORGEN 1040' }

  const { data, error } = await fetchAllRows(() => fakeQuery(rows), { pageSize: 1000 })
  assert.equal(error, null)
  assert.equal(data.length, 1458)
  assert.ok(data.some(r => r.id === 'morgen-1040'), 'item past row 1000 must not be silently dropped')
})

test('paginates in exact page-size increments and stops on a short final page', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }))
  let calls = 0
  const countingQuery = () => {
    calls++
    return fakeQuery(rows)
  }
  const { data } = await fetchAllRows(countingQuery, { pageSize: 1000 })
  assert.equal(data.length, 2500)
  assert.equal(calls, 3)  // 1000 + 1000 + 500
})

test('a page that comes back exactly full still triggers one more (empty) fetch to confirm end', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }))
  let calls = 0
  const countingQuery = () => {
    calls++
    return fakeQuery(rows)
  }
  const { data } = await fetchAllRows(countingQuery, { pageSize: 1000 })
  assert.equal(data.length, 1000)
  assert.equal(calls, 2)  // one full page (1000) + one empty page confirming no more rows
})

test('propagates a query error and preserves any rows already fetched', async () => {
  let calls = 0
  const failingQuery = () => ({
    range() {
      calls++
      if (calls === 1) return Promise.resolve({ data: [{ id: 1 }], error: null })
      return Promise.resolve({ data: null, error: { message: 'boom' } })
    },
  })
  const { data, error } = await fetchAllRows(failingQuery, { pageSize: 1 })
  assert.ok(error)
  assert.equal(error.message, 'boom')
  assert.deepEqual(data, [{ id: 1 }])
})
