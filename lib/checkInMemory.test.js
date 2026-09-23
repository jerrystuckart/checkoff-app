// Check-In Memory Viewer (2026-09-23) — lib/checkInMemory.js unit tests.
// Every test injects a stub Supabase client — no production DB access, no
// network, ever. Stub convention matches lib/whatsGoodDataAdapter.test.js.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getMemoryFlagsForItems, getMemoryDetailForItem, hasMemoryContent } from './checkInMemory.js'

/** A minimal chainable, call-counting Supabase query-builder stub. */
function makeStubClient({ checkinsResult = { data: [], error: null } } = {}) {
  const calls = []
  function chainable(result) {
    const handler = {
      select: (...a) => { calls.push(['select', ...a]); return handler },
      eq: (...a) => { calls.push(['eq', ...a]); return handler },
      in: (...a) => { calls.push(['in', ...a]); return handler },
      not: (...a) => { calls.push(['not', ...a]); return handler },
      order: (...a) => { calls.push(['order', ...a]); return handler },
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    }
    return handler
  }
  const client = {
    from(table) {
      calls.push(['from', table])
      if (table === 'check_ins') return chainable(checkinsResult)
      throw new Error(`stub client: unexpected table "${table}"`)
    },
  }
  return { client, calls }
}

function row(overrides = {}) {
  return {
    id: 'ci-1',
    item_id: 'item-1',
    list_item_id: null,
    checked_at: '2026-09-20T12:00:00.000Z',
    photo_url: 'https://example.com/photo.jpg',
    personal_place: null,
    personal_note: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// getMemoryFlagsForItems
// ---------------------------------------------------------------------------

test('getMemoryFlagsForItems: batches into ONE query for multiple item ids, not N+1', async () => {
  const { client, calls } = makeStubClient({
    checkinsResult: { data: [row({ item_id: 'a' }), row({ item_id: 'b' })], error: null },
  })
  const map = await getMemoryFlagsForItems('user-1', ['a', 'b', 'c'], { client })

  const fromCalls = calls.filter(c => c[0] === 'from')
  assert.equal(fromCalls.length, 1, 'expected exactly one from() call (batched), not one per item')
  assert.equal(map.size, 2)
  assert.ok(map.has('a'))
  assert.ok(map.has('b'))
  assert.ok(!map.has('c'))
})

test('getMemoryFlagsForItems: scopes the query to the given userId', async () => {
  const { client, calls } = makeStubClient({ checkinsResult: { data: [], error: null } })
  await getMemoryFlagsForItems('the-current-user', ['a'], { client })
  const eqCalls = calls.filter(c => c[0] === 'eq')
  assert.ok(eqCalls.some(c => c[1] === 'user_id' && c[2] === 'the-current-user'))
})

test('getMemoryFlagsForItems: anonymous (no userId) skips the query entirely, returns empty', async () => {
  const { client, calls } = makeStubClient()
  const map = await getMemoryFlagsForItems(null, ['a', 'b'], { client })
  assert.equal(map.size, 0)
  assert.equal(calls.length, 0, 'no query should be issued for an anonymous user')
})

test('getMemoryFlagsForItems: empty itemIds skips the query entirely', async () => {
  const { client, calls } = makeStubClient()
  const map = await getMemoryFlagsForItems('user-1', [], { client })
  assert.equal(map.size, 0)
  assert.equal(calls.length, 0)
})

test('getMemoryFlagsForItems: most-recent-wins when multiple rows exist for the same item', async () => {
  const { client } = makeStubClient({
    checkinsResult: {
      data: [
        row({ item_id: 'a', checked_at: '2026-09-01T00:00:00.000Z', photo_url: 'https://x/old.jpg' }),
        row({ item_id: 'a', checked_at: '2026-09-20T00:00:00.000Z', photo_url: 'https://x/new.jpg' }),
      ],
      error: null,
    },
  })
  const map = await getMemoryFlagsForItems('user-1', ['a'], { client })
  assert.equal(map.get('a').photoUrl, 'https://x/new.jpg')
})

test('getMemoryFlagsForItems: a query error fails safely (empty map, no throw)', async () => {
  const { client } = makeStubClient({ checkinsResult: { data: null, error: { message: 'boom' } } })
  const map = await getMemoryFlagsForItems('user-1', ['a'], { client })
  assert.equal(map.size, 0)
})

// ---------------------------------------------------------------------------
// getMemoryDetailForItem
// ---------------------------------------------------------------------------

test('getMemoryDetailForItem: returns the row for the given item scoped to userId', async () => {
  const { client, calls } = makeStubClient({
    checkinsResult: { data: [row({ item_id: 'item-1' })], error: null },
  })
  const detail = await getMemoryDetailForItem('user-1', 'item-1', { client })
  assert.ok(detail)
  assert.equal(detail.item_id ?? 'item-1', 'item-1')
  const eqCalls = calls.filter(c => c[0] === 'eq')
  assert.ok(eqCalls.some(c => c[1] === 'user_id' && c[2] === 'user-1'))
  assert.ok(eqCalls.some(c => c[1] === 'item_id' && c[2] === 'item-1'))
})

test('getMemoryDetailForItem: prefers the row matching preferListItemId over a more-recent other row', async () => {
  const { client } = makeStubClient({
    checkinsResult: {
      data: [
        row({ id: 'newest', list_item_id: 'other-list-item', checked_at: '2026-09-22T00:00:00.000Z' }),
        row({ id: 'wanted', list_item_id: 'target-list-item', checked_at: '2026-09-10T00:00:00.000Z' }),
      ],
      error: null,
    },
  })
  const detail = await getMemoryDetailForItem('user-1', 'item-1', {
    preferListItemId: 'target-list-item',
    client,
  })
  assert.equal(detail.id, 'wanted')
})

test('getMemoryDetailForItem: falls back to most recent when no row matches preferListItemId', async () => {
  // Real Supabase applies .order('checked_at', {ascending: false}) server
  // side, so "newest first" is the shape getMemoryDetailForItem's rows[0]
  // fallback relies on — the stub client below doesn't re-sort, so the
  // fixture data is supplied already in that order, same as production.
  const { client } = makeStubClient({
    checkinsResult: {
      data: [
        row({ id: 'newer', checked_at: '2026-09-20T00:00:00.000Z' }),
        row({ id: 'older', checked_at: '2026-09-01T00:00:00.000Z' }),
      ],
      error: null,
    },
  })
  const detail = await getMemoryDetailForItem('user-1', 'item-1', {
    preferListItemId: 'no-such-list-item',
    client,
  })
  assert.equal(detail.id, 'newer')
})

test('getMemoryDetailForItem: filters rows outside the given season window', async () => {
  const { client } = makeStubClient({
    checkinsResult: {
      data: [
        row({ id: 'out-of-window', checked_at: '2026-01-01T00:00:00.000Z' }),
        row({ id: 'in-window', checked_at: '2026-09-10T00:00:00.000Z' }),
      ],
      error: null,
    },
  })
  const detail = await getMemoryDetailForItem('user-1', 'item-1', {
    seasonStart: '2026-09-01',
    seasonEnd: '2026-09-30',
    client,
  })
  assert.equal(detail.id, 'in-window')
})

test('getMemoryDetailForItem: another user\'s rows never leak — query is scoped by user_id, stub proves the eq call', async () => {
  // The stub client itself does not filter by user_id (it's a dumb stub),
  // so this test proves the CALLER issues the scoping eq(), which is what
  // makes the real Postgres RLS-backed query user-scoped in production.
  const { client, calls } = makeStubClient({ checkinsResult: { data: [], error: null } })
  await getMemoryDetailForItem('me', 'item-1', { client })
  const eqCalls = calls.filter(c => c[0] === 'eq')
  assert.deepEqual(eqCalls.find(c => c[1] === 'user_id'), ['eq', 'user_id', 'me'])
})

test('getMemoryDetailForItem: anonymous (no userId) skips the query, returns null', async () => {
  const { client, calls } = makeStubClient()
  const detail = await getMemoryDetailForItem(null, 'item-1', { client })
  assert.equal(detail, null)
  assert.equal(calls.length, 0)
})

test('getMemoryDetailForItem: missing itemId returns null without querying', async () => {
  const { client, calls } = makeStubClient()
  const detail = await getMemoryDetailForItem('user-1', null, { client })
  assert.equal(detail, null)
  assert.equal(calls.length, 0)
})

test('getMemoryDetailForItem: query error fails safely (returns null, no throw)', async () => {
  const { client } = makeStubClient({ checkinsResult: { data: null, error: { message: 'boom' } } })
  const detail = await getMemoryDetailForItem('user-1', 'item-1', { client })
  assert.equal(detail, null)
})

test('getMemoryDetailForItem: a row with a deleted/null photo_url is still returned (viewer decides fallback)', async () => {
  const { client } = makeStubClient({
    checkinsResult: { data: [row({ photo_url: null, personal_note: 'Great spot' })], error: null },
  })
  const detail = await getMemoryDetailForItem('user-1', 'item-1', { client })
  assert.equal(detail.photo_url, null)
  assert.equal(detail.personal_note, 'Great spot')
})

// ---------------------------------------------------------------------------
// hasMemoryContent
// ---------------------------------------------------------------------------

test('hasMemoryContent: true when a photo exists', () => {
  assert.equal(hasMemoryContent({ photo_url: 'https://x/y.jpg' }), true)
})

test('hasMemoryContent: true when only a note/place exists', () => {
  assert.equal(hasMemoryContent({ personal_note: 'hi' }), true)
  assert.equal(hasMemoryContent({ personal_place: 'Hofbräu' }), true)
})

test('hasMemoryContent: false for a bare check-in with no photo, place, or note', () => {
  assert.equal(hasMemoryContent({ photo_url: null, personal_place: null, personal_note: null }), false)
})

test('hasMemoryContent: false for null detail', () => {
  assert.equal(hasMemoryContent(null), false)
})
