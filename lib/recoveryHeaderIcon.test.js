import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recoveryIconBadgeText, recoveryIconAction } from './visitDetection/recoveryHeaderIcon.js'

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

test('badge: nothing at zero or garbage, the number to 9, then 9+', () => {
  for (const v of [0, -1, null, undefined, NaN, '0']) assert.equal(recoveryIconBadgeText(v), null)
  assert.equal(recoveryIconBadgeText(1), '1')
  assert.equal(recoveryIconBadgeText(9), '9')
  assert.equal(recoveryIconBadgeText(10), '9+')
  assert.equal(recoveryIconBadgeText(120), '9+')
})

test('tap: pending suggestions open the inbox; recovery off with none opens setup; everything else the inbox', () => {
  assert.equal(recoveryIconAction({ state: 'off', suggestionCount: 0 }), 'setup')
  assert.equal(recoveryIconAction({ state: 'off', suggestionCount: 2 }), 'inbox')
  for (const state of ['on', 'paused', 'needs_always', 'needs_foreground', 'services_disabled']) {
    assert.equal(recoveryIconAction({ state, suggestionCount: 0 }), 'inbox', state)
  }
})

test('Home no longer renders the large recovery card; the icon sits in the header and is signed-in only', () => {
  const home = read('../screens/HomeScreen.jsx')
  assert.doesNotMatch(home, /HomeVisitRecoveryEntry/)
  assert.match(home, /recoverySlot=\{user \? <VisitRecoveryHeaderIcon userId=\{user\.id\}/)
  assert.equal(fs.existsSync(new URL('../components/home/HomeVisitRecoveryEntry.jsx', import.meta.url)), false)
  assert.match(read('../components/home/CompactHomeHeader.jsx'), /\{recoverySlot\}/)
})

test('the icon reuses the shared loader, count and inbox, and never says "missed checkoffs"', () => {
  const icon = read('../components/home/VisitRecoveryHeaderIcon.jsx')
  assert.match(icon, /useVisitRecovery\(userId\)/)
  assert.match(icon, /openVisitInbox\(/)
  assert.match(icon, /turnOn\(\)/)
  assert.match(icon, /resolved\.suggestionCount/)
  assert.match(icon, /Places you may have visited/)
  assert.doesNotMatch(icon.replace(/\/\/.*$/gm, ''), /missed|forgot/i)
})

test('Profile still owns turn on / off and uses the same hook setup flow', () => {
  const sec = read('../components/VisitRecoverySection.jsx')
  assert.match(sec, /turnOn/)
  assert.match(sec, /turnOffVisitRecovery/)
  assert.match(sec, /Turn off and delete visits/)
})
