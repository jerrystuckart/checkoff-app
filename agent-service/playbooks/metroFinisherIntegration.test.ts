import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMetroFinisherWorkPackets } from './metroFinisherIntegration'
import { validateMetroFinisherReport, type MetroFinisherReport, type CandidateFinding } from './metroFinisherReport'
import { certifyLateAddItem, type LateAddItemInput } from './lateAddItemCertification'
import type { PlacesCompletenessItemInput } from './placesCompletenessGate'

function goodPlaces(overrides: Partial<PlacesCompletenessItemInput> = {}): PlacesCompletenessItemInput {
  return {
    candidateName: 'Forno Firenze schiacciata',
    classification: 'EXACT',
    googlePlaceId: 'place-forno-firenze',
    formattedAddress: 'Via del Fake 1, 50125 Firenze FI, Italy',
    mapsQuery: 'Forno Firenze, Via del Fake 1, Firenze',
    lat: 43.766,
    lng: 11.245,
    ...overrides,
  }
}

function goodLateAddInput(overrides: Partial<LateAddItemInput> = {}): LateAddItemInput {
  return {
    candidateName: 'Forno Firenze schiacciata',
    venueName: 'Forno Firenze',
    body: "Try the 'schiacciata' sandwich at 'Forno Firenze'.",
    dbCategory: 'Food & drink',
    tags: ['bakery', 'sandwich', 'local favorite', 'historic', 'casual', 'walkable'],
    neighborhoodName: 'Santo Spirito',
    places: goodPlaces(),
    existingProductionItems: [],
    ...overrides,
  }
}

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

function baseReport(overrides: Partial<MetroFinisherReport> = {}): MetroFinisherReport {
  return {
    metro: 'Firenze (Florence)',
    generatedAt: '2026-09-11T00:00:00Z',
    catalogAssessment: { currentItemCount: 120, strengths: [], weaknesses: [], categoryGaps: [], neighborhoodGaps: [] },
    cityIdentity: { signatureFoodAndDrink: [], ritualsAndTraditions: [], artisanAndMakerCulture: [], localOnlyExperiences: [], unusualOrHidden: [], sportsAndCivicCulture: [] },
    mustHaveMissingExperiences: [],
    enrichmentCandidates: [],
    neighborhoodRecommendations: { keep: [], split: [], add: [], reject: [] },
    themedListOpportunities: [],
    duplicateOrIdentityConcerns: [],
    finalAssessment: { readyToFinish: true, recommendedAdditionalItemRange: { min: 0, max: 0 }, highestPriorityNextActions: [] },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Category gap -> gap finding lands in the catalog completeness packet
//    (the aggregate gap-analysis signal integration owns).
// ---------------------------------------------------------------------------

test('an Arts & Culture-heavy catalog gap finding is reflected in the catalog completeness packet gap counts', () => {
  const report = baseReport({
    catalogAssessment: {
      currentItemCount: 200,
      strengths: [],
      weaknesses: ['Arts & Culture dominates'],
      categoryGaps: [{ area: 'Bar & drinks', evidence: 'Heavily underrepresented vs Arts & Culture.', severity: 'HIGH', recommendation: 'Research bars.' }],
      neighborhoodGaps: [],
    },
  })
  const packets = buildMetroFinisherWorkPackets(report)
  assert.equal(packets.catalogCompleteness.categoryGapCount, 1)
  assert.deepEqual(packets.catalogCompleteness.weaknesses, ['Arts & Culture dominates'])
})

// ---------------------------------------------------------------------------
// 2. A sparse-but-meaningful neighborhood produces a NEIGHBORHOOD_PACKET
//    gap-flag work item without any forced candidate/filler item.
// ---------------------------------------------------------------------------

test('a sparse-but-meaningful neighborhood gap produces a NEIGHBORHOOD_PACKET GAP_FLAG work item with zero forced candidates', () => {
  const report = baseReport({
    catalogAssessment: {
      currentItemCount: 120,
      strengths: [],
      weaknesses: [],
      categoryGaps: [],
      neighborhoodGaps: [{ area: 'San Niccolò', evidence: 'Only 2 items but genuinely distinct local character.', severity: 'LOW', recommendation: 'Leave as-is; do not force filler items.' }],
    },
  })
  const packets = buildMetroFinisherWorkPackets(report)
  const gapFlags = packets.neighborhood.workItems.filter((w) => w.kind === 'GAP_FLAG')
  assert.equal(gapFlags.length, 1)
  assert.equal((gapFlags[0] as { area: string }).area, 'San Niccolò')
  assert.equal(packets.enrichment.candidates.length, 0)
})

// ---------------------------------------------------------------------------
// 3. NeighborhoodSplitProposal ALWAYS produces a migration-review work item
//    (when it validated in the first place — an empty-affected-ids one
//    should already be caught upstream by validateMetroFinisherReport;
//    this proves integration's own defense-in-depth too).
// ---------------------------------------------------------------------------

test('a valid NeighborhoodSplitProposal always produces a MIGRATION_REVIEW work item carrying its affected item ids', () => {
  const report = baseReport({
    neighborhoodRecommendations: {
      keep: [],
      split: [{ parentNeighborhood: 'Oltrarno', proposedChildren: ['San Niccolò', 'San Frediano'], rationale: 'Masks two real areas.', affectedExistingItemIds: ['item-1', 'item-2'] }],
      add: [],
      reject: [],
    },
  })
  const packets = buildMetroFinisherWorkPackets(report)
  const migrations = packets.neighborhood.workItems.filter((w) => w.kind === 'MIGRATION_REVIEW')
  assert.equal(migrations.length, 1)
  assert.deepEqual((migrations[0] as { affectedExistingItemIds: string[] }).affectedExistingItemIds, ['item-1', 'item-2'])
})

test('a NeighborhoodSplitProposal with empty affectedExistingItemIds is rejected by report validation before it ever reaches integration', () => {
  const raw = {
    ...baseReport(),
    neighborhoodRecommendations: {
      keep: [],
      split: [{ parentNeighborhood: 'Oltrarno', proposedChildren: ['San Niccolò'], rationale: 'r', affectedExistingItemIds: [] }],
      add: [],
      reject: [],
    },
  }
  const validation = validateMetroFinisherReport(raw)
  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some((e) => e.includes('affectedExistingItemIds')))
})

test('defense-in-depth: buildMetroFinisherWorkPackets never emits a MIGRATION_REVIEW for a (hand-constructed, already-invalid) split with empty affectedExistingItemIds', () => {
  const report = baseReport({
    neighborhoodRecommendations: {
      keep: [],
      // Bypassing validation on purpose to prove integration's own filter, not just the upstream validator.
      split: [{ parentNeighborhood: 'Oltrarno', proposedChildren: ['San Niccolò'], rationale: 'r', affectedExistingItemIds: [] }],
      add: [],
      reject: [],
    },
  })
  const packets = buildMetroFinisherWorkPackets(report)
  assert.equal(packets.neighborhood.workItems.filter((w) => w.kind === 'MIGRATION_REVIEW').length, 0)
})

// ---------------------------------------------------------------------------
// 4. International alias handling flows through integration untouched.
// ---------------------------------------------------------------------------

test('international alias names flow through integration into the enrichment packet unmangled', () => {
  const report = baseReport({
    enrichmentCandidates: [goodCandidate({ venueName: "Trippaio Pontevecchio (a.k.a. 'l Trippaio del Porcellino)", candidateName: 'Try the lampredotto' })],
  })
  assert.doesNotThrow(() => buildMetroFinisherWorkPackets(report))
  const packets = buildMetroFinisherWorkPackets(report)
  assert.equal(packets.enrichment.candidates[0].venueName, "Trippaio Pontevecchio (a.k.a. 'l Trippaio del Porcellino)")
})

// ---------------------------------------------------------------------------
// 5. Same venue + same experience -> MERGE_RECOMMENDED work item, never two
//    separate live-item candidates left unresolved.
// ---------------------------------------------------------------------------

test('a same-venue/same-experience duplicate concern (MERGE_RECOMMENDED) produces a MERGE_REVIEW work item, not a pass-through', () => {
  const report = baseReport({
    duplicateOrIdentityConcerns: [{ venueName: 'Caffè Gilli', placeId: 'place-1', itemIds: ['item-a', 'item-b'], verdict: 'MERGE_RECOMMENDED', rationale: 'Same historic-café coffee experience described twice.' }],
  })
  const packets = buildMetroFinisherWorkPackets(report)
  assert.equal(packets.duplicateReview.workItems.length, 1)
  assert.equal(packets.duplicateReview.workItems[0].kind, 'MERGE_REVIEW')
  assert.deepEqual((packets.duplicateReview.workItems[0] as { itemIds: string[] }).itemIds, ['item-a', 'item-b'])
})

// ---------------------------------------------------------------------------
// 6. Same venue + materially distinct experience -> DISTINCT/CONFIRMED_DISTINCT,
//    both items proceed rather than being auto-rejected.
// ---------------------------------------------------------------------------

test('a same-venue/materially-distinct-experience duplicate concern (DISTINCT) produces a CONFIRMED_DISTINCT work item that lets both items proceed', () => {
  const report = baseReport({
    duplicateOrIdentityConcerns: [{ venueName: 'Mercato Centrale', placeId: 'place-2', itemIds: ['item-c', 'item-d'], verdict: 'DISTINCT', rationale: 'Ground-floor produce stalls vs rooftop food hall — genuinely different.' }],
  })
  const packets = buildMetroFinisherWorkPackets(report)
  assert.equal(packets.duplicateReview.workItems.length, 1)
  assert.equal(packets.duplicateReview.workItems[0].kind, 'CONFIRMED_DISTINCT')
  assert.deepEqual((packets.duplicateReview.workItems[0] as { itemIds: string[] }).itemIds, ['item-c', 'item-d'])
})

test('a NEEDS_HUMAN_REVIEW duplicate concern produces a HUMAN_REVIEW work item, distinct from both merge and distinct outcomes', () => {
  const report = baseReport({
    duplicateOrIdentityConcerns: [{ venueName: 'Some Venue', placeId: null, itemIds: ['item-x', 'item-y'], verdict: 'NEEDS_HUMAN_REVIEW', rationale: 'Ambiguous — bodies overlap partially.' }],
  })
  const packets = buildMetroFinisherWorkPackets(report)
  assert.equal(packets.duplicateReview.workItems[0].kind, 'HUMAN_REVIEW')
})

// ---------------------------------------------------------------------------
// 7. No hardcoded theme allowlist — novel titles pass through integration untouched.
// ---------------------------------------------------------------------------

test('an arbitrary novel themed-list title flows through integration into a CREATE_NOW work item unchanged', () => {
  const novelTitle = 'The Lampredotto Trail: Florence Street Food Only a Nonna Would Know'
  const report = baseReport({
    themedListOpportunities: [{ title: novelTitle, rationale: 'r', existingItemIds: ['item-1'], missingExperiences: [], strengthScore: 80, recommendation: 'CREATE_NOW' }],
  })
  const packets = buildMetroFinisherWorkPackets(report)
  assert.equal(packets.themedList.workItems[0].kind, 'CREATE_NOW')
  assert.equal((packets.themedList.workItems[0] as { title: string }).title, novelTitle)
})

// ---------------------------------------------------------------------------
// 8. ENRICH_THEN_CREATE produces an explicit enrichment work item, never
//    silently dropped.
// ---------------------------------------------------------------------------

test('an ENRICH_THEN_CREATE themed-list verdict produces an explicit ENRICHMENT_NEEDED work item carrying its missing experiences', () => {
  const missing = [goodCandidate({ candidateName: 'Watch a leather artisan at work', venueName: 'Scuola del Cuoio' })]
  const report = baseReport({
    themedListOpportunities: [{ title: 'Florentine Artisan Workshops', rationale: 'r', existingItemIds: ['item-1'], missingExperiences: missing, strengthScore: 55, recommendation: 'ENRICH_THEN_CREATE' }],
  })
  const packets = buildMetroFinisherWorkPackets(report)
  assert.equal(packets.themedList.workItems.length, 1)
  assert.equal(packets.themedList.workItems[0].kind, 'ENRICHMENT_NEEDED')
  assert.equal((packets.themedList.workItems[0] as { missingExperiences: CandidateFinding[] }).missingExperiences.length, 1)
})

test('a DO_NOT_CREATE themed-list verdict is still reported (never silently dropped), but produces no candidate work', () => {
  const report = baseReport({
    themedListOpportunities: [{ title: 'Generic After Dark', rationale: 'Would make sense in any city — red flag.', existingItemIds: [], missingExperiences: [], strengthScore: 20, recommendation: 'DO_NOT_CREATE' }],
  })
  const packets = buildMetroFinisherWorkPackets(report)
  assert.equal(packets.themedList.workItems.length, 1)
  assert.equal(packets.themedList.workItems[0].kind, 'DO_NOT_CREATE')
})

// ---------------------------------------------------------------------------
// Enrichment packet composition — combines both candidate lists.
// ---------------------------------------------------------------------------

test('the enrichment packet combines mustHaveMissingExperiences and enrichmentCandidates', () => {
  const report = baseReport({
    mustHaveMissingExperiences: [goodCandidate({ candidateName: 'A' })],
    enrichmentCandidates: [goodCandidate({ candidateName: 'B' })],
  })
  const packets = buildMetroFinisherWorkPackets(report)
  assert.deepEqual(
    packets.enrichment.candidates.map((c) => c.candidateName),
    ['A', 'B']
  )
})

// ---------------------------------------------------------------------------
// Chief Phase 3D — venueName nullability regression (Munich, 2026-09-11).
// A null-venueName research finding (civic phenomenon, pub crawl, themed-list
// concept, etc.) is real information worth surfacing, but must never be
// mistaken for a venue-resolved candidate ready for certifyLateAddItem() —
// that function's LateAddItemInput.venueName is still a required string.
// ---------------------------------------------------------------------------

test('the enrichment packet partitions candidates into venueResolvedCandidates vs researchOnlyCandidates by venueName nullability', () => {
  const report = baseReport({
    mustHaveMissingExperiences: [goodCandidate({ candidateName: 'Off-Wiesn', venueName: null })],
    enrichmentCandidates: [goodCandidate({ candidateName: 'Forno pick', venueName: 'Forno Firenze' })],
  })
  const packets = buildMetroFinisherWorkPackets(report)
  assert.equal(packets.enrichment.candidates.length, 2)
  assert.deepEqual(
    packets.enrichment.venueResolvedCandidates.map((c) => c.candidateName),
    ['Forno pick']
  )
  assert.deepEqual(
    packets.enrichment.researchOnlyCandidates.map((c) => c.candidateName),
    ['Off-Wiesn']
  )
})

test('a null-venueName research candidate cannot reach certifyLateAddItem: only venueResolvedCandidates (never researchOnlyCandidates) can be turned into a LateAddItemInput', () => {
  const report = baseReport({
    enrichmentCandidates: [goodCandidate({ candidateName: 'Off-Wiesn — seasonal counter-programming', venueName: null }), goodCandidate({ candidateName: 'Forno pick', venueName: 'Forno Firenze' })],
  })
  const packets = buildMetroFinisherWorkPackets(report)

  // The only structurally sound path toward certifyLateAddItem is building
  // a LateAddItemInput from venueResolvedCandidates, whose venueName type is
  // narrowed to `string` (not `string | null`) — this compiles and runs.
  const lateAddInputs: LateAddItemInput[] = packets.enrichment.venueResolvedCandidates.map((c) =>
    goodLateAddInput({ candidateName: c.candidateName, venueName: c.venueName, neighborhoodName: c.neighborhoodName })
  )
  assert.equal(lateAddInputs.length, 1)
  assert.equal(lateAddInputs[0].venueName, 'Forno Firenze')
  const results = lateAddInputs.map((input) => certifyLateAddItem(input))
  assert.equal(results.length, 1)
  assert.ok(results[0].verdict === 'CERTIFIED' || results[0].verdict === 'REJECTED')

  // researchOnlyCandidates has no venueName at all (null) — there is no
  // value to hand to LateAddItemInput.venueName (a required string), so this
  // candidate is structurally excluded from ever reaching certifyLateAddItem
  // without a human/researcher first identifying a real venue.
  assert.equal(packets.enrichment.researchOnlyCandidates.length, 1)
  assert.equal(packets.enrichment.researchOnlyCandidates[0].venueName, null)
})

// ---------------------------------------------------------------------------
// Catalog completeness packet mirrors finalAssessment honestly.
// ---------------------------------------------------------------------------

test('the catalog completeness packet mirrors finalAssessment.readyToFinish and next actions without alteration', () => {
  const report = baseReport({
    finalAssessment: { readyToFinish: false, recommendedAdditionalItemRange: { min: 10, max: 20 }, highestPriorityNextActions: ['Research Sports candidates'] },
  })
  const packets = buildMetroFinisherWorkPackets(report)
  assert.equal(packets.catalogCompleteness.readyToFinish, false)
  assert.deepEqual(packets.catalogCompleteness.recommendedAdditionalItemRange, { min: 10, max: 20 })
  assert.deepEqual(packets.catalogCompleteness.highestPriorityNextActions, ['Research Sports candidates'])
})
