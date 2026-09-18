// Item Detail Corrective Pass follow-up (2026-09-18) — structural/source-
// text regression coverage locking in a specific claim that matters for
// Saved-items correctness: at every real navigation('ItemDetail', ...)
// call site in this codebase, the `item` object's `.id` field is the
// canonical `public.items.id` (never a `list_items.id`/other row's own
// id). Detail's Save control calls `toggleSaved(item.id, navigation)`
// (see lib/itemDetailRedesign.test.js) — if any entry point ever passed
// something other than items.id as `item.id`, Detail's Save would write
// a wrong/foreign id to saved_items.item_id, which (post-1464cbd) now
// correctly throws on the resulting foreign_key_violation instead of
// being silently masked, but would still mean the user's tap never
// actually saves anything.
//
// No RN render harness exists in this repo — these are grep/source-text
// assertions on the live call sites, matching every other test file's
// established convention (see lib/savedItemsHome.test.js, etc).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
function src(relPath) {
  return readFileSync(join(__dirname, relPath), 'utf8')
}

test('CreatorProfileScreen.jsx: list-row navigation explicitly sets item.id from the joined items row (li.items.id), not li.id (the list_items row id)', () => {
  const source = src('../screens/CreatorProfileScreen.jsx')
  const navBlock = source.slice(source.indexOf("navigation.navigate('ItemDetail'"), source.indexOf("navigation.navigate('ItemDetail'") + 400)
  assert.ok(navBlock.includes('const item      = li.items') === false, 'sanity: this assertion targets the object literal below, not the destructure above')
  assert.match(navBlock, /listItemId:\s*li\.id,\s*\n\s*id:\s*item\.id,/, 'the navigated item object must carry listItemId (li.id) and id (item.id) as SEPARATE, explicitly distinct fields')
})

test('ListScreen.jsx: navigateToRevealItem fetches a fresh items row by id and forwards it directly — item.id is a raw items.id', () => {
  const source = src('../screens/ListScreen.jsx')
  const fnBody = source.slice(source.indexOf('async function navigateToRevealItem'), source.indexOf('async function navigateToRevealItem') + 1200)
  assert.match(fnBody, /\.from\('items'\)/, 'must query the items table directly')
  assert.match(fnBody, /navigation\.navigate\('ItemDetail',\s*\{\s*\n\s*item:\s*data,/s, 'must forward the raw items-table row as `item`, no id substitution')
})

test('ListScreen.jsx: renderItem\'s normal-card tap forwards the useItems()-shaped `item` object as-is (id comes from lib/useItems.js\'s li.items.id, not li.id)', () => {
  const source = src('../screens/ListScreen.jsx')
  assert.ok(source.includes("const { items,") || source.includes('useItems(listId)'), 'ListScreen must consume the shared useItems() hook, not build its own list_items->items mapping')
  const useItemsSource = src('../lib/useItems.js')
  assert.match(useItemsSource, /listItemId:\s*li\.id,/, 'useItems.js must expose the list_items row id under its OWN distinct field, listItemId')
  assert.match(useItemsSource, /id:\s*li\.items\?\.id,/, 'useItems.js must set the shared item.id field from li.items.id (the joined items row), never li.id')
})

test('DiscoverScreen.jsx / NearbyScreen.jsx: both consume lib/useNearby.js, which builds item.id directly off a raw items-table query row', () => {
  const discoverSource = src('../screens/DiscoverScreen.jsx')
  const nearbySource = src('../screens/NearbyScreen.jsx')
  assert.ok(discoverSource.includes("import { useNearby } from '../lib/useNearby'"))
  assert.ok(nearbySource.includes("import { useNearby } from '../lib/useNearby'"))
  const nearbyLibSource = src('../lib/useNearby.js')
  assert.match(nearbyLibSource, /\.from\('items'\)/, 'useNearby.js must query the items table directly')
  assert.match(nearbyLibSource, /id:\s*item\.id,/, 'useNearby.js must set item.id from the raw items-table row\'s own id — no join-row id substitution')
})

test('DeepLinkItemResolverScreen.jsx: navigation.replace forwards the raw items-table row fetched by id — item.id === the resolved items.id by construction', () => {
  const source = src('../screens/DeepLinkItemResolverScreen.jsx')
  const fnBody = source.slice(source.indexOf('async function resolveItem'), source.indexOf('async function resolveItem') + 700)
  assert.match(fnBody, /\.from\('items'\)/)
  assert.match(fnBody, /navigation\.replace\('ItemDetail',\s*\{\s*item:\s*data\s*\}\)/, 'must forward the raw items-table row untouched as `item`')
})

test('SavedItemsScreen.jsx: mapRow builds item.id from the joined items row (it.id), never from the saved_items row\'s own composite key', () => {
  const source = src('../screens/SavedItemsScreen.jsx')
  const mapRowBody = source.slice(source.indexOf('function mapRow'), source.indexOf('function mapRow') + 600)
  assert.match(mapRowBody, /const it = row\.items/, 'mapRow must read the joined items row into its own local, not use the saved_items row directly')
  assert.match(mapRowBody, /id:\s*it\.id,/, 'the mapped item.id must come from the joined items row (it.id), never row.id/row.item_id directly')
})

test('PostCheckoffSheet.jsx: "Also Here"/"Nearest Next" suggestions query the items table directly — no list_items/other-row id substitution', () => {
  const source = src('../components/PostCheckoffSheet.jsx')
  const candidatesBlock = source.slice(source.indexOf("from('items')"), source.indexOf("from('items')") + 400)
  assert.match(candidatesBlock, /select\('id, body,/, 'candidates query must select items.id directly')
})

test('WhatsGoodModule.jsx / WhatsTheThingCard.jsx / WhatsGoodDiscovery.jsx / WhatsTheThingHero.jsx (via HomeScreen\'s NearYouCompact): all render items hydrated from HomeScreen\'s rawNearbyItems / nearbyRailItems, which come from a direct items-table query', () => {
  const homeSource = src('../screens/HomeScreen.jsx')
  const loadNearbyRailBody = homeSource.slice(homeSource.indexOf('async function loadNearbyRail'), homeSource.indexOf('async function loadNearbyRail') + 1800)
  assert.match(loadNearbyRailBody, /\.from\('items'\)/, 'loadNearbyRail must query the items table directly')

  const useWhatsGoodSource = src('../lib/useWhatsGood.js')
  assert.match(useWhatsGoodSource, /const byId = new Map\(rawNearbyItems\.map\(\(i\) => \[i\.id, i\]\)\)/, 'selectedItems/atPlaceItem must be hydrated by looking real items back up from rawNearbyItems (itself items-table rows), never constructed from a candidate-id-only shape')

  for (const [file, importLine] of [
    ['../components/WhatsGoodModule.jsx', null],
    ['../components/WhatsTheThingCard.jsx', null],
    ['../components/home/WhatsGoodDiscovery.jsx', null],
  ]) {
    const s = src(file)
    assert.match(s, /navigation\.navigate\('ItemDetail',\s*\{\s*item\s*\}\)/, `${file} must forward its item prop unmodified, no id substitution`)
  }
})

test('HomeScreen.jsx: NearYouCompact onItemPress forwards the rail item unmodified — same rawNearbyItems-sourced object, no id substitution', () => {
  const source = src('../screens/HomeScreen.jsx')
  assert.match(source, /onItemPress=\{\(item\) => navigation\.navigate\('ItemDetail',\s*\{\s*item\s*\}\)\}/)
})
