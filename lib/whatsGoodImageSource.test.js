import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvedItemImage as resolveWhatsGoodImage, resolvedItemImage } from './whatsGoodImageSource.js'

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
