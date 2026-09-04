import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertRelationshipTransitionAllowed,
  coarseStatusForRelationshipStage,
  requiredAssetLevel,
  isolateContactContext,
  verifyAuthorityCoverage,
  RELATIONSHIP_TRANSITIONS,
  type DestinationContactContext,
} from './destinationRelationship'

// ---------------------------------------------------------------------------
// Non-linear transitions — real sales relationships jump around
// ---------------------------------------------------------------------------

test('ENGAGED -> ASSETS_PREP is allowed (a reply asks for a one-pager mid-relationship)', () => {
  assert.doesNotThrow(() => assertRelationshipTransitionAllowed('ENGAGED', 'ASSETS_PREP'))
})

test('WAITING_FOR_REPLY -> FOLLOW_UP is allowed (no reply after the wait window, never silently dropped)', () => {
  assert.doesNotThrow(() => assertRelationshipTransitionAllowed('WAITING_FOR_REPLY', 'FOLLOW_UP'))
})

test('PROPOSAL -> FOLLOW_UP is allowed (proposal requires revision) and FOLLOW_UP -> PROPOSAL is allowed to resume it', () => {
  assert.doesNotThrow(() => assertRelationshipTransitionAllowed('PROPOSAL', 'FOLLOW_UP'))
  assert.doesNotThrow(() => assertRelationshipTransitionAllowed('FOLLOW_UP', 'PROPOSAL'))
})

test('MEETING_COMPLETE -> MATERIAL_REQUESTED is allowed (a meeting creates a new stakeholder needing fresh material)', () => {
  assert.doesNotThrow(() => assertRelationshipTransitionAllowed('MEETING_COMPLETE', 'MATERIAL_REQUESTED'))
})

test('an arbitrary illegal jump (RELATIONSHIP_READY -> ACTIVATION) is rejected — non-linear is not unbounded', () => {
  assert.throws(() => assertRelationshipTransitionAllowed('RELATIONSHIP_READY', 'ACTIVATION'))
})

test('ACTIVATION is terminal — no outgoing transitions', () => {
  assert.deepEqual(RELATIONSHIP_TRANSITIONS.ACTIVATION, [])
})

test('FOLLOW_UP is the real catch-all hub — reachable from and to most active stages', () => {
  assert.ok(RELATIONSHIP_TRANSITIONS.WAITING_FOR_REPLY.includes('FOLLOW_UP'))
  assert.ok(RELATIONSHIP_TRANSITIONS.FOLLOW_UP.includes('ENGAGED'))
  assert.ok(RELATIONSHIP_TRANSITIONS.FOLLOW_UP.includes('MEETING_REQUESTED'))
})

// ---------------------------------------------------------------------------
// Meeting escalation to Jerry
// ---------------------------------------------------------------------------

test('MEETING_REQUESTED requires Jerry — creating a meeting needs his availability/choice', () => {
  assert.equal(coarseStatusForRelationshipStage('MEETING_REQUESTED'), 'NEEDS_JERRY')
})

test('PROPOSAL/NEGOTIATION/COMMITMENT all require Jerry — pricing/commercial/commitment', () => {
  assert.equal(coarseStatusForRelationshipStage('PROPOSAL'), 'NEEDS_JERRY')
  assert.equal(coarseStatusForRelationshipStage('NEGOTIATION'), 'NEEDS_JERRY')
  assert.equal(coarseStatusForRelationshipStage('COMMITMENT'), 'NEEDS_JERRY')
})

test('INITIAL_OUTREACH requires Jerry — sending is APPROVAL_REQUIRED until AUTO_TELL is activated', () => {
  assert.equal(coarseStatusForRelationshipStage('INITIAL_OUTREACH'), 'NEEDS_JERRY')
})

// ---------------------------------------------------------------------------
// Temporal WAIT/resume — reuses the existing WAITING+nextCheckAt model
// (no new concept; verified here at the stage-mapping level)
// ---------------------------------------------------------------------------

test('WAITING_FOR_REPLY and FOLLOW_UP are both WAITING — a legitimate external wait, resumable via nextCheckAt', () => {
  assert.equal(coarseStatusForRelationshipStage('WAITING_FOR_REPLY'), 'WAITING')
  assert.equal(coarseStatusForRelationshipStage('FOLLOW_UP'), 'WAITING')
})

test('MEETING_SCHEDULED is WAITING (for the meeting date), not IN_PROGRESS', () => {
  assert.equal(coarseStatusForRelationshipStage('MEETING_SCHEDULED'), 'WAITING')
})

// ---------------------------------------------------------------------------
// Sales asset level progression — never ahead of qualification
// ---------------------------------------------------------------------------

test('requiredAssetLevel: early stages need only the outreach message', () => {
  assert.equal(requiredAssetLevel('RELATIONSHIP_READY', false), 'LEVEL_0_OUTREACH_MESSAGE')
  assert.equal(requiredAssetLevel('WAITING_FOR_REPLY', false), 'LEVEL_0_OUTREACH_MESSAGE')
})

test('requiredAssetLevel: ENGAGED/MATERIAL_REQUESTED need the one-pager', () => {
  assert.equal(requiredAssetLevel('ENGAGED', false), 'LEVEL_1_ONE_PAGER')
  assert.equal(requiredAssetLevel('MATERIAL_REQUESTED', false), 'LEVEL_1_ONE_PAGER')
})

test('requiredAssetLevel: meeting stages need supporting visuals', () => {
  assert.equal(requiredAssetLevel('MEETING_SCHEDULED', false), 'LEVEL_2_VISUALS')
})

test('requiredAssetLevel: PROPOSAL without a qualified DAP does NOT jump to the full pitch deck — never ahead of qualification', () => {
  assert.equal(requiredAssetLevel('PROPOSAL', false), 'LEVEL_2_VISUALS')
})

test('requiredAssetLevel: PROPOSAL WITH a qualified DAP unlocks the full pitch deck', () => {
  assert.equal(requiredAssetLevel('PROPOSAL', true), 'LEVEL_3_PITCH_DECK')
})

// ---------------------------------------------------------------------------
// Contact identity isolation
// ---------------------------------------------------------------------------

test('isolateContactContext: finds the correct context for a (destination, contact) pair', () => {
  const contexts: DestinationContactContext[] = [
    { destinationId: 'willcox', contactId: 'jane', role: 'Chamber', sentiment: 'POSITIVE', promisesMade: [], introducedBy: null, isChampion: true, isBlocker: false },
    { destinationId: 'buena-vista', contactId: 'jane', role: null, sentiment: 'UNKNOWN', promisesMade: [], introducedBy: null, isChampion: false, isBlocker: false },
  ]
  const result = isolateContactContext(contexts, 'willcox', 'jane')
  assert.equal(result?.isChampion, true)
})

test('isolateContactContext: returns null (not a wrong-destination match) when no context exists for that pair', () => {
  const contexts: DestinationContactContext[] = [
    { destinationId: 'willcox', contactId: 'jane', role: null, sentiment: 'UNKNOWN', promisesMade: [], introducedBy: null, isChampion: false, isBlocker: false },
  ]
  assert.equal(isolateContactContext(contexts, 'grand-lake', 'jane'), null)
})

test('isolateContactContext: throws if the same (destination, contact) pair somehow has two contexts — a real data-integrity bug, never silently picks one', () => {
  const contexts: DestinationContactContext[] = [
    { destinationId: 'willcox', contactId: 'jane', role: 'A', sentiment: 'UNKNOWN', promisesMade: [], introducedBy: null, isChampion: false, isBlocker: false },
    { destinationId: 'willcox', contactId: 'jane', role: 'B', sentiment: 'UNKNOWN', promisesMade: [], introducedBy: null, isChampion: false, isBlocker: false },
  ]
  assert.throws(() => isolateContactContext(contexts, 'willcox', 'jane'))
})

test('destination relationship: every declared authority operation is registered', () => {
  assert.doesNotThrow(() => verifyAuthorityCoverage())
})
