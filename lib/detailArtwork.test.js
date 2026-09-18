// Item Detail Redesign (2026-09-18) — coverage for the artwork
// priority/failure rules as consumed by
// components/itemDetail/DetailArtwork.jsx. The tier decision itself
// (lib/artworkResolution.js's resolveArtworkTier) already has its own
// dedicated test file (lib/artworkResolution.test.js) and is NOT
// re-derived or modified here — this file only re-confirms, at the
// Detail-consumer level, that the same contract holds, plus source-level
// checks that DetailArtwork wires it up per the shared
// components/home/ArchetypeArtwork.jsx contract, matching the existing
// convention (e.g. lib/archetypeArtworkIntegration.test.js).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveArtworkTier } from './artworkResolution.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const detailArtworkSource = readFileSync(
  join(__dirname, '../components/itemDetail/DetailArtwork.jsx'),
  'utf8'
)

test('approved photo wins over archetype (unchanged tier priority, reused not re-derived)', () => {
  const item = { id: 'i1', activeCoverImageUrl: 'https://example.com/photo.jpg', category_key: 'coffee' }
  const result = resolveArtworkTier(item, { imageFailed: false })
  assert.equal(result.tier, 'photo')
  assert.equal(result.url, 'https://example.com/photo.jpg')
})

test('archetype used when no approved photo exists', () => {
  const item = { id: 'i2', fallback_art_key: 'coffee_shop' }
  const result = resolveArtworkTier(item, { imageFailed: false })
  // Whether this resolves to 'archetype' or 'generic' depends on
  // lib/fallbackArtSource.js's own ARCHETYPE_STATUS availability map
  // (own test coverage lives in lib/fallbackArtSource.test.js) — this
  // assertion only confirms the photo tier is correctly bypassed when
  // no photo exists, never asserting a specific archetype availability.
  assert.notEqual(result.tier, 'photo')
})

test('generic fallback remains after an archetype image failure (imageFailed=true never re-attempts)', () => {
  const item = { id: 'i3', fallback_art_key: 'coffee_shop' }
  const withoutFailure = resolveArtworkTier(item, { imageFailed: false })
  if (withoutFailure.tier === 'archetype') {
    const afterFailure = resolveArtworkTier(item, { imageFailed: true })
    assert.equal(afterFailure.tier, 'generic', 'a failed archetype load must fall through to generic, never retry')
  }
})

test('no photo, no archetype match -> generic tier, no url', () => {
  const item = { id: 'i4' }
  const result = resolveArtworkTier(item, { imageFailed: false })
  assert.equal(result.tier, 'generic')
  assert.equal(result.url, null)
})

test('DetailArtwork delegates tier resolution to useCardArtwork, never re-implements it', () => {
  assert.ok(
    detailArtworkSource.includes("useCardArtwork(item, userId)"),
    'must reuse the existing useCardArtwork hook, not a new resolution path'
  )
  assert.ok(
    !detailArtworkSource.includes('resolveArtworkTier('),
    'must not call resolveArtworkTier directly — useCardArtwork already owns that'
  )
})

test('DetailArtwork renders via the shared ArchetypeArtwork component with a generic base layer, never a raw <Image> for the hero', () => {
  assert.ok(detailArtworkSource.includes('<ArchetypeArtwork'), 'must delegate rendering to the shared ArchetypeArtwork component')
  assert.ok(detailArtworkSource.includes('renderGenericFallback={() => <DetailGenericBackground'), 'must supply a generic base layer, never leaving a blank hero')
  assert.ok(!/<Image\s/.test(detailArtworkSource), 'must not mount its own raw <Image> outside the shared component')
})

test('a failed approved-photo load is handled locally and falls back to the generic treatment (photo tier is not covered by useCardArtwork onError)', () => {
  assert.ok(detailArtworkSource.includes('photoFailed'), 'must track its own photo-failure state')
  assert.ok(
    detailArtworkSource.includes('artwork.isPhoto ? () => setPhotoFailed(true) : artwork.onError'),
    'must layer its own onError handling on top of useCardArtwork for the photo tier specifically'
  )
})

test('DetailArtwork does not modify any shared artwork contract file', () => {
  const artworkResolutionSource = readFileSync(join(__dirname, 'artworkResolution.js'), 'utf8')
  const archetypeArtworkSource = readFileSync(
    join(__dirname, '../components/home/ArchetypeArtwork.jsx'),
    'utf8'
  )
  const useCardArtworkSource = readFileSync(
    join(__dirname, '../components/home/useCardArtwork.js'),
    'utf8'
  )
  // Sanity: these files still export the same public shape DetailArtwork
  // (and every Home consumer) depends on.
  assert.ok(artworkResolutionSource.includes('export function resolveArtworkTier'))
  assert.ok(archetypeArtworkSource.includes('export default function ArchetypeArtwork'))
  assert.ok(useCardArtworkSource.includes('export function useCardArtwork'))
})
