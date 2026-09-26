import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  VISIT_RECOVERY_PLATFORMS, isVisitRecoveryPlatformSupported, shouldRunVisitDetection,
  recoveryCardState, shouldShowInboxEntry, RECOVERY_COPY,
} from './recoveryPolicy.js'

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

test('iOS only until an Android native build with background permission is verified on a device', () => {
  assert.deepEqual(VISIT_RECOVERY_PLATFORMS, ['ios'])
  assert.equal(isVisitRecoveryPlatformSupported('ios'), true)
  assert.equal(isVisitRecoveryPlatformSupported('android'), false)
  assert.equal(isVisitRecoveryPlatformSupported('web'), false)
})

test('detection listens only when offered (flag) AND supported platform AND the user opted in', () => {
  const ok = { flagEnabled: true, platformOS: 'ios', optedIn: true }
  assert.equal(shouldRunVisitDetection(ok), true)
  assert.equal(shouldRunVisitDetection({ ...ok, flagEnabled: false }), false, 'global switch off => nothing runs')
  assert.equal(shouldRunVisitDetection({ ...ok, optedIn: false }), false, 'no consent => nothing runs')
  assert.equal(shouldRunVisitDetection({ ...ok, platformOS: 'android' }), false)
  assert.equal(shouldRunVisitDetection({ ...ok, optedIn: undefined }), false)
  assert.equal(shouldRunVisitDetection({ ...ok, flagEnabled: 'true' }), false, 'strictly boolean')
})

test('card state: hidden when not offered; explicit off/needs_permission/on/paused; honest Android note', () => {
  const base = { platformOS: 'ios', backgroundGranted: true }
  assert.equal(recoveryCardState({ ...base, flagEnabled: false, optedIn: false }), 'hidden')
  assert.equal(recoveryCardState({ ...base, flagEnabled: true, optedIn: false }), 'off')
  assert.equal(recoveryCardState({ ...base, flagEnabled: true, optedIn: true, backgroundGranted: false }), 'needs_permission')
  assert.equal(recoveryCardState({ ...base, flagEnabled: true, optedIn: true }), 'on')
  assert.equal(recoveryCardState({ ...base, flagEnabled: false, optedIn: true }), 'paused')
  assert.equal(recoveryCardState({ platformOS: 'android', flagEnabled: true, optedIn: false }), 'unsupported_platform')
  assert.equal(recoveryCardState({ platformOS: 'android', flagEnabled: false, optedIn: false }), 'hidden')
  assert.match(RECOVERY_COPY.androidNote, /iPhone for now/)
  assert.doesNotMatch(RECOVERY_COPY.androidNote, /is on|enabled/i)
})

test('inbox entry: anyone with a valid suggestion, or who turned it on — nobody else', () => {
  assert.equal(shouldShowInboxEntry({ suggestionCount: 1, optedIn: false }), true)
  assert.equal(shouldShowInboxEntry({ suggestionCount: 0, optedIn: true }), true)
  assert.equal(shouldShowInboxEntry({ suggestionCount: 0, optedIn: false }), false)
  assert.equal(shouldShowInboxEntry({}), false)
})

test('permission copy states what is stored, the 7-day window, that nothing is auto-checked-off, and how to delete', () => {
  assert.match(RECOVERY_COPY.how, /not a route or a trail/)
  assert.match(RECOVERY_COPY.how, /7 days/)
  assert.match(RECOVERY_COPY.how, /Nothing is ever checked off automatically/)
  assert.match(RECOVERY_COPY.privacy, /delete/i)
  assert.match(RECOVERY_COPY.turnOffBody, /stays checked off/)
})

test('wiring: master flag is not tester-gated; tracker requires opt-in + platform; Profile shows the section to everyone', () => {
  const flags = read('../featureFlags.js')
  const gated = flags.slice(flags.indexOf('const TESTER_GATED_FLAGS'), flags.indexOf(']', flags.indexOf('const TESTER_GATED_FLAGS')))
  assert.ok(!gated.includes("'candidate_visit_detection'"))
  for (const k of ['realtime_nearby_checkoff_notifications', 'candidate_visit_silent_mode', 'at_place_checkoff_reminders']) assert.ok(gated.includes(k), `${k} must stay tester-only`)
  const tracker = read('./candidateVisitTracker.js')
  assert.ok(tracker.includes('shouldRunVisitDetection({ flagEnabled, platformOS: Platform.OS, optedIn })'))
  const profile = read('../../screens/ProfileScreen.jsx')
  assert.ok(profile.includes('<VisitRecoverySection'))
  assert.ok(!/visit_detection_tester\s*&&\s*\(\s*<VisitRecoverySection/.test(profile), 'recovery section must not be tester-gated')
  assert.ok(/visit_detection_tester && \(\s*<VisitDetectionDebugPanel/.test(profile), 'debug panel stays tester-only')
})

test('pushes stay tester-only server-side: the notify trigger still requires visit_detection_tester', () => {
  const trig = read('../../supabase/migrations/20260923_visit_detection_stage2_confirm.sql')
  assert.ok(trig.includes('COALESCE(visit_detection_tester, false) INTO v_is_tester'))
  const rollout = read('../../supabase/migrations/20260928_visit_recovery_rollout.sql')
  assert.ok(rollout.includes('visit_recovery_settings s WHERE s.user_id = auth.uid() AND s.opted_in'), 'server refuses candidates without opt-in')
  assert.ok(!/notify_high_confidence_candidate_visit/.test(rollout), 'rollout migration must not touch the push trigger')
})
