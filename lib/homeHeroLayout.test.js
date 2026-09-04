import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveHomeHeroLayout } from './homeHeroLayout.js'

test('normal state (no destination, no at-place): no primary hero, near-you-compact secondary', () => {
  const layout = deriveHomeHeroLayout({ hasDestination: false, hasAtPlace: false })
  assert.equal(layout.primaryHero, 'none')
  assert.equal(layout.secondarySlot, 'near_you_compact')
})

test('at-place only: at-place becomes the primary hero, near-you-compact secondary', () => {
  const layout = deriveHomeHeroLayout({ hasDestination: false, hasAtPlace: true })
  assert.equal(layout.primaryHero, 'at_place')
  assert.equal(layout.secondarySlot, 'near_you_compact')
})

test('destination only: destination is the primary hero, near-you-compact secondary', () => {
  const layout = deriveHomeHeroLayout({ hasDestination: true, hasAtPlace: false })
  assert.equal(layout.primaryHero, 'destination')
  assert.equal(layout.secondarySlot, 'near_you_compact')
})

test('destination + at-place: destination stays the primary hero (never displaced), at-place folds into a compact secondary treatment instead of a second full hero', () => {
  const layout = deriveHomeHeroLayout({ hasDestination: true, hasAtPlace: true })
  assert.equal(layout.primaryHero, 'destination')
  assert.equal(layout.secondarySlot, 'at_place_compact')
})
