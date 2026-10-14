// Pure rules for who is offered / runs seven-day visit recovery. The database
// is the real authority (candidate_visits INSERT requires the user's own
// visit_recovery_settings opt-in row; confirmation is authorized server-side),
// so these rules only decide what the app shows and when it starts listening.

// Android visit recovery needs the native build that declares ACCESS_BACKGROUND_LOCATION (app.json, expo-location plugin) and
// bundles the geofencing task support. A JavaScript update must never switch it on for a binary without that, so Android
// support is granted per RUNTIME VERSION: only runtimes listed in ANDROID_RECOVERY_RUNTIMES (the native fingerprints of builds
// that carry the permission) count. A new native build that keeps the capability is added to this list in the same change.
export const VISIT_RECOVERY_PLATFORMS = ['ios', 'android']

/** Native runtimes of Android binaries that include background location + geofencing (Android 1.1.10, versionCode 19). */
export const ANDROID_RECOVERY_RUNTIMES = ['53ba13b59fec2f2667b5ce1f9568e19f8f5076b3']

export function isVisitRecoveryPlatformSupported(platformOS, runtimeVersion) {
  if (!VISIT_RECOVERY_PLATFORMS.includes(platformOS)) return false
  if (platformOS === 'android') return ANDROID_RECOVERY_RUNTIMES.includes(runtimeVersion)
  return true
}

/**
 * THE capability. Every surface that shows, explains or runs visit recovery asks this and nothing else (no
 * scattered Platform.OS checks). iOS: always. Android: only on a binary whose runtime is in ANDROID_RECOVERY_RUNTIMES, so
 * existing public Android builds (no background location permission) stay hidden whatever JavaScript they receive.
 * Who is OFFERED the feature on a capable platform is a separate, remote decision (lib/visitDetection/offering.js).
 */
export function supportsVisitRecovery(platformOS, runtimeVersion) {
  return isVisitRecoveryPlatformSupported(platformOS, runtimeVersion)
}


/** Detection listens only for a signed-in user who is offered the feature (flag), is on a supported platform, and has opted in. */
export function shouldRunVisitDetection({ flagEnabled, platformOS, optedIn, runtimeVersion }) {
  return flagEnabled === true && isVisitRecoveryPlatformSupported(platformOS, runtimeVersion) && optedIn === true
}

/**
 * Which state the Profile card shows:
 *  hidden               feature not offered to this user (flag off) and not opted in
 *  off                  offered, not opted in
 *  needs_permission     opted in, background ("Always") location not granted
 *  paused               opted in, but the feature is switched off remotely right now
 *  on                   opted in and permitted
 */
export function recoveryCardState({ flagEnabled, platformOS, runtimeVersion, optedIn, backgroundGranted }) {
  if (!flagEnabled && !optedIn) return 'hidden'
  // An unsupported platform renders nothing at all: no card, no explanation, no future-feature copy.
  if (!supportsVisitRecovery(platformOS, runtimeVersion)) return 'hidden'
  if (!optedIn) return 'off'
  if (!flagEnabled) return 'paused' // remote switch is off: nothing runs, whatever the user chose
  return backgroundGranted ? 'on' : 'needs_permission'
}

/** The inbox entry is available to anyone who has a valid suggestion or has turned the feature on. */
export function shouldShowInboxEntry({ suggestionCount, optedIn }) {
  return (suggestionCount ?? 0) > 0 || optedIn === true
}

export const RECOVERY_COPY = {
  title: 'Recover checkoffs you forgot',
  intro: "If you spend time at a CheckOff place and forget to check in, we can remember it for you.",
  how: "With Location set to Always, your phone notes only when you arrive at and leave places from our catalog — not a route or a trail. The visit shows up in “Places you may have visited” for 7 days, and you choose whether to check it off. Nothing is ever checked off automatically.",
  privacy: "Private to you. Turn it off any time and we delete your saved visits.",
  needsPermission: 'Visit recovery is on, but Location isn’t set to Always yet, so nothing is being noted. Change Location to “Always” in Settings.',
  paused: 'Visit recovery is paused for the moment. Your choice is saved and it will resume automatically.',
  permissionDeniedHint: 'To turn this on, set Location to “Always” for CheckOff in Settings.',
  permissionDeniedHintAndroid: 'To turn this on, open Settings, choose Location for CheckOff and select Allow all the time.',
  turnOffTitle: 'Turn off and delete visits?',
  turnOffBody: 'We’ll stop noting visits and delete the visits saved for you. Anything you already checked off stays checked off.',
}
