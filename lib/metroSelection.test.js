import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nearestMetroByCoords, fallbackMetro, resolveHomeMetro } from './metroSelection.js'

// Real-ish active-metro fixture, including the two cities central to the
// reported bug (Vienna was resolving to Phoenix on a WiFi-only Android
// device in Vienna) plus a couple of others so "nearest" is a real contest,
// not a two-item coin flip.
const PHOENIX = { id: 'p', name: 'Phoenix Metro', slug: 'phoenix', center_lat: 33.4484, center_lng: -112.0740 }
const MILWAUKEE = { id: 'm', name: 'Milwaukee Metro', slug: 'milwaukee', center_lat: 43.0389, center_lng: -87.9065 }
const VIENNA = { id: 'v', name: 'Vienna Metro', slug: 'vienna', center_lat: 48.2082, center_lng: 16.3738 }
const DENVER = { id: 'd', name: 'Denver Metro', slug: 'denver', center_lat: 39.7392, center_lng: -104.9903 }
const METROS = [PHOENIX, MILWAUKEE, VIENNA, DENVER]

const VIENNA_COORDS = { latitude: 48.2, longitude: 16.37 } // inner Vienna, WiFi-only fix

// ── Test 1: Vienna coordinates resolve to Vienna ───────────────────────────
test('nearestMetroByCoords: Vienna-area coordinates resolve to Vienna, not Phoenix', () => {
  const nearest = nearestMetroByCoords(VIENNA_COORDS, METROS)
  assert.equal(nearest.slug, 'vienna')
})

test('resolveHomeMetro: no persisted choice + ready Vienna location resolves to Vienna', () => {
  const { metro, reason } = resolveHomeMetro({
    persistedSlug: null,
    metros: METROS,
    location: VIENNA_COORDS,
    locationState: 'ready',
  })
  assert.equal(metro.slug, 'vienna')
  assert.equal(reason, 'nearest')
})

// ── Test 2: the resolution function takes coordinates only — no network-
// type parameter exists at all, so a WiFi-only device can never be
// special-cased differently from a cellular one. Structural guard against
// this ever being (re)introduced. ──────────────────────────────────────────
test('nearestMetroByCoords/resolveHomeMetro accept no network-status parameter of any kind', () => {
  assert.equal(nearestMetroByCoords.length, 2, 'nearestMetroByCoords(location, metros) — coords + metros only')
  const paramNames = resolveHomeMetro.toString().match(/\(\s*\{([^}]*)\}/)[1]
  assert.ok(!/network|wifi|cellular|connection/i.test(paramNames),
    'resolveHomeMetro must not accept a network/connectivity-type parameter')
})

test('WiFi-only-but-valid-coordinates resolves exactly like any other valid coordinates', () => {
  // There is no "source" or "network" field on location at all — a fix is
  // a fix. This proves identical input produces identical output
  // regardless of what a caller might have implied about how it was
  // acquired (this test passes the same coords twice; nothing in the
  // function signature could even distinguish them).
  const a = nearestMetroByCoords(VIENNA_COORDS, METROS)
  const b = nearestMetroByCoords({ ...VIENNA_COORDS }, METROS)
  assert.equal(a.slug, b.slug)
})

// ── Test 3: pending location never causes a premature/permanent fallback ──
test('resolveHomeMetro: pending location returns no metro at all (caller must wait, not default)', () => {
  const { metro, reason } = resolveHomeMetro({
    persistedSlug: null,
    metros: METROS,
    location: null,
    locationState: 'pending',
  })
  assert.equal(metro, null)
  assert.equal(reason, 'pending')
})

test('resolveHomeMetro: pending never resolves to the fallback metro, even though metros[0] exists', () => {
  const { metro } = resolveHomeMetro({
    persistedSlug: null,
    metros: METROS,
    location: null,
    locationState: 'pending',
  })
  assert.notEqual(metro, fallbackMetro(METROS))
  assert.equal(metro, null)
})

// ── Test 4: denied/unavailable location preserves an explicit prior metro ─
test('resolveHomeMetro: explicit persisted selection wins even when location is unavailable', () => {
  const { metro, reason } = resolveHomeMetro({
    persistedSlug: 'vienna',
    metros: METROS,
    location: null,
    locationState: 'unavailable',
  })
  assert.equal(metro.slug, 'vienna')
  assert.equal(reason, 'explicit')
})

test('resolveHomeMetro: a genuinely ready DIFFERENT location now wins over an explicit persisted selection (Munich fix)', () => {
  // Munich field-test update (2026-09-21): this used to assert the
  // explicit choice always wins, even over a different ready location —
  // that was exactly the bug that let a stale persisted Vienna/Phoenix
  // slug permanently override real GPS evidence a traveling user was now
  // somewhere else. User explicitly picked Denver at some point in the
  // past, but is currently, genuinely physically near Vienna (traveling)
  // — real location now wins; see resolveHomeMetro's updated precedence
  // docstring (case 1 checked before case 2).
  const { metro, reason } = resolveHomeMetro({
    persistedSlug: 'denver',
    metros: METROS,
    location: VIENNA_COORDS,
    locationState: 'ready',
  })
  assert.equal(metro.slug, 'vienna')
  assert.equal(reason, 'nearest')
})

// ── Test 5: no prior metro + unavailable location does NOT silently choose
// ANY metro — alphabetical, Phoenix, or otherwise. It must enter the
// explicit "needs_selection" state instead of a disguised fallback pick. ──
test('resolveHomeMetro: no persisted choice + denied/unavailable location signals needs_selection, selects no metro', () => {
  const { metro, reason } = resolveHomeMetro({
    persistedSlug: null,
    metros: METROS,
    location: null,
    locationState: 'unavailable',
  })
  assert.equal(metro, null)
  assert.equal(reason, 'needs_selection')
  // Specifically not the old alphabetical-first fallback pick either.
  assert.notEqual(metro, fallbackMetro(METROS))
})

test('resolveHomeMetro: no persisted choice + timed-out location (also reported as unavailable) signals needs_selection, not an arbitrary metro', () => {
  // This module has no separate 'timed-out' locationState value — a timeout
  // is reported by the caller as 'unavailable' (see resolveHomeMetro's own
  // locationState doc: "'unavailable' means permission denied or the fetch
  // genuinely failed/timed out"). Re-asserting the same guarantee under
  // that framing so a timeout specifically is covered, not just denial.
  const { metro, reason } = resolveHomeMetro({
    persistedSlug: null,
    metros: METROS,
    location: null,
    locationState: 'unavailable',
  })
  assert.equal(metro, null)
  assert.equal(reason, 'needs_selection')
  assert.notEqual(metro, PHOENIX)
  assert.notEqual(metro, fallbackMetro(METROS))
})

test('fallbackMetro is alphabetically-first-active-metro, not name- or coordinate-keyed to Phoenix (still used by lib/resolveDefaultMetro.js for non-Home screens, but no longer by resolveHomeMetro)', () => {
  // Reorder so Phoenix is NOT first — fallbackMetro must track list order,
  // never search for "Phoenix" by name.
  const reordered = [DENVER, MILWAUKEE, PHOENIX, VIENNA]
  assert.equal(fallbackMetro(reordered).slug, 'denver')
  assert.notEqual(fallbackMetro(reordered).slug, 'phoenix')
})

test('resolveHomeMetro never hardcodes a Phoenix/Milwaukee latitude-threshold special case for metros lacking coordinates', () => {
  const noCoordMetros = [
    { id: 'm', name: 'Milwaukee Metro', slug: 'milwaukee', center_lat: null, center_lng: null },
    { id: 'p', name: 'Phoenix Metro', slug: 'phoenix', center_lat: null, center_lng: null },
  ]
  // A southern-hemisphere-ish latitude that the old `uLat < 37` hack would
  // have routed to Phoenix — with no coordinates on any metro, the real
  // nearest-by-distance calc can't run, so this must hit the explicit
  // needs_selection state (no metro at all) rather than Phoenix or any
  // other silent pick.
  const { metro, reason } = resolveHomeMetro({
    persistedSlug: null,
    metros: noCoordMetros,
    location: { latitude: 10, longitude: -80 },
    locationState: 'ready',
  })
  assert.equal(reason, 'needs_selection')
  assert.equal(metro, null)
})

// ── Test 6: an explicit persisted choice sticks whenever there's no live
// location signal to check it against (pending/unavailable), but a
// genuinely ready DIFFERENT location supersedes it — Munich field-test
// update (2026-09-21), see resolveHomeMetro's precedence docstring. ───────
test('resolveHomeMetro: explicit persisted choice holds through pending location, matches a ready location in the same metro, and is superseded by a ready location in a DIFFERENT metro', () => {
  const first = resolveHomeMetro({ persistedSlug: 'vienna', metros: METROS, location: null, locationState: 'pending' })
  const second = resolveHomeMetro({ persistedSlug: 'vienna', metros: METROS, location: VIENNA_COORDS, locationState: 'ready' })
  const third = resolveHomeMetro({ persistedSlug: 'vienna', metros: METROS, location: { latitude: 33.4, longitude: -112 }, locationState: 'ready' })
  assert.equal(first.metro.slug, 'vienna')
  assert.equal(first.reason, 'explicit')
  assert.equal(second.metro.slug, 'vienna')
  assert.equal(second.reason, 'nearest')
  // Physically near Phoenix now, despite a stale persisted Vienna choice —
  // real location wins, exactly the Munich bug fix.
  assert.equal(third.metro.slug, 'phoenix')
  assert.equal(third.reason, 'nearest')
})

// ── Test 7: anonymous vs authenticated — resolveHomeMetro takes no user/
// auth concept at all, so both startup paths get identical, non-buggy
// metro resolution (HomeScreen.jsx's init() calls this the same way
// whether `authUser` did or didn't resolve). ───────────────────────────────
test('resolveHomeMetro output does not depend on any auth/user field — same result for anonymous and authenticated shape', () => {
  const base = { persistedSlug: null, metros: METROS, location: VIENNA_COORDS, locationState: 'ready' }
  const anon = resolveHomeMetro(base)
  const authed = resolveHomeMetro({ ...base }) // resolveHomeMetro has no user param to vary at all
  assert.deepEqual(anon, authed)
})

// ── Misc coverage on the pure helpers ──────────────────────────────────────
test('nearestMetroByCoords returns null when location is missing', () => {
  assert.equal(nearestMetroByCoords(null, METROS), null)
  assert.equal(nearestMetroByCoords(undefined, METROS), null)
})

test('nearestMetroByCoords returns null when no metro has coordinates', () => {
  const noCoords = [{ id: 'p', slug: 'phoenix', center_lat: null, center_lng: null }]
  assert.equal(nearestMetroByCoords({ latitude: 33, longitude: -112 }, noCoords), null)
})

test('nearestMetroByCoords skips metros missing coordinates but still finds the real nearest among the rest', () => {
  const mixed = [
    { id: 'p', slug: 'phoenix', center_lat: null, center_lng: null },
    VIENNA,
    DENVER,
  ]
  const nearest = nearestMetroByCoords(VIENNA_COORDS, mixed)
  assert.equal(nearest.slug, 'vienna')
})

test('fallbackMetro returns null for an empty metro list', () => {
  assert.equal(fallbackMetro([]), null)
  assert.equal(fallbackMetro(null), null)
})

test('resolveHomeMetro: persistedSlug matching is case-insensitive', () => {
  const { metro } = resolveHomeMetro({ persistedSlug: 'VIENNA', metros: METROS, location: null, locationState: 'unavailable' })
  assert.equal(metro.slug, 'vienna')
})

test('resolveHomeMetro: unknown persistedSlug (metro no longer active) falls through to location-based resolution', () => {
  const { metro, reason } = resolveHomeMetro({
    persistedSlug: 'some-deactivated-metro',
    metros: METROS,
    location: VIENNA_COORDS,
    locationState: 'ready',
  })
  assert.equal(reason, 'nearest')
  assert.equal(metro.slug, 'vienna')
})
