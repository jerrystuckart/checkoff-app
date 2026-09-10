import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLocationStale, createLocationStore, LOCATION_STALE_AFTER_MS } from './locationFreshness.js'

const LOCATION_A = { latitude: 33.5806, longitude: -112.2374 } // Peoria
const LOCATION_B = { latitude: 33.4484, longitude: -112.0740 } // Phoenix, ~15mi away

function makeFetch(coords, { throws = false } = {}) {
  let calls = 0
  const fn = async () => {
    calls++
    if (throws) throw new Error('device fetch failed')
    return coords
  }
  fn.callCount = () => calls
  return fn
}

test('the shared staleness threshold is 5 minutes', () => {
  assert.equal(LOCATION_STALE_AFTER_MS, 5 * 60 * 1000)
})

test('isLocationStale: never-fetched is always stale', () => {
  assert.equal(isLocationStale(null), true)
  assert.equal(isLocationStale(undefined), true)
})

test('isLocationStale: exact threshold boundary counts as stale', () => {
  const now = 1_000_000
  assert.equal(isLocationStale(now - LOCATION_STALE_AFTER_MS, now), true)
  assert.equal(isLocationStale(now - LOCATION_STALE_AFTER_MS + 1, now), false)
})

// ── Scenario A/B mechanics: forced refresh always hits the device and updates state ──
test('force=true always calls deviceFetch and updates to the new location, even when fresh', () => {
  return (async () => {
    const store = createLocationStore({ initialState: { coords: LOCATION_A, lastFetchedAt: Date.now() } })
    const fetchB = makeFetch(LOCATION_B)
    const result = await store.requestFreshLocation({ force: true, deviceFetch: fetchB })
    assert.deepEqual(result.coords, LOCATION_B)
    assert.equal(fetchB.callCount(), 1)
  })()
})

// ── Scenario C: stale foreground check forces a fetch ──
test('force=false fetches when the cached fix is stale (>= 5 minutes old)', () => {
  return (async () => {
    const staleAt = Date.now() - LOCATION_STALE_AFTER_MS - 1000
    const store = createLocationStore({ initialState: { coords: LOCATION_A, lastFetchedAt: staleAt } })
    const fetchB = makeFetch(LOCATION_B)
    const result = await store.requestFreshLocation({ force: false, deviceFetch: fetchB })
    assert.deepEqual(result.coords, LOCATION_B)
    assert.equal(fetchB.callCount(), 1)
  })()
})

// ── Scenario D: fresh foreground check does nothing ──
test('force=false does NOT call deviceFetch when the cached fix is fresh (< 5 minutes old) — no GPS hammering on quick app-switches', () => {
  return (async () => {
    const freshAt = Date.now() - 1000 // 1 second ago
    const store = createLocationStore({ initialState: { coords: LOCATION_A, lastFetchedAt: freshAt } })
    const fetchB = makeFetch(LOCATION_B)
    const result = await store.requestFreshLocation({ force: false, deviceFetch: fetchB })
    assert.deepEqual(result.coords, LOCATION_A, 'must keep the existing fresh location, not call the device')
    assert.equal(fetchB.callCount(), 0)
  })()
})

// ── Scenario E: failure never erases a known-good location ──
test('a deviceFetch that resolves null keeps the last known-good location', () => {
  return (async () => {
    const store = createLocationStore({ initialState: { coords: LOCATION_A, lastFetchedAt: Date.now() - LOCATION_STALE_AFTER_MS - 1 } })
    const failingFetch = makeFetch(null)
    const result = await store.requestFreshLocation({ force: true, deviceFetch: failingFetch })
    assert.deepEqual(result.coords, LOCATION_A, 'failed refresh must not wipe proximity data')
  })()
})

test('a deviceFetch that throws is treated the same as a failed fetch — never crashes, never erases', () => {
  return (async () => {
    const store = createLocationStore({ initialState: { coords: LOCATION_A, lastFetchedAt: Date.now() } })
    const throwingFetch = makeFetch(null, { throws: true })
    const result = await store.requestFreshLocation({ force: true, deviceFetch: throwingFetch })
    assert.deepEqual(result.coords, LOCATION_A)
  })()
})

test('a device fetch failure on the very first ever request leaves coords null, not a crash', () => {
  return (async () => {
    const store = createLocationStore()
    const failingFetch = makeFetch(null)
    const result = await store.requestFreshLocation({ force: true, deviceFetch: failingFetch })
    assert.equal(result.coords, null)
  })()
})

// ── Scenario F: concurrency — no duplicate/overlapping device requests ──
test('overlapping calls (foreground-stale + manual pull at the same time) collapse into a single deviceFetch', () => {
  return (async () => {
    let resolveFetch
    let calls = 0
    const slowFetch = () => {
      calls++
      return new Promise(resolve => { resolveFetch = () => resolve(LOCATION_B) })
    }
    const store = createLocationStore({ initialState: { coords: LOCATION_A, lastFetchedAt: 0 } })

    const p1 = store.requestFreshLocation({ force: false, deviceFetch: slowFetch }) // stale -> triggers fetch
    const p2 = store.requestFreshLocation({ force: true, deviceFetch: slowFetch })  // manual override, arrives mid-flight

    assert.equal(calls, 1, 'a second concurrent request must not start a second device fetch')
    resolveFetch()
    const [r1, r2] = await Promise.all([p1, p2])
    assert.deepEqual(r1.coords, LOCATION_B)
    assert.deepEqual(r2.coords, LOCATION_B)
  })()
})

test('after an in-flight request completes, a new request can trigger a fresh device fetch again', () => {
  return (async () => {
    const store = createLocationStore({ initialState: { coords: LOCATION_A, lastFetchedAt: 0 } })
    const fetchB = makeFetch(LOCATION_B)
    await store.requestFreshLocation({ force: true, deviceFetch: fetchB })
    await store.requestFreshLocation({ force: true, deviceFetch: fetchB })
    assert.equal(fetchB.callCount(), 2, 'sequential (non-overlapping) forced calls must each hit the device')
  })()
})

// ── Subscription notifies listeners only on an actual update ──
test('subscribers are notified when the location changes', () => {
  return (async () => {
    const store = createLocationStore()
    const seen = []
    const unsubscribe = store.subscribe(snapshot => seen.push(snapshot.coords))
    await store.requestFreshLocation({ force: true, deviceFetch: makeFetch(LOCATION_B) })
    unsubscribe()
    assert.deepEqual(seen, [LOCATION_B])
  })()
})

// ── recordLocation: the continuous foreground watcher's write path ────────
// Live foreground arrival ("You Are Here" while Home stays open and the
// user physically walks into a place) depends on this: the shared
// continuous watcher pushes each tick straight into the store, bypassing
// the staleness gate entirely (a watcher tick already IS a fresh fix).
test('recordLocation updates the store immediately, no staleness gate applies', () => {
  const store = createLocationStore({ initialState: { coords: LOCATION_A, lastFetchedAt: Date.now() } })
  store.recordLocation(LOCATION_B)
  assert.deepEqual(store.getSnapshot().coords, LOCATION_B)
})

test('recordLocation notifies subscribers on every tick', () => {
  const store = createLocationStore()
  const seen = []
  const unsubscribe = store.subscribe(snapshot => seen.push(snapshot.coords))
  store.recordLocation(LOCATION_A)
  store.recordLocation(LOCATION_B)
  unsubscribe()
  assert.deepEqual(seen, [LOCATION_A, LOCATION_B])
})

test('recordLocation with no coords is a no-op — never erases a known-good location', () => {
  const store = createLocationStore({ initialState: { coords: LOCATION_A, lastFetchedAt: Date.now() } })
  store.recordLocation(null)
  store.recordLocation(undefined)
  assert.deepEqual(store.getSnapshot().coords, LOCATION_A)
})
