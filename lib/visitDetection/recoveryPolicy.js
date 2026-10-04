// Pure rules for who is offered / runs seven-day visit recovery. The database
// is the real authority (candidate_visits INSERT requires the user's own
// visit_recovery_settings opt-in row; confirmation is authorized server-side),
// so these rules only decide what the app shows and when it starts listening.

// Android background detection is NOT advertised or run until a native build
// containing ACCESS_BACKGROUND_LOCATION (app.json, committed) has been built and
// verified on a device. To enable: add 'android' here in the same change that
// ships that verified build.
export const VISIT_RECOVERY_PLATFORMS = ['ios']

export function isVisitRecoveryPlatformSupported(platformOS) {
  return VISIT_RECOVERY_PLATFORMS.includes(platformOS)
}

/**
 * THE capability. Every surface that shows, explains or runs visit recovery asks this and nothing else (no
 * scattered Platform.OS checks). Android returns false until background detection is built, verified on a device
 * and cleared by Play policy; enabling it later is adding 'android' to VISIT_RECOVERY_PLATFORMS in that change.
 */
export function supportsVisitRecovery(platformOS) {
  return isVisitRecoveryPlatformSupported(platformOS)
}

/** Detection listens only for a signed-in user who is offered the feature (flag), is on a supported platform, and has opted in. */
export function shouldRunVisitDetection({ flagEnabled, platformOS, optedIn }) {
  return flagEnabled === true && isVisitRecoveryPlatformSupported(platformOS) && optedIn === true
}

/**
 * Which state the Profile card shows:
 *  hidden               feature not offered to this user (flag off) and not opted in
 *  off                  offered, not opted in
 *  needs_permission     opted in, background ("Always") location not granted
 *  paused               opted in, but the feature is switched off remotely right now
 *  on                   opted in and permitted
 */
export function recoveryCardState({ flagEnabled, platformOS, optedIn, backgroundGranted }) {
  if (!flagEnabled && !optedIn) return 'hidden'
  // An unsupported platform renders nothing at all: no card, no explanation, no future-feature copy.
  if (!supportsVisitRecovery(platformOS)) return 'hidden'
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
  turnOffTitle: 'Turn off and delete visits?',
  turnOffBody: 'We’ll stop noting visits and delete the visits saved for you. Anything you already checked off stays checked off.',
}
