import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolvedItemImage as resolveWhatsGoodImage,
  resolvedItemImage,
  resolvedItemImages,
  pickDeterministicImage,
  PRIMARY_WEIGHT_MULTIPLIER,
} from './whatsGoodImageSource.js'

test('no image fields at all -> null (typography-first mode)', () => {
  assert.equal(resolveWhatsGoodImage({}), null)
  assert.equal(resolveWhatsGoodImage(null), null)
})

test('photo_url (today\'s only real source) is used when present', () => {
  const result = resolveWhatsGoodImage({ photo_url: 'https://example.com/photo.jpg' })
  assert.deepEqual(result, { url: 'https://example.com/photo.jpg' })
})

test('item_image_url takes priority over venue_image_url and photo_url', () => {
  const result = resolveWhatsGoodImage({
    item_image_url: 'https://example.com/item.jpg',
    venue_image_url: 'https://example.com/venue.jpg',
    photo_url: 'https://example.com/partner.jpg',
  })
  assert.deepEqual(result, { url: 'https://example.com/item.jpg' })
})

test('venue_image_url is used when item_image_url is absent', () => {
  const result = resolveWhatsGoodImage({ venue_image_url: 'https://example.com/venue.jpg', photo_url: 'https://example.com/partner.jpg' })
  assert.deepEqual(result, { url: 'https://example.com/venue.jpg' })
})

test('empty-string or whitespace-only fields are treated as absent, fall through to the next source', () => {
  const result = resolveWhatsGoodImage({ item_image_url: '', venue_image_url: '   ', photo_url: 'https://example.com/partner.jpg' })
  assert.deepEqual(result, { url: 'https://example.com/partner.jpg' })
})

test('non-string values are ignored rather than throwing', () => {
  const result = resolveWhatsGoodImage({ item_image_url: 123, photo_url: 'https://example.com/partner.jpg' })
  assert.deepEqual(result, { url: 'https://example.com/partner.jpg' })
})

test('returned url is trimmed', () => {
  const result = resolveWhatsGoodImage({ photo_url: '  https://example.com/photo.jpg  ' })
  assert.deepEqual(result, { url: 'https://example.com/photo.jpg' })
})

test('activeCoverImageUrl (a selected community Cover Candidate) takes priority over every other source', () => {
  const result = resolvedItemImage({
    activeCoverImageUrl: 'https://signed.example.com/cover.jpg',
    item_image_url: 'https://example.com/item.jpg',
    venue_image_url: 'https://example.com/venue.jpg',
    photo_url: 'https://example.com/partner.jpg',
  })
  assert.deepEqual(result, { url: 'https://signed.example.com/cover.jpg' })
})

test('with no activeCoverImageUrl, falls through to item_image_url as before', () => {
  const result = resolvedItemImage({ item_image_url: 'https://example.com/item.jpg', photo_url: 'https://example.com/partner.jpg' })
  assert.deepEqual(result, { url: 'https://example.com/item.jpg' })
})

// ---------------------------------------------------------------------------
// Multi-Image Rotation for Item Covers (2026-09-03)
// ---------------------------------------------------------------------------

test('resolvedItemImages: displayEligibleImages present -> returns it verbatim (filtered to valid urls)', () => {
  const item = {
    id: 'item-1',
    displayEligibleImages: [
      { url: 'https://s.example.com/a.jpg', isPrimary: true, weight: 1, candidateId: 'a' },
      { url: '', isPrimary: false, weight: 1, candidateId: 'b' }, // invalid, filtered out
      { url: 'https://s.example.com/c.jpg', isPrimary: false, weight: 1, candidateId: 'c' },
    ],
  }
  const pool = resolvedItemImages(item)
  assert.deepEqual(pool.map((p) => p.candidateId), ['a', 'c'])
})

test('resolvedItemImages: displayEligibleImages absent -> legacy single-field fallback pool', () => {
  const pool = resolvedItemImages({ photo_url: 'https://example.com/photo.jpg' })
  assert.equal(pool.length, 1)
  assert.equal(pool[0].url, 'https://example.com/photo.jpg')
})

test('resolvedItemImages: displayEligibleImages present but EMPTY -> empty pool, does NOT fall back to legacy fields', () => {
  const pool = resolvedItemImages({ displayEligibleImages: [], photo_url: 'https://example.com/photo.jpg' })
  assert.deepEqual(pool, [])
})

test('pickDeterministicImage: empty pool -> null', () => {
  assert.equal(pickDeterministicImage([], { itemId: 'i', userId: 'u', dateKey: '2026-09-03' }), null)
})

test('pickDeterministicImage: single-entry pool -> that entry, no hashing needed', () => {
  const entry = { url: 'https://s.example.com/only.jpg', isPrimary: false, weight: 1 }
  assert.equal(pickDeterministicImage([entry], { itemId: 'i', userId: 'u', dateKey: '2026-09-03' }), entry)
})

test('pickDeterministicImage: same (pool, context) always returns the same entry (stable, no Math.random)', () => {
  const pool = [
    { url: 'https://s.example.com/a.jpg', isPrimary: true, weight: 1 },
    { url: 'https://s.example.com/b.jpg', isPrimary: false, weight: 1 },
    { url: 'https://s.example.com/c.jpg', isPrimary: false, weight: 1 },
  ]
  const context = { itemId: 'item-1', userId: 'user-1', dateKey: '2026-09-03' }
  const first = pickDeterministicImage(pool, context)
  for (let i = 0; i < 20; i++) {
    assert.equal(pickDeterministicImage(pool, context), first)
  }
})

test('pickDeterministicImage: different users can see different images from the same pool', () => {
  const pool = [
    { url: 'https://s.example.com/a.jpg', isPrimary: false, weight: 1 },
    { url: 'https://s.example.com/b.jpg', isPrimary: false, weight: 1 },
    { url: 'https://s.example.com/c.jpg', isPrimary: false, weight: 1 },
    { url: 'https://s.example.com/d.jpg', isPrimary: false, weight: 1 },
  ]
  const picks = new Set()
  for (let u = 0; u < 30; u++) {
    picks.add(pickDeterministicImage(pool, { itemId: 'item-1', userId: `user-${u}`, dateKey: '2026-09-03' }).url)
  }
  assert.ok(picks.size > 1, 'expected variety across different users, got only: ' + [...picks].join(','))
})

test('pickDeterministicImage: the same user can see a different image on a different day', () => {
  const pool = [
    { url: 'https://s.example.com/a.jpg', isPrimary: false, weight: 1 },
    { url: 'https://s.example.com/b.jpg', isPrimary: false, weight: 1 },
    { url: 'https://s.example.com/c.jpg', isPrimary: false, weight: 1 },
    { url: 'https://s.example.com/d.jpg', isPrimary: false, weight: 1 },
  ]
  const picks = new Set()
  for (let d = 1; d <= 30; d++) {
    const dateKey = `2026-09-${String(d).padStart(2, '0')}`
    picks.add(pickDeterministicImage(pool, { itemId: 'item-1', userId: 'user-1', dateKey }).url)
  }
  assert.ok(picks.size > 1, 'expected variety across days, got only: ' + [...picks].join(','))
})

test('pickDeterministicImage: two different items with the same user/date do not always collide on the same pool position', () => {
  const pool = [
    { url: 'https://s.example.com/a.jpg', isPrimary: false, weight: 1 },
    { url: 'https://s.example.com/b.jpg', isPrimary: false, weight: 1 },
    { url: 'https://s.example.com/c.jpg', isPrimary: false, weight: 1 },
  ]
  const picks = new Set()
  for (let i = 0; i < 20; i++) {
    picks.add(pickDeterministicImage(pool, { itemId: `item-${i}`, userId: 'user-1', dateKey: '2026-09-03' }).url)
  }
  assert.ok(picks.size > 1, 'expected itemId to affect the hash seed, got only: ' + [...picks].join(','))
})

test('pickDeterministicImage: primary is weighted higher — appears more often than an equal-weight non-primary across many users', () => {
  const pool = [
    { url: 'https://s.example.com/primary.jpg', isPrimary: true, weight: 1 },
    { url: 'https://s.example.com/other.jpg', isPrimary: false, weight: 1 },
  ]
  let primaryCount = 0
  const trials = 300
  for (let u = 0; u < trials; u++) {
    const pick = pickDeterministicImage(pool, { itemId: 'item-1', userId: `user-${u}`, dateKey: '2026-09-03' })
    if (pick.url === pool[0].url) primaryCount++
  }
  // Expected share ~= PRIMARY_WEIGHT_MULTIPLIER / (PRIMARY_WEIGHT_MULTIPLIER + 1). Loose bound to avoid test flakiness.
  const expectedShare = PRIMARY_WEIGHT_MULTIPLIER / (PRIMARY_WEIGHT_MULTIPLIER + 1)
  assert.ok(primaryCount / trials > expectedShare - 0.25, `primary shown ${primaryCount}/${trials} times, expected roughly ${expectedShare}`)
  assert.ok(primaryCount / trials < 1, 'primary must not completely suppress the rest of the pool')
})

// Release Candidate final cleanup (2026-09-03) — PRIMARY_WEIGHT_MULTIPLIER
// is a per-entry multiplier, not a fixed "75% of the time" guarantee; the
// primary's actual share shrinks as the pool grows. This test locks in
// the exact math (MULTIPLIER / (MULTIPLIER + poolSize - 1), equal
// non-primary weights) with a large-enough trial count that the expected
// value is precise, not a loose statistical bound.
test('pickDeterministicImage: primary share shrinks as the pool grows — 75% with 1 other image, 60% with 2, matching the documented formula exactly, not a fixed 75%', () => {
  function primaryShare(poolSize, trials = 2000) {
    const pool = [
      { url: 'primary.jpg', isPrimary: true, weight: 1 },
      ...Array.from({ length: poolSize - 1 }, (_, i) => ({ url: `other-${i}.jpg`, isPrimary: false, weight: 1 })),
    ]
    let primaryCount = 0
    for (let u = 0; u < trials; u++) {
      const pick = pickDeterministicImage(pool, { itemId: 'item-1', userId: `user-${u}`, dateKey: '2026-09-03' })
      if (pick.url === 'primary.jpg') primaryCount++
    }
    return primaryCount / trials
  }

  const twoImageShare = primaryShare(2)
  const threeImageShare = primaryShare(3)

  assert.ok(Math.abs(twoImageShare - 0.75) < 0.05, `expected ~75% with 1 other image, got ${(twoImageShare * 100).toFixed(1)}%`)
  assert.ok(Math.abs(threeImageShare - 0.60) < 0.05, `expected ~60% with 2 other images, got ${(threeImageShare * 100).toFixed(1)}%`)
  assert.ok(threeImageShare < twoImageShare, 'primary share must shrink, not stay fixed, as more images join the pool')
})

test('pickDeterministicImage: a non-primary is still reachable sometimes even with a primary present (never fully suppressed)', () => {
  const pool = [
    { url: 'https://s.example.com/primary.jpg', isPrimary: true, weight: 1 },
    { url: 'https://s.example.com/other.jpg', isPrimary: false, weight: 1 },
  ]
  let sawOther = false
  for (let u = 0; u < 300; u++) {
    const pick = pickDeterministicImage(pool, { itemId: 'item-1', userId: `user-${u}`, dateKey: '2026-09-03' })
    if (pick.url === pool[1].url) {
      sawOther = true
      break
    }
  }
  assert.ok(sawOther, 'expected the non-primary image to be reachable at least once across 300 users')
})

test('resolvedItemImage: multi-entry pool + context -> deterministic single-url result, same shape as legacy callers expect', () => {
  const item = {
    id: 'item-1',
    displayEligibleImages: [
      { url: 'https://s.example.com/a.jpg', isPrimary: true, weight: 1, candidateId: 'a' },
      { url: 'https://s.example.com/b.jpg', isPrimary: false, weight: 1, candidateId: 'b' },
    ],
  }
  const context = { userId: 'user-1', dateKey: '2026-09-03' }
  const result = resolvedItemImage(item, context)
  assert.ok(result.url === 'https://s.example.com/a.jpg' || result.url === 'https://s.example.com/b.jpg')
  assert.deepEqual(Object.keys(result), ['url'])
  // Stable across repeated calls with the same context.
  assert.equal(resolvedItemImage(item, context).url, result.url)
})

test('resolvedItemImage: single-entry pool is bit-for-bit unchanged regardless of context (no hashing path touched)', () => {
  const item = { activeCoverImageUrl: 'https://s.example.com/only.jpg' }
  assert.deepEqual(resolvedItemImage(item), { url: 'https://s.example.com/only.jpg' })
  assert.deepEqual(resolvedItemImage(item, { userId: 'anyone', dateKey: '2099-01-01' }), { url: 'https://s.example.com/only.jpg' })
})
