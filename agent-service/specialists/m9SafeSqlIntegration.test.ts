// Session 3, Phase 5 — safe SQL integration tests. No generated SQL is
// ever executed here (or anywhere in this codebase's test suite) — every
// assertion is against the returned string/status, never a live DB call.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildM9SafeSqlPlan } from './m9SafeSqlIntegration'
import { computeM9ListId, type M9EnforcedCurationArtifact, type M9EnforcedConceptVerdict } from './m9EnforcedTypes'

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

const CREATOR_ID = '99999999-9999-9999-9999-999999999999'

function makeApproval(overrides: Partial<M9EnforcedConceptVerdict['operatorDecision']> & { decidedForFingerprint: string }): NonNullable<M9EnforcedConceptVerdict['operatorDecision']> {
  return {
    conceptId: 'c1',
    action: 'CREATE_NEW_LIST_CONCEPT',
    resolutionAction: 'APPROVE',
    decision: 'APPROVED',
    decisionText: 'Reviewed and approved — a real, distinctive metro-specific concept.',
    decidedBy: 'jerry',
    decidedAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  }
}

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

// ---------------------------------------------------------------------------
// Session 4 — safe NEW-LIST creation. Munich's real newly-discovered
// concepts (Beer Gardens, Breweries & Bavarian Rituals; Day Trips & Big
// Adventures) are exactly this shape: a genuinely new list, no existing
// production row, approved concept.
// ---------------------------------------------------------------------------

function newListInput(overrides: Partial<Parameters<typeof buildM9SafeSqlPlan>[0]> = {}) {
  const artifact = makeArtifact(
    [
      makeVerdict({
        conceptId: 'c1',
        proposedTitle: 'Beer Gardens, Breweries & Bavarian Rituals',
        fingerprint: 'fp-beer-gardens',
        operatorDecision: makeApproval({ decidedForFingerprint: 'fp-beer-gardens' }),
      }),
    ],
    { c1: ["Pusser's New York Bar", "Schumann's"] }
  )
  return {
    artifact,
    metroSlug: 'munich',
    metroId: 'metro-munich',
    itemResolutions: [
      { candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: true, metroId: 'metro-munich' },
      { candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-munich' },
    ],
    listLookups: [{ conceptId: 'c1', existingList: null }],
    operatorDecisionsByConceptId: {},
    itemBodyByCandidateName: bodyByName,
    newListCreatorId: CREATOR_ID,
    deterministicListIdLookups: [{ conceptId: 'c1', existingRowAtId: null }],
    ...overrides,
  }
}

test('SAFE SQL: an approved, genuinely new concept with a fresh Jerry approval and clean item resolution creates one safe new-list SQL plan', () => {
  const result = buildM9SafeSqlPlan(newListInput())
  assert.equal(result.ok, true)
  assert.equal(result.perListOutcomes.length, 1)
  assert.equal(result.perListOutcomes[0]!.status, 'GENERATED_NEW_LIST')
  assert.ok(result.perListOutcomes[0]!.sql)
  assert.match(result.perListOutcomes[0]!.sql!, /INSERT INTO public\.lists/)
  assert.match(result.combinedSql!, /Beer Gardens, Breweries & Bavarian Rituals/)
  assert.equal(result.perListOutcomes[0]!.expectedMembershipCount, 2)
})

test('SAFE SQL: rerunning buildM9SafeSqlPlan with the IDENTICAL approved input produces byte-identical SQL — never a second/different list-creation statement', () => {
  const input = newListInput()
  const first = buildM9SafeSqlPlan(input)
  const second = buildM9SafeSqlPlan(input)
  assert.equal(first.combinedSql, second.combinedSql)
  assert.equal(first.perListOutcomes[0]!.status, 'GENERATED_NEW_LIST')
  assert.equal(second.perListOutcomes[0]!.status, 'GENERATED_NEW_LIST')
})

test('SAFE SQL: without newListCreatorId supplied, a genuinely new concept still blocks as BLOCKED_NEW_LIST_NEEDED exactly as before — safe creation is strictly opt-in', () => {
  const input = newListInput({ newListCreatorId: undefined })
  const result = buildM9SafeSqlPlan(input)
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_NEW_LIST_NEEDED')
})

// ---------------------------------------------------------------------------
// Deterministic list identity — Session 4 correction. The generated list
// is identified by computeM9ListId(conceptId), never by title, never by
// (metro_id, title). Every property the correction required, proven
// directly through the real buildM9SafeSqlPlan call path.
// ---------------------------------------------------------------------------

test('IDENTITY: the generated SQL uses computeM9ListId(conceptId) as the list\'s real primary-key identity', () => {
  const result = buildM9SafeSqlPlan(newListInput())
  const expectedId = computeM9ListId('c1')
  assert.match(result.combinedSql!, new RegExp(`v_list_id uuid := '${expectedId}'::uuid;`))
})

test('IDENTITY: the SAME conceptId with CHANGED membership retains the SAME list UUID', () => {
  const withOneMember = buildM9SafeSqlPlan(newListInput())
  const artifactTwoMembers = makeArtifact(
    [makeVerdict({ conceptId: 'c1', proposedTitle: 'Beer Gardens, Breweries & Bavarian Rituals', fingerprint: 'fp-2-members', operatorDecision: makeApproval({ decidedForFingerprint: 'fp-2-members' }) })],
    { c1: ["Pusser's New York Bar", "Schumann's", 'A Third Venue'] }
  )
  const withThreeMembers = buildM9SafeSqlPlan(
    newListInput({
      artifact: artifactTwoMembers,
      itemResolutions: [
        { candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: true, metroId: 'metro-munich' },
        { candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-munich' },
        { candidateName: 'A Third Venue', conceptId: 'c1', matchedItemIds: ['33333333-3333-3333-3333-333333333333'], active: true, metroId: 'metro-munich' },
      ],
    })
  )
  const expectedId = computeM9ListId('c1')
  assert.match(withOneMember.combinedSql!, new RegExp(`v_list_id uuid := '${expectedId}'::uuid;`))
  assert.match(withThreeMembers.combinedSql!, new RegExp(`v_list_id uuid := '${expectedId}'::uuid;`))
  assert.equal(withThreeMembers.perListOutcomes[0]!.expectedMembershipCount, 3)
})

test('IDENTITY: the SAME conceptId with a CHANGED proposed title retains the SAME list UUID', () => {
  const renamedArtifact = makeArtifact(
    [makeVerdict({ conceptId: 'c1', proposedTitle: 'Beer Gardens & Breweries (renamed)', fingerprint: 'fp-beer-gardens', operatorDecision: makeApproval({ decidedForFingerprint: 'fp-beer-gardens' }) })],
    { c1: ["Pusser's New York Bar", "Schumann's"] }
  )
  const result = buildM9SafeSqlPlan(newListInput({ artifact: renamedArtifact }))
  const expectedId = computeM9ListId('c1')
  assert.equal(result.ok, true)
  assert.match(result.combinedSql!, new RegExp(`v_list_id uuid := '${expectedId}'::uuid;`))
  assert.match(result.combinedSql!, /'Beer Gardens & Breweries \(renamed\)'/)
  assert.match(result.combinedSql!, /ON CONFLICT \(id\) DO UPDATE SET title = EXCLUDED\.title;/, 'the rename is applied via an in-place update on the SAME row, never a new list')
})

test('IDENTITY: DIFFERENT conceptIds proposing the IDENTICAL title receive DIFFERENT list UUIDs — never derived from title', () => {
  const artifact = makeArtifact(
    [
      makeVerdict({ conceptId: 'concept-one', proposedTitle: 'Day Trips & Big Adventures', fingerprint: 'fp-one', operatorDecision: makeApproval({ conceptId: 'concept-one', decidedForFingerprint: 'fp-one' }) }),
      makeVerdict({ conceptId: 'concept-two', proposedTitle: 'Day Trips & Big Adventures', fingerprint: 'fp-two', operatorDecision: makeApproval({ conceptId: 'concept-two', decidedForFingerprint: 'fp-two' }) }),
    ],
    { 'concept-one': ["Pusser's New York Bar"], 'concept-two': ["Schumann's"] }
  )
  const result = buildM9SafeSqlPlan(
    newListInput({
      artifact,
      itemResolutions: [
        { candidateName: "Pusser's New York Bar", conceptId: 'concept-one', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: true, metroId: 'metro-munich' },
        { candidateName: "Schumann's", conceptId: 'concept-two', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-munich' },
      ],
      listLookups: [
        { conceptId: 'concept-one', existingList: null },
        { conceptId: 'concept-two', existingList: null },
      ],
      deterministicListIdLookups: [
        { conceptId: 'concept-one', existingRowAtId: null },
        { conceptId: 'concept-two', existingRowAtId: null },
      ],
    })
  )
  assert.equal(result.ok, true)
  const idOne = computeM9ListId('concept-one')
  const idTwo = computeM9ListId('concept-two')
  assert.notEqual(idOne, idTwo)
  const outcomeOne = result.perListOutcomes.find((o) => o.conceptId === 'concept-one')!
  const outcomeTwo = result.perListOutcomes.find((o) => o.conceptId === 'concept-two')!
  assert.match(outcomeOne.sql!, new RegExp(idOne))
  assert.match(outcomeTwo.sql!, new RegExp(idTwo))
  assert.equal(outcomeOne.sql!.includes(idTwo), false)
  assert.equal(outcomeTwo.sql!.includes(idOne), false)
})

test('IDENTITY: an existing row already at the deterministic id but belonging to an UNRELATED METRO blocks before any executable SQL exists', () => {
  const result = buildM9SafeSqlPlan(
    newListInput({
      deterministicListIdLookups: [{ conceptId: 'c1', existingRowAtId: { metroSlug: 'denver', title: 'Some Unrelated Denver List', isOfficial: true } }],
    })
  )
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_NEW_LIST_ID_CONFLICT')
  assert.equal(result.perListOutcomes[0]!.sql, null)
  assert.ok(result.perListOutcomes[0]!.errors.some((e) => e.includes('denver')))
})

test('IDENTITY: an existing NON-OFFICIAL row already at the deterministic id (an incompatible list) blocks before any executable SQL exists, even in the SAME metro', () => {
  const result = buildM9SafeSqlPlan(
    newListInput({
      deterministicListIdLookups: [{ conceptId: 'c1', existingRowAtId: { metroSlug: 'munich', title: 'Some Ad-Hoc User List', isOfficial: false } }],
    })
  )
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_NEW_LIST_ID_CONFLICT')
  assert.equal(result.perListOutcomes[0]!.sql, null)
})

test('IDENTITY: an existing row at the deterministic id that IS the same metro and IS official is safe to reconcile — not a conflict (the ordinary idempotent-rerun case)', () => {
  const result = buildM9SafeSqlPlan(
    newListInput({
      deterministicListIdLookups: [{ conceptId: 'c1', existingRowAtId: { metroSlug: 'munich', title: 'Beer Gardens, Breweries & Bavarian Rituals', isOfficial: true } }],
    })
  )
  assert.equal(result.ok, true)
  assert.equal(result.perListOutcomes[0]!.status, 'GENERATED_NEW_LIST')
})

test('IDENTITY: no deterministicListIdLookups entry supplied at all for a CREATE_NEW concept fails closed — never silently assumed clear', () => {
  const result = buildM9SafeSqlPlan(newListInput({ deterministicListIdLookups: [] }))
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_NEW_LIST_ID_CONFLICT')
  assert.equal(result.perListOutcomes[0]!.sql, null)
})

test('SAFE SQL: a MISSING item (zero production matches) blocks new-list creation before any executable SQL exists', () => {
  const input = newListInput({
    itemResolutions: [
      { candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: [], active: true, metroId: 'metro-munich' },
      { candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-munich' },
    ],
  })
  const result = buildM9SafeSqlPlan(input)
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_ITEM_RESOLUTION_FAILED')
  assert.equal(result.perListOutcomes[0]!.sql, null)
})

test('SAFE SQL: an INACTIVE item blocks new-list creation before any executable SQL exists', () => {
  const input = newListInput({
    itemResolutions: [
      { candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: false, metroId: 'metro-munich' },
      { candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-munich' },
    ],
  })
  const result = buildM9SafeSqlPlan(input)
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_ITEM_RESOLUTION_FAILED')
  assert.equal(result.perListOutcomes[0]!.sql, null)
})

test('SAFE SQL: an OUT-OF-METRO item blocks new-list creation before any executable SQL exists', () => {
  const input = newListInput({
    itemResolutions: [
      { candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: true, metroId: 'metro-DIFFERENT' },
      { candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-munich' },
    ],
  })
  const result = buildM9SafeSqlPlan(input)
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_ITEM_RESOLUTION_FAILED')
  assert.equal(result.perListOutcomes[0]!.sql, null)
})

test('SAFE SQL: DUPLICATE membership (two candidate names resolving to the same real item) is safe and non-blocking for new-list creation — de-duplicated, never two rows for one (list_id, item_id) pair', () => {
  const input = newListInput({
    itemResolutions: [
      { candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: true, metroId: 'metro-munich' },
      { candidateName: "Schumann's", conceptId: 'c1', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: true, metroId: 'metro-munich' },
    ],
  })
  const result = buildM9SafeSqlPlan(input)
  assert.equal(result.ok, true)
  assert.equal(result.perListOutcomes[0]!.expectedMembershipCount, 1)
  const occurrences = (result.combinedSql!.match(/11111111-1111-1111-1111-111111111111/g) ?? []).length
  assert.equal(occurrences, 1)
})

test('SAFE SQL: an unresolved DUPLICATE-VENUE finding on the concept blocks new-list creation, even though the concept itself is approved', () => {
  const artifact = makeArtifact(
    [
      makeVerdict({
        conceptId: 'c1',
        proposedTitle: 'Beer Gardens, Breweries & Bavarian Rituals',
        fingerprint: 'fp-beer-gardens',
        operatorDecision: makeApproval({ decidedForFingerprint: 'fp-beer-gardens' }),
        duplicateFindings: [{ kind: 'DUPLICATE_VENUE', detail: 'Two candidates resolve to the same real venue.', affectedItemIds: ['11111111-1111-1111-1111-111111111111'] }],
      }),
    ],
    { c1: ["Pusser's New York Bar", "Schumann's"] }
  )
  const result = buildM9SafeSqlPlan(newListInput({ artifact }))
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_NEW_LIST_APPROVAL_INVALID')
  assert.equal(result.perListOutcomes[0]!.sql, null)
  assert.ok(result.perListOutcomes[0]!.errors.some((e) => e.includes('duplicate-venue')))
})

test('SAFE SQL: a STALE approval (operator decision recorded against an old fingerprint, concept has since changed) blocks new-list creation before any executable SQL exists', () => {
  const artifact = makeArtifact(
    [
      makeVerdict({
        conceptId: 'c1',
        proposedTitle: 'Beer Gardens, Breweries & Bavarian Rituals',
        fingerprint: 'fp-CURRENT',
        operatorDecision: makeApproval({ decidedForFingerprint: 'fp-OLD-STALE' }),
      }),
    ],
    { c1: ["Pusser's New York Bar", "Schumann's"] }
  )
  const result = buildM9SafeSqlPlan(newListInput({ artifact }))
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_NEW_LIST_APPROVAL_INVALID')
  assert.equal(result.perListOutcomes[0]!.sql, null)
  assert.ok(result.perListOutcomes[0]!.errors.some((e) => e.includes('stale')))
})

test('SAFE SQL: an unresolved HOLD (no operator decision on record at all) blocks new-list creation before any executable SQL exists', () => {
  const artifact = makeArtifact(
    [
      makeVerdict({
        conceptId: 'c1',
        proposedTitle: 'Day Trips & Big Adventures',
        fingerprint: 'fp-day-trips',
        approvalState: 'HOLD',
        operatorDecision: undefined,
      }),
    ],
    // Structurally shouldn't happen in a real artifact (HOLD concepts never
    // reach finalApprovedMemberships), but this module re-checks anyway —
    // defense in depth, same discipline as conceptsWithUnresolvedDuplicates.
    { c1: ["Pusser's New York Bar", "Schumann's"] }
  )
  const result = buildM9SafeSqlPlan(newListInput({ artifact }))
  assert.equal(result.ok, false)
  assert.equal(result.perListOutcomes[0]!.status, 'BLOCKED_NEW_LIST_APPROVAL_INVALID')
  assert.equal(result.perListOutcomes[0]!.sql, null)
  assert.ok(result.perListOutcomes[0]!.errors.some((e) => e.includes('APPROVED')))
  assert.ok(result.perListOutcomes[0]!.errors.some((e) => e.includes('No operator decision')))
})

test("SAFE SQL: real Pusser's / Schumann's apostrophes stay safe through the whole new-list plan — title AND item labels never break the generated SQL", () => {
  const artifact = makeArtifact(
    [makeVerdict({ conceptId: 'c1', proposedTitle: "Pusser's & Schumann's After Dark", fingerprint: 'fp-apostrophes', operatorDecision: makeApproval({ decidedForFingerprint: 'fp-apostrophes' }) })],
    { c1: ["Pusser's New York Bar", "Schumann's"] }
  )
  const result = buildM9SafeSqlPlan(newListInput({ artifact }))
  assert.equal(result.ok, true)
  assert.match(result.combinedSql!, /'Pusser''s & Schumann''s After Dark'/)
  assert.equal(result.combinedSql!.includes("Pusser's &"), false, 'an undoubled apostrophe must never appear in the generated SQL')
})

test('SAFE SQL: a mix of one BLOCKED and one clean new-list concept fails the WHOLE plan — no partial/executable SQL for either', () => {
  const artifact = makeArtifact(
    [
      makeVerdict({ conceptId: 'c1', proposedTitle: 'Beer Gardens, Breweries & Bavarian Rituals', fingerprint: 'fp-1', operatorDecision: makeApproval({ conceptId: 'c1', decidedForFingerprint: 'fp-1' }) }),
      makeVerdict({ conceptId: 'c2', proposedTitle: 'Day Trips & Big Adventures', fingerprint: 'fp-2', operatorDecision: undefined }),
    ],
    { c1: ["Pusser's New York Bar"], c2: ["Schumann's"] }
  )
  const result = buildM9SafeSqlPlan(
    newListInput({
      artifact,
      itemResolutions: [
        { candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: ['11111111-1111-1111-1111-111111111111'], active: true, metroId: 'metro-munich' },
        { candidateName: "Schumann's", conceptId: 'c2', matchedItemIds: ['22222222-2222-2222-2222-222222222222'], active: true, metroId: 'metro-munich' },
      ],
      listLookups: [
        { conceptId: 'c1', existingList: null },
        { conceptId: 'c2', existingList: null },
      ],
      deterministicListIdLookups: [
        { conceptId: 'c1', existingRowAtId: null },
        { conceptId: 'c2', existingRowAtId: null },
      ],
    })
  )
  assert.equal(result.ok, false, 'one blocked concept must fail the whole plan, per this module\'s own "one blocked concept blocks the whole plan" rule')
  const c1Outcome = result.perListOutcomes.find((o) => o.conceptId === 'c1')!
  const c2Outcome = result.perListOutcomes.find((o) => o.conceptId === 'c2')!
  assert.equal(c1Outcome.status, 'GENERATED_NEW_LIST', 'c1 individually would have succeeded')
  assert.equal(c2Outcome.status, 'BLOCKED_NEW_LIST_APPROVAL_INVALID')
  assert.equal(result.combinedSql, null, 'no executable SQL exists for EITHER concept while the plan is not ok')
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
