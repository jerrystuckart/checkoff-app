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

// ---------------------------------------------------------------------------
// FIX (2026-09-21 field bug): a session generated in a materially different
// physical location (e.g. Vienna) must never be preserved once the device
// has genuinely traveled somewhere far away (e.g. Munich) — not even within
// the "short interruption" window. This is what let a Vienna item
// (Strudlhofstiege) survive in What's Good after landing in Munich: rule 1
// used to be truly unconditional (time-only), so a session saved shortly
// before/during travel, or left over from a prior test/city session, kept
// being served through a cold relaunch or foreground-return in the new city.
// ---------------------------------------------------------------------------

const MUNICH = { latitude: 48.1351, longitude: 11.5820 }
const VIENNA = { latitude: 48.2082, longitude: 16.3738 } // ~355mi from Munich

test('Test 1 & 13: Munich coordinates + a recently-cached Vienna session -> the Vienna cache is invalidated, not silently reused (even though it is well within the short-interruption window)', () => {
  const session = {
    itemIds: ['strudlhofstiege'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000), // 30 seconds ago — well inside the 5-minute short-interruption window
    fingerprint: 'vienna-fp',
    location: VIENNA,
  }
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'vienna-fp', currentLocation: MUNICH }),
    false,
    'a session generated ~355mi away must never be preserved just because it is recent'
  )
})

test('a short interruption in the SAME city still preserves (regression: the location check must not break the approved short-interruption guarantee)', () => {
  const session = {
    itemIds: ['a'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000),
    fingerprint: 'old-fp',
    location: { latitude: MUNICH.latitude + 0.001, longitude: MUNICH.longitude + 0.001 }, // GPS jitter, same city
  }
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'totally-different-fp', currentLocation: MUNICH }),
    true
  )
})

test('a session with no stored location (older cache shape) falls through to the existing time/fingerprint rules unchanged', () => {
  const session = { itemIds: ['a'], generatedAt: new Date(NOW.getTime() - 30 * 1000), fingerprint: 'old-fp', location: null }
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'new-fp', currentLocation: MUNICH }),
    true,
    'no stored location to compare against -> short-interruption rule still applies as before'
  )
})

test('currentLocation not supplied by the caller -> behaves exactly as before this fix (no regression for callers that do not pass it)', () => {
  const session = { itemIds: ['a'], generatedAt: new Date(NOW.getTime() - 30 * 1000), fingerprint: 'old-fp', location: VIENNA }
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'new-fp' }), true)
})
