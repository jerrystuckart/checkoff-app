// Structural guard for the badge celebration wiring: every check-in surface must reach the shared host.
// (The behavior itself is covered by badgeCelebrations.test.js and scripts/render-badge-celebration/render.mjs.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('the host is mounted once, at the app root, with the signed-in user', () => {
  const app = src('App.jsx')
  assert.match(app, /<BadgeCelebrationHost userId=\{userId\} \/>/)
  assert.equal((app.match(/<BadgeCelebrationHost/g) || []).length, 1)
})

test('no screen mounts its own BadgeCelebrationModal or drains the queue (the old, per-screen design)', () => {
  for (const f of ['screens/ListScreen.jsx', 'screens/ItemDetailScreen.jsx', 'screens/PhotoCheckInScreen.jsx', 'screens/VisitInboxScreen.jsx']) {
    const s = src(f)
    assert.ok(!s.includes('<BadgeCelebrationModal'), `${f} must not mount its own modal`)
    assert.ok(!s.includes('pollForNewBadges'), `${f} must not drain notification_queue`)
  }
})

test('every check-in surface asks for a celebration check', () => {
  assert.match(src('screens/ListScreen.jsx'), /requestBadgeCelebrationCheck\('list-checkoff'\)/)
  const detail = src('screens/ItemDetailScreen.jsx')
  // tap (x2, season-scoped and plain), duplicate-verified collision, and Trip Mode success
  assert.equal((detail.match(/requestBadgeCelebrationCheck\('item-detail-checkoff'\)/g) || []).length, 4)
  assert.match(src('screens/PhotoCheckInScreen.jsx'), /requestBadgeCelebrationCheck\('photo-checkin'\)/)
  assert.match(src('screens/VisitInboxScreen.jsx'), /requestBadgeCelebrationCheck\('visit-recovery'\)/)
})

test('every screen that presents its own modal over a check-in holds the celebration', () => {
  assert.match(src('screens/ListScreen.jsx'), /useBadgeCelebrationHold\(!!postCheckoffData \|\| !!tierUpgrade \|\| !!memoryModal\)/)
  const detail = src('screens/ItemDetailScreen.jsx')
  for (const state of ['postCheckoffData', 'tierUpgrade', 'pendingTierUpgrade', 'memoryModal', 'tripModeSheetVisible', 'checkInMemoryVisible', 'showFullBodyModal', 'showInviteChannels']) {
    assert.match(detail.match(/useBadgeCelebrationHold\([\s\S]*?\n  \)/)[0], new RegExp(state))
  }
  assert.match(src('screens/PhotoCheckInScreen.jsx'), /useBadgeCelebrationHold\(!!postCheckoffData\)/)
  assert.match(src('screens/VisitInboxScreen.jsx'), /badgeCelebrations\.hold\('visit-inbox-confirm'\)/)
  assert.match(src('App.jsx'), /useBadgeCelebrationHold\(!!\(forceUpdate \|\| softUpdate\)\)/)
})

test('the modal reports a badge only once the native Modal is on screen', () => {
  const m = src('components/BadgeCelebrationModal.jsx')
  assert.match(m, /onShow=\{\(\) => setOnScreen\(true\)\}/)
  assert.match(m, /visible && onScreen && currentBadge/)
})

test('client-side points awards cannot fail as a batch and do not depend on the admin-only queue', () => {
  const p = src('lib/points.js')
  assert.match(p, /\.upsert\(/)
  assert.match(p, /ignoreDuplicates: true/)
})
