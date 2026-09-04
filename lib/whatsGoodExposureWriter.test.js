import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordWhatsGoodExposure } from './whatsGoodExposureWriter.js'

const NOW = new Date('2026-09-02T12:00:00.000Z')

function makeStubClient({ error = null } = {}) {
  const upsertCalls = []
  const client = {
    from(table) {
      assert.equal(table, 'whats_good_exposures')
      return {
        upsert(rows, options) {
          upsertCalls.push({ rows, options })
          return Promise.resolve({ data: rows, error })
        },
      }
    },
  }
  return { client, upsertCalls }
}

test('batches all displayed item IDs into ONE upsert call, not one write per item', async () => {
  const { client, upsertCalls } = makeStubClient()
  await recordWhatsGoodExposure({ userId: 'user-1', itemIds: ['a', 'b', 'c'], now: NOW, client })
  assert.equal(upsertCalls.length, 1)
  assert.equal(upsertCalls[0].rows.length, 3)
})

test('upsert payload has the correct shape: user_id, item_id, last_shown_at per row', async () => {
  const { client, upsertCalls } = makeStubClient()
  await recordWhatsGoodExposure({ userId: 'user-1', itemIds: ['a', 'b'], now: NOW, client })
  assert.deepEqual(upsertCalls[0].rows, [
    { user_id: 'user-1', item_id: 'a', last_shown_at: NOW.toISOString() },
    { user_id: 'user-1', item_id: 'b', last_shown_at: NOW.toISOString() },
  ])
})

test('uses the composite (user_id, item_id) conflict target, matching the exposures table PK', async () => {
  const { client, upsertCalls } = makeStubClient()
  await recordWhatsGoodExposure({ userId: 'user-1', itemIds: ['a'], now: NOW, client })
  assert.equal(upsertCalls[0].options.onConflict, 'user_id,item_id')
})

test('records ONLY the item IDs actually passed — never the full candidate pool implicitly', async () => {
  const { client, upsertCalls } = makeStubClient()
  await recordWhatsGoodExposure({ userId: 'user-1', itemIds: ['displayed-1', 'displayed-2', 'displayed-3'], now: NOW, client })
  assert.deepEqual(upsertCalls[0].rows.map((r) => r.item_id), ['displayed-1', 'displayed-2', 'displayed-3'])
})

test('empty itemIds -> no write at all', async () => {
  const { client, upsertCalls } = makeStubClient()
  await recordWhatsGoodExposure({ userId: 'user-1', itemIds: [], now: NOW, client })
  assert.equal(upsertCalls.length, 0)
})

test('propagates upsert errors clearly', async () => {
  const { client } = makeStubClient({ error: new Error('upsert failed') })
  await assert.rejects(() => recordWhatsGoodExposure({ userId: 'user-1', itemIds: ['a'], now: NOW, client }), /upsert failed/)
})
