#!/usr/bin/env node
//
// scripts/upload-archetype-artwork.js
//
// Archetype Fallback Artwork V1 — PREPARED upload procedure. NOT executed
// against real Supabase Storage as part of this asset-prep pass (see
// docs/fallback-art-manifest.md's "Upload procedure" + the deployment-order
// doc). This script is the documented, deterministic way to run that step
// later, once the DB migration (supabase/migrations/20260917_items_fallback_art_key.sql)
// and device QA are both done, per the required order.
//
// What it does when actually run:
//   1. Reads the 23 converted WebP files from assets-handoff/item-fallbacks/v1/
//      (produced by scripts/build-archetype-artwork.js) — fails fast if any
//      of the 23 expected files is missing.
//   2. For each, uploads to the PRE-EXISTING public `checkoff-images` bucket
//      at object path `item-fallbacks/v1/<key>.webp`, with:
//        - contentType: 'image/webp'
//        - cacheControl: '31536000' (1 year) — safe because the path is
//          version-scoped/immutable (see lib/fallbackArtSource.js's
//          FALLBACK_ART_VERSION comment: art-direction changes publish
//          under a NEW version folder, e.g. v2/, rather than overwriting
//          v1/<key>.webp in place).
//        - upsert: false — these are new v1 paths that should not already
//          exist. If a path unexpectedly already exists, the upload fails
//          loudly instead of silently overwriting someone else's object
//          (matches the manifest's "do not overwrite a key's file in
//          place if art direction changes" rule).
//   3. Prints the 23 resulting public URLs (same shape as
//      lib/fallbackArtSource.js's fallbackArtUrl()).
//
// Auth: uses the Supabase SERVICE ROLE key (required to write to Storage
// from a script, not the anon key the app uses) via the
// SUPABASE_SERVICE_ROLE_KEY env var — never hardcoded, never logged. Get it
// from Supabase Studio -> Project Settings -> API -> service_role (secret).
//
// Usage (NOT run by this task):
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-archetype-artwork.js
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-archetype-artwork.js --dry-run
//
// --dry-run lists what WOULD be uploaded (paths, content-type, sizes)
// without calling Storage at all — useful to sanity-check the file set
// without needing credentials.

'use strict'

const fs = require('fs')
const path = require('path')

const { SUPABASE_URL } = require('../lib/supabaseConfig.js')
const { ARCHETYPE_KEYS } = require('../lib/fallbackArtSource.js')

const BUCKET = 'checkoff-images'
const VERSION = 'v1'
const LOCAL_DIR = path.join(__dirname, '..', 'assets-handoff', 'item-fallbacks', VERSION)
const CACHE_CONTROL = '31536000' // 1 year — safe for an immutable, version-scoped path

function expectedLocalPath(key) {
  return path.join(LOCAL_DIR, `${key}.webp`)
}

function objectPath(key) {
  return `item-fallbacks/${VERSION}/${key}.webp`
}

function fail(msg) {
  console.error(`\n[upload-archetype-artwork] FAILED: ${msg}\n`)
  process.exit(1)
}

function preflight() {
  const missing = ARCHETYPE_KEYS.filter((key) => !fs.existsSync(expectedLocalPath(key)))
  if (missing.length > 0) {
    fail(
      `missing ${missing.length} local WebP file(s), run scripts/build-archetype-artwork.js first:\n` +
        missing.map((k) => `  - ${expectedLocalPath(k)}`).join('\n')
    )
  }
  if (ARCHETYPE_KEYS.length !== 23) fail(`ARCHETYPE_KEYS has ${ARCHETYPE_KEYS.length} entries, expected 23`)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  console.log('[upload-archetype-artwork] preflight: checking all 23 local WebP files exist...')
  preflight()
  console.log('[upload-archetype-artwork] preflight OK — all 23 files present locally.')

  if (dryRun) {
    console.log('\n[upload-archetype-artwork] --dry-run: would upload the following (no network call made):')
    for (const key of ARCHETYPE_KEYS) {
      const localPath = expectedLocalPath(key)
      const bytes = fs.statSync(localPath).size
      console.log(`  ${objectPath(key).padEnd(40)} <- ${localPath}  (${bytes} bytes, image/webp, cache-control: public, max-age=${CACHE_CONTROL}, immutable)`)
    }
    console.log('\n[upload-archetype-artwork] Dry run complete. Nothing was uploaded.')
    return
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail('SUPABASE_SERVICE_ROLE_KEY env var is required for a real upload (not needed for --dry-run).')
  }

  // Deferred require so --dry-run never needs @supabase/supabase-js's full
  // client construction or credentials.
  const { createClient } = require('@supabase/supabase-js')
  const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const results = []
  for (const key of ARCHETYPE_KEYS) {
    const localPath = expectedLocalPath(key)
    const fileBuffer = fs.readFileSync(localPath)
    const destPath = objectPath(key)

    console.log(`[upload-archetype-artwork] uploading ${destPath} ...`)
    const { error } = await supabase.storage.from(BUCKET).upload(destPath, fileBuffer, {
      contentType: 'image/webp',
      cacheControl: CACHE_CONTROL,
      upsert: false, // fail if it already exists — new v1 paths should not pre-exist
    })

    if (error) {
      fail(`upload failed for ${destPath}: ${error.message}`)
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(destPath)
    results.push({ key, path: destPath, url: publicUrlData.publicUrl })
    console.log(`  OK -> ${publicUrlData.publicUrl}`)
  }

  console.log(`\n[upload-archetype-artwork] Uploaded ${results.length}/23 assets.`)
  console.log('[upload-archetype-artwork] Next: run scripts/verify-archetype-artwork-urls.js, THEN flip ARCHETYPE_STATUS entries to \'available\'.')
}

main().catch((err) => fail(err.stack || String(err)))
