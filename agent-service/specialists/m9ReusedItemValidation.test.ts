// Session 3, Phase 3 — reused-item cross-check tests.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateM9ReusedItems, type M9ReusedItemResolution } from './m9ReusedItemValidation'

const baseResolution: M9ReusedItemResolution = { candidateName: 'Pusser\'s New York Bar', conceptId: 'concept-1', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: true, metroId: 'metro-a' }

test('REUSED ITEM: zero matches fails closed (NOT_FOUND)', () => {
  const result = validateM9ReusedItems({ metroId: 'metro-a', resolutions: [{ ...baseResolution, matchedItemIds: [] }], conceptsWithUnresolvedDuplicates: new Set() })
  assert.equal(result.ok, false)
  assert.equal(result.findings[0]!.kind, 'NOT_FOUND')
  assert.deepEqual(result.resolvedItemIdByCandidateName, {})
})

test('REUSED ITEM: multiple matches fails closed (AMBIGUOUS)', () => {
  const result = validateM9ReusedItems({ metroId: 'metro-a', resolutions: [{ ...baseResolution, matchedItemIds: ['a', 'b'] }], conceptsWithUnresolvedDuplicates: new Set() })
  assert.equal(result.ok, false)
  assert.equal(result.findings[0]!.kind, 'AMBIGUOUS')
})

test('REUSED ITEM: an inactive item fails closed', () => {
  const result = validateM9ReusedItems({ metroId: 'metro-a', resolutions: [{ ...baseResolution, active: false }], conceptsWithUnresolvedDuplicates: new Set() })
  assert.equal(result.ok, false)
  assert.equal(result.findings[0]!.kind, 'INACTIVE')
})

test('REUSED ITEM: an out-of-metro item fails closed', () => {
  const result = validateM9ReusedItems({ metroId: 'metro-a', resolutions: [{ ...baseResolution, metroId: 'metro-b' }], conceptsWithUnresolvedDuplicates: new Set() })
  assert.equal(result.ok, false)
  assert.equal(result.findings[0]!.kind, 'OUT_OF_METRO')
})

test('REUSED ITEM: a concept with a still-unresolved venue duplicate fails closed, defense in depth', () => {
  const result = validateM9ReusedItems({ metroId: 'metro-a', resolutions: [baseResolution], conceptsWithUnresolvedDuplicates: new Set(['concept-1']) })
  assert.equal(result.ok, false)
  assert.equal(result.findings[0]!.kind, 'UNRESOLVED_DUPLICATE')
})

test('REUSED ITEM: a clean resolution passes and is resolved', () => {
  const result = validateM9ReusedItems({ metroId: 'metro-a', resolutions: [baseResolution], conceptsWithUnresolvedDuplicates: new Set() })
  assert.equal(result.ok, true)
  assert.equal(result.resolvedItemIdByCandidateName["Pusser's New York Bar"], '11111111-1111-1111-1111-111111111111')
})

test('REUSED ITEM: a real second regression case (Schumann\'s) — clean resolution passes independently of the first', () => {
  const schumanns: M9ReusedItemResolution = { candidateName: "Schumann's Bar", conceptId: 'concept-2', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-a' }
  const result = validateM9ReusedItems({ metroId: 'metro-a', resolutions: [baseResolution, schumanns], conceptsWithUnresolvedDuplicates: new Set() })
  assert.equal(result.ok, true)
  assert.equal(Object.keys(result.resolvedItemIdByCandidateName).length, 2)
})

test('REUSED ITEM: ONE blocking failure among several resolutions fails the WHOLE preflight, not just that one candidate', () => {
  const schumanns: M9ReusedItemResolution = { candidateName: "Schumann's Bar", conceptId: 'concept-2', matchedItemIds: [], active: true, metroId: 'metro-a' }
  const result = validateM9ReusedItems({ metroId: 'metro-a', resolutions: [baseResolution, schumanns], conceptsWithUnresolvedDuplicates: new Set() })
  assert.equal(result.ok, false)
  assert.deepEqual(result.resolvedItemIdByCandidateName, {}, 'even the otherwise-clean Pusser\'s resolution must not be resolved when ANY other resolution in the same preflight failed')
})

test('REUSED ITEM: two candidate names resolving to the same item id is advisory only, never blocking', () => {
  const a: M9ReusedItemResolution = { candidateName: 'Venue A', conceptId: 'concept-1', matchedItemIds: ['33333333-3333-3333-3333-333333333333'], active: true, metroId: 'metro-a' }
  const b: M9ReusedItemResolution = { candidateName: 'Venue B', conceptId: 'concept-1', matchedItemIds: ['33333333-3333-3333-3333-333333333333'], active: true, metroId: 'metro-a' }
  const result = validateM9ReusedItems({ metroId: 'metro-a', resolutions: [a, b], conceptsWithUnresolvedDuplicates: new Set() })
  assert.equal(result.ok, true)
  assert.ok(result.findings.some((f) => f.kind === 'MULTIPLE_CANDIDATES_SAME_ITEM' && !f.blocking))
})

test('REUSED ITEM: metroId null skips the out-of-metro check rather than silently passing an unverifiable case as safe', () => {
  const result = validateM9ReusedItems({ metroId: null, resolutions: [{ ...baseResolution, metroId: 'metro-b' }], conceptsWithUnresolvedDuplicates: new Set() })
  assert.equal(result.ok, true, 'with no real intended metroId supplied, the out-of-metro check cannot run at all — this is a documented caller responsibility, not a silent pass of a known mismatch')
})
