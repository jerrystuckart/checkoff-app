import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateResearchCandidate, validateResearchCandidates, normalizeClaimSupported, type ResearchCandidateEvidence } from './researchEvidence'

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

// ---------------------------------------------------------------------------
// normalizeClaimSupported — the boundary fix for the Munich crash
// (metroLaunchDriver.ts's executeOneFinisherLateAddCandidate used to cast
// evidence.claimSupported to `string | undefined` and call `.trim()` on
// it directly, which threw when a real research_verifier response for a
// TARGETED_DEEP_DIVE request came back with claimSupported as an array of
// source objects instead of a plain string).
// ---------------------------------------------------------------------------

test('normalizeClaimSupported: the legacy plain-string shape (still the real contract for ResearchCandidateEvidence.claimSupported elsewhere) normalizes without crashing', () => {
  const result = normalizeClaimSupported('Cafe Frischhut is a historic bakery renowned for its Schmalznudeln.')
  assert.equal(result.valid, true)
  assert.equal(result.text, 'Cafe Frischhut is a historic bakery renowned for its Schmalznudeln.')
  assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0]!.supported, true)
})

test('normalizeClaimSupported: an empty or blank string is invalid, not a false "valid"', () => {
  assert.equal(normalizeClaimSupported('').valid, false)
  assert.equal(normalizeClaimSupported('   ').valid, false)
})

test('normalizeClaimSupported: the live-style array-of-source-objects shape (real Munich/Schmalznudeln research_verifier output) normalizes without crashing', () => {
  // A realistic fixture resembling the actual stored execution result for
  // "Schmalznudeln at Café Frischhut" (metro_launch:munich_germany::FINISHER_PACKET_RESEARCH::finisher-research-Schmalznudeln_at_Caf__Frischhut).
  const raw = [
    {
      name: 'Café Frischhut',
      source: 'https://www.frischhut.de/',
      category: 'Bakery/Café',
      neighborhood: 'Altstadt-Lehel (central Munich, near Viktualienmarkt)',
      freshnessDate: null,
      claimSupported: 'Café Frischhut is a historic bakery and café in Munich renowned for its Schmalznudeln, cited as their signature specialty.',
      needsVerification: true,
      verificationConfidence: 'HIGH',
    },
    {
      name: 'Café Frischhut in TasteAtlas',
      source: 'https://www.tasteatlas.com/cafe-frischhut',
      category: 'Bakery, Food & Drink',
      neighborhood: 'Altstadt-Lehel',
      freshnessDate: null,
      claimSupported: 'TasteAtlas cites Café Frischhut as the best and most iconic source for Schmalznudeln in Munich.',
      needsVerification: true,
      verificationConfidence: 'HIGH',
    },
  ]
  const result = normalizeClaimSupported(raw)
  assert.equal(result.valid, true)
  assert.ok(result.text.includes('Café Frischhut is a historic bakery'))
  assert.ok(result.text.includes('TasteAtlas cites Café Frischhut'))
})

test('normalizeClaimSupported: nested per-source support information is preserved, not collapsed', () => {
  const raw = [
    { name: 'Source A', source: 'https://a.example.com', claimSupported: 'Source A confirms the claim.' },
    { name: 'Source B', source: '', claimSupported: 'Source B has no URL so cannot count as support.' },
    { name: 'Source C', source: 'https://c.example.com', claimSupported: '' },
  ]
  const result = normalizeClaimSupported(raw)
  assert.equal(result.valid, true, 'at least one real source (A) supports the claim')
  assert.equal(result.sources.length, 3, 'all three sources are preserved, not just the supported one')
  assert.deepEqual(
    result.sources.map((s) => s.supported),
    [true, false, false]
  )
  assert.equal(result.sources[0]!.label, 'Source A')
  assert.equal(result.text, 'Source A confirms the claim.', 'only genuinely supported source text is combined into the flat text')
})

test('normalizeClaimSupported: a malformed/unrecognized shape is reported invalid, never thrown', () => {
  assert.equal(normalizeClaimSupported(undefined).valid, false)
  assert.equal(normalizeClaimSupported(null).valid, false)
  assert.equal(normalizeClaimSupported(42).valid, false)
  assert.equal(normalizeClaimSupported({ notAnArrayOrString: true }).valid, false)
  assert.equal(normalizeClaimSupported([]).valid, false)
  assert.equal(normalizeClaimSupported([{ noUsableFields: true }]).valid, false)
})
