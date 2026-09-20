// Nearby Search Layout Fix (2026-09-19) — targeted regression coverage for
// the search-box placeholder truncation bug found via physical-device QA
// (screens/DiscoverScreen.jsx, search module first added in commit
// 037d9c3). Root cause: SEARCH_META_INLINE_MIN_WIDTH was set low enough
// (380dp) that virtually every real phone width (390-430dp for the
// standard/Plus/Pro/Pro Max line) took the "inline" branch, laying the
// search row and the passive location-status row out as flex siblings in
// one shared row — the fixed-width status text squeezed the TextInput
// down until its placeholder clipped. This file asserts the corrected
// threshold actually guarantees phone-width layouts take the stacked
// branch, on top of the general structural assertions already covered by
// lib/nearbyRedesignStructural.test.js (tests 18/19/22/23 in this pass's
// spec).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const discoverSource = readFileSync(join(__dirname, '../screens/DiscoverScreen.jsx'), 'utf8')

// The widest current real phone (iPhone Pro Max) sits at ~430dp portrait
// width. Large Dynamic Type widens glyphs, not the viewport, so this is a
// safe upper bound for "ordinary phone width."
const WIDEST_REALISTIC_PHONE_WIDTH_DP = 430

test('SEARCH_META_INLINE_MIN_WIDTH is set above any realistic phone width, so phone widths default to the stacked layout', () => {
  const match = discoverSource.match(/const SEARCH_META_INLINE_MIN_WIDTH = (\d+)/)
  assert.ok(match, 'SEARCH_META_INLINE_MIN_WIDTH constant must exist')
  const threshold = Number(match[1])
  assert.ok(
    threshold > WIDEST_REALISTIC_PHONE_WIDTH_DP,
    `threshold (${threshold}) must exceed the widest realistic phone width (${WIDEST_REALISTIC_PHONE_WIDTH_DP}dp) so metaInline is never true on an ordinary phone`
  )
})

test('the stacked (phone-width) branch renders the search row and the meta row as its OWN lines inside one bordered surface, not squeezed into one row', () => {
  // searchModule is the shared bordered surface; searchModuleWrap flips it
  // to a column layout, and searchMetaRowWrapped gives the second line its
  // own quieter, separated treatment — both only apply when !metaInline.
  assert.match(discoverSource, /searchModule,\s*!metaInline\s*&&\s*styles\.searchModuleWrap/)
  assert.match(discoverSource, /searchMetaRow,\s*!metaInline\s*&&\s*styles\.searchMetaRowWrapped/)
  assert.match(discoverSource, /searchModuleWrap:\s*\{\s*flexDirection:\s*'column'/)
})

test('the layout decision is width-driven via useWindowDimensions, never a single hardcoded device-width branch', () => {
  assert.match(discoverSource, /useWindowDimensions/)
  assert.match(discoverSource, /const \{ width: windowWidth \} = useWindowDimensions\(\)/)
  assert.match(discoverSource, /const metaInline = windowWidth >= SEARCH_META_INLINE_MIN_WIDTH/)
})

test('the passive location-status text carries no press handler, dropdown, chevron, or radius control', () => {
  const textIdx = discoverSource.indexOf('Using your current location')
  assert.ok(textIdx > -1)
  // Scan a window around the meta text for any interactive/control markup.
  const windowSrc = discoverSource.slice(Math.max(0, textIdx - 400), textIdx + 200)
  assert.ok(!windowSrc.includes('onPress'), 'no onPress near the passive status text')
  assert.ok(!windowSrc.includes('TouchableOpacity'), 'no TouchableOpacity wraps the passive status text')
  assert.ok(!windowSrc.includes('Pressable'), 'no Pressable wraps the passive status text')
  assert.ok(!/chevron|dropdown|RadiusSlider/i.test(windowSrc), 'no chevron/dropdown/radius control near the passive status text')
})

test('search input retains its icon, clear control, focus tracking, and debounce — pure layout fix, zero behavior change', () => {
  assert.match(discoverSource, /placeholder="Search nearby experiences"/)
  assert.match(discoverSource, /onFocus=\{\(\) => setSearchFocused\(true\)\}/)
  assert.match(discoverSource, /onBlur=\{\(\) => setSearchFocused\(false\)\}/)
  assert.match(discoverSource, /setTimeout\(\(\) => runSearch\(searchText\), 300\)/)
  assert.match(discoverSource, /accessibilityLabel="Clear search text"/)
})

test('FlatList virtualization for results is unaffected by the search-module layout change', () => {
  assert.match(discoverSource, /<FlatList/)
  assert.match(discoverSource, /data=\{displayItems\}/)
})
