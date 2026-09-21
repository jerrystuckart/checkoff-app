// REGRESSION: guards the HomeScreen.jsx side of the 'needs_selection' metro
// resolution (see lib/metroSelection.js's resolveHomeMetro, case 4). That
// case replaces the old alphabetically-first-metro fallback-of-last-resort,
// which was itself rejected as still being a silent, arbitrary metro
// default — the same category of bug as the original hardcoded-Phoenix
// default it once replaced.
//
// This repo has no RN component-rendering test harness (no jest/
// @testing-library — see lib/homeScreenLegacyBranchRemoved.test.js for the
// same convention), so these are source-level guards rather than rendered-
// output assertions: still enough to fail loudly if the fallback-metro
// pattern or an unsafe null-selectedMetro render path reappears.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const homeScreenSource = readFileSync(join(__dirname, '../screens/HomeScreen.jsx'), 'utf8')
const metroSelectionSource = readFileSync(join(__dirname, './metroSelection.js'), 'utf8')

test("REGRESSION: resolveHomeMetro's own source no longer calls fallbackMetro() from its needs_selection branch", () => {
  // fallbackMetro() itself may still exist (lib/resolveDefaultMetro.js's
  // impure shell still uses it for non-Home screens), but resolveHomeMetro
  // must not call it any more.
  const fnBody = metroSelectionSource.slice(metroSelectionSource.indexOf('export function resolveHomeMetro'))
  assert.ok(!fnBody.includes('fallbackMetro('), 'resolveHomeMetro must not call fallbackMetro() any more')
  assert.ok(fnBody.includes("reason: 'needs_selection'"), "resolveHomeMetro must return reason: 'needs_selection' when location is denied/unavailable/timed out with no explicit choice")
})

test('REGRESSION: HomeScreen.jsx init() never persists a fallback/needs_selection metro to AsyncStorage as though it were an explicit choice', () => {
  // The only call sites for AsyncStorage.setItem(SELECTED_METRO_SLUG_KEY, ...)
  // must be inside switchMetro() (an actual user action) — never inside
  // init()'s own resolution handling.
  const initStart = homeScreenSource.indexOf('async function init()')
  const initEnd = homeScreenSource.indexOf('\n  function handleDestinationZoneTap')
  assert.ok(initStart > -1 && initEnd > initStart, 'could not isolate init() body for inspection')
  const initBody = homeScreenSource.slice(initStart, initEnd)
  assert.ok(
    !initBody.includes('AsyncStorage.setItem(SELECTED_METRO_SLUG_KEY'),
    'init() must never write SELECTED_METRO_SLUG_KEY — only an explicit user pick (switchMetro) may persist a metro choice'
  )
  assert.ok(initBody.includes("metroReason === 'needs_selection'"), "init() must explicitly branch on the needs_selection reason")
  assert.ok(initBody.includes('setNeedsMetroSelection(true)'), 'init() must surface the needs_selection state to the component')
})

test('REGRESSION: switchMetro() is still the only place SELECTED_METRO_SLUG_KEY is written, and it clears needsMetroSelection', () => {
  const occurrences = homeScreenSource.split('AsyncStorage.setItem(SELECTED_METRO_SLUG_KEY').length - 1
  assert.equal(occurrences, 1, 'SELECTED_METRO_SLUG_KEY must be written from exactly one place (switchMetro)')

  const switchStart = homeScreenSource.indexOf('async function switchMetro(metro)')
  const switchEnd = homeScreenSource.indexOf('\n  async function handleNext10Dismiss')
  assert.ok(switchStart > -1 && switchEnd > switchStart, 'could not isolate switchMetro() body for inspection')
  const switchBody = homeScreenSource.slice(switchStart, switchEnd)
  assert.ok(switchBody.includes('setNeedsMetroSelection(false)'), 'switchMetro() must clear needsMetroSelection on an explicit user pick')
})

test('REGRESSION: HomeScreen.jsx never silently renders with a null selectedMetro — the needs_selection branch returns before the normal render, and reuses the existing CityPickerModal/switchMetro mechanism (no new picker UI)', () => {
  const guardIdx = homeScreenSource.indexOf("if (needsMetroSelection && !selectedMetro)")
  assert.ok(guardIdx > -1, 'HomeScreen.jsx must guard render on needsMetroSelection with no selectedMetro')

  // The guard block itself must come after the loading-state early return
  // and before the main return(...) — i.e. it's an early return, not a
  // conditional inside the main tree that could still fall through to
  // Phoenix-labeled defaults.
  const loadingGuardIdx = homeScreenSource.indexOf('if (loading) {')
  const mainReturnIdx = homeScreenSource.indexOf('return (', guardIdx)
  assert.ok(loadingGuardIdx > -1 && loadingGuardIdx < guardIdx, 'needs_selection guard must come after the loading guard')
  assert.ok(mainReturnIdx > guardIdx, 'needs_selection guard must return before the main Home render tree')

  const guardBlock = homeScreenSource.slice(guardIdx, homeScreenSource.indexOf('\n  return (', guardIdx))
  assert.ok(guardBlock.includes('<CityPickerModal'), 'needs_selection prompt must reuse the existing CityPickerModal, not a new picker UI')
  assert.ok(guardBlock.includes('switchMetro(metro)'), 'needs_selection prompt must select through the existing switchMetro() mechanism')
  assert.ok(!guardBlock.includes('Phoenix'), 'needs_selection prompt must not reference Phoenix or any other specific city')
})
