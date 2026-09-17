import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveArtworkTier } from './artworkResolution.js'

test('approved photo remains independent and wins over any archetype/category data', () => {
  const item = { photo_url: 'https://example.com/real.jpg', fallback_art_key: 'coffee', categoryName: 'Food & drink' }
  const result = resolveArtworkTier(item)
  assert.equal(result.tier, 'photo')
  assert.equal(result.url, 'https://example.com/real.jpg')
})

test('no photo + valid explicit fallback_art_key -> archetype tier using that key', () => {
  const item = { fallback_art_key: 'hidden_entrance', categoryName: 'Adventure' }
  const result = resolveArtworkTier(item)
  assert.equal(result.tier, 'archetype')
  assert.equal(result.archetypeKey, 'hidden_entrance')
})

test('no photo + invalid explicit key -> falls back to category default archetype', () => {
  const item = { fallback_art_key: 'nonsense', categoryName: 'Sports' }
  const result = resolveArtworkTier(item)
  assert.equal(result.tier, 'archetype')
  assert.equal(result.archetypeKey, 'sports')
})

test('no photo + null explicit key -> category default archetype', () => {
  const item = { fallback_art_key: null, categoryName: 'Spa & self-care' }
  const result = resolveArtworkTier(item)
  assert.equal(result.tier, 'archetype')
  assert.equal(result.archetypeKey, 'wellness')
})

test('no photo + unmapped category -> generic tier (no archetype available)', () => {
  const item = { categoryName: 'Not A Real Category' }
  const result = resolveArtworkTier(item)
  assert.equal(result.tier, 'generic')
  assert.equal(result.url, null)
})

test('remote artwork failure (imageFailed=true) returns the card to generic even though a valid archetype exists', () => {
  const item = { categoryName: 'Food & drink' }
  const result = resolveArtworkTier(item, { imageFailed: true })
  assert.equal(result.tier, 'generic')
})

test('a photo failure is not modeled here — photo tier ignores imageFailed (archetype-only concept)', () => {
  const item = { photo_url: 'https://example.com/real.jpg', categoryName: 'Food & drink' }
  const result = resolveArtworkTier(item, { imageFailed: true })
  assert.equal(result.tier, 'photo')
})

test('deterministic: same item + same options resolve identically across calls', () => {
  const item = { categoryName: 'Nightlife' }
  const a = resolveArtworkTier(item)
  const b = resolveArtworkTier(item)
  assert.deepEqual(a, b)
})
