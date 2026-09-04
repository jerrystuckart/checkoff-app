import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  saveWhatsGoodSession,
  loadWhatsGoodSession,
  shouldPreserveSession,
  clearWhatsGoodSession,
  BACKGROUND_PRESERVE_MS_DEFAULT,
} from './whatsGoodSessionCache.js'

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

const NOW = new Date('2026-09-02T12:00:00.000Z')

test('save then load round-trips exactly', async () => {
  const storage = makeStubStorage()
  const session = { itemIds: ['a', 'b', 'c'], generatedAt: NOW, fingerprint: 'fp-1', location: { latitude: 1, longitude: 2 } }
  await saveWhatsGoodSession(session, storage)
  const loaded = await loadWhatsGoodSession(storage)
  assert.deepEqual(loaded.itemIds, ['a', 'b', 'c'])
  assert.equal(loaded.generatedAt.toISOString(), NOW.toISOString())
  assert.equal(loaded.fingerprint, 'fp-1')
  assert.deepEqual(loaded.location, { latitude: 1, longitude: 2 })
})

test('missing cache -> null, not an error', async () => {
  const storage = makeStubStorage(null)
  assert.equal(await loadWhatsGoodSession(storage), null)
})

test('corrupt/malformed cached state is recovered gracefully -> null, never throws', async () => {
  assert.equal(await loadWhatsGoodSession(makeStubStorage('not json{{{')), null)
  assert.equal(await loadWhatsGoodSession(makeStubStorage(JSON.stringify({ itemIds: 'not-an-array', generatedAt: NOW.toISOString() }))), null)
  assert.equal(await loadWhatsGoodSession(makeStubStorage(JSON.stringify({ itemIds: ['a'], generatedAt: 'not-a-date' }))), null)
  assert.equal(await loadWhatsGoodSession(makeStubStorage(JSON.stringify({}))), null)
})

test('storage.getItem throwing is also recovered as null, not propagated', async () => {
  const storage = { getItem: async () => { throw new Error('storage failure') } }
  assert.equal(await loadWhatsGoodSession(storage), null)
})

test('clearWhatsGoodSession removes the cached value', async () => {
  const storage = makeStubStorage(JSON.stringify({ itemIds: ['a'], generatedAt: NOW.toISOString() }))
  await clearWhatsGoodSession(storage)
  assert.equal(await loadWhatsGoodSession(storage), null)
})

// ---------------------------------------------------------------------------
// shouldPreserveSession
// ---------------------------------------------------------------------------

test('no cached session -> never preserve', () => {
  assert.equal(shouldPreserveSession(null, { now: NOW, currentFingerprint: 'fp' }), false)
})

test('short interruption (age within default threshold) preserves regardless of fingerprint', () => {
  const session = { itemIds: ['a'], generatedAt: new Date(NOW.getTime() - 60 * 1000), fingerprint: 'old-fp' }
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'new-fp' }), true)
})

test('short interruption respects a custom backgroundPreserveMs override', () => {
  const session = { itemIds: ['a'], generatedAt: new Date(NOW.getTime() - 10 * 1000), fingerprint: 'old-fp' }
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'new-fp', backgroundPreserveMs: 5000 }), false)
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'new-fp', backgroundPreserveMs: 20000 }), true)
})

test('beyond the short-interruption window: same fingerprint still preserves', () => {
  const session = { itemIds: ['a'], generatedAt: new Date(NOW.getTime() - BACKGROUND_PRESERVE_MS_DEFAULT - 60000), fingerprint: 'fp-same' }
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'fp-same' }), true)
})

test('materially changed context (fingerprint differs) beyond the short-interruption window -> does not preserve', () => {
  const session = { itemIds: ['a'], generatedAt: new Date(NOW.getTime() - BACKGROUND_PRESERVE_MS_DEFAULT - 60000), fingerprint: 'fp-old' }
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'fp-new' }), false)
})

test('null/missing fingerprints never falsely match', () => {
  const session = { itemIds: ['a'], generatedAt: new Date(NOW.getTime() - BACKGROUND_PRESERVE_MS_DEFAULT - 60000), fingerprint: null }
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: null }), false)
})
