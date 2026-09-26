import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  OPEN_REFRESH_MS, REGISTRATION_WINDOW_MS, FIX_CACHE_MS, OPEN_MAX_AGE_MS,
  pruneOpen, shouldSendEnter, decideExit, markOpen, markClosed, replaceOpen, isFixFresh,
} from './presenceClient.js'

const T = Date.parse('2026-09-28T09:30:00Z')

test('iOS registration noise: an EXIT for a region we never entered does nothing (no GPS, no request)', () => {
  // 19 monitored regions -> up to 18 "outside" callbacks on EVERY registration
  for (let i = 0; i < 18; i++) assert.equal(decideExit({ openMap: {}, itemId: `r${i}`, registeredAtMs: T - 1000, nowMs: T }), 'skip')
  assert.equal(decideExit({ openMap: undefined, itemId: 'x', registeredAtMs: null, nowMs: T }), 'skip')
})

test('an exit right after OUR registration is a state determination: reconcile without claiming a departure time', () => {
  const open = { a: T - 60 * 60000 }
  assert.equal(decideExit({ openMap: open, itemId: 'a', registeredAtMs: T - 5000, nowMs: T }), 'reconcile')
  assert.equal(decideExit({ openMap: open, itemId: 'a', registeredAtMs: T - REGISTRATION_WINDOW_MS, nowMs: T }), 'reconcile')
  assert.equal(decideExit({ openMap: open, itemId: 'a', registeredAtMs: T - REGISTRATION_WINDOW_MS - 1, nowMs: T }), 'report')
})

test('a live exit (phone relaunched for the callback, or long after registration) is reported', () => {
  const open = { a: T - 30 * 60000 }
  assert.equal(decideExit({ openMap: open, itemId: 'a', registeredAtMs: null, nowMs: T }), 'report')
  assert.equal(decideExit({ openMap: open, itemId: 'a', registeredAtMs: T - 3600000, nowMs: T }), 'report')
})

test('re-delivered enters are not re-reported within the refresh interval, but are re-synced after it', () => {
  const open = markOpen({}, 'a', T)
  assert.equal(shouldSendEnter(open, 'a', T + 1000), false)
  assert.equal(shouldSendEnter(open, 'a', T + OPEN_REFRESH_MS - 1), false)
  assert.equal(shouldSendEnter(open, 'a', T + OPEN_REFRESH_MS), true)
  assert.equal(shouldSendEnter(open, 'b', T), true)
  assert.equal(shouldSendEnter({}, 'a', T), true)
})

test('open-set bookkeeping: mark, close, replace from the server, and prune what the server would call stale', () => {
  let m = markOpen({}, 'a', T); m = markOpen(m, 'b', T)
  assert.deepEqual(Object.keys(markClosed(m, 'a')), ['b'])
  assert.deepEqual(markClosed({}, 'zzz'), {})
  assert.deepEqual(replaceOpen(['x', 'y'], T), { x: T, y: T })
  assert.deepEqual(replaceOpen(undefined, T), {})
  const pruned = pruneOpen({ old: T - OPEN_MAX_AGE_MS - 1, fresh: T - 1000, future: T + 10 * 60000, junk: 'nope' }, T)
  assert.deepEqual(Object.keys(pruned), ['fresh'])
})

test('simultaneous callbacks (dense centre) share one location fix; old fixes are not reused', () => {
  assert.equal(isFixFresh(T - 1000, T), true)
  assert.equal(isFixFresh(T - FIX_CACHE_MS, T), false)
  assert.equal(isFixFresh(null, T), false)
})

test('tracker wiring: decisions come from these rules; the phone never claims a departure for a state-determination exit', () => {
  const t = fs.readFileSync(new URL('./candidateVisitTracker.js', import.meta.url), 'utf8')
  assert.ok(t.includes('decideExit({') && t.includes("if (decision === 'skip') return") && t.includes("decision === 'reconcile'"))
  assert.ok(t.includes('shouldSendEnter(') && t.includes('markOpen(') && t.includes('rpc(\'visit_presence_reconcile\''))
  const reconcile = t.slice(t.indexOf('async function reconcileNow()'), t.indexOf('async function handleDeparture'))
  assert.ok(!/p_client_departed_at|departedAt/.test(reconcile), 'reconcile must never carry a departure time')
  // registration time is recorded BEFORE startGeofencingAsync so the OS callbacks it triggers are recognised
  assert.ok(t.indexOf('REGISTERED_AT_KEY, String(Date.now())') < t.indexOf('await Location.startGeofencingAsync('))
})

test('server: late-exit reconciliation, reconcile RPC and 168 h expiry exist in the hardening migration', () => {
  const sql = fs.readFileSync(new URL('../../supabase/migrations/20260930_visit_presence_hardening.sql', import.meta.url), 'utf8')
  for (const needle of ["outcome IN ('missed_exit','stale_open') AND p_client_departed_at IS NOT NULL", 'FUNCTION public.visit_presence_reconcile(', "interval '168 hours'", 'EXCEPTION WHEN unique_violation', 'v_open >= 12', 'v_today >= 400', 'radius + 100']) {
    assert.ok(sql.includes(needle) || needle === 'radius + 100', needle)
  }
  assert.ok(sql.includes('visit_geofence_radius_m(o.geo_radius_m) + v_slack') && sql.includes('LEAST(GREATEST(COALESCE(p_accuracy, 0), 0), 50) + 100'))
})
