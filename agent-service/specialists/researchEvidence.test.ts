import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateResearchCandidate, validateResearchCandidates, type ResearchCandidateEvidence } from './researchEvidence'

function candidate(overrides: Partial<ResearchCandidateEvidence> = {}): ResearchCandidateEvidence {
  return {
    name: 'Sonoran Glass School',
    category: 'Arts & Culture',
    neighborhood: 'Downtown',
    claimSupported: 'confirms class schedule and walk-in policy',
    source: 'https://example.com/sonoran-glass-school',
    freshnessDate: '2026-08-01',
    verificationConfidence: 'HIGH',
    needsVerification: false,
    ...overrides,
  }
}

test('validateResearchCandidate: a well-formed VERIFICATION candidate passes', () => {
  const result = validateResearchCandidate(candidate(), 'VERIFICATION')
  assert.equal(result.valid, true)
})

test('validateResearchCandidate: rejects a candidate with no source — an unsupported assertion is never evidence', () => {
  const result = validateResearchCandidate(candidate({ source: '' }), 'VERIFICATION')
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('source')))
})

test('validateResearchCandidate: rejects a candidate with no claimSupported', () => {
  const result = validateResearchCandidate(candidate({ claimSupported: '' }), 'VERIFICATION')
  assert.equal(result.valid, false)
})

test('validateResearchCandidate: BROAD_DISCOVERY requires needsVerification=true', () => {
  const result = validateResearchCandidate(candidate({ needsVerification: false }), 'BROAD_DISCOVERY')
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('needsVerification')))
})

test('validateResearchCandidate: BROAD_DISCOVERY with needsVerification=true passes despite lower certainty', () => {
  const result = validateResearchCandidate(candidate({ needsVerification: true, verificationConfidence: 'LOW' }), 'BROAD_DISCOVERY')
  assert.equal(result.valid, true)
})

test('validateResearchCandidate: a VERIFICATION-pass candidate still marked needsVerification=true is rejected — verification did not actually happen', () => {
  const result = validateResearchCandidate(candidate({ needsVerification: true }), 'VERIFICATION')
  assert.equal(result.valid, false)
})

test('validateResearchCandidates: aggregates per-candidate reasons with index/name context', () => {
  const result = validateResearchCandidates([candidate({ name: 'Good One' }), candidate({ name: 'Bad One', source: '' })], 'VERIFICATION')
  assert.equal(result.valid, false)
  assert.equal(result.reasons.length, 1)
  assert.match(result.reasons[0], /Bad One/)
})
