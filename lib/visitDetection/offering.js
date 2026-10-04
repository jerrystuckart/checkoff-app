// Who is OFFERED visit recovery. Pure decision plus one loader.
//
// iOS: the master flag candidate_visit_detection (global, as before). Nothing changes for iOS.
// Android: the master flag AND an Android audience, so a native capability that exists in the build is still switched on
// remotely and gradually:
//   - a per-user override or a global value of the dedicated flag android_visit_recovery, OR
//   - the user is an existing visit-detection tester, OR an admin.
// To enable Android for everyone after physical validation and Play approval: set android_visit_recovery enabled_globally
// (the established feature_flags mechanism). No native build and no code change is needed.
export const ANDROID_RECOVERY_FLAG = 'android_visit_recovery'

export function isOfferedToUser({ platformOS, masterFlag, androidFlag, isTester, isAdmin }) {
  if (masterFlag !== true) return false
  if (platformOS !== 'android') return true
  return androidFlag === true || isTester === true || isAdmin === true
}
