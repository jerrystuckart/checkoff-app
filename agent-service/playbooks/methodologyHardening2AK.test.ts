// Chief Phase 2AK (2026-09-10) — regression tests for the Green Bay
// postmortem's generic methodology-hardening fixes. Each test is named
// after the numbered instruction it covers.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePlacesCompletenessGate, type PlacesCompletenessItemInput } from './placesCompletenessGate'
import { evaluateOpeningVerbConcentrationAudit, DEFAULT_WEAK_OPENER_WATCHLIST } from './catalogVoiceDiagnostics'
import { evaluateSameVenueClusterReviewGate } from './venueDuplicateDetection'
import { evaluateNeighborhoodCompletenessGate } from './neighborhoodCompletenessGate'
import { describeExecutionState, checkExecutionStateLanguage } from './executionStateLanguage'
import { certifyLateAddItem, type LateAddItemInput } from './lateAddItemCertification'
import { evaluateFinalReadyToApplyAudit } from './finalReadyToApplyAudit'

// --- 4. GOOGLE PLACES COMPLETENESS ---------------------------------------

test('PLACES_COMPLETENESS_GATE: FAILs when a real-venue item is missing any required field', () => {
  const items: PlacesCompletenessItemInput[] = [
    { candidateName: 'Complete Venue', classification: 'EXACT', googlePlaceId: 'p1', formattedAddress: '1 Main St, Green Bay, WI', mapsQuery: '1 Main St', lat: 44.5, lng: -88.0 },
    { candidateName: 'Missing Place Id', classification: 'EXACT', googlePlaceId: null, formattedAddress: '2 Main St, Green Bay, WI', mapsQuery: '2 Main St', lat: 44.5, lng: -88.0 },
  ]
  const result = evaluatePlacesCompletenessGate(items)
  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].candidateName, 'Missing Place Id')
  assert.deepEqual(result.findings[0].missingFields, ['google_place_id'])
})

test('PLACES_COMPLETENESS_GATE: NO_CANONICAL_VENUE items are exempt (events/routes/districts have no single venue)', () => {
  const items: PlacesCompletenessItemInput[] = [{ candidateName: 'A Regional Festival', classification: 'NO_CANONICAL_VENUE', googlePlaceId: null, formattedAddress: null, mapsQuery: null, lat: null, lng: null }]
  const result = evaluatePlacesCompletenessGate(items)
  assert.equal(result.verdict, 'PASS')
})

test('PLACES_COMPLETENESS_GATE: a late-added item gets NO exemption — same rule as an original-discovery item', () => {
  const lateAdd: PlacesCompletenessItemInput = { candidateName: 'Late Add Dive Bar', classification: 'EXACT', googlePlaceId: null, formattedAddress: null, mapsQuery: null, lat: null, lng: null }
  const result = evaluatePlacesCompletenessGate([lateAdd])
  assert.equal(result.verdict, 'FAIL')
})

// --- 6. OPENING-DISTRIBUTION / CATALOG VOICE -----------------------------

test('OPENING_VERB_CONCENTRATION_AUDIT: FAILs when watchlist openers collectively dominate even with no single word over 15%', () => {
  // 6 different watchlist words, none individually over 15% of 40 items, but combined >45%.
  const bodies = [
    ...Array(4).fill("Try the special at 'A'."),
    ...Array(4).fill("Sit at the bar at 'B'."),
    ...Array(4).fill("Sample the flight at 'C'."),
    ...Array(4).fill("Sip the cocktail at 'D'."),
    ...Array(4).fill("Ask for the secret menu at 'E'."),
    ...Array(4).fill("Walk the trail at 'F'."),
    ...Array(16).fill("Discover the mural at 'G'."),
  ]
  const result = evaluateOpeningVerbConcentrationAudit(bodies)
  assert.equal(result.verdict, 'FAIL')
  assert.ok(result.combinedSharePercent > 45)
})

test('OPENING_VERB_CONCENTRATION_AUDIT: PASSes a genuinely varied catalog', () => {
  const bodies = [
    "See the mural at 'A'.",
    "Climb the wall at 'B'.",
    "Watch the show at 'C'.",
    "Photograph the statue at 'D'.",
    "Ride the coaster at 'E'.",
    "Pet the goat at 'F'.",
    "Book the tour at 'G'.",
    "Enter the tunnel at 'H'.",
    "Play the game at 'I'.",
    "Learn the history at 'J'.",
    "Discover the trail at 'K'.",
    "Choose the flight at 'L'.",
  ]
  const result = evaluateOpeningVerbConcentrationAudit(bodies)
  assert.equal(result.verdict, 'PASS')
})

test('DEFAULT_WEAK_OPENER_WATCHLIST includes the words Jerry explicitly named', () => {
  for (const w of ['try', 'attend', 'take', 'sit', 'find', 'walk', 'visit', 'explore']) {
    assert.ok(DEFAULT_WEAK_OPENER_WATCHLIST.includes(w), `missing ${w}`)
  }
})

// --- 7. SAME-VENUE REVIEW -------------------------------------------------

test('SAME_VENUE_CLUSTER_REVIEW_GATE: always PASSes but reports every cluster explicitly', () => {
  const result = evaluateSameVenueClusterReviewGate([{ placeId: 'p1', members: [{ candidateName: 'A', placeId: 'p1', finalBody: 'x' }, { candidateName: 'B', placeId: 'p1', finalBody: 'y' }] }])
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.clusterCount, 1)
  assert.match(result.reason, /A, B/)
})

test('SAME_VENUE_CLUSTER_REVIEW_GATE: reports zero clusters honestly when there are none', () => {
  const result = evaluateSameVenueClusterReviewGate([])
  assert.equal(result.clusterCount, 0)
  assert.match(result.reason, /nothing to review/)
})

// --- 8. NEIGHBORHOOD COMPLETENESS -----------------------------------------

test('NEIGHBORHOOD_COMPLETENESS_GATE: always PASSes but names every zero-item canonical neighborhood explicitly', () => {
  const result = evaluateNeighborhoodCompletenessGate(['Downtown', 'Hobart', 'Allouez'], new Map([['Downtown', 5]]))
  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.emptyNeighborhoods, ['Hobart', 'Allouez'])
  assert.match(result.reason, /Hobart, Allouez/)
})

test('NEIGHBORHOOD_COMPLETENESS_GATE: accepts a plain Record as well as a Map', () => {
  const result = evaluateNeighborhoodCompletenessGate(['A', 'B'], { A: 3 })
  assert.deepEqual(result.emptyNeighborhoods, ['B'])
})

// --- 1. PRODUCTION EXECUTION STATE ----------------------------------------

test('describeExecutionState: GENERATED never claims production creation', () => {
  const text = describeExecutionState('GENERATED', 'The Dive Bars list')
  assert.match(text, /NOT executed/)
  assert.doesNotMatch(text, /was created/i)
})

test('checkExecutionStateLanguage: flags "was created" language for a GENERATED-only artifact', () => {
  const result = checkExecutionStateLanguage('The Dive Bars list was created in the database.', 'GENERATED')
  assert.equal(result.verdict, 'FAIL')
  assert.ok(result.violations.length > 0)
})

test('checkExecutionStateLanguage: does not flag the same language once APPLIED is the real state', () => {
  const result = checkExecutionStateLanguage('The Dive Bars list was created in the database.', 'APPLIED')
  assert.equal(result.verdict, 'PASS')
})

// --- 5. LATE-ADD PARITY ---------------------------------------------------

function baseLateAdd(overrides: Partial<LateAddItemInput> = {}): LateAddItemInput {
  return {
    candidateName: 'Dive Bar Candidate',
    venueName: "Rusty Anchor",
    body: "Order the $2 tallboy at 'Rusty Anchor' before the jukebox switches to karaoke.",
    dbCategory: 'Bar & drinks',
    tags: ['bar', 'dive-bar', 'cheap-drinks', 'karaoke', 'local', 'late-night'],
    neighborhoodName: 'Downtown Green Bay',
    places: { candidateName: 'Dive Bar Candidate', classification: 'EXACT', googlePlaceId: 'p123', formattedAddress: '1 Main St, Green Bay, WI', mapsQuery: '1 Main St', lat: 44.5, lng: -88.0 },
    existingProductionItems: [],
    ...overrides,
  }
}

test('certifyLateAddItem: CERTIFIES a fully-prepared late add that passes every required check', () => {
  const result = certifyLateAddItem(baseLateAdd())
  assert.equal(result.verdict, 'CERTIFIED', JSON.stringify(result.reasons))
})

test('certifyLateAddItem: REJECTS when Places data is incomplete — no lower standard for late adds', () => {
  const result = certifyLateAddItem(baseLateAdd({ places: { candidateName: 'x', classification: 'EXACT', googlePlaceId: null, formattedAddress: null, mapsQuery: null, lat: null, lng: null } }))
  assert.equal(result.verdict, 'REJECTED')
  assert.ok(result.reasons.some((r) => r.includes('Places field')))
})

test('certifyLateAddItem: REJECTS with a REUSE instruction when reconciliation finds a same-venue/same-experience match', () => {
  const existing = [{ id: 'existing-1', body: "Order the $2 tallboy at 'Rusty Anchor' before the jukebox switches to karaoke.", googlePlaceId: 'p123', formattedAddress: '1 Main St, Green Bay, WI', websiteUrl: null, lat: 44.5, lng: -88.0, mapsQuery: null }]
  const result = certifyLateAddItem(baseLateAdd({ existingProductionItems: existing }))
  assert.equal(result.verdict, 'REJECTED')
  assert.equal(result.reuseExistingItemId, 'existing-1')
})

test('certifyLateAddItem: REJECTS a generic/non-distinctive body — editorial quality is not skipped for late adds', () => {
  const result = certifyLateAddItem(baseLateAdd({ body: "Enjoy the nightlife at 'Rusty Anchor'." }))
  assert.equal(result.verdict, 'REJECTED')
  assert.ok(result.reasons.some((r) => r.includes('Editorial quality')))
})

test('certifyLateAddItem: REJECTS an out-of-range tag count', () => {
  const result = certifyLateAddItem(baseLateAdd({ tags: ['bar', 'dive-bar'] }))
  assert.equal(result.verdict, 'REJECTED')
  assert.ok(result.reasons.some((r) => r.includes('canonical tags')))
})

// --- 9. FINAL READY-TO-APPLY GATE -----------------------------------------

function goodFinalAuditInput() {
  return {
    outOfMarketContaminationVerdict: 'PASS' as const,
    allDuplicateClustersResolved: true,
    allItemsCertified: true,
    emptyNeighborhoods: [] as string[],
    placesCompletenessVerdict: 'PASS' as const,
    listTitlesWithInternalPrefix: [] as string[],
    homeList: { packageValid: true, itemProvenanceValid: true } as { packageValid: boolean; itemProvenanceValid: boolean; liveVerificationValid?: boolean },
    reusedItemsAdditiveOnly: true,
    sqlSafetyVerdict: 'PASS' as const,
    executionState: 'GENERATED' as const,
  }
}

test('evaluateFinalReadyToApplyAudit: READY_TO_APPLY when every check passes, and names the real execution state', () => {
  const result = evaluateFinalReadyToApplyAudit(goodFinalAuditInput())
  assert.equal(result.verdict, 'READY_TO_APPLY')
  assert.match(result.reasons[0], /GENERATED/)
  assert.match(result.reasons[0], /NOT executed/)
})

test('evaluateFinalReadyToApplyAudit: BLOCKED when a list title still carries an internal prefix', () => {
  const result = evaluateFinalReadyToApplyAudit({ ...goodFinalAuditInput(), listTitlesWithInternalPrefix: ['Themed list: Dive Bars'] })
  assert.equal(result.verdict, 'BLOCKED')
  assert.ok(result.reasons.some((r) => r.includes('Themed list: Dive Bars')))
})

test('evaluateFinalReadyToApplyAudit: BLOCKED when a required check result is simply missing (never silently skipped)', () => {
  const input = goodFinalAuditInput() as any
  delete input.sqlSafetyVerdict
  const result = evaluateFinalReadyToApplyAudit(input)
  assert.equal(result.verdict, 'BLOCKED')
  assert.ok(result.reasons.some((r) => r.includes('SQL safety check: result missing')))
})

test('evaluateFinalReadyToApplyAudit: BLOCKED on unresolved duplicate venue clusters', () => {
  const result = evaluateFinalReadyToApplyAudit({ ...goodFinalAuditInput(), allDuplicateClustersResolved: false, unresolvedDuplicateClusterCount: 2 })
  assert.equal(result.verdict, 'BLOCKED')
  assert.ok(result.reasons.some((r) => r.includes('2 same-Place-ID cluster')))
})

test('evaluateFinalReadyToApplyAudit: empty neighborhoods alone never block (accepted fact, not a failure)', () => {
  const result = evaluateFinalReadyToApplyAudit({ ...goodFinalAuditInput(), emptyNeighborhoods: ['Hobart', 'Allouez'] })
  assert.equal(result.verdict, 'READY_TO_APPLY')
})
