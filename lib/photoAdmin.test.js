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
  const sql = stripSql(read('../supabase/migrations/20261008c_photo_admin_publish.sql'))
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

test('migration c: photo_admins is unreadable/unwritable by clients and independent of users.is_admin', () => {
  const sql = stripSql(read('../supabase/migrations/20261008c_photo_admin_publish.sql'))
  assert.match(sql, /ALTER TABLE public\.photo_admins ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public\.photo_admins FROM PUBLIC, anon, authenticated/)
  assert.ok(!/CREATE POLICY[^;]*photo_admins/.test(sql), 'no policy on photo_admins')
  assert.ok(!/is_admin/.test(sql), 'photo-admin capability must not depend on the (formerly spoofable) users.is_admin')
  assert.ok(!/item_cover_candidates_insert_own/.test(sql), 'insert-policy hardening lives in 20261008b')
  const manual = stripSql(read('../supabase/manual/grant_photo_admin.sql'))
  assert.match(manual, /INSERT INTO public\.photo_admins/)
})

test('migration a: users writes are an explicit allowlist that covers every column the app writes and excludes every sensitive one', () => {
  const sql = stripSql(read('../supabase/migrations/20261008a_lock_users_protected_columns.sql'))
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public\.users FROM PUBLIC, anon, authenticated/)
  assert.ok(!/REVOKE[^;]*\bSELECT\b/.test(sql), 'read grants untouched')
  const grant = sql.match(/GRANT UPDATE \(([\s\S]*?)\) ON public\.users TO authenticated/)[1].split(',').map((c) => c.trim()).filter(Boolean)
  for (const col of ['display_name', 'pref_show_alcohol', 'notif_check_ins', 'notif_invites', 'notif_nudges', 'share_channels', 'app_version', 'build_number', 'last_app_open_at', 'lifetime_points', 'referred_by']) {
    assert.ok(grant.includes(col), `app writes ${col}`)
  }
  for (const col of ['is_admin', 'is_pro', 'is_deleted', 'insider_tier', 'current_streak', 'longest_streak', 'last_checkin_week', 'visit_detection_tester', 'founding_number', 'email', 'id', 'email_bounced', 'email_opt_out', 'created_at', 'updated_at']) {
    assert.ok(!grant.includes(col), `${col} must not be client-writable`)
  }
  const sources = ['../screens/ProfileScreen.jsx', '../screens/SignInScreen.jsx', '../screens/ItemDetailScreen.jsx', './useAuth.js', './points.js', './referral.js'].map(read).join('\n')
  const written = new Set()
  for (const m of sources.matchAll(/from\('users'\)\s*\.update\(\{([^}]*)\}/g)) for (const k of m[1].split(',')) { const key = k.split(':')[0].trim().replace(/^\[|\]$/g, ''); if (key && key !== 'field' && /^[a-z_]+$/.test(key)) written.add(key) } // `[field]` in ProfileScreen is one of notif_check_ins/notif_invites/notif_nudges (asserted above)
  for (const col of written) assert.ok(grant.includes(col), `client writes users.${col} but it is not granted`)
})

test('migration b: candidate inserts are a column allowlist + status check; publication fields are not client-insertable', () => {
  const sql = stripSql(read('../supabase/migrations/20261008b_lock_cover_candidate_insert.sql'))
  const cols = sql.match(/GRANT INSERT \(([\s\S]*?)\)\s+ON public\.item_cover_candidates TO authenticated/)[1].split(',').map((c) => c.trim())
  assert.deepEqual([...cols].sort(), ['consent_ack', 'item_id', 'moderation_metadata', 'status', 'storage_path', 'submitted_by_user_id'])
  for (const forbidden of ['display_eligible', 'is_primary', 'display_weight', 'reviewed_by_user_id', 'reviewed_at', 'selected_as_cover_at', 'rejection_reason', 'source', 'submitted_by_token_id']) {
    assert.ok(!cols.includes(forbidden), forbidden)
  }
  const policy = sql.slice(sql.indexOf('CREATE POLICY item_cover_candidates_insert_own'))
  assert.ok(policy.includes("status IN ('pending', 'needs_review', 'automated_rejected')"))
  assert.ok(policy.includes('submitted_by_user_id = auth.uid()') && policy.includes('consent_ack = true'))
  const submit = stripJs(read('./coverCandidates.js'))
  const start = submit.indexOf('.insert({')
  const insertBlock = submit.slice(start, submit.indexOf('})', start))
  const keys = [...insertBlock.matchAll(/^\s*([a-z_]+):/gm)].map((k) => k[1])
  assert.ok(keys.length >= 5, 'found the client insert columns')
  for (const k of keys) assert.ok(cols.includes(k), `client inserts ${k}`)
})

test('the adversarial permission matrix script ends in a guaranteed rollback and covers every actor', () => {
  const sql = read('../supabase/tests/security_matrix_20261008.sql')
  assert.match(sql, /RAISE EXCEPTION E'MATRIX_RESULT/)
  for (const actor of ['anon:', 'user:', 'photoadmin:', 'admin:', 'service_role:']) assert.ok(sql.includes(actor), actor)
  assert.ok(/SET LOCAL ROLE anon/.test(sql) && /SET LOCAL ROLE authenticated/.test(sql) && /SET LOCAL ROLE service_role/.test(sql))
  assert.ok(!/\bCOMMIT\b/.test(sql.replace(/--.*$/gm, '')), 'the matrix must never commit')
})
