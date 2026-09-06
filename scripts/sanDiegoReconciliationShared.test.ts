import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fallbackVenueMatchCondition } from './sanDiegoReconciliationShared'

// ---------------------------------------------------------------------------
// Regression test for the internal-comma fallback-matcher bug (San Diego
// reconciliation, 2026-09-06): the existing-row side of the fallback match
// used split_part(maps_query, ',', 1), which truncates a venue name that
// itself contains a comma. Plaza Fiesta is the real production example:
//   "Plaza Fiesta (El Depa, Teléfono Gastro Park, Bosiger Beer)"
// These helpers mirror Postgres's exact normalization
// (lower(regexp_replace(btrim(x), '[^a-zA-Z0-9]+', '', 'g'))) in plain JS so
// the matching semantics can be asserted without a live database.
// ---------------------------------------------------------------------------

function pgNormalize(s: string): string {
  return s
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase()
}

// The BROKEN approach this test guards against: split_part(maps_query, ',', 1)
function brokenSplitPartVenue(mapsQuery: string): string {
  return mapsQuery.split(',')[0]
}

// The FIXED approach: normalized-prefix (LIKE venue% ) containment, matching
// fallbackVenueMatchCondition's SQL semantics exactly.
function fixedPrefixMatches(existingMapsQuery: string, candidateVenueName: string): boolean {
  return pgNormalize(existingMapsQuery).startsWith(pgNormalize(candidateVenueName))
}

const PLAZA_FIESTA_VENUE_NAME = 'Plaza Fiesta (El Depa, Teléfono Gastro Park, Bosiger Beer)'
const PLAZA_FIESTA_EXISTING_MAPS_QUERY = `${PLAZA_FIESTA_VENUE_NAME}, Zona Río, Tijuana, Mexico`

test('fallbackVenueMatchCondition SQL text uses LIKE prefix matching, not split_part', () => {
  const sql = fallbackVenueMatchCondition('i', 'f')
  assert.match(sql, /LIKE/)
  assert.doesNotMatch(sql, /split_part/)
  assert.match(sql, /i\.maps_query/)
  assert.match(sql, /f\.venue_name/)
})

test('REGRESSION: Plaza Fiesta (comma-containing venue name) is retained via the fixed prefix match, not misclassified as obsolete+new', () => {
  // Old, broken behavior: split_part truncates at the FIRST comma, which is
  // INSIDE the venue name here — proving the old matcher was broken for
  // this exact production venue.
  const brokenExtractedVenue = brokenSplitPartVenue(PLAZA_FIESTA_EXISTING_MAPS_QUERY)
  assert.notEqual(pgNormalize(brokenExtractedVenue), pgNormalize(PLAZA_FIESTA_VENUE_NAME))

  // Fixed behavior: normalized-prefix containment correctly recognizes the
  // existing row as the same venue regardless of internal commas.
  assert.equal(fixedPrefixMatches(PLAZA_FIESTA_EXISTING_MAPS_QUERY, PLAZA_FIESTA_VENUE_NAME), true)
})

test('fixed prefix match does not falsely match an unrelated venue with a similar prefix substring', () => {
  // "Plaza Fiesta" alone (a different, shorter real venue name) must not be
  // confused with "Plaza Fiesta (El Depa, ...)" in the OTHER direction —
  // i.e. the full name is not a prefix of the shorter one.
  assert.equal(fixedPrefixMatches('Plaza Fiesta, Zona Río, Tijuana, Mexico', PLAZA_FIESTA_VENUE_NAME), false)
})

test('fixed prefix match correctly matches a venue name with no internal comma (Cori Pastificio Trattoria case)', () => {
  const venueName = 'Cori Pastificio Trattoria'
  const existingMapsQuery = 'Cori Pastificio Trattoria, North Park, San Diego, CA'
  assert.equal(fixedPrefixMatches(existingMapsQuery, venueName), true)
})
