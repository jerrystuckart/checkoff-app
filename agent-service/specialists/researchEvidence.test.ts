import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateResearchCandidate,
  validateResearchCandidates,
  normalizeClaimSupported,
  validateExtendedResearchCandidate,
  validateExtendedResearchCandidates,
  normalizedBusinessIdentity,
  resolveSecretEvidenceForCandidate,
  type ResearchCandidateEvidence,
  type ExtendedResearchCandidateEvidence,
} from './researchEvidence'
import { noFrictionDifficultyEvidence } from '../playbooks/difficultyEvidence'

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

// ---------------------------------------------------------------------------
// Evidence-contract extension (Munich calibration Phase 2) — ownership,
// secret-evidence, difficulty-evidence, verified Place ID, geographic role,
// and business-identity normalization. Fixtures grounded in real Munich
// examples from the calibration analysis: Magnus Bauch (ownership), Haus im
// Tal / Alva Morgaine (secret evidence — the two real worked examples from
// 11-list-portfolio-scorecards.md and 14-difficulty-and-secret-remediation-plan.md),
// Café Frischhut (difficulty).
// ---------------------------------------------------------------------------

function extendedCandidate(overrides: Partial<ExtendedResearchCandidateEvidence> = {}): ExtendedResearchCandidateEvidence {
  return {
    name: 'Magnus Bauch',
    category: 'Shopping',
    neighborhood: 'Sendling',
    claimSupported: "Buy a house-made Munich sausage from fourth-generation butcher 'Magnus Bauch'.",
    source: 'https://example.com/magnus-bauch',
    freshnessDate: '2026-09-01',
    verificationConfidence: 'HIGH',
    needsVerification: false,
    ...overrides,
  }
}

test('validateExtendedResearchCandidate: base contract still applies in full (no source still fails)', () => {
  const result = validateExtendedResearchCandidate(extendedCandidate({ source: '' }), 'VERIFICATION')
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('source')))
})

test('validateExtendedResearchCandidate: UNKNOWN_REQUIRES_VERIFICATION ownership never requires ownershipEvidence — this is the real, universal state of every live Munich candidate today', () => {
  const result = validateExtendedResearchCandidate(extendedCandidate({ ownershipType: 'UNKNOWN_REQUIRES_VERIFICATION' }), 'VERIFICATION')
  assert.equal(result.valid, true)
})

test('validateExtendedResearchCandidate: asserting INDEPENDENT_LOCAL ownership without evidence is rejected — never silently treated as verified from a bare label (real Magnus Bauch case, fourth-generation-butcher claim)', () => {
  const result = validateExtendedResearchCandidate(extendedCandidate({ ownershipType: 'INDEPENDENT_LOCAL' }), 'VERIFICATION')
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('ownershipEvidence')))
})

test('validateExtendedResearchCandidate: INDEPENDENT_LOCAL ownership WITH concrete evidence passes', () => {
  const result = validateExtendedResearchCandidate(
    extendedCandidate({ ownershipType: 'INDEPENDENT_LOCAL', ownershipEvidence: 'Fourth-generation family butcher, per venue history page.', ownershipConfidence: 'HIGH' }),
    'VERIFICATION'
  )
  assert.equal(result.valid, true)
})

test('validateExtendedResearchCandidate: isSecretClaimed without a secretEvidence record is rejected as a malformed candidate, not merely a weak claim (contract-shape check, distinct from evaluateSecretEvidence sufficiency)', () => {
  const result = validateExtendedResearchCandidate(extendedCandidate({ isSecretClaimed: true }), 'VERIFICATION')
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('secretEvidence')))
})

test('validateExtendedResearchCandidate: real Haus im Tal case — a concrete "hidden inside" mechanic with a source is a structurally valid secret claim', () => {
  const result = validateExtendedResearchCandidate(
    extendedCandidate({
      name: 'Haus im Tal',
      claimSupported: "Find the rooftop bar hidden inside 'Haus im Tal'.",
      isSecretClaimed: true,
      secretEvidence: {
        mechanic: 'A rooftop bar accessible only through an unmarked entrance inside the building — no street-level signage.',
        evidenceType: 'LOCAL_EDITORIAL_GUIDE',
        source: 'https://example-verified-local-guide.test/haus-im-tal-rooftop',
        dateVerified: '2026-09-10',
        confidence: 'MEDIUM',
        verdict: 'HOLD',
      },
    }),
    'VERIFICATION'
  )
  assert.equal(result.valid, true, 'the CONTRACT is valid — whether the mechanic is strong enough is evaluateSecretEvidence/resolveSecretEvidenceForCandidate\'s job, not this validator\'s')
  const resolved = resolveSecretEvidenceForCandidate({ ...extendedCandidate(), isSecretClaimed: true, secretEvidence: { mechanic: 'A rooftop bar accessible only through an unmarked entrance.', evidenceType: 'LOCAL_EDITORIAL_GUIDE', source: 'https://example.test/haus-im-tal', dateVerified: null, confidence: 'MEDIUM', verdict: 'HOLD' } })
  assert.equal(resolved.supported, true, 'a concrete "unmarked entrance" mechanic with a real source is supported')
})

test('validateExtendedResearchCandidate: real Alva Morgaine case — "find the strangest treasure" wording alone is NOT a supported secret mechanic (editorial voice, not concealment)', () => {
  const candidate = extendedCandidate({
    name: 'Alva Morgaine',
    claimSupported: "Find the strangest wearable treasure in the vintage cabinet of curiosities at 'Alva Morgaine'.",
    isSecretClaimed: true,
    secretEvidence: { mechanic: 'A hidden gem, a local favorite vintage shop.', evidenceType: 'EDITORIAL_VOICE', source: 'https://example.test/alva-morgaine', dateVerified: null, confidence: 'LOW', verdict: 'REJECT' },
  })
  const structural = validateExtendedResearchCandidate(candidate, 'VERIFICATION')
  assert.equal(structural.valid, true, 'structurally valid — a record IS present, even though it will fail sufficiency')
  const resolved = resolveSecretEvidenceForCandidate(candidate)
  assert.equal(resolved.supported, false, '"hidden gem"/"local favorite" alone is never sufficient — matches the real Munich verdict for Alva Morgaine')
})

test('validateExtendedResearchCandidate: proposedDifficulty asserted without difficultyEvidence is rejected — difficulty must never be assigned without the concrete factors backing it', () => {
  const result = validateExtendedResearchCandidate(extendedCandidate({ proposedDifficulty: 10 }), 'VERIFICATION')
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('difficultyEvidence')))
})

test('validateExtendedResearchCandidate: proposedDifficulty that disagrees with its own difficultyEvidence is rejected — never trust a hand-asserted number over its own stated evidence', () => {
  const result = validateExtendedResearchCandidate(
    extendedCandidate({ proposedDifficulty: 25, difficultyEvidence: noFrictionDifficultyEvidence('mismatch test') }),
    'VERIFICATION'
  )
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('disagrees')))
})

test('validateExtendedResearchCandidate: real Café Frischhut case — a narrow-timing difficultyEvidence record correctly proposes 5, and agreement passes validation', () => {
  const evidence = { ...noFrictionDifficultyEvidence('Café Frischhut, dawn-only Auszogne'), timingRestriction: { present: true, detail: 'Only at dawn.' } }
  const result = validateExtendedResearchCandidate(
    extendedCandidate({ name: 'Café Frischhut', proposedDifficulty: 5, difficultyEvidence: evidence }),
    'VERIFICATION'
  )
  assert.equal(result.valid, true)
})

test('validateExtendedResearchCandidate: an unrecognized geographicRole value is rejected', () => {
  const result = validateExtendedResearchCandidate(extendedCandidate({ geographicRole: 'city_center' as unknown as ExtendedResearchCandidateEvidence['geographicRole'] }), 'VERIFICATION')
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('geographicRole')))
})

test('validateExtendedResearchCandidate: all 4 recognized geographicRole values pass', () => {
  for (const role of ['core_urban', 'important_neighborhood', 'suburb', 'destination_worthy_outer'] as const) {
    const result = validateExtendedResearchCandidate(extendedCandidate({ geographicRole: role }), 'VERIFICATION')
    assert.equal(result.valid, true, `geographicRole ${role} should be valid`)
  }
})

test('validateExtendedResearchCandidates: aggregates extension-specific reasons with index/name context, same discipline as the base validator', () => {
  const result = validateExtendedResearchCandidates(
    [extendedCandidate({ name: 'Good One' }), extendedCandidate({ name: 'Bad One', ownershipType: 'INDEPENDENT_LOCAL' })],
    'VERIFICATION'
  )
  assert.equal(result.valid, false)
  assert.equal(result.reasons.length, 1)
  assert.match(result.reasons[0], /Bad One/)
})

test('normalizedBusinessIdentity: reuses seedDuplicateNormalization.ts\'s exact venue-key logic — the real Kunst Oase wave1/wave3 pair normalizes identically', () => {
  assert.equal(normalizedBusinessIdentity('Kunst Oase'), normalizedBusinessIdentity('Kunst Oase'))
  assert.equal(normalizedBusinessIdentity('The Kunst Oase'), normalizedBusinessIdentity('Kunst Oase'), 'noise words like "The" are stripped, matching seedDuplicateNormalization.ts')
})

test('resolveSecretEvidenceForCandidate: isSecretClaimed falsy resolves to unsupported without needing a secretEvidence record at all', () => {
  const result = resolveSecretEvidenceForCandidate(extendedCandidate({ isSecretClaimed: false }))
  assert.equal(result.supported, false)
})
