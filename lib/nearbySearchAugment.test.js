import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findNormalizedExtraMatches } from './nearbySearchAugment.js'

function pool() {
  return [
    { id: '1', body: 'Try the Hüftgold plate', neighborhoodName: null, partnerName: null },
    { id: '2', body: 'Unrelated brunch spot', neighborhoodName: 'Hüftgold Heights', partnerName: null },
    { id: '3', body: 'Something else', neighborhoodName: null, partnerName: 'Café Hüftgold' },
    { id: '4', body: 'Completely unrelated', neighborhoodName: null, partnerName: null },
  ]
}

test('findNormalizedExtraMatches: recovers body/neighborhood/venue matches missed by literal ilike, from the bounded pool only', () => {
  const extras = findNormalizedExtraMatches({ pool: pool(), alreadyMatchedIds: new Set(), rawQuery: 'hueftgold' })
  const ids = extras.map(e => e.id).sort()
  assert.deepEqual(ids, ['1', '2', '3'])
})

test('findNormalizedExtraMatches: excludes ids already matched by the primary (server-side) path', () => {
  const extras = findNormalizedExtraMatches({ pool: pool(), alreadyMatchedIds: new Set(['1']), rawQuery: 'hueftgold' })
  const ids = extras.map(e => e.id).sort()
  assert.deepEqual(ids, ['2', '3'])
})

test('findNormalizedExtraMatches: no-op when the normalized query is identical to the plain lowercase (pure-ASCII query) — avoids wasted work', () => {
  const extras = findNormalizedExtraMatches({ pool: pool(), alreadyMatchedIds: new Set(), rawQuery: 'brunch' })
  assert.deepEqual(extras, [])
})

test('findNormalizedExtraMatches: never expands beyond the given pool (bounded candidate set, not full-catalog)', () => {
  const smallPool = [{ id: '1', body: 'Hüftgold', neighborhoodName: null, partnerName: null }]
  const extras = findNormalizedExtraMatches({ pool: smallPool, alreadyMatchedIds: new Set(), rawQuery: 'hueftgold' })
  assert.equal(extras.length, 1)
  assert.equal(extras[0].id, '1')
})

test('findNormalizedExtraMatches: short queries (<2 chars) never run', () => {
  assert.deepEqual(findNormalizedExtraMatches({ pool: pool(), alreadyMatchedIds: new Set(), rawQuery: 'h' }), [])
})
