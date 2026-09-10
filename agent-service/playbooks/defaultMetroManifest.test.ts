import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CATEGORY_COVERAGE_PLAN, deriveDefaultDepthTargets } from './defaultMetroManifest'
import type { NeighborhoodDefinition } from './metroLaunch'

const SAN_DIEGO_PLACE_NAMES = ['carlsbad', 'oceanside', 'chula vista', 'coronado']

test('deriveDefaultDepthTargets: derives floors ONLY from the neighborhoods actually passed in — can never inject a hardcoded other-metro name', () => {
  const greenBayNeighborhoods: NeighborhoodDefinition[] = [
    { name: 'Downtown Green Bay', kind: 'core_urban', ring1RadiusM: 1000, ring2RadiusM: 3000 },
    { name: 'Ashwaubenon', kind: 'important_neighborhood', ring1RadiusM: 1500, ring2RadiusM: 4000 },
    { name: 'Suamico', kind: 'suburb', ring1RadiusM: 2000, ring2RadiusM: 5000 },
  ]
  const targets = deriveDefaultDepthTargets(greenBayNeighborhoods)

  assert.equal(targets.length, 3)
  const names = targets.map((t) => t.neighborhoodName.toLowerCase())
  for (const forbidden of SAN_DIEGO_PLACE_NAMES) {
    assert.ok(!names.includes(forbidden), `deriveDefaultDepthTargets must never produce "${forbidden}" — it should only ever reflect the input neighborhoods`)
  }
  assert.deepEqual(new Set(names), new Set(['downtown green bay', 'ashwaubenon', 'suamico']))
})

test('deriveDefaultDepthTargets: an empty neighborhood list (M1 not yet run, or a metro with none) produces an empty result, never a fallback list', () => {
  assert.deepEqual(deriveDefaultDepthTargets([]), [])
})

test('deriveDefaultDepthTargets: minimums vary by neighborhood kind, core_urban strictest', () => {
  const neighborhoods: NeighborhoodDefinition[] = [
    { name: 'Core', kind: 'core_urban', ring1RadiusM: 1000, ring2RadiusM: 3000 },
    { name: 'Outer', kind: 'destination_worthy_outer', ring1RadiusM: 1000, ring2RadiusM: 3000 },
  ]
  const targets = deriveDefaultDepthTargets(neighborhoods)
  const core = targets.find((t) => t.neighborhoodName === 'Core')!
  const outer = targets.find((t) => t.neighborhoodName === 'Outer')!
  assert.ok(core.minimumItems > outer.minimumItems, 'a core_urban neighborhood should get a stricter floor than a destination_worthy_outer one')
})

test('DEFAULT_CATEGORY_COVERAGE_PLAN: is metro-agnostic — no place names anywhere in its category names or quality notes', () => {
  const serialized = JSON.stringify(DEFAULT_CATEGORY_COVERAGE_PLAN).toLowerCase()
  for (const forbidden of ['san diego', 'carlsbad', 'oceanside', 'chula vista', 'coronado', 'la jolla']) {
    assert.ok(!serialized.includes(forbidden), `DEFAULT_CATEGORY_COVERAGE_PLAN must never mention "${forbidden}"`)
  }
  assert.ok(DEFAULT_CATEGORY_COVERAGE_PLAN.targets.length > 0)
})
