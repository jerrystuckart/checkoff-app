import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeNextFollowUpAt, isFollowUpDue, isLegitimateFutureWait, shouldPark, parseRequestedWait, MAX_FOLLOWUP_ATTEMPTS, type FollowUpState } from './followUpEngine'

const NOW = '2026-09-08T12:00:00.000Z'

function state(overrides: Partial<FollowUpState> = {}): FollowUpState {
  return { attemptsMade: 0, lastContactAt: NOW, requestedWaitUntil: null, parked: false, ...overrides }
}

test('computeNextFollowUpAt: first follow-up is scheduled a bounded number of days out', () => {
  const next = computeNextFollowUpAt(state(), NOW)
  assert.ok(next)
  const days = (new Date(next!).getTime() - new Date(NOW).getTime()) / (1000 * 60 * 60 * 24)
  assert.ok(days > 0 && days <= 21, `expected a bounded near-term follow-up, got ${days} days`)
})

test('computeNextFollowUpAt: cadence widens with each attempt — never spam at a fixed short interval', () => {
  const first = computeNextFollowUpAt(state({ attemptsMade: 0 }), NOW)
  const second = computeNextFollowUpAt(state({ attemptsMade: 1 }), NOW)
  const third = computeNextFollowUpAt(state({ attemptsMade: 2 }), NOW)
  const daysBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)
  assert.ok(daysBetween(NOW, first!) < daysBetween(NOW, second!))
  assert.ok(daysBetween(NOW, second!) < daysBetween(NOW, third!))
})

test('computeNextFollowUpAt: attempts exhausted at MAX_FOLLOWUP_ATTEMPTS returns null — caller must park, never loop forever', () => {
  const next = computeNextFollowUpAt(state({ attemptsMade: MAX_FOLLOWUP_ATTEMPTS }), NOW)
  assert.equal(next, null)
})

test('computeNextFollowUpAt: an explicit requestedWaitUntil always wins over the default cadence', () => {
  const farFuture = '2027-01-01T00:00:00.000Z'
  const next = computeNextFollowUpAt(state({ attemptsMade: 0, requestedWaitUntil: farFuture }), NOW)
  assert.equal(next, farFuture)
})

test('computeNextFollowUpAt: a parked relationship never gets a next follow-up date', () => {
  assert.equal(computeNextFollowUpAt(state({ parked: true }), NOW), null)
})

test('isFollowUpDue: true only once the scheduled date has actually arrived', () => {
  assert.equal(isFollowUpDue('2026-09-01T00:00:00.000Z', NOW), true)
  assert.equal(isFollowUpDue('2026-12-01T00:00:00.000Z', NOW), false)
  assert.equal(isFollowUpDue(null, NOW), false)
})

test('isLegitimateFutureWait: a genuinely future-dated wait ("contact me after budget season") is NOT stale', () => {
  const futureWait = state({ requestedWaitUntil: '2027-01-01T00:00:00.000Z' })
  assert.equal(isLegitimateFutureWait(futureWait, NOW), true)
})

test('isLegitimateFutureWait: a due (or overdue) follow-up is NOT a legitimate wait — it needs action', () => {
  const overdue = state({ lastContactAt: '2025-01-01T00:00:00.000Z', attemptsMade: 0 })
  assert.equal(isLegitimateFutureWait(overdue, NOW), false)
})

test('isLegitimateFutureWait: a parked relationship is not a "wait" — it is done, not stale-in-waiting', () => {
  assert.equal(isLegitimateFutureWait(state({ parked: true }), NOW), false)
})

test('shouldPark: true once attempts are exhausted with no explicit future request', () => {
  assert.equal(shouldPark(state({ attemptsMade: MAX_FOLLOWUP_ATTEMPTS })), true)
})

test('shouldPark: false if an explicit future wait is on record, even past the attempt cap', () => {
  assert.equal(shouldPark(state({ attemptsMade: MAX_FOLLOWUP_ATTEMPTS, requestedWaitUntil: '2027-01-01T00:00:00.000Z' })), false)
})

test('shouldPark: false below the attempt cap', () => {
  assert.equal(shouldPark(state({ attemptsMade: MAX_FOLLOWUP_ATTEMPTS - 1 })), false)
})

test('parseRequestedWait: recognizes an explicit ISO date', () => {
  const parsed = parseRequestedWait('Let\'s revisit this on 2026-11-15, after our board meets.', NOW)
  assert.ok(parsed)
  assert.equal(parsed?.kind, 'EXPLICIT_DATE')
  assert.match(parsed!.resumeAt, /^2026-11-15/)
})

test('parseRequestedWait: recognizes a relative "in N weeks" phrasing', () => {
  const parsed = parseRequestedWait('Circle back in 3 weeks please.', NOW)
  assert.ok(parsed)
  assert.equal(parsed?.kind, 'RELATIVE')
  const days = (new Date(parsed!.resumeAt).getTime() - new Date(NOW).getTime()) / (1000 * 60 * 60 * 24)
  assert.ok(Math.abs(days - 21) < 1)
})

test('parseRequestedWait: recognizes budget-cycle timing as a named window, not treated as due immediately', () => {
  const parsed = parseRequestedWait('Reach out again after budget season.', NOW)
  assert.ok(parsed)
  assert.equal(parsed?.kind, 'NAMED_WINDOW')
  assert.equal(isFollowUpDue(parsed!.resumeAt, NOW), false)
})

test('parseRequestedWait: recognizes seasonal timing', () => {
  const parsed = parseRequestedWait("Let's talk again after the summer rush.", NOW)
  assert.ok(parsed)
  assert.equal(parsed?.kind, 'NAMED_WINDOW')
})

test('parseRequestedWait: returns null for unrecognized phrasing — never guesses a date from free text', () => {
  assert.equal(parseRequestedWait('Maybe someday, who knows.', NOW), null)
})
