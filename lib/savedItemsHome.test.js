// Saved Items V1 (2026-09-18) — structural/source-text guards for the
// Home bookmark controls, matching this repo's established convention
// (no RN render harness — see lib/whatsTheThingHeroRightHere.test.js,
// lib/itemDetailRedesign.test.js): grep-based assertions on live source.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const editorialCardSource = readFileSync(join(__dirname, '../components/home/EditorialCard.jsx'), 'utf8')
const nearYouSource = readFileSync(join(__dirname, '../components/home/NearYouCompact.jsx'), 'utf8')
const whatsGoodSource = readFileSync(join(__dirname, '../components/home/WhatsGoodDiscovery.jsx'), 'utf8')
const heroSource = readFileSync(join(__dirname, '../components/home/WhatsTheThingHero.jsx'), 'utf8')

test('EditorialCard imports the shared useSavedItems hook and BookmarkIcon (no new icon dependency)', () => {
  assert.ok(editorialCardSource.includes("import { useSavedItems } from '../../lib/SavedItemsContext'"))
  assert.ok(editorialCardSource.includes("import BookmarkIcon from '../BookmarkIcon'"))
})

// Extracts a top-level function's body by slicing from its declaration to
// the next top-level `function ` (or `const styles =`) declaration —
// avoids brittle fixed-character windows.
function extractFn(source, name) {
  const start = source.indexOf(`function ${name}`)
  if (start === -1) return ''
  const rest = source.slice(start + 1)
  const nextMatch = rest.match(/\n(function |const styles = |export default function )/)
  const end = nextMatch ? start + 1 + nextMatch.index : source.length
  return source.slice(start, end)
}

test('bookmark wired into the primary card (Near You featured / What\'s Good hero)', () => {
  assert.ok(editorialCardSource.includes('function PrimaryImageMode'))
  assert.ok(extractFn(editorialCardSource, 'PrimaryImageMode').includes('<SaveToggle'), 'PrimaryImageMode must render SaveToggle')
  assert.ok(extractFn(editorialCardSource, 'PrimaryArchetypeMode').includes('<SaveToggle'), 'PrimaryArchetypeMode must render SaveToggle')
  assert.ok(extractFn(editorialCardSource, 'PrimaryNoImageMode').includes('<SaveToggle'), 'PrimaryNoImageMode must render SaveToggle')
})

test('bookmark wired into secondary rows (SecondaryRow, "row" variant)', () => {
  assert.ok(extractFn(editorialCardSource, 'SecondaryRow').includes('<SaveToggle'), 'SecondaryRow must render SaveToggle')
})

test('bookmark wired into What\'s Good rail cards (RailCard, "rail" variant) in all three artwork tiers', () => {
  const railFn = editorialCardSource.slice(editorialCardSource.indexOf('function RailCard'))
  const saveToggleCount = (railFn.match(/<SaveToggle/g) ?? []).length
  assert.equal(saveToggleCount, 3, 'RailCard has 3 render branches (photo/archetype/no-image); each must render SaveToggle')
})

test('SaveToggle reads only from the shared context — no per-card Supabase query in the bookmark control itself', () => {
  const saveToggleFn = editorialCardSource.match(/function SaveToggle[\s\S]*?\n}/)
  assert.ok(saveToggleFn, 'SaveToggle component must exist')
  assert.ok(!saveToggleFn[0].includes('supabase.'), 'SaveToggle must never call supabase directly — it only reads useSavedItems()')
  assert.ok(saveToggleFn[0].includes('useSavedItems()'))
})

test('bookmark press handler is isolated from the card\'s navigate/onPress handler (separate Pressable, not nested inside the outer touchable\'s own onPress)', () => {
  const saveToggleFn = editorialCardSource.match(/function SaveToggle[\s\S]*?\n}/)[0]
  assert.ok(saveToggleFn.includes('<Pressable'), 'SaveToggle must be its own Pressable, a sibling to the card content, not a plain View')
  assert.ok(saveToggleFn.includes('onPress={() => toggleSaved(item?.id, navigation)}'))
  // The outer card wrapper is PressableTactile, whose own onPress is
  // always the caller-supplied navigate handler — SaveToggle's onPress is
  // never passed as PressableTactile's onPress prop. Checked per single
  // line (PressableTactile's opening tag is always one line in this
  // file) so a later, unrelated occurrence of "toggleSaved" elsewhere in
  // the file (e.g. inside SaveToggle's own definition) can't cross into
  // the match.
  const pressableTactileOpenLines = editorialCardSource.split('\n').filter((l) => l.includes('<PressableTactile'))
  assert.ok(pressableTactileOpenLines.length > 0, 'PressableTactile usages must exist')
  for (const line of pressableTactileOpenLines) {
    assert.ok(!line.includes('toggleSaved'), `PressableTactile's own onPress must never be toggleSaved: ${line}`)
  }
})

test('Near You: featured card and secondary rows both thread navigation through to EditorialCard (needed for the sign-in prompt on a logged-out save)', () => {
  assert.ok(nearYouSource.includes('navigation = null'))
  assert.ok((nearYouSource.match(/navigation=\{navigation\}/g) ?? []).length >= 2, 'both the primary and row EditorialCard calls must pass navigation through')
})

test('What\'s Good rail cards thread navigation through to EditorialCard', () => {
  assert.ok(whatsGoodSource.includes('navigation={navigation}'))
})

test('Right Here (WhatsTheThingHero): bookmark exists, gated to non-compact mode, and positioned away from the ctaRow action row', () => {
  assert.ok(heroSource.includes("import { useSavedItems } from '../../lib/SavedItemsContext'"))
  assert.ok(heroSource.includes("import BookmarkIcon from '../BookmarkIcon'"))
  assert.ok(heroSource.includes('{!compact && (') && heroSource.includes('<BookmarkIcon'), 'bookmark must be gated to the dominant (non-compact) mode only')
  // Structural non-overlap check: the bookmark's own style (saveToggle) is
  // a distinct absolute-positioned style object from ctaRow's, and is
  // rendered as a sibling AFTER the ctaRow-containing text block in the
  // component tree, not inside ctaRow itself.
  assert.ok(!/ctaRow:\s*\{[^}]*saveToggle/.test(heroSource), 'saveToggle must not be merged into the ctaRow style')
  assert.match(heroSource, /saveToggle:\s*\{[^}]*position:\s*['"]absolute['"][^}]*top:\s*12[^}]*right:\s*12/, 'saveToggle must be its own corner-positioned style, not inline in the action row')
})

test('"Help the next person" support copy is confirmed already absent (regression guard, unchanged by this pass)', () => {
  assert.ok(!heroSource.includes('Help the next person'))
})
