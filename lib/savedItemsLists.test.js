// Saved Items V1 (2026-09-18), updated by the Lists Landing Redesign
// (2026-09-19) — structural/source-text guards for the Lists tab's pinned
// "Saved" destination. Pre-redesign, the Saved entry was inline markup
// inside screens/ListsScreen.jsx; the redesign extracted it into
// components/lists/SavedCollectionCard.jsx (pure presentation) with
// ordering owned by lib/listsSections.js's buildListsRows (pure data), and
// screens/ListsScreen.jsx now only wires data/handlers to it. These tests
// were updated to verify the same real guarantees against the new
// locations — no RN render harness exists in this repo, so these remain
// grep-based/pure-function assertions, matching the established convention.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildListsRows } from './listsSections.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const listsSource = readFileSync(join(__dirname, '../screens/ListsScreen.jsx'), 'utf8')
const savedCardSource = readFileSync(join(__dirname, '../components/lists/SavedCollectionCard.jsx'), 'utf8')
const savedSource = readFileSync(join(__dirname, '../screens/SavedItemsScreen.jsx'), 'utf8')

test('"Saved" is pinned first in the Lists landing row order — before any "Your Lists"/personal-list rows, regardless of how many personal or joined lists exist', () => {
  const empty = buildListsRows({ personalLists: [], joinedOfficial: [] })
  assert.equal(empty[0].type, 'saved')

  const populated = buildListsRows({
    personalLists: [{ id: 'a', title: 'Trip' }],
    joinedOfficial: [{ id: 'b', title: 'Official' }],
  })
  assert.equal(populated[0].type, 'saved')
  const firstListIdx = populated.findIndex(r => r.type === 'list')
  assert.ok(firstListIdx > 0, 'a real list row must come after the saved row')
})

test('the Saved card is a virtual/system entry — no `lists`/`list_items` row is created or required for it to appear', () => {
  assert.ok(!savedCardSource.includes(".from('lists')"))
  assert.ok(!savedCardSource.includes(".from('list_items')"))
  assert.ok(!savedCardSource.includes('supabase'), 'SavedCollectionCard must not issue its own Supabase query')
  assert.ok(listsSource.includes('count={savedItemIds.size}'), 'ListsScreen must pass the live savedItemIds Set size as the Saved card\'s count')
})

test('rename/delete/share/invite/reorder controls are structurally absent from SavedCollectionCard\'s own markup', () => {
  assert.ok(!savedCardSource.includes('deleteList'))
  assert.ok(!savedCardSource.includes('leaveList'))
  assert.ok(!savedCardSource.includes('onLongPress'))
  assert.ok(!savedCardSource.includes('SavedCrew'))
  assert.ok(!savedCardSource.includes('invite_code'))
  assert.ok(!savedCardSource.includes('onMore'))
})

test('Saved entry count comes from the already-loaded savedItemIds Set — zero extra query for the count itself', () => {
  assert.ok(listsSource.includes('const { savedItemIds } = useSavedItems()'))
  assert.ok(listsSource.includes("navigation.navigate('SavedItems')"), 'Saved must still open the existing SavedItems route')
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
