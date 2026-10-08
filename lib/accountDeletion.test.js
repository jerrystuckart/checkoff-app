import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
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
  assert.match(data, /is_admin/, 'staff accounts are refused')
  const proc = fn('account_deletion_process')
  assert.ok(proc.indexOf("'accepted'") < proc.indexOf('account_deletion_delete_data'), 'files are removed before database rows')
  assert.match(proc, /account_deletion_objects_remaining/, 'removal is verified, not assumed')
  assert.ok(proc.indexOf('account_deletion_delete_data') < proc.indexOf('delete from auth.users'), 'auth account is removed last')
})
