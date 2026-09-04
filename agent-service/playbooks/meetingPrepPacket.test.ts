import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMeetingPrepPacket, deriveMeetingFollowUp, type MeetingPrepInput, type MeetingOutcome } from './meetingPrepPacket'

function input(overrides: Partial<MeetingPrepInput> = {}): MeetingPrepInput {
  return {
    destinationName: 'Hood River, OR',
    contactName: 'Jane Doe',
    contactRole: 'Chamber CEO',
    whyTheyMatter: 'Controls tourism marketing budget and decision-making.',
    relationshipHistory: ['First outreach sent 2026-09-01', 'Replied with interest 2026-09-05'],
    dvaDapStatus: 'DVA-1 score 92; DVA-2 BUILD_DAP_NOW; DAP on file.',
    whatTheyCareAbout: ['Off-peak visitation'],
    whatWeSent: ['Initial outreach email'],
    whatTheyAsked: ['One-pager'],
    budgetTimingIntel: ['Fiscal year starts July 1'],
    likelyObjections: ['App fatigue'],
    meetingObjective: 'Confirm fit and identify next step.',
    recommendedQuestions: ['What would make this an easy yes?'],
    doNotPromise: ['Specific pricing beyond approved numbers'],
    desiredNextStep: 'Agree on a pilot scope.',
    ...overrides,
  }
}

test('buildMeetingPrepPacket: contains every required section', () => {
  const packet = buildMeetingPrepPacket(input())
  for (const heading of ['Who you\'re meeting', 'Why they matter', 'DVA/DAP status', 'Relationship History', 'What They Care About', "What We've Sent", "What They've Asked", 'Budget/Timing Intelligence', 'Likely Objections', 'Meeting Objective', 'Recommended Questions', 'Do NOT Promise', 'Desired Next Step']) {
    assert.ok(packet.includes(heading), `expected packet to include section "${heading}"`)
  }
})

test('buildMeetingPrepPacket: is concise enough for a ~90-second read (bounded length, not a raw data dump)', () => {
  const packet = buildMeetingPrepPacket(input())
  assert.ok(packet.length < 3000, `packet was ${packet.length} chars — too long for a 90-second read`)
})

test('buildMeetingPrepPacket: empty sections say "(none on file)" rather than being silently blank', () => {
  const packet = buildMeetingPrepPacket(input({ likelyObjections: [] }))
  assert.match(packet, /\(none on file\)/)
})

function outcome(overrides: Partial<MeetingOutcome> = {}): MeetingOutcome {
  return {
    destinationId: 'destination-hood-river-or',
    contactsInvolved: ['Jane Doe'],
    keyStatements: ['Excited about the pilot'],
    decisions: ['Proceed to proposal'],
    promisesMade: ['Send a draft proposal by Friday'],
    materialsRequested: ['Pitch deck'],
    nextSteps: ['Draft proposal for review'],
    durableLessons: [],
    ...overrides,
  }
}

test('deriveMeetingFollowUp: creates a task for every promise made — never leaves one implicit', () => {
  const result = deriveMeetingFollowUp(outcome())
  assert.ok(result.tasks.some((t) => t.kind === 'HONOR_PROMISE' && t.description.includes('Send a draft proposal by Friday')))
})

test('deriveMeetingFollowUp: creates a task for every requested material', () => {
  const result = deriveMeetingFollowUp(outcome())
  assert.ok(result.tasks.some((t) => t.kind === 'PROVIDE_MATERIAL' && t.description.includes('Pitch deck')))
})

test('deriveMeetingFollowUp: only explicitly-tagged durableLessons are recommended for Open Brain — never auto-inferred from free text', () => {
  const noLessons = deriveMeetingFollowUp(outcome({ durableLessons: [] }))
  assert.deepEqual(noLessons.recommendedForOpenBrain, [])

  const withLesson = deriveMeetingFollowUp(outcome({ durableLessons: ['Lead with the Fruit Loop story — it lands better than generic value-prop language.'] }))
  assert.deepEqual(withLesson.recommendedForOpenBrain, ['Lead with the Fruit Loop story — it lands better than generic value-prop language.'])
})
