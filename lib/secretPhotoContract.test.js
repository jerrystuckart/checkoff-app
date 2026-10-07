// Locked-screen photo contract (2026-10-07). Submission/approval of normal
// experience photos for secret items is allowed, but the LOCKED Secret CheckOff
// background may only ever be the dedicated Business Photo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fetchSecretBusinessPhotoUrl } from './secretBusinessPhoto.js'
import { resolveArtworkTier } from './artworkResolution.js'
import { resolvedItemImages } from './whatsGoodImageSource.js'

// A secret item that has EVERYTHING: a business photo, an active cover and approved candidates.
function richClient({ businessPath = 'secret-business-photos/i1/b.jpg' } = {}) {
  const touched = { tables: [], selects: [], signed: [] }
  return {
    touched,
    from(table) {
      touched.tables.push(table)
      return {
        select(cols) {
          touched.selects.push(`${table}:${cols}`)
          return { eq: () => ({ maybeSingle: async () => ({
            data: table === 'items' ? { secret_business_photo_storage_path: businessPath, active_cover_candidate_id: 'c1' } : null, error: null }) }) }
        },
      }
    },
    storage: { from: () => ({ createSignedUrl: async (p) => { touched.signed.push(p); return { data: { signedUrl: `https://signed/${p}` }, error: null } } }) },
  }
}

test('locked secret + Business Photo -> the Business Photo is what is signed and shown', async () => {
  const c = richClient()
  assert.equal(await fetchSecretBusinessPhotoUrl({ itemId: 'i1', client: c }), 'https://signed/secret-business-photos/i1/b.jpg')
  assert.deepEqual(c.touched.signed, ['secret-business-photos/i1/b.jpg'])
})

test('locked secret + active cover / approved candidates -> NONE are read or signed (only the business column)', async () => {
  const c = richClient()
  await fetchSecretBusinessPhotoUrl({ itemId: 'i1', client: c })
  assert.deepEqual(c.touched.tables, ['items'], 'item_cover_candidates is never queried')
  assert.deepEqual(c.touched.selects, ['items:secret_business_photo_storage_path'], 'active_cover_candidate_id is never selected')
  assert.equal(c.touched.signed.length, 1)
})

test('locked secret + no Business Photo -> null (purple/dark design), even though covers exist', async () => {
  const c = richClient({ businessPath: null })
  assert.equal(await fetchSecretBusinessPhotoUrl({ itemId: 'i1', client: c }), null)
  assert.deepEqual(c.touched.signed, [], 'nothing is signed as a fallback')
})

test('the screen background is exactly the business photo, and the screen reads no cover sources', () => {
  const src = readFileSync(new URL('../screens/SecretRevealScreen.jsx', import.meta.url), 'utf8')
  assert.ok(src.includes('const coverPhoto = businessPhotoUrl && !coverFailed ? { url: businessPhotoUrl } : null'))
  for (const banned of ['activeCoverImageUrl', 'active_cover_candidate_id', 'displayEligibleImages', 'item_cover_candidates', 'fetchActiveCoverImageUrl', 'fetchDisplayEligibleImagePool', 'useCardArtwork']) {
    assert.ok(!src.includes(banned), `SecretRevealScreen must not reference ${banned}`)
  }
})

test('unlocked secret -> normal approved-cover behavior (is_secret does not filter or change image resolution)', () => {
  const pool = [{ url: 'https://signed/approved.jpg', isPrimary: true, weight: 1 }]
  const secret = { id: 'i1', is_secret: true, displayEligibleImages: pool }
  const normal = { id: 'i1', is_secret: false, displayEligibleImages: pool }
  assert.deepEqual(resolvedItemImages(secret), resolvedItemImages(normal))
  assert.equal(resolveArtworkTier(secret, {}).tier, 'photo')
  assert.equal(resolveArtworkTier(secret, {}).url, 'https://signed/approved.jpg')
  for (const f of ['./coverCandidates.js', './whatsGoodImageSource.js', './artworkResolution.js']) {
    assert.ok(!/is_secret|isSecret/.test(readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), `${f} must not special-case secret items`)
  }
})

test('the CTA stays proximity-gated for secret items (no secret-specific visibility rule)', () => {
  const hook = readFileSync(new URL('./useSecretPhotoContribution.js', import.meta.url), 'utf8')
  assert.ok(hook.includes('isAtPlace: isAtPlace(item, userLocation)'))
  assert.ok(!/is_secret|isSecret/.test(hook.replace(/\/\/.*$/gm, '')))
  const elig = readFileSync(new URL('./coverCandidateEligibility.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  assert.ok(elig.includes("reason: 'not_at_place'") && !/isSecret|is_secret/.test(elig.replace(/\/\*[\s\S]*?\*\//g, '')))
})

test('migrations: the two secret guards are dropped and nothing else is touched; storage insert is user-folder scoped', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const strip = (f) => readFileSync(new URL(f, dir), 'utf8').replace(/--.*$/gm, '')
  const b = strip('20261007b_allow_secret_cover_candidate_submissions.sql')
  const c = strip('20261007c_allow_secret_item_active_cover.sql')
  const d = strip('20261007d_tighten_submission_photos_upload.sql')
  assert.match(b, /DROP TRIGGER IF EXISTS item_cover_candidates_reject_secret_items/)
  assert.match(c, /DROP TRIGGER IF EXISTS items_reject_secret_active_cover/)
  for (const m of [b, c]) assert.ok(!/ALTER|CREATE|UPDATE|DELETE|INSERT/i.test(m))
  assert.match(d, /FOR INSERT TO authenticated/)
  assert.match(d, /\(storage\.foldername\(name\)\)\[1\] = 'cover-candidates'/)
  assert.match(d, /\(storage\.foldername\(name\)\)\[2\] = auth\.uid\(\)::text/)
  const capture = readFileSync(new URL('../screens/CoverCandidateCaptureScreen.jsx', import.meta.url), 'utf8')
  assert.ok(capture.includes('`cover-candidates/${user.id}/${Date.now()}.${rawExt}`'), 'policy path == the path the app really uploads to')
})
