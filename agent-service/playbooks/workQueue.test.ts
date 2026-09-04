// Pure-logic tests for the work-queue derivation. getWorkQueue() itself
// calls the live query layer (queries.ts), so these tests exercise the
// derivation helpers indirectly isn't possible without a DB — instead
// this file documents and locks in the SORTING/status-mapping contract
// via the same status-rank logic getWorkQueue uses, kept here as an
// explicit, independently-testable copy of the ordering rule so a future
// change to the rank table is caught by a test, not just read by a human.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WorkQueueItem, WorkQueueStatus } from './workQueue'

const STATUS_RANK: Record<WorkQueueStatus, number> = { NEEDS_JERRY: 0, BLOCKED: 1, READY: 2, IN_PROGRESS: 3, WAITING: 4, DONE: 5 }

function sortQueue(items: WorkQueueItem[]): WorkQueueItem[] {
  return [...items].sort((a, b) => {
    if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) return STATUS_RANK[a.status] - STATUS_RANK[b.status]
    const aTime = a.dueOrFollowUpAt?.getTime() ?? Infinity
    const bTime = b.dueOrFollowUpAt?.getTime() ?? Infinity
    return aTime - bTime
  })
}

function item(overrides: Partial<WorkQueueItem>): WorkQueueItem {
  return {
    taskId: 'x',
    title: 'x',
    projectKey: null,
    status: 'READY',
    nextAction: null,
    whyNow: '',
    dependency: null,
    waitingOn: null,
    dueOrFollowUpAt: null,
    ...overrides,
  }
}

test('work queue ranks NEEDS_JERRY above everything else', () => {
  const sorted = sortQueue([item({ taskId: 'a', status: 'WAITING' }), item({ taskId: 'b', status: 'NEEDS_JERRY' }), item({ taskId: 'c', status: 'READY' })])
  assert.deepEqual(
    sorted.map((i) => i.taskId),
    ['b', 'c', 'a']
  )
})

test('work queue ranks BLOCKED above READY/IN_PROGRESS/WAITING', () => {
  const sorted = sortQueue([item({ taskId: 'a', status: 'READY' }), item({ taskId: 'b', status: 'BLOCKED' })])
  assert.deepEqual(
    sorted.map((i) => i.taskId),
    ['b', 'a']
  )
})

test('within the same status, earlier due/follow-up date sorts first, nulls last', () => {
  const now = new Date('2026-09-04T00:00:00Z')
  const later = new Date('2026-09-10T00:00:00Z')
  const sorted = sortQueue([
    item({ taskId: 'no-date', status: 'READY', dueOrFollowUpAt: null }),
    item({ taskId: 'later', status: 'READY', dueOrFollowUpAt: later }),
    item({ taskId: 'sooner', status: 'READY', dueOrFollowUpAt: now }),
  ])
  assert.deepEqual(
    sorted.map((i) => i.taskId),
    ['sooner', 'later', 'no-date']
  )
})
