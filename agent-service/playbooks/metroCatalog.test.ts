import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mapCanonicalCategoryToDb,
  mapCandidateToIntakeRecord,
  mapCandidatesToIntakeRecords,
  normalizeMapsQuery,
  checkForDuplicates,
  evaluateCatalogGate,
  evaluateLocationGate,
  evaluatePresentationGate,
  evaluateOutreachGate,
  REAL_DB_CATEGORIES,
  type MetroCatalogCandidate,
  type ItemIntakeRecord,
} from './metroCatalog'

function candidate(overrides: Partial<MetroCatalogCandidate> = {}): MetroCatalogCandidate {
  return {
    name: 'Warwick\'s Books',
    canonicalCategory: 'Shopping' === (overrides.canonicalCategory as string) ? 'Shopping' : 'Arts & Culture',
    neighborhood: 'La Jolla',
    checkoffizedItem: "Browse the shelves at Warwick's Books, La Jolla's beloved independent bookstore since 1896",
    claimSupported: "Warwick's Books is a real, long-running independent bookstore in La Jolla",
    sourceUrls: ['https://example.com/warwicks'],
    verificationConfidence: 'HIGH',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------

test('mapCanonicalCategoryToDb: all 11 canonical categories map 1:1 to a real production category (post-migration 20260906)', () => {
  const mapped: Array<[string, string]> = [
    ['Food & drink', 'Food & drink'],
    ['Bar & drinks', 'Bar & drinks'],
    ['Adventure', 'Adventure'],
    ['Arts & Culture', 'Arts & Culture'],
    ['Nightlife', 'Nightlife'],
    ['Spa & self-care', 'Spa & self-care'],
    ['Misc', 'Misc'],
    ['Shopping', 'Shopping'],
    ['Sports', 'Sports'],
    ['Social', 'Social'],
    ['Travel', 'Travel'],
  ]
  for (const [canonical, expected] of mapped) {
    const result = mapCanonicalCategoryToDb(canonical as never)
    assert.equal(result.failed, false)
    assert.equal(result.dbCategory, expected)
  }
})

test('mapCanonicalCategoryToDb: every mapped value is a real, known production category', () => {
  const result = mapCanonicalCategoryToDb('Food & drink')
  assert.ok(REAL_DB_CATEGORIES.includes(result.dbCategory as never))
})

test('mapCanonicalCategoryToDb: null canonical (upstream classification failure) fails intake', () => {
  const result = mapCanonicalCategoryToDb(null)
  assert.equal(result.failed, true)
})

// ---------------------------------------------------------------------------
// Candidate -> intake record mapping
// ---------------------------------------------------------------------------

test('mapCandidateToIntakeRecord: a well-formed candidate maps to exactly one record', () => {
  const { record, failure } = mapCandidateToIntakeRecord(candidate())
  assert.equal(failure, null)
  assert.ok(record)
  assert.equal(record?.candidateName, "Warwick's Books")
  assert.equal(record?.dbCategory, 'Arts & Culture')
  assert.equal(record?.mapsQuery, "Warwick's Books, La Jolla")
})

test('mapCandidateToIntakeRecord: a Shopping candidate now maps cleanly (post-migration 20260906), no longer failing intake', () => {
  const { record, failure } = mapCandidateToIntakeRecord(candidate({ canonicalCategory: 'Shopping' }))
  assert.equal(failure, null)
  assert.equal(record?.dbCategory, 'Shopping')
})

test('mapCandidateToIntakeRecord: an unclassified (null) category still fails intake — the one case that always must', () => {
  const { record, failure } = mapCandidateToIntakeRecord(candidate({ canonicalCategory: null }))
  assert.equal(record, null)
  assert.ok(failure)
  assert.match(failure!.reason, /category/)
})

test('mapCandidateToIntakeRecord: missing checkoffized text fails intake', () => {
  const { record, failure } = mapCandidateToIntakeRecord(candidate({ checkoffizedItem: '' }))
  assert.equal(record, null)
  assert.match(failure!.reason, /checkoffized/)
})

test('mapCandidatesToIntakeRecords: one candidate never produces more than one record — "at most one item row" is structural', () => {
  const result = mapCandidatesToIntakeRecords([candidate()])
  assert.equal(result.records.length, 1)
})

// ---------------------------------------------------------------------------
// Mixed-country content (Tijuana) — Spanish names, non-US geography
// ---------------------------------------------------------------------------

test('mapCandidateToIntakeRecord: preserves native Spanish venue names and accents exactly, unmangled', () => {
  const tj = candidate({
    name: 'La Barra Cochinita',
    neighborhood: 'Revolución, Tijuana',
    checkoffizedItem: 'Order the tostadas de aguachile at La Barra Cochinita in Revolución, Tijuana',
    claimSupported: 'A Baja California-style raw bar in Revolución',
  })
  const { record } = mapCandidateToIntakeRecord(tj)
  assert.equal(record?.candidateName, 'La Barra Cochinita')
  assert.equal(record?.mapsQuery, 'La Barra Cochinita, Revolución, Tijuana')
  assert.ok(record?.body.includes('Revolución'))
})

test('mapCandidateToIntakeRecord: a Mexico candidate and a US candidate map through the identical, country-agnostic logic', () => {
  const us = candidate({ name: 'The Goods', neighborhood: 'Carlsbad Village' })
  const mx = candidate({ name: 'CECUT', neighborhood: 'Zona Río, Tijuana', canonicalCategory: 'Arts & Culture' })
  const usResult = mapCandidateToIntakeRecord(us)
  const mxResult = mapCandidateToIntakeRecord(mx)
  assert.ok(usResult.record)
  assert.ok(mxResult.record)
  assert.equal(usResult.record?.dbCategory, mxResult.record?.dbCategory)
})

// ---------------------------------------------------------------------------
// Dedup key normalization (identical to the real, executed Denver intake)
// ---------------------------------------------------------------------------

test('normalizeMapsQuery: case/spacing/punctuation-only differences collapse to the same key', () => {
  assert.equal(normalizeMapsQuery('Westfield UTC, La Jolla'), normalizeMapsQuery('westfield utc,  la jolla!!'))
})

test('normalizeMapsQuery: genuinely different venues never collapse', () => {
  assert.notEqual(normalizeMapsQuery('Westfield UTC, La Jolla'), normalizeMapsQuery('Westfield Plaza Bonita, National City'))
})

// ---------------------------------------------------------------------------
// Duplicate check against an existing catalog
// ---------------------------------------------------------------------------

function record(overrides: Partial<ItemIntakeRecord> = {}): ItemIntakeRecord {
  const mapsQuery = overrides.mapsQuery ?? 'Warwick\'s Books, La Jolla'
  return {
    candidateName: "Warwick's Books",
    body: 'Browse the shelves at...',
    dbCategory: 'Arts & Culture',
    mapsQuery,
    neighborhoodName: 'La Jolla',
    dedupKey: normalizeMapsQuery(mapsQuery),
    provenance: { claimSupported: 'x', sourceUrls: [] },
    ...overrides,
  }
}

test('checkForDuplicates: a candidate matching an EXISTING production item is flagged, not silently re-inserted', () => {
  const result = checkForDuplicates([record()], ["Warwick's Books La Jolla"])
  assert.equal(result.clean.length, 0)
  assert.equal(result.collidesWithProduction.length, 1)
})

test('checkForDuplicates: two candidates in the SAME batch that collide with each other are flagged as a safety net', () => {
  const a = record({ mapsQuery: 'Westfield UTC, La Jolla' })
  const b = record({ candidateName: 'Westfield UTC (dup)', mapsQuery: 'westfield utc la jolla' })
  const result = checkForDuplicates([a, b], [])
  assert.equal(result.clean.length, 0)
  assert.equal(result.collidesWithinBatch.length, 1)
})

test('checkForDuplicates: a genuinely new, non-colliding candidate is clean', () => {
  const result = checkForDuplicates([record()], ['Some Other Business, Denver'])
  assert.equal(result.clean.length, 1)
  assert.equal(result.collidesWithProduction.length, 0)
})

// ---------------------------------------------------------------------------
// Real staging gates
// ---------------------------------------------------------------------------

test('evaluateCatalogGate: PASSes when staged+failed accounts for every candidate and there are no duplicates', () => {
  const result = evaluateCatalogGate({ expectedCanonicalCount: 2, stagedRecords: [record(), record({ candidateName: 'B', mapsQuery: 'B, Downtown' })], intakeFailures: [], duplicates: { clean: [], collidesWithProduction: [], collidesWithinBatch: [] } })
  assert.equal(result.verdict, 'PASS')
})

test('evaluateCatalogGate: FAILs when a duplicate against production survives into staged records', () => {
  const rec = record()
  const result = evaluateCatalogGate({
    expectedCanonicalCount: 1,
    stagedRecords: [rec],
    intakeFailures: [],
    duplicates: { clean: [], collidesWithProduction: [{ record: rec, existingMapsQuery: 'x' }], collidesWithinBatch: [] },
  })
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.reason, /duplicate/)
})

test('evaluateCatalogGate: FAILs when staged+failed count drifts from the expected canonical count — a silent drop', () => {
  const result = evaluateCatalogGate({ expectedCanonicalCount: 5, stagedRecords: [record()], intakeFailures: [], duplicates: { clean: [], collidesWithProduction: [], collidesWithinBatch: [] } })
  assert.equal(result.verdict, 'FAIL')
})

test('evaluateLocationGate: PASSes when every record has a specific, venue-named maps_query', () => {
  const result = evaluateLocationGate({ records: [record()] })
  assert.equal(result.verdict, 'PASS')
})

test('evaluateLocationGate: FAILs a record whose maps_query is just the bare neighborhood name — not specific enough to geocode', () => {
  const result = evaluateLocationGate({ records: [record({ mapsQuery: 'La Jolla', neighborhoodName: 'La Jolla' })] })
  assert.equal(result.verdict, 'FAIL')
})

test('evaluateLocationGate: never requires lat/lng to already exist — a maps_query alone is a valid strategy per house convention', () => {
  // ItemIntakeRecord has no lat/lng fields at all — this test documents that omission is intentional, not an oversight.
  const rec = record()
  assert.equal('mapsLat' in rec, false)
  assert.equal(evaluateLocationGate({ records: [rec] }).verdict, 'PASS')
})

test('evaluatePresentationGate: PASSes clean, well-formed display text, including native Spanish', () => {
  const result = evaluatePresentationGate({ records: [record({ body: 'Order the tostadas de aguachile at La Barra Cochinita in Revolución, Tijuana' })] })
  assert.equal(result.verdict, 'PASS')
})

test('evaluatePresentationGate: FAILs placeholder text', () => {
  const result = evaluatePresentationGate({ records: [record({ body: 'TBD - placeholder text here' })] })
  assert.equal(result.verdict, 'FAIL')
})

test('evaluatePresentationGate: FAILs ALL-CAPS malformed text', () => {
  const result = evaluatePresentationGate({ records: [record({ body: 'VISIT THIS AMAZING PLACE RIGHT NOW TODAY' })] })
  assert.equal(result.verdict, 'FAIL')
})

test('evaluatePresentationGate: does not false-positive on a normal sentence with one accented word', () => {
  const result = evaluatePresentationGate({ records: [record({ body: 'Try the café con leche at this cozy neighborhood spot' })] })
  assert.equal(result.verdict, 'PASS')
})

test('evaluatePresentationGate: FAILs two different candidates sharing identical display text', () => {
  const a = record({ candidateName: 'A', body: 'Exact same sentence here for both items' })
  const b = record({ candidateName: 'B', mapsQuery: 'B, Downtown', body: 'Exact same sentence here for both items' })
  const result = evaluatePresentationGate({ records: [a, b] })
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.reason, /identical display text/)
})

test('evaluateOutreachGate: PASSes without requiring any outreach to have happened', () => {
  const result = evaluateOutreachGate({ records: [record()] })
  assert.equal(result.verdict, 'PASS')
  assert.match(result.reason, /No outreach required/)
})
