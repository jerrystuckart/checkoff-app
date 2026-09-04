import { test } from 'node:test'
import assert from 'node:assert/strict'
import { candidatesAreSameThing, dedupeCandidates, mergeCandidateSets, type RawCandidate } from './candidateMerge'

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
