import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fetchIsPhotoAdmin, publishPhotoAsAdmin, photoAdminSuccessMessage, resetPhotoAdminCache } from './photoAdmin.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const stripSql = (s) => s.replace(/--.*$/gm, '')
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

function rpcClient(result) {
  const calls = []
  return { calls, rpc: async (fn, args) => { calls.push([fn, args]); return typeof result === 'function' ? result(fn, args) : result } }
}

test('fetchIsPhotoAdmin: true only when the server says exactly true; any error/odd value -> false', async () => {
  resetPhotoAdminCache()
  assert.equal(await fetchIsPhotoAdmin({ client: rpcClient({ data: true, error: null }), userId: 'u1' }), true)
  resetPhotoAdminCache()
  assert.equal(await fetchIsPhotoAdmin({ client: rpcClient({ data: 'true', error: null }), userId: 'u1' }), false)
  resetPhotoAdminCache()
  assert.equal(await fetchIsPhotoAdmin({ client: rpcClient({ data: null, error: { message: 'x' } }), userId: 'u1' }), false)
  resetPhotoAdminCache()
  assert.equal(await fetchIsPhotoAdmin({ client: { rpc: async () => { throw new Error('net') } }, userId: 'u1' }), false)
  assert.equal(await fetchIsPhotoAdmin({ client: rpcClient({ data: true }), userId: null }), false)
})

test('fetchIsPhotoAdmin: asks the server once per signed-in user, never trusts local profile data', async () => {
  resetPhotoAdminCache()
  const c = rpcClient({ data: true, error: null })
  await fetchIsPhotoAdmin({ client: c, userId: 'u1' })
  await fetchIsPhotoAdmin({ client: c, userId: 'u1' })
  assert.deepEqual(c.calls.map((x) => x[0]), ['is_photo_admin'])
  const c2 = rpcClient({ data: false, error: null })
  assert.equal(await fetchIsPhotoAdmin({ client: c2, userId: 'u2' }), false)
  assert.equal(c2.calls.length, 1, 'a different user is re-checked, not given the previous answer')
})

test('publishPhotoAsAdmin: one server RPC with the expected args; maps the result; surfaces server rejection', async () => {
  const c = rpcClient({ data: { candidate_id: 'c1', became_cover: true }, error: null })
  const r = await publishPhotoAsAdmin({ itemId: 'i1', storagePath: 'cover-candidates/u/1.jpg', moderationMetadata: { w: 1 }, client: c })
  assert.deepEqual(r, { candidateId: 'c1', becameCover: true })
  assert.deepEqual(c.calls, [['admin_publish_item_photo', { p_item_id: 'i1', p_storage_path: 'cover-candidates/u/1.jpg', p_moderation: { w: 1 } }]])
  const rotation = await publishPhotoAsAdmin({ itemId: 'i1', storagePath: 'p', client: rpcClient({ data: { candidate_id: 'c2', became_cover: false }, error: null }) })
  assert.equal(rotation.becameCover, false)
  await assert.rejects(() => publishPhotoAsAdmin({ itemId: 'i1', storagePath: 'p', client: rpcClient({ data: null, error: { message: 'not authorized' } }) }), /not authorized/)
})

test('confirmation copy matches the cover/rotation outcome', () => {
  assert.equal(photoAdminSuccessMessage(true), 'Photo is live and is now the cover')
  assert.equal(photoAdminSuccessMessage(false), 'Photo is live and was added to the rotation')
})

test('capture screen: ordinary path is unchanged (moderated insert); admin path is only the server RPC; client never writes an approved status', () => {
  const src = stripJs(read('../screens/CoverCandidateCaptureScreen.jsx'))
  assert.ok(src.includes('submitCoverCandidate({'))
  assert.ok(src.includes('initialStatusFromAssessment(assessment)'))
  assert.ok(src.includes('publishPhotoAsAdmin({'))
  assert.ok(!/status:\s*'(approved|selected|cover_eligible)'/.test(src))
  assert.ok(src.indexOf('fetchIsPhotoAdmin') < src.indexOf('publishPhotoAsAdmin({') && src.indexOf('publishPhotoAsAdmin({') < src.indexOf('submitCoverCandidate({'))
  const lib = stripJs(read('./photoAdmin.js'))
  assert.ok(!/from\('item_cover_candidates'\)|status:\s*'approved'/.test(lib), 'no direct table writes from the client helper')
})

test('no hardcoded admin identity in app code', () => {
  for (const f of ['./photoAdmin.js', './usePhotoAdmin.js', './useCoverCandidateCTA.js', '../screens/CoverCandidateCaptureScreen.jsx', '../components/CoverCandidateCTA.jsx']) {
    const code = stripJs(read(f))
    assert.ok(!/11275026|@hotmail|@gmail|jerrystuckart/i.test(code), f)
    assert.ok(!/is_admin|isAdmin/.test(code), `${f} must not use the spoofable users.is_admin`)
  }
})

test('eligibility for ordinary users is unchanged: photo-admin bypass is gated only on the server-verified hook', () => {
  const hook = stripJs(read('./useCoverCandidateCTA.js'))
  assert.ok(hook.includes('const isPhotoAdmin = usePhotoAdmin(userId)'))
  assert.ok(hook.includes('isCoverCandidateEligible({'))
  assert.ok(/if \(userId && item && isPhotoAdmin\) \{\s*setEligible\(true\)/.test(hook))
})

test('migration: photo-admin function verifies server-side, scopes the file, applies the cover-vs-rotation rule, never touches the business photo', () => {
  const sql = stripSql(read('../supabase/migrations/20261008_photo_admin_publish.sql'))
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_publish_item_photo/)
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = public, pg_temp/)
  assert.match(sql, /v_uid\s+uuid := auth\.uid\(\)/)
  assert.match(sql, /IF NOT EXISTS \(SELECT 1 FROM public\.photo_admins WHERE user_id = v_uid\)/)
  assert.match(sql, /NOT LIKE \('cover-candidates\/' \|\| v_uid::text \|\| '\/%'\)/)
  assert.match(sql, /FROM storage\.objects WHERE bucket_id = 'submission-photos' AND name = p_storage_path/)
  assert.match(sql, /v_cover := \(v_active IS NULL\)/)
  assert.match(sql, /'selected'[\s\S]*?true, true\)[\s\S]*?UPDATE public\.items SET active_cover_candidate_id = v_new/)
  assert.match(sql, /'cover_eligible'[\s\S]*?true, false\)/)
  assert.ok(!/secret_business_photo_storage_path/.test(sql), 'business photo is never written')
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_publish_item_photo\(uuid, text, jsonb\) FROM PUBLIC, anon/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_publish_item_photo\(uuid, text, jsonb\) TO authenticated/)
})

test('migration: photo_admins is unreadable/unwritable by clients; user INSERT policy can no longer pre-publish', () => {
  const sql = stripSql(read('../supabase/migrations/20261008_photo_admin_publish.sql'))
  assert.match(sql, /ALTER TABLE public\.photo_admins ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public\.photo_admins FROM PUBLIC, anon, authenticated/)
  assert.ok(!/CREATE POLICY[^;]*photo_admins/.test(sql), 'no policy on photo_admins')
  const policy = sql.slice(sql.indexOf('CREATE POLICY item_cover_candidates_insert_own'))
  for (const clause of ["status IN ('pending', 'needs_review', 'automated_rejected')", 'display_eligible = false', 'is_primary = false', "source = 'community'", 'reviewed_by_user_id IS NULL', 'submitted_by_user_id = auth.uid()', 'consent_ack = true']) {
    assert.ok(policy.includes(clause), clause)
  }
  // every client insert the app already makes satisfies the new policy
  const submit = stripJs(read('./coverCandidates.js'))
  assert.ok(/status,\s*\n\s*moderation_metadata: moderationMetadata \?\? \{\},\s*\n\s*consent_ack: true/.test(submit))
})
