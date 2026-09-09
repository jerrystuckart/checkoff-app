import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeSearchMatchCounts } from './searchMatch.js'

// Regression coverage for the House of Honey discoverability bug: typed
// search must never let an unrelated tag-name match hide an item whose own
// body text matches the query.

test('an item with no tag match but a body-text match still appears (count 0)', () => {
  // "House" matches tags like "steakhouse"/"lighthouse", none of which
  // House of Honey carries — but its body text contains "House of Honey".
  const tagItemRows = [
    { item_id: 'steakhouse-item', tag_id: 'steakhouse-tag' },
    { item_id: 'lighthouse-item', tag_id: 'lighthouse-tag' },
  ]
  const bodyMatchIds = ['house-of-honey-item']
  const counts = mergeSearchMatchCounts(tagItemRows, bodyMatchIds)

  assert.equal(counts['house-of-honey-item'], 0, 'body-only match must be present with count 0, not omitted')
  assert.equal(counts['steakhouse-item'], 1)
  assert.equal(counts['lighthouse-item'], 1)
})

test('an item matching both a tag and the body text keeps its tag count (not reset to 0)', () => {
  const tagItemRows = [{ item_id: 'both-item', tag_id: 'some-tag' }]
  const bodyMatchIds = ['both-item']
  const counts = mergeSearchMatchCounts(tagItemRows, bodyMatchIds)
  assert.equal(counts['both-item'], 1)
})

test('multiple tag matches on the same item accumulate before the body merge', () => {
  const tagItemRows = [
    { item_id: 'multi-tag-item', tag_id: 'tag-a' },
    { item_id: 'multi-tag-item', tag_id: 'tag-b' },
  ]
  const counts = mergeSearchMatchCounts(tagItemRows, [])
  assert.equal(counts['multi-tag-item'], 2)
})

test('no matches at all yields an empty map, not a nationwide/undefined result', () => {
  assert.deepEqual(mergeSearchMatchCounts([], []), {})
  assert.deepEqual(mergeSearchMatchCounts(undefined, undefined), {})
})

test('"honey" search style: zero tag matches, body matches still populate the result set', () => {
  // Mirrors the real repro: no tag named "honey" exists, but several items
  // mention honey in their body text and must all surface.
  const counts = mergeSearchMatchCounts([], ['house-of-honey', 'blue-rooster-produce', 'rayoog-cafe'])
  assert.deepEqual(Object.keys(counts).sort(), ['blue-rooster-produce', 'house-of-honey', 'rayoog-cafe'])
  assert.ok(Object.values(counts).every(c => c === 0))
})
