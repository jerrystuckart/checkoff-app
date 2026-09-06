import { test } from 'node:test'
import assert from 'node:assert/strict'
import { candidatesAreSameThing, dedupeCandidates, mergeCandidateSets, findSuspectedDuplicates, type RawCandidate } from './candidateMerge'

function candidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    name: 'Sonoran Glass School',
    category: 'Arts & Culture',
    neighborhood: 'Downtown',
    claimSupported: 'make-your-own-glass class, walk-ins welcome',
    source: 'https://example.com/a',
    address: '633 W 5th St',
    ...overrides,
  }
}

test('candidatesAreSameThing: identical name+address+claim is a dupe', () => {
  const a = candidate()
  const b = candidate({ source: 'https://example.com/b' }) // different source, same real-world thing
  assert.equal(candidatesAreSameThing(a, b), true)
})

test('candidatesAreSameThing: name differing only by case/punctuation/"The" is still a dupe', () => {
  const a = candidate({ name: 'The Sonoran Glass School' })
  const b = candidate({ name: 'sonoran glass school!!' })
  assert.equal(candidatesAreSameThing(a, b), true)
})

test('candidatesAreSameThing: same venue, DIFFERENT specific experience is NOT a dupe — one venue can have multiple distinct items', () => {
  const a = candidate({ claimSupported: 'make-your-own-glass ornament class' })
  const b = candidate({ claimSupported: 'Thursday evening live glassblowing demonstration' })
  assert.equal(candidatesAreSameThing(a, b), false)
})

test('candidatesAreSameThing: same name, different address is NOT a dupe (different location entirely)', () => {
  const a = candidate({ address: '633 W 5th St' })
  const b = candidate({ address: '901 E Broadway' })
  assert.equal(candidatesAreSameThing(a, b), false)
})

test('candidatesAreSameThing: different venue name entirely is never a dupe', () => {
  const a = candidate({ name: 'Sonoran Glass School' })
  const b = candidate({ name: 'Titan Missile Museum' })
  assert.equal(candidatesAreSameThing(a, b), false)
})

test('dedupeCandidates: collapses a real dupe and records the discarded raw entry for audit', () => {
  const a = candidate()
  const b = candidate({ source: 'https://example.com/different-source' })
  const result = dedupeCandidates([a, b])
  assert.equal(result.deduped.length, 1)
  assert.equal(result.mergedGroups.length, 1)
  assert.equal(result.mergedGroups[0].discarded.length, 1)
})

test('dedupeCandidates: keeps two genuinely distinct items at the same venue', () => {
  const a = candidate({ claimSupported: 'glass ornament class' })
  const b = candidate({ claimSupported: 'glassblowing demonstration' })
  const result = dedupeCandidates([a, b])
  assert.equal(result.deduped.length, 2)
})

test('mergeCandidateSets: merges a broad-discovery pass and a targeted gap pass, deduping across both', () => {
  const broadPass = [candidate({ name: 'Muttropolis' })]
  const gapPass = [candidate({ name: 'muttropolis' }), candidate({ name: 'Warwicks Books', address: '7812 Girard Ave' })]
  const result = mergeCandidateSets(broadPass, gapPass)
  assert.equal(result.deduped.length, 2)
})

// ---------------------------------------------------------------------------
// Structural bug fix regression (San Diego run, 2026-09-05): 251 raw
// candidates collapsed to only 200 unique names because re-describing
// the SAME real venue across separate research passes almost never
// produces identical or substring-overlapping claim text — the exact
// claim-match/containment rule silently let 51 literal-same-name rows
// through untouched (e.g. "Westfield UTC" x5, each with different
// generic mall-description wording).
// ---------------------------------------------------------------------------

test('candidatesAreSameThing: regression — differently-worded re-descriptions of the same real venue across research passes are dupes', () => {
  const a = candidate({ name: 'Westfield UTC', address: undefined, claimSupported: 'Upscale open-air mall with 155–165+ stores, restaurants, ice rink, cinema' })
  const b = candidate({ name: 'Westfield UTC', address: undefined, claimSupported: 'Westfield UTC is a major outdoor premium mall with many stores and open-air design' })
  assert.equal(candidatesAreSameThing(a, b), true)
})

test('candidatesAreSameThing: regression — a second real San Diego duplicate pair (Padres) with near-zero literal text overlap still merges', () => {
  const a = candidate({ name: 'San Diego Padres', address: undefined, claimSupported: 'San Diego Padres is a major professional league team in MLB based in San Diego' })
  const b = candidate({ name: 'San Diego Padres', address: undefined, claimSupported: 'Existence of San Diego Padres as MLB team playing at Petco Park' })
  assert.equal(candidatesAreSameThing(a, b), true)
})

test('candidatesAreSameThing: the existing glass-class vs. glassblowing-demonstration fixture still stays distinct under the new similarity check', () => {
  const a = candidate({ claimSupported: 'make-your-own-glass ornament class' })
  const b = candidate({ claimSupported: 'Thursday evening live glassblowing demonstration' })
  assert.equal(candidatesAreSameThing(a, b), false)
})

test('candidatesAreSameThing: does not over-dedupe two different businesses with similar-but-not-equal names', () => {
  const a = candidate({ name: 'Westfield UTC', address: undefined })
  const b = candidate({ name: 'Westfield Plaza Bonita', address: undefined })
  assert.equal(candidatesAreSameThing(a, b), false)
})

test('dedupeCandidates: picks the most complete evidence as the canonical representative, not just the first occurrence', () => {
  const thin = candidate({ name: 'Westfield UTC', address: undefined, claimSupported: 'mall' })
  const rich = candidate({
    name: 'Westfield UTC',
    address: undefined,
    claimSupported: 'Upscale open-air mall with 155-165+ stores, restaurants, ice rink, and cinema — one of the largest in the region',
  }) as RawCandidate & { verificationConfidence: string }
  rich.verificationConfidence = 'HIGH'
  const result = dedupeCandidates([thin, rich])
  assert.equal(result.deduped.length, 1)
  assert.equal(result.deduped[0].claimSupported, rich.claimSupported)
})

test('dedupeCandidates: preserves every distinct source URL from a merged group as mergedSourceUrls, even though only one representative survives', () => {
  const a = candidate({ name: 'Westfield UTC', address: undefined, source: 'https://a.example.com' })
  const b = candidate({ name: 'Westfield UTC', address: undefined, source: 'https://b.example.com' })
  const c = candidate({ name: 'Westfield UTC', address: undefined, source: 'https://a.example.com' }) // duplicate source, should not double-count
  const result = dedupeCandidates([a, b, c])
  assert.equal(result.deduped.length, 1)
  assert.deepEqual(new Set(result.deduped[0].mergedSourceUrls), new Set(['https://a.example.com', 'https://b.example.com']))
})

test('findSuspectedDuplicates: a correctly-deduped canonical set has none', () => {
  const a = candidate({ name: 'Westfield UTC', address: undefined })
  const b = candidate({ name: 'Titan Missile Museum', address: undefined })
  const { deduped } = dedupeCandidates([a, a, b])
  assert.equal(findSuspectedDuplicates(deduped).length, 0)
})

test('findSuspectedDuplicates: still catches a real duplicate pair if candidates were never run through dedupeCandidates at all', () => {
  const a = candidate({ name: 'Westfield UTC', address: undefined })
  const b = candidate({ name: 'Westfield UTC', address: undefined })
  assert.equal(findSuspectedDuplicates([a, b]).length, 1)
})
