import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { decideMovementRefresh, newestHint, MOVEMENT_HINT_MAX_AGE_MS } from './movementRefresh.js'

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)
const sentinel = { lat: 40.624, lng: 14.507, radiusM: 1500 }
const fix = (lat, lng) => ({ latitude: lat, longitude: lng, accuracy: 12 })

test('decideMovementRefresh: a fresh fix far from the sentinel refreshes; inside half the radius is ignored', () => {
  assert.equal(decideMovementRefresh({ fix: fix(40.634, 14.603), hint: null, sentinel, nowMs: NOW }).action, 'refresh')
  const near = decideMovementRefresh({ fix: fix(40.6245, 14.5075), hint: null, sentinel, nowMs: NOW })
  assert.deepEqual([near.action, near.reason], ['ignore', 'within_coverage'])
  // between half the radius and the radius the movement refresh acts early (the OS exit has not fired yet)
  assert.equal(decideMovementRefresh({ fix: fix(40.624 + 900 / 111320, 14.507), hint: null, sentinel, nowMs: NOW }).action, 'refresh')
})

test('decideMovementRefresh: a hint is a position only when fresh and not too coarse, otherwise just a wake-up', () => {
  const h = (over) => ({ latitude: 40.634, longitude: 14.603, accuracy: 900, timestampMs: NOW - 30e3, ...over })
  assert.equal(decideMovementRefresh({ fix: null, hint: h(), sentinel, nowMs: NOW }).source, 'hint')
  assert.equal(decideMovementRefresh({ fix: null, hint: h({ timestampMs: NOW - MOVEMENT_HINT_MAX_AGE_MS - 1000 }), sentinel, nowMs: NOW }).action, 'ignore')
  assert.equal(decideMovementRefresh({ fix: null, hint: h({ accuracy: 20000 }), sentinel, nowMs: NOW }).action, 'ignore')
  assert.equal(decideMovementRefresh({ fix: null, hint: null, sentinel, nowMs: NOW }).reason, 'no_position')
  // a fresh fix always wins over the coarse hint
  assert.equal(decideMovementRefresh({ fix: fix(40.6245, 14.5075), hint: h(), sentinel, nowMs: NOW }).source, 'fix')
})

test('decideMovementRefresh: no coverage registered, or coverage flagged needsRefresh, refreshes', () => {
  assert.equal(decideMovementRefresh({ fix: fix(40.6245, 14.5075), hint: null, sentinel: null, nowMs: NOW }).reason, 'no_active_coverage')
  assert.equal(decideMovementRefresh({ fix: fix(40.6245, 14.5075), hint: null, sentinel: { ...sentinel, needsRefresh: true }, nowMs: NOW }).reason, 'coverage_needs_refresh')
})

test('newestHint picks the latest usable hint and ignores malformed ones', () => {
  assert.equal(newestHint([]), null)
  assert.equal(newestHint([{ latitude: 1, longitude: 2, timestampMs: 5 }, { latitude: 3, longitude: 4, timestampMs: 9 }, { latitude: NaN, longitude: 1, timestampMs: 99 }]).timestampMs, 9)
})

test('the JS wrapper reports not_installed on a binary without the native module (every build before the next TestFlight build)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-'))
  const fake = path.join(tmp, 'emc.js'); fs.writeFileSync(fake, 'export function requireOptionalNativeModule() { return null }')
  const out = await build({
    entryPoints: [new URL('./movementNative.js', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    plugins: [{ name: 'f', setup(b) { b.onResolve({ filter: /^expo-modules-core$/ }, () => ({ path: fake })) } }],
  })
  const f = path.join(tmp, 'w.mjs'); fs.writeFileSync(f, out.outputFiles[0].text)
  const w = await import(pathToFileURL(f).href)
  assert.equal(w.isMovementNativeInstalled(), false)
  assert.equal(await w.startMovement(), 'not_installed')
  assert.equal(await w.movementAvailable(), false)
  assert.deepEqual(await w.consumeMovementHints(), [])
  assert.equal(typeof w.onMovement(() => {}), 'function')
})

test('movement can never create a visit: the movement code path references no presence, candidate, check-in or points function', () => {
  const src = fs.readFileSync(new URL('./candidateVisitTracker.js', import.meta.url), 'utf8')
  const raw = src.slice(src.indexOf('MOVEMENT (native significant-location-change)'), src.indexOf('// A refresh that could not complete'))
  const block = raw.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')   // code only; the comments explain what it must not do
  for (const forbidden of ['visit_presence_enter', 'visit_presence_exit', 'candidate_visits', 'check_ins', 'sendEnter', 'sendExit', 'reportEnter', 'reportDeparture', 'points'])
    assert.ok(!block.includes(forbidden), `movement code must not touch ${forbidden}`)
})
