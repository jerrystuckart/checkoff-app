// ONE authoritative resolver for what the visit recovery card (Home) and section (Profile) show. Pure, so it is testable
// without a device. Inputs are facts, never inferences: Always Location is not assumed from foreground access.
//
// States, in precedence order:
//   hidden             platform unsupported (Android) or not offered to this user: render NOTHING
//   off                offered, user has not turned it on
//   paused             user turned it on but the remote switch is off
//   services_disabled  Location Services are off for the phone
//   needs_foreground   Location is denied / not allowed for CheckOff            CTA: Open Settings
//   needs_precise      (Android) only approximate location allowed; geofencing needs precise   CTA: Open Settings
//   needs_always       Location allowed, but not Always                        CTA: Turn on Always Location
//   registering        (Android) permissions are fine, monitoring is not registered yet
//   registration_error (Android) the last attempt to register monitoring failed
//   on                 turned on AND Always Location granted AND services on: the only state that says On
import { supportsVisitRecovery } from './recoveryPolicy.js'

export { ANDROID_DISCLOSURE } from './androidDisclosure.js'

export const RECOVERY_STATE_COPY = {
  title: 'Recover checkoffs you forgot',
  onEmpty: 'On — nothing to review right now',
  needsAlways: 'Turn on Always Location to recover missed checkoffs',
  // Android: the system's own wording for the background choice (Android 11 and newer: "Allow all the time").
  needsAllTheTime: 'Turn on Allow all the time to recover missed checkoffs',
  needsPrecise: 'Turn on Precise Location to recover missed checkoffs',
  registering: 'Setting up visit recovery',
  registrationError: 'Visit recovery could not start. Open CheckOff again, or check that battery settings do not restrict it',
  needsForeground: 'Turn on Location to recover missed checkoffs',
  servicesDisabled: 'Location Services are off. Turn them on in Settings to recover missed checkoffs',
  paused: 'Paused for the moment. Your choice is saved and it will resume automatically',
  cta: { always: 'Turn on Always Location', allTheTime: 'Turn on Allow all the time', settings: 'Open Settings' },
  // Shown before the system permission prompt.
  explain: 'CheckOff privately remembers when you spend time at places in our catalog, so you can check off visits you forgot. Only you can see them, and turning this off deletes your saved visits.',
}

/**
 * @param {object} p
 * @param {string} p.platformOS
 * @param {boolean} p.flagEnabled        candidate_visit_detection offered to this user (flag / tester gating)
 * @param {boolean} p.optedIn            the user's own recovery preference
 * @param {{servicesEnabled: boolean, foreground: string, background: string, backgroundCanAskAgain?: boolean, foregroundCanAskAgain?: boolean}} p.permission
 * @param {number} [p.suggestionCount]   actionable pending recoverable visits
 */
export function resolveVisitRecoveryState({ platformOS, runtimeVersion, flagEnabled, optedIn, permission, registration = null, suggestionCount = 0 }) {
  const hidden = { state: 'hidden', visible: false, title: null, status: null, cta: null, showInbox: false, suggestionCount: 0 }
  if (!supportsVisitRecovery(platformOS, runtimeVersion)) return hidden
  const android = platformOS === 'android'
  if (!flagEnabled && !optedIn) return hidden

  const base = { visible: true, title: RECOVERY_STATE_COPY.title, suggestionCount }
  if (!optedIn) return { ...base, state: 'off', status: null, cta: null, showInbox: suggestionCount > 0 }
  if (!flagEnabled) return { ...base, state: 'paused', status: RECOVERY_STATE_COPY.paused, cta: null, showInbox: true }

  const perm = permission ?? {}
  const inbox = true
  if (perm.servicesEnabled === false) {
    return { ...base, state: 'services_disabled', status: RECOVERY_STATE_COPY.servicesDisabled, cta: { label: RECOVERY_STATE_COPY.cta.settings, action: 'settings' }, showInbox: inbox }
  }
  if (perm.foreground !== 'granted') {
    return { ...base, state: 'needs_foreground', status: RECOVERY_STATE_COPY.needsForeground, cta: { label: RECOVERY_STATE_COPY.cta.settings, action: 'settings' }, showInbox: inbox }
  }
  if (android && perm.precision === 'approximate') {
    // Geofencing needs ACCESS_FINE_LOCATION: an approximate-only grant cannot register monitoring.
    return { ...base, state: 'needs_precise', status: RECOVERY_STATE_COPY.needsPrecise, cta: { label: RECOVERY_STATE_COPY.cta.settings, action: 'settings' }, showInbox: inbox }
  }
  if (perm.background !== 'always') {
    // A prompt can still be shown only when the system has not already been answered for background access.
    const canPrompt = perm.background === 'undetermined' || (perm.background === 'whenInUse' && perm.backgroundCanAskAgain !== false)
    return {
      ...base,
      state: 'needs_always',
      status: android ? RECOVERY_STATE_COPY.needsAllTheTime : RECOVERY_STATE_COPY.needsAlways,
      cta: { label: android ? RECOVERY_STATE_COPY.cta.allTheTime : RECOVERY_STATE_COPY.cta.always, action: canPrompt ? 'request' : 'settings' },
      showInbox: inbox,
    }
  }
  if (android && registration) {
    // Android only: On is claimed once monitoring is really registered (iOS behavior is unchanged).
    if (registration.error) return { ...base, state: 'registration_error', status: RECOVERY_STATE_COPY.registrationError, cta: null, showInbox: inbox }
    if (registration.started === false) return { ...base, state: 'registering', status: RECOVERY_STATE_COPY.registering, cta: null, showInbox: inbox }
  }
  const status = suggestionCount > 0
    ? `${suggestionCount} place${suggestionCount === 1 ? '' : 's'} waiting for you to check off`
    : RECOVERY_STATE_COPY.onEmpty
  return { ...base, state: 'on', status, cta: null, showInbox: inbox }
}
