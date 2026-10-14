import { useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { createBadgeCelebrationController } from './badgeCelebrations'
import { getUserLifetimePoints, checkAndAwardPointMilestoneBadges } from './points'
import { handleFirstCheckinReferralBonus } from './referral'

// points_* badges are awarded by the client; the server trigger only knows check-in counts. Run on every check so it
// also covers paths that never called updateUserLifetimePoints (visit recovery confirmation, Trip Mode).
async function syncMilestones(userId) {
  const pts = await getUserLifetimePoints(userId)
  await checkAndAwardPointMilestoneBadges(userId, pts)
}

export const badgeCelebrations = createBadgeCelebrationController({
  supabase,
  storage: AsyncStorage,
  syncMilestones,
  onFirstCheckin: handleFirstCheckinReferralBonus,
})

/** Call after any successful check-off (tap, photo, recovery, Trip Mode). Safe to call repeatedly. */
export function requestBadgeCelebrationCheck(reason = 'checkin') {
  badgeCelebrations.requestCheck(reason)
}

// Screen changes are a cheap catch-all (a recovery confirmed elsewhere, a streak function that finished late).
// Throttled so navigation never turns into a stream of queries.
const NAVIGATION_CHECK_MIN_GAP_MS = 30 * 1000
let lastNavigationCheckAt = 0
export function requestBadgeCelebrationCheckOnNavigation() {
  const t = Date.now()
  if (t - lastNavigationCheckAt < NAVIGATION_CHECK_MIN_GAP_MS) return
  lastNavigationCheckAt = t
  badgeCelebrations.requestCheck('navigate', { followUp: false })
}

let holdSeq = 0
/** While `active` is true no badge celebration is presented (a sheet/modal of this screen is up). */
export function useBadgeCelebrationHold(active) {
  const keyRef = useRef(null)
  if (keyRef.current == null) keyRef.current = `hold-${++holdSeq}`
  useEffect(() => {
    const key = keyRef.current
    if (active) badgeCelebrations.hold(key)
    return () => badgeCelebrations.release(key)
  }, [active])
}
