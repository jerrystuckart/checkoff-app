import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldStartReload, attemptReload } from './updateReloadGuard.js'

test('shouldStartReload allows a fresh attempt and blocks while already reloading', () => {
  assert.equal(shouldStartReload(false), true)
  assert.equal(shouldStartReload(undefined), true)
  assert.equal(shouldStartReload(true), false)
})

test('"Restart now" invokes reloadFn exactly once', async () => {
  let calls = 0
  let isReloading = false
  const setIsReloading = (next) => { isReloading = next }
  const reloadFn = async () => { calls += 1 }

  const result = await attemptReload({ reloadFn, isReloading, setIsReloading })

  assert.equal(calls, 1)
  assert.equal(result.attempted, true)
  assert.equal(result.success, true)
})

test('repeated taps while a reload is in flight are ignored (no second reloadFn call)', async () => {
  let calls = 0
  const reloadFn = async () => { calls += 1 }
  const setIsReloading = () => {}

  // First tap already in flight (isReloading true) when the second tap lands.
  const secondTapResult = await attemptReload({ reloadFn, isReloading: true, setIsReloading })

  assert.equal(calls, 0)
  assert.equal(secondTapResult.attempted, false)
})

test('reload failure resets the guard so the app stays usable and a retry is possible', async () => {
  let isReloading = false
  const setIsReloading = (next) => { isReloading = next }
  const reloadFn = async () => { throw new Error('network unreachable') }

  const result = await attemptReload({ reloadFn, isReloading, setIsReloading })

  assert.equal(result.attempted, true)
  assert.equal(result.success, false)
  assert.ok(result.error instanceof Error)
  // Guard was reset -> a subsequent tap is allowed again.
  assert.equal(isReloading, false)
  assert.equal(shouldStartReload(isReloading), true)
})

test('reload failure does not throw an unhandled rejection', async () => {
  const reloadFn = async () => { throw new Error('boom') }
  await assert.doesNotReject(
    attemptReload({ reloadFn, isReloading: false, setIsReloading: () => {} })
  )
})
