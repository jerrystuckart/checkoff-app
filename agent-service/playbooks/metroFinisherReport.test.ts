import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateMetroFinisherReport,
  checkReadinessNotGatedOnCountAlone,
  evaluateMetroFinisherReportGate,
  MAX_CANDIDATE_LEADS,
  type MetroFinisherReport,
  type CandidateFinding,
} from './metroFinisherReport'

function goodCandidate(overrides: Partial<CandidateFinding> = {}): CandidateFinding {
  return {
    candidateName: 'Order the schiacciata at Forno Firenze',
    venueName: 'Forno Firenze',
    category: 'Food & drink',
    neighborhoodName: 'Santo Spirito',
    rationale: 'A local knowledgeable-local pick, currently missing from the catalog.',
    distinctivenessNote: 'A specific dish, not a generic venue mention.',
    ...overrides,
  }
}

function goodReport(overrides: Partial<MetroFinisherReport> = {}): MetroFinisherReport {
  return {
    metro: 'Firenze (Florence)',
    generatedAt: '2026-09-11T00:00:00Z',
    catalogAssessment: {
      currentItemCount: 120,
      strengths: ['Strong Arts & Culture coverage'],
      weaknesses: [],
      categoryGaps: [],
      neighborhoodGaps: [],
    },
    cityIdentity: {
      signatureFoodAndDrink: [{ title: 'Schiacciata', description: 'Flatbread sandwich tradition', sourceNote: 'live search, 2026' }],
      ritualsAndTraditions: [],
      artisanAndMakerCulture: [],
      localOnlyExperiences: [],
      unusualOrHidden: [],
      sportsAndCivicCulture: [],
    },
    mustHaveMissingExperiences: [],
    enrichmentCandidates: [],
    neighborhoodRecommendations: { keep: ['Santo Spirito'], split: [], add: [], reject: [] },
    themedListOpportunities: [],
    duplicateOrIdentityConcerns: [],
    finalAssessment: { readyToFinish: true, recommendedAdditionalItemRange: { min: 0, max: 5 }, highestPriorityNextActions: [] },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Arts & Culture-heavy catalog -> category gap finding (fixture-level
//    proof that the report shape carries this and it survives validation).
// ---------------------------------------------------------------------------

test('an Arts & Culture-heavy synthetic catalog fixture carries a category gap finding that survives validation', () => {
  const report = goodReport({
    catalogAssessment: {
      currentItemCount: 200,
      strengths: ['Deep museum and gallery coverage'],
      weaknesses: ['Nearly half the catalog is Arts & Culture'],
      categoryGaps: [
        {
          area: 'Bar & drinks',
          evidence: '92 Arts & Culture items vs only 4 Bar & drinks items in a city famous for its aperitivo culture.',
          severity: 'HIGH',
          recommendation: 'Research aperitivo bars and wine bars in underrepresented neighborhoods.',
        },
      ],
      neighborhoodGaps: [],
    },
  })
  const validation = validateMetroFinisherReport(report)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  assert.equal(validation.report?.catalogAssessment.categoryGaps.length, 1)
  assert.equal(validation.report?.catalogAssessment.categoryGaps[0].area, 'Bar & drinks')
  assert.equal(validation.report?.catalogAssessment.categoryGaps[0].severity, 'HIGH')
})

// ---------------------------------------------------------------------------
// 2. A sparse-but-meaningful neighborhood can produce a gap finding without
//    forcing any filler item creation — i.e. neighborhoodGaps/keep can
//    coexist with an empty candidate list.
// ---------------------------------------------------------------------------

test('a sparse-but-meaningful neighborhood can be flagged via neighborhoodGaps with zero forced candidate items', () => {
  const report = goodReport({
    catalogAssessment: {
      currentItemCount: 120,
      strengths: [],
      weaknesses: [],
      categoryGaps: [],
      neighborhoodGaps: [
        {
          area: 'San Niccolò',
          evidence: 'Only 2 certified items, but real local character (artisan workshops, a genuine neighborhood identity) — thin is not the same as unworthy.',
          severity: 'LOW',
          recommendation: 'Keep as-is; do not force filler items just to raise the count.',
        },
      ],
    },
    mustHaveMissingExperiences: [],
    enrichmentCandidates: [],
  })
  const validation = validateMetroFinisherReport(report)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  assert.equal(validation.report?.catalogAssessment.neighborhoodGaps.length, 1)
  assert.equal(validation.report?.mustHaveMissingExperiences.length, 0)
  assert.equal(validation.report?.enrichmentCandidates.length, 0)
})

// ---------------------------------------------------------------------------
// 3. NeighborhoodSplitProposal must always carry non-empty affectedExistingItemIds.
// ---------------------------------------------------------------------------

test('a NeighborhoodSplitProposal with a non-empty affectedExistingItemIds passes validation', () => {
  const report = goodReport({
    neighborhoodRecommendations: {
      keep: [],
      split: [
        {
          parentNeighborhood: 'Oltrarno',
          proposedChildren: ['San Niccolò', 'San Frediano'],
          rationale: 'Oltrarno is masking two genuinely distinct real neighborhoods.',
          affectedExistingItemIds: ['item-1', 'item-2'],
        },
      ],
      add: [],
      reject: [],
    },
  })
  const validation = validateMetroFinisherReport(report)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  assert.equal(validation.report?.neighborhoodRecommendations.split[0].affectedExistingItemIds.length, 2)
})

test('a NeighborhoodSplitProposal with an EMPTY affectedExistingItemIds fails validation — a split must never leave existing items stranded', () => {
  const report = goodReport({
    neighborhoodRecommendations: {
      keep: [],
      split: [
        {
          parentNeighborhood: 'Oltrarno',
          proposedChildren: ['San Niccolò', 'San Frediano'],
          rationale: 'Proposed without checking what already lives under the parent.',
          affectedExistingItemIds: [],
        },
      ],
      add: [],
      reject: [],
    },
  })
  const validation = validateMetroFinisherReport(report)
  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some((e) => e.includes('affectedExistingItemIds')))
})

// ---------------------------------------------------------------------------
// 4. International alias handling — a metro/venue name with local-language
//    characters and a parenthetical alias must survive validation untouched,
//    never mangled or thrown on.
// ---------------------------------------------------------------------------

test('international metro/venue names and local-language aliases flow through validation unchanged, never mangled or thrown', () => {
  const report = goodReport({
    metro: 'Firenze (Florence)',
    mustHaveMissingExperiences: [
      goodCandidate({
        candidateName: 'Try the lampredotto at a storico trippaio stand',
        venueName: "Trippaio Pontevecchio (a.k.a. 'l Trippaio del Porcellino)",
        neighborhoodName: 'Mercato Nuovo',
        rationale: 'A defining Florentine street-food ritual, referenced in both English and Italian sources.',
        distinctivenessNote: 'Uses the exact local dish name (lampredotto), not an anglicized description.',
      }),
    ],
  })
  assert.doesNotThrow(() => validateMetroFinisherReport(report))
  const validation = validateMetroFinisherReport(report)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  assert.equal(validation.report?.metro, 'Firenze (Florence)')
  assert.equal(validation.report?.mustHaveMissingExperiences[0].venueName, "Trippaio Pontevecchio (a.k.a. 'l Trippaio del Porcellino)")
})

// ---------------------------------------------------------------------------
// 5 & 6. Duplicate/identity concern verdicts survive validation with their
// real semantics preserved (integration-level behavior is covered in
// metroFinisherIntegration.test.ts; this proves the report layer itself
// carries the distinction correctly).
// ---------------------------------------------------------------------------

test('a same-venue + same-experience duplicate concern validates as MERGE_RECOMMENDED', () => {
  const report = goodReport({
    duplicateOrIdentityConcerns: [
      { venueName: 'Caffè Gilli', placeId: 'place-123', itemIds: ['item-a', 'item-b'], verdict: 'MERGE_RECOMMENDED', rationale: 'Both items describe the same historic-café coffee experience.' },
    ],
  })
  const validation = validateMetroFinisherReport(report)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  assert.equal(validation.report?.duplicateOrIdentityConcerns[0].verdict, 'MERGE_RECOMMENDED')
})

test('a same-venue + materially distinct experience duplicate concern validates as DISTINCT', () => {
  const report = goodReport({
    duplicateOrIdentityConcerns: [
      { venueName: 'Mercato Centrale', placeId: 'place-456', itemIds: ['item-c', 'item-d'], verdict: 'DISTINCT', rationale: 'One item is about the ground-floor produce stalls, the other about the rooftop food hall — genuinely different experiences.' },
    ],
  })
  const validation = validateMetroFinisherReport(report)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  assert.equal(validation.report?.duplicateOrIdentityConcerns[0].verdict, 'DISTINCT')
})

// ---------------------------------------------------------------------------
// 7. No hardcoded theme allowlist — an arbitrary, novel title passes through untouched.
// ---------------------------------------------------------------------------

test('an arbitrary, wholly novel themed-list title passes through validation untouched — no hardcoded allowlist', () => {
  const novelTitle = 'The Lampredotto Trail: Florence Street Food Only a Nonna Would Know'
  const report = goodReport({
    themedListOpportunities: [
      { title: novelTitle, rationale: 'City-specific, not a generic template.', existingItemIds: ['item-1'], missingExperiences: [], strengthScore: 82, recommendation: 'CREATE_NOW' },
    ],
  })
  const validation = validateMetroFinisherReport(report)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  assert.equal(validation.report?.themedListOpportunities[0].title, novelTitle)
})

// ---------------------------------------------------------------------------
// 8. ENRICH_THEN_CREATE with real missingExperiences validates and is kept.
// ---------------------------------------------------------------------------

test('an ENRICH_THEN_CREATE themed-list verdict with missingExperiences validates and preserves them', () => {
  const report = goodReport({
    themedListOpportunities: [
      {
        title: 'Florentine Artisan Workshops',
        rationale: 'Strong concept, but not enough qualifying items yet.',
        existingItemIds: ['item-1'],
        missingExperiences: [goodCandidate({ candidateName: 'Watch a leather artisan at work', venueName: 'Scuola del Cuoio' })],
        strengthScore: 55,
        recommendation: 'ENRICH_THEN_CREATE',
      },
    ],
  })
  const validation = validateMetroFinisherReport(report)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  assert.equal(validation.report?.themedListOpportunities[0].missingExperiences.length, 1)
  assert.equal(validation.warnings.length, 0)
})

test('an ENRICH_THEN_CREATE verdict with NO missingExperiences still validates, but is flagged with a warning (never silently accepted as equivalent to CREATE_NOW)', () => {
  const report = goodReport({
    themedListOpportunities: [{ title: 'Some Theme', rationale: 'r', existingItemIds: [], missingExperiences: [], strengthScore: 40, recommendation: 'ENRICH_THEN_CREATE' }],
  })
  const validation = validateMetroFinisherReport(report)
  assert.equal(validation.ok, true)
  assert.ok(validation.warnings.some((w) => w.includes('ENRICH_THEN_CREATE')))
})

// ---------------------------------------------------------------------------
// Bounded candidate cap (~40-60) — enforced as real truncation, not prose.
// ---------------------------------------------------------------------------

test('combined mustHaveMissingExperiences + enrichmentCandidates beyond MAX_CANDIDATE_LEADS is truncated, never silently exceeded', () => {
  const many = Array.from({ length: MAX_CANDIDATE_LEADS + 20 }, (_, i) => goodCandidate({ candidateName: `Candidate ${i}` }))
  const report = goodReport({ mustHaveMissingExperiences: many, enrichmentCandidates: [] })
  const validation = validateMetroFinisherReport(report)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  assert.equal(validation.report!.mustHaveMissingExperiences.length + validation.report!.enrichmentCandidates.length, MAX_CANDIDATE_LEADS)
  assert.ok(validation.warnings.some((w) => w.includes('truncated')))
})

// ---------------------------------------------------------------------------
// 9. "Don't gate readiness on item count alone" — real, testable enforcement.
// ---------------------------------------------------------------------------

test('a report with a low currentItemCount but readyToFinish:false justified ONLY by a bare item-count target is flagged by checkReadinessNotGatedOnCountAlone', () => {
  const report = goodReport({
    catalogAssessment: { currentItemCount: 40, strengths: [], weaknesses: [], categoryGaps: [], neighborhoodGaps: [] },
    mustHaveMissingExperiences: [],
    duplicateOrIdentityConcerns: [],
    neighborhoodRecommendations: { keep: [], split: [], add: [], reject: [] },
    finalAssessment: { readyToFinish: false, recommendedAdditionalItemRange: { min: 60, max: 80 }, highestPriorityNextActions: ['Add 60 more items to reach 100 total items'] },
  })
  const check = checkReadinessNotGatedOnCountAlone(report)
  assert.equal(check.flaggedAsCountOnly, true)

  const gate = evaluateMetroFinisherReportGate(validateMetroFinisherReport(report))
  assert.equal(gate.verdict, 'FAIL')
})

test('a not-ready verdict backed by a real category/neighborhood gap or must-have finding is NOT flagged as count-only', () => {
  const report = goodReport({
    catalogAssessment: {
      currentItemCount: 40,
      strengths: [],
      weaknesses: [],
      categoryGaps: [{ area: 'Sports', evidence: 'Zero real participatory sports venues found in initial research.', severity: 'MEDIUM', recommendation: 'Research climbing gyms and public pools.' }],
      neighborhoodGaps: [],
    },
    finalAssessment: { readyToFinish: false, recommendedAdditionalItemRange: { min: 10, max: 20 }, highestPriorityNextActions: ['Research Sports category candidates'] },
  })
  const check = checkReadinessNotGatedOnCountAlone(report)
  assert.equal(check.flaggedAsCountOnly, false)

  const gate = evaluateMetroFinisherReportGate(validateMetroFinisherReport(report))
  assert.equal(gate.verdict, 'PASS')
})

test('checkReadinessNotGatedOnCountAlone never flags a report whose readyToFinish is true', () => {
  const report = goodReport({ finalAssessment: { readyToFinish: true, recommendedAdditionalItemRange: { min: 0, max: 0 }, highestPriorityNextActions: [] } })
  assert.equal(checkReadinessNotGatedOnCountAlone(report).flaggedAsCountOnly, false)
})

// ---------------------------------------------------------------------------
// Gate composition — StagingGateResult shape reuse.
// ---------------------------------------------------------------------------

test('evaluateMetroFinisherReportGate FAILs closed when the raw report is structurally invalid', () => {
  const gate = evaluateMetroFinisherReportGate(validateMetroFinisherReport({ not: 'a report' }))
  assert.equal(gate.verdict, 'FAIL')
  assert.equal(gate.key, 'METRO_FINISHER_REPORT_GATE')
})
