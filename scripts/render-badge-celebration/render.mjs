// Real render + integration check for the badge celebration (not a source-string test).
// Bundles the REAL BadgeCelebrationHost / BadgeCelebrationModal / badgeCelebrationStore / badgeCelebrations / points / referral
// with esbuild, replacing only the native edge (react-native, AsyncStorage, supabase client) with stubs, and renders it with
// react-test-renderer (NOT a repo dependency: installed into a temp dir, so package.json / the runtime fingerprint are untouched).
// The fake database emulates the live behavior that matters: the check_ins trigger (user_badges + notification_queue rows for
// first_checkin) and RLS (notification_queue INSERT is admin-only, so a client-side points_* award cannot queue a row).
//   node scripts/render-badge-celebration/render.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../..')
const deps = join(tmpdir(), 'checkoff-render-harness-deps')
if (!existsSync(join(deps, 'node_modules/react-test-renderer'))) {
  mkdirSync(deps, { recursive: true })
  writeFileSync(join(deps, 'package.json'), '{"name":"d","private":true}')
  const r = spawnSync('npm', ['i', '--silent', 'react-test-renderer@19.2.0', 'react@19.2.0'], { cwd: deps, stdio: 'inherit' })
  if (r.status !== 0) process.exit(2)
}
const esbuild = createRequire(join(repo, 'package.json'))('esbuild')
const work = mkdtempSync(join(tmpdir(), 'badge-render-'))
symlinkSync(join(deps, 'node_modules'), join(work, 'node_modules'))   // one React for the bundle and the renderer
const stub = (name, src) => { writeFileSync(join(work, name), src); return join(work, name) }

const rnStub = stub('rn.js', `
import React from 'react'
const host = (t) => (props) => React.createElement(t, props, props.children)
export const View = host('View'), Text = host('Text'), TouchableOpacity = host('TouchableOpacity')
export function Modal({ visible, onShow, children }) {
  React.useEffect(() => { if (visible) onShow && onShow() }, [visible])   // native presents -> onShow
  return visible ? React.createElement('Modal', null, children) : null
}
class Val { constructor(v){this.v=v} setValue(v){this.v=v} }
const anim = () => ({ start: (cb) => cb && cb() })
export const Animated = { Value: Val, View: host('AnimatedView'), spring: anim, timing: anim, parallel: anim }
export const StyleSheet = { create: o => o }
export const Share = { share: async () => {} }
export const AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) }
export const Platform = { OS: 'ios' }
`)
const storeStub = stub('async-storage.js', `const m = (globalThis.__asyncStorage ||= {}); export default { getItem: async k => m[k] ?? null, setItem: async (k, v) => { m[k] = v }, removeItem: async k => { delete m[k] } }`)
const supabaseStub = stub('supabase.js', `
const db = globalThis.__db
const rls = globalThis.__rls
function table(name) {
  const q = { filters: [], op: 'select', rows: null, orderBy: null }
  const val = (row, k) => k.includes('->>') ? row.payload?.[k.split('->>')[1]] : row[k]
  const match = row => q.filters.every(([k, v, kind]) => kind === 'gte' ? String(val(row, k)) >= String(v) : kind === 'in' ? v.includes(val(row, k)) : val(row, k) === v)
  const run = () => {
    const t = db[name] ||= []
    if (q.op === 'insert') {
      if (name === 'notification_queue' && !rls.isAdmin) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }
      t.push(...q.rows); return { data: null, error: null }
    }
    if (q.op === 'upsert') {
      for (const r of q.rows) if (!t.some(x => x.user_id === r.user_id && x.badge_id === r.badge_id)) t.push(r)
      return { data: null, error: null }
    }
    if (q.op === 'update') { t.filter(match).forEach(r => Object.assign(r, q.patch)); return { data: null, error: null } }
    let out = t.filter(match)
    if (q.orderBy) out = [...out].sort((a, b) => String(a[q.orderBy]).localeCompare(String(b[q.orderBy])))
    return { data: out, error: null }
  }
  const c = {
    select() { return c }, order(col) { q.orderBy = col; return c },
    eq(k, v) { q.filters.push([k, v]); return c }, gte(k, v) { q.filters.push([k, v, 'gte']); return c }, in(k, v) { q.filters.push([k, v, 'in']); return c },
    insert(rows) { q.op = 'insert'; q.rows = Array.isArray(rows) ? rows : [rows]; return c },
    upsert(rows) { q.op = 'upsert'; q.rows = Array.isArray(rows) ? rows : [rows]; return c },
    update(patch) { q.op = 'update'; q.patch = patch; return c },
    single() { return Promise.resolve({ data: null, error: null }) },
    then(res, rej) { return Promise.resolve(run()).then(res, rej) },
  }
  return c
}
export const supabase = { from: table, functions: { invoke: async () => ({}) }, auth: { getUser: async () => ({ data: { user: null } }) } }
`)
const entry = stub('entry.js', `
import React from 'react'
import BadgeCelebrationHost from '${join(repo, 'components/BadgeCelebrationHost.jsx')}'
import { requestBadgeCelebrationCheck, useBadgeCelebrationHold, badgeCelebrations } from '${join(repo, 'lib/badgeCelebrationStore.js')}'
export { React, BadgeCelebrationHost, requestBadgeCelebrationCheck, useBadgeCelebrationHold, badgeCelebrations }
`)
globalThis.__db = {}; globalThis.__rls = { isAdmin: false }
const out = join(work, 'bundle.mjs')
await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  loader: { '.js': 'jsx', '.jsx': 'jsx' }, jsx: 'transform', external: ['react'], nodePaths: [join(deps, 'node_modules')],
  plugins: [{
    name: 'alias', setup(b) {
      b.onResolve({ filter: /^react-native$/ }, () => ({ path: rnStub }))
      b.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({ path: storeStub }))
      b.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: supabaseStub }))
    },
  }],
})
globalThis.__DEV__ = true; globalThis.IS_REACT_ACT_ENVIRONMENT = true
console.error = () => {}
const TR = createRequire(join(deps, 'package.json'))('react-test-renderer')
const { React, BadgeCelebrationHost, requestBadgeCelebrationCheck, useBadgeCelebrationHold, badgeCelebrations } = await import(out)

// ── test scaffolding ──
const results = []
const ok = (name, cond, extra = '') => { results.push([name, !!cond]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const act = async (fn) => { await TR.act(async () => { await fn() }) }
const settle = async (ms = 1400) => { await act(async () => { await sleep(ms) }) }
const texts = (r) => { const out = []; const walk = n => { if (!n) return; if (typeof n === 'string') out.push(n); else (n.children || []).forEach(walk) }; walk(r.toJSON()); return out.join(' ').replace(/\s+/g, ' ').trim() }
const has = (r, s) => texts(r).includes(s)
const nodeText = (n) => (typeof n === 'string' ? n : (n.children || []).map(nodeText).join(''))
const press = async (r, label) => {
  const btn = r.root.findAll(n => n.type === 'TouchableOpacity' && nodeText(n).includes(label))[0]
  await act(async () => { btn.props.onPress() }); await act(async () => { await sleep(250) })
}
// Item Detail stand-in: a "post check-off sheet" that holds the celebration while open, then a check-in that fires the real trigger emulation.
let setSheet
function Screen() {
  const [open, setOpen] = React.useState(false); setSheet = setOpen
  useBadgeCelebrationHold(open)
  return open ? React.createElement('PostCheckoffSheet') : null
}
function App({ userId }) { return React.createElement(React.Fragment, null, React.createElement(Screen), React.createElement(BadgeCelebrationHost, { userId })) }
const defs = [
  { id: 'first_checkin', name: 'On the Board', description: 'Your first check-in.', icon: '🥇' },
  { id: 'points_5', name: 'First Checkpoint', description: 'd', icon: '🔑' },
  { id: 'points_25', name: 'Explorer', description: 'd', icon: '🧭' },
]
function resetDb() { Object.keys(globalThis.__db).forEach(k => delete globalThis.__db[k]); Object.keys(globalThis.__asyncStorage || {}).forEach(k => delete globalThis.__asyncStorage[k]); globalThis.__db.badge_definitions = defs.map(d => ({ ...d })) }
// emulates check_ins AFTER INSERT trigger check_and_award_badges (first_checkin -> user_badges + queue row), plus the client-side lifetime points.
function checkIn(uid, points) {
  const db = globalThis.__db
  ;(db.check_ins ||= []).push({ user_id: uid, points_awarded: points, checked_at: new Date().toISOString() })
  const has1 = (db.user_badges ||= []).some(b => b.user_id === uid && b.badge_id === 'first_checkin')
  if (!has1) {
    db.user_badges.push({ user_id: uid, badge_id: 'first_checkin', earned_at: new Date().toISOString() })
    ;(db.notification_queue ||= []).push({ id: 'q-' + db.user_badges.length, type: 'badge', delivered: false, created_at: new Date().toISOString(), payload: { to_user_id: uid, badge_id: 'first_checkin' } })
  }
}

// ═══ Scenario 1: new account, first photo check-in worth 5 points (the iPhone repro) ═══
resetDb()
let r
await act(async () => { r = TR.create(React.createElement(App, { userId: 'acct-A' })) })
await settle(300)
await act(async () => { setSheet(true) })                // user taps check-off: PostCheckoffSheet is up
await act(async () => { checkIn('acct-A', 5); requestBadgeCelebrationCheck('photo-checkin') })
await settle(1500)
ok('S1 no celebration while the post check-off sheet is open', !has(r, 'On the Board') && !has(r, 'BADGE UNLOCKED') && !has(r, 'CHECKPOINT'))
ok('S1 points_5 was awarded to user_badges by the real client code', globalThis.__db.user_badges.some(b => b.badge_id === 'points_5'))
ok('S1 ...and NO queue row exists for it (RLS: queue insert is admin-only) - the old queue-poll could never see it', !globalThis.__db.notification_queue.some(q => q.payload.badge_id === 'points_5'))
ok('S1 nothing marked seen / delivered while held', Object.keys(globalThis.__asyncStorage).length === 0 && globalThis.__db.notification_queue.every(q => q.delivered === false))
await act(async () => { setSheet(false) })               // sheet dismissed -> safe point
await settle(1200)
ok('S1 celebration appears after the sheet closes: first badge', has(r, 'On the Board') && has(r, '1 of 2'), texts(r))
ok('S1 seen is recorded only now (visible)', Object.values(globalThis.__asyncStorage).some(v => v.includes('first_checkin')))
await press(r, 'Next Badge')
ok('S1 second badge (points_5 checkpoint) shown in the same dialog', has(r, 'First Checkpoint') && has(r, '2 of 2'), texts(r))
await press(r, "Let's go")
ok('S1 dialog closed after the last badge', texts(r) === '' || !has(r, 'First Checkpoint'))
ok('S1 queue row marked delivered only after display', globalThis.__db.notification_queue.every(q => q.delivered === true))
for (let i = 0; i < 3; i++) { requestBadgeCelebrationCheck('retry'); await settle(900) }
ok('S1 refresh / retry / navigation do not replay', !has(r, 'On the Board') && !has(r, 'First Checkpoint'))
await act(async () => { r.unmount() }); badgeCelebrations.setUser(null)
await act(async () => { r = TR.create(React.createElement(App, { userId: 'acct-A' })) })
await settle(1500)
ok('S1 relaunch (new controller state, persisted storage) does not replay', !has(r, 'On the Board') && !has(r, 'First Checkpoint'))

// ═══ Scenario 2: relaunch before it was ever visible replays; account switch is isolated ═══
await act(async () => { r.unmount() }); badgeCelebrations.setUser(null)
resetDb()
checkIn('acct-B', 5)
await act(async () => { r = TR.create(React.createElement(App, { userId: 'acct-B' })) })
await settle(1800)
ok('S2 unseen award for account B celebrates (cold start, no check-in action)', has(r, 'On the Board'))
await act(async () => { r.update(React.createElement(App, { userId: 'acct-C' })) })     // account switch while a celebration is up
await settle(900)
ok('S2 switching account tears down B\'s dialog; C has nothing', !has(r, 'On the Board'))
ok('S2 B\'s badge was visible, so it is recorded for B only', Object.keys(globalThis.__asyncStorage).every(k => k.endsWith('acct-B')))
await act(async () => { r.update(React.createElement(App, { userId: 'acct-B' })) })
await settle(1500)
ok('S2 back on B: first_checkin not replayed, (points_5 is new for B) ', !has(r, 'On the Board'))

// ═══ Scenario 3: three awards from one action, nothing dropped ═══
await act(async () => { r.unmount() }); badgeCelebrations.setUser(null)
resetDb()
globalThis.__db.user_badges = [
  { user_id: 'acct-D', badge_id: 'first_checkin', earned_at: new Date(Date.now() - 3000).toISOString() },
  { user_id: 'acct-D', badge_id: 'points_5', earned_at: new Date(Date.now() - 2000).toISOString() },
  { user_id: 'acct-D', badge_id: 'points_25', earned_at: new Date(Date.now() - 1000).toISOString() },
]
await act(async () => { r = TR.create(React.createElement(App, { userId: 'acct-D' })) })
await settle(1800)
ok('S3 three badges in one dialog, counter 1 of 3', has(r, '1 of 3'), texts(r))
await press(r, 'Next Badge'); await press(r, 'Next Badge')
ok('S3 third badge reached', has(r, '3 of 3') && has(r, 'Explorer'), texts(r))
await press(r, "Let's go")
ok('S3 all three recorded as seen', ['first_checkin', 'points_5', 'points_25'].every(id => Object.values(globalThis.__asyncStorage).some(v => v.includes(id))))
await act(async () => { r.unmount() }); badgeCelebrations.setUser(null)

const failed = results.filter(x => !x[1]).length
console.log(`\n${results.length - failed}/${results.length} render checks passed`)
process.exit(failed ? 1 : 0)
