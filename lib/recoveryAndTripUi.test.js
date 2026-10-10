// Visit recovery UI (permission aware, Android hidden) and the item detail check-off contract.
// Deterministic: fixed clock, fake Supabase. Run with: node --test lib/recoveryAndTripUi.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveVisitRecoveryState, RECOVERY_STATE_COPY } from './visitDetection/recoveryState.js'
import { supportsVisitRecovery, recoveryCardState, RECOVERY_COPY } from './visitDetection/recoveryPolicy.js'
import { loadActionableCandidates } from './visitDetection/actionableCandidates.js'
import { planItemNavigation } from './linkResolution.js'
import { deriveTripContext, findRecentVisitCandidate, resolveRetroAction, CHECK_OFF_LABELS } from './itemCheckOffActions.js'
import { seasonTimeLeftLabel } from './seasonCountdown.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const NOW = new Date('2026-10-03T18:00:00Z')

// ── Recovery state ────────────────────────────────────────────────────────────
const ALWAYS = { servicesEnabled: true, foreground: 'granted', background: 'always' }
const base = { platformOS: 'ios', flagEnabled: true, optedIn: true, permission: ALWAYS, suggestionCount: 0 }

test('Android renders nothing for visit recovery in every state (Home and Profile), including the old future-support sentence', () => {
  assert.equal(supportsVisitRecovery('android'), false)
  assert.equal(supportsVisitRecovery('ios'), true)
  for (const flagEnabled of [true, false]) for (const optedIn of [true, false]) {
    const r = resolveVisitRecoveryState({ ...base, platformOS: 'android', flagEnabled, optedIn })
    assert.deepEqual([r.visible, r.state, r.status, r.cta, r.showInbox], [false, 'hidden', null, null, false])
    assert.equal(recoveryCardState({ platformOS: 'android', flagEnabled, optedIn, backgroundGranted: true }), 'hidden')
  }
  for (const f of ['lib/visitDetection/recoveryPolicy.js', 'lib/visitDetection/recoveryState.js', 'components/VisitRecoverySection.jsx', 'components/home/VisitRecoveryHeaderIcon.jsx']) {
    assert.doesNotMatch(read('../' + f), /iPhone for now|coming in a future update/, f)
  }
  assert.equal(RECOVERY_COPY.androidNote, undefined)
  // Both surfaces bail out before rendering anything when unsupported.
  assert.match(read('../components/home/VisitRecoveryHeaderIcon.jsx'), /if \(!supported \|\| !userId \|\| !loaded \|\| !resolved\.visible\) return null/)
  assert.match(read('../components/VisitRecoverySection.jsx'), /if \(!supported \|\| !loaded \|\| !resolved\.visible\) return null/)
  // The visit-detection debug panel moved inside the admin-only Diagnostics disclosure; the platform + tester gate is unchanged.
  assert.match(read('../screens/ProfileScreen.jsx'), /showVisitDebug=\{supportsVisitRecovery\(Platform\.OS\) && !!profile\?\.visit_detection_tester\}/)
})

test('iOS with Always Location and recovery enabled shows On, with the review count when there are candidates', () => {
  const r = resolveVisitRecoveryState(base)
  assert.deepEqual([r.state, r.title, r.status, r.cta], ['on', 'Recover checkoffs you forgot', 'On — nothing to review right now', null])
  const n = resolveVisitRecoveryState({ ...base, suggestionCount: 2 })
  assert.equal(n.status, '2 places waiting for you to check off')
  assert.equal(resolveVisitRecoveryState({ ...base, suggestionCount: 1 }).status, '1 place waiting for you to check off')
})

test('iOS with only When In Use shows the Always Location CTA, never On; it prompts once, then sends to Settings', () => {
  const p = { servicesEnabled: true, foreground: 'granted', background: 'whenInUse' }
  const ask = resolveVisitRecoveryState({ ...base, permission: { ...p, backgroundCanAskAgain: true } })
  assert.deepEqual([ask.state, ask.status, ask.cta.label, ask.cta.action], ['needs_always', 'Turn on Always Location to recover missed checkoffs', 'Turn on Always Location', 'request'])
  const fresh = resolveVisitRecoveryState({ ...base, permission: { ...p, background: 'undetermined' } })
  assert.equal(fresh.cta.action, 'request')
  const declined = resolveVisitRecoveryState({ ...base, permission: { ...p, backgroundCanAskAgain: false } })
  assert.equal(declined.cta.action, 'settings')
  for (const r of [ask, fresh, declined]) assert.doesNotMatch(r.status, /^On/)
})

test('iOS with Location denied shows Open Settings; services disabled gives accurate copy and is not On', () => {
  const denied = resolveVisitRecoveryState({ ...base, permission: { servicesEnabled: true, foreground: 'denied', background: 'denied' } })
  assert.deepEqual([denied.state, denied.status, denied.cta.label, denied.cta.action], ['needs_foreground', 'Turn on Location to recover missed checkoffs', 'Open Settings', 'settings'])
  const undetermined = resolveVisitRecoveryState({ ...base, permission: { servicesEnabled: true, foreground: 'undetermined', background: 'undetermined' } })
  assert.equal(undetermined.state, 'needs_foreground')
  const off = resolveVisitRecoveryState({ ...base, permission: { ...ALWAYS, servicesEnabled: false } })
  assert.equal(off.state, 'services_disabled')
  assert.doesNotMatch(off.status, /^On/)
  assert.match(off.status, /Location Services are off/)
  assert.equal(off.cta.action, 'settings')
})

test('user preference off shows the opt-in state without claiming recovery is active; remote pause is not On', () => {
  const off = resolveVisitRecoveryState({ ...base, optedIn: false })
  assert.deepEqual([off.state, off.status, off.cta], ['off', null, null])
  assert.equal(resolveVisitRecoveryState({ ...base, optedIn: false, flagEnabled: false }).visible, false)
  const paused = resolveVisitRecoveryState({ ...base, flagEnabled: false })
  assert.equal(paused.state, 'paused')
  assert.doesNotMatch(paused.status, /^On/)
})

test('permission state refreshes on foreground resume and after the Settings round trip', () => {
  const hook = read('visitDetection/useVisitRecovery.js')
  assert.match(hook, /AppState\.addEventListener\('change', \(next\) => \{ if \(next === 'active'\) load\(\) \}\)/)
  assert.match(hook, /useFocusEffect/)
  assert.match(hook, /readLocationPermissionSnapshot\(\)/)
  assert.match(hook, /finally \{\s*load\(\)/, 'the state is re-read after the permission request returns')
  // Always is never inferred from foreground access.
  const perms = read('visitDetection/permissions.js')
  assert.match(perms, /scope && scope !== 'always' \? 'whenInUse' : 'always'/)
})

test('the explanation shown before asking is privacy-first and uses checkoffs without a hyphen', () => {
  assert.match(RECOVERY_STATE_COPY.explain, /privately remembers/)
  assert.match(RECOVERY_STATE_COPY.explain, /deletes your saved visits/)
  for (const v of [RECOVERY_STATE_COPY.title, RECOVERY_STATE_COPY.needsAlways, RECOVERY_STATE_COPY.needsForeground, RECOVERY_STATE_COPY.servicesDisabled]) assert.doesNotMatch(v, /check-off/i)
})

// ── Item detail contract ──────────────────────────────────────────────────────
const LIST_ID = 'list-trip'
const ITEM_ID = '2f6c0f6e-8a4b-4c8e-9a53-0b4a1d9e7c11'
const TRIP_LIST = { id: LIST_ID, tripModeEnabled: true, startsAt: '2026-09-27', endsAt: '2026-10-02', graceDays: 7, timezone: 'America/Phoenix' }
const trip = (o = {}) => deriveTripContext({ routeListId: LIST_ID, list: TRIP_LIST, isMember: true, listItemVerified: true, atVenue: false, now: NOW, ...o })

test('a genuine eligible Trip Mode item says "Check off from this trip"', () => {
  const t = trip()
  assert.deepEqual([t.eligible, t.reason], [true, 'trip'])
  const r = resolveRetroAction({ recentCandidate: null, trip: t })
  assert.deepEqual([r.kind, r.label], ['trip', 'Check off from this trip'])
})

test('a normal universal item opened from Home (no list context) never says "from this trip"; the primary says I\'VE DONE THIS', () => {
  const t = deriveTripContext({ routeListId: null, list: null, isMember: false, listItemVerified: false, atVenue: false, now: NOW })
  assert.deepEqual([t.eligible, t.reason], [false, 'no-list-context'])
  const r = resolveRetroAction({ recentCandidate: null, trip: t })
  assert.deepEqual([r.kind, r.label, r.primaryLabel], ['none', null, "I'VE DONE THIS"])
  assert.equal(CHECK_OFF_LABELS.ordinary, "I'VE DONE THIS")
})

test('a regular custom list (trip_mode_enabled false) never offers the trip action', () => {
  assert.equal(trip({ list: { ...TRIP_LIST, tripModeEnabled: false } }).reason, 'not-trip-list')
  assert.equal(trip({ list: { ...TRIP_LIST, tripModeEnabled: false, endsAt: null } }).eligible, false)
  assert.equal(trip({ list: { ...TRIP_LIST, tripModeEnabled: undefined } }).eligible, false)
})

test('an open-ended Trip Mode list (ends_at null) stays active: an ongoing trip while Trip Mode is on (the "jenna and luca" shape)', () => {
  const open = { ...TRIP_LIST, startsAt: '2026-08-24', endsAt: null }
  const t = trip({ list: open, now: new Date('2027-03-01T18:00:00Z') })
  assert.deepEqual([t.eligible, t.reason], [true, 'trip-ongoing'], 'nothing expires merely because the date is null, even months later')
  assert.equal(trip({ list: { ...open, startsAt: null, endsAt: null } }).eligible, true)
  const r = resolveRetroAction({ recentCandidate: null, trip: t })
  assert.deepEqual([r.kind, r.label], ['trip', 'Check off from this trip'])
})

test('a universal item opened through a valid Trip Mode list shows the trip action; the same item from Home or an email link does not', () => {
  const universalItem = { id: 'item-u', is_universal: true, is_active: true }
  const through = deriveTripContext({ routeListId: LIST_ID, list: TRIP_LIST, isMember: true, listItemVerified: true, itemActive: universalItem.is_active, atVenue: false, now: NOW })
  assert.equal(through.eligible, true, 'universal is not disqualifying')
  // Home, Nearby, search, an ordinary list and an email item link all navigate with no list context.
  for (const route of ['home', 'nearby', 'search', 'email item link']) {
    const t = deriveTripContext({ routeListId: null, list: TRIP_LIST, isMember: true, listItemVerified: true, atVenue: false, now: NOW })
    assert.equal(t.reason, 'no-list-context', route)
  }
})

test('an exact email item link carries no list id into item detail, so it can never show trip wording', () => {
  const nav = planItemNavigation({ status: 'ok', item: { id: ITEM_ID }, metro: null }, { cold: true })
  const target = nav.routes.find((r) => r.name === 'ItemDetail')
  assert.deepEqual(Object.keys(target.params), ['item'])
  assert.equal(target.params.listId, undefined)
  const warm = planItemNavigation({ status: 'ok', item: { id: ITEM_ID }, metro: null }, { cold: false })
  assert.equal(warm.params.listId, undefined)
  assert.equal(deriveTripContext({ routeListId: target.params.listId, list: TRIP_LIST, isMember: true, listItemVerified: true, atVenue: false, now: NOW }).eligible, false)
})

test('an item cannot inherit Trip Mode merely because it belongs to a trip list somewhere', () => {
  // The user is a member of a Trip Mode list that contains this item, and its data is loaded, but the route did not come through it.
  assert.equal(deriveTripContext({ routeListId: undefined, list: TRIP_LIST, isMember: true, listItemVerified: true, atVenue: false, now: NOW }).eligible, false)
  // Opened through a DIFFERENT (ordinary) list: the fetched list is that list and it is Regular.
  assert.equal(deriveTripContext({ routeListId: 'ordinary-list', list: { ...TRIP_LIST, id: 'ordinary-list', tripModeEnabled: false }, isMember: true, listItemVerified: true, atVenue: false, now: NOW }).eligible, false)
})

test('the route list id must match the fetched list; the list item must belong to both list and item; the user must be a member; the item must be active', () => {
  assert.equal(trip({ list: { ...TRIP_LIST, id: 'other-list' } }).reason, 'list-not-verified')
  assert.equal(trip({ list: null }).reason, 'list-not-verified')
  assert.equal(trip({ listItemVerified: false }).reason, 'list-item-not-verified')
  assert.equal(trip({ isMember: false }).reason, 'not-member')
  assert.equal(trip({ itemActive: false }).reason, 'item-inactive')
})

test('trip window: a future start is not active yet, a dated trip expires after its grace period, being at the venue defers to the live flow', () => {
  assert.equal(trip({ now: new Date('2026-09-20T18:00:00Z') }).reason, 'trip-not-started')
  assert.equal(trip({ list: { ...TRIP_LIST, startsAt: '2026-12-01', endsAt: null } }).reason, 'trip-not-started')
  assert.equal(trip({ now: new Date('2026-10-09T18:00:00Z') }).eligible, true, 'inside end + 7 days grace')
  assert.equal(trip({ now: new Date('2026-10-10T18:00:00Z') }).reason, 'trip-window-closed')
  assert.equal(trip({ list: { ...TRIP_LIST, graceDays: 0 }, now: new Date('2026-10-03T18:00:00Z') }).reason, 'trip-window-closed')
  assert.equal(trip({ atVenue: true }).reason, 'at-venue')
})

test('the client window matches the live server trigger, and Regular / Trip Mode stay available in custom list create and edit', () => {
  // Rules the server enforces (verified against pg_get_functiondef): start bound only when starts_at is set, end + grace only when ends_at is set.
  const migration = readFileSync(join(here, '../docs/trip-mode/20260923_trip_mode_retroactive_completion_NOT_APPLIED.sql'), 'utf8')
  assert.match(migration, /list_ends IS NOT NULL/)
  assert.match(migration, /list_starts IS NOT NULL AND NEW\.experienced_at < list_starts/)
  const create = read('../screens/CreateListScreen.jsx')
  assert.match(create, />Regular<\/Text>/)
  assert.match(create, />Trip Mode<\/Text>/)
  assert.match(create, /select\('id, trip_mode_enabled'\)/, 'edit loads the existing choice')
  assert.equal((create.match(/buildTripModeUpdate\(tripModeEnabled\)/g) ?? []).length, 3, 'create and both edit writes include the choice')
})

function fakeSb({ candidates, checkIns = [] }) {
  const q = (rows) => {
    let filtered = rows
    const api = {
      select() { return api }, order() { return api },
      eq(c, v) { filtered = filtered.filter((r) => r[c] === v); return api },
      in(c, vs) { filtered = filtered.filter((r) => vs.includes(r[c] ?? r.items?.id)); return api },
      then(res) { return Promise.resolve({ data: filtered, error: null }).then(res) },
    }
    return api
  }
  return { from: (t) => (t === 'candidate_visits' ? q(candidates) : q(checkIns)) }
}
const cand = (o = {}) => ({ id: 'cv1', user_id: 'u1', status: 'high_confidence', expires_at: '2026-10-08T00:00:00Z', departure_at: '2026-10-03T12:00:00Z', dwell_minutes: 30, confirmed_at: null, rejected_at: null, metadata: {}, items: { id: 'item-a', body: 'A place', neighborhoods: { name: 'N' } }, ...o })

test('a valid candidate visit for this exact item says "Check off from a recent visit" and wins over trip wording', async () => {
  const { rows } = await loadActionableCandidates(fakeSb({ candidates: [cand()] }), 'u1', { now: NOW })
  const c = findRecentVisitCandidate({ candidates: rows, itemId: 'item-a', isUniversal: false, recoverySupported: true, now: NOW })
  assert.ok(c)
  const r = resolveRetroAction({ recentCandidate: c, trip: trip() })
  assert.deepEqual([r.kind, r.label], ['recent', 'Check off from a recent visit'])
})

test('stale, other-user, confirmed, checked-off, other-item, universal or Android candidates expose no recovery', async () => {
  const now = NOW
  const load = async (candidates, checkIns = []) => (await loadActionableCandidates(fakeSb({ candidates, checkIns }), 'u1', { now })).rows
  const find = (rows, o = {}) => findRecentVisitCandidate({ candidates: rows, itemId: 'item-a', isUniversal: false, recoverySupported: true, now, ...o })
  assert.equal(find(await load([cand({ expires_at: '2026-10-01T00:00:00Z' })])), null, 'expired')
  assert.equal(find(await load([cand({ user_id: 'someone-else' })])), null, 'other user')
  assert.equal(find(await load([cand({ status: 'confirmed', confirmed_at: '2026-10-03T00:00:00Z' })])), null, 'confirmed')
  assert.equal(find(await load([cand()], [{ user_id: 'u1', item_id: 'item-a' }])), null, 'already checked off')
  assert.equal(find(await load([cand({ items: { id: 'item-b', body: 'B' } })])), null, 'different item')
  const good = await load([cand()])
  assert.equal(find(good, { isUniversal: true }), null, 'universal items never get a location candidate')
  assert.equal(find(good, { recoverySupported: false }), null, 'Android')
})

test('without a valid candidate or trip context there is no retrospective button, only the ordinary action', () => {
  const r = resolveRetroAction({ recentCandidate: null, trip: trip({ atVenue: true }) })
  assert.deepEqual([r.kind, r.label, r.primaryLabel], ['none', null, "I'VE DONE THIS"])
})

test('ItemDetailScreen wires the contract: labels come from one table, trip is verified against the list, Android fetches no candidates', () => {
  const src = read('../screens/ItemDetailScreen.jsx')
  assert.doesNotMatch(src, /accessibilityLabel="Check off from this trip"/)
  assert.match(src, /deriveTripContext\(\{/)
  assert.match(src, /from\('list_items'\)\.select\('id'\)\.eq\('id', item\.listItemId\)\.eq\('list_id', listId\)\.eq\('item_id', currentItemId\)/)
  assert.match(src, /!supportsVisitRecovery\(Platform\.OS\) \|\| \(item\?\.is_universal/)
  assert.match(src, /CHECK_OFF_LABELS\.ordinary/)
  assert.match(src, /openVisitInbox\(navigation\.getParent\?\.\(\) \?\? navigation, recentCandidate\.candidateVisitId\)/)
  // Completion and points paths are untouched: the same handlers, no new insert.
  assert.match(src, /onPress=\{isNearbyMode \? handleNearbyDone : handleCheckOff\}/)
})

test('Positano open-ended lists still show no countdown', () => {
  assert.equal(seasonTimeLeftLabel(null, new Date(2026, 9, 3, 12)), null)
  assert.equal(seasonTimeLeftLabel('2027-12-31', new Date(2026, 9, 3, 12)), null)
})
