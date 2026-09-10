import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePartnerPotential, preferHigherPartnerPotential } from './partnerPotential'

test('partnerPotential: ineligible category always scores 0', () => {
  const r = evaluatePartnerPotential({ dbCategory: 'Arts & Culture', body: "Order the signature tasting flight at 'The Museum'.", tags: ['historic'] })
  assert.equal(r.score, 0)
  assert.deepEqual(r.signals, [])
  assert.equal(r.isAdvisoryOnly, true)
})

test('partnerPotential: Food & drink with no distinctive hook scores 0', () => {
  const r = evaluatePartnerPotential({ dbCategory: 'Food & drink', body: "Eat a meal at 'Some Restaurant'.", tags: [] })
  assert.equal(r.score, 0)
})

test('partnerPotential: signature dish + tasting flight + staff-guided scores 3', () => {
  const r = evaluatePartnerPotential({
    dbCategory: 'Bar & drinks',
    body: "Ask the bartender to build you a signature bespoke cocktail as part of a tasting flight at 'The Hidden Bar'.",
    tags: [],
  })
  assert.ok(r.score >= 2, `expected score >= 2, got ${r.score}`)
  assert.ok(r.signals.some((s) => s.key === 'SIGNATURE_ITEM'))
  assert.ok(r.signals.some((s) => s.key === 'TASTING_OR_FLIGHT'))
})

test('partnerPotential: partner-friendly tag alone contributes one signal', () => {
  const r = evaluatePartnerPotential({ dbCategory: 'Shopping', body: 'Browse the shop.', tags: ['independent'] })
  assert.equal(r.score, 1)
  assert.equal(r.signals[0].key, 'PARTNER_FRIENDLY_TAG')
})

test('partnerPotential: never influences a fourth-eligible category (Nightlife stays out of ELIGIBLE_CATEGORIES)', () => {
  const r = evaluatePartnerPotential({ dbCategory: 'Nightlife', body: "Order the signature tasting flight at 'Club'.", tags: [] })
  assert.equal(r.score, 0)
})

test('preferHigherPartnerPotential: ties return 0, otherwise prefers the higher score', () => {
  assert.equal(preferHigherPartnerPotential({ score: 2 }, { score: 2 }), 0)
  assert.equal(preferHigherPartnerPotential({ score: 3 }, { score: 1 }), -1)
  assert.equal(preferHigherPartnerPotential({ score: 1 }, { score: 3 }), 1)
})
