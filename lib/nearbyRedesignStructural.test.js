// Nearby Redesign (2026-09-19) — structural/source-text regression
// coverage, matching this repo's established convention (no RN render
// harness — see lib/itemDetailRouteShapes.test.js, lib/savedItemsHome.test.js).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
function src(relPath) {
  return readFileSync(join(__dirname, relPath), 'utf8')
}

const appSource = src('../App.jsx')
const discoverSource = src('../screens/DiscoverScreen.jsx')
const rowSource = src('../components/nearby/NearbyResultRow.jsx')
const tileSource = src('../components/nearby/CategoryTile.jsx')
const iconSource = src('../components/nearby/CategoryIcon.jsx')
const useNearbySource = src('../lib/useNearby.js')
const packageJsonSource = src('../package.json')

// 1. Live route still points to DiscoverScreen ──────────────────────────────
test('App.jsx: the live "Nearby" route still renders DiscoverScreen', () => {
  const idx = appSource.indexOf('function NearbyStack')
  const block = appSource.slice(idx, idx + 600)
  assert.match(block, /name="Nearby"[\s\S]{0,80}component=\{DiscoverScreen\}/)
})

// 2. No item image/artwork anywhere in the new Nearby row source ───────────
test('NearbyResultRow.jsx / DiscoverScreen.jsx: no Image/ArchetypeArtwork/DetailArtwork usage — Nearby stays text-first, no item photography', () => {
  for (const [name, source] of [['NearbyResultRow.jsx', rowSource], ['DiscoverScreen.jsx', discoverSource]]) {
    assert.ok(!/[<]Image\b/.test(source), `${name} must not render <Image>`)
    assert.ok(!source.includes('ArchetypeArtwork'), `${name} must not import/use ArchetypeArtwork`)
    assert.ok(!source.includes('DetailArtwork'), `${name} must not import/use DetailArtwork`)
  }
})

// 7. Real completion state replaces the hardcoded default at the point of
// consumption — the displayItems pipeline must derive `checked` from the
// bulk completedItemIds Set, not carry a permanent hardcoded false. ───────
test('DiscoverScreen.jsx: displayItems overrides the placeholder checked:false with the real completedItemIds Set', () => {
  assert.match(discoverSource, /checked:\s*completedItemIds\.has\(item\.id\)/)
})

test('DiscoverScreen.jsx / useNearby.js: any remaining literal `checked: false` is explicitly documented as a pre-fetch placeholder, not a silent permanent default', () => {
  for (const [name, source] of [['DiscoverScreen.jsx', discoverSource], ['useNearby.js', useNearbySource]]) {
    const idx = source.indexOf('checked:          false,')
    if (idx === -1) continue
    const precedingComment = source.slice(Math.max(0, idx - 900), idx)
    assert.ok(
      /placeholder/i.test(precedingComment) || /overwritten|corrected|real value/i.test(precedingComment),
      `${name}: a literal checked:false must be documented as a placeholder immediately overridden by real completion data`
    )
  }
})

// 8. Bookmark tap isolation from row navigation ─────────────────────────────
test('NearbyResultRow.jsx: the bookmark Pressable is a SIBLING of the row TouchableOpacity, not nested logic sharing its onPress — mirrors EditorialCard.jsx\'s SaveToggle isolation technique', () => {
  assert.match(rowSource, /<Pressable[\s\S]{0,40}onPress=\{onToggleSaved\}/)
  // The row's own onPress must be a distinct prop, never the same handler
  // as the bookmark's.
  assert.match(rowSource, /onPress=\{onPress\}/)
  const pressableIdx = rowSource.indexOf('<Pressable')
  const rowPressIdx = rowSource.indexOf('onPress={onPress}')
  assert.ok(rowPressIdx < pressableIdx, 'row-level onPress must be wired before the separate bookmark Pressable')
})

// 9 & 10 covered directly in lib/nearbyFilterState.test.js — this asserts
// DiscoverScreen.jsx actually calls the pure helpers rather than
// reimplementing the old category-resetting behavior inline.
test('DiscoverScreen.jsx: clearSearch() delegates to clearSearchState() and never calls setActiveCategoryName itself', () => {
  const start = discoverSource.indexOf('function clearSearch()')
  const end = discoverSource.indexOf('function clearCategory()')
  const body = discoverSource.slice(start, end)
  assert.ok(body.includes('clearSearchState()'))
  assert.ok(!body.includes('setActiveCategoryName'), 'clearSearch must never reset category as a side effect')
})

test('DiscoverScreen.jsx: clearCategory() delegates to clearCategoryState() and never touches search/tag state', () => {
  const start = discoverSource.indexOf('function clearCategory()')
  const end = discoverSource.indexOf('function selectAllFilter()')
  const body = discoverSource.slice(start, end)
  assert.ok(body.includes('clearCategoryState()'))
  assert.ok(!body.includes('setSearchText'))
  assert.ok(!body.includes('setActiveTags'))
})

// 11. Account alcohol preference remains enforced with no Nearby UI control ─
test('useNearby.js: alcohol-preference filtering logic is unchanged/still present', () => {
  assert.match(useNearbySource, /pref_show_alcohol/)
  assert.match(useNearbySource, /showAlcoholRef\.current/)
  assert.match(useNearbySource, /processed\.filter\(item => !item\.has_alcohol\)/)
})

test('DiscoverScreen.jsx: no alcohol-related UI string/control anywhere in the new code', () => {
  // has_alcohol is a legitimate pre-existing DATA FIELD (part of the raw
  // items-table select/shape, unchanged by this pass) that Discover simply
  // passes through — the actual silent filtering happens in useNearby.js.
  // This asserts no UI-facing reference (a label, toggle, or explanatory
  // copy) was added — i.e. nothing beyond that one already-existing field
  // name, which never renders any visible text.
  const withoutDataField = discoverSource.replace(/has_alcohol/g, '')
  assert.ok(!/alcohol/i.test(withoutDataField), 'DiscoverScreen.jsx must add no alcohol UI beyond the pre-existing has_alcohol data field')
  assert.ok(!/alcohol/i.test(rowSource))
  assert.ok(!/alcohol/i.test(tileSource))
})

// 14. Body/tag dual-search behavior remains intact (regression) ────────────
test('DiscoverScreen.jsx: runSearch still queries both tags and item body, merged via mergeSearchMatchCounts', () => {
  assert.match(discoverSource, /from\('tags'\)/)
  assert.match(discoverSource, /from\('items'\)\.select\('id'\)/)
  assert.match(discoverSource, /mergeSearchMatchCounts\(/)
})

// 19. Accessibility props structurally present ──────────────────────────────
test('NearbyResultRow.jsx: accessibilityRole/Label present on the row and the bookmark control', () => {
  assert.match(rowSource, /accessibilityRole="button"[\s\S]{0,200}accessibilityLabel=\{a11yLabel\}/)
  assert.match(rowSource, /accessibilityLabel=\{saved \? `Remove/)
})

test('CategoryTile.jsx: accessibilityRole/Label/State present and accessible', () => {
  assert.match(tileSource, /accessibilityRole="button"/)
  assert.match(tileSource, /accessibilityState=\{\{ selected: !!selected \}\}/)
})

test('CategoryIcon.jsx: decorative icon shapes are hidden from the accessibility tree, matching ArchetypeArtwork.jsx\'s established pattern', () => {
  assert.match(iconSource, /accessibilityElementsHidden/)
  assert.match(iconSource, /importantForAccessibility="no-hide-descendants"/)
})

test('DiscoverScreen.jsx: search input, clear-search button, and filter pills all carry accessibility props', () => {
  assert.match(discoverSource, /accessibilityLabel="Search nearby experiences"/)
  assert.match(discoverSource, /accessibilityLabel="Clear search text"/)
  assert.match(discoverSource, /accessibilityLabel="Saved filter"/)
  assert.match(discoverSource, /accessibilityLabel="Not Done filter"/)
})

// 20. No per-row Saved/completion queries ───────────────────────────────────
test('NearbyResultRow.jsx: never calls Supabase directly — reads only from props (already-fetched/shared state)', () => {
  assert.ok(!rowSource.includes('supabase'), 'row component must not import/call supabase — no per-row queries')
})

test('DiscoverScreen.jsx: completion is fetched exactly once per changed id-set (bulk), never inside renderItem', () => {
  const renderItemStart = discoverSource.indexOf('const renderItem = useCallback')
  const renderItemEnd = discoverSource.indexOf('const keyExtractor')
  const renderItemBody = discoverSource.slice(renderItemStart, renderItemEnd)
  assert.ok(!renderItemBody.includes('supabase'), 'renderItem must not query Supabase per row')
  assert.match(discoverSource, /fetchCompletedItemIds\(discoverUserId, ids\)/)
})

// 22. Passive location text has no dropdown/press behavior ─────────────────
test('DiscoverScreen.jsx: the "Using your current location" meta text is plain Text with no onPress/TouchableOpacity wrapper', () => {
  const textIdx = discoverSource.indexOf('Using your current location')
  assert.ok(textIdx > -1, 'meta text must be present')
  const rowOpenIdx = discoverSource.lastIndexOf('searchMetaRow', textIdx)
  const between = discoverSource.slice(rowOpenIdx, textIdx)
  assert.ok(!between.includes('onPress'), 'the passive meta row must carry no onPress handler')
  assert.ok(!between.includes('TouchableOpacity'), 'the passive meta row must not be a TouchableOpacity')
})

// 23. Responsive search layout does not rely on a fixed width assumption ───
test('DiscoverScreen.jsx: responsive threshold uses useWindowDimensions, not a single hardcoded device width branch', () => {
  assert.match(discoverSource, /useWindowDimensions/)
  assert.match(discoverSource, /SEARCH_META_INLINE_MIN_WIDTH/)
  assert.match(discoverSource, /windowWidth >= SEARCH_META_INLINE_MIN_WIDTH/)
})

// 24. FlatList remains virtualized ───────────────────────────────────────────
test('DiscoverScreen.jsx: results still render via FlatList, not ScrollView/map', () => {
  assert.match(discoverSource, /<FlatList/)
  assert.match(discoverSource, /data=\{displayItems\}/)
})

// 25. No metro selector, map, destination module, photo, radius slider, or
// alcohol control introduced anywhere in the touched files ─────────────────
test('Touched Nearby files introduce no metro selector, map, Destination Hub, photo, radius slider, or alcohol UI', () => {
  const forbidden = [
    /MapView/, /react-native-maps/, /destination_zones/, /DestinationHub/,
    /HubScreen/, /RadiusSlider/, /Slider\b/, /metroLabel/, /onMetroPress/,
    /CompactHomeHeader/,
  ]
  for (const [name, source] of [
    ['DiscoverScreen.jsx', discoverSource],
    ['NearbyResultRow.jsx', rowSource],
    ['CategoryTile.jsx', tileSource],
    ['CategoryIcon.jsx', iconSource],
  ]) {
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(source), `${name} must not match forbidden pattern ${pattern}`)
    }
  }
})

// 21. No new dependency — package.json's dependencies/devDependencies block
// itself is asserted unchanged at the git-diff level (see final report);
// this only sanity-checks none of the new modules import a package outside
// the existing dependency set that this repo is known to already ship.
test('New Nearby modules import no icon/vector/maps/slider dependency', () => {
  const forbiddenImports = [
    '@expo/vector-icons', 'react-native-svg', 'react-native-maps',
    '@react-native-community/slider', 'lucide-react-native',
  ]
  for (const [name, source] of [
    ['NearbyResultRow.jsx', rowSource],
    ['CategoryTile.jsx', tileSource],
    ['CategoryIcon.jsx', iconSource],
    ['DiscoverScreen.jsx', discoverSource],
  ]) {
    // Only real `import ... from '<dep>'` statements count — a source
    // comment merely discussing/ruling out a dependency (as CategoryIcon.jsx's
    // own docstring does) must not trip this check.
    const importLines = source.split('\n').filter(l => /^\s*import\b/.test(l))
    for (const dep of forbiddenImports) {
      assert.ok(!importLines.some(l => l.includes(dep)), `${name} must not import ${dep}`)
    }
  }
})

test('package.json parses as valid JSON (sanity — this pass must not have touched it)', () => {
  assert.doesNotThrow(() => JSON.parse(packageJsonSource))
})
