import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeDestinationActivity } from './destinationActivityBrief'

test('summarizeDestinationActivity: matches the exact example from the spec — 2 replies, 1 info request, 1 meeting interest, 4 follow-ups, 11 no-action', () => {
  const outcomes = [
    'REPLY_INFO_REQUEST',
    'REPLY_MEETING_INTEREST',
    'FOLLOW_UP_DUE',
    'FOLLOW_UP_DUE',
    'FOLLOW_UP_DUE',
    'FOLLOW_UP_DUE',
    ...Array(11).fill('NO_ACTION'),
  ] as const
  const brief = summarizeDestinationActivity(outcomes)
  assert.equal(brief.lines[0], '2 destination replies arrived')
  assert.equal(brief.lines[1], '1 asks for information and Chief prepared the one-pager')
  assert.equal(brief.lines[2], '1 wants a meeting and needs Jerry')
  assert.equal(brief.lines[3], '4 follow-ups are due')
  assert.equal(brief.lines[4], '11 destinations need no action today')
})

test('summarizeDestinationActivity: never dumps raw message content — every line is a count-based sentence', () => {
  const brief = summarizeDestinationActivity(['REPLY_INFO_REQUEST'])
  for (const line of brief.lines) {
    assert.ok(!/@/.test(line), 'no email address should ever appear in a brief line')
  }
})

test('summarizeDestinationActivity: an empty day produces no lines, not a wall of zeroes', () => {
  const brief = summarizeDestinationActivity([])
  assert.deepEqual(brief.lines, [])
})

test('summarizeDestinationActivity: singular/plural phrasing is correct at count 1', () => {
  const brief = summarizeDestinationActivity(['FOLLOW_UP_DUE', 'NO_ACTION'])
  assert.match(brief.lines.find((l) => l.includes('follow-up')) ?? '', /1 follow-up is due/)
  assert.match(brief.lines.find((l) => l.includes('no action')) ?? '', /1 destination needs no action today/)
})
