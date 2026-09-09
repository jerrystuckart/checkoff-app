import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveTagShortlist, DEFAULT_MIN_SHORTLIST, DEFAULT_MAX_SHORTLIST } from './tagShortlist'

const VOCAB = [
  'coffee',
  'coffeehouse',
  'historic',
  'live music',
  'family friendly',
  'outdoor',
  'museum',
  'hidden gem',
  'wine',
  'dessert',
  'art',
  'classical music',
  'palace',
  'garden',
  'unrelated tag one',
  'unrelated tag two',
  'unrelated tag three',
  'unrelated tag four',
  'unrelated tag five',
  'unrelated tag six',
  'unrelated tag seven',
  'unrelated tag eight',
  'unrelated tag nine',
  'unrelated tag ten',
  'unrelated tag eleven',
  'unrelated tag twelve',
  'unrelated tag thirteen',
  'unrelated tag fourteen',
  'unrelated tag fifteen',
]

test('deriveTagShortlist: ranks tags whose words actually appear in the item text above unrelated tags', () => {
  const shortlist = deriveTagShortlist(
    VOCAB,
    { category: 'Coffeehouse culture', body: "Order the 'Sperl Torte' at 'Cafe Sperl', a historic Vienna coffeehouse.", claimSupported: 'Cafe Sperl is a historic coffeehouse dating to 1880.' },
    10,
    0
  )
  assert.ok(shortlist.includes('coffee'))
  assert.ok(shortlist.includes('coffeehouse'))
  assert.ok(shortlist.includes('historic'))
  assert.ok(!shortlist.includes('unrelated tag one'))
})

test('deriveTagShortlist: the category name itself is always included when present in the vocabulary', () => {
  const shortlist = deriveTagShortlist(['museum', 'unrelated'], { category: 'museum', body: 'x', claimSupported: 'y' }, 10, 0)
  assert.ok(shortlist.includes('museum'))
})

test('deriveTagShortlist: substring credit — "coffee" scores from "coffeehouse" appearing in the text even without an exact word match', () => {
  const shortlist = deriveTagShortlist(['coffee', 'unrelated'], { category: null, body: 'A classic Viennese coffeehouse experience.', claimSupported: '' }, 5, 0)
  assert.ok(shortlist.includes('coffee'))
})

test('deriveTagShortlist: never returns more than maxShortlist entries', () => {
  const bigVocab = Array.from({ length: 200 }, (_, i) => `tag-${i}`)
  const shortlist = deriveTagShortlist(bigVocab, { category: null, body: 'tag-1 tag-2 tag-3', claimSupported: '' }, 15)
  assert.ok(shortlist.length <= 15)
})

test('deriveTagShortlist: pads with real vocabulary names (never invents) when too few tags score above zero, up to minShortlist', () => {
  const shortlist = deriveTagShortlist(VOCAB, { category: null, body: 'zzz', claimSupported: 'zzz' }, DEFAULT_MAX_SHORTLIST, 12)
  assert.ok(shortlist.length >= 12)
  for (const t of shortlist) assert.ok(VOCAB.includes(t), `padded entry "${t}" must be a real vocabulary name`)
})

test('deriveTagShortlist: default bounds are sane (min < max, both positive)', () => {
  assert.ok(DEFAULT_MIN_SHORTLIST > 0)
  assert.ok(DEFAULT_MAX_SHORTLIST > DEFAULT_MIN_SHORTLIST)
})

test('deriveTagShortlist: is deterministic — same inputs produce the same output every time', () => {
  const ctx = { category: 'Coffeehouse culture', body: 'A historic coffeehouse.', claimSupported: 'Since 1880.' }
  const a = deriveTagShortlist(VOCAB, ctx)
  const b = deriveTagShortlist(VOCAB, ctx)
  assert.deepEqual(a, b)
})

test('deriveTagShortlist: neighborhood text also contributes to scoring', () => {
  const shortlist = deriveTagShortlist(['garden', 'unrelated'], { category: null, body: 'x', claimSupported: 'y', neighborhood: 'Schönbrunn Garden district' }, 5, 0)
  assert.ok(shortlist.includes('garden'))
})
