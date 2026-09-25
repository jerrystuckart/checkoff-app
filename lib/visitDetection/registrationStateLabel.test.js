// Field bug fix (2026-09-25) — lib/visitDetection/registrationStateLabel.js unit tests.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeRegistrationState } from './registrationStateLabel.js'

test('no log at all -> unknown, prompts to grant/refresh', () => {
  const { label, tone } = describeRegistrationState(null)
  assert.equal(tone, 'unknown')
  assert.match(label, /grant permission and refresh/i)
})

test('ok_monitored -> ok tone, names the count', () => {
  const { label, tone } = describeRegistrationState({
    registration_state: 'ok_monitored',
    monitored_items: [{ item_id: 'a' }, { item_id: 'b' }],
    geofencing_started: true,
    error_message: null,
  })
  assert.equal(tone, 'ok')
  assert.match(label, /2 places monitored/)
})

test('ok_none_eligible -> neutral tone, explicitly NOT a failure (the core bug fix)', () => {
  const { label, tone } = describeRegistrationState({
    registration_state: 'ok_none_eligible',
    monitored_items: [],
    geofencing_started: false,
    error_message: null,
  })
  assert.equal(tone, 'neutral')
  assert.match(label, /not a failure/i)
})

test('query_error -> error tone, surfaces the message', () => {
  const { label, tone } = describeRegistrationState({
    registration_state: 'query_error',
    monitored_items: [],
    geofencing_started: false,
    error_message: 'network request failed',
  })
  assert.equal(tone, 'error')
  assert.match(label, /Query failed: network request failed/)
})

test('os_registration_error -> error tone, distinguishable from query_error', () => {
  const { label, tone } = describeRegistrationState({
    registration_state: 'os_registration_error',
    monitored_items: [{ item_id: 'a' }],
    geofencing_started: false,
    error_message: 'startGeofencingAsync: region limit exceeded',
  })
  assert.equal(tone, 'error')
  assert.match(label, /OS geofence registration failed/)
})

test('legacy row (no registration_state) with geofencing_started=true -> ok', () => {
  const { label, tone } = describeRegistrationState({
    registration_state: null,
    monitored_items: [{ item_id: 'a' }],
    geofencing_started: true,
    error_message: null,
  })
  assert.equal(tone, 'ok')
  assert.match(label, /1 place monitored/)
})

test('legacy row with 0 monitored and no error -> unknown, names the ambiguity rather than guessing', () => {
  const { label, tone } = describeRegistrationState({
    registration_state: null,
    monitored_items: [],
    geofencing_started: false,
    error_message: null,
  })
  assert.equal(tone, 'unknown')
  assert.match(label, /can't distinguish/)
})

test('legacy row with an error_message -> error', () => {
  const { label, tone } = describeRegistrationState({
    registration_state: null,
    monitored_items: [],
    geofencing_started: false,
    error_message: 'boom',
  })
  assert.equal(tone, 'error')
  assert.match(label, /Registration failed: boom/)
})
