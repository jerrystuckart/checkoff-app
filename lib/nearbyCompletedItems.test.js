import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCompletedIdsFromCheckIns } from './nearbyCompletedIdsBuilder.js'

test('buildCompletedIdsFromCheckIns: includes an item whose check-in falls within the season window', () => {
  const rows = [{ item_id: 'a', checked_at: '2026-06-15T10:00:00Z' }]
  const window = { starts_at: '2026-06-01', ends_at: '2026-08-31' }
  const ids = buildCompletedIdsFromCheckIns(rows, window)
  assert.ok(ids.has('a'))
})

test('buildCompletedIdsFromCheckIns: excludes a check-in from a prior season (outside the window) — mirrors ItemDetailScreen.jsx loadCheckedState', () => {
  const rows = [{ item_id: 'a', checked_at: '2025-01-15T10:00:00Z' }]
  const window = { starts_at: '2026-06-01', ends_at: '2026-08-31' }
  const ids = buildCompletedIdsFromCheckIns(rows, window)
  assert.ok(!ids.has('a'))
})

test('buildCompletedIdsFromCheckIns: an all-time (unbounded) window includes everything with a checked_at', () => {
  const rows = [{ item_id: 'a', checked_at: '2020-01-01T00:00:00Z' }]
  const ids = buildCompletedIdsFromCheckIns(rows, { starts_at: null, ends_at: null })
  assert.ok(ids.has('a'))
})

test('buildCompletedIdsFromCheckIns: keyed by item_id — multiple check-in rows for the same item collapse to one Set entry', () => {
  const rows = [
    { item_id: 'a', checked_at: '2026-06-15T10:00:00Z' },
    { item_id: 'a', checked_at: '2026-07-01T10:00:00Z' },
  ]
  const window = { starts_at: '2026-06-01', ends_at: '2026-08-31' }
  const ids = buildCompletedIdsFromCheckIns(rows, window)
  assert.equal(ids.size, 1)
})

test('buildCompletedIdsFromCheckIns: empty rows produce an empty Set, never throws', () => {
  const ids = buildCompletedIdsFromCheckIns([], { starts_at: null, ends_at: null })
  assert.equal(ids.size, 0)
  assert.ok(buildCompletedIdsFromCheckIns(null, {}) instanceof Set)
})
