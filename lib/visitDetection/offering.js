// Who is OFFERED visit recovery. Pure decision.
//
// Every signed-in user on a capable binary (platform capability: recoveryPolicy.supportsVisitRecovery) is offered the feature
// while the master flag candidate_visit_detection is ON. That flag is the operational kill switch, on every platform: turning it
// off hides the setup everywhere and stops detection. Account type (tester, admin) plays no part in who is offered it, and
// users must still opt in and grant permission themselves.
// ANDROID_RECOVERY_FLAG is kept only so diagnostics can report the legacy audience flag; it no longer gates anything.
export const ANDROID_RECOVERY_FLAG = 'android_visit_recovery'

export function isOfferedToUser({ masterFlag }) {
  return masterFlag === true
}
