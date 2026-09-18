import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveFallbackArt,
  fallbackArtUrl,
  isValidArchetypeKey,
  isArchetypeAvailable,
  ARCHETYPE_KEYS,
  ARCHETYPE_STATUS,
  CATEGORY_DEFAULTS,
  FALLBACK_ART_VERSION,
} from './fallbackArtSource.js'
import { resolvedItemImage } from './whatsGoodImageSource.js'

test('valid explicit fallback_art_key resolves first, ahead of category default', () => {
  const result = resolveFallbackArt({ fallback_art_key: 'coffee', categoryName: 'Food & drink' })
  assert.equal(result.archetypeKey, 'coffee')
})

test('invalid explicit key falls back to category default', () => {
  const result = resolveFallbackArt({ fallback_art_key: 'not_a_real_key', categoryName: 'Bar & drinks' })
  assert.equal(result.archetypeKey, 'cocktails')
})

test('null explicit key falls back to category default', () => {
  const result = resolveFallbackArt({ fallback_art_key: null, categoryName: 'Arts & Culture' })
  assert.equal(result.archetypeKey, 'arts_culture')
})

test('missing fallback_art_key field entirely falls back to category default', () => {
  const result = resolveFallbackArt({ categoryName: 'Sports' })
  assert.equal(result.archetypeKey, 'sports')
})

test('unknown/unmapped category resolves to null (no archetype) — caller must use the generic graphic fallback', () => {
  const result = resolveFallbackArt({ categoryName: 'Some Future Category' })
  assert.equal(result, null)
})

test('no category at all resolves to null', () => {
  assert.equal(resolveFallbackArt({}), null)
  assert.equal(resolveFallbackArt(null), null)
})

test('every CATEGORY_DEFAULTS value is a real registry key', () => {
  for (const key of Object.values(CATEGORY_DEFAULTS)) {
    assert.ok(isValidArchetypeKey(key), `${key} should be a valid archetype key`)
  }
})

test('all production category names from the spec are mapped', () => {
  const expected = [
    'Food & drink', 'Bar & drinks', 'Arts & Culture', 'Adventure', 'Misc',
    'Shopping', 'Social', 'Play', 'Nightlife', 'Sports', 'Spa & self-care', 'Travel',
  ]
  for (const name of expected) {
    assert.ok(CATEGORY_DEFAULTS[name], `${name} should have a category default`)
  }
})

test('camelCase fallbackArtKey is also accepted (client-adapter convention)', () => {
  const result = resolveFallbackArt({ fallbackArtKey: 'dessert', categoryName: 'Misc' })
  assert.equal(result.archetypeKey, 'dessert')
})

test('URL generation uses the correct versioned path checkoff-images/item-fallbacks/v1/<key>.webp', () => {
  const url = fallbackArtUrl('coffee')
  assert.ok(url.includes(`/checkoff-images/item-fallbacks/${FALLBACK_ART_VERSION}/coffee.webp`), url)
  assert.equal(FALLBACK_ART_VERSION, 'v1')
})

test('same input resolves deterministically (no network, pure function)', () => {
  const item = { fallback_art_key: 'wine', categoryName: 'Bar & drinks' }
  const first = resolveFallbackArt(item)
  const second = resolveFallbackArt(item)
  assert.deepEqual(first, second)
})

test('registry contains exactly the 23 v1 archetype keys, no duplicates', () => {
  assert.equal(ARCHETYPE_KEYS.length, 23)
  assert.equal(new Set(ARCHETYPE_KEYS).size, 23)
})

test('resolveFallbackArt is never consulted ahead of a real resolved photo — approved photo still wins in the consuming component (contract check)', () => {
  // whatsGoodImageSource.resolvedItemImage must be checked first by any
  // consumer; this test just re-confirms that function's own contract is
  // untouched by this module (no import cycle, no shared mutable state).
  const item = { photo_url: 'https://example.com/real.jpg', fallback_art_key: 'coffee', categoryName: 'Food & drink' }
  assert.deepEqual(resolvedItemImage(item), { url: 'https://example.com/real.jpg' })
})

// ── Asset status (Hardening pass, 2026-09-17; activated 2026-09-18) ─────
// Approach A: resolveFallbackArt must never hand back a URL for a key that
// isn't marked 'available', so no consumer ever fires a network request
// (and 404) for artwork that doesn't exist. As of 2026-09-18 all 23 v1
// archetype assets are uploaded to checkoff-images/item-fallbacks/v1/ and
// verified (200 + image/webp + byte-exact size match) — see
// docs/fallback-art-manifest.md's deployment log — so the registry's real
// default is now 'available' for all 23 keys. The safety property itself
// (a pending key never returns a url) is still covered below using an
// explicit temporary override, so it stays enforced for any future key
// (e.g. a v2 archetype) that's added but not yet uploaded.

test('registry: all 23 archetype keys are currently available (2026-09-18 deployment)', () => {
  for (const key of ARCHETYPE_KEYS) {
    assert.equal(ARCHETYPE_STATUS[key], 'available', `${key} should be available post-deployment`)
  }
})

test('Approach A: a key temporarily marked pending still resolves its archetypeKey, but url is null — no network attempt possible', () => {
  const previous = ARCHETYPE_STATUS.coffee
  ARCHETYPE_STATUS.coffee = 'pending'
  try {
    const result = resolveFallbackArt({ fallback_art_key: 'coffee', categoryName: 'Food & drink' })
    assert.equal(result.archetypeKey, 'coffee')
    assert.equal(result.url, null)
    assert.equal(result.status, 'pending')
  } finally {
    ARCHETYPE_STATUS.coffee = previous
  }
})

test('Approach A: a category-default key temporarily marked pending also resolves to a null url', () => {
  const previous = ARCHETYPE_STATUS.sports
  ARCHETYPE_STATUS.sports = 'pending'
  try {
    const result = resolveFallbackArt({ categoryName: 'Sports' })
    assert.equal(result.archetypeKey, 'sports')
    assert.equal(result.url, null)
    assert.equal(result.status, 'pending')
  } finally {
    ARCHETYPE_STATUS.sports = previous
  }
})

test('isArchetypeAvailable is true for every real key post-deployment, and false for invalid keys', () => {
  for (const key of ARCHETYPE_KEYS) {
    assert.equal(isArchetypeAvailable(key), true, `${key} should be available`)
  }
  assert.equal(isArchetypeAvailable('not_a_real_key'), false)
  assert.equal(isArchetypeAvailable(null), false)
})

test('Approach A: flipping a key to pending (e.g. to pull a bad asset) makes resolveFallbackArt stop returning its URL', () => {
  ARCHETYPE_STATUS.coffee = 'pending'
  try {
    assert.equal(isArchetypeAvailable('coffee'), false)
    const result = resolveFallbackArt({ fallback_art_key: 'coffee', categoryName: 'Food & drink' })
    assert.equal(result.archetypeKey, 'coffee')
    assert.equal(result.url, null)
    assert.equal(result.status, 'pending')
  } finally {
    ARCHETYPE_STATUS.coffee = 'available' // restore — registry is shared module state
  }
})

test('sanity: fallbackArtUrl still produces the correct versioned URL for an available key', () => {
  const result = resolveFallbackArt({ fallback_art_key: 'coffee', categoryName: 'Food & drink' })
  assert.equal(result.archetypeKey, 'coffee')
  assert.equal(result.url, fallbackArtUrl('coffee'))
  assert.equal(result.status, 'available')
})
