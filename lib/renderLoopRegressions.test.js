// Regressions for three dev/runtime errors that blocked simulator testing (2026-10-04):
//   1. "Maximum update depth exceeded" with location permission denied + a persisted metro
//   2./3. "Internal React error: Expected static flag was missing" (hooks called after an early return)
// The real render proof for (1) is scripts/render-loop-harness/check.mjs (needs react-test-renderer, which is not a
// repo dependency); these are the always-on source guards that run in `node --test lib/*.test.js`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(join(root, f), 'utf8')

test('useWhatsGood: the explicit-metro fallback location is memoized, never rebuilt per render', () => {
  const src = read('lib/useWhatsGood.js')
  assert.match(src, /const userLocation = useMemo\(/, 'userLocation must be a useMemo')
  assert.doesNotMatch(src, /\?\s*\{\s*latitude:\s*explicitMetroChoice\.center_lat/, 'no inline object literal built from explicitMetroChoice each render')
  assert.match(src, /\[locationState, gpsLocation, hasExplicitSelection, explicitLat, explicitLng\]/, 'memo keyed on primitives')
})

test('currentLocation: refreshLocation identity is stable across renders (module-level)', () => {
  const src = read('lib/currentLocation.js')
  assert.match(src, /^const refreshLocation = \(force = false\) => requestFreshLocation\(\{ force \}\)/m)
  assert.doesNotMatch(src, /refreshLocation:\s*\(force = false\) =>/, 'no per-render arrow in the hook result')
})

test('WhatsGoodDiscovery: useWindowDimensions runs before every early return', () => {
  const src = read('components/home/WhatsGoodDiscovery.jsx')
  const body = src.slice(src.indexOf('export default function WhatsGoodDiscovery'))
  const hook = body.indexOf('useWindowDimensions()')
  const firstReturn = body.search(/\n\s+return\b/)
  assert.ok(hook > -1 && hook < firstReturn, 'hook must precede the first return')
  assert.equal(body.split('useWindowDimensions()').length - 1, 1, 'and only be called once')
})

test('EditorialCard: useCardArtwork runs before the null-item early return', () => {
  const src = read('components/home/EditorialCard.jsx')
  const body = src.slice(src.indexOf('export default function EditorialCard'))
  assert.ok(body.indexOf('useCardArtwork(item, userId)') < body.indexOf('if (!item) return null'))
})

test('Hub location hook never prompts: only a read-only permission check before refreshing', () => {
  const src = read('lib/useHubLocationSection.js')
  assert.match(src, /getForegroundPermissionsAsync/)
  assert.doesNotMatch(src, /requestForegroundPermissionsAsync/)
})
