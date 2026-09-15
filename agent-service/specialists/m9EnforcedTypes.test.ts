// Session 3 PREREQUISITE 1 — concept identity hardening tests, extended
// (same session, follow-up) after a confirmed live collision report: two
// simultaneous concepts in the same metro, same listKind, same normalized
// seedTags, but different editorial promises and different proposed
// memberships DID collide under the original v2 scheme (metro + listKind
// + tags only). Fixed by promoting editorialPromise into identity (v3) —
// see m9EnforcedTypes.ts's own module doc for the full rationale and why
// this does not break "membership changes preserve conceptId" (in every
// real discovery call this codebase makes, editorialPromise is a pure
// function of seedTags alone, never of membership).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeM9ConceptId, computeM9ConceptKey, computeM9ConceptFingerprint, computeM9DiscoveryConfigFingerprint } from './m9EnforcedTypes'

const PROMISE_A = 'A coherent set of experiences sharing "beer-garden" + "brewery" — discovered from real tag co-occurrence in the certified catalog, not a predefined template.'

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

// ---------------------------------------------------------------------------
// The exact regression scenario reported: same metro, same listKind, same
// normalized seedTags, different editorial promises, different proposed
// memberships, evaluated "simultaneously" (i.e. as two independent
// identity computations, not sequential reruns of the same concept).
// ---------------------------------------------------------------------------

test('REGRESSION: two simultaneous concepts — same metro, same listKind, same normalized seedTags, different editorial promise, different membership — receive DIFFERENT conceptIds', () => {
  const conceptOne = {
    metroSlug: 'munich',
    listKind: 'FOOD_LOCAL_FLAVOR',
    seedTags: ['beer-garden', 'brewery'],
    editorialPromise: 'A coherent set of experiences sharing "beer-garden" + "brewery" — the real Bavarian beer-garden-and-brewery cluster, centered on communal long-table seating and self-serve Steins.',
  }
  const conceptTwo = {
    metroSlug: 'munich',
    listKind: 'FOOD_LOCAL_FLAVOR',
    seedTags: ['beer-garden', 'brewery'],
    editorialPromise: 'A coherent set of experiences sharing "beer-garden" + "brewery" — a DIFFERENT proposed cluster: brewery TOURS and tasting flights specifically, not communal beer-garden seating.',
  }

  const idOne = computeM9ConceptId(conceptOne)
  const idTwo = computeM9ConceptId(conceptTwo)

  assert.notEqual(idOne, idTwo, 'two concepts that differ only in editorial promise (same metro/listKind/seedTags) must never collide under one conceptId')

  // Different proposed memberships for each — fingerprints must also
  // differ (expected — different conceptId means an entirely separate
  // fingerprint namespace; this just confirms nothing downstream
  // accidentally conflates the two).
  const membersOne = [{ candidateName: 'Hofbräukeller', dbCategory: 'Adventure', finalTags: ['beer-garden'], neighborhoodName: 'Haidhausen' }]
  const membersTwo = [{ candidateName: 'Giesinger Bräu Tour', dbCategory: 'Adventure', finalTags: ['brewery'], neighborhoodName: 'Giesing' }]
  const fpOne = computeM9ConceptFingerprint({ conceptId: idOne, members: membersOne, discoveryConfigFingerprint: baseConfigFingerprint })
  const fpTwo = computeM9ConceptFingerprint({ conceptId: idTwo, members: membersTwo, discoveryConfigFingerprint: baseConfigFingerprint })
  assert.notEqual(fpOne, fpTwo)

  // Both concepts nonetheless share the SAME tag-territory key — a human
  // reading conceptKey can see they're two proposals over the same
  // territory, even though their durable identities are distinct.
  assert.equal(computeM9ConceptKey(conceptOne.seedTags), computeM9ConceptKey(conceptTwo.seedTags))
})

test('IDENTITY: two different concepts with identical seed tags but different list kinds get different conceptIds', () => {
  const a = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['coffee'], editorialPromise: PROMISE_A })
  const b = computeM9ConceptId({ metroSlug: 'munich', listKind: 'FOOD_LOCAL_FLAVOR', seedTags: ['coffee'], editorialPromise: PROMISE_A })
  assert.notEqual(a, b, 'the same seed tags evaluated under a different list kind must be a materially different concept identity')
})

test('IDENTITY: seed-tag ordering and casing/whitespace variance does not create a new identity (normalized)', () => {
  const a = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['Coffee', 'Pastry'], editorialPromise: PROMISE_A })
  const b = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['pastry', '  coffee  '], editorialPromise: PROMISE_A })
  assert.equal(a, b, 'seed-tag identity must be stable across ordering, casing, and incidental whitespace')
})

test('IDENTITY: display title (or title punctuation/capitalization) plays no role at all — conceptId never accepts a title input', () => {
  // computeM9ConceptId's own type signature has no title field — this is
  // a structural guarantee, not a runtime one to assert on a value, but we
  // confirm here that two concepts whose only distinguishing feature would
  // be a hypothetical title (never passed in) collapse to the identical
  // conceptId, since title is never consulted.
  const a = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: PROMISE_A })
  const b = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: PROMISE_A })
  assert.equal(a, b)
})

test('IDENTITY: same semantic concept (same tags, same promise) with title wording changes retains its conceptId — title is irrelevant either way', () => {
  // Title is never an input to computeM9ConceptId at all — simulated here
  // by computing the SAME concept twice with two different hypothetical
  // titles never even passed in, confirming there is no way for title
  // wording to perturb identity.
  const id1 = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: PROMISE_A })
  const id2 = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: PROMISE_A })
  assert.equal(id1, id2, 'identical tags/promise must produce the identical conceptId regardless of any title text a caller might display alongside it')
})

test('IDENTITY: same concept with membership changes retains its conceptId and changes fingerprint', () => {
  const conceptId = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: PROMISE_A })
  const conceptIdAfter = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: PROMISE_A })
  assert.equal(conceptId, conceptIdAfter, 'conceptId must be unaffected by anything membership-related — it is never even an input to computeM9ConceptId')

  const fp1 = computeM9ConceptFingerprint({ conceptId, members: baseMembers, discoveryConfigFingerprint: baseConfigFingerprint })
  const changedMembers = [...baseMembers, { candidateName: 'Venue C', dbCategory: 'Adventure', finalTags: ['canal-crawl'], neighborhoodName: 'Downtown' }]
  const fp2 = computeM9ConceptFingerprint({ conceptId, members: changedMembers, discoveryConfigFingerprint: baseConfigFingerprint })
  assert.notEqual(fp1, fp2, 'adding a member must change the fingerprint')
})

test('IDENTITY: a metadata-only change (same candidateNames, different dbCategory/tags) also changes the fingerprint', () => {
  const conceptId = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: PROMISE_A })
  const fp1 = computeM9ConceptFingerprint({ conceptId, members: baseMembers, discoveryConfigFingerprint: baseConfigFingerprint })
  const metadataChanged = baseMembers.map((m) => (m.candidateName === 'Venue A' ? { ...m, finalTags: ['canal-crawl', 'newly-added-tag'] } : m))
  const fp2 = computeM9ConceptFingerprint({ conceptId, members: metadataChanged, discoveryConfigFingerprint: baseConfigFingerprint })
  assert.notEqual(fp1, fp2, 'a per-item metadata change with no candidateName change must still invalidate the fingerprint')
})

test('IDENTITY: materially redefining the editorial promise produces a NEW concept identity (the chosen branch of the required OR)', () => {
  const before = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: 'A coherent canal-crawl cluster of 15 items.' })
  const after = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: 'A materially redefined concept: now specifically about NIGHT canal crawls, not daytime ones.' })
  assert.notEqual(before, after, 'a materially different editorial promise must produce a new conceptId — an operator wanting the new concept to inherit an existing list UUID uses REPLACE_CONCEPT (m9CompletedListResolution.ts), which is keyed by list lookup, not conceptId, so this composes cleanly')
})

test('IDENTITY: a discovery-config change invalidates the fingerprint even with identical membership', () => {
  const conceptId = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: PROMISE_A })
  const looserConfigFingerprint = computeM9DiscoveryConfigFingerprint({ minViableItems: 5, minStrongFitRatio: 0.3, overlapRequiresJerryThreshold: 0.5, maxTagPrevalenceToSeed: 0.5, excludedTags: new Set() })
  const fp1 = computeM9ConceptFingerprint({ conceptId, members: baseMembers, discoveryConfigFingerprint: baseConfigFingerprint })
  const fp2 = computeM9ConceptFingerprint({ conceptId, members: baseMembers, discoveryConfigFingerprint: looserConfigFingerprint })
  assert.notEqual(fp1, fp2, 'a looser/different discovery config changes what CREATE even means, and must invalidate a prior approval')
})

test('IDENTITY: concepts in different metros cannot accidentally share a conceptId or a persisted approval, even with identical tags/kind/promise', () => {
  const munich = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: PROMISE_A })
  const denver = computeM9ConceptId({ metroSlug: 'denver', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: PROMISE_A })
  assert.notEqual(munich, denver, 'identical seed tags, list kind, AND editorial promise in two different metros must never collide — a persisted operator decision for one metro can never apply to the other')
})

test('IDENTITY: metro slug casing/whitespace variance is normalized (the SAME real metro cannot accidentally split into two identities)', () => {
  const a = computeM9ConceptId({ metroSlug: 'munich', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: PROMISE_A })
  const b = computeM9ConceptId({ metroSlug: '  Munich  ', listKind: 'THEMED', seedTags: ['canal-crawl'], editorialPromise: PROMISE_A })
  assert.equal(a, b, 'the same real metro, differently cased/spaced, must resolve to the same conceptId')
})

test('CONCEPT KEY: computeM9ConceptKey is a stable, normalized, tag-only territory slug — never the sole identity', () => {
  const key = computeM9ConceptKey(['Brewery', ' beer-garden '])
  assert.equal(key, 'beer-garden+brewery', 'normalized (trimmed/lowercased), sorted, +-joined seed tags')
  // Two DIFFERENT concepts (different promise) over the SAME territory
  // share the same conceptKey but NOT the same conceptId — conceptKey is
  // deliberately not a full identity on its own.
  const idOne = computeM9ConceptId({ metroSlug: 'munich', listKind: 'FOOD_LOCAL_FLAVOR', seedTags: ['beer-garden', 'brewery'], editorialPromise: 'Promise one.' })
  const idTwo = computeM9ConceptId({ metroSlug: 'munich', listKind: 'FOOD_LOCAL_FLAVOR', seedTags: ['beer-garden', 'brewery'], editorialPromise: 'Promise two.' })
  assert.notEqual(idOne, idTwo)
  assert.equal(computeM9ConceptKey(['beer-garden', 'brewery']), key)
})
