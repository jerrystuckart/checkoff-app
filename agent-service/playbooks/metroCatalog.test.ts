import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mapCanonicalCategoryToDb,
  mapCandidateToIntakeRecord,
  mapCandidatesToIntakeRecords,
  normalizeMapsQuery,
  checkForDuplicates,
  resolveNeighborhoods,
  findSemanticDuplicates,
  dedupeSemanticDuplicates,
  runIntakePipeline,
  evaluateCatalogGate,
  evaluateLocationGate,
  evaluatePresentationGate,
  evaluateOutreachGate,
  evaluateEditorialQualityGate,
  buildFeaturedExperienceBridgeCard,
  validateFeaturedExperienceBridgeCard,
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

test('evaluateCatalogGate: PASSes even when candidates were excluded for a legitimate category-mapping failure — that is the pipeline working, not a gate violation', () => {
  const result = evaluateCatalogGate({
    expectedCanonicalCount: 2,
    stagedRecords: [record()],
    intakeFailures: [{ candidateName: 'Vague Candidate', reason: 'candidate has no canonical category at all (unclassified upstream)' }],
    duplicates: { clean: [], collidesWithProduction: [], collidesWithinBatch: [] },
  })
  assert.equal(result.verdict, 'PASS')
  assert.match(result.reason, /legitimately excluded/)
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

test('evaluatePresentationGate: FAILs meta/process language leaking into body text (regression: Fleurette (redundant?))', () => {
  const result = evaluatePresentationGate({ records: [record({ candidateName: 'Fleurette (redundant?)', body: 'Fleurette has already been counted and does not require a new checkoff item.' })] })
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.reason, /meta\/process language/)
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

// ---------------------------------------------------------------------------
// Neighborhood resolution
// ---------------------------------------------------------------------------

test('resolveNeighborhoods: resolves obvious free-text variants to the one canonical name', () => {
  const canonical = ['La Jolla', 'Carlsbad', 'Downtown']
  const records = [record({ candidateName: 'A', neighborhoodName: 'La Jolla (UTC)' }), record({ candidateName: 'B', neighborhoodName: 'University City / La Jolla area' })]
  const result = resolveNeighborhoods(records, canonical)
  assert.equal(result.resolved.get('A'), 'La Jolla')
  assert.equal(result.resolved.get('B'), 'La Jolla')
  assert.equal(result.unresolved.length, 0)
})

test('resolveNeighborhoods: longest match wins when one canonical name is a substring of another\'s text', () => {
  const canonical = ['Otay', 'Otay Mesa']
  const records = [record({ candidateName: 'A', neighborhoodName: 'Otay Mesa, Tijuana' })]
  const result = resolveNeighborhoods(records, canonical)
  assert.equal(result.resolved.get('A'), 'Otay Mesa')
})

test('resolveNeighborhoods: no canonical match fails resolution, never guesses', () => {
  const canonical = ['La Jolla', 'Carlsbad']
  const records = [record({ candidateName: 'A', neighborhoodName: 'Some Unknown Place' })]
  const result = resolveNeighborhoods(records, canonical)
  assert.equal(result.resolved.size, 0)
  assert.equal(result.unresolved.length, 1)
})

test('resolveNeighborhoods: country consistency — a Mexico-signaled candidate never resolves to a California neighborhood via a same-word alias (regression: Estación Federal/La Mezcalera/Rubiks)', () => {
  const canonical = ['Gaslamp Quarter', 'Zona Centro']
  const aliases = { downtown: 'Gaslamp Quarter' }
  const mexico = new Set(['Zona Centro'])
  const records = [record({ candidateName: 'Estación Federal', neighborhoodName: 'Downtown Tijuana near PedWest crossing' })]
  const result = resolveNeighborhoods(records, canonical, aliases, mexico)
  assert.equal(result.resolved.size, 0)
  assert.match(result.unresolved[0].reason, /country mismatch/)
})

test('resolveNeighborhoods: country consistency still resolves correctly once a Mexico-specific alias exists', () => {
  const canonical = ['Gaslamp Quarter', 'Zona Centro']
  const aliases = { downtown: 'Gaslamp Quarter', 'downtown tijuana': 'Zona Centro' }
  const mexico = new Set(['Zona Centro'])
  const records = [record({ candidateName: 'Estación Federal', neighborhoodName: 'Downtown Tijuana near PedWest crossing' })]
  const result = resolveNeighborhoods(records, canonical, aliases, mexico)
  assert.equal(result.resolved.get('Estación Federal'), 'Zona Centro')
})

test('resolveNeighborhoods: a genuine US candidate is unaffected by the Mexico check', () => {
  const canonical = ['Gaslamp Quarter', 'Zona Centro']
  const aliases = { downtown: 'Gaslamp Quarter' }
  const mexico = new Set(['Zona Centro'])
  const records = [record({ candidateName: 'Some Bar', neighborhoodName: 'Downtown San Diego' })]
  const result = resolveNeighborhoods(records, canonical, aliases, mexico)
  assert.equal(result.resolved.get('Some Bar'), 'Gaslamp Quarter')
})

test('resolveNeighborhoods: an alias resolves a real landmark whose text never names its containing canonical neighborhood', () => {
  const canonical = ['Zona Centro', 'Zona Río']
  const records = [record({ candidateName: 'A', neighborhoodName: 'Avenida Revolución (near border)' })]
  const result = resolveNeighborhoods(records, canonical, { 'avenida revolución': 'Zona Centro' })
  assert.equal(result.resolved.get('A'), 'Zona Centro')
})

test('resolveNeighborhoods: a direct canonical match always wins over an alias, never overridden', () => {
  const canonical = ['Zona Centro', 'Zona Río']
  const records = [record({ candidateName: 'A', neighborhoodName: 'Zona Río, near Avenida Revolución' })]
  const result = resolveNeighborhoods(records, canonical, { 'avenida revolución': 'Zona Centro' })
  assert.equal(result.resolved.get('A'), 'Zona Río')
})

test('resolveNeighborhoods: a non-breaking space in the raw text does not block a canonical match (regression: real research text used U+00A0 in "Point Loma"/"Little Italy")', () => {
  const canonical = ['Point Loma', 'Little Italy']
  const records = [
    record({ candidateName: 'Cori Pastificio Trattoria', neighborhoodName: 'Point Loma' }),
    record({ candidateName: 'Herb & Wood', neighborhoodName: 'Little Italy' }),
  ]
  const result = resolveNeighborhoods(records, canonical)
  assert.equal(result.resolved.get('Cori Pastificio Trattoria'), 'Point Loma')
  assert.equal(result.resolved.get('Herb & Wood'), 'Little Italy')
  assert.equal(result.unresolved.length, 0)
})

test('resolveNeighborhoods: falls back to the candidate\'s own name when the free-text neighborhood is too generic (regression: "Balboa Park" recorded neighborhood was just "Central San Diego")', () => {
  const canonical = ['Balboa Park', 'Gaslamp Quarter']
  const records = [record({ candidateName: 'Balboa Park', neighborhoodName: 'Central San Diego' })]
  const result = resolveNeighborhoods(records, canonical)
  assert.equal(result.resolved.get('Balboa Park'), 'Balboa Park')
})

test('resolveNeighborhoods: the name fallback never overrides a real match already found in the neighborhood text', () => {
  const canonical = ['Balboa Park', 'Gaslamp Quarter']
  // Contrived: a candidate literally named "Balboa Park" but whose neighborhood text names a different real canonical area — the text should win.
  const records = [record({ candidateName: 'Balboa Park Gift Shop', neighborhoodName: 'Gaslamp Quarter' })]
  const result = resolveNeighborhoods(records, canonical)
  assert.equal(result.resolved.get('Balboa Park Gift Shop'), 'Gaslamp Quarter')
})

test('resolveNeighborhoods: a candidate with genuinely no recognizable neighborhood still fails resolution — the name fallback is not a way to guess', () => {
  const canonical = ['Balboa Park', 'Gaslamp Quarter']
  const records = [record({ candidateName: 'VAVi Sport & Social Club', neighborhoodName: 'San Diego' })]
  const result = resolveNeighborhoods(records, canonical)
  assert.equal(result.resolved.size, 0)
})

test('resolveNeighborhoods: a verified name override resolves a named business whose recorded text was too generic (regression: real "Callie" tagged only "San Diego (general)", verified via a targeted lookup to East Village)', () => {
  const canonical = ['East Village', 'Gaslamp Quarter']
  const records = [record({ candidateName: 'Callie', neighborhoodName: 'San Diego (general)' })]
  const overrides = new Map([['Callie', 'East Village']])
  const result = resolveNeighborhoods(records, canonical, {}, new Set(), overrides)
  assert.equal(result.resolved.get('Callie'), 'East Village')
})

test('resolveNeighborhoods: a verified name override never fires when a real match already exists in the text — the override is last-resort only', () => {
  const canonical = ['East Village', 'Gaslamp Quarter']
  const records = [record({ candidateName: 'Callie', neighborhoodName: 'Gaslamp Quarter' })]
  const overrides = new Map([['Callie', 'East Village']])
  const result = resolveNeighborhoods(records, canonical, {}, new Set(), overrides)
  assert.equal(result.resolved.get('Callie'), 'Gaslamp Quarter')
})

test('resolveNeighborhoods: a name override with no matching candidate in the batch has no effect', () => {
  const canonical = ['East Village']
  const records = [record({ candidateName: 'Someone Else', neighborhoodName: 'San Diego' })]
  const overrides = new Map([['Callie', 'East Village']])
  const result = resolveNeighborhoods(records, canonical, {}, new Set(), overrides)
  assert.equal(result.resolved.size, 0)
})

test('resolveNeighborhoods: missing neighborhood text fails resolution', () => {
  const canonical = ['La Jolla']
  const records = [record({ candidateName: 'A', neighborhoodName: null })]
  const result = resolveNeighborhoods(records, canonical)
  assert.equal(result.unresolved[0].reason, 'no neighborhood text at all')
})

// ---------------------------------------------------------------------------
// Semantic same-venue duplicate detection (San Diego catalog SQL review, 2026-09-06)
// ---------------------------------------------------------------------------

test('findSemanticDuplicates: catches a parenthetical-qualifier duplicate (regression: Zuma / Zuma (Guild Hotel))', () => {
  const a = record({ candidateName: 'Zuma', mapsQuery: 'Zuma, Downtown' })
  const b = record({ candidateName: 'Zuma (Guild Hotel)', mapsQuery: 'Zuma, Guild Hotel, Downtown' })
  const groups = findSemanticDuplicates([a, b])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].matchKind, 'exact')
  assert.equal(groups[0].members.length, 2)
})

test('findSemanticDuplicates: catches a nickname-in-quotes duplicate (regression: Joan and Irwin Jacobs Performing Arts Center / "The Joan")', () => {
  const a = record({ candidateName: 'Joan and Irwin Jacobs Performing Arts Center', mapsQuery: 'x' })
  const b = record({ candidateName: 'Joan and Irwin Jacobs Performing Arts Center ("The Joan")', mapsQuery: 'y' })
  const groups = findSemanticDuplicates([a, b])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].matchKind, 'exact')
})

test('findSemanticDuplicates: catches a dropped-generic-suffix duplicate (regression: Fashion Valley Mall / Fashion Valley)', () => {
  const a = record({ candidateName: 'Fashion Valley Mall', mapsQuery: 'x' })
  const b = record({ candidateName: 'Fashion Valley', mapsQuery: 'y' })
  const groups = findSemanticDuplicates([a, b])
  assert.equal(groups.length, 1)
})

test('findSemanticDuplicates: catches a re-worded name via token overlap (regression: Harland Clubhouse / Harland Brewing Co. – The Clubhouse)', () => {
  const a = record({ candidateName: 'Harland Clubhouse', mapsQuery: 'x' })
  const b = record({ candidateName: 'Harland Brewing Co. – The Clubhouse', mapsQuery: 'y' })
  const groups = findSemanticDuplicates([a, b])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].matchKind, 'similar')
})

test('findSemanticDuplicates: catches the redundant-marker self-duplicate (regression: Fleurette / Fleurette (redundant?))', () => {
  const a = record({ candidateName: 'Fleurette', mapsQuery: 'x' })
  const b = record({ candidateName: 'Fleurette (redundant?)', mapsQuery: 'y' })
  const groups = findSemanticDuplicates([a, b])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].matchKind, 'exact')
})

test('findSemanticDuplicates: does not over-merge distinct venues that only share the city name (regression: San Diego Padres wrongly grouped with San Diego Zoo/SeaWorld/etc.)', () => {
  const padres = record({ candidateName: 'San Diego Padres', mapsQuery: 'a' })
  const zoo = record({ candidateName: 'San Diego Zoo', mapsQuery: 'b' })
  const seaworld = record({ candidateName: 'SeaWorld San Diego', mapsQuery: 'c' })
  const groups = findSemanticDuplicates([padres, zoo, seaworld])
  assert.equal(groups.length, 0)
})

test('findSemanticDuplicates: does not over-merge two completely unrelated museums sharing only generic descriptor words (regression: Timken Museum of Art / Oceanside Museum of Art)', () => {
  const a = record({ candidateName: 'Timken Museum of Art', mapsQuery: 'a' })
  const b = record({ candidateName: 'Oceanside Museum of Art', mapsQuery: 'b' })
  const groups = findSemanticDuplicates([a, b])
  assert.equal(groups.length, 0)
})

test('findSemanticDuplicates: does not over-merge two distinct real facilities that happen to share a facility-type word (regression: San Diego Zoo / San Diego Zoo Safari Park are different physical locations)', () => {
  const a = record({ candidateName: 'San Diego Zoo', mapsQuery: 'a' })
  const b = record({ candidateName: 'San Diego Zoo Safari Park', mapsQuery: 'b' })
  assert.equal(findSemanticDuplicates([a, b]).length, 0)
})

test('findSemanticDuplicates: additionalGenericWords excludes a shared neighborhood name from counting as venue identity (regression: Oceanside Pier / Oceanside Museum of Art)', () => {
  const a = record({ candidateName: 'Oceanside Pier', mapsQuery: 'a' })
  const b = record({ candidateName: 'Oceanside Museum of Art', mapsQuery: 'b' })
  const withoutExclusion = findSemanticDuplicates([a, b])
  assert.equal(withoutExclusion.length, 1) // confirms the bug is real without the exclusion
  const withExclusion = findSemanticDuplicates([a, b], new Set(['oceanside']))
  assert.equal(withExclusion.length, 0)
})

test('findSemanticDuplicates: does not over-merge two distinct recurring markets sharing only generic event-type words (regression: Gaslamp Artisan Market / Tianguis de la Raza Artisan Market)', () => {
  const a = record({ candidateName: 'Gaslamp Artisan Market', mapsQuery: 'a' })
  const b = record({ candidateName: 'Tianguis de la Raza Artisan Market', mapsQuery: 'b' })
  const groups = findSemanticDuplicates([a, b], new Set(['gaslamp']))
  assert.equal(groups.length, 0)
})

test('findSemanticDuplicates: does not over-merge two genuinely different La Jolla venues sharing only a place name', () => {
  const a = record({ candidateName: 'La Jolla Cove', mapsQuery: 'x' })
  const b = record({ candidateName: 'La Jolla Village Merchants Association', mapsQuery: 'y' })
  const groups = findSemanticDuplicates([a, b])
  assert.equal(groups.length, 0)
})

test('findSemanticDuplicates: unrelated venues never group', () => {
  const a = record({ candidateName: 'Warwick’s Books', mapsQuery: 'x' })
  const b = record({ candidateName: 'Titan Missile Museum', mapsQuery: 'y' })
  assert.equal(findSemanticDuplicates([a, b]).length, 0)
})

test('dedupeSemanticDuplicates: keeps the most complete representative and removes the rest', () => {
  const thin = record({ candidateName: 'Zuma', mapsQuery: 'x', body: 'short' })
  const rich = record({ candidateName: 'Zuma (Guild Hotel)', mapsQuery: 'y', body: 'A much longer, more detailed description of this real restaurant' })
  rich.provenance = { ...rich.provenance, verificationConfidence: 'HIGH' }
  const { deduped, removed } = dedupeSemanticDuplicates([thin, rich])
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].candidateName, 'Zuma (Guild Hotel)')
  assert.equal(removed.length, 1)
})

test('findSemanticDuplicates: a confirmedDistinctPairs entry stops two genuinely different venues from being collapsed even though their names score above the similarity threshold (regression: Chicano Park / Chicano Park Museum & Cultural Center — the outdoor mural landmark vs. a separate indoor building)', () => {
  const park = record({ candidateName: 'Chicano Park', mapsQuery: 'x', body: 'See the largest collection of Chicano murals at Chicano Park' })
  const museum = record({ candidateName: 'Chicano Park Museum & Cultural Center', mapsQuery: 'y', body: 'Visit the indoor museum celebrating the park\'s muralists at Chicano Park Museum & Cultural Center' })
  // Without the pair listed, these DO collide (documents the real bug this fixes).
  assert.equal(findSemanticDuplicates([park, museum]).length, 1)
  // With the pair listed as confirmed-distinct, neither is grouped.
  const withException = findSemanticDuplicates([park, museum], new Set(), [['Chicano Park', 'Chicano Park Museum & Cultural Center']])
  assert.equal(withException.length, 0)
  const { deduped } = dedupeSemanticDuplicates([park, museum], new Set(), [['Chicano Park', 'Chicano Park Museum & Cultural Center']])
  assert.equal(deduped.length, 2)
})

test('findSemanticDuplicates: confirmedDistinctPairs does not affect an unrelated pair in the same batch', () => {
  const park = record({ candidateName: 'Chicano Park', mapsQuery: 'x' })
  const museum = record({ candidateName: 'Chicano Park Museum & Cultural Center', mapsQuery: 'y' })
  const zuma1 = record({ candidateName: 'Zuma', mapsQuery: 'z1', body: 'short' })
  const zuma2 = record({ candidateName: 'Zuma (Guild Hotel)', mapsQuery: 'z2', body: 'A much longer, more detailed description' })
  const groups = findSemanticDuplicates([park, museum, zuma1, zuma2], new Set(), [['Chicano Park', 'Chicano Park Museum & Cultural Center']])
  assert.equal(groups.length, 1)
  assert.ok(groups[0].members.some((m) => m.candidateName === 'Zuma'))
})

test('evaluateOutreachGate: PASSes without requiring any outreach to have happened', () => {
  const result = evaluateOutreachGate({ records: [record()] })
  assert.equal(result.verdict, 'PASS')
  assert.match(result.reason, /No outreach required/)
})

// ---------------------------------------------------------------------------
// EDITORIAL_GATE — San Diego CheckOffization quality regression (2026-09):
// Jerry found large real-production clusters of items opening with the
// same generic verbs (Savor, Experience, Sip, Shop, Catch, Dance)
// describing a generic venue visit instead of naming a distinctive thing
// to do/order/find. These tests prove the gate reproduces exactly that
// finding mechanically, and correctly passes genuinely specific,
// non-templated copy.
// ---------------------------------------------------------------------------

test('evaluateEditorialQualityGate: FAILs a batch where one opening word covers more than 15% of items (regression: real production had "Savor" at 33%, "Experience" at 17%)', () => {
  const records = [
    record({ candidateName: 'A', body: 'Savor the tacos at A' }),
    record({ candidateName: 'B', body: 'Savor the burgers at B' }),
    record({ candidateName: 'C', body: 'Savor the pasta at C' }),
    record({ candidateName: 'D', body: 'Order the signature ramen at D' }),
    record({ candidateName: 'E', body: 'Try the off-menu dish at E' }),
    record({ candidateName: 'F', body: 'Sit in the hidden booth at F' }),
    record({ candidateName: 'G', body: 'Ride the wooden coaster at G' }),
    record({ candidateName: 'H', body: 'Ask for the secret pour at H' }),
    record({ candidateName: 'I', body: 'Find the mural room at I' }),
    record({ candidateName: 'J', body: 'Climb the lighthouse at J' }),
  ]
  const result = evaluateEditorialQualityGate({ records })
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.reason, /Savor/i)
  assert.match(result.reason, /30%/)
})

test('evaluateEditorialQualityGate: PASSes a batch with a healthy, non-repeating opening-word distribution', () => {
  const records = [
    record({ candidateName: 'A', body: 'Order the signature dry-aged burger at A' }),
    record({ candidateName: 'B', body: 'Find the hidden speakeasy behind the bookshelf at B' }),
    record({ candidateName: 'C', body: 'Ride the 600-foot zip line at C' }),
    record({ candidateName: 'D', body: 'Ask for the off-menu omakase at D' }),
    record({ candidateName: 'E', body: 'Photograph the sunset viewpoint at E' }),
    record({ candidateName: 'F', body: 'Try the tonkotsu ramen bowl at F, a local favorite since 1998' }),
    record({ candidateName: 'G', body: 'Sit at the chef\'s counter for the 12-course tasting at G' }),
    record({ candidateName: 'H', body: 'Climb the 27-foot climbing wall at H' }),
    record({ candidateName: 'I', body: 'Kayak through the sea caves at I' }),
    record({ candidateName: 'J', body: 'Sip the barrel-aged Negroni at J' }),
  ]
  const result = evaluateEditorialQualityGate({ records })
  assert.equal(result.verdict, 'PASS')
})

test('evaluateEditorialQualityGate: FAILs a body with no concrete dish/feature/number — "could describe dozens of unrelated venues" (regression: real "Savor diverse artisan vendors and retail" at Liberty Public Market)', () => {
  const result = evaluateEditorialQualityGate({ records: [record({ candidateName: 'Liberty Public Market', body: 'Savor diverse artisan vendors and retail at Liberty Public Market' })] })
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.reason, /dozens of unrelated venues/)
})

test('evaluateEditorialQualityGate: PASSes a body that names a specific dish, even though it opens with a generic verb — the verb itself is never individually banned', () => {
  const result = evaluateEditorialQualityGate({ records: [record({ candidateName: 'Aqui Es Texcoco', body: 'Savor authentic barbacoa de borrego at Aqui Es Texcoco' })] })
  assert.equal(result.verdict, 'PASS')
})

test('evaluateEditorialQualityGate: FAILs ranking/superlative filler with no specific fact backing it up (regression: real "hailed as the Best Ballpark in America" with nothing else concrete)', () => {
  const result = evaluateEditorialQualityGate({ records: [record({ candidateName: 'Petco Park', body: 'Catch thrilling Padres baseball action at San Diego’s Petco Park, hailed as the Best Ballpark in America.' })] })
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.reason, /ranking\/superlative filler/)
})

test('evaluateEditorialQualityGate: PASSes a superlative when it is itself the specific, checkable fact (regression: real "only three-Michelin-star restaurant")', () => {
  const result = evaluateEditorialQualityGate({ records: [record({ candidateName: 'Addison', body: 'Dine at Addison, San Diego’s top-ranked and only three-Michelin-star restaurant.' })] })
  assert.equal(result.verdict, 'PASS')
})

test('evaluateEditorialQualityGate: does not run the batch-level opening-word check on a very small batch (a single strong item should not fail just because it is the whole batch)', () => {
  const result = evaluateEditorialQualityGate({ records: [record({ candidateName: 'A', body: 'Order the dry-aged tomahawk at A' })] })
  assert.equal(result.verdict, 'PASS')
})

// ---------------------------------------------------------------------------
// The consolidated pipeline — combines every fix above end-to-end, the way
// both the dry-run report and the SQL generator actually call it, so a
// gate result can never drift from the exact rows destined for INSERT.
// ---------------------------------------------------------------------------

function candidateFor(overrides: Partial<MetroCatalogCandidate> = {}): MetroCatalogCandidate {
  return { name: 'X', canonicalCategory: 'Food & drink', neighborhood: 'Downtown', checkoffizedItem: 'A real, specific description of this place', claimSupported: 'x', sourceUrls: ['https://x'], verificationConfidence: 'HIGH', ...overrides }
}

test('runIntakePipeline: end-to-end regression — cross-border mismap, semantic duplicate, and meta-language rejection are all caught in one pass, and gates reflect the exact final set', () => {
  const result = runIntakePipeline({
    candidates: [
      // The real Estación Federal bug: must NOT resolve to Gaslamp Quarter, must NOT appear in finalRecords.
      candidateFor({ name: 'Estación Federal', neighborhood: 'Downtown Tijuana near PedWest crossing' }),
      // A real semantic duplicate pair — the second carries richer evidence, so it must be the one kept.
      candidateFor({ name: 'Zuma', neighborhood: 'Downtown' }),
      candidateFor({ name: 'Zuma (Guild Hotel)', neighborhood: 'Downtown', checkoffizedItem: 'A much longer, more specific, richer description of this exact restaurant and its signature dish' }),
      // A real meta-language process artifact.
      candidateFor({ name: 'Fleurette (redundant?)', checkoffizedItem: 'Fleurette has already been counted and does not require a new checkoff item.' }),
      // A genuinely clean candidate.
      candidateFor({ name: 'Warwick’s Books', neighborhood: 'La Jolla' }),
    ],
    existingProductionMapsQueries: [],
    canonicalNeighborhoods: ['Gaslamp Quarter', 'La Jolla', 'Zona Centro'],
    neighborhoodAliases: { downtown: 'Gaslamp Quarter' },
    mexicoNeighborhoods: new Set(['Zona Centro']),
  })

  const finalNames = result.finalRecords.map((r) => r.candidateName).sort()
  assert.deepEqual(finalNames, ['Warwick’s Books', 'Zuma (Guild Hotel)']) // Estación Federal excluded (country mismatch), Zuma collapsed to its richer duplicate, Fleurette excluded (meta-language)
  assert.ok(result.failures.some((f) => f.candidateName === 'Estación Federal' && f.reason.includes('country mismatch')))
  assert.ok(result.failures.some((f) => f.candidateName === 'Fleurette (redundant?)' && f.reason.includes('presentation content')))
  assert.ok(result.semanticDuplicatesRemoved.some((g) => g.kept.candidateName === 'Zuma (Guild Hotel)'))

  // The gates were evaluated against finalRecords — 2 clean records, no duplicates, no unmapped categories.
  // CATALOG_GATE legitimately PASSes: the 3 exclusions are accounted for (2 final + 3 failures = 5 candidates), none is a production/batch duplicate, none is a category-mapping failure — exactly what CATALOG_GATE is designed to catch, and none of those conditions occurred here.
  const catalogGate = result.gates.find((g) => g.key === 'CATALOG_GATE')!
  assert.equal(catalogGate.verdict, 'PASS')
  const presentationGate = result.gates.find((g) => g.key === 'PRESENTATION_GATE')!
  assert.equal(presentationGate.verdict, 'PASS') // because the bad row never reaches presentationGate's input at all
})

// ── featured_experiences bridge card ──────────────────────────────────────
// Production incident, 2026-09: the generated INSERT omitted deep_link
// (NOT NULL, no usable default) and the failed row came back with
// state='AZ' — a stale default from the table's original Phoenix build that
// silently filled in because the generator never set state explicitly.

function bridgeCardInput(overrides: Partial<Parameters<typeof buildFeaturedExperienceBridgeCard>[0]> = {}) {
  return {
    title: 'Cross the Border',
    subtitle: 'Tijuana food, culture & nightlife — just minutes away in Mexico',
    city: 'San Diego',
    state: 'CA',
    metroSlug: 'san-diego',
    curatedListSlug: 'san-diego-tijuana-extension',
    vibes: ['adventurous', 'international'],
    ...overrides,
  }
}

test('featured_experiences bridge card: has a non-null, valid deep_link', () => {
  const card = buildFeaturedExperienceBridgeCard(bridgeCardInput())
  assert.ok(card.deepLink)
  assert.equal(card.deepLink, 'checkoff://list?id=san-diego-tijuana-extension&city=san-diego')
  assert.deepEqual(validateFeaturedExperienceBridgeCard(card), [])
})

test('featured_experiences bridge card: state is the real metro state, never a stale table default like AZ', () => {
  const card = buildFeaturedExperienceBridgeCard(bridgeCardInput())
  assert.equal(card.state, 'CA')
  assert.notEqual(card.state, 'AZ')
})

test('featured_experiences bridge card: rejects a missing/malformed state rather than silently falling through to a default', () => {
  assert.throws(() => buildFeaturedExperienceBridgeCard(bridgeCardInput({ state: '' })), /state must be a real two-letter code/)
  assert.throws(() => buildFeaturedExperienceBridgeCard(bridgeCardInput({ state: 'Arizona' })), /state must be a real two-letter code/)
})

test('featured_experiences bridge card: carries every production-required field non-empty', () => {
  const card = buildFeaturedExperienceBridgeCard(bridgeCardInput())
  assert.ok(card.title.trim())
  assert.ok(card.subtitle.trim())
  assert.ok(card.city.trim())
  assert.ok(card.state.trim())
  assert.ok(card.metroSlug.trim())
  assert.ok(card.deepLink.trim())
  assert.ok(card.curatedListSlug.trim())
  assert.deepEqual(validateFeaturedExperienceBridgeCard(card), [])
})

test('featured_experiences bridge card: validateFeaturedExperienceBridgeCard catches a null-ish deep_link if one ever slips through again', () => {
  const card = buildFeaturedExperienceBridgeCard(bridgeCardInput())
  const brokenCard = { ...card, deepLink: '' }
  assert.deepEqual(validateFeaturedExperienceBridgeCard(brokenCard), ['deep_link is missing or malformed: ""'])
})
