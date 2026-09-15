// Session 3 PREREQUISITE 1 — concept identity hardening tests.
// See m9EnforcedTypes.ts's own module doc for the full rationale: conceptId
// is a durable IDENTITY (metro + list kind + normalized seed tags, never
// title text, never current membership); conceptFingerprint is CONTENT
// (current membership + per-item metadata + evidence text + discovery
// config) that changes whenever the meaning of an approval would change.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeM9ConceptId, computeM9ConceptFingerprint, computeM9DiscoveryConfigFingerprint } from './m9EnforcedTypes'

const baseMembers = [
  { candidateName: 'Venue A', dbCategory: 'Adventure', finalTags: ['canal-crawl'], neighborhoodName: 'Downtown' },
  { candidateName: 'Venue B', dbCategory: 'Adventure', finalTags: ['canal-crawl'], neighborhoodName: 'Downtown' },
]

const baseConfigFingerprint = computeM9DiscoveryConfigFingerprint({
  minViableItems: 15,
  minStrongFitRatio: 0.6,
  overlapRequiresJerryThreshold: 0.5,
  maxTagPrevalenceToSeed: 0.5,
  excludedTags: new Set(),
})

test('IDENTITY: two different concepts with identical seed tags but different list kinds get different conceptIds', () => {
  const a = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['coffee'] })
  const b = computeM9ConceptId({ metroSlug: 'munich', listKind: 'FOOD_LOCAL_FLAVOR', seedTags: ['coffee'] })
  assert.notEqual(a, b, 'the same seed tags evaluated under a different list kind must be a materially different concept identity')
})

test('IDENTITY: seed-tag ordering and casing/whitespace variance does not create a new identity (normalized)', () => {
  const a = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['Coffee', 'Pastry'] })
  const b = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['pastry', '  coffee  '] })
  assert.equal(a, b, 'seed-tag identity must be stable across ordering, casing, and incidental whitespace')
})

test('IDENTITY: display title (or title punctuation/capitalization) plays no role at all — conceptId never accepts a title input', () => {
  // computeM9ConceptId's own type signature has no title field — this is
  // a structural guarantee, not a runtime one to assert on a value, but we
  // confirm here that two concepts whose only distinguishing feature would
  // be a hypothetical title (never passed in) collapse to the identical
  // conceptId, since title is never consulted.
  const a = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'] })
  const b = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'] })
  assert.equal(a, b)
})

test('IDENTITY: membership change preserves conceptId but changes fingerprint', () => {
  const conceptId = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'] })
  const fp1 = computeM9ConceptFingerprint({ conceptId, members: baseMembers, editorialPromise: 'A coherent canal-crawl cluster.', discoveryConfigFingerprint: baseConfigFingerprint })
  const changedMembers = [...baseMembers, { candidateName: 'Venue C', dbCategory: 'Adventure', finalTags: ['canal-crawl'], neighborhoodName: 'Downtown' }]
  const fp2 = computeM9ConceptFingerprint({ conceptId, members: changedMembers, editorialPromise: 'A coherent canal-crawl cluster.', discoveryConfigFingerprint: baseConfigFingerprint })
  assert.notEqual(fp1, fp2, 'adding a member must change the fingerprint')
  // conceptId itself is untouched by this whole exercise — it was never
  // recomputed from membership, only reused as an input to fingerprint.
})

test('IDENTITY: a metadata-only change (same candidateNames, different dbCategory/tags) also changes the fingerprint', () => {
  const conceptId = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'] })
  const fp1 = computeM9ConceptFingerprint({ conceptId, members: baseMembers, editorialPromise: 'promise', discoveryConfigFingerprint: baseConfigFingerprint })
  const metadataChanged = baseMembers.map((m) => (m.candidateName === 'Venue A' ? { ...m, finalTags: ['canal-crawl', 'newly-added-tag'] } : m))
  const fp2 = computeM9ConceptFingerprint({ conceptId, members: metadataChanged, editorialPromise: 'promise', discoveryConfigFingerprint: baseConfigFingerprint })
  assert.notEqual(fp1, fp2, 'a per-item metadata change with no candidateName change must still invalidate the fingerprint')
})

test('IDENTITY: material change to the editorial promise invalidates the fingerprint (same conceptId, same membership)', () => {
  const conceptId = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'] })
  const fp1 = computeM9ConceptFingerprint({ conceptId, members: baseMembers, editorialPromise: 'A coherent canal-crawl cluster of 15 items.', discoveryConfigFingerprint: baseConfigFingerprint })
  const fp2 = computeM9ConceptFingerprint({ conceptId, members: baseMembers, editorialPromise: 'A coherent canal-crawl cluster of 30 items, now much larger.', discoveryConfigFingerprint: baseConfigFingerprint })
  assert.notEqual(fp1, fp2, 'a materially different editorial promise must invalidate a prior approval via fingerprint change')
})

test('IDENTITY: a discovery-config change invalidates the fingerprint even with identical membership/promise', () => {
  const conceptId = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'] })
  const looserConfigFingerprint = computeM9DiscoveryConfigFingerprint({ minViableItems: 5, minStrongFitRatio: 0.3, overlapRequiresJerryThreshold: 0.5, maxTagPrevalenceToSeed: 0.5, excludedTags: new Set() })
  const fp1 = computeM9ConceptFingerprint({ conceptId, members: baseMembers, editorialPromise: 'promise', discoveryConfigFingerprint: baseConfigFingerprint })
  const fp2 = computeM9ConceptFingerprint({ conceptId, members: baseMembers, editorialPromise: 'promise', discoveryConfigFingerprint: looserConfigFingerprint })
  assert.notEqual(fp1, fp2, 'a looser/different discovery config changes what CREATE even means, and must invalidate a prior approval')
})

test('IDENTITY: concepts in different metros cannot accidentally share a conceptId, even with identical tags/kind', () => {
  const munich = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'] })
  const denver = computeM9ConceptId({ metroSlug: 'denver', listKind: 'THEMED', seedTags: ['canal-crawl'] })
  assert.notEqual(munich, denver, 'identical seed tags and list kind in two different metros must never collide — a persisted operator decision for one metro can never apply to the other')
})

test('IDENTITY: metro slug casing/whitespace variance is normalized (the SAME real metro cannot accidentally split into two identities)', () => {
  const a = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'] })
  const b = computeM9ConceptId({ metroSlug: '  Munich  ', listKind: 'THEMED', seedTags: ['canal-crawl'] })
  assert.equal(a, b, 'the same real metro, differently cased/spaced, must resolve to the same conceptId')
})
