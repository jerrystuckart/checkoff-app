// Saved Items V1 (2026-09-18) — structural/source-text guards for the
// Lists tab's pinned "Saved" destination (screens/ListsScreen.jsx) and
// the Saved collection screen (screens/SavedItemsScreen.jsx). No RN
// render harness exists in this repo, so these are grep-based assertions
// on live source, matching the established convention.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const listsSource = readFileSync(join(__dirname, '../screens/ListsScreen.jsx'), 'utf8')
const savedSource = readFileSync(join(__dirname, '../screens/SavedItemsScreen.jsx'), 'utf8')

test('"Saved" is pinned first in ListsScreen\'s render order — before the "Your lists" header/personal lists', () => {
  const savedIdx = listsSource.indexOf('savedEntry')
  const yourListsIdx = listsSource.indexOf('Your lists')
  assert.ok(savedIdx !== -1 && yourListsIdx !== -1)
  assert.ok(savedIdx < yourListsIdx, 'the Saved entry must render before the "Your lists" section')
})

test('the Saved entry is a virtual/system entry — no `lists`/`list_items` row is created or required for it to appear', () => {
  // The savedEntry block must read from savedItemIds only, never insert
  // into `lists` or `list_items`.
  const entryBlock = listsSource.slice(listsSource.indexOf('savedEntry'), listsSource.indexOf('headerRow'))
  assert.ok(!entryBlock.includes(".from('lists')"))
  assert.ok(!entryBlock.includes(".from('list_items')"))
  assert.ok(entryBlock.includes('savedItemIds.size'))
})

test('rename/delete/share/invite/reorder controls are structurally absent from the Saved entry\'s own markup', () => {
  const start = listsSource.indexOf('style={styles.savedEntry}')
  const end = listsSource.indexOf('</TouchableOpacity>', start)
  assert.ok(start !== -1 && end !== -1, 'Saved entry markup must exist')
  const entryMarkup = listsSource.slice(start, end)
  assert.ok(!entryMarkup.includes('deleteList'))
  assert.ok(!entryMarkup.includes('leaveList'))
  assert.ok(!entryMarkup.includes('onLongPress'))
  assert.ok(!entryMarkup.includes('SavedCrew'))
  assert.ok(!entryMarkup.includes('invite_code'))
})

test('Saved entry count comes from the already-loaded savedItemIds Set — zero extra query for the count itself', () => {
  assert.ok(listsSource.includes('const { savedItemIds } = useSavedItems()'))
})

test('empty-state copy matches exactly: "Nothing saved yet" / "Bookmark something that looks good and it\'ll be waiting here."', () => {
  assert.ok(savedSource.includes('Nothing saved yet'))
  assert.ok(savedSource.includes("Bookmark something that looks good and it'll be waiting here."))
})

test('item fetch query excludes inactive/unapproved items using the same condition verified in DeepLinkItemResolverScreen (afc1a61)', () => {
  assert.ok(savedSource.includes('it.isActive && it.isApproved') || savedSource.includes('it && it.isActive && it.isApproved'))
})

test('ordering by saved_items.created_at DESC is present in the query construction', () => {
  const queryBlock = savedSource.slice(savedSource.indexOf("from('saved_items')"), savedSource.indexOf("from('saved_items')") + 900)
  assert.match(queryBlock, /order\(\s*['"]created_at['"]\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)/)
})

test('one request (a single saved_items -> items join), not one query per saved item', () => {
  const occurrences = (savedSource.match(/supabase\s*\n?\s*\.from\(/g) ?? []).length
  assert.equal(occurrences, 1, 'SavedItemsScreen must issue exactly one Supabase query for its item list')
  assert.ok(savedSource.includes('items (') , 'must use an embedded/join select, matching lib/useItems.js\'s own list_items -> items pattern')
})

test('removing a bookmark updates the visible collection via a derived value, not a stale snapshot', () => {
  assert.match(savedSource, /const visibleItems = useMemo\(\s*\n?\s*\(\) => fetchedRows\.filter\(\(it\) => savedItemIds\.has\(it\.id\)\)/, 'visibleItems must be re-derived from the live savedItemIds Set on every render')
})

test('Saved screen fires saved_collection_view once per view via the existing trackEvent/debounce convention', () => {
  assert.ok(savedSource.includes("trackEvent('saved_collection_view')"))
})

test('SavedItemsScreen tapping an item navigates to the normal ItemDetail route (secret-item guard reused automatically, not duplicated here)', () => {
  assert.ok(savedSource.includes("navigation.navigate('ItemDetail', { item })"))
  assert.ok(!savedSource.includes('is_secret') || !savedSource.includes('navigation.replace'), 'must not duplicate the centralized secret-reveal guard')
})
