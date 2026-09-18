// Saved Items V1 (2026-09-18) — security/client-query guards. Grep-based
// source assertions, matching this repo's established convention (no RN
// render harness, no live Supabase in tests).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const files = [
  'SavedItemsContext.js',
  'savedItemsState.js',
].map((f) => ({ name: f, source: readFileSync(join(__dirname, f), 'utf8') }))
const screenFiles = [
  '../screens/SavedItemsScreen.jsx',
  '../screens/ListsScreen.jsx',
  '../screens/ItemDetailScreen.jsx',
  '../components/home/EditorialCard.jsx',
  '../components/home/WhatsTheThingHero.jsx',
  '../components/BookmarkIcon.jsx',
].map((f) => ({ name: f, source: readFileSync(join(__dirname, f), 'utf8') }))

const allFiles = [...files, ...screenFiles]

test('every write (insert/delete) to saved_items uses the authenticated session\'s own user id, never a caller-supplied one', () => {
  const ctx = files.find((f) => f.name === 'SavedItemsContext.js').source
  assert.match(ctx, /insert\(\{\s*user_id:\s*uid,\s*item_id:\s*itemId\s*\}\)/, 'insert must build { user_id: uid, item_id } from the session ref, not a param')
  assert.match(ctx, /\.delete\(\)\.eq\('user_id',\s*uid\)\.eq\('item_id',\s*itemId\)/, 'delete must scope by the session ref\'s own uid')
  // runMutation only ever reads uid from userIdRef.current (populated by
  // supabase.auth.getSession()/onAuthStateChange), never from a function
  // parameter — confirms no caller can pass an arbitrary user id in.
  assert.ok(ctx.includes('const uid = userIdRef.current'))
})

test('no `.update(...)` call exists anywhere in the new Saved code — no UPDATE privilege is needed or used', () => {
  for (const f of allFiles) {
    assert.ok(!/saved_items['"]\)[\s\S]{0,80}\.update\(/.test(f.source), `${f.name} must not call .update() on saved_items`)
  }
  // Broader guard on the two files that actually talk to saved_items.
  const ctx = files.find((f) => f.name === 'SavedItemsContext.js').source
  const savedScreen = screenFiles.find((f) => f.name.includes('SavedItemsScreen')).source
  assert.ok(!ctx.includes('.update('), 'SavedItemsContext.js must never call .update()')
  assert.ok(!savedScreen.includes('.update('), 'SavedItemsScreen.jsx must never call .update()')
})

test('no anon-key-only fetch path exists for saved_items — always the normal authenticated app-wide Supabase client', () => {
  const ctx = files.find((f) => f.name === 'SavedItemsContext.js').source
  const savedScreen = screenFiles.find((f) => f.name.includes('SavedItemsScreen')).source
  assert.ok(ctx.includes("import { supabase } from './supabase'"), 'must import the shared app-wide client, not construct a second one')
  assert.ok(savedScreen.includes("import { supabase } from '../lib/supabase'"))
  for (const f of [ctx, savedScreen]) {
    assert.ok(!f.includes('createClient('), 'must not construct a second, separately-scoped Supabase client')
    assert.ok(!/anon.?key/i.test(f), 'must not reference a separate anon-only key/client')
  }
})

test('no service_role key is referenced anywhere in the new client-side Saved code', () => {
  for (const f of allFiles) {
    assert.ok(!/service_role/i.test(f.source), `${f.name} must not reference service_role — this is client-side code only`)
  }
})

test('saved_items fetch relies on RLS scoping AND states user_id explicitly (defense in depth, matching this app\'s existing convention for owner-scoped queries)', () => {
  const ctx = files.find((f) => f.name === 'SavedItemsContext.js').source
  assert.match(ctx, /\.from\('saved_items'\)\s*\n?\s*\.select\('item_id'\)\s*\n?\s*\.eq\('user_id',\s*uid\)/)
})

test('the migration record grants only SELECT, INSERT, DELETE to authenticated — no UPDATE, no anon/PUBLIC grant', () => {
  const migration = readFileSync(join(__dirname, '../supabase/migrations/20260918_saved_items.sql'), 'utf8')
  assert.match(migration, /GRANT SELECT, INSERT, DELETE\s*\nON TABLE public\.saved_items\s*\nTO authenticated;/)
  assert.ok(!/GRANT[^;]*UPDATE[^;]*saved_items/i.test(migration))
  assert.ok(migration.includes('REVOKE ALL ON TABLE public.saved_items FROM anon;'))
  assert.ok(migration.includes('REVOKE ALL ON TABLE public.saved_items FROM PUBLIC;'))
  assert.ok(migration.includes('REVOKE ALL ON TABLE public.saved_items FROM authenticated;'))
  assert.ok(migration.includes('TO authenticated') , 'every policy must be scoped TO authenticated')
  const policyToCount = (migration.match(/CREATE POLICY[\s\S]{0,80}TO authenticated/g) ?? []).length
  assert.equal(policyToCount, 3, 'all three policies (SELECT/INSERT/DELETE) must explicitly declare TO authenticated')
})
