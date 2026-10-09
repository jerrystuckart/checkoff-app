import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { initialNoticeState, noticeReducer, loadNoticeClosed, saveNoticeClosed, shouldRenderNotice, noticeKey } from './photoTermsNoticeState.js'
import { PHOTO_TERMS_NOTICE_CARD } from './photoConsentCopy.js'

const mem = () => { const m = new Map(); return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v) }, _m: m } }
const run = (events, start = initialNoticeState) => events.reduce(noticeReducer, start)
const OLD = { id: 'u1', created_at: '2026-09-01T00:00:00Z' }
const NEW = { id: 'u2', created_at: '2026-10-20T00:00:00Z' }

test('card copy is exactly the approved compact text', () => {
  assert.equal(PHOTO_TERMS_NOTICE_CARD.title, 'Photo terms updated')
  assert.equal(PHOTO_TERMS_NOTICE_CARD.summary, 'You keep ownership of your photos. Updated terms explain how we use and retain new submissions.')
  assert.equal(PHOTO_TERMS_NOTICE_CARD.readDetails, 'Read details')
  assert.equal(PHOTO_TERMS_NOTICE_CARD.dismiss, 'Dismiss')
  for (const t of Object.values(PHOTO_TERMS_NOTICE_CARD)) assert.doesNotMatch(t, /[-‐-―−]/)
})

test('opening and closing details; details cannot open before load or after dismissal', () => {
  let s = run([{ type: 'user_changed', userId: 'u1' }])
  assert.equal(noticeReducer(s, { type: 'open_details' }).detailsOpen, false) // not loaded yet
  s = run([{ type: 'loaded', userId: 'u1', closed: false }], s)
  s = run([{ type: 'open_details' }], s); assert.equal(s.detailsOpen, true)
  s = run([{ type: 'close_details' }], s); assert.equal(s.detailsOpen, false); assert.equal(s.closed, false) // reading never dismisses the card
  s = run([{ type: 'open_details' }, { type: 'dismiss' }], s); assert.equal(s.closed, true); assert.equal(s.detailsOpen, false)
  assert.equal(noticeReducer(s, { type: 'open_details' }).detailsOpen, false)
})

test('dismissal persists per account on the device and does not leak between accounts', async () => {
  const storage = mem()
  assert.equal(await loadNoticeClosed(storage, 'u1'), false)
  await saveNoticeClosed(storage, 'u1')
  assert.equal(await loadNoticeClosed(storage, 'u1'), true)      // next launch
  assert.equal(await loadNoticeClosed(storage, 'u3'), false)     // another account on the same device still sees it
  assert.equal(noticeKey('u1') === noticeKey('u3'), false)
  assert.equal(await loadNoticeClosed(storage, null), false)
  assert.deepEqual([...storage._m.keys()], [noticeKey('u1')])    // nothing else is written: no acceptance record
  const broken = { getItem: async () => { throw new Error('x') }, setItem: async () => { throw new Error('x') } }
  assert.equal(await loadNoticeClosed(broken, 'u1'), false)
  await saveNoticeClosed(broken, 'u1')                           // never throws
})

test('account switching resets state and ignores a late load for the previous account', () => {
  let s = run([{ type: 'user_changed', userId: 'u1' }, { type: 'loaded', userId: 'u1', closed: true }])
  assert.equal(s.closed, true)
  s = run([{ type: 'user_changed', userId: 'u2' }], s)
  assert.deepEqual({ l: s.loaded, c: s.closed, d: s.detailsOpen }, { l: false, c: false, d: false })
  s = run([{ type: 'loaded', userId: 'u1', closed: true }], s)   // stale answer for u1 arrives late
  assert.equal(s.loaded, false)
  s = run([{ type: 'loaded', userId: 'u2', closed: false }], s)
  assert.equal(s.loaded, true); assert.equal(s.closed, false)
  assert.equal(run([{ type: 'user_changed', userId: 'u2' }], s), s) // same user: no reset
})

test('render rules: existing accounts only (cutoff), not before load, not after dismissal', () => {
  const loaded = (uid, closed = false) => run([{ type: 'user_changed', userId: uid }, { type: 'loaded', userId: uid, closed }])
  assert.equal(shouldRenderNotice(loaded('u1'), OLD), true)
  assert.equal(shouldRenderNotice(loaded('u1', true), OLD), false)
  assert.equal(shouldRenderNotice(loaded('u2'), NEW), false)      // created after the cutoff
  assert.equal(shouldRenderNotice(run([{ type: 'user_changed', userId: 'u1' }]), OLD), false) // not loaded
  assert.equal(shouldRenderNotice(loaded('u1'), { ...OLD, id: 'u9' }), false)                  // state belongs to another user
  assert.equal(shouldRenderNotice(loaded('u1'), null), false)
})

test('component: compact card, scrollable details with Close, larger text safe, badge hold, no server or acceptance', () => {
  const src = fs.readFileSync(new URL('../components/PhotoTermsNotice.jsx', import.meta.url), 'utf8')
  assert.match(src, /useBadgeCelebrationHold\(state\.detailsOpen\)/)        // a badge celebration cannot appear over or right after the sheet
  assert.match(src, /<ScrollView/)
  assert.match(src, /<Modal/)
  assert.match(src, /onRequestClose=\{\(\) => dispatch\(\{ type: 'close_details' \}\)\}/)
  assert.match(src, /PHOTO_TERMS_NOTICE\.close/)
  assert.match(src, /maxFontSizeMultiplier=\{MAX_SCALE\}/)
  assert.match(src, /flexWrap: 'wrap'/)
  assert.doesNotMatch(src, /numberOfLines/)                                  // nothing is truncated
  assert.doesNotMatch(src, /supabase|\.rpc\(|\.from\(|consent_ack|photo_terms_version|consent_version/)
  // Placement: Profile only, below the account controls (after Notifications, before Sign out); nothing on Home.
  const profile = fs.readFileSync(new URL('../screens/ProfileScreen.jsx', import.meta.url), 'utf8')
  assert.match(profile, /<PhotoTermsNotice user=\{user\} colors=\{colors\}/)
  assert.ok(profile.indexOf('<PhotoTermsNotice') > profile.indexOf('>Notifications</Text>'))
  assert.ok(profile.indexOf('<PhotoTermsNotice') < profile.indexOf('style={styles.signOutBtn}'))
  const home = fs.readFileSync(new URL('../screens/HomeScreen.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(home, /PhotoTermsNotice|photoTermsNotice|PHOTO_TERMS_NOTICE/)
  for (const f of ['../App.jsx', '../components/home/HomeVisitRecoveryEntry.jsx']) assert.doesNotMatch(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /PhotoTermsNotice/)
})
