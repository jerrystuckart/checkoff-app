// The 2026-09-30 badge bug, reproduced with the real rules: Home/Profile said 3 while the inbox showed 2 (then 2 vs 1 after a
// confirmation) because the badge counted a candidate whose place the user had already checked off by hand.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectActionable, loadActionableCandidates, countActionableCandidates, mapCandidateRow } from './actionableCandidates.js'

const NOW = new Date('2026-09-30T16:40:00Z')
const item = (id, body) => ({ id, body, neighborhoods: { name: 'Ravello & Scala' } })
const cand = (id, itemId, over = {}) => ({
  id, status: 'medium_confidence', expires_at: '2026-10-07T12:00:00Z', departure_at: '2026-09-30T12:37:00Z', confirmed_at: null, rejected_at: null,
  metadata: { competingVenueCount: 1 }, items: item(itemId, `Venue ${itemId}`), ...over,
})
// the three real candidates of the day
const RUFOLO = cand('c-rufolo', 'i-rufolo'), DUOMO = cand('c-duomo', 'i-duomo'), COSIMO = cand('c-cosimo', 'i-cosimo')

function fakeSupabase({ candidates, checkIns }) {
  const q = (rows) => { const b = { select: () => b, eq: () => b, in: () => b, order: async () => ({ data: rows, error: null }) }; return b }
  return {
    from: (t) => {
      if (t === 'candidate_visits') return q(candidates())
      if (t === 'check_ins') { const b = { select: () => b, eq: () => b, in: async (_c, ids) => ({ data: checkIns().filter((r) => ids.includes(r.item_id)), error: null }) }; return b }
      throw new Error(t)
    },
  }
}

test('before confirming: Rufolo was checked off by hand -> badge and inbox agree on 2 (Duomo, Cosimo)', async () => {
  const sb = fakeSupabase({ candidates: () => [RUFOLO, DUOMO, COSIMO], checkIns: () => [{ item_id: 'i-rufolo' }] })
  const { rows, hidden } = await loadActionableCandidates(sb, 'u', { now: NOW })
  assert.deepEqual(rows.map((r) => r.candidateVisitId).sort(), ['c-cosimo', 'c-duomo'])
  assert.equal(hidden.already_checked_off, 1)
  assert.equal(await countActionableCandidates(sb, 'u', { now: NOW }), rows.length, 'the badge IS the inbox list length')
})

test('after confirming Cosimo (check-in now exists): badge and inbox both say 1 (Duomo), not 2 vs 1', async () => {
  const cosimoConfirmed = { ...COSIMO, status: 'confirmed', confirmed_at: '2026-09-30T16:35:37Z' }
  const sb = fakeSupabase({ candidates: () => [RUFOLO, DUOMO], checkIns: () => [{ item_id: 'i-rufolo' }, { item_id: 'i-cosimo' }] })
  const { rows } = await loadActionableCandidates(sb, 'u', { now: NOW })
  assert.deepEqual(rows.map((r) => r.candidateVisitId), ['c-duomo'])
  assert.equal(await countActionableCandidates(sb, 'u', { now: NOW }), 1)
  // even if a confirmed row were still returned, it is not counted
  const { rows: r2 } = selectActionable({ data: [RUFOLO, DUOMO, cosimoConfirmed], checkedOffItemIds: new Set(['i-rufolo']), now: NOW })
  assert.deepEqual(r2.map((r) => r.candidateVisitId), ['c-duomo'])
})

test('dismissed, expired, confirmed and unreadable-item candidates are never actionable; every reason is accounted for', () => {
  const data = [
    cand('ok', 'i1'),
    cand('rejected', 'i2', { status: 'rejected', rejected_at: '2026-09-30T10:00:00Z' }),
    cand('expired', 'i3', { expires_at: '2026-09-29T00:00:00Z' }),
    cand('confirmed', 'i4', { status: 'confirmed', confirmed_at: '2026-09-30T10:00:00Z' }),
    cand('no-item', 'i5', { items: null }),
    cand('checked', 'i6'),
  ]
  const { rows, hidden } = selectActionable({ data, checkedOffItemIds: new Set(['i6']), now: NOW })
  assert.deepEqual(rows.map((r) => r.candidateVisitId), ['ok'])
  assert.equal(hidden.item_unreadable, 1); assert.equal(hidden.already_checked_off, 1); assert.equal(hidden.other, 3)
})

test('duplicates for the same place: a second pending candidate for an item is shown once per candidate row but both vanish once the item is checked off', () => {
  const a = cand('a', 'i1'), b = cand('b', 'i1')
  assert.equal(selectActionable({ data: [a, b], checkedOffItemIds: new Set(), now: NOW }).rows.length, 2)
  assert.equal(selectActionable({ data: [a, b], checkedOffItemIds: new Set(['i1']), now: NOW }).rows.length, 0)
})

test('a failed check-in lookup throws instead of showing a count that may include checked-off places', async () => {
  const sb = { from: (t) => t === 'candidate_visits'
    ? (() => { const b = { select: () => b, eq: () => b, in: () => b, order: async () => ({ data: [DUOMO], error: null }) }; return b })()
    : (() => { const b = { select: () => b, eq: () => b, in: async () => ({ data: null, error: { message: 'offline' } }) }; return b })() }
  await assert.rejects(loadActionableCandidates(sb, 'u', { now: NOW }), /offline/)
})

test('mapCandidateRow keeps the fields the inbox card renders', () => {
  const m = mapCandidateRow(RUFOLO)
  assert.equal(m.itemBody, 'Venue i-rufolo'); assert.equal(m.neighborhoodName, 'Ravello & Scala'); assert.equal(m.competingVenueCount, 1)
})

test('the three surfaces use the shared loader/count (no private copy of the rule)', async () => {
  const fs = await import('node:fs')
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
  assert.match(read('../../screens/VisitInboxScreen.jsx'), /loadActionableCandidates\(supabase, user\.id/)
  assert.match(read('./recoverySettings.js'), /countActionableCandidates\(supabase, userId\)/)
  // Home and Profile now both load through the shared hook (one count, one subscription, one permission read).
  assert.match(read('./useVisitRecovery.js'), /countPendingSuggestions/)
  assert.match(read('./useVisitRecovery.js'), /subscribeCandidatesChange/)
  for (const f of ['../../components/home/VisitRecoveryHeaderIcon.jsx', '../../components/VisitRecoverySection.jsx']) assert.match(read(f), /useVisitRecovery\(userId\)/)
  assert.match(read('../../screens/VisitInboxScreen.jsx'), /emitCandidatesChanged\(\)[\s\S]*Alert\.alert\('Checked off!'/)
  assert.match(read('../checkInFanOut.js'), /emitCandidatesChanged\(\)/)
  assert.doesNotMatch(read('./recoverySettings.js'), /\.in\('status', \['candidate'/, 'the old unfiltered badge query is gone')
})

test('a lower-bound suggestion (exit never observed) is labelled as such and keeps its proven minimum', () => {
  const lb = cand('lb', 'i-lb', { dwell_minutes: 30, metadata: { competingVenueCount: 0, dwellBasis: 'estimated', lastSeenAt: '2026-09-30T12:00:00Z' } })
  const m = mapCandidateRow(lb)
  assert.equal(m.dwellBasis, 'estimated'); assert.equal(m.dwellMinutes, 30)
  assert.equal(mapCandidateRow({ ...lb, metadata: { dwellBound: 'lower' } }).dwellBasis, 'estimated', 'pre-20260930m rows are still labelled as estimates')
  assert.equal(mapCandidateRow(DUOMO).dwellBasis, null, 'ordinary candidates are unchanged')
  assert.match(fsRead('../../screens/VisitInboxScreen.jsx'), /we didn't see you leave/)
})
import fs from 'node:fs'
function fsRead(p) { return fs.readFileSync(new URL(p, import.meta.url), 'utf8') }
