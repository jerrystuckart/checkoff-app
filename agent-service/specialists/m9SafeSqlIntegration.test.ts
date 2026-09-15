// Session 3, Phase 5 — safe SQL integration tests. No generated SQL is
// ever executed here (or anywhere in this codebase's test suite) — every
// assertion is against the returned string/status, never a live DB call.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildM9SafeSqlPlan } from './m9SafeSqlIntegration'
import type { M9EnforcedCurationArtifact, M9EnforcedConceptVerdict } from './m9EnforcedTypes'

function makeVerdict(overrides: Partial<M9EnforcedConceptVerdict> & Pick<M9EnforcedConceptVerdict, 'conceptId' | 'proposedTitle'>): M9EnforcedConceptVerdict {
  return {
    conceptKey: 'tag',
    fingerprint: 'fp',
    seedTags: ['tag'],
    listKind: 'THEMED',
    discoveryVerdict: 'CREATE',
    approvalState: 'APPROVED',
    memberDecisions: [],
    exclusionReasons: [],
    overlapFindings: [],
    duplicateFindings: [],
    ...overrides,
  }
}

function makeArtifact(conceptVerdicts: M9EnforcedConceptVerdict[], finalApprovedMemberships: Record<string, string[]>): M9EnforcedCurationArtifact {
  return {
    mode: 'ENFORCED',
    artifactVersion: 2,
    inputCatalogFingerprint: 'catalog-fp',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    conceptVerdicts,
    finalApprovedMemberships,
    requiredDecisions: [],
    validation: { ok: true, errors: [] },
    result: { kind: 'READY', approvedConceptIds: Object.keys(finalApprovedMemberships), comparedAgainstLegacyListTitles: [] },
  }
}

const bodyByName = new Map([
  ["Pusser's New York Bar", "Order the Painkiller at Pusser's New York Bar."],
  ["Schumann's", "Ask for the house classic at Schumann's."],
])

test('SAFE SQL: a real, clean two-item list against an existing ACTIVE production list generates SQL', () => {
  const artifact = makeArtifact(
    [makeVerdict({ conceptId: 'c1', proposedTitle: 'After Dark' })],
    { c1: ["Pusser's New York Bar", "Schumann's"] }
  )
  const result = buildM9SafeSqlPlan({
    artifact,
    metroSlug: 'test-metro',
    metroId: 'metro-a',
    itemResolutions: [
      { candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: true, metroId: 'metro-a' },
      { candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-a' },
    ],
    listLookups: [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'ACTIVE' } }],
    operatorDecisionsByConceptId: {},
    itemBodyByCandidateName: bodyByName,
  })
  assert.equal(result.ok, true)
  assert.equal(result.perListOutcomes[0]!.status, 'GENERATED')
  assert.ok(result.combinedSql)
  assert.match(result.combinedSql!, /BEGIN;/)
  assert.match(result.combinedSql!, /11111111-1111-1111-1111-111111111111/)
  assert.match(result.combinedSql!, /22222222-2222-2222-2222-222222222222/)
  assert.equal(result.perListOutcomes[0]!.expectedMembershipCount, 2)
})

test('SAFE SQL: zero UUID matches for one item blocks the whole plan (no executable destructive SQL)', () => {
  const artifact = makeArtifact([makeVerdict({ conceptId: 'c1', proposedTitle: 'After Dark' })], { c1: ["Pusser's New York Bar"] })
  const result = buildM9SafeSqlPlan({
    artifact,
    metroSlug: 'test-metro',
    metroId: 'metro-a',
    itemResolutions: [{ candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: [], active: true, metroId: 'metro-a' }],
    listLookups: [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'ACTIVE' } }],
    operatorDecisionsByConceptId: {},
    itemBodyByCandidateName: bodyByName,
  })
  assert.equal(result.ok, false)
  assert.equal(result.combinedSql, null)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_ITEM_RESOLUTION_FAILED')
})

test('SAFE SQL: multiple UUID matches for one item blocks the whole plan', () => {
  const artifact = makeArtifact([makeVerdict({ conceptId: 'c1', proposedTitle: 'After Dark' })], { c1: ["Pusser's New York Bar"] })
  const result = buildM9SafeSqlPlan({
    artifact,
    metroSlug: 'test-metro',
    metroId: 'metro-a',
    itemResolutions: [{ candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: ['a', 'b'], active: true, metroId: 'metro-a' }],
    listLookups: [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'ACTIVE' } }],
    operatorDecisionsByConceptId: {},
    itemBodyByCandidateName: bodyByName,
  })
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_ITEM_RESOLUTION_FAILED')
})

test('SAFE SQL: a missing/inactive item blocks (INACTIVE)', () => {
  const artifact = makeArtifact([makeVerdict({ conceptId: 'c1', proposedTitle: 'After Dark' })], { c1: ["Schumann's"] })
  const result = buildM9SafeSqlPlan({
    artifact,
    metroSlug: 'test-metro',
    metroId: 'metro-a',
    itemResolutions: [{ candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: false, metroId: 'metro-a' }],
    listLookups: [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'ACTIVE' } }],
    operatorDecisionsByConceptId: {},
    itemBodyByCandidateName: bodyByName,
  })
  assert.equal(result.ok, false)
  assert.match(result.perListOutcomes[0]!.errors.join(' '), /INACTIVE|not active/i)
})

test('SAFE SQL: an out-of-metro item blocks', () => {
  const artifact = makeArtifact([makeVerdict({ conceptId: 'c1', proposedTitle: 'After Dark' })], { c1: ["Schumann's"] })
  const result = buildM9SafeSqlPlan({
    artifact,
    metroSlug: 'test-metro',
    metroId: 'metro-a',
    itemResolutions: [{ candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-b' }],
    listLookups: [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'ACTIVE' } }],
    operatorDecisionsByConceptId: {},
    itemBodyByCandidateName: bodyByName,
  })
  assert.equal(result.ok, false)
})

test('SAFE SQL: a genuinely new concept (no existing production list) blocks as BLOCKED_NEW_LIST_NEEDED, never routed through an unsafe create-list path', () => {
  const artifact = makeArtifact([makeVerdict({ conceptId: 'c1', proposedTitle: 'Riverside Walks' })], { c1: ["Schumann's"] })
  const result = buildM9SafeSqlPlan({
    artifact,
    metroSlug: 'test-metro',
    metroId: 'metro-a',
    itemResolutions: [{ candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-a' }],
    listLookups: [{ conceptId: 'c1', existingList: null }],
    operatorDecisionsByConceptId: {},
    itemBodyByCandidateName: bodyByName,
  })
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_NEW_LIST_NEEDED')
  assert.equal(result.perListOutcomes[0]!.sql, null)
})

test('SAFE SQL: a completed, unreopened list blocks as BLOCKED_NEEDS_REOPEN', () => {
  const artifact = makeArtifact([makeVerdict({ conceptId: 'c1', proposedTitle: 'After Dark' })], { c1: ["Schumann's"] })
  const result = buildM9SafeSqlPlan({
    artifact,
    metroSlug: 'test-metro',
    metroId: 'metro-a',
    itemResolutions: [{ candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-a' }],
    listLookups: [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'COMPLETED' } }],
    operatorDecisionsByConceptId: {},
    itemBodyByCandidateName: bodyByName,
  })
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_NEEDS_REOPEN')
})

test('SAFE SQL: duplicate membership (the same item id resolved for two candidate names in one list) is still safely handled — generated SQL de-duplicates, never two rows for one (list_id, item_id) pair', () => {
  const artifact = makeArtifact([makeVerdict({ conceptId: 'c1', proposedTitle: 'After Dark' })], { c1: ["Pusser's New York Bar", "Schumann's"] })
  const result = buildM9SafeSqlPlan({
    artifact,
    metroSlug: 'test-metro',
    metroId: 'metro-a',
    itemResolutions: [
      { candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: true, metroId: 'metro-a' },
      { candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: true, metroId: 'metro-a' },
    ],
    listLookups: [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'ACTIVE' } }],
    operatorDecisionsByConceptId: {},
    itemBodyByCandidateName: bodyByName,
  })
  assert.equal(result.ok, true)
  assert.equal(result.perListOutcomes[0]!.expectedMembershipCount, 1, 'de-duplicated to one real membership row for the one real item')
  assert.ok(result.reusedItemFindings.some((f) => f.kind === 'MULTIPLE_CANDIDATES_SAME_ITEM'))
})

test('SAFE SQL: one blocked concept among several produces NO executable destructive plan for ANY of them (ok is whole-plan, not per-list)', () => {
  const artifact = makeArtifact(
    [makeVerdict({ conceptId: 'c1', proposedTitle: 'After Dark' }), makeVerdict({ conceptId: 'c2', proposedTitle: 'Hidden Gems' })],
    { c1: ["Pusser's New York Bar"], c2: ["Schumann's"] }
  )
  const result = buildM9SafeSqlPlan({
    artifact,
    metroSlug: 'test-metro',
    metroId: 'metro-a',
    itemResolutions: [
      { candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: true, metroId: 'metro-a' },
      { candidateName: "Schumann's", conceptId: 'c2', matchedItemIds: [], active: true, metroId: 'metro-a' },
    ],
    listLookups: [
      { conceptId: 'c1', existingList: { listId: 'list-1', title: 'After Dark', status: 'ACTIVE' } },
      { conceptId: 'c2', existingList: { listId: 'list-2', title: 'Hidden Gems', status: 'ACTIVE' } },
    ],
    operatorDecisionsByConceptId: {},
    itemBodyByCandidateName: bodyByName,
  })
  assert.equal(result.ok, false, 'the whole plan is not ok even though c1 individually resolved cleanly')
  assert.equal(result.combinedSql, null, 'no combined SQL is produced when ANY concept is blocked')
  assert.equal(result.perListOutcomes.find((o) => o.conceptId === 'c1')!.status, 'BLOCKED_ITEM_RESOLUTION_FAILED', 'c1 is reported blocked too, even though its own item resolved fine, because the shared item-validation preflight fails as a whole (Phase 3\'s own "partial pass is not a pass")')
})

test('SAFE SQL: a reopened completed list uses the REAL existing title, not the concept\'s own proposedTitle', () => {
  const artifact = makeArtifact([makeVerdict({ conceptId: 'c1', proposedTitle: 'Draft Title From Tags' })], { c1: ["Schumann's"] })
  const result = buildM9SafeSqlPlan({
    artifact,
    metroSlug: 'test-metro',
    metroId: 'metro-a',
    itemResolutions: [{ candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-a' }],
    listLookups: [{ conceptId: 'c1', existingList: { listId: 'list-1', title: 'The Real Production Title', status: 'COMPLETED' } }],
    operatorDecisionsByConceptId: { c1: { resolutionAction: 'REOPEN', decisionText: 'Refreshing membership.', decidedBy: 'jerry', decidedAt: '2026-09-15T00:00:00.000Z' } },
    itemBodyByCandidateName: bodyByName,
  })
  assert.equal(result.ok, true)
  assert.equal(result.perListOutcomes[0]!.listTitle, 'The Real Production Title')
  assert.match(result.combinedSql!, /The Real Production Title/)
  assert.doesNotMatch(result.combinedSql!, /Draft Title From Tags/)
})
