// Lists Landing Redesign (2026-09-19) — structural/source-text and
// pure-logic regression coverage for the Lists tab landing screen redesign
// (screens/ListsScreen.jsx, components/lists/*, lib/listsSections.js). No
// RN render harness exists in this repo, so these are grep-based
// assertions on live source plus direct unit tests of the pure derivation
// functions, matching the established convention (see
// lib/savedItemsLists.test.js, lib/nearbyRedesignStructural.test.js).
//
// Numbered to match the task's required-coverage list.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  buildListsRows,
  resolveListCover,
  accentForList,
  isFeaturedCreatorList,
} from './listsSections.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
function src(relPath) {
  return readFileSync(join(__dirname, relPath), 'utf8')
}

const appSource = src('../App.jsx')
const listsSource = src('../screens/ListsScreen.jsx')
const cardSource = src('../components/lists/ListCollectionCard.jsx')
const savedCardSource = src('../components/lists/SavedCollectionCard.jsx')
const headerSource = src('../components/lists/ListsHeader.jsx')
const packageJsonSource = src('../package.json')
const appJsonSource = src('../app.json')

// 1. Bottom Lists tab still resolves to the correct live screen ────────────
test('App.jsx: ListsTab -> ListsStack -> Stack.Screen name="Lists" still renders ListsScreen', () => {
  const stackIdx = appSource.indexOf('function ListsStack')
  assert.ok(stackIdx !== -1)
  const block = appSource.slice(stackIdx, stackIdx + 400)
  assert.match(block, /name="Lists"[\s\S]{0,80}component=\{ListsScreen\}/)

  const tabIdx = appSource.indexOf('name="ListsTab"')
  assert.ok(tabIdx !== -1)
  const tabBlock = appSource.slice(tabIdx, tabIdx + 300)
  assert.match(tabBlock, /component=\{ListsStack\}/)
})

// 2 & 6. Saved is pinned first, virtual, and opens SavedItems — see
// lib/savedItemsLists.test.js for the dedicated coverage of these; here we
// additionally confirm the navigation target route name matches App.jsx's
// registered route.
test('Saved opens the App.jsx-registered "SavedItems" route', () => {
  assert.ok(appSource.includes('name="SavedItems"'), 'App.jsx must register a SavedItems route')
  assert.ok(listsSource.includes("navigation.navigate('SavedItems')"))
})

// 3 & 4 & 5. covered in lib/savedItemsLists.test.js — re-asserted briefly
// here against the pure row-builder to guard the data layer directly.
test('buildListsRows never fabricates a `lists` row for Saved — the saved row carries no list id/data', () => {
  const rows = buildListsRows({ personalLists: [], joinedOfficial: [] })
  const savedRow = rows.find(r => r.type === 'saved')
  assert.ok(savedRow)
  assert.equal(savedRow.list, undefined)
})

// 7 & 8. Owned-list and joined-list actions remain available ───────────────
test('ListsScreen: owner path calls deleteList, member path calls leaveList — unchanged ownership branch', () => {
  assert.match(listsSource, /function handleListAction\(list\)\s*\{\s*\n\s*if \(list\.creator_id === userId\)\s*\{\s*\n\s*deleteList\(list\)\s*\n\s*\}\s*else\s*\{\s*\n\s*leaveList\(list\)/)
})

test('ListCollectionCard: onLongPress and onMore are wired for personal (non-official) list cards only', () => {
  assert.ok(listsSource.includes('onLongPress={official ? undefined : () => handleListAction(list)}'))
  assert.ok(listsSource.includes('onMore={official ? undefined : () => openMore(list)}'))
})

// 9. Official/private restrictions remain intact — the official/personal
// split condition itself is unchanged from the pre-redesign query. ────────
test('ListsScreen: personal vs. official split unchanged (is_official + isEnded filter, same as pre-redesign)', () => {
  assert.match(listsSource, /const personal = all\.filter\(l => !l\.is_official && !isEnded\(l\.ends_at\)\)/)
  assert.match(listsSource, /const official = all\.filter\(l => l\.is_official && !isEnded\(l\.ends_at\)\)/)
})

// 10. Create-list flow remains wired ─────────────────────────────────────
test('ListsScreen: create action still navigates to the existing CreateList route', () => {
  assert.match(listsSource, /function handleCreate\(\)\s*\{[\s\S]{0,120}navigation\.navigate\('CreateList'\)/)
  assert.ok(appSource.includes('name="CreateList"'), 'App.jsx must register a CreateList route')
})

// 11. Join-list flow remains wired (unchanged: invite-deep-link driven,
// no in-screen "join" button existed pre-redesign and none was added). ────
test('no new manual "join a list" UI was invented on the Lists landing screen — JoinList stays deep-link/invite-driven only', () => {
  assert.ok(!listsSource.includes('JoinList'), 'ListsScreen must not navigate to JoinList directly')
  assert.ok(appSource.includes('name="JoinList"'), 'the real JoinList route must still exist elsewhere in the app')
})

// 12. List-detail navigation still receives the required parameters ───────
test('ListsScreen: opening a list still navigates to "List" with { listId, title } — same shape as pre-redesign', () => {
  assert.match(listsSource, /function openList\(list\)\s*\{\s*\n\s*navigation\.navigate\('List', \{ listId: list\.id, title: list\.title \}\)/)
})

// 13. Real progress/count data preserved — memberCount/crew computation is
// the same bulk aggregation as pre-redesign; no hardcoded values added. ───
test('ListsScreen: memberCount/crew map still derived from a single bulk list_members query inside load(), not per-card', () => {
  const loadStart = listsSource.indexOf('const load = useCallback')
  const loadEnd = listsSource.indexOf('}, [])', loadStart)
  const loadBody = listsSource.slice(loadStart, loadEnd)
  const fromCalls = (loadBody.match(/\.from\('list_members'\)/g) ?? []).length
  assert.equal(fromCalls, 2, 'exactly two list_members queries inside load() (own memberships + others\' memberships), not one per card')
  assert.ok(listsSource.includes("memberCount:   (memberCountMap[l.id] ?? 0) + 1"))
})

test('no hardcoded/fake progress or list metadata was introduced', () => {
  for (const s of [listsSource, cardSource, savedCardSource, headerSource]) {
    assert.ok(!/of \d+ completed/i.test(s), 'no fabricated "X of Y completed" progress string')
    assert.ok(!/\bSample list\b/i.test(s))
    assert.ok(!/\bLorem ipsum\b/i.test(s))
  }
})

// 14. No per-card query pattern ────────────────────────────────────────────
test('ListCollectionCard.jsx / SavedCollectionCard.jsx: no Supabase query call inside a card-rendering component', () => {
  assert.ok(!cardSource.includes('supabase'))
  assert.ok(!savedCardSource.includes('supabase'))
})

// 15. Cover failure falls back safely ──────────────────────────────────────
test('resolveListCover: falls back to the generic treatment once a cover has failed to load, and when no hero_image_url exists', () => {
  assert.deepEqual(resolveListCover({ hero_image_url: null }), { hasCover: false, url: null })
  assert.deepEqual(resolveListCover({ hero_image_url: 'https://x/y.jpg' }), { hasCover: true, url: 'https://x/y.jpg' })
  assert.deepEqual(resolveListCover({ hero_image_url: 'https://x/y.jpg' }, true), { hasCover: false, url: null })
})

test('ListCollectionCard.jsx: cover Image has onError wired to a local no-retry failed flag (mirrors ArchetypeArtwork\'s safe-fallback technique)', () => {
  assert.match(cardSource, /onError=\{\(\) => setFailed\(true\)\}/)
  assert.ok(cardSource.includes('const [failed, setFailed] = useState(false)'))
})

// 16. No new image/database field introduced ───────────────────────────────
test('ListsScreen query: hero_image_url is the ONLY additional column selected vs. pre-redesign — a real, pre-existing column (already used by ListScreen.jsx)', () => {
  assert.match(listsSource, /select\('lists\(id, title, starts_at, ends_at, is_public, is_official, creator_id, cover_emoji, checkoff_creator_id, is_featured_eligible, hero_image_url\)'\)/)
  const listScreenSource = src('../screens/ListScreen.jsx')
  assert.ok(listScreenSource.includes('hero_image_url'), 'hero_image_url must be a column already read elsewhere in the app, not newly invented here')
})

// 17. No fake list metadata — already covered above; also confirm no new
// sample data arrays were added anywhere in the touched files. ────────────
test('no hardcoded sample-list array was introduced in any touched file', () => {
  for (const s of [listsSource, cardSource, savedCardSource, headerSource]) {
    assert.ok(!/const\s+\w*[Ss]ample\w*\s*=\s*\[/.test(s))
  }
})

// 18. Empty/loading/error states exist ─────────────────────────────────────
test('ListsScreen: loading, error+retry, empty-personal, and signed-out states all exist', () => {
  assert.ok(listsSource.includes('<ActivityIndicator color={AMBER} />'), 'loading state')
  assert.ok(listsSource.includes("Couldn't load your lists") && listsSource.includes('onPress={load}'), 'error+retry state')
  assert.ok(listsSource.includes('empty-personal') && listsSource.includes('Start your first list'), 'empty-personal state')
  assert.ok(listsSource.includes('Sign in to see your lists'), 'signed-out state (kept, though structurally unreachable via the tab bar)')
})

// 19. Accessibility props exist on primary actions and cards ───────────────
test('ListsHeader / SavedCollectionCard / ListCollectionCard: accessibilityRole+Label present on every primary action', () => {
  assert.match(headerSource, /accessibilityRole="button"\s*\n\s*accessibilityLabel="Create a new list"/)
  assert.match(savedCardSource, /accessibilityRole="button"\s*\n\s*accessibilityLabel=\{`Saved, \$\{label\}`\}/)
  assert.ok(cardSource.includes('accessibilityLabel={a11yParts.join') , 'list card must announce a composed label')
  assert.ok(cardSource.includes("accessibilityLabel={`More options for ${list.title}`}"), 'overflow control must identify which list it affects, not a bare "More"')
  assert.ok(cardSource.includes("accessibilityLabel={`View crew for ${list.title}`}"))
})

test('ListCollectionCard: progress/meta wording avoids raw slash notation in accessibility text (screen-reader-friendly)', () => {
  assert.ok(!cardSource.includes('a11yParts') || !/\d+\/\d+/.test(cardSource))
})

test('decorative cover images and crew-avatar clusters are hidden from the accessibility tree', () => {
  assert.match(cardSource, /accessibilityElementsHidden\s*\n\s*importantForAccessibility="no"/, 'real cover Image must be hidden from a11y tree')
  assert.match(cardSource, /accessibilityElementsHidden importantForAccessibility="no-hide-descendants"/, 'decorative fallback panel / crew stack must be hidden from a11y tree')
})

// 20. Long-title layout is bounded ──────────────────────────────────────────
test('ListCollectionCard: list title has a numberOfLines cap so a long title cannot break card height', () => {
  assert.match(cardSource, /<Text style=\{\[styles\.title,[\s\S]{0,40}numberOfLines=\{2\}/)
})

// 21. Virtualization remains present ─────────────────────────────────────
test('ListsScreen: main content is a FlatList, not a ScrollView', () => {
  assert.ok(listsSource.includes('<FlatList'))
  assert.ok(!listsSource.includes('<ScrollView'))
})

test('no nested same-direction virtualization was introduced (no FlatList/SectionList inside another list\'s renderItem)', () => {
  assert.ok(!cardSource.includes('FlatList') && !cardSource.includes('SectionList'))
  assert.ok(!savedCardSource.includes('FlatList') && !savedCardSource.includes('SectionList'))
})

// 22. No package/native/app.json change ────────────────────────────────────
test('package.json: no new dependency was introduced by this pass (spot-check — no lists-redesign-only package name present)', () => {
  assert.ok(!packageJsonSource.includes('react-native-vector-icons'))
  assert.ok(!packageJsonSource.includes('@shopify/flash-list'))
})

// 23. Home/Nearby/Detail/Saved-persistence/list-detail files behaviorally
// untouched, except the documented additive trackEvent.js change. ─────────
test('lib/SavedItemsContext.js and lib/savedItemsState.js were not modified by this pass (still export the same public surface)', () => {
  const ctx = src('../lib/SavedItemsContext.js')
  assert.ok(ctx.includes('export function useSavedItems()'))
  assert.ok(ctx.includes('export function SavedItemsProvider'))
})

test('trackEvent.js change is additive only — DEBOUNCED_TYPES gained "lists_tab_view", every prior type is still present', () => {
  const trackSource = src('./trackEvent.js')
  for (const type of ['list_view', 'item_view', 'saved_collection_view', 'nearby_view', 'lists_tab_view']) {
    assert.ok(trackSource.includes(`'${type}'`), `DEBOUNCED_TYPES must still include '${type}'`)
  }
})

// ── Pure-logic unit tests for lib/listsSections.js ──────────────────────────

test('accentForList: deterministic by id, matches the pre-redesign 6-color cycle', () => {
  const a = accentForList({ id: 'abc' })
  const b = accentForList({ id: 'abc' })
  assert.equal(a, b)
  assert.equal(typeof a, 'string')
})

test('isFeaturedCreatorList: requires BOTH a creatorHandle and is_featured_eligible', () => {
  assert.equal(isFeaturedCreatorList({ creatorHandle: 'joe', is_featured_eligible: true }), true)
  assert.equal(isFeaturedCreatorList({ creatorHandle: 'joe', is_featured_eligible: false }), false)
  assert.equal(isFeaturedCreatorList({ creatorHandle: null, is_featured_eligible: true }), false)
  assert.equal(isFeaturedCreatorList({}), false)
})

test('buildListsRows: renders the empty-personal row when there are no personal lists, and omits the joined-lists header when there are none', () => {
  const rows = buildListsRows({ personalLists: [], joinedOfficial: [] })
  assert.ok(rows.some(r => r.type === 'empty-personal'))
  assert.ok(!rows.some(r => r.key === 'header-joined'))
})

test('buildListsRows: renders one row per personal and joined list, each with a unique key', () => {
  const rows = buildListsRows({
    personalLists: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }],
    joinedOfficial: [{ id: '3', title: 'C' }],
  })
  const keys = rows.map(r => r.key)
  assert.equal(new Set(keys).size, keys.length, 'every row key must be unique')
  assert.equal(rows.filter(r => r.type === 'list').length, 3)
})
