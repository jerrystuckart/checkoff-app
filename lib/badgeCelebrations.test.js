// Badge celebration controller: detection, safe presentation point, dedupe, persistence, account isolation.
// Uses an in-memory fake of the three tables the controller reads (user_badges, notification_queue, badge_definitions).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBadgeCelebrationController, UNSEEN_WINDOW_MS, seenStorageKey } from './badgeCelebrations.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-08T18:00:00Z')
const DEFS = {
  first_checkin: { id: 'first_checkin', name: 'On the Board', description: 'd', icon: '🥇' },
  points_5: { id: 'points_5', name: 'First Checkpoint', description: 'd', icon: '🔑' },
  points_25: { id: 'points_25', name: 'Explorer', description: 'd', icon: '🧭' },
  streak_4wk: { id: 'streak_4wk', name: '4 Week', description: 'd', icon: '🌊' },
}

function makeDb({ badges = [], queue = [], failQueue = false } = {}) {
  const db = { badges, queue, failQueue, queueUpdates: [] }
  db.client = {
    from(table) {
      const q = { table, filters: [], op: 'select', patch: null }
      const run = () => {
        const f = q.filters
        const match = (row) => f.every(([k, v, kind]) => {
          const val = k.includes('->>') ? row.payload?.[k.split('->>')[1]] : row[k]
          if (kind === 'gte') return String(val) >= String(v)
          if (kind === 'in') return v.includes(val)
          return val === v
        })
        if (table === 'user_badges') return { data: db.badges.filter(match).sort((a, b) => String(a[q.orderBy]).localeCompare(String(b[q.orderBy]))), error: null }
        if (table === 'badge_definitions') return { data: Object.values(DEFS).filter(match), error: null }
        if (table === 'notification_queue') {
          if (q.op === 'update') { db.queueUpdates.push({ filters: f, patch: q.patch }); db.queue.filter(match).forEach(r => Object.assign(r, q.patch)); return { data: null, error: null } }
          return db.failQueue ? { data: null, error: { message: 'boom' } } : { data: db.queue.filter(match), error: null }
        }
        return { data: [], error: null }
      }
      const chain = {
        select() { return chain },
        update(patch) { q.op = 'update'; q.patch = patch; return chain },
        eq(k, v) { q.filters.push([k, v]); return chain },
        gte(k, v) { q.filters.push([k, v, 'gte']); return chain },
        in(k, v) { q.filters.push([k, v, 'in']); return chain },
        order(col) { q.orderBy = col; return chain },
        then(res, rej) { return Promise.resolve(run()).then(res, rej) },
      }
      return chain
    },
  }
  return db
}
const memStorage = (init = {}) => { const m = { ...init }; return { m, getItem: async k => m[k] ?? null, setItem: async (k, v) => { m[k] = v } } }
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const iso = (offsetMs = 0) => new Date(NOW + offsetMs).toISOString()

function make({ db, storage = memStorage(), extra = {} } = {}) {
  const c = createBadgeCelebrationController({
    supabase: db.client, storage, now: () => NOW,
    showDelayMs: 5, settleMs: 0, followUpMs: 15, ...extra,
  })
  return { c, storage }
}
const settle = async () => { await tick(40) }

test('a points_* badge with NO queue row (client awards cannot queue under RLS) is detected and presented', async () => {
  const db = makeDb({ badges: [{ user_id: 'u1', badge_id: 'points_5', earned_at: iso(-60_000) }], queue: [] })
  const { c } = make({ db })
  c.setUser('u1'); await settle()
  assert.deepEqual(c.getState().presenting.badges.map(b => b.id), ['points_5'])
})

test('first_checkin and points_5 from one action present together, once, in earned order', async () => {
  const db = makeDb({
    badges: [
      { user_id: 'u1', badge_id: 'points_5', earned_at: iso(-1000) },
      { user_id: 'u1', badge_id: 'first_checkin', earned_at: iso(-2000) },
    ],
    queue: [{ id: 'q1', type: 'badge', delivered: false, created_at: iso(-2000), payload: { to_user_id: 'u1', badge_id: 'first_checkin' } }],
  })
  const { c } = make({ db })
  c.setUser('u1'); await settle()
  const batch = c.getState().presenting
  assert.deepEqual(batch.badges.map(b => b.id), ['first_checkin', 'points_5'])
  c.requestCheck('again'); c.requestCheck('again'); await settle()
  assert.equal(c.getState().presenting.id, batch.id, 'repeat checks must not create another batch')
  assert.equal(c.getState().pendingCount, 0)
})

test('nothing is presented while a hold is active; presents after release (+ delay)', async () => {
  const db = makeDb({ badges: [{ user_id: 'u1', badge_id: 'points_5', earned_at: iso(-1000) }] })
  const { c } = make({ db })
  c.hold('post-checkoff-sheet')
  c.setUser('u1'); await settle()
  assert.equal(c.getState().presenting, null)
  assert.equal(c.getState().pendingCount, 1)
  c.release('post-checkoff-sheet')
  assert.equal(c.getState().presenting, null, 'not immediately: a dismissing native modal needs time')
  await settle()
  assert.equal(c.getState().presenting.badges.length, 1)
})

test('a hold taken during the show delay cancels the presentation', async () => {
  const db = makeDb({ badges: [{ user_id: 'u1', badge_id: 'points_5', earned_at: iso(-1000) }] })
  const { c } = make({ db, extra: { showDelayMs: 30 } })
  c.setUser('u1'); await tick(15)
  c.hold('tier-upgrade'); await tick(50)
  assert.equal(c.getState().presenting, null)
  c.release('tier-upgrade'); await tick(60)
  assert.equal(c.getState().presenting.badges.length, 1)
})

test('inactive app does not present; becoming active does', async () => {
  const db = makeDb({ badges: [{ user_id: 'u1', badge_id: 'points_5', earned_at: iso(-1000) }] })
  const { c } = make({ db })
  c.setAppActive(false); c.setUser('u1'); await settle()
  assert.equal(c.getState().presenting, null)
  c.setAppActive(true); await settle()
  assert.equal(c.getState().presenting.badges.length, 1)
})

test('NOT marked seen before it is visible: fetched-but-never-shown replays on relaunch', async () => {
  const db = makeDb({ badges: [{ user_id: 'u1', badge_id: 'points_5', earned_at: iso(-1000) }] })
  const storage = memStorage()
  const a = make({ db, storage }).c
  a.setUser('u1'); await settle()
  assert.ok(a.getState().presenting)
  assert.equal(storage.m[seenStorageKey('u1')], undefined, 'no persisted seen state before onBadgeVisible')
  assert.deepEqual(db.queueUpdates, [])
  a.destroy()
  const b = make({ db, storage }).c            // relaunch
  b.setUser('u1'); await settle()
  assert.equal(b.getState().presenting.badges[0].id, 'points_5')
})

test('once visible it is recorded; relaunch / refresh / retry never replays it', async () => {
  const db = makeDb({
    badges: [{ user_id: 'u1', badge_id: 'first_checkin', earned_at: iso(-1000) }],
    queue: [{ id: 'q1', type: 'badge', delivered: false, created_at: iso(-1000), payload: { to_user_id: 'u1', badge_id: 'first_checkin' } }],
  })
  const storage = memStorage()
  const a = make({ db, storage }).c
  a.setUser('u1'); await settle()
  const badge = a.getState().presenting.badges[0]
  a.onBadgeVisible(badge); a.dismiss(); await settle()
  assert.deepEqual(JSON.parse(storage.m[seenStorageKey('u1')]), ['first_checkin'])
  assert.equal(db.queue[0].delivered, true, 'queue row mirrored delivered only after visible')
  a.requestCheck('refresh'); a.requestCheck('retry'); await settle()
  assert.equal(a.getState().presenting, null)
  a.destroy()
  const b = make({ db, storage }).c
  b.setUser('u1'); await settle()
  assert.equal(b.getState().presenting, null)
  // even with local storage wiped (reinstall), the delivered queue row prevents a replay
  const c2 = make({ db, storage: memStorage() }).c
  c2.setUser('u1'); await settle()
  assert.equal(c2.getState().presenting, null)
})

test('badges earned while a batch is on screen wait for the next batch (no overlapping dialogs)', async () => {
  const db = makeDb({ badges: [{ user_id: 'u1', badge_id: 'first_checkin', earned_at: iso(-3000) }] })
  const { c } = make({ db })
  c.setUser('u1'); await settle()
  const first = c.getState().presenting
  db.badges.push({ user_id: 'u1', badge_id: 'points_5', earned_at: iso(-10) })
  c.requestCheck('checkin'); await settle()
  assert.equal(c.getState().presenting.id, first.id)
  assert.deepEqual(first.badges.map(b => b.id), ['first_checkin'], 'presented batch is never mutated')
  assert.equal(c.getState().pendingCount, 1)
  c.onBadgeVisible(first.badges[0]); c.dismiss(); await settle()
  assert.deepEqual(c.getState().presenting.badges.map(b => b.id), ['points_5'])
})

test('Skip all acknowledges the whole started batch; a batch that never showed acknowledges nothing', async () => {
  const mk = () => makeDb({ badges: [
    { user_id: 'u1', badge_id: 'first_checkin', earned_at: iso(-3000) },
    { user_id: 'u1', badge_id: 'points_5', earned_at: iso(-2000) },
    { user_id: 'u1', badge_id: 'points_25', earned_at: iso(-1000) },
  ] })
  let db = mk(); let storage = memStorage()
  let c = make({ db, storage }).c
  c.setUser('u1'); await settle()
  c.onBadgeVisible(c.getState().presenting.badges[0]); c.dismiss(); await settle()
  assert.deepEqual(JSON.parse(storage.m[seenStorageKey('u1')]).sort(), ['first_checkin', 'points_25', 'points_5'])
  assert.equal(c.getState().presenting, null)

  db = mk(); storage = memStorage(); c = make({ db, storage }).c
  c.setUser('u1'); await settle()
  c.dismiss(); await settle()                       // closed before any onShow
  assert.equal(storage.m[seenStorageKey('u1')], undefined)
  c.requestCheck('retry'); await settle()
  assert.equal(c.getState().presenting.badges.length, 3, 'eligible again')
})

test('history is not replayed: badges older than the unseen window are ignored and never modified', async () => {
  const db = makeDb({
    badges: [
      { user_id: 'u1', badge_id: 'first_checkin', earned_at: iso(-(UNSEEN_WINDOW_MS + DAY)) },
      { user_id: 'u1', badge_id: 'points_5', earned_at: iso(-DAY) },
    ],
    queue: [{ id: 'q1', type: 'badge', delivered: false, created_at: iso(-(UNSEEN_WINDOW_MS + DAY)), payload: { to_user_id: 'u1', badge_id: 'first_checkin' } }],
  })
  const { c } = make({ db })
  c.setUser('u1'); await settle()
  assert.deepEqual(c.getState().presenting.badges.map(b => b.id), ['points_5'])
  assert.equal(db.queue[0].delivered, false, 'old rows are left exactly as they were')
  assert.deepEqual(db.queueUpdates, [])
})

test('a badge already delivered by an older build (queue delivered=true) is not shown again', async () => {
  const db = makeDb({
    badges: [{ user_id: 'u1', badge_id: 'first_checkin', earned_at: iso(-1000) }],
    queue: [{ id: 'q1', type: 'badge', delivered: true, created_at: iso(-1000), payload: { to_user_id: 'u1', badge_id: 'first_checkin' } }],
  })
  const { c } = make({ db })
  c.setUser('u1'); await settle()
  assert.equal(c.getState().presenting, null)
})

test('a failed queue read skips the round instead of risking replays', async () => {
  const db = makeDb({ badges: [{ user_id: 'u1', badge_id: 'first_checkin', earned_at: iso(-1000) }], failQueue: true })
  const { c } = make({ db })
  c.setUser('u1'); await settle()
  assert.equal(c.getState().presenting, null)
  db.failQueue = false; c.requestCheck('retry'); await settle()
  assert.equal(c.getState().presenting.badges.length, 1)
})

test('state is isolated per account: switching accounts drops pending/presenting and uses separate seen storage', async () => {
  const db = makeDb({ badges: [
    { user_id: 'u1', badge_id: 'points_5', earned_at: iso(-1000) },
    { user_id: 'u2', badge_id: 'first_checkin', earned_at: iso(-1000) },
  ] })
  const storage = memStorage()
  const { c } = make({ db, storage })
  c.setUser('u1'); await settle()
  assert.deepEqual(c.getState().presenting.badges.map(b => b.id), ['points_5'])
  c.onBadgeVisible(c.getState().presenting.badges[0])
  c.setUser('u2'); await settle()
  assert.deepEqual(c.getState().presenting.badges.map(b => b.id), ['first_checkin'], 'u2 sees only u2 badges')
  c.setUser(null)
  assert.equal(c.getState().presenting, null)
  c.setUser('u1'); await settle()
  assert.equal(c.getState().presenting, null, 'u1 already saw points_5 (their own seen set)')
  assert.ok(storage.m[seenStorageKey('u1')]); assert.equal(storage.m[seenStorageKey('u2')], undefined)
})

test('a slow check that started for the previous account cannot leak into the next one', async () => {
  const db = makeDb({ badges: [{ user_id: 'u1', badge_id: 'points_5', earned_at: iso(-1000) }] })
  const slow = async () => { await tick(30) }
  const { c } = make({ db, extra: { syncMilestones: slow } })
  c.setUser('u1'); await tick(10)
  c.setUser('u2'); await settle(); await tick(40)
  assert.equal(c.getState().presenting, null)
  assert.equal(c.getState().pendingCount, 0)
})

test('first_checkin triggers the referral bonus exactly once, from any check-in surface', async () => {
  const db = makeDb({ badges: [{ user_id: 'u1', badge_id: 'first_checkin', earned_at: iso(-1000) }] })
  const calls = []
  const { c } = make({ db, extra: { onFirstCheckin: async (u) => { calls.push(u) } } })
  c.setUser('u1'); await settle()
  c.requestCheck('again'); await settle()
  assert.deepEqual(calls, ['u1'])
})

test('syncMilestones runs before reading, so a points badge awarded by it is celebrated in the same pass', async () => {
  const db = makeDb({ badges: [] })
  const { c } = make({ db, extra: { syncMilestones: async (uid) => { db.badges.push({ user_id: uid, badge_id: 'points_5', earned_at: iso(-5) }) } } })
  c.setUser('u1'); await settle()
  assert.deepEqual(c.getState().presenting.badges.map(b => b.id), ['points_5'])
})

test('a badge with no definition is not shown and does not block the others', async () => {
  const db = makeDb({ badges: [
    { user_id: 'u1', badge_id: 'mystery_badge', earned_at: iso(-2000) },
    { user_id: 'u1', badge_id: 'points_5', earned_at: iso(-1000) },
  ] })
  const { c } = make({ db })
  c.setUser('u1'); await settle()
  assert.deepEqual(c.getState().presenting.badges.map(b => b.id), ['points_5'])
})
