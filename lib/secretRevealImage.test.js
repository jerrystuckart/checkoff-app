import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fetchSecretRevealImageUrl } from './secretRevealImage.js'

function client({ row, rowError = null, signed = 'https://s/x?t=1', signError = null }) {
  const touched = { selects: [], signedPaths: [], buckets: [] }
  return {
    touched,
    from(table) {
      assert.equal(table, 'items')
      return { select(cols) { touched.selects.push(cols); return { eq: () => ({ maybeSingle: async () => ({ data: row, error: rowError }) }) } } }
    },
    storage: { from(b) { touched.buckets.push(b); return { createSignedUrl: async (p) => { touched.signedPaths.push(p); return { data: signError ? null : { signedUrl: signed }, error: signError } } } } },
  }
}

test('reads ONLY the reveal column and signs exactly that path in the submission bucket', async () => {
  const c = client({ row: { secret_reveal_image_storage_path: 'secret-reveal-images/i1/1.jpg' } })
  assert.equal(await fetchSecretRevealImageUrl({ itemId: 'i1', client: c }), 'https://s/x?t=1')
  assert.deepEqual(c.touched.selects, ['secret_reveal_image_storage_path'])
  assert.deepEqual(c.touched.signedPaths, ['secret-reveal-images/i1/1.jpg'])
  assert.deepEqual(c.touched.buckets, ['submission-photos'])
})

test('no path, blank path, missing column (migration not applied), sign failure -> null, nothing else signed', async () => {
  for (const c of [
    client({ row: { secret_reveal_image_storage_path: null } }),
    client({ row: { secret_reveal_image_storage_path: '   ' } }),
    client({ row: null, rowError: { message: 'column items.secret_reveal_image_storage_path does not exist' } }),
    client({ row: { secret_reveal_image_storage_path: 'p' }, signError: { message: 'denied' } }),
  ]) {
    assert.equal(await fetchSecretRevealImageUrl({ itemId: 'i1', client: c }), null)
  }
  assert.equal(await fetchSecretRevealImageUrl({ itemId: null, client: client({ row: null }) }), null)
})

test('the reveal image is only fetched in the unlocked hook, never the locked one; never from submissions', () => {
  const hooks = readFileSync(new URL('./useSecretPhotos.js', import.meta.url), 'utf8')
  const locked = hooks.slice(hooks.indexOf('export function useLockedSecretPhoto'), hooks.indexOf('export function useUnlockedSecretPhoto'))
  assert.ok(!locked.includes('Reveal'))
  assert.ok(hooks.slice(hooks.indexOf('export function useUnlockedSecretPhoto')).includes('fetchSecretRevealImageUrl'))
  const src = readFileSync(new URL('./secretRevealImage.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  assert.ok(!/item_cover_candidates|display_eligible|pending|rejected/.test(src))
})

test('migration: additive nullable column, exact-path read policy, no write grants, rollback documented', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261009a_secret_reveal_image.sql', import.meta.url), 'utf8')
  const code = sql.replace(/--.*$/gm, '')
  assert.match(code, /ADD COLUMN IF NOT EXISTS secret_reveal_image_storage_path text NULL/)
  assert.match(code, /FOR SELECT USING/)
  assert.match(code, /items\.secret_reveal_image_storage_path = storage\.objects\.name/)
  assert.ok(!/GRANT|FOR (INSERT|UPDATE|DELETE|ALL)/i.test(code), 'no write access granted to anyone')
  assert.ok(!/DROP COLUMN|DROP TABLE|UPDATE public/i.test(code))
  assert.ok(sql.includes('Rollback'))
})
