import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DESTINATION_EXECUTOR_GAPS, deriveResumeAction, type DestinationRelationshipResumeEvent } from './destinationExecutorGap'

test('DESTINATION_EXECUTOR_GAPS honestly records DVA-1/DVA-2/DAP and Gmail/Calendar as unautomated today', () => {
  const keys = DESTINATION_EXECUTOR_GAPS.map((g) => g.key)
  assert.deepEqual(keys.sort(), ['dap_invocation', 'dva1_invocation', 'dva2_invocation', 'gmail_calendar_execution'].sort())
})

function event(overrides: Partial<DestinationRelationshipResumeEvent> = {}): DestinationRelationshipResumeEvent {
  return { kind: 'GMAIL_REPLY_RECEIVED', destinationId: 'destination-grand-lake', contactId: 'contact-1', occurredAt: '2026-09-04T00:00:00Z', payload: {}, ...overrides }
}

test('deriveResumeAction: a Gmail reply is AUTO — associate and classify, no Jerry needed', () => {
  const action = deriveResumeAction(event({ kind: 'GMAIL_REPLY_RECEIVED' }))
  assert.equal(action.action, 'ASSOCIATE_AND_CLASSIFY')
  assert.equal(action.requiresJerry, false)
})

test('deriveResumeAction: a meeting request always requires Jerry — creating a calendar event is APPROVAL_REQUIRED with no exception', () => {
  const action = deriveResumeAction(event({ kind: 'MEETING_REQUESTED' }))
  assert.equal(action.action, 'CHECK_JERRY_AVAILABILITY')
  assert.equal(action.requiresJerry, true)
})

test('deriveResumeAction: a scheduled meeting triggers AUTO meeting-prep task creation', () => {
  const action = deriveResumeAction(event({ kind: 'MEETING_SCHEDULED' }))
  assert.equal(action.action, 'CREATE_MEETING_PREP_TASK')
  assert.equal(action.requiresJerry, false)
})

test('deriveResumeAction: a completed meeting captures outcome/follow-ups AUTO', () => {
  const action = deriveResumeAction(event({ kind: 'MEETING_COMPLETE' }))
  assert.equal(action.action, 'CAPTURE_OUTCOME_AND_FOLLOW_UPS')
  assert.equal(action.requiresJerry, false)
})
