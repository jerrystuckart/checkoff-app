import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitWhatsGoodDisplayLayout, isSpecialItemPresentation } from './whatsGoodDisplayLayout.js'

test('3 items: first is primary, remaining 2 are secondary — all 3 accounted for, none dropped', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const { primary, secondary } = splitWhatsGoodDisplayLayout(items)
  assert.equal(primary.id, 'a')
  assert.deepEqual(secondary.map(i => i.id), ['b', 'c'])
})

test('2 items (genuine shortage): primary + 1 secondary, no invented third', () => {
  const items = [{ id: 'a' }, { id: 'b' }]
  const { primary, secondary } = splitWhatsGoodDisplayLayout(items)
  assert.equal(primary.id, 'a')
  assert.deepEqual(secondary.map(i => i.id), ['b'])
})

test('1 item: primary only, empty secondary array (not null)', () => {
  const { primary, secondary } = splitWhatsGoodDisplayLayout([{ id: 'a' }])
  assert.equal(primary.id, 'a')
  assert.deepEqual(secondary, [])
})

test('0 items: null primary, empty secondary', () => {
  const { primary, secondary } = splitWhatsGoodDisplayLayout([])
  assert.equal(primary, null)
  assert.deepEqual(secondary, [])
})

test('undefined/null items array is treated as empty, never throws', () => {
  assert.deepEqual(splitWhatsGoodDisplayLayout(undefined), { primary: null, secondary: [] })
  assert.deepEqual(splitWhatsGoodDisplayLayout(null), { primary: null, secondary: [] })
})

test('more than 3 items: only ever surfaces primary + first 2 secondary (defensive; upstream already caps at 3)', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const { primary, secondary } = splitWhatsGoodDisplayLayout(items)
  assert.equal(primary.id, 'a')
  assert.deepEqual(secondary.map(i => i.id), ['b', 'c'])
})

// DEFAULT HOME "WOW" PASS (2026-09-03): presentation-order image
// preference within the already-selected 3 — the SET never changes, only
// which one displays as the large primary hero.

test('top pick already has an image: unchanged, still primary (no unnecessary reorder)', () => {
  const items = [{ id: 'a', photo_url: 'https://x/a.jpg' }, { id: 'b' }, { id: 'c' }]
  const { primary, secondary } = splitWhatsGoodDisplayLayout(items)
  assert.equal(primary.id, 'a')
  assert.deepEqual(secondary.map(i => i.id), ['b', 'c'])
})

test('top pick has no image but a later item does: that item becomes primary, others stay secondary in original relative order', () => {
  const items = [{ id: 'a' }, { id: 'b', photo_url: 'https://x/b.jpg' }, { id: 'c' }]
  const { primary, secondary } = splitWhatsGoodDisplayLayout(items)
  assert.equal(primary.id, 'b')
  assert.deepEqual(secondary.map(i => i.id), ['a', 'c'])
})

test('image on the third item: that one becomes primary', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c', activeCoverImageUrl: 'https://x/c.jpg' }]
  const { primary, secondary } = splitWhatsGoodDisplayLayout(items)
  assert.equal(primary.id, 'c')
  assert.deepEqual(secondary.map(i => i.id), ['a', 'b'])
})

test('none of the 3 has an image: falls back to items[0] as primary, exactly as before', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const { primary, secondary } = splitWhatsGoodDisplayLayout(items)
  assert.equal(primary.id, 'a')
  assert.deepEqual(secondary.map(i => i.id), ['b', 'c'])
})

test('image preference never changes the SET of 3 items — only which one is primary', () => {
  const items = [{ id: 'a' }, { id: 'b', photo_url: 'https://x/b.jpg' }, { id: 'c' }]
  const { primary, secondary } = splitWhatsGoodDisplayLayout(items)
  const allIds = [primary.id, ...secondary.map(i => i.id)].sort()
  assert.deepEqual(allIds, ['a', 'b', 'c'])
})

test('isSpecialItemPresentation reads existing is_secret/isSecret without inventing a new classification', () => {
  assert.equal(isSpecialItemPresentation({ is_secret: true }), true)
  assert.equal(isSpecialItemPresentation({ isSecret: true }), true)
  assert.equal(isSpecialItemPresentation({ is_secret: false }), false)
  assert.equal(isSpecialItemPresentation({}), false)
  assert.equal(isSpecialItemPresentation(null), false)
})
