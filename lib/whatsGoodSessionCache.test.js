import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  saveWhatsGoodSession,
  loadWhatsGoodSession,
  shouldPreserveSession,
  describeSessionPreservationDecision,
  clearWhatsGoodSession,
  BACKGROUND_PRESERVE_MS_DEFAULT,
} from './whatsGoodSessionCache.js'
import { COVERAGE_MODE } from './whatsGoodCoverageMode.js'

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

// 2026-09-22 coverage-mode policy fix: shouldPreserveSession now
// unconditionally rejects a cached session missing `schemaVersion`/
// `coverageMode` (see the dedicated "old-shaped cache" tests below) — every
// fixture in THIS file that exercises a rule other than that schema check
// must now explicitly carry a valid, current-shaped session so the schema
// check itself never becomes an accidental confound. This helper is the
// single place that shape lives.
function validSession(overrides = {}) {
  return {
    schemaVersion: 2,
    coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT,
    itemIds: ['a'],
    generatedAt: NOW,
    fingerprint: 'fp',
    ...overrides,
  }
}

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
// 2026-09-22 coverage-mode policy fix — schema check (Step 8's "old cache
// without location/metro/coverage mode -> invalid"). Unconditional: not
// gated on the caller supplying currentLocation/currentMetroId, unlike the
// location/metro checks further below.
// ---------------------------------------------------------------------------

test('a session missing schemaVersion entirely (pre-2026-09-22 cache shape) is never preserved, even though every other field looks otherwise valid/recent/matching', () => {
  const session = { itemIds: ['a'], generatedAt: new Date(NOW.getTime() - 1000), fingerprint: 'fp', coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT }
  // no schemaVersion at all
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'fp' }), false)
})

test('a session missing coverageMode entirely is never preserved, even with a current schemaVersion', () => {
  const session = { schemaVersion: 2, itemIds: ['a'], generatedAt: new Date(NOW.getTime() - 1000), fingerprint: 'fp' }
  // no coverageMode at all
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'fp' }), false)
})

test('a session with an OLDER schemaVersion number is never preserved (schema check is exact-match, not >=)', () => {
  const session = validSession({ schemaVersion: 1 })
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'fp' }), false)
})

test('a fully current-shaped session (schemaVersion + coverageMode present) passes the schema check and is preserved on a short interruption', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - 60 * 1000) })
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'totally-different' }), true)
})

test('loadWhatsGoodSession round-trips schemaVersion and coverageMode', async () => {
  const storage = makeStubStorage()
  const session = { itemIds: ['a'], generatedAt: NOW, fingerprint: 'fp', location: null, coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE }
  await saveWhatsGoodSession(session, storage)
  const loaded = await loadWhatsGoodSession(storage)
  assert.equal(loaded.schemaVersion, 2)
  assert.equal(loaded.coverageMode, COVERAGE_MODE.SUPPORTED_SPARSE)
})

test('loadWhatsGoodSession on an old-shaped persisted payload (no schemaVersion/coverageMode keys at all) loads them back as null, never throws', async () => {
  const storage = makeStubStorage(JSON.stringify({ itemIds: ['a'], generatedAt: NOW.toISOString(), fingerprint: 'fp' }))
  const loaded = await loadWhatsGoodSession(storage)
  assert.equal(loaded.schemaVersion, null)
  assert.equal(loaded.coverageMode, null)
})

// ---------------------------------------------------------------------------
// shouldPreserveSession — base rules (now exercised through validSession()
// so the schema check above is never an accidental confound).
// ---------------------------------------------------------------------------

test('no cached session -> never preserve', () => {
  assert.equal(shouldPreserveSession(null, { now: NOW, currentFingerprint: 'fp' }), false)
})

test('short interruption (age within default threshold) preserves regardless of fingerprint', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - 60 * 1000), fingerprint: 'old-fp' })
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'new-fp' }), true)
})

test('short interruption respects a custom backgroundPreserveMs override', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - 10 * 1000), fingerprint: 'old-fp' })
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'new-fp', backgroundPreserveMs: 5000 }), false)
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'new-fp', backgroundPreserveMs: 20000 }), true)
})

test('beyond the short-interruption window: same fingerprint still preserves', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - BACKGROUND_PRESERVE_MS_DEFAULT - 60000), fingerprint: 'fp-same' })
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'fp-same' }), true)
})

test('materially changed context (fingerprint differs) beyond the short-interruption window -> does not preserve', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - BACKGROUND_PRESERVE_MS_DEFAULT - 60000), fingerprint: 'fp-old' })
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'fp-new' }), false)
})

test('null/missing fingerprints never falsely match', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - BACKGROUND_PRESERVE_MS_DEFAULT - 60000), fingerprint: null })
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
  const session = validSession({
    itemIds: ['strudlhofstiege'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000), // 30 seconds ago — well inside the 5-minute short-interruption window
    fingerprint: 'vienna-fp',
    location: VIENNA,
  })
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'vienna-fp', currentLocation: MUNICH }),
    false,
    'a session generated ~355mi away must never be preserved just because it is recent'
  )
})

test('a short interruption in the SAME city still preserves (regression: the location check must not break the approved short-interruption guarantee)', () => {
  const session = validSession({
    itemIds: ['a'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000),
    fingerprint: 'old-fp',
    location: { latitude: MUNICH.latitude + 0.001, longitude: MUNICH.longitude + 0.001 }, // GPS jitter, same city
  })
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'totally-different-fp', currentLocation: MUNICH }),
    true
  )
})

test('Test 5: a session with no stored location (older cache shape, or a capture that failed) is now INCOMPATIBLE when the caller supplies a currentLocation -> must regenerate, not be assumed fine (2026-09-21 follow-up fix — closes the gap that let a stale Vienna cache survive a900be1)', () => {
  const session = validSession({ itemIds: ['a'], generatedAt: new Date(NOW.getTime() - 30 * 1000), fingerprint: 'old-fp', location: null })
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'new-fp', currentLocation: MUNICH }),
    false,
    'no stored location to verify compatibility against, and the caller DOES know the current location -> cannot be trusted, even though it is recent'
  )
})

test('a session with no stored location is still preserved (short-interruption rule) when the caller does not supply currentLocation at all — opt-in, not a trap', () => {
  const session = validSession({ itemIds: ['a'], generatedAt: new Date(NOW.getTime() - 30 * 1000), fingerprint: 'old-fp', location: null })
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'new-fp' }),
    true,
    'the caller never claimed to know the current location, so the new location-based rejection does not apply'
  )
})

test('currentLocation not supplied by the caller -> behaves exactly as before this fix (no regression for callers that do not pass it)', () => {
  const session = validSession({ itemIds: ['a'], generatedAt: new Date(NOW.getTime() - 30 * 1000), fingerprint: 'old-fp', location: VIENNA })
  assert.equal(shouldPreserveSession(session, { now: NOW, currentFingerprint: 'new-fp' }), true)
})

// ---------------------------------------------------------------------------
// FIX (2026-09-21 follow-up): resolved metro IDENTITY compatibility — an
// explicit check independent of raw lat/lng distance, per this task's new
// requirement. Only enforced when the caller supplies `currentMetroId`.
// ---------------------------------------------------------------------------

test('save then load round-trips resolvedMetroId', async () => {
  const storage = makeStubStorage()
  const session = { itemIds: ['a'], generatedAt: NOW, fingerprint: 'fp', location: MUNICH, resolvedMetroId: 'munich-metro-id' }
  await saveWhatsGoodSession(session, storage)
  const loaded = await loadWhatsGoodSession(storage)
  assert.equal(loaded.resolvedMetroId, 'munich-metro-id')
})

test('missing resolvedMetroId in the persisted payload loads back as null (older cache shape), never throws', async () => {
  const storage = makeStubStorage(JSON.stringify({ itemIds: ['a'], generatedAt: NOW.toISOString(), fingerprint: 'fp', location: MUNICH }))
  const loaded = await loadWhatsGoodSession(storage)
  assert.equal(loaded.resolvedMetroId, null)
})

test('Test 6: a cache with a Vienna resolvedMetroId is invalid for a Munich current context, even though it is recent and its stored location happens to be present -> must regenerate', () => {
  const session = validSession({
    itemIds: ['strudlhofstiege'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000),
    fingerprint: 'vienna-fp',
    location: MUNICH, // stored coordinates happen to already read as "close enough" by raw distance...
    resolvedMetroId: 'vienna-metro-id', // ...but the resolved metro identity still disagrees.
  })
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'vienna-fp', currentLocation: MUNICH, currentMetroId: 'munich-metro-id' }),
    false,
    'resolved metro identity must be checked independently of raw distance, not merely as a restatement of it'
  )
})

test('a cache missing resolvedMetroId entirely is invalid once the caller supplies currentMetroId -> must regenerate', () => {
  const session = validSession({
    itemIds: ['a'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000),
    fingerprint: 'fp',
    location: MUNICH,
    resolvedMetroId: null,
  })
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'fp', currentLocation: MUNICH, currentMetroId: 'munich-metro-id' }),
    false
  )
})

test('matching resolvedMetroId + matching location -> still preserved (regression: the new metro-identity check must not break the compatible case)', () => {
  const session = validSession({
    itemIds: ['a'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000),
    fingerprint: 'old-fp',
    location: MUNICH,
    resolvedMetroId: 'munich-metro-id',
  })
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'totally-different-fp', currentLocation: MUNICH, currentMetroId: 'munich-metro-id' }),
    true
  )
})

test('currentMetroId not supplied by the caller -> metro-identity check is skipped entirely (opt-in, no regression for callers that do not pass it)', () => {
  const session = validSession({
    itemIds: ['a'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000),
    fingerprint: 'old-fp',
    location: MUNICH,
    resolvedMetroId: 'some-other-metro-id',
  })
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'old-fp', currentLocation: MUNICH }),
    true,
    'no currentMetroId supplied -> only the distance check (already passing) applies'
  )
})

// ---------------------------------------------------------------------------
// Test 10 (critical overcorrection guard): a user genuinely IN Vienna, with
// a genuinely Vienna-resolved cache, must still see it preserved — this fix
// must reject STALE/mismatched caches, not location-based caching itself.
// ---------------------------------------------------------------------------

test('Test 10: a user actually in Vienna with a matching Vienna cache is still preserved (this fix must not overcorrect into rejecting every cache)', () => {
  const session = validSession({
    itemIds: ['strudlhofstiege'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000),
    fingerprint: 'vienna-fp',
    location: VIENNA,
    resolvedMetroId: 'vienna-metro-id',
  })
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'vienna-fp', currentLocation: VIENNA, currentMetroId: 'vienna-metro-id' }),
    true,
    'a user legitimately in Vienna, with a cache that matches both location and resolved metro identity, must still see it preserved'
  )
})

// ---------------------------------------------------------------------------
// 2026-09-22 coverage-mode policy fix — Part 5 (drift check): a cached
// SUPPORTED_SPARSE session must be invalidated once the CURRENT eligible-
// local-count has grown past the sparse threshold at the SAME location, even
// though location/metro checks alone would have preserved it. Only enforced
// when the caller supplies currentEligibleLocalCount + targetCount (opt-in,
// same pattern as the location/metro checks above).
// ---------------------------------------------------------------------------

test('Step 8 example: a SUPPORTED_SPARSE cache is invalidated once currentEligibleLocalCount has grown past target at the SAME location', () => {
  const session = validSession({
    itemIds: ['local-1', 'universal-1', 'universal-2'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000),
    fingerprint: 'fp',
    location: MUNICH,
    coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE,
  })
  assert.equal(
    shouldPreserveSession(session, {
      now: NOW,
      currentFingerprint: 'totally-different-fp',
      currentLocation: MUNICH,
      currentEligibleLocalCount: 5, // now well past target — should be SUPPORTED_SUFFICIENT
      targetCount: 3,
    }),
    false,
    'more local inventory has become available at the same spot — the stale sparse composition (with its Universal filler) must not be replayed'
  )
})

test('a SUPPORTED_SPARSE cache IS still preserved when currentEligibleLocalCount is unchanged (still genuinely sparse) — the drift check does not FALSELY invalidate a still-correct cache', () => {
  const session = validSession({
    itemIds: ['local-1', 'universal-1', 'universal-2'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000), // within the short-interruption window
    fingerprint: 'whatever-mismatched-fingerprint',
    location: MUNICH,
    coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE,
  })
  assert.equal(
    shouldPreserveSession(session, {
      now: NOW,
      currentFingerprint: 'totally-different-fp',
      currentLocation: MUNICH,
      currentEligibleLocalCount: 1, // still sparse (1 < target 3, still >= 1)
      targetCount: 3,
    }),
    true,
    'still genuinely sparse at the same location -> the drift check must agree with the cached mode and the short-interruption rule must still grant preservation regardless of the fingerprint mismatch'
  )
})

test('the drift check is a generic mode-mismatch check, not hardcoded to SUPPORTED_SPARSE -> a cached SUPPORTED_SUFFICIENT session is equally invalidated if the caller supplies a count that disagrees with it', () => {
  // shouldPreserveSession itself has no special-casing for which cached
  // mode gets this check — it simply re-derives the CURRENT mode from
  // whatever count the caller supplies and compares. lib/whatsGoodOrchestrator.js
  // is what chooses to only ever supply this count when the CACHED mode is
  // SUPPORTED_SPARSE (to avoid paying for an extra query on the much more
  // common SUPPORTED_SUFFICIENT/UNSUPPORTED cache hits) — that cost-control
  // policy is tested separately at the orchestrator level, not here.
  const session = validSession({
    itemIds: ['a', 'b', 'c'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000),
    fingerprint: 'fp',
    location: MUNICH,
    coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT,
  })
  assert.equal(
    shouldPreserveSession(session, {
      now: NOW,
      currentFingerprint: 'fp',
      currentLocation: MUNICH,
      currentEligibleLocalCount: 0, // would freshly derive as UNSUPPORTED, disagreeing with the cached SUPPORTED_SUFFICIENT
      targetCount: 3,
    }),
    false
  )
})

test('currentEligibleLocalCount/targetCount not supplied -> drift check is skipped entirely (opt-in, no regression for callers without a cheap fresh count handy)', () => {
  const session = validSession({
    itemIds: ['local-1', 'universal-1'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000),
    fingerprint: 'old-fp',
    location: MUNICH,
    coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE,
  })
  assert.equal(
    shouldPreserveSession(session, { now: NOW, currentFingerprint: 'totally-different-fp', currentLocation: MUNICH }),
    true
  )
})

// ---------------------------------------------------------------------------
// ADMIN DIAGNOSTICS PANEL (Phase 1, 2026-09-23) — describeSessionPreservationDecision
// mirrors shouldPreserveSession's exact same priority-ordered checks, one
// test per reason string, each also cross-checked against the real
// shouldPreserveSession() boolean so the two can never silently drift.
// ---------------------------------------------------------------------------

test('describeSessionPreservationDecision: no cached session -> no-cached-session', () => {
  const options = { now: NOW, currentFingerprint: 'fp' }
  assert.deepEqual(describeSessionPreservationDecision(null, options), { preserved: false, reason: 'no-cached-session' })
  assert.equal(shouldPreserveSession(null, options), false)
})

test('describeSessionPreservationDecision: missing schemaVersion -> schema-version-mismatch', () => {
  const session = { itemIds: ['a'], generatedAt: new Date(NOW.getTime() - 1000), fingerprint: 'fp', coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT }
  const options = { now: NOW, currentFingerprint: 'fp' }
  assert.deepEqual(describeSessionPreservationDecision(session, options), { preserved: false, reason: 'schema-version-mismatch' })
  assert.equal(shouldPreserveSession(session, options), false)
})

test('describeSessionPreservationDecision: older schemaVersion number -> schema-version-mismatch', () => {
  const session = validSession({ schemaVersion: 1 })
  const options = { now: NOW, currentFingerprint: 'fp' }
  assert.deepEqual(describeSessionPreservationDecision(session, options), { preserved: false, reason: 'schema-version-mismatch' })
  assert.equal(shouldPreserveSession(session, options), false)
})

test('describeSessionPreservationDecision: missing coverageMode -> schema-version-mismatch (old-shaped cache)', () => {
  const session = { schemaVersion: 2, itemIds: ['a'], generatedAt: new Date(NOW.getTime() - 1000), fingerprint: 'fp' }
  const options = { now: NOW, currentFingerprint: 'fp' }
  assert.deepEqual(describeSessionPreservationDecision(session, options), { preserved: false, reason: 'schema-version-mismatch' })
  assert.equal(shouldPreserveSession(session, options), false)
})

test('describeSessionPreservationDecision: caller supplies currentLocation but cached session has none -> location-unknown-recompute', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - 30 * 1000), location: null })
  const options = { now: NOW, currentFingerprint: 'fp', currentLocation: MUNICH }
  assert.deepEqual(describeSessionPreservationDecision(session, options), { preserved: false, reason: 'location-unknown-recompute' })
  assert.equal(shouldPreserveSession(session, options), false)
})

test('describeSessionPreservationDecision: cached location beyond MAX_NEARBY_RADIUS_M -> location-moved-beyond-radius', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - 30 * 1000), fingerprint: 'vienna-fp', location: VIENNA })
  const options = { now: NOW, currentFingerprint: 'vienna-fp', currentLocation: MUNICH }
  assert.deepEqual(describeSessionPreservationDecision(session, options), { preserved: false, reason: 'location-moved-beyond-radius' })
  assert.equal(shouldPreserveSession(session, options), false)
})

test('describeSessionPreservationDecision: resolved metro identity mismatch -> metro-mismatch', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - 30 * 1000), fingerprint: 'vienna-fp', location: MUNICH, resolvedMetroId: 'vienna-metro-id' })
  const options = { now: NOW, currentFingerprint: 'vienna-fp', currentLocation: MUNICH, currentMetroId: 'munich-metro-id' }
  assert.deepEqual(describeSessionPreservationDecision(session, options), { preserved: false, reason: 'metro-mismatch' })
  assert.equal(shouldPreserveSession(session, options), false)
})

test('describeSessionPreservationDecision: missing resolvedMetroId when currentMetroId supplied -> metro-mismatch', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - 30 * 1000), fingerprint: 'fp', location: MUNICH, resolvedMetroId: null })
  const options = { now: NOW, currentFingerprint: 'fp', currentLocation: MUNICH, currentMetroId: 'munich-metro-id' }
  assert.deepEqual(describeSessionPreservationDecision(session, options), { preserved: false, reason: 'metro-mismatch' })
  assert.equal(shouldPreserveSession(session, options), false)
})

test('describeSessionPreservationDecision: coverage-mode drift -> coverage-mode-drift', () => {
  const session = validSession({
    itemIds: ['local-1', 'universal-1', 'universal-2'],
    generatedAt: new Date(NOW.getTime() - 30 * 1000),
    fingerprint: 'totally-different-fp',
    location: MUNICH,
    coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE,
  })
  const options = { now: NOW, currentFingerprint: 'totally-different-fp', currentLocation: MUNICH, currentEligibleLocalCount: 5, targetCount: 3 }
  assert.deepEqual(describeSessionPreservationDecision(session, options), { preserved: false, reason: 'coverage-mode-drift' })
  assert.equal(shouldPreserveSession(session, options), false)
})

test('describeSessionPreservationDecision: short interruption -> preserved-short-interruption', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - 60 * 1000), fingerprint: 'old-fp' })
  const options = { now: NOW, currentFingerprint: 'new-fp' }
  assert.deepEqual(describeSessionPreservationDecision(session, options), { preserved: true, reason: 'preserved-short-interruption' })
  assert.equal(shouldPreserveSession(session, options), true)
})

test('describeSessionPreservationDecision: beyond short-interruption window with matching fingerprint -> preserved-fingerprint-match', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - BACKGROUND_PRESERVE_MS_DEFAULT - 60000), fingerprint: 'fp-same' })
  const options = { now: NOW, currentFingerprint: 'fp-same' }
  assert.deepEqual(describeSessionPreservationDecision(session, options), { preserved: true, reason: 'preserved-fingerprint-match' })
  assert.equal(shouldPreserveSession(session, options), true)
})

test('describeSessionPreservationDecision: beyond short-interruption window with mismatched fingerprint -> fingerprint-mismatch-recompute', () => {
  const session = validSession({ generatedAt: new Date(NOW.getTime() - BACKGROUND_PRESERVE_MS_DEFAULT - 60000), fingerprint: 'fp-old' })
  const options = { now: NOW, currentFingerprint: 'fp-new' }
  assert.deepEqual(describeSessionPreservationDecision(session, options), { preserved: false, reason: 'fingerprint-mismatch-recompute' })
  assert.equal(shouldPreserveSession(session, options), false)
})

test('describeSessionPreservationDecision: never called from the hot path — shouldPreserveSession remains unchanged/importable and behaves identically for a representative matrix of cases', () => {
  const cases = [
    [null, { now: NOW, currentFingerprint: 'fp' }],
    [validSession({ generatedAt: new Date(NOW.getTime() - 60 * 1000) }), { now: NOW, currentFingerprint: 'x' }],
    [validSession({ schemaVersion: 1 }), { now: NOW, currentFingerprint: 'x' }],
  ]
  for (const [session, options] of cases) {
    assert.equal(describeSessionPreservationDecision(session, options).preserved, shouldPreserveSession(session, options))
  }
})

// ---------------------------------------------------------------------------
// clearWhatsGoodSession removes ONLY its own storage key.
// ---------------------------------------------------------------------------

test('clearWhatsGoodSession removes only whats_good_session_v1, leaving every other stored key untouched', async () => {
  const store = new Map([
    ['whats_good_session_v1', JSON.stringify({ itemIds: ['a'], generatedAt: NOW.toISOString() })],
    ['selected_metro_slug', 'munich'],
    ['supabase.auth.token', 'super-secret-auth-token-value'],
    ['checkin_memory_v1', JSON.stringify({ itemId: 'x' })],
  ])
  const storage = {
    async getItem(key) { return store.has(key) ? store.get(key) : null },
    async setItem(key, val) { store.set(key, val) },
    async removeItem(key) { store.delete(key) },
  }

  await clearWhatsGoodSession(storage)

  assert.equal(store.has('whats_good_session_v1'), false)
  assert.equal(store.get('selected_metro_slug'), 'munich')
  assert.equal(store.get('supabase.auth.token'), 'super-secret-auth-token-value')
  assert.equal(store.get('checkin_memory_v1'), JSON.stringify({ itemId: 'x' }))
  assert.equal(store.size, 3)
})
