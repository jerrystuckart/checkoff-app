import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectSeedDuplicateClusters, candidateNamesInAnyCluster } from './seedDuplicateNormalization'

test('seed duplicate normalization: same Google Place ID flagged as a cluster', () => {
  const clusters = detectSeedDuplicateClusters([
    { name: 'Blue Door Tavern', placeId: 'place-1', claimSupported: 'Try the smoked old fashioned at the bar' },
    { name: 'Blue Door Tavern (Patio)', placeId: 'place-1', claimSupported: 'Sit on the heated patio in winter' },
  ])
  const placeIdCluster = clusters.find((c) => c.reason === 'SAME_PLACE_ID')
  assert.ok(placeIdCluster)
  assert.equal(placeIdCluster!.members.length, 2)
})

test('seed duplicate normalization: normalized-name match (case/punctuation/unicode insensitive)', () => {
  const clusters = detectSeedDuplicateClusters([
    { name: "Café Müller", claimSupported: 'Order the daily pastry special' },
    { name: 'CAFE MULLER', claimSupported: 'Try the espresso at the counter' },
  ])
  const nameCluster = clusters.find((c) => c.reason === 'SAME_NORMALIZED_NAME')
  assert.ok(nameCluster)
  assert.equal(nameCluster!.members.length, 2)
})

test('seed duplicate normalization: same address, different names — flagged, never merged', () => {
  const clusters = detectSeedDuplicateClusters([
    { name: 'Counter A', address: '123 Main St', claimSupported: 'Order the ramen counter tasting menu' },
    { name: 'Counter B', address: '123 Main St', claimSupported: 'Buy vinyl records from the record shop upstairs' },
  ])
  const addressCluster = clusters.find((c) => c.reason === 'SAME_ADDRESS')
  assert.ok(addressCluster)
  // Never auto-decides — always reports similarity stats for a human to review, does not resolve.
  assert.equal(typeof addressCluster!.minPairwiseSimilarity, 'number')
})

test('seed duplicate normalization: valid multiple-experiences-at-one-venue is flagged, not auto-merged or auto-dropped', () => {
  const clusters = detectSeedDuplicateClusters([
    { name: 'Warehouse Market — Ramen Counter', placeId: 'p1', claimSupported: 'Slurp tonkotsu ramen at the 8-seat counter' },
    { name: 'Warehouse Market — Vinyl Stand', placeId: 'p1', claimSupported: 'Dig through crates of rare vinyl records' },
  ])
  assert.equal(clusters.length > 0, true)
  // The module never returns a verdict/decision field — it only reports, confirming it never auto-resolves.
  for (const c of clusters) {
    assert.equal('verdict' in c, false)
  }
})

test('seed duplicate normalization: no false clusters for genuinely distinct candidates', () => {
  const clusters = detectSeedDuplicateClusters([
    { name: 'Riverside Bakery', address: '1 River Rd', claimSupported: 'Try the sourdough loaf baked fresh each morning' },
    { name: 'Mountain Trailhead', address: '99 Peak Way', claimSupported: 'Hike the 4-mile summit loop trail' },
  ])
  assert.equal(clusters.length, 0)
})

test('seed duplicate normalization: candidateNamesInAnyCluster aggregates across cluster kinds', () => {
  const clusters = detectSeedDuplicateClusters([
    { name: 'Spot A', placeId: 'p9', claimSupported: 'One experience' },
    { name: 'Spot A Copy', placeId: 'p9', claimSupported: 'Same experience restated' },
    { name: 'Unrelated', claimSupported: 'Something else entirely' },
  ])
  const names = candidateNamesInAnyCluster(clusters)
  assert.equal(names.has('Spot A'), true)
  assert.equal(names.has('Unrelated'), false)
})
