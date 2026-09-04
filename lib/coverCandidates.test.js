import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasPendingCoverCandidate, submitCoverCandidate, resolveActiveCoverUrl, fetchActiveCoverImageUrl, attachActiveCoverImages } from './coverCandidates.js'

function chainable(result) {
  const handler = {
    select: () => handler,
    eq: () => handler,
    in: () => handler,
    limit: () => handler,
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
    insert: () => handler,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return handler
}

test('hasPendingCoverCandidate: true when a pending/needs_review row exists', async () => {
  const client = { from: () => chainable({ data: [{ id: 'c1' }], error: null }) }
  const result = await hasPendingCoverCandidate({ userId: 'u1', itemId: 'i1', client })
  assert.equal(result, true)
})

test('hasPendingCoverCandidate: false when no rows exist', async () => {
  const client = { from: () => chainable({ data: [], error: null }) }
  const result = await hasPendingCoverCandidate({ userId: 'u1', itemId: 'i1', client })
  assert.equal(result, false)
})

test('hasPendingCoverCandidate: fails open (false) on a query error rather than blocking eligibility', async () => {
  const client = { from: () => chainable({ data: null, error: new Error('network') }) }
  const result = await hasPendingCoverCandidate({ userId: 'u1', itemId: 'i1', client })
  assert.equal(result, false)
})

test('submitCoverCandidate: inserts with consent_ack true and returns id/status', async () => {
  let insertedRow = null
  const client = {
    from: () => ({
      insert(row) {
        insertedRow = row
        return chainable({ data: { id: 'new-id', status: 'needs_review' }, error: null })
      },
    }),
  }
  const result = await submitCoverCandidate({
    userId: 'u1',
    itemId: 'i1',
    storagePath: 'cover-candidates/u1/123.jpg',
    status: 'needs_review',
    moderationMetadata: { passesBasicSanity: true },
    client,
  })
  assert.deepEqual(result, { id: 'new-id', status: 'needs_review' })
  assert.equal(insertedRow.consent_ack, true, 'consent_ack must always be true on insert')
  assert.equal(insertedRow.item_id, 'i1')
  assert.equal(insertedRow.submitted_by_user_id, 'u1')
})

test('submitCoverCandidate: throws a clear error when the insert fails (e.g. RLS rejection)', async () => {
  const client = { from: () => ({ insert: () => chainable({ data: null, error: { message: 'permission denied' } }) }) }
  await assert.rejects(
    () => submitCoverCandidate({ userId: 'u1', itemId: 'i1', storagePath: 'x', status: 'needs_review', client }),
    /permission denied/
  )
})

test('resolveActiveCoverUrl: null when the item has no active_cover_candidate_id', async () => {
  const client = { from: () => chainable({ data: null, error: null }) }
  const result = await resolveActiveCoverUrl({ activeCoverCandidateId: null, client })
  assert.equal(result, null)
})

test('resolveActiveCoverUrl: returns a signed url when the candidate is actually status=selected', async () => {
  const client = {
    from: () => chainable({ data: { storage_path: 'cover-candidates/u1/123.jpg', status: 'selected' }, error: null }),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example.com/abc' }, error: null }),
      }),
    },
  }
  const result = await resolveActiveCoverUrl({ activeCoverCandidateId: 'cand-1', client })
  assert.equal(result, 'https://signed.example.com/abc')
})

test('resolveActiveCoverUrl: null (defense in depth) when the candidate row is not actually status=selected', async () => {
  // simulates a stale items.active_cover_candidate_id pointer -- the
  // .eq('status', 'selected') filter means maybeSingle() finds nothing
  const client = { from: () => chainable({ data: null, error: null }) }
  const result = await resolveActiveCoverUrl({ activeCoverCandidateId: 'cand-1', client })
  assert.equal(result, null)
})

test('resolveActiveCoverUrl: null when signing fails', async () => {
  const client = {
    from: () => chainable({ data: { storage_path: 'cover-candidates/u1/123.jpg', status: 'selected' }, error: null }),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: null, error: { message: 'not found' } }),
      }),
    },
  }
  const result = await resolveActiveCoverUrl({ activeCoverCandidateId: 'cand-1', client })
  assert.equal(result, null)
})

// FINAL UI PASS BEFORE BUILD 144 — item 3: Item Detail must resolve the
// same selected cover regardless of navigation source. fetchActiveCoverImageUrl
// is the single fetch-by-item-id path every entry point can share.

function multiTableClient({ items, candidates, signedUrl, signError }) {
  return {
    from(table) {
      if (table === 'items') return chainable(items)
      if (table === 'item_cover_candidates') return chainable(candidates)
      throw new Error(`unexpected table in test: ${table}`)
    },
    storage: {
      from: () => ({
        createSignedUrl: async () =>
          signError ? { data: null, error: signError } : { data: { signedUrl }, error: null },
      }),
    },
  }
}

test('fetchActiveCoverImageUrl: resolves a real signed url by item id alone, no dependency on how the item was mapped', async () => {
  const client = multiTableClient({
    items: { data: { active_cover_candidate_id: 'cand-1' }, error: null },
    candidates: { data: { storage_path: 'cover-candidates/editorial/x.png', status: 'selected' }, error: null },
    signedUrl: 'https://signed.example.com/redzone',
  })
  const result = await fetchActiveCoverImageUrl({ itemId: 'item-1', client })
  assert.equal(result, 'https://signed.example.com/redzone')
})

test('fetchActiveCoverImageUrl: null when the item has no active_cover_candidate_id', async () => {
  const client = multiTableClient({
    items: { data: { active_cover_candidate_id: null }, error: null },
    candidates: { data: null, error: null },
    signedUrl: null,
  })
  const result = await fetchActiveCoverImageUrl({ itemId: 'item-1', client })
  assert.equal(result, null)
})

test('fetchActiveCoverImageUrl: null (not a throw) when the item lookup itself errors', async () => {
  const client = multiTableClient({
    items: { data: null, error: new Error('network') },
    candidates: { data: null, error: null },
    signedUrl: null,
  })
  const result = await fetchActiveCoverImageUrl({ itemId: 'item-1', client })
  assert.equal(result, null)
})

test('attachActiveCoverImages: enriches only items with a truthy activeCoverCandidateId, leaves others untouched', async () => {
  const client = {
    from: () => chainable({ data: { storage_path: 'p.png', status: 'selected' }, error: null }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example.com/z' }, error: null }) }) },
  }
  const items = [
    { id: 'a', activeCoverCandidateId: 'cand-a' },
    { id: 'b', activeCoverCandidateId: null },
  ]
  const result = await attachActiveCoverImages(items, client)
  assert.equal(result.find(i => i.id === 'a').activeCoverImageUrl, 'https://signed.example.com/z')
  assert.equal(result.find(i => i.id === 'b').activeCoverImageUrl, undefined)
  assert.equal(result.find(i => i.id === 'b'), items[1], 'untouched item keeps the same object reference')
})

test('attachActiveCoverImages: no-op (same array) when nothing has an active cover', async () => {
  const client = { from: () => chainable({ data: null, error: null }) }
  const items = [{ id: 'a', activeCoverCandidateId: null }]
  const result = await attachActiveCoverImages(items, client)
  assert.equal(result, items)
})
