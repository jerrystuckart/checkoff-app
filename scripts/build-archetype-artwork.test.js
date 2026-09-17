// scripts/build-archetype-artwork.test.js
//
// Focused coverage for the 2026-09-17 archetype-artwork asset-prep pass.
// Plain node:test + fs (same convention as lib/*.test.js) — no new test
// framework. Run directly:
//   node --test scripts/build-archetype-artwork.test.js
//
// Requires scripts/build-archetype-artwork.js to have already been run at
// least once (produces assets-handoff/item-fallbacks/v1/*.webp +
// _build-manifest.json, both git-ignored) — these tests read that output,
// they do not re-run the conversion.

'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { ARCHETYPE_KEYS, ARCHETYPE_STATUS, resolveFallbackArt } = require('../lib/fallbackArtSource.js')
const { resolveArtworkTier } = require('../lib/artworkResolution.js')
const { resolvedItemImage } = require('../lib/whatsGoodImageSource.js')

const HANDOFF_DIR = path.join(__dirname, '..', 'assets-handoff', 'item-fallbacks', 'v1')
const MANIFEST_PATH = path.join(HANDOFF_DIR, '_build-manifest.json')

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(
      `${MANIFEST_PATH} not found — run \`node scripts/build-archetype-artwork.js\` first (requires cwebp: \`brew install webp\`).`
    )
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
}

test('conversion manifest lists exactly 23 keys, no duplicates', () => {
  const manifest = readManifest()
  assert.equal(manifest.assets.length, 23)
  const keys = manifest.assets.map((a) => a.key)
  assert.equal(new Set(keys).size, 23)
})

test('every manifest key is a real ARCHETYPE_KEYS registry entry, and every registry key is present', () => {
  const manifest = readManifest()
  const manifestKeys = new Set(manifest.assets.map((a) => a.key))
  for (const key of ARCHETYPE_KEYS) {
    assert.ok(manifestKeys.has(key), `registry key "${key}" missing from conversion manifest`)
  }
  for (const key of manifestKeys) {
    assert.ok(ARCHETYPE_KEYS.includes(key), `manifest key "${key}" is not a real registry key`)
  }
})

test('no duplicate Storage destination paths in the manifest', () => {
  const manifest = readManifest()
  const paths = manifest.assets.map((a) => a.storagePath)
  assert.equal(new Set(paths).size, paths.length)
  for (const a of manifest.assets) {
    assert.equal(a.storagePath, `item-fallbacks/v1/${a.key}.webp`)
  }
})

test('every prepared WebP file exists on disk and is exactly 1600x1000', () => {
  const manifest = readManifest()
  for (const asset of manifest.assets) {
    const filePath = path.join(HANDOFF_DIR, `${asset.key}.webp`)
    assert.ok(fs.existsSync(filePath), `${filePath} should exist`)

    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], { encoding: 'utf8' })
    const width = Number(/pixelWidth:\s*(\d+)/.exec(out)[1])
    const height = Number(/pixelHeight:\s*(\d+)/.exec(out)[1])
    assert.equal(width, 1600, `${asset.key}.webp width`)
    assert.equal(height, 1000, `${asset.key}.webp height`)

    // Manifest-recorded dims should match what's actually on disk.
    assert.equal(asset.width, 1600)
    assert.equal(asset.height, 1000)
  }
})

test('manifest SHA-256 checksums match the actual files on disk', () => {
  const crypto = require('node:crypto')
  const manifest = readManifest()
  for (const asset of manifest.assets) {
    const filePath = path.join(HANDOFF_DIR, `${asset.key}.webp`)
    const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
    assert.equal(actual, asset.sha256, `${asset.key}.webp checksum drifted from manifest`)
  }
})

test('Approach A safety: ARCHETYPE_STATUS was not accidentally flipped by asset prep — every key still pending', () => {
  for (const key of ARCHETYPE_KEYS) {
    assert.equal(ARCHETYPE_STATUS[key], 'pending', `${key} must still be pending — assets are prepared but not uploaded`)
  }
})

test('Approach A safety: prepared/converted assets still resolve url: null via resolveFallbackArt() (no live activation)', () => {
  for (const key of ARCHETYPE_KEYS) {
    const result = resolveFallbackArt({ fallback_art_key: key })
    assert.equal(result.archetypeKey, key)
    assert.equal(result.url, null, `${key} should resolve to a null url — not yet available`)
    assert.equal(result.status, 'pending')
  }
})

test('real-photo priority unchanged: resolveArtworkTier still returns the photo tier ahead of any archetype, even for a now-prepared key', () => {
  const item = { photo_url: 'https://example.com/real.jpg', fallback_art_key: 'coffee', categoryName: 'Food & drink' }
  assert.deepEqual(resolvedItemImage(item), { url: 'https://example.com/real.jpg' })
  const tier = resolveArtworkTier(item)
  assert.equal(tier.tier, 'photo')
  assert.equal(tier.url, 'https://example.com/real.jpg')
})
