// Visit Reminder V1.5 — wires HomeScreen's already-computed at-place state
// (whatsGood.atPlaceItem) and season-scoped checked status (HomeScreen's
// own checkedItemIds Set) into local reminder scheduling/cancellation.
//
// Deliberately a separate hook from useWhatsGood.js: What's Good V1's
// selection/hydration and this reminder-scheduling concern are unrelated,
// and keeping them separate means this can be disabled or changed with zero
// risk to the already-shipped/tested What's Good V1 hook.
//
// Policy lives here (feature flag, permission, checked-off, profile
// validity) — lib/visitDetection/atPlaceReminder.js stays a pure mechanism
// (schedule/cancel/cleanup), mirroring how lib/whatsGoodOrchestrator.js
// stays flag-agnostic while useWhatsGood.js owns the isFlagEnabled() check.

import { useEffect, useRef } from 'react'
import { isFlagEnabled } from '../featureFlags'
import { getProfileForItem } from './profiles'
import { scheduleAtPlaceReminder, cancelAtPlaceReminder } from './atPlaceReminder'

async function resolveNotifications() {
  return await import('expo-notifications')
}

/**
 * @param {object} params
 * @param {string|null} params.userId
 * @param {object|null} params.atPlaceItem  whatsGood.atPlaceItem — already
 *   computed by the existing, approved foreground presence rule
 *   (min(geo_radius_m, 150m), see lib/whatsGoodAtPlace.js). Not
 *   recomputed here.
 * @param {boolean} params.isCheckedOff  whether atPlaceItem is already
 *   checked off. Callers should pass HomeScreen's existing season-scoped
 *   checkedItemIds.has(atPlaceItem.id) — this reuses the app's one
 *   existing checked-status computation instead of re-deriving it.
 */
export function useAtPlaceReminder({ userId, atPlaceItem, isCheckedOff }) {
  const previousAtPlaceIdRef = useRef(null)

  useEffect(() => {
    if (!userId) return undefined
    let cancelled = false

    ;(async () => {
      const previousId = previousAtPlaceIdRef.current
      const currentId = atPlaceItem?.id ?? null

      // Exit cancellation: the item that WAS at-place no longer is (the
      // user moved on). Opportunistic only — tied to whatever cadence
      // already recomputes atPlaceItem (foreground/focus refresh inside
      // useWhatsGood.js); this does not poll location on its own. See the
      // final report for the documented gap (no cancellation if the app
      // never returns to foreground before the timer fires).
      if (previousId && previousId !== currentId) {
        await cancelAtPlaceReminder(previousId)
      }
      previousAtPlaceIdRef.current = currentId

      if (cancelled) return
      if (!atPlaceItem) return

      if (isCheckedOff) {
        // Covers the case where checkoff is detected via HomeScreen's own
        // checkedItemIds refresh rather than ItemDetailScreen's direct
        // cancellation call — cancelAtPlaceReminder is a no-op if nothing
        // is pending, so this is always safe to call.
        await cancelAtPlaceReminder(atPlaceItem.id)
        return
      }

      const enabled = await isFlagEnabled(userId, 'at_place_checkoff_reminders')
      if (cancelled || !enabled) return

      const profile = await getProfileForItem(atPlaceItem)
      if (
        cancelled ||
        !profile ||
        profile.manual_only ||
        profile.is_active === false ||
        profile.candidate_dwell_minutes == null
      ) {
        return
      }

      const notifications = await resolveNotifications()
      const { status } = await notifications.getPermissionsAsync()
      if (cancelled || status !== 'granted') return

      await scheduleAtPlaceReminder({ itemId: atPlaceItem.id, dwellMinutes: profile.candidate_dwell_minutes })
    })()

    return () => {
      cancelled = true
    }
  }, [userId, atPlaceItem?.id, isCheckedOff])
}
