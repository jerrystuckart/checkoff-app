import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  scheduleAtPlaceReminder,
  cancelAtPlaceReminder,
  cleanupExpiredAtPlaceReminders,
  getPendingAtPlaceReminder,
} from './atPlaceReminder.js'

function makeStubStorage(initial = {}) {
  let value = JSON.stringify(initial)
  return {
    async getItem() {
      return value
    },
    async setItem(_key, val) {
      value = val
    },
    async removeItem() {
      value = null
    },
  }
}

function makeStubNotifications({ idPrefix = 'notif' } = {}) {
  let counter = 0
  const scheduled = []
  const cancelled = []
  return {
    scheduleNotificationAsync: async (config) => {
      const id = `${idPrefix}-${++counter}`
      scheduled.push({ id, config })
      return id
    },
    cancelScheduledNotificationAsync: async (id) => {
      cancelled.push(id)
    },
    _scheduled: scheduled,
    _cancelled: cancelled,
  }
}

const NOW = new Date('2026-09-02T12:00:00.000Z')

test('schedules a reminder using dwellMinutes as the delay, with the exact generic copy', async () => {
  const storage = makeStubStorage()
  const notifications = makeStubNotifications()

  const result = await scheduleAtPlaceReminder({ itemId: 'item-1', dwellMinutes: 15, notifications, storage, now: NOW })

  assert.equal(result.scheduled, true)
  assert.equal(notifications._scheduled.length, 1)
  const { config } = notifications._scheduled[0]
  assert.equal(config.content.title, 'You found a CheckOff Spot 👀')
  assert.equal(config.content.body, "What's the thing?")
  assert.equal(config.content.data.kind, 'at_place_checkoff_reminder')
  assert.equal(config.content.data.item_id, 'item-1')
  assert.equal(config.trigger.seconds, 15 * 60)
})

test('persists the pending reminder record, readable via getPendingAtPlaceReminder', async () => {
  const storage = makeStubStorage()
  const notifications = makeStubNotifications()

  await scheduleAtPlaceReminder({ itemId: 'item-1', dwellMinutes: 10, notifications, storage, now: NOW })
  const pending = await getPendingAtPlaceReminder('item-1', { storage })

  assert.ok(pending)
  assert.equal(pending.itemId, 'item-1')
  assert.equal(pending.fireAt, new Date(NOW.getTime() + 10 * 60 * 1000).toISOString())
})

test('repeated scheduling for the same item while still pending does not duplicate (idempotent)', async () => {
  const storage = makeStubStorage()
  const notifications = makeStubNotifications()

  const first = await scheduleAtPlaceReminder({ itemId: 'item-1', dwellMinutes: 15, notifications, storage, now: NOW })
  const second = await scheduleAtPlaceReminder({ itemId: 'item-1', dwellMinutes: 15, notifications, storage, now: new Date(NOW.getTime() + 1000) })

  assert.equal(first.scheduled, true)
  assert.equal(second.scheduled, false)
  assert.equal(second.notificationId, first.notificationId)
  assert.equal(notifications._scheduled.length, 1, 'only one OS-level notification should ever be scheduled')
})

test('a different item schedules its own independent reminder', async () => {
  const storage = makeStubStorage()
  const notifications = makeStubNotifications()

  await scheduleAtPlaceReminder({ itemId: 'item-1', dwellMinutes: 15, notifications, storage, now: NOW })
  const result = await scheduleAtPlaceReminder({ itemId: 'item-2', dwellMinutes: 15, notifications, storage, now: NOW })

  assert.equal(result.scheduled, true)
  assert.equal(notifications._scheduled.length, 2)
})

test('cancelAtPlaceReminder cancels the OS notification and clears the record', async () => {
  const storage = makeStubStorage()
  const notifications = makeStubNotifications()

  const { notificationId } = await scheduleAtPlaceReminder({ itemId: 'item-1', dwellMinutes: 15, notifications, storage, now: NOW })
  const cancelled = await cancelAtPlaceReminder('item-1', { notifications, storage })

  assert.equal(cancelled, true)
  assert.deepEqual(notifications._cancelled, [notificationId])
  assert.equal(await getPendingAtPlaceReminder('item-1', { storage }), null)
})

test('cancelAtPlaceReminder is a safe no-op when nothing is pending for that item', async () => {
  const storage = makeStubStorage()
  const notifications = makeStubNotifications()

  const cancelled = await cancelAtPlaceReminder('never-scheduled', { notifications, storage })

  assert.equal(cancelled, false)
  assert.equal(notifications._cancelled.length, 0)
})

test('cancelAtPlaceReminder still clears its own record even if the OS call throws (already fired/gone)', async () => {
  const storage = makeStubStorage()
  const notifications = makeStubNotifications()
  notifications.cancelScheduledNotificationAsync = async () => {
    throw new Error('not found')
  }

  await scheduleAtPlaceReminder({ itemId: 'item-1', dwellMinutes: 15, notifications, storage, now: NOW })
  const cancelled = await cancelAtPlaceReminder('item-1', { notifications, storage })

  assert.equal(cancelled, true)
  assert.equal(await getPendingAtPlaceReminder('item-1', { storage }), null)
})

test('cleanupExpiredAtPlaceReminders removes entries whose fireAt has passed', async () => {
  const storage = makeStubStorage()
  const notifications = makeStubNotifications()

  await scheduleAtPlaceReminder({ itemId: 'item-1', dwellMinutes: 5, notifications, storage, now: NOW }) // fires at NOW+5min
  const later = new Date(NOW.getTime() + 10 * 60 * 1000) // 10 min later -> item-1's reminder has expired

  await cleanupExpiredAtPlaceReminders({ now: later, storage })

  assert.equal(await getPendingAtPlaceReminder('item-1', { storage }), null)
})

test('cleanupExpiredAtPlaceReminders leaves not-yet-fired entries untouched', async () => {
  const storage = makeStubStorage()
  const notifications = makeStubNotifications()

  await scheduleAtPlaceReminder({ itemId: 'item-1', dwellMinutes: 15, notifications, storage, now: NOW })
  const soon = new Date(NOW.getTime() + 60 * 1000) // 1 min later -> still pending

  await cleanupExpiredAtPlaceReminders({ now: soon, storage })

  assert.ok(await getPendingAtPlaceReminder('item-1', { storage }))
})

test('scheduling after a prior reminder for the same item has expired allows a fresh one (self-heals, no manual cleanup call needed)', async () => {
  const storage = makeStubStorage()
  const notifications = makeStubNotifications()

  await scheduleAtPlaceReminder({ itemId: 'item-1', dwellMinutes: 5, notifications, storage, now: NOW })
  const muchLater = new Date(NOW.getTime() + 60 * 60 * 1000)

  const result = await scheduleAtPlaceReminder({ itemId: 'item-1', dwellMinutes: 5, notifications, storage, now: muchLater })

  assert.equal(result.scheduled, true)
  assert.equal(notifications._scheduled.length, 2, 'the expired first reminder should not block scheduling a new one')
})
