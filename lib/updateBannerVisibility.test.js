import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldShowUpdateBanner,
  isUnsafeRouteForUpdateBanner,
  UNSAFE_UPDATE_BANNER_ROUTES,
} from './updateBannerVisibility.js'

const BASE = { isUpdatePending: true, currentRouteName: 'Home', dismissed: false }

test('no banner when no update is pending', () => {
  assert.equal(shouldShowUpdateBanner({ ...BASE, isUpdatePending: false }), false)
})

test('banner appears when an update is fully downloaded on a safe, non-dismissed route', () => {
  assert.equal(shouldShowUpdateBanner(BASE), true)
})

test('"Later" dismisses the banner for the current session/update', () => {
  assert.equal(shouldShowUpdateBanner({ ...BASE, dismissed: true }), false)
})

test('a later newly-pending update can surface again once dismissed is re-armed to false', () => {
  // Simulates the component re-arming its session-dismiss flag whenever
  // isUpdatePending transitions from false -> true again for a NEW update.
  const dismissedForOldUpdate = shouldShowUpdateBanner({ ...BASE, dismissed: true })
  assert.equal(dismissedForOldUpdate, false)

  const newUpdatePendingAfterRearm = shouldShowUpdateBanner({ ...BASE, dismissed: false })
  assert.equal(newUpdatePendingAfterRearm, true)
})

test('every documented unsafe route defers the banner', () => {
  for (const route of UNSAFE_UPDATE_BANNER_ROUTES) {
    assert.equal(isUnsafeRouteForUpdateBanner(route), true, `${route} should be unsafe`)
    assert.equal(
      shouldShowUpdateBanner({ ...BASE, currentRouteName: route }),
      false,
      `${route} should defer the banner even with an update pending`
    )
  }
})

test('a safe route is not flagged unsafe', () => {
  assert.equal(isUnsafeRouteForUpdateBanner('Home'), false)
  assert.equal(isUnsafeRouteForUpdateBanner('ItemDetail'), false)
  assert.equal(isUnsafeRouteForUpdateBanner(null), false)
  assert.equal(isUnsafeRouteForUpdateBanner(undefined), false)
})

test('returning to a safe route reveals a previously-deferred banner', () => {
  const onUnsafeRoute = shouldShowUpdateBanner({ ...BASE, currentRouteName: 'CreateList' })
  assert.equal(onUnsafeRoute, false)

  const afterNavigatingToSafeRoute = shouldShowUpdateBanner({ ...BASE, currentRouteName: 'Home' })
  assert.equal(afterNavigatingToSafeRoute, true)
})

test('dev/disabled-update state reports no banner cleanly (isUpdatePending false, no throw)', () => {
  assert.doesNotThrow(() => {
    const result = shouldShowUpdateBanner({ isUpdatePending: false, currentRouteName: null, dismissed: false })
    assert.equal(result, false)
  })
})
