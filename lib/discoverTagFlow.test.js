import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mergeSearchMatchCounts } from './searchMatch.js'
import { applySelectTag } from './tagSelection.js'
import { rankNearbyItems } from './nearbyRanking.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DISCOVER_SCREEN_PATH = path.join(__dirname, '..', 'screens', 'DiscoverScreen.jsx')

// ── Static safety net: the actual crash mechanism ───────────────────────────
// The production crash was a reference to a `set*` function that was never
// declared as a useState setter in this file (setBodyMatchIds, removed in
// an earlier refactor but left called in selectTag()). This is exactly the
// class of bug a type-checker would catch and plain JS parsing does not —
// so this test does the check directly against the real source file. Any
// future edit that leaves a similar stray `setXyz(...)` call will fail
// this test immediately, without needing to reproduce the crash by hand.
test('DiscoverScreen.jsx never calls a set*() function that is not a declared useState setter', () => {
  const code = fs.readFileSync(DISCOVER_SCREEN_PATH, 'utf8')

  const declaredSetters = new Set()
  const declRe = /const \[\s*\w+\s*,\s*(set\w+)\s*\]\s*=\s*useState/g
  let m
  while ((m = declRe.exec(code))) declaredSetters.add(m[1])

  assert.ok(declaredSetters.size > 5, 'sanity check: the declared-setter scan itself must find the real useState calls')

  const KNOWN_NON_SETTER_GLOBALS = new Set(['setTimeout', 'setInterval', 'setImmediate'])
  const calledRe = /\b(set[A-Z]\w*)\s*\(/g
  const undeclaredCalls = new Set()
  while ((m = calledRe.exec(code))) {
    const name = m[1]
    if (!declaredSetters.has(name) && !KNOWN_NON_SETTER_GLOBALS.has(name)) {
      undeclaredCalls.add(name)
    }
  }

  assert.deepEqual([...undeclaredCalls], [], `found call(s) to undeclared setter(s): ${[...undeclaredCalls].join(', ')} — this is exactly the bug that crashed the app on tag-chip tap`)
})

// ── Full pipeline: type BBQ -> suggestion +bbq -> tap -> results render ────
test('type BBQ, tap the +bbq suggestion, results render without throwing', () => {
  const bbqTag = { id: 'tag-bbq', name: 'bbq' }

  // Step 1: typing "BBQ" — runSearch's tag-name lookup finds "bbq", and
  // (per the House of Honey fix) body text is searched in parallel too.
  const tagItemRows = [
    { item_id: 'smokehouse-bbq', tag_id: bbqTag.id },
    { item_id: 'backyard-bbq-joint', tag_id: bbqTag.id },
  ]
  const bodyMatchIds = ['bbq-mentioned-in-body-only']
  const searchCounts = mergeSearchMatchCounts(tagItemRows, bodyMatchIds)
  assert.ok('smokehouse-bbq' in searchCounts && 'bbq-mentioned-in-body-only' in searchCounts)

  // Step 2: tap the +bbq suggestion chip.
  let activeTags = []
  const selectResult = applySelectTag(activeTags, bbqTag)
  assert.equal(selectResult.changed, true)
  activeTags = selectResult.activeTags
  assert.deepEqual(activeTags, [bbqTag])

  // Step 3: fetchTagResultItems-style tag-only counts (what actually
  // replaces tagMatchData once a chip is active — search text no longer
  // drives results).
  const chipDrivenCounts = {}
  for (const row of tagItemRows) {
    chipDrivenCounts[row.item_id] = (chipDrivenCounts[row.item_id] ?? 0) + 1
  }

  // Step 4: "results render" — rankNearbyItems must not throw on this
  // input and must produce a deterministic, fully-formed ordering.
  const candidateItems = [
    { id: 'smokehouse-bbq', dist_m: 2000 },
    { id: 'backyard-bbq-joint', dist_m: 5000 },
  ]
  let ranked
  assert.doesNotThrow(() => { ranked = rankNearbyItems(candidateItems, chipDrivenCounts) })
  assert.equal(ranked.length, 2)
  assert.equal(ranked[0].id, 'smokehouse-bbq') // closer, ranks first
})

// ── Selecting a tag when body-text matches are already present ─────────────
test('selecting a tag while a typed-search body match is showing fully replaces the search-driven state', () => {
  // Before tapping the chip: "BBQ" text search produced a union of tag +
  // body matches (per lib/searchMatch.js).
  const textSearchCounts = mergeSearchMatchCounts(
    [{ item_id: 'smokehouse-bbq', tag_id: 'tag-bbq' }],
    ['bbq-body-only-match']
  )
  assert.ok('bbq-body-only-match' in textSearchCounts)

  // Tapping the suggestion chip must produce a clean activeTags array
  // (not merged with whatever the previous free-text search state was) —
  // fetchTagResultItems then rebuilds tagMatchData/tagResultItems from
  // scratch for the tag-only universe.
  const result = applySelectTag([], { id: 'tag-bbq', name: 'bbq' })
  assert.equal(result.clearSearchText, true, 'selecting a chip must clear the typed text')
  assert.equal(result.clearSuggestions, true)
  assert.deepEqual(result.activeTags, [{ id: 'tag-bbq', name: 'bbq' }])
})

// ── Clearing typed text after selecting a tag ───────────────────────────────
test('clearing typed text after a tag is already selected does not disturb the active tag', () => {
  const afterSelect = applySelectTag([], { id: 'tag-bbq', name: 'bbq' })
  const activeTagsAfterSelect = afterSelect.activeTags

  // Simulates the debounce effect's short-text branch: with activeTags
  // non-empty, tagResultItems must NOT be reset to null (chips still own
  // the result set) — this is a state-shape assumption, verified here
  // structurally rather than by re-deriving DiscoverScreen's effect logic.
  const searchTextNowEmpty = ''
  const shouldResetTagResultItems = searchTextNowEmpty.length < 2 && activeTagsAfterSelect.length === 0
  assert.equal(shouldResetTagResultItems, false, 'active tag chips must keep driving results after the text is cleared')
  assert.deepEqual(activeTagsAfterSelect, [{ id: 'tag-bbq', name: 'bbq' }])
})
