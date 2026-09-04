import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertDelegationAuthorized, validateResultEnvelope, buildDelegationRequest, ownerKeyFor } from './delegation'
import { UnknownAuthorityOperationError } from '../playbooks/standingAuthority'
import type { SpecialistResultEnvelope } from './types'

function envelope(overrides: Partial<SpecialistResultEnvelope> = {}): SpecialistResultEnvelope {
  return {
    taskId: 'task-1',
    objective: 'research Sports category gap',
    actionsPerformed: ['searched local sports venues'],
    evidence: { candidateCount: 5 },
    artifacts: [],
    confidence: 'MEDIUM',
    blockers: [],
    discoveredFollowUpWork: [],
    recommendedNextAction: 'recount category coverage',
    jerryRequired: false,
    jerryReason: null,
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    ...overrides,
  }
}

test('assertDelegationAuthorized: throws for an unregistered operation', () => {
  assert.throws(() => assertDelegationAuthorized('totally_unregistered_op'), UnknownAuthorityOperationError)
})

test('assertDelegationAuthorized: does not throw for a registered AUTO operation', () => {
  assert.doesNotThrow(() => assertDelegationAuthorized('metro_launch.research'))
})

// ---------------------------------------------------------------------------
// Result/evidence envelope validation
// ---------------------------------------------------------------------------

test('validateResultEnvelope: valid envelope with all required evidence passes', () => {
  const request = buildDelegationRequest('metro_builder', 'metro_launch', 'M4_COVERAGE_AUDIT', 'count categories', {}, ['candidateCount'], 'metro_launch', 'v1')
  const result = validateResultEnvelope(request, envelope())
  assert.equal(result.valid, true)
  assert.deepEqual(result.missingEvidenceKeys, [])
})

test('validateResultEnvelope: missing required evidence key fails', () => {
  const request = buildDelegationRequest('metro_builder', 'metro_launch', 'M4_COVERAGE_AUDIT', 'count categories', {}, ['candidateCount', 'neighborhoodCounts'], 'metro_launch', 'v1')
  const result = validateResultEnvelope(request, envelope())
  assert.equal(result.valid, false)
  assert.deepEqual(result.missingEvidenceKeys, ['neighborhoodCounts'])
})

test('validateResultEnvelope: an empty-string or empty-array evidence value counts as missing, never a fabricated pass', () => {
  const request = buildDelegationRequest('research_verifier', 'metro_launch', 'M6', 'verify', {}, ['closureFindings'], 'metro_launch', 'v1')
  const badEmptyString = validateResultEnvelope(request, envelope({ evidence: { closureFindings: '' } }))
  const badEmptyArray = validateResultEnvelope(request, envelope({ evidence: { closureFindings: [] } }))
  assert.equal(badEmptyString.valid, false)
  assert.equal(badEmptyArray.valid, false)
})

test('validateResultEnvelope: jerryRequired=true with no jerryReason is invalid — Chief never escalates without a stated reason', () => {
  const request = buildDelegationRequest('destination_strategist', 'destination_hub_lifecycle', 'D2_DVA1', 'screen', {}, [], 'destination/dva1', 'v1')
  const result = validateResultEnvelope(request, envelope({ jerryRequired: true, jerryReason: null, methodologyId: 'destination/dva1', methodologyVersion: 'v1' }))
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('jerryReason')))
})

test('validateResultEnvelope: jerryRequired=true with a real reason is valid', () => {
  const request = buildDelegationRequest('destination_strategist', 'destination_hub_lifecycle', 'D2_DVA1', 'screen', {}, [], 'destination/dva1', 'v1')
  const result = validateResultEnvelope(request, envelope({ jerryRequired: true, jerryReason: 'DVA-1 never auto-advances to DVA-2', methodologyId: 'destination/dva1', methodologyVersion: 'v1' }))
  assert.equal(result.valid, true)
})

test('validateResultEnvelope: jerryReason set while jerryRequired is false is an inconsistent envelope, rejected', () => {
  const request = buildDelegationRequest('metro_builder', 'metro_launch', 'M4', 'audit', {}, [], 'metro_launch', 'v1')
  const result = validateResultEnvelope(request, envelope({ jerryRequired: false, jerryReason: 'why is this here' }))
  assert.equal(result.valid, false)
})

test('validateResultEnvelope: empty taskId/objective is invalid — idempotent identification requires both', () => {
  const request = buildDelegationRequest('metro_builder', 'metro_launch', 'M4', 'audit', {}, [], 'metro_launch', 'v1')
  const result = validateResultEnvelope(request, envelope({ taskId: '' }))
  assert.equal(result.valid, false)
})

// ---------------------------------------------------------------------------
// Specialist assignment / owner resolution
// ---------------------------------------------------------------------------

test('ownerKeyFor: every specialist resolves to its own distinct real owner key', () => {
  const keys = (['metro_builder', 'research_verifier', 'business_outreach', 'destination_strategist', 'destination_activation'] as const).map(ownerKeyFor)
  assert.equal(new Set(keys).size, 5)
})

test('buildDelegationRequest: idempotent — same inputs produce a structurally identical request', () => {
  const a = buildDelegationRequest('metro_builder', 'metro_launch', 'M3_BROAD_DISCOVERY', 'research food category', { metro: 'San Diego' }, ['candidates'], 'metro_launch', 'v1')
  const b = buildDelegationRequest('metro_builder', 'metro_launch', 'M3_BROAD_DISCOVERY', 'research food category', { metro: 'San Diego' }, ['candidates'], 'metro_launch', 'v1')
  assert.deepEqual(a, b)
})
