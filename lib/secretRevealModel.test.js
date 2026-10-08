import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveSecretVenue, selectHeroPhoto, formatDistance, lockedStatus,
  pointsLabel, photoRequirementCopy, descriptionParagraphs, planActions, REVEAL_HEADING,
} from './secretRevealModel.js'

const BIZ = 'https://x/biz.jpg'
const APPROVED = [{ url: 'https://x/approved.jpg', isPrimary: true, weight: 1, candidateId: 'c1' }]

test('venue: partner name wins, neighborhood is never the venue', () => {
  assert.deepEqual(resolveSecretVenue({ item: { partnerName: 'Raven', neighborhoodName: 'Peoria' } }),
    { venueName: 'Raven', source: 'partner', area: 'Peoria' })
  assert.equal(resolveSecretVenue({ item: { partnerName: 'Old' }, fetchedPartnerName: 'Fresh' }).venueName, 'Fresh')
})

test('venue: no partner -> quoted venue from body; otherwise null (NOT "Peoria")', () => {
  assert.equal(resolveSecretVenue({ item: { body: 'Ask for the ring at "The Raven"', neighborhoodName: 'Peoria' } }).venueName, 'The Raven')
  const none = resolveSecretVenue({ item: { body: 'Do the thing', neighborhoodName: 'Peoria' } })
  assert.equal(none.venueName, null)
  assert.equal(none.source, 'none')
  assert.equal(none.area, 'Peoria')
  assert.equal(resolveSecretVenue({ item: { partnerName: '   ' } }).venueName, null)
  assert.equal(resolveSecretVenue({}).venueName, null)
})

test('locked: only the business photo, even when approved/cover images are supplied', () => {
  const p = selectHeroPhoto({ phase: 'locked', businessPhotoUrl: BIZ, pool: APPROVED, activeCoverUrl: 'https://x/cover.jpg' })
  assert.deepEqual(p, { url: BIZ, source: 'business' })
  assert.equal(selectHeroPhoto({ phase: 'locked', pool: APPROVED, activeCoverUrl: 'https://x/cover.jpg' }), null)
  assert.equal(selectHeroPhoto({ phase: 'checking', businessPhotoUrl: '  ' }), null)
})

test('revealed: approved pool > selected cover > business photo > null', () => {
  assert.deepEqual(selectHeroPhoto({ phase: 'revealed', itemId: 'i', businessPhotoUrl: BIZ, pool: APPROVED }), { url: 'https://x/approved.jpg', source: 'approved' })
  assert.deepEqual(selectHeroPhoto({ phase: 'revealed', itemId: 'i', businessPhotoUrl: BIZ, pool: [], activeCoverUrl: 'https://x/cover.jpg' }), { url: 'https://x/cover.jpg', source: 'approved' })
  assert.deepEqual(selectHeroPhoto({ phase: 'revealed', itemId: 'i', businessPhotoUrl: BIZ, pool: null }), { url: BIZ, source: 'business' })
  assert.equal(selectHeroPhoto({ phase: 'revealed', itemId: 'i', pool: [{ url: '' }] }), null)
})

test('revealed: legacy single-field images on an item are never consulted (pool is explicit)', () => {
  // selectHeroPhoto has no access to item_image_url / venue_image_url / photo_url by construction.
  assert.equal(selectHeroPhoto({ phase: 'revealed', itemId: 'i', pool: [], item_image_url: 'https://x/legacy.jpg' }), null)
})

test('multi-image pools pick deterministically', () => {
  const pool = [{ url: 'https://x/a.jpg', isPrimary: true, weight: 1 }, { url: 'https://x/b.jpg', isPrimary: false, weight: 1 }]
  const ctx = { userId: 'u', dateKey: '2026-10-08' }
  const a = selectHeroPhoto({ phase: 'revealed', itemId: 'i', pool, imageContext: ctx })
  const b = selectHeroPhoto({ phase: 'revealed', itemId: 'i', pool, imageContext: ctx })
  assert.deepEqual(a, b)
})

test('distance formatting', () => {
  assert.equal(formatDistance(420), '420 m')
  assert.equal(formatDistance(1300), '1.3 km')
  assert.equal(formatDistance(null), null)
  assert.equal(formatDistance(-5), null)
})

test('locked status never claims background watching; errors are explicit', () => {
  const far = lockedStatus({ phase: 'tooFar', distance: 420, radius: 150 })
  assert.equal(far.kind, 'far')
  assert.equal(far.headline, '420 m away')
  assert.match(far.detail, /Unlocks within 150 m/)
  assert.equal(far.detail, 'Unlocks within 150 m')
  for (const s of [far, lockedStatus({ phase: 'checking', radius: 150 }), lockedStatus({ phase: 'error', permDenied: true, radius: 150 }), lockedStatus({ phase: 'error', radius: 150 })]) {
    assert.doesNotMatch(`${s.headline} ${s.detail}`, /watching/i)
  }
  assert.equal(lockedStatus({ phase: 'error', permDenied: true, radius: 150 }).action, 'settings')
  assert.equal(lockedStatus({ phase: 'error', permDenied: false, radius: 150 }).action, 'retry')
  assert.equal(lockedStatus({ phase: 'tooFar', distance: null, radius: 150 }).kind, 'checking')
})

test('points and photo requirement are truthful', () => {
  assert.equal(pointsLabel({ difficulty: 25 }), '25 pts')
  assert.equal(pointsLabel({}), null)
  assert.equal(pointsLabel({ difficulty: 0 }), null)
  assert.equal(photoRequirementCopy({ photoRequired: true }).required, true)
  assert.equal(photoRequirementCopy({ photo_required: true }).required, true)
  assert.equal(photoRequirementCopy({}).required, false)
  assert.match(photoRequirementCopy({}).text, /optional/i)
})

test('description splits into body paragraphs and is never empty strings', () => {
  assert.deepEqual(descriptionParagraphs('One.\n\n  Two.  \n\n\n'), ['One.', 'Two.'])
  assert.deepEqual(descriptionParagraphs(null), [])
})

test('actions: locked primary is Directions; errors swap in Settings/Retry; revealed primary is Check it off', () => {
  const far = lockedStatus({ phase: 'tooFar', distance: 10, radius: 150 })
  assert.deepEqual(planActions({ phase: 'locked', status: far, hasLocation: true, hasWebsite: true }),
    { primary: { id: 'directions' }, secondary: ['website', 'save', 'share'] })
  assert.deepEqual(planActions({ phase: 'locked', status: lockedStatus({ phase: 'error', permDenied: true, radius: 1 }), hasLocation: true, hasWebsite: false }),
    { primary: { id: 'settings' }, secondary: ['directions', 'save', 'share'] })
  assert.equal(planActions({ phase: 'locked', status: lockedStatus({ phase: 'error', radius: 1 }), hasLocation: false, hasWebsite: false }).primary.id, 'retry')
  assert.deepEqual(planActions({ phase: 'locked', status: far, hasLocation: false, hasWebsite: false }), { primary: null, secondary: ['save', 'share'] })
  assert.deepEqual(planActions({ phase: 'revealed', status: null, hasLocation: true, hasWebsite: true }),
    { primary: { id: 'checkoff' }, secondary: ['directions', 'website', 'save', 'share'] })
})

test('reveal heading is short; venue is a separate line', () => {
  assert.equal(REVEAL_HEADING, 'You found it.')
  assert.ok(REVEAL_HEADING.length < 20)
})

test('revealed: admin reveal image wins; approved photo is the fallback; locked never uses it', () => {
  const reveal = 'https://x/reveal.jpg'
  assert.deepEqual(selectHeroPhoto({ phase: 'revealed', itemId: 'i', revealImageUrl: reveal, businessPhotoUrl: BIZ, pool: APPROVED }), { url: reveal, source: 'reveal' })
  assert.deepEqual(selectHeroPhoto({ phase: 'revealed', itemId: 'i', revealImageUrl: '  ', businessPhotoUrl: BIZ, pool: APPROVED }), { url: 'https://x/approved.jpg', source: 'approved' })
  assert.deepEqual(selectHeroPhoto({ phase: 'revealed', itemId: 'i', revealImageUrl: null, businessPhotoUrl: BIZ, pool: [] }), { url: BIZ, source: 'business' })
  assert.deepEqual(selectHeroPhoto({ phase: 'locked', revealImageUrl: reveal, businessPhotoUrl: BIZ, pool: APPROVED }), { url: BIZ, source: 'business' })
  assert.equal(selectHeroPhoto({ phase: 'locked', revealImageUrl: reveal, pool: APPROVED }), null, 'the reveal image never appears while locked')
})
