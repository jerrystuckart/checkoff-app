// Visit Reminder V1.5 — "Still Here" local at-place reminder. Pure
// mechanism only (schedule/cancel/cleanup one local OS-level scheduled
// notification + its AsyncStorage record). Every POLICY decision (feature
// flag, permission, already-checked-off, which item is currently at-place,
// profile validity) lives in the caller — see useAtPlaceReminder.js —
// mirroring how lib/whatsGoodOrchestrator.js stays flag-agnostic while
// lib/useWhatsGood.js owns the isFlagEnabled() check.
//
// LOCAL, not push: this schedules via expo-notifications'
// scheduleNotificationAsync(), an OS-level scheduled notification (iOS
// UNUserNotificationCenter / Android's Expo-managed equivalent) — it
// survives the app backgrounding or being terminated, because the OS (not
// this JS process) is what actually fires it. Cancellation
// (cancelScheduledNotificationAsync) only works while the app is running,
// which is fine here: both cancellation triggers (checking the item off,
// or the app re-confirming the user left) can only happen while the app is
// open anyway.
//
// DWELL VALUE CHOICE: schedules against the item's visit_detection_profile
// candidate_dwell_minutes, not strong_dwell_minutes — deliberately, not by
// default. candidate_dwell_minutes (lib/visitDetection/profiles.js /
// supabase/migrations/20260828_visit_detection_phase1.sql) is already
// defined as the minimum dwell that separates a genuine stay from a
// drive-by/pass-through for that place type — exactly the "the user has
// now been here long enough that reminding them is reasonable" judgment
// this reminder needs, just applied forward from an explicit in-app
// at-place open instead of backward from a geofence exit.
// strong_dwell_minutes exists for a different purpose: boosting
// *retrospective* confidence scoring after a visit is already over (see
// confidenceScore.js's exceedsStrongDwell signal). For several categories
// (bar 90min, restaurant 60min) it is far longer than how long a user
// typically keeps the app or their phone out during one at-place moment,
// and would fire the reminder long after it stopped being useful. Neither
// choice introduces a new number — this reuses an existing,
// already-place-type-specific field as-is, for a new (but compatible)
// purpose.

const STORAGE_KEY = 'atPlaceReminders_v1'

async function resolveStorage(storage) {
  if (storage) return storage
  const mod = await import('@react-native-async-storage/async-storage')
  return mod.default
}

async function resolveNotifications(notifications) {
  if (notifications) return notifications
  return await import('expo-notifications')
}

async function readAll(storage) {
  try {
    const raw = await storage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {} // malformed/corrupt state -> treat as "nothing pending", never throw
  }
}

async function writeAll(storage, map) {
  await storage.setItem(STORAGE_KEY, JSON.stringify(map))
}

/**
 * Removes any pending reminder record whose fireAt has already passed.
 * Self-healing, no server dependency — safe to call anytime (schedule
 * already calls this before checking for a duplicate). Does NOT attempt to
 * cancel the OS-level notification for an expired entry: if fireAt is in
 * the past, the OS has already delivered (or discarded) it — nothing left
 * to cancel, only our own bookkeeping to clear.
 */
export async function cleanupExpiredAtPlaceReminders({ now = new Date(), storage } = {}) {
  const activeStorage = await resolveStorage(storage)
  const all = await readAll(activeStorage)
  let changed = false
  for (const [itemId, entry] of Object.entries(all)) {
    if (!entry?.fireAt || new Date(entry.fireAt).getTime() <= now.getTime()) {
      delete all[itemId]
      changed = true
    }
  }
  if (changed) await writeAll(activeStorage, all)
  return all
}

/** @returns {Promise<{itemId:string, notificationId:string, scheduledAt:string, fireAt:string}|null>} */
export async function getPendingAtPlaceReminder(itemId, { storage } = {}) {
  const activeStorage = await resolveStorage(storage)
  const all = await readAll(activeStorage)
  return all[itemId] ?? null
}

/**
 * Schedules exactly one local reminder for this item. Idempotent: if a
 * not-yet-expired reminder is already pending for this item, returns it
 * unchanged instead of scheduling a duplicate — this is what makes
 * repeated Home opens at the same place safe.
 *
 * @param {object} params
 * @param {string} params.itemId
 * @param {number} params.dwellMinutes  already resolved by the caller (see
 *   module doc for which visit_detection_profile field to use).
 * @param {object} [params.notifications]  injected expo-notifications module
 * @param {object} [params.storage]  injected AsyncStorage
 * @param {Date} [params.now]
 * @returns {Promise<{scheduled: boolean, notificationId: string|null, fireAt: string|null}>}
 */
export async function scheduleAtPlaceReminder({ itemId, dwellMinutes, notifications, storage, now = new Date() }) {
  const activeStorage = await resolveStorage(storage)
  await cleanupExpiredAtPlaceReminders({ now, storage: activeStorage })

  const existing = await getPendingAtPlaceReminder(itemId, { storage: activeStorage })
  if (existing) return { scheduled: false, notificationId: existing.notificationId, fireAt: existing.fireAt }

  const activeNotifications = await resolveNotifications(notifications)
  const fireAt = new Date(now.getTime() + dwellMinutes * 60 * 1000)

  const notificationId = await activeNotifications.scheduleNotificationAsync({
    content: {
      title: 'You found a CheckOff Spot 👀',
      body: "What's the thing?",
      data: { kind: 'at_place_checkoff_reminder', item_id: itemId },
    },
    trigger: { seconds: Math.max(1, Math.round(dwellMinutes * 60)) },
  })

  const all = await readAll(activeStorage)
  all[itemId] = { itemId, notificationId, scheduledAt: now.toISOString(), fireAt: fireAt.toISOString() }
  await writeAll(activeStorage, all)

  return { scheduled: true, notificationId, fireAt: fireAt.toISOString() }
}

/**
 * Cancels the pending reminder for this item, if any — safe to call
 * unconditionally (no-op when nothing is pending). Call sites: the item
 * being checked off, and the app later re-confirming the user left before
 * the reminder fired.
 */
export async function cancelAtPlaceReminder(itemId, { notifications, storage } = {}) {
  const activeStorage = await resolveStorage(storage)
  const all = await readAll(activeStorage)
  const entry = all[itemId]
  if (!entry) return false

  const activeNotifications = await resolveNotifications(notifications)
  try {
    await activeNotifications.cancelScheduledNotificationAsync(entry.notificationId)
  } catch (e) {
    // Already fired/consumed by the OS, or otherwise gone -- not an error
    // for our purposes; still clear our own bookkeeping below.
    console.warn('cancelAtPlaceReminder: cancelScheduledNotificationAsync failed (may already be gone):', e?.message ?? e)
  }

  delete all[itemId]
  await writeAll(activeStorage, all)
  return true
}
