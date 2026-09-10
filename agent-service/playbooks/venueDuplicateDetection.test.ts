import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clusterByPlaceId, buildVenueClusterReviewNotes } from './venueDuplicateDetection'

test('clusterByPlaceId: groups only members sharing a non-null placeId', () => {
  const clusters = clusterByPlaceId([
    { candidateName: 'Vienna State Opera', placeId: 'p1', finalBody: 'a' },
    { candidateName: 'Wiener Staatsoper', placeId: 'p1', finalBody: 'b' },
    { candidateName: 'St. Stephens Cathedral', placeId: 'p2', finalBody: 'c' },
    { candidateName: 'Unrelated place', placeId: null, finalBody: 'd' },
  ])
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].placeId, 'p1')
  assert.deepEqual(
    clusters[0].members.map((m) => m.candidateName),
    ['Vienna State Opera', 'Wiener Staatsoper']
  )
})

test('clusterByPlaceId: does not merge two different real venues (Bezirksmuseum Währing vs Meidling case)', () => {
  const clusters = clusterByPlaceId([
    { candidateName: 'Bezirksmuseum Währing', placeId: 'p-waehring', finalBody: 'a' },
    { candidateName: 'Bezirksmuseum Meidling', placeId: 'p-meidling', finalBody: 'b' },
  ])
  assert.equal(clusters.length, 0)
})

test('clusterByPlaceId: singleton placeId groups are never reported', () => {
  const clusters = clusterByPlaceId([{ candidateName: 'Solo Venue', placeId: 'p3', finalBody: 'a' }])
  assert.equal(clusters.length, 0)
})

test('buildVenueClusterReviewNotes: never a keep/drop decision — a review prompt only', () => {
  const notes = buildVenueClusterReviewNotes([
    { placeId: 'p1', members: [{ candidateName: 'A', placeId: 'p1', finalBody: null }, { candidateName: 'B', placeId: 'p1', finalBody: null }] },
  ])
  assert.equal(notes.length, 1)
  assert.deepEqual(notes[0].candidateNames, ['A', 'B'])
  assert.match(notes[0].reviewPrompt, /keep the stronger one|keep them all/)
})
