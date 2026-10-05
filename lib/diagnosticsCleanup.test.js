import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { shouldShowDiagnostics } from './whatsGoodDiagnosticsPanel.js'
import { publishWhatsGoodDiagnostics, getWhatsGoodDiagnostics, subscribeWhatsGoodDiagnostics } from './whatsGoodDiagnosticsStore.js'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(join(root, f), 'utf8')

test('Home and its cards render no diagnostics UI', () => {
  for (const f of ['screens/HomeScreen.jsx', 'components/home/WhatsGoodDiscovery.jsx', 'components/home/UnsupportedLocationCard.jsx']) {
    const s = read(f)
    assert.doesNotMatch(s, /Diagnostics \(admin only\)|Refresh What's Good|<VisitDetectionDebugPanel|diagnosticsCard=|shouldShowDiagnostics\(/, f)
  }
  assert.doesNotMatch(read('screens/HomeScreen.jsx'), /isAdmin=\{|diagnostics=\{|onRefreshWhatsGood=\{/)
})
test('Home still assembles and publishes the payload (no behavior loss)', () => {
  assert.match(read('screens/HomeScreen.jsx'), /publishWhatsGoodDiagnostics\(whatsGoodDiagnostics, refreshWhatsGoodDiagnostics\)/)
})
test('Profile Diagnostics: admin gate, collapsed by default, expandable, normal recovery card untouched', () => {
  const c = read('components/profile/AdminDiagnosticsSection.jsx')
  assert.match(c, /useState\(false\)/)
  assert.match(c, /if \(!shouldShowDiagnostics\(isAdmin\)\) return null/)
  assert.match(c, /accessibilityState=\{\{ expanded \}\}/)
  assert.match(c, /\{expanded && \(/)
  const p = read('screens/ProfileScreen.jsx')
  assert.match(p, /<AdminDiagnosticsSection\s+isAdmin=\{profile\?\.is_admin\}/)
  assert.match(p, /<VisitRecoverySection userId=\{user\?\.id\} navigation=\{navigation\} \/>/)
  assert.doesNotMatch(p, /<VisitDetectionDebugPanel/)
})
test('gate: only exactly true is admin (guests/ordinary users/undefined never see it)', () => {
  assert.equal(shouldShowDiagnostics(true), true)
  for (const v of [false, null, undefined, 'true', 1]) assert.equal(shouldShowDiagnostics(v), false)
})
test('store hand-off', () => {
  let seen; const un = subscribeWhatsGoodDiagnostics(v => { seen = v })
  const refresh = () => {}
  publishWhatsGoodDiagnostics({ a: 1 }, refresh)
  assert.deepEqual(seen.payload, { a: 1 }); assert.equal(getWhatsGoodDiagnostics().refresh, refresh)
  un()
})
