import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveHomeHeroLayout } from './homeHeroLayout.js'

test('normal state (no destination, no at-place): no primary hero, near-you-compact shown', () => {
  const layout = deriveHomeHeroLayout({ hasDestination: false, hasAtPlace: false })
  assert.equal(layout.primaryHero, 'none')
  assert.equal(layout.showAtPlaceCompact, false)
  assert.equal(layout.showNearYouCompact, true)
})

test('at-place only: at-place becomes the primary hero, near-you-compact shown, no compact at-place duplicate', () => {
  const layout = deriveHomeHeroLayout({ hasDestination: false, hasAtPlace: true })
  assert.equal(layout.primaryHero, 'at_place')
  assert.equal(layout.showAtPlaceCompact, false)
  assert.equal(layout.showNearYouCompact, true)
})

test('destination only: destination is the primary hero, near-you-compact shown, no at-place compact', () => {
  const layout = deriveHomeHeroLayout({ hasDestination: true, hasAtPlace: false })
  assert.equal(layout.primaryHero, 'destination')
  assert.equal(layout.showAtPlaceCompact, false)
  assert.equal(layout.showNearYouCompact, true)
})

test('destination + at-place: destination stays the primary hero (never displaced), at-place folds into a compact secondary treatment, AND Near You still shows beneath it — not stacking two giant heroes, but never dropping Near You either', () => {
  const layout = deriveHomeHeroLayout({ hasDestination: true, hasAtPlace: true })
  assert.equal(layout.primaryHero, 'destination')
  assert.equal(layout.showAtPlaceCompact, true)
  assert.equal(layout.showNearYouCompact, true)
})

test('showNearYouCompact is true in every state — Near You never disappears from Home', () => {
  const combos = [
    { hasDestination: false, hasAtPlace: false },
    { hasDestination: false, hasAtPlace: true },
    { hasDestination: true, hasAtPlace: false },
    { hasDestination: true, hasAtPlace: true },
  ]
  for (const combo of combos) {
    assert.equal(deriveHomeHeroLayout(combo).showNearYouCompact, true, JSON.stringify(combo))
  }
})
