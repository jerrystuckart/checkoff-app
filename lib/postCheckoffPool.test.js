import test from 'node:test'
import assert from 'node:assert/strict'
import { candidateNeighborhoodIds } from './postCheckoffPool.js'

test('a regular metro keeps using every neighborhood of the metro', () => {
  assert.deepEqual(candidateNeighborhoodIds({ metroId: 'm1', metroNeighborhoodIds: ['a', 'b', 'c'], neighborhoodId: 'a' }), ['a', 'b', 'c'])
  assert.deepEqual(candidateNeighborhoodIds({ metroId: 'm1', metroNeighborhoodIds: undefined, neighborhoodId: 'a' }), [])
})
test('a Destination Hub neighborhood with no metro (Willcox) uses its own neighborhood', () => {
  assert.deepEqual(candidateNeighborhoodIds({ metroId: null, metroNeighborhoodIds: [], neighborhoodId: 'willcox' }), ['willcox'])
})
test('nothing to anchor on gives no candidates', () => {
  assert.deepEqual(candidateNeighborhoodIds({ metroId: null, metroNeighborhoodIds: [], neighborhoodId: null }), [])
})
