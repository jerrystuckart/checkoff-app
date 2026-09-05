import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterCandidatesByGeographicScope } from './geographicScopeFilter'

const TIJUANA_SCOPE_KEYWORDS = ['tijuana', 'zona centro', 'zona río', 'zona rio', 'zona norte', 'revolución', 'revolucion', 'otay', 'pueblo amigo', 'playas de tijuana']

test('filterCandidatesByGeographicScope: keeps a candidate whose neighborhood names the configured scope', () => {
  const { inScope, outOfScope } = filterCandidatesByGeographicScope(
    [{ name: 'La Justina', neighborhood: 'Zona Centro / Avenida Revolución area' }],
    TIJUANA_SCOPE_KEYWORDS
  )
  assert.equal(inScope.length, 1)
  assert.equal(outOfScope.length, 0)
})

test('filterCandidatesByGeographicScope: regression — the real Tijuana-run contamination is rejected', () => {
  // Exact real candidates from the 2026-09-05 san-diego-tijuana-extension run.
  const realCandidates = [
    { name: 'La Barra Conchita', neighborhood: 'Revolución, Tijuana' }, // in scope
    { name: 'CECUT', neighborhood: 'Zona Río, Tijuana' }, // in scope
    { name: 'Raised by Wolves', neighborhood: 'San Diego, UTC/La Jolla' }, // contamination
    { name: 'Las Americas Premium Outlets', neighborhood: 'San Ysidro, San Diego, CA' }, // contamination
    { name: "Definition of 'Miscellaneous Items' in FHWA project scoping guide", neighborhood: 'Definitions in transportation project cost categories' }, // nonsense
    { name: 'Centro Cultural de la Raza', neighborhood: 'Balboa Park, San Diego' }, // contamination (name mentions "cultural" but is San Diego-side)
  ]
  const { inScope, outOfScope } = filterCandidatesByGeographicScope(realCandidates, TIJUANA_SCOPE_KEYWORDS)
  assert.equal(inScope.length, 2)
  assert.deepEqual(
    inScope.map((c) => c.name),
    ['La Barra Conchita', 'CECUT']
  )
  assert.equal(outOfScope.length, 4)
})

test('filterCandidatesByGeographicScope: an explicit exclusion keyword rejects even when a scope keyword also matches', () => {
  const { inScope, outOfScope } = filterCandidatesByGeographicScope(
    [{ name: 'Tijuana-style Taco Spot', neighborhood: 'Little Italy, San Diego' }],
    TIJUANA_SCOPE_KEYWORDS,
    ['san diego']
  )
  assert.equal(inScope.length, 0)
  assert.equal(outOfScope[0].reason.includes('exclusion'), true)
})

test('filterCandidatesByGeographicScope: ambiguous candidates (no scope keyword match) are rejected, never guessed into scope', () => {
  const { inScope, outOfScope } = filterCandidatesByGeographicScope([{ name: 'Some Place', neighborhood: 'Somewhere unclear' }], TIJUANA_SCOPE_KEYWORDS)
  assert.equal(inScope.length, 0)
  assert.equal(outOfScope.length, 1)
})
