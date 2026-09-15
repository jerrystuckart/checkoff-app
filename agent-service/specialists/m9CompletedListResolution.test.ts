// Session 3, Phase 4 — completed-list replace/reopen tests.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveM9CompletedListHandling, type M9ExistingListLookup } from './m9CompletedListResolution'

test('COMPLETED LIST: a completed list stays unchanged without an explicit reopen', () => {
  const lookups: M9ExistingListLookup[] = [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'COMPLETED' } }]
  const result = resolveM9CompletedListHandling({ lookups, operatorDecisionsByConceptId: {} })
  assert.equal(result[0]!.kind, 'BLOCKED_NEEDS_REOPEN')
  assert.equal(result[0]!.listId, null)
})

test('COMPLETED LIST: an ACTIVE list resolves to itself (membership refresh preserves the list UUID)', () => {
  const lookups: M9ExistingListLookup[] = [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'Hidden Gems', status: 'ACTIVE' } }]
  const result = resolveM9CompletedListHandling({ lookups, operatorDecisionsByConceptId: {} })
  assert.equal(result[0]!.kind, 'REUSE_EXISTING_ACTIVE')
  assert.equal(result[0]!.listId, 'list-1')
})

test('COMPLETED LIST: a real REOPEN decision with substantive text unblocks a completed list, preserving its UUID', () => {
  const lookups: M9ExistingListLookup[] = [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'COMPLETED' } }]
  const result = resolveM9CompletedListHandling({
    lookups,
    operatorDecisionsByConceptId: { c1: { resolutionAction: 'REOPEN', decisionText: 'Refreshing the seasonal list for Fall 2026 with new certified items.', decidedBy: 'jerry', decidedAt: '2026-09-15T00:00:00.000Z' } },
  })
  assert.equal(result[0]!.kind, 'REUSE_EXISTING_REOPENED')
  assert.equal(result[0]!.listId, 'list-1', 'the SAME production list UUID must be preserved on reopen, never a new one minted')
  assert.equal(result[0]!.reopenedBy?.decidedBy, 'jerry')
})

test('COMPLETED LIST: material concept replacement requires the same explicit reopen-class approval (REPLACE_CONCEPT)', () => {
  const lookups: M9ExistingListLookup[] = [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'COMPLETED' } }]
  const result = resolveM9CompletedListHandling({
    lookups,
    operatorDecisionsByConceptId: { c1: { resolutionAction: 'REPLACE_CONCEPT', decisionText: 'Replacing the old After Dark concept with the new, better-evidenced one.', decidedBy: 'jerry', decidedAt: '2026-09-15T00:00:00.000Z' } },
  })
  assert.equal(result[0]!.kind, 'REUSE_EXISTING_REOPENED')
})

test('COMPLETED LIST: a plain APPROVE (not REOPEN/REPLACE_CONCEPT) never unblocks a completed list, however substantive the text', () => {
  const lookups: M9ExistingListLookup[] = [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'COMPLETED' } }]
  const result = resolveM9CompletedListHandling({
    lookups,
    operatorDecisionsByConceptId: { c1: { resolutionAction: 'APPROVE', decisionText: 'This is a long, careful, substantive review of the concept and I approve it fully.', decidedBy: 'jerry', decidedAt: '2026-09-15T00:00:00.000Z' } },
  })
  assert.equal(result[0]!.kind, 'BLOCKED_NEEDS_REOPEN', 'only REOPEN/REPLACE_CONCEPT satisfy a completed-list block — a plain APPROVE never does, mirroring evaluateItemForListMembership\'s own reopened-must-be-true guardrail')
})

test('COMPLETED LIST: a genuinely new concept never reuses an unrelated old list UUID', () => {
  const lookups: M9ExistingListLookup[] = [{ conceptId: 'c-new', existingList: null }]
  const result = resolveM9CompletedListHandling({ lookups, operatorDecisionsByConceptId: {} })
  assert.equal(result[0]!.kind, 'CREATE_NEW')
  assert.equal(result[0]!.listId, null, 'CREATE_NEW must never carry any list id at all — never an unrelated old UUID reused by accident')
})

test('COMPLETED LIST: a partial reopen affects only the targeted concept/list, not unrelated ones', () => {
  const lookups: M9ExistingListLookup[] = [
    { conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'COMPLETED' } },
    { conceptId: 'c2', existingList: { listId: 'list-2', title: 'Hidden Gems', status: 'COMPLETED' } },
  ]
  const result = resolveM9CompletedListHandling({
    lookups,
    operatorDecisionsByConceptId: { c1: { resolutionAction: 'REOPEN', decisionText: 'Reopening only After Dark.', decidedBy: 'jerry', decidedAt: '2026-09-15T00:00:00.000Z' } },
  })
  const c1 = result.find((r) => r.conceptId === 'c1')!
  const c2 = result.find((r) => r.conceptId === 'c2')!
  assert.equal(c1.kind, 'REUSE_EXISTING_REOPENED')
  assert.equal(c2.kind, 'BLOCKED_NEEDS_REOPEN', 'the unreopened Hidden Gems list must remain blocked — reopening one list must never implicitly reopen another')
})

test('COMPLETED LIST: repeated execution with the same input is idempotent', () => {
  const lookups: M9ExistingListLookup[] = [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'ACTIVE' } }]
  const result1 = resolveM9CompletedListHandling({ lookups, operatorDecisionsByConceptId: {} })
  const result2 = resolveM9CompletedListHandling({ lookups, operatorDecisionsByConceptId: {} })
  assert.deepEqual(result1, result2)
})
