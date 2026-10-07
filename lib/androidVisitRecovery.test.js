// Android visit recovery: capability, audience, permission and disclosure flow, resolver states, budget and native config.
// Deterministic and device free. The end-to-end tracker behavior (registration, enter/exit, queue, sign-out, account switch)
// is in lib/visitDetection/androidTracker.harness.test.js; the shared candidate / confirmation / dwell / server contract is the
// iOS suite (lib/visitDetection/*.test.js), reused unchanged. Run with: node --test lib/androidVisitRecovery.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveVisitRecoveryState, RECOVERY_STATE_COPY } from './visitDetection/recoveryState.js'
import { ANDROID_RECOVERY_RUNTIMES, supportsVisitRecovery, shouldRunVisitDetection } from './visitDetection/recoveryPolicy.js'
import { isOfferedToUser, ANDROID_RECOVERY_FLAG } from './visitDetection/offering.js'
import { ANDROID_DISCLOSURE, androidPermissionSteps } from './visitDetection/androidDisclosure.js'
import { maxVenueRegions, ANDROID_GEOFENCE_LIMIT, ANDROID_MAX_TOTAL_REGISTERED } from './visitDetection/regionBudget.js'
import { visitGeofenceRadiusM } from './visitDetection/visitPipeline.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const app = JSON.parse(read('../app.json')).expo
const NEW = ANDROID_RECOVERY_RUNTIMES[0]
const OLD = '56c5f2cd23878dd4083475b052989216e4c3ae11'

// ── capability and audience ─────────────────────────────────────────────────────────────────────────────────────
test('the capability is per native runtime: the new build is supported, the installed 1.1.10 (18) build and unknown runtimes are not', () => {
  assert.equal(supportsVisitRecovery('android', NEW), true)
  assert.equal(supportsVisitRecovery('android', OLD), false)
  assert.equal(supportsVisitRecovery('android', undefined), false)
  assert.equal(supportsVisitRecovery('android', 'ffffffff'), false)
  assert.equal(shouldRunVisitDetection({ flagEnabled: true, platformOS: 'android', optedIn: true, runtimeVersion: OLD }), false, 'no detection on an incompatible binary, whatever JavaScript it runs')
  assert.equal(shouldRunVisitDetection({ flagEnabled: true, platformOS: 'android', optedIn: true, runtimeVersion: NEW }), true)
})

test('the audience: master flag AND (android_visit_recovery flag OR tester OR admin) on Android; iOS needs only the master flag (unchanged)', () => {
  const base = { platformOS: 'android', masterFlag: true, androidFlag: false, isTester: false, isAdmin: false }
  assert.equal(isOfferedToUser(base), false, 'ordinary users: not yet')
  assert.equal(isOfferedToUser({ ...base, isTester: true }), true)
  assert.equal(isOfferedToUser({ ...base, isAdmin: true }), true)
  assert.equal(isOfferedToUser({ ...base, androidFlag: true }), true, 'enabling the dedicated flag opens it to everyone with no new native build')
  assert.equal(isOfferedToUser({ ...base, androidFlag: true, masterFlag: false }), false, 'the master switch still wins')
  assert.equal(isOfferedToUser({ platformOS: 'ios', masterFlag: true, androidFlag: false, isTester: false, isAdmin: false }), true)
  assert.equal(ANDROID_RECOVERY_FLAG, 'android_visit_recovery')
  assert.ok(!/TESTER_GATED_FLAGS = new Set\([^)]*android_visit_recovery/.test(read('featureFlags.js')), 'not permanently hard-coded to testers')
})

// ── permission matrix ────────────────────────────────────────────────────────────────────────────────────────────
const ALLOW = { servicesEnabled: true, foreground: 'granted', precision: 'precise', background: 'always' }
const android = (permission, o = {}) => resolveVisitRecoveryState({ platformOS: 'android', runtimeVersion: NEW, flagEnabled: true, optedIn: true, permission, registration: { started: true, error: null }, suggestionCount: 0, ...o })

test('foreground denied, undetermined or revoked later: Open Settings, never On', () => {
  for (const foreground of ['denied', 'undetermined']) {
    const r = android({ ...ALLOW, foreground, background: 'denied' })
    assert.deepEqual([r.state, r.cta.action], ['needs_foreground', 'settings'])
    assert.doesNotMatch(r.status, /^On/)
  }
})

test('foreground granted, background not granted: the Android wording and a request the first time; Settings once the system will not ask again', () => {
  const first = android({ ...ALLOW, background: 'undetermined' })
  assert.deepEqual([first.state, first.status, first.cta.label, first.cta.action], ['needs_always', 'Turn on Allow all the time to recover missed checkoffs', 'Turn on Allow all the time', 'request'])
  const denied = android({ ...ALLOW, background: 'whenInUse', backgroundCanAskAgain: true })
  assert.equal(denied.cta.action, 'request')
  const permanent = android({ ...ALLOW, background: 'whenInUse', backgroundCanAskAgain: false })
  assert.equal(permanent.cta.action, 'settings')
  for (const r of [first, denied, permanent]) assert.doesNotMatch(r.status, /Always Location/, 'no iOS wording on Android')
})

test('Allow all the time granted and monitoring registered: On, with the review count when there are candidates', () => {
  const r = android(ALLOW)
  assert.deepEqual([r.state, r.status, r.cta], ['on', 'On — nothing to review right now', null])
  assert.equal(android(ALLOW, { suggestionCount: 3 }).status, '3 places waiting for you to check off')
})

test('On is not claimed until monitoring is registered, and a failed registration is shown as an error', () => {
  const registering = android(ALLOW, { registration: { started: false, error: null } })
  assert.deepEqual([registering.state, registering.status], ['registering', 'Setting up visit recovery'])
  assert.doesNotMatch(registering.status, /^On/)
  const failed = android(ALLOW, { registration: { started: false, error: 'boom' } })
  assert.equal(failed.state, 'registration_error')
  assert.doesNotMatch(failed.status, /^On/)
  // iOS keeps its definition of On (no registration fact involved).
  const ios = resolveVisitRecoveryState({ platformOS: 'ios', flagEnabled: true, optedIn: true, permission: ALLOW, registration: { started: false, error: null } })
  assert.equal(ios.state, 'on')
})

test('approximate-only location: geofencing needs precise, so the card asks for Precise Location in Settings; precise is accepted', () => {
  const approx = android({ ...ALLOW, precision: 'approximate' })
  assert.deepEqual([approx.state, approx.status, approx.cta.action], ['needs_precise', 'Turn on Precise Location to recover missed checkoffs', 'settings'])
  assert.equal(android({ ...ALLOW, precision: 'precise' }).state, 'on')
  assert.equal(android({ ...ALLOW, precision: null }).state, 'on', 'unknown precision (older API) is not blocked')
  // iOS has no such state.
  assert.equal(resolveVisitRecoveryState({ platformOS: 'ios', flagEnabled: true, optedIn: true, permission: { ...ALLOW, precision: 'approximate' } }).state, 'on')
})

test('location services off: accurate copy, Open Settings, not On', () => {
  const r = android({ ...ALLOW, servicesEnabled: false })
  assert.deepEqual([r.state, r.cta.action], ['services_disabled', 'settings'])
  assert.match(r.status, /Location Services are off/)
})

test('preference off: the opt-in state; remote pause is not On; not offered to this user (flag off): nothing', () => {
  assert.equal(android(ALLOW, { optedIn: false }).state, 'off')
  assert.equal(android(ALLOW, { flagEnabled: false }).state, 'paused')
  assert.equal(android(ALLOW, { flagEnabled: false, optedIn: false }).visible, false, 'ordinary Android users are not offered it yet')
})

test('return from Settings: the state is a pure function of the permission facts, re-read on foreground (same card after granting)', () => {
  const before = android({ ...ALLOW, background: 'whenInUse', backgroundCanAskAgain: false })
  const after = android(ALLOW)
  assert.deepEqual([before.state, after.state], ['needs_always', 'on'])
  const hook = read('visitDetection/useVisitRecovery.js')
  assert.match(hook, /AppState\.addEventListener\('change', \(next\) => \{ if \(next === 'active'\) load\(\) \}\)/)
  assert.match(hook, /readLocationPermissionSnapshot\(\)/)
})

// ── disclosure and flow ───────────────────────────────────────────────────────────────────────────────────────────
test('the prominent disclosure: exact required meaning, Not now and Continue, shown before any request, not folded into policy text', () => {
  assert.equal(ANDROID_DISCLOSURE.title, 'Recover checkoffs you forgot')
  assert.match(ANDROID_DISCLOSURE.body, /uses your location in the background to recognize when you spend enough time at places in our catalog, even when the app is closed/)
  assert.match(ANDROID_DISCLOSURE.body, /Nothing is checked off until you confirm it/)
  assert.match(ANDROID_DISCLOSURE.body, /turn this off anytime and delete your saved visits/)
  assert.equal(ANDROID_DISCLOSURE.notNow, 'Not now')
  assert.equal(ANDROID_DISCLOSURE.continue, 'Continue')
  assert.doesNotMatch(JSON.stringify(ANDROID_DISCLOSURE), /check-off/i)
  assert.deepEqual(androidPermissionSteps({ foreground: 'undetermined', apiLevel: 34 }), ['disclosure', 'foreground', 'background_via_settings'], 'foreground first, background separate, Settings on Android 11 and newer')
  assert.deepEqual(androidPermissionSteps({ foreground: 'granted', apiLevel: 34 }), ['disclosure', 'background_via_settings'])
  assert.deepEqual(androidPermissionSteps({ foreground: 'granted', apiLevel: 29 }), ['disclosure', 'background_prompt'])
  assert.match(ANDROID_DISCLOSURE.settingsBody, /Allow all the time/)
})

test('the flow wiring: disclosure before every request; foreground requested before and separately from background; never automatic', () => {
  const perms = read('visitDetection/permissions.js')
  const flow = perms.slice(perms.indexOf('export async function runAndroidPermissionFlow'))
  assert.ok(flow.indexOf('requestForegroundPermissionsAsync') < flow.indexOf('requestBackgroundPermissionsAsync'))
  assert.ok(flow.indexOf('confirmSettingsStep') < flow.indexOf('requestBackgroundPermissionsAsync'), 'the Settings step is explained before the system page opens')
  const hook = read('visitDetection/useVisitRecovery.js')
  assert.match(hook, /if \(Platform\.OS === 'android'\) \{ showAndroidDisclosure\(\{ onContinue: askBackground \}\); return \}/)
  assert.match(hook, /ANDROID_NOT_NOW_KEY, String\(Date\.now\(\)\)/, 'Not now is remembered')
  const section = read('../components/VisitRecoverySection.jsx')
  assert.match(section, /if \(Platform\.OS === 'android'\) \{ showAndroidDisclosure\(\{ onContinue: doEnable \}\); return \}/)
  // No automatic prompt anywhere: the only callers of the disclosure are the two explicit taps above, so Not now cannot be nagged.
  for (const f of ['../App.jsx', '../screens/HomeScreen.jsx', '../screens/ProfileScreen.jsx']) assert.ok(!read(f).includes('showAndroidDisclosure'), f)
  assert.ok(!read('visitDetection/candidateVisitTracker.js').includes('requestBackgroundPermissions'), 'the tracker never prompts')
})

// ── budget ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('geofence budget: Android 40 total (39 venues + sentinel), far below the 100 limit; iOS unchanged', () => {
  assert.equal(ANDROID_GEOFENCE_LIMIT, 100)
  assert.equal(ANDROID_MAX_TOTAL_REGISTERED, 40)
  assert.ok(ANDROID_MAX_TOTAL_REGISTERED <= ANDROID_GEOFENCE_LIMIT * 0.5)
  assert.deepEqual([maxVenueRegions('android', true), maxVenueRegions('android', false)], [39, 40])
  assert.deepEqual([maxVenueRegions('ios', true), maxVenueRegions('ios', false)], [18, 19])
})

test('venue radii and dwell thresholds are the shared ones (one definition for both platforms)', () => {
  assert.equal(typeof visitGeofenceRadiusM({ geo_radius_m: null }), 'number')
  const tracker = read('visitDetection/candidateVisitTracker.js')
  assert.ok(tracker.includes("from './visitPipeline'"), 'same pipeline module on both platforms')
  assert.ok(!/Platform\.OS === 'android'[^\n]*dwell/i.test(tracker), 'no Android specific dwell rule')
})

// ── native configuration ──────────────────────────────────────────────────────────────────────────────────────────
test('native configuration: background location on, foreground service off, exactly the expected plugin props', () => {
  const loc = app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location')[1]
  assert.deepEqual(loc, { isAndroidBackgroundLocationEnabled: true, isAndroidForegroundServiceEnabled: false })
  assert.deepEqual([...app.android.permissions].sort(), ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA', 'POST_NOTIFICATIONS'], 'existing permissions untouched')
  const plugin = read('../node_modules/expo-location/plugin/build/withLocation.js')
  assert.match(plugin, /isAndroidBackgroundLocationEnabled && 'android\.permission\.ACCESS_BACKGROUND_LOCATION'/)
  assert.match(plugin, /enableAndroidForegroundService && 'android\.permission\.FOREGROUND_SERVICE'/)
  assert.ok(!('isIosBackgroundLocationEnabled' in loc), 'iOS native permissions unchanged')
  assert.deepEqual(app.ios.infoPlist.UIBackgroundModes, ['remote-notification', 'location'])
})

test('the geofence task is defined at module scope and the task manager restores it after reboot and app update', () => {
  const tracker = read('visitDetection/candidateVisitTracker.js')
  const defineAt = tracker.indexOf('TaskManager.defineTask(GEOFENCE_TASK_NAME')
  assert.ok(defineAt > -1)
  const before = tracker.slice(0, defineAt)
  assert.ok(!/(^|\n)(export )?(async )?function [^\n]*\{\s*$/.test(before.split('\n').slice(-3).join('\n')), 'not inside a function')
  assert.ok(!before.slice(before.lastIndexOf('\n// =====')).includes('useEffect'), 'not inside a component lifecycle')
  const tm = read('../node_modules/expo-task-manager/android/src/main/AndroidManifest.xml')
  assert.match(tm, /BOOT_COMPLETED/)
  assert.match(tm, /MY_PACKAGE_REPLACED/)
})

test('Android native module facts: geofencing uses Play services (no foreground service) and the movement module is Apple only', () => {
  const gf = read('../node_modules/expo-location/android/src/main/java/expo/modules/location/taskConsumers/GeofencingTaskConsumer.kt')
  assert.match(gf, /LocationServices\.getGeofencingClient/)
  assert.ok(!/startForeground|ForegroundService/.test(gf))
  assert.deepEqual(JSON.parse(read('../modules/checkoff-movement/expo-module.config.json')).platforms, ['apple'])
})

test('copy: new public strings say checkoffs without a hyphen', () => {
  for (const f of ['visitDetection/recoveryState.js', 'visitDetection/androidDisclosure.js']) assert.doesNotMatch(read(f), /check-offs?\b/i, f)
  assert.equal(RECOVERY_STATE_COPY.needsAllTheTime, 'Turn on Allow all the time to recover missed checkoffs')
})
