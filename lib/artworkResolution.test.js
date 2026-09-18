import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveArtworkTier } from './artworkResolution.js'
import { ARCHETYPE_STATUS } from './fallbackArtSource.js'

// Hardening pass (2026-09-17) — Approach A: lib/fallbackArtSource.js only
// returns a url for keys marked 'available'. As of the 2026-09-18
// deployment, all 23 v1 keys are 'available' in the real registry (assets
// uploaded and verified — see docs/fallback-art-manifest.md's deployment
// log). Tests below that assert an 'archetype' tier are testing the pure
// KEY-SELECTION logic (which key would apply) and use withAvailable() for
// clarity/isolation even though it's now a no-op against the real
// registry's default. The two "Approach A" tests below exercise the
// pending-key SAFETY property itself (no url for a not-yet-available key)
// by explicitly forcing one key to 'pending' for the duration of the test,
// since that's no longer the registry's default state.
function withAvailable(key, fn) {
  const previous = ARCHETYPE_STATUS[key]
  ARCHETYPE_STATUS[key] = 'available'
  try {
    fn()
  } finally {
    ARCHETYPE_STATUS[key] = previous
  }
}

function withPending(key, fn) {
  const previous = ARCHETYPE_STATUS[key]
  ARCHETYPE_STATUS[key] = 'pending'
  try {
    fn()
  } finally {
    ARCHETYPE_STATUS[key] = previous
  }
}

test('approved photo remains independent and wins over any archetype/category data', () => {
  const item = { photo_url: 'https://example.com/real.jpg', fallback_art_key: 'coffee', categoryName: 'Food & drink' }
  const result = resolveArtworkTier(item)
  assert.equal(result.tier, 'photo')
  assert.equal(result.url, 'https://example.com/real.jpg')
})

test('no photo + valid explicit fallback_art_key -> archetype tier using that key (once available)', () => {
  withAvailable('hidden_entrance', () => {
    const item = { fallback_art_key: 'hidden_entrance', categoryName: 'Adventure' }
    const result = resolveArtworkTier(item)
    assert.equal(result.tier, 'archetype')
    assert.equal(result.archetypeKey, 'hidden_entrance')
  })
})

test('no photo + invalid explicit key -> falls back to category default archetype (once available)', () => {
  withAvailable('sports', () => {
    const item = { fallback_art_key: 'nonsense', categoryName: 'Sports' }
    const result = resolveArtworkTier(item)
    assert.equal(result.tier, 'archetype')
    assert.equal(result.archetypeKey, 'sports')
  })
})

test('no photo + null explicit key -> category default archetype (once available)', () => {
  withAvailable('wellness', () => {
    const item = { fallback_art_key: null, categoryName: 'Spa & self-care' }
    const result = resolveArtworkTier(item)
    assert.equal(result.tier, 'archetype')
    assert.equal(result.archetypeKey, 'wellness')
  })
})

test('no photo + unmapped category -> generic tier (no archetype available)', () => {
  const item = { categoryName: 'Not A Real Category' }
  const result = resolveArtworkTier(item)
  assert.equal(result.tier, 'generic')
  assert.equal(result.url, null)
})

test('remote artwork failure (imageFailed=true) returns the card to generic even though a valid AND available archetype exists', () => {
  withAvailable('restaurant_general', () => {
    const item = { categoryName: 'Food & drink' }
    const result = resolveArtworkTier(item, { imageFailed: true })
    assert.equal(result.tier, 'generic')
  })
})

// ── Approach A: the pending-key safety property itself ──────────────────
// All 23 real keys are 'available' now, so these force one key to
// 'pending' to prove the safety property still holds for any key that
// isn't (e.g. a future v2 archetype added but not yet uploaded).

test('Approach A: a matched archetype key that is pending resolves to generic, not archetype', () => {
  withPending('hidden_entrance', () => {
    const item = { fallback_art_key: 'hidden_entrance', categoryName: 'Adventure' }
    const result = resolveArtworkTier(item)
    assert.equal(result.tier, 'generic')
    assert.equal(result.url, null)
    assert.equal(result.archetypeKey, null)
  })
})

test('Approach A: a pending category-default key cannot produce an archetype tier', () => {
  withPending('restaurant_general', () => {
    const item = { categoryName: 'Food & drink' }
    const result = resolveArtworkTier(item)
    assert.equal(result.tier, 'generic')
  })
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
