#!/usr/bin/env node
//
// scripts/verify-archetype-artwork-urls.js
//
// Archetype Fallback Artwork V1 — PREPARED post-upload verification.
// Checks all 23 public Storage URLs (built the exact same way
// lib/fallbackArtSource.js's fallbackArtUrl() does) return HTTP 200 with
// content-type image/webp, BEFORE any ARCHETYPE_STATUS entry is flipped
// from 'pending' to 'available'.
//
// This task ran this script once as a smoke test of the script itself,
// with NOTHING uploaded to Storage yet — every URL correctly came back
// 404, which is the EXPECTED result of that dry test, not a real
// verification pass. Do not treat a 404 run as "verification failed" —
// it just confirms nothing has been uploaded. Re-run this for real only
// after scripts/upload-archetype-artwork.js has actually uploaded all 23
// objects.
//
// Usage:
//   node scripts/verify-archetype-artwork-urls.js
//
// Exits non-zero if any of the 23 URLs does not return 200 + image/webp.

'use strict'

const { SUPABASE_URL } = require('../lib/supabaseConfig.js')
const { ARCHETYPE_KEYS, fallbackArtUrl } = require('../lib/fallbackArtSource.js')

async function checkOne(key) {
  const url = fallbackArtUrl(key)
  try {
    const res = await fetch(url, { method: 'GET' })
    const contentType = res.headers.get('content-type') || ''
    const ok = res.status === 200 && contentType.includes('image/webp')
    return { key, url, status: res.status, contentType, ok }
  } catch (err) {
    return { key, url, status: null, contentType: null, ok: false, error: String(err) }
  }
}

async function main() {
  console.log(`[verify-archetype-artwork-urls] checking ${ARCHETYPE_KEYS.length} URLs against ${SUPABASE_URL} ...\n`)

  const results = []
  for (const key of ARCHETYPE_KEYS) {
    // Sequential, not Promise.all — this hits the same public bucket 23
    // times in a row; no need to parallelize, and it keeps output ordered.
    // eslint-disable-next-line no-await-in-loop
    const result = await checkOne(key)
    results.push(result)
    const mark = result.ok ? 'OK ' : 'FAIL'
    console.log(`  [${mark}] ${key.padEnd(20)} ${result.status ?? 'ERR'}  ${result.contentType || ''}  ${result.url}`)
  }

  const failures = results.filter((r) => !r.ok)
  console.log(`\n[verify-archetype-artwork-urls] ${results.length - failures.length}/${results.length} OK.`)

  if (failures.length > 0) {
    console.log(
      `[verify-archetype-artwork-urls] ${failures.length} URL(s) not yet OK — if nothing has been uploaded yet,` +
        ' this is EXPECTED (every URL 404s). Do not flip ARCHETYPE_STATUS for any key still failing here.'
    )
    process.exit(1)
  }

  console.log('[verify-archetype-artwork-urls] All 23 URLs verified — safe to flip ARCHETYPE_STATUS entries to \'available\'.')
}

main()
