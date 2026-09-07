import { test } from 'node:test'
import assert from 'node:assert/strict'
import { certifyHomeListRow, evaluateHomeListCertificationGate, certifyCuratedListRow, evaluateCuratedListLayerGate, type HomeListRow, type CuratedListRow } from './homeListCertification'

function goodHomeListRow(overrides: Partial<HomeListRow> = {}): HomeListRow {
  return {
    label: 'FALL 2026 — San Diego Metro',
    exists: true,
    isOfficial: true,
    isPublic: true,
    metroId: 'metro-san-diego',
    expectedMetroId: 'metro-san-diego',
    startsAt: '2026-09-22T00:00:00Z',
    endsAt: '2026-12-20T00:00:00Z',
    goesPublicAt: '2026-09-22T00:00:00Z',
    isFeaturedEligible: true,
    expectedFeaturedEligible: true,
    listItemsCount: 30,
    expectedItemCount: 30,
    everyMembershipResolves: true,
    requiresImage: true,
    hasImage: true,
    returnedByRuntimeQuery: true,
    ...overrides,
  }
}

test('curated-list-only state cannot satisfy Home-list certification — a list with no public.lists row fails outright', () => {
  const result = certifyHomeListRow(goodHomeListRow({ exists: false }))
  assert.equal(result.issues.length, 1)
  assert.match(result.issues[0], /no row exists in public\.lists/)
})

test('Home list requires public.lists.is_official=true', () => {
  const result = certifyHomeListRow(goodHomeListRow({ isOfficial: false }))
  assert.ok(result.issues.some((i) => /is_official is not true/.test(i)))
})

test('Home list requires is_public=true and the correct metro_id', () => {
  const wrongPublic = certifyHomeListRow(goodHomeListRow({ isPublic: false }))
  assert.ok(wrongPublic.issues.some((i) => /is_public is not true/.test(i)))

  const wrongMetro = certifyHomeListRow(goodHomeListRow({ metroId: 'metro-denver' }))
  assert.ok(wrongMetro.issues.some((i) => /metro_id \(metro-denver\) does not match/.test(i)))
})

test('Home list requires correct public.list_items count and every membership resolving to a real item', () => {
  const wrongCount = certifyHomeListRow(goodHomeListRow({ listItemsCount: 12 }))
  assert.ok(wrongCount.issues.some((i) => /list_items count \(12\)/.test(i)))

  const brokenMembership = certifyHomeListRow(goodHomeListRow({ everyMembershipResolves: false }))
  assert.ok(brokenMembership.issues.some((i) => /does not resolve to a real current item/.test(i)))
})

test('a themed official list can be public/Home-visible while not primary featured — is_featured_eligible=false is correct for a themed list, not a violation', () => {
  const themed = goodHomeListRow({ label: 'Fall Nights & Hidden San Diego', isFeaturedEligible: false, expectedFeaturedEligible: false })
  const result = certifyHomeListRow(themed)
  assert.equal(result.issues.length, 0, 'a themed list correctly configured as non-featured must certify cleanly')
})

test('a themed list incorrectly marked featured-eligible (or vice versa) is caught', () => {
  const result = certifyHomeListRow(goodHomeListRow({ isFeaturedEligible: true, expectedFeaturedEligible: false }))
  assert.ok(result.issues.some((i) => /is_featured_eligible is true, expected false/.test(i)))
})

test('missing list image/hero blocks final presentation certification when required', () => {
  const result = certifyHomeListRow(goodHomeListRow({ requiresImage: true, hasImage: false }))
  assert.ok(result.issues.some((i) => /required hero\/card image is not populated/.test(i)))
})

test('a list that does NOT require an image is never penalized for lacking one', () => {
  const result = certifyHomeListRow(goodHomeListRow({ requiresImage: false, hasImage: false }))
  assert.equal(result.issues.length, 0)
})

test('the actual runtime Home query returns every intended launch list before PASS — a row with every field correct but NOT returned by the runtime query still fails', () => {
  const result = certifyHomeListRow(goodHomeListRow({ returnedByRuntimeQuery: false }))
  assert.ok(result.issues.some((i) => /does NOT return this row/.test(i)))
})

test('a fully correct row certifies with zero issues', () => {
  const result = certifyHomeListRow(goodHomeListRow())
  assert.deepEqual(result.issues, [])
})

test('evaluateHomeListCertificationGate: PASSes only when every list is clean and the gate FAILs closed on an empty list', () => {
  assert.equal(evaluateHomeListCertificationGate([]).gate.verdict, 'FAIL')

  const passResult = evaluateHomeListCertificationGate([goodHomeListRow(), goodHomeListRow({ label: 'themed', isFeaturedEligible: false, expectedFeaturedEligible: false })])
  assert.equal(passResult.gate.verdict, 'PASS')

  const failResult = evaluateHomeListCertificationGate([goodHomeListRow(), goodHomeListRow({ label: 'bad', exists: false })])
  assert.equal(failResult.gate.verdict, 'FAIL')
  assert.match(failResult.gate.reason, /bad/)
})

// ---------------------------------------------------------------------------
// curated_lists layer — separate certification, never conflated with Home visibility.
// ---------------------------------------------------------------------------

function goodCuratedListRow(overrides: Partial<CuratedListRow> = {}): CuratedListRow {
  return { label: 'FALL 2026 — San Diego Metro (curated)', exists: true, isActive: true, metroScopeSlug: 'san-diego', expectedMetroSlug: 'san-diego', curatedListItemsCount: 30, expectedItemCount: 30, ...overrides }
}

test('certifyCuratedListRow: an inactive curated list fails (is_active actually gates public read)', () => {
  const result = certifyCuratedListRow(goodCuratedListRow({ isActive: false }))
  assert.ok(result.issues.some((i) => /is_active is not true/.test(i)))
})

test('certifyCuratedListRow: a universal list (no metro scope rows) is valid', () => {
  const result = certifyCuratedListRow(goodCuratedListRow({ metroScopeSlug: null }))
  assert.deepEqual(result.issues, [])
})

test('evaluateCuratedListLayerGate: an empty layer PASSes (only applicable when the app architecture still requires it)', () => {
  const result = evaluateCuratedListLayerGate([])
  assert.equal(result.gate.verdict, 'PASS')
})
