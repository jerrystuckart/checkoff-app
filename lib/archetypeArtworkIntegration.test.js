// Hardening pass (2026-09-17) — structural/static checks that don't need a
// React Native component-render harness (none exists in this repo). These
// lock in two requirements that are otherwise easy to silently regress:
//
//   1. Both live card families (EditorialCard.jsx, WhatsTheThingHero.jsx)
//      actually import and render components/home/ArchetypeArtwork.jsx —
//      not just have it sitting in the tree unused.
//   2. The asset manifest documents the CORRECTED 1600×1000 dimensions,
//      not the previous incorrect 1600×1200 figure.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')

function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('EditorialCard.jsx imports and uses ArchetypeArtwork', () => {
  const source = readSource('components/home/EditorialCard.jsx')
  assert.match(source, /import ArchetypeArtwork from ['"]\.\/ArchetypeArtwork['"]/)
  // Actually rendered, not just imported — must appear as a JSX element.
  assert.match(source, /<ArchetypeArtwork\b/)
})

test('WhatsTheThingHero.jsx imports and uses ArchetypeArtwork', () => {
  const source = readSource('components/home/WhatsTheThingHero.jsx')
  assert.match(source, /import ArchetypeArtwork from ['"]\.\/ArchetypeArtwork['"]/)
  assert.match(source, /<ArchetypeArtwork\b/)
})

test('EditorialCard.jsx has no second/competing remote-archetype-image implementation left in the no-photo branches (raw <Image> use is confined to the real-photo tier)', () => {
  const source = readSource('components/home/EditorialCard.jsx')
  // Every raw <Image ... key={artwork.url} ...> in this file must be
  // reachable only from an artwork.isPhoto branch. This is a loose
  // heuristic (not a real parser), but it protects against the obvious
  // regression: someone re-adding a raw <Image> for the archetype tier
  // instead of routing it through ArchetypeArtwork.
  const rawImageCount = (source.match(/<Image\b/g) || []).length
  const archetypeArtworkCount = (source.match(/<ArchetypeArtwork\b/g) || []).length
  assert.ok(rawImageCount >= 1, 'expected at least one raw <Image> for the real-photo tier')
  assert.ok(archetypeArtworkCount >= 3, 'expected ArchetypeArtwork used for primary, rail, and row variants')
})

test('manifest documents corrected 1600 x 1000 dimensions as the live spec, not the old 1600x1200 figure', () => {
  const manifest = readSource('docs/fallback-art-manifest.md')
  assert.match(manifest, /Master dimensions:\s*1600\s*[×x]\s*1000/)
  // The old figure may still appear ONCE, inside the corrective callout
  // itself ("previous ... figure was wrong") — it must never appear as a
  // live, uncaveated spec (e.g. "Recommended dimensions: 1600×1200").
  assert.doesNotMatch(manifest, /[Rr]ecommended dimensions:\s*1600\s*[×x]\s*1200/)
})

test('manifest documents the 8:5 / 1.6:1 aspect ratio', () => {
  const manifest = readSource('docs/fallback-art-manifest.md')
  assert.match(manifest, /8:5/)
  assert.match(manifest, /1\.6:1/)
})

test('manifest documents how a pending key becomes available', () => {
  const manifest = readSource('docs/fallback-art-manifest.md')
  assert.match(manifest, /ARCHETYPE_STATUS/)
  assert.match(manifest, /available/)
})
