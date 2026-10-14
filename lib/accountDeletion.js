// Account deletion, client side. One backend contract for iOS and Android: supabase.rpc('delete_my_account_v2') (supabase/migrations/20261008d).
// Already installed builds keep calling delete_my_account(), which still returns void: they cannot mistake a queued deletion for a completed one.
// The caller's identity is the signed in session (auth.uid()); there is no user id parameter, so a client cannot name another account.
//
// The RPC answers { status: 'completed' | 'accepted', request_id }. "accepted" means access is already blocked and cleanup (stored photos, database
// records, the sign in account) is queued and retried automatically until it finishes; it is NOT the same as completed, and the copy says so.
// Pure functions plus injected dependencies so everything here is testable under plain `node --test`.

export const DELETION_COPY = Object.freeze({
  confirmTitle: 'Delete account',
  confirmBody: 'This will permanently delete your account and the data linked to it: your check ins, photos, notes, badges and visit records. Lists you share with other people stay for them. This cannot be undone.',
  confirmAgainTitle: 'Are you absolutely sure?',
  completedTitle: 'Account deleted',
  completedBody: 'Your account and the data linked to it have been deleted.',
  acceptedTitle: 'Deletion started',
  acceptedBody: 'Your account is closed and you are signed out. We are removing your stored data now, usually within a few minutes, and we keep retrying automatically until it is finished.',
  failedTitle: 'Could not delete account',
  failedFallback: 'Your account was not deleted. Please try again, or email support@getcheckoff.com.',
})

/** @returns {{kind: 'completed'|'accepted', requestId: string|null}} */
export function interpretDeletionResponse(data) {
  const status = data && typeof data === 'object' ? data.status : null
  if (status === 'completed') return { kind: 'completed', requestId: data.request_id ?? null }
  // 'accepted', or a legacy backend that returns nothing on success: the request was accepted, completion is not claimed.
  return { kind: 'accepted', requestId: data?.request_id ?? null }
}

/**
 * Ask the backend to delete the signed in account. Throws (so the caller keeps the user signed in and can retry) on any error:
 * nothing is cleared locally unless the backend accepted the request.
 */
export async function requestAccountDeletion(supabase) {
  const { data, error } = await supabase.rpc('delete_my_account_v2')
  if (error) throw error
  return interpretDeletionResponse(data)
}

export const LOCAL_KEY_PREFIXES = Object.freeze(['evt:', 'atPlaceReminders_v1'])

/**
 * Clear everything that belongs to the account that was just deleted, on this phone only: visit recovery and geofence registrations,
 * the feature flag cache, per account debounce keys. Device level preferences (theme, chosen city, onboarding) are kept so a guest or
 * another account on this phone is unaffected. Each step is isolated: one failure must not leave the others undone.
 */
export async function clearLocalAccountState({ stopVisitTracking, resetFlagsCache, storage }) {
  const steps = []
  try { await stopVisitTracking?.(); steps.push('visit_tracking') } catch {}
  try { resetFlagsCache?.(); steps.push('flags') } catch {}
  try {
    const keys = (await storage?.getAllKeys?.()) ?? []
    const mine = keys.filter((k) => LOCAL_KEY_PREFIXES.some((p) => k.startsWith(p)))
    if (mine.length) await storage.multiRemove(mine)
    steps.push('storage')
  } catch {}
  return steps
}

/** Friendlier text for a sign in attempt on an account whose deletion has started or finished. */
export function describeSignInError(message) {
  if (/banned/i.test(message ?? '')) {
    return 'This account has been deleted or is being deleted. Once deletion finishes you can create a new account with the same email.'
  }
  return message
}
