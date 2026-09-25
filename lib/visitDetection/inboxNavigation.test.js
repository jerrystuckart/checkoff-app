import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildVisitInboxNavigateArgs, openVisitInbox, VISIT_INBOX_TAB, VISIT_INBOX_SCREEN } from './inboxNavigation.js'
import { describeClientBundle } from './clientBundle.js'

const appSrc = fs.readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8')
function stackBody(fn) {
  const i = appSrc.indexOf(`function ${fn}()`)
  assert.ok(i >= 0, `${fn} not found in App.jsx`)
  const j = appSrc.indexOf('\nfunction ', i + 10)
  return appSrc.slice(i, j)
}
function tabStack(tabName) {
  const m = appSrc.match(new RegExp(`<Tab\\.Screen\\s+name="${tabName}"\\s+component=\\{(\\w+)\\}`))
  assert.ok(m, `tab ${tabName} not found`)
  return m[1]
}

test('regression: the stack behind the inbox tab actually registers VisitInbox (it was once in ListsStack, so every tap only switched tabs)', () => {
  const stack = tabStack(VISIT_INBOX_TAB)
  assert.match(stackBody(stack), new RegExp(`<Stack\\.Screen\\s+name="${VISIT_INBOX_SCREEN}"`))
  assert.match(stackBody(stack), /name="ItemDetail"/, 'inbox rows open ItemDetail, so its stack must own it')
})

test('VisitInbox is registered exactly once across all stacks', () => {
  assert.equal(appSrc.match(/name="VisitInbox"/g).length, 1)
})

test('navigate args target the tab + nested screen, carrying the suggestion id (or null)', () => {
  assert.deepEqual(buildVisitInboxNavigateArgs('cv1'), ['HomeTab', { screen: 'VisitInbox', params: { candidateVisitId: 'cv1' } }])
  assert.deepEqual(buildVisitInboxNavigateArgs(), ['HomeTab', { screen: 'VisitInbox', params: { candidateVisitId: null } }])
})

test('openVisitInbox calls navigate on the given root and reports false when there is none', () => {
  const calls = []
  assert.equal(openVisitInbox({ navigate: (...a) => calls.push(a) }, 'x'), true)
  assert.deepEqual(calls[0], buildVisitInboxNavigateArgs('x'))
  assert.equal(openVisitInbox(undefined), false)
  assert.equal(openVisitInbox(null, 'x'), false)
})

test('describeClientBundle: embedded vs OTA', () => {
  assert.equal(describeClientBundle({ updateId: null, runtimeVersion: 'r', channel: 'production' }).embedded, true)
  const b = describeClientBundle({ updateId: '01a0da69-780c-7c54', isEmbeddedLaunch: false, runtimeVersion: 'r1', channel: 'production' })
  assert.equal(b.embedded, false)
  assert.equal(b.shortId, '01a0da69')
  assert.equal(b.logString, '01a0da69-780c-7c54|r1|production')
  assert.equal(describeClientBundle(undefined).logString, 'embedded|unknown-runtime|unknown-channel')
})
