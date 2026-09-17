#!/usr/bin/env node
//
// scripts/build-archetype-artwork.js
//
// Archetype Fallback Artwork V1 — deployment-ready asset build (2026-09-17,
// asset integration / release-prep pass). Converts the 23 approved PNG
// originals living OUTSIDE this repo
// (~/Downloads/checkoff-home-archetype-artwork-approved/) into the exact
// production spec documented in docs/fallback-art-manifest.md:
//
//   1600 x 1000 px, 8:5, WebP, sRGB.
//
// This is a ONE-TIME, BUILD-TIME script — it is never imported by the RN
// app, never adds a runtime dependency, and never uploads anything. It
// writes converted .webp files to a git-ignored local handoff directory
// (see .gitignore's "/assets-handoff/" entry) that is NOT committed to git.
// Only this script + docs/fallback-art-manifest.md (updated by hand from
// this script's printed output) are meant to be committed.
//
// Requires `cwebp` (from the `webp` Homebrew formula: `brew install webp`)
// and macOS `sips` (built-in) on PATH. Neither is a new app dependency —
// both are local command-line tools this script shells out to.
//
// Usage:
//   node scripts/build-archetype-artwork.js
//
// Never overwrites or modifies the source PNGs. Fails loudly (non-zero
// exit) on any missing source, duplicate key, duplicate destination path,
// or output that isn't exactly 1600x1000.

'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

// ── Config ──────────────────────────────────────────────────────────────

const SOURCE_DIR = '/Users/jerrystuckart/Downloads/checkoff-home-archetype-artwork-approved'
const OUTPUT_DIR = path.join(__dirname, '..', 'assets-handoff', 'item-fallbacks', 'v1')
const OUT_WIDTH = 1600
const OUT_HEIGHT = 1000
const WEBP_QUALITY = 82 // lossy, high-quality; see report for reasoning

// Explicit source-key -> destination (canonical registry) key mapping.
// Reconciled by hand against lib/fallbackArtSource.js's ARCHETYPE_KEYS
// (2026-09-17) — all 23 filenames matched their registry key exactly, no
// renames were needed. Written out explicitly anyway (not just "same
// name") so a future divergence between filenames and the registry is a
// one-line edit here, not a silent assumption.
const KEY_MAP = {
  restaurant_general: 'restaurant_general',
  signature_food: 'signature_food',
  coffee: 'coffee',
  dessert: 'dessert',
  beer: 'beer',
  wine: 'wine',
  cocktails: 'cocktails',
  hidden_entrance: 'hidden_entrance',
  outdoor_desert: 'outdoor_desert',
  outdoor_mountain: 'outdoor_mountain',
  outdoor_forest: 'outdoor_forest',
  outdoor_water: 'outdoor_water',
  outdoor_winter: 'outdoor_winter',
  outdoor_general: 'outdoor_general',
  scenic_view: 'scenic_view',
  historic_place: 'historic_place',
  arts_culture: 'arts_culture',
  live_entertainment: 'live_entertainment',
  shopping_market: 'shopping_market',
  games_play: 'games_play',
  sports: 'sports',
  wellness: 'wellness',
  local_oddity: 'local_oddity',
}

// ── Helpers ─────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\n[build-archetype-artwork] FAILED: ${msg}\n`)
  process.exit(1)
}

function sha256(filePath) {
  const buf = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function sipsDimensions(filePath) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], { encoding: 'utf8' })
  const w = /pixelWidth:\s*(\d+)/.exec(out)
  const h = /pixelHeight:\s*(\d+)/.exec(out)
  if (!w || !h) fail(`could not read dimensions of ${filePath}`)
  return { width: Number(w[1]), height: Number(h[1]) }
}

function fmtBytes(n) {
  return `${(n / 1024).toFixed(1)} KB`
}

// ── Validate mapping integrity before touching any file ───────────────────

function validateMapping() {
  const sourceKeys = Object.keys(KEY_MAP)
  const destKeys = Object.values(KEY_MAP)

  if (new Set(sourceKeys).size !== sourceKeys.length) fail('duplicate source key in KEY_MAP')
  if (new Set(destKeys).size !== destKeys.length) fail('duplicate destination key in KEY_MAP — would overwrite a canonical .webp')
  if (sourceKeys.length !== 23) fail(`KEY_MAP has ${sourceKeys.length} entries, expected exactly 23`)

  for (const [srcKey, destKey] of Object.entries(KEY_MAP)) {
    const srcPath = path.join(SOURCE_DIR, `${srcKey}.png`)
    if (!fs.existsSync(srcPath)) fail(`missing source file: ${srcPath}`)
    if (!destKey || typeof destKey !== 'string') fail(`invalid destination key for source "${srcKey}"`)
  }
}

// ── Convert one asset ───────────────────────────────────────────────────

function convertOne(srcKey, destKey) {
  const srcPath = path.join(SOURCE_DIR, `${srcKey}.png`)
  const outPath = path.join(OUTPUT_DIR, `${destKey}.webp`)

  // cwebp -resize forces exact output dimensions (no crop, no letterbox —
  // the sources are already ~1586x992, i.e. ~1.6:1, so this is a benign
  // near-1:1 scale to hit the exact 1600x1000 spec, not a meaningful crop
  // or stretch). -metadata none strips EXIF/ICC/XMP bloat. Sources are
  // plain RGB with no embedded ICC profile (confirmed via sips -g
  // space/hasAlpha during validation), so treating them as sRGB and
  // stripping metadata does not silently shift color.
  execFileSync('cwebp', [
    '-quiet',
    '-q', String(WEBP_QUALITY),
    '-resize', String(OUT_WIDTH), String(OUT_HEIGHT),
    '-metadata', 'none',
    srcPath,
    '-o', outPath,
  ])

  if (!fs.existsSync(outPath)) fail(`cwebp produced no output for ${destKey}`)

  const dims = sipsDimensions(outPath)
  if (dims.width !== OUT_WIDTH || dims.height !== OUT_HEIGHT) {
    fail(`${destKey}.webp is ${dims.width}x${dims.height}, expected exactly ${OUT_WIDTH}x${OUT_HEIGHT}`)
  }

  const stat = fs.statSync(outPath)
  const checksum = sha256(outPath)

  return { destKey, outPath, width: dims.width, height: dims.height, bytes: stat.size, sha256: checksum }
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  console.log('[build-archetype-artwork] validating source dir + mapping...')
  if (!fs.existsSync(SOURCE_DIR)) fail(`source directory not found: ${SOURCE_DIR}`)
  validateMapping()

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  // Fail loudly if cwebp isn't on PATH, with an actionable message,
  // instead of a cryptic ENOENT from execFileSync mid-loop.
  try {
    execFileSync('cwebp', ['-version'], { stdio: 'ignore' })
  } catch {
    fail('`cwebp` not found on PATH. Install it with `brew install webp` (one-time local dev tool, not an app dependency).')
  }

  const results = []
  const seenDestPaths = new Set()

  for (const [srcKey, destKey] of Object.entries(KEY_MAP)) {
    const result = convertOne(srcKey, destKey)
    if (seenDestPaths.has(result.outPath)) fail(`duplicate destination path produced: ${result.outPath}`)
    seenDestPaths.add(result.outPath)
    results.push(result)
    console.log(
      `  ${destKey.padEnd(20)} -> ${result.width}x${result.height}  ${fmtBytes(result.bytes).padStart(9)}  sha256:${result.sha256.slice(0, 12)}...`
    )
  }

  if (results.length !== 23) fail(`produced ${results.length} outputs, expected exactly 23`)

  console.log(`\n[build-archetype-artwork] OK — 23/23 WebP assets written to ${OUTPUT_DIR}`)
  console.log('[build-archetype-artwork] These files are git-ignored (see .gitignore "/assets-handoff/") — not committed.')

  // Machine-readable manifest fragment for cross-checking against
  // docs/fallback-art-manifest.md by hand.
  const manifestPath = path.join(OUTPUT_DIR, '_build-manifest.json')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        outputDir: OUTPUT_DIR,
        width: OUT_WIDTH,
        height: OUT_HEIGHT,
        quality: WEBP_QUALITY,
        assets: results.map((r) => ({
          key: r.destKey,
          storagePath: `item-fallbacks/v1/${r.destKey}.webp`,
          width: r.width,
          height: r.height,
          bytes: r.bytes,
          sha256: r.sha256,
        })),
      },
      null,
      2
    )
  )
  console.log(`[build-archetype-artwork] wrote ${manifestPath}`)
}

main()
