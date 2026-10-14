// Android prominent disclosure for background location (Google Play User Data policy). Shown on its own, BEFORE any
// permission request, and never folded into Terms or the Privacy Policy. Pure copy + the ordering rule.
export const ANDROID_DISCLOSURE = Object.freeze({
  title: 'Recover checkoffs you forgot',
  body: 'CheckOff uses your location in the background to recognize when you spend enough time at places in our catalog, even when the app is closed. Your location creates private visit suggestions. Nothing is checked off until you confirm it. You can turn this off anytime and delete your saved visits.',
  notNow: 'Not now',
  continue: 'Continue',
  // Android 11 (API 30) and newer never show an in-app prompt for background access: the user is sent to the system
  // location page and must pick the system's own option.
  settingsTitle: 'One more step',
  settingsBody: 'On the next screen, choose Allow all the time for CheckOff. Then come back to the app.',
  preciseHint: 'CheckOff needs Precise location to notice when you arrive at a place. Approximate location is not enough.',
})

/**
 * The order of the Android flow. Disclosure first (always), then foreground, then background as a separate step.
 * @param {{foreground: string, apiLevel: number}} p
 * @returns {string[]}
 */
export function androidPermissionSteps({ foreground, apiLevel }) {
  const steps = ['disclosure']
  if (foreground !== 'granted') steps.push('foreground')
  steps.push(apiLevel >= 30 ? 'background_via_settings' : 'background_prompt')
  return steps
}
