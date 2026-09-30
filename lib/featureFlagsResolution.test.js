// Real lib/featureFlags.js (bundled; only the Supabase edge is faked) - how flags resolve for a tester, a non-tester,
// a per-user override, and an unreadable flag table.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const world = globalThis.__ffWorld = { flags: [], overrides: [], tester: false, fail: false }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-'))
const fake = path.join(tmp, 'supabase.js')
fs.writeFileSync(fake, `const w = globalThis.__ffWorld
const res = (data) => (w.fail ? { data: null, error: { message: 'offline' } } : { data, error: null })
export const supabase = { from: (t) => ({ select: () => t === 'feature_flags' ? Promise.resolve(res(w.flags))
  : { eq: () => (t === 'feature_flag_overrides' ? Promise.resolve(res(w.overrides)) : { maybeSingle: async () => res({ visit_detection_tester: w.tester }) }) } }) }`)
const out = await build({
  entryPoints: [path.join(here, 'featureFlags.js')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  plugins: [{ name: 'fake', setup(b) { b.onResolve({ filter: /\/supabase$/ }, () => ({ path: fake })) } }],
})
const file = path.join(tmp, 'ff.mjs'); fs.writeFileSync(file, out.outputFiles[0].text)
const ff = await import(pathToFileURL(file).href)
const KEY = 'candidate_visit_sentinel_refresh'
const setup = (over) => { ff.resetFlagsCache(); Object.assign(world, { flags: [], overrides: [], tester: false, fail: false }, over) }

test('global ON: a non-tester account resolves the sentinel flag ON (not tester-gated any more)', async () => {
  setup({ flags: [{ key: KEY, enabled_globally: true }], tester: false })
  assert.equal(await ff.isFlagEnabled('u', KEY), true)
  assert.equal(await ff.flagStateOrUnknown('u', KEY), true)
})

test('global OFF: nobody gets it except a per-user override', async () => {
  setup({ flags: [{ key: KEY, enabled_globally: false }] })
  assert.equal(await ff.isFlagEnabled('u', KEY), false)
  setup({ flags: [{ key: KEY, enabled_globally: false }], overrides: [{ flag_key: KEY, enabled: true }] })
  assert.equal(await ff.isFlagEnabled('u', KEY), true)
  setup({ flags: [{ key: KEY, enabled_globally: true }], overrides: [{ flag_key: KEY, enabled: false }] })
  assert.equal(await ff.isFlagEnabled('u', KEY), false, 'a per-user OFF override wins over global ON')
})

test('other tester-gated flags stay tester-only (notification flags are unchanged)', async () => {
  for (const key of ['candidate_visit_silent_mode', 'historical_checkoff_recovery', 'realtime_nearby_checkoff_notifications', 'at_place_checkoff_reminders']) {
    setup({ flags: [{ key, enabled_globally: true }], tester: false })
    assert.equal(await ff.isFlagEnabled('u', key), false, key)
    setup({ flags: [{ key, enabled_globally: true }], tester: true })
    assert.equal(await ff.isFlagEnabled('u', key), true, key)
  }
})

test('an unreadable flag table is "unknown" (null), never mistaken for OFF; and a failed read is not pinned', async () => {
  setup({ flags: [{ key: KEY, enabled_globally: true }], fail: true })
  assert.equal(await ff.flagStateOrUnknown('u', KEY), null)
  world.fail = false
  assert.equal(await ff.flagStateOrUnknown('u', KEY), true, 'the next read succeeds; the failure was not cached')
})
