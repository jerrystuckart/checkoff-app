import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { revokeAppleTokenIfPossible, hasAppleIdentity } from './appleRevocation.js'
import { interpretDeletionResponse, requestAccountDeletion, clearLocalAccountState, describeSignInError, DELETION_COPY, LOCAL_KEY_PREFIXES } from './accountDeletion.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')

test('response handling: completed vs accepted are distinct, and an empty legacy answer never claims completion', () => {
  assert.deepEqual(interpretDeletionResponse({ status: 'completed', request_id: 'r1' }), { kind: 'completed', requestId: 'r1' })
  assert.deepEqual(interpretDeletionResponse({ status: 'accepted', request_id: 'r2' }), { kind: 'accepted', requestId: 'r2' })
  assert.equal(interpretDeletionResponse(null).kind, 'accepted')
  assert.equal(interpretDeletionResponse(undefined).kind, 'accepted')
  assert.doesNotMatch(DELETION_COPY.acceptedBody, /has been deleted|have been deleted/)
  assert.match(DELETION_COPY.completedBody, /have been deleted/)
})

test('requestAccountDeletion calls only delete_my_account with NO user id argument, and throws on any error so nothing is cleared', async () => {
  const calls = []
  const ok = { rpc: async (...a) => { calls.push(a); return { data: { status: 'accepted', request_id: 'x' }, error: null } } }
  assert.deepEqual(await requestAccountDeletion(ok), { kind: 'accepted', requestId: 'x' })
  assert.deepEqual(calls, [['delete_my_account']], 'identity comes from the session; no id or payload is sent')
  const bad = { rpc: async () => ({ data: null, error: new Error('network down') }) }
  await assert.rejects(() => requestAccountDeletion(bad), /network down/)
})

test('local cleanup stops visit tracking, resets the flag cache, removes only per account keys, and survives a failing step', async () => {
  const removed = []
  const storage = {
    getAllKeys: async () => ['evt:item_view:abc', 'atPlaceReminders_v1', 'theme', 'selectedMetroSlug', 'visitStateOwner'],
    multiRemove: async (k) => { removed.push(...k) },
  }
  const order = []
  const steps = await clearLocalAccountState({
    stopVisitTracking: async () => { order.push('stop'); throw new Error('boom') },
    resetFlagsCache: () => order.push('flags'),
    storage,
  })
  assert.deepEqual(order, ['stop', 'flags'], 'a failing step does not skip the others')
  assert.deepEqual(removed.sort(), ['atPlaceReminders_v1', 'evt:item_view:abc'])
  assert.ok(!removed.includes('theme') && !removed.includes('selectedMetroSlug'), 'device preferences stay')
  assert.deepEqual(steps, ['flags', 'storage'])
  assert.ok(LOCAL_KEY_PREFIXES.length >= 2)
})

test('a banned (deleted or deleting) account gets a clear sign in message; other errors pass through', () => {
  assert.match(describeSignInError('User is banned'), /deleted or is being deleted/)
  assert.equal(describeSignInError('Invalid login credentials'), 'Invalid login credentials')
})

test('Profile wiring: two confirmations, request first, local cleanup only after acceptance, then sign out, failure keeps the user signed in', () => {
  const src = read('../screens/ProfileScreen.jsx')
  const i = src.indexOf('async function deleteAccount()')
  const body = src.slice(i, src.indexOf('function dismissLevelPeek()'))
  assert.ok((body.match(/Alert\.alert\(/g) ?? []).length >= 3, 'two confirmation alerts plus result alerts')
  const req = body.indexOf('requestAccountDeletion(supabase)')
  const clear = body.indexOf('clearLocalAccountState(')
  const out = body.indexOf('authSignOut()')
  assert.ok(req > 0 && req < clear && clear < out, 'request, then local cleanup, then sign out')
  assert.match(body, /catch \(e\) \{[\s\S]{0,400}return\n/, 'a failed request returns before any local cleanup or sign out')
  assert.doesNotMatch(body, /supabase\.rpc\('delete_my_account'/, 'no direct rpc: the shared helper is the only caller')
  assert.match(read('../screens/SignInScreen.jsx'), /describeSignInError\(error\.message\)/)
})

test('migration 20261008d: identity from auth.uid(), privileges, inventory before removal, deliberate FK handling, no cascade through shared content', () => {
  const sql = read('../supabase/migrations/20261008d_account_deletion_pipeline.sql')
  const fn = (name) => sql.slice(sql.indexOf(`function public.${name}(`), sql.indexOf('end $$;', sql.indexOf(`function public.${name}(`)))
  const client = fn('delete_my_account')
  assert.match(client, /v_uid uuid := auth\.uid\(\)/)
  assert.doesNotMatch(client, /delete_my_account\(\s*\w+ uuid/, 'no user id parameter')
  assert.ok(client.indexOf('account_deletion_inventory(v_uid)') < client.indexOf('update auth.users set banned_until'), 'inventory before access is blocked')
  assert.match(client, /delete from auth\.sessions where user_id = v_uid/)
  assert.doesNotMatch(client, /delete from auth\.users/, 'the client callable function never deletes the auth user directly')
  assert.match(sql, /revoke all on function public\.account_deletion_delete_data\(uuid\)\s+from public, anon, authenticated/)
  assert.match(sql, /grant execute on function public\.delete_my_account\(\) to authenticated, service_role/)
  assert.match(sql, /revoke all on function public\.delete_my_account\(\) from public, anon/)
  assert.match(sql, /alter table public\.account_deletion_requests enable row level security/)
  const data = fn('account_deletion_delete_data')
  for (const t of ['interaction_events', 'campaign_sends', 'notification_log']) assert.match(data, new RegExp(`delete from public\\.${t}\\s+where user_id = v_uid`))
  for (const u of [/update public\.users\s+set referred_by = null/, /update public\.partner_promotions\s+set created_by\s+= null/, /update public\.creators\s+set user_id\s+= null/]) assert.match(data, u)
  assert.match(data, /creator_id = v_new_owner/, 'shared lists are transferred, not deleted')
  assert.doesNotMatch(data, /delete from public\.(list_items|list_members|items|check_ins)\b/, 'no explicit deletes of shared content')
  assert.match(data, /count\(\*\) from public\.users where is_admin\) <= 1/, 'only the last administrator is protected')
  const proc = fn('account_deletion_process')
  assert.ok(proc.indexOf("'accepted'") < proc.indexOf('account_deletion_delete_data'), 'files are handled before database rows')
  assert.match(proc, /account_deletion_objects_remaining/, 'removal is verified, not assumed')
  assert.ok(proc.indexOf('account_deletion_delete_data') < proc.indexOf('delete from auth.users'), 'auth account is removed last')
})

const migration = () => read('../supabase/migrations/20261008d_account_deletion_pipeline.sql')
const fnBody = (sql, name) => sql.slice(sql.indexOf(`function public.${name}(`), sql.indexOf('end $$;', sql.indexOf(`function public.${name}(`)))

test('anonymous completion counts: non identifying shape, service role only, only confirmed check ins, month granularity', () => {
  const sql = migration()
  const table = sql.slice(sql.indexOf('create table if not exists public.anonymous_completion_counts'), sql.indexOf('comment on table public.anonymous_completion_counts'))
  const cols = [...table.matchAll(/^\s+(\w+)\s+(uuid|date|text|int)\b/gm)].map((m) => m[1]).sort()
  assert.deepEqual(cols, ['completions', 'item_id', 'method', 'period_month'], 'no user, list, list item, check in, candidate, session, coordinate, note, photo or day column')
  assert.doesNotMatch(cols.join(' '), /user|session|candidate|photo|lat|lng|note|check_in|list/i)
  assert.match(table, /primary key \(item_id, period_month, method\)/, 'cells, not rows: no per completion identity or ordering')
  assert.match(table, /period_month = date_trunc\('month', period_month\)::date/, 'month granularity is enforced')
  assert.match(sql, /revoke all on public\.anonymous_completion_counts from public, anon, authenticated/)
  const data = fnBody(sql, 'account_deletion_delete_data')
  assert.match(data, /from public\.check_ins c left join public\.list_items li/, 'counts come from confirmed check ins')
  assert.doesNotMatch(data.slice(0, data.indexOf('delete from public.users')).replace(/--[^\n]*/g, ''), /candidate_visits|visit_presence_sessions/, 'detected visits and suggestions are never counted')
  assert.ok(data.indexOf('insert into public.anonymous_completion_counts') < data.indexOf('delete from public.users where id = v_uid'), 'counted before the rows are deleted, in the same transaction')
  assert.match(data, /if not v_counted then[\s\S]*update public\.account_deletion_requests set counts_recorded = true/, 'a retry can never count twice')
  assert.match(data, /group by 1, 2/, 'one completion per experience per day (fan out mirror rows are the same action)')
})

test('retained submitted photos: anonymized (row, path, storage owner, metadata); rejected ones deleted; private files deleted', () => {
  const sql = migration()
  const retain = fnBody(sql, 'account_deletion_retain_inventory')
  assert.match(retain, /k\.status <> 'rejected'/)
  assert.match(retain, /\/retained\//, 'moved to a neutral path that does not contain the uploader id')
  const inv = fnBody(sql, 'account_deletion_inventory')
  assert.match(inv, /status = 'rejected'/)
  assert.match(inv, /not \(f\.bucket = 'submission-photos' and f\.name in \(select name from retained\)\)/, 'a retained file is never in the delete manifest')
  const proc = fnBody(sql, 'account_deletion_process')
  assert.match(proc, /submitted_by_user_id = null/)
  assert.match(proc, /account_deletion_scrub_json\(c\.moderation_metadata, r\.user_id\)/)
  assert.match(proc, /set owner = null, owner_id = null/)
  assert.ok(proc.indexOf('storage_path = m."to"') < proc.indexOf("status = 'content_retained'"), 'row anonymized only after the move is verified')
  assert.ok(proc.indexOf("r.status = 'content_retained'") < proc.indexOf('account_deletion_objects_remaining'), 'private files are removed after retained photos are safe')
})

test('administrators: deletion supported except for the last administrator and last photo administrator, with an explicit instruction', () => {
  const client = fnBody(migration(), 'delete_my_account')
  assert.match(client, /only CheckOff administrator\. Make another account an administrator first/)
  assert.match(client, /only CheckOff photo administrator\. Add another photo administrator first/)
  assert.match(client, /count\(\*\) from public\.users where is_admin\) <= 1/)
})

test('reporting adds anonymous counts without breaking when the helper is missing', () => {
  const portal = readFileSync(join(here, '../supabase/functions/get-partner-data/index.ts'), 'utf8')
  const recap = readFileSync(join(here, '../supabase/functions/send-partner-recap/index.ts'), 'utf8')
  for (const src of [portal, recap]) assert.match(src, /anonymous_completions_for_items/)
  assert.match(portal, /catch \{ \/\* reporting stays available/)
  assert.match(recap, /catch \{ return 0 \}/)
})

test('Apple revocation never throws, never prompts unless the server can revoke, and never blocks deletion', async () => {
  const appleUser = { identities: [{ provider: 'apple' }] }
  assert.equal(hasAppleIdentity(appleUser), true)
  assert.equal(hasAppleIdentity({ app_metadata: { providers: ['email'] }, identities: [{ provider: 'email' }] }), false)
  const mk = (over = {}) => {
    const log = { prompted: 0, invoked: [] }
    const supabase = {
      auth: { getUser: async () => ({ data: { user: over.user ?? appleUser } }) },
      functions: { invoke: async (name, o) => { log.invoked.push(o.body); return over.invoke ? over.invoke(o.body) : { data: { available: true, apple: true, revoked: true, reason: 'ok' }, error: null } } },
    }
    const AppleAuthentication = { signInAsync: async () => { log.prompted++; if (over.cancel) throw new Error('cancelled'); return { authorizationCode: 'code' } } }
    return { log, args: { supabase, platformOS: over.os ?? 'ios', AppleAuthentication, timeoutMs: 50 } }
  }
  let t = mk(); assert.deepEqual(await revokeAppleTokenIfPossible(t.args), { attempted: true, revoked: true, reason: 'ok' }); assert.equal(t.log.prompted, 1)
  t = mk({ os: 'android' }); assert.equal((await revokeAppleTokenIfPossible(t.args)).reason, 'not_ios'); assert.equal(t.log.prompted, 0)
  t = mk({ user: { identities: [{ provider: 'email' }] } }); assert.equal((await revokeAppleTokenIfPossible(t.args)).reason, 'not_apple'); assert.equal(t.log.prompted, 0)
  t = mk({ invoke: async () => ({ data: null, error: new Error('404') }) }); assert.equal((await revokeAppleTokenIfPossible(t.args)).reason, 'unavailable'); assert.equal(t.log.prompted, 0, 'function not deployed: no Apple sheet')
  t = mk({ invoke: async (b) => (b.preflight ? { data: { available: false, apple: true }, error: null } : { data: {}, error: null }) }); assert.equal((await revokeAppleTokenIfPossible(t.args)).reason, 'unavailable'); assert.equal(t.log.prompted, 0, 'secrets not configured: no Apple sheet')
  t = mk({ cancel: true }); assert.deepEqual(await revokeAppleTokenIfPossible(t.args), { attempted: true, revoked: false, reason: 'no_code' })
  t = mk({ invoke: (b) => (b.preflight ? { data: { available: true, apple: true }, error: null } : new Promise(() => {})) }); assert.equal((await revokeAppleTokenIfPossible(t.args)).revoked, false, 'a hung function times out instead of blocking')
  assert.equal((await revokeAppleTokenIfPossible({ supabase: { auth: { getUser: async () => { throw new Error('x') } } }, platformOS: 'ios' })).revoked, false)
  const profile = read('../screens/ProfileScreen.jsx')
  const body = profile.slice(profile.indexOf('async function deleteAccount()'))
  assert.ok(body.indexOf('revokeAppleTokenIfPossible(') < body.indexOf('requestAccountDeletion(supabase)'), 'revocation is attempted while the session is valid, and its result is ignored')
  const fn = readFileSync(join(here, '../supabase/functions/revoke-apple-token/index.ts'), 'utf8')
  assert.doesNotMatch(fn, /BEGIN PRIVATE KEY|console\.(log|error)/, 'no key material or logging in source')
  assert.match(fn, /Deno\.env\.get\('APPLE_PRIVATE_KEY'\)/)
})
