import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateAuthority, mayActWithoutJerry, UnknownAuthorityOperationError, STANDING_AUTHORITY, AUTO_TELL_ACTIVE } from './standingAuthority'

test('AUTO operations may act without Jerry', () => {
  const result = evaluateAuthority('business_outreach.classify_response')
  assert.equal(result.level, 'AUTO')
  assert.equal(result.mayActWithoutJerry, true)
})

test('APPROVAL_REQUIRED operations may never act without Jerry', () => {
  const result = evaluateAuthority('business_outreach.approve_reject_photo')
  assert.equal(result.level, 'APPROVAL_REQUIRED')
  assert.equal(result.mayActWithoutJerry, false)
})

test('AUTO_TELL is designed but not activated — resolves to may-not-act while AUTO_TELL_ACTIVE is false', () => {
  assert.equal(AUTO_TELL_ACTIVE, false, 'this must stay false until Jerry explicitly activates it')
  const result = evaluateAuthority('business_outreach.send_photo_received_ack')
  assert.equal(result.level, 'AUTO_TELL')
  assert.equal(result.mayActWithoutJerry, false)
})

test('mayActWithoutJerry is a convenience wrapper returning the same answer', () => {
  assert.equal(mayActWithoutJerry('business_outreach.classify_response'), true)
  assert.equal(mayActWithoutJerry('business_outreach.approve_reject_photo'), false)
})

test('an unregistered operation throws rather than defaulting to any level', () => {
  assert.throws(() => evaluateAuthority('totally_made_up_operation'), UnknownAuthorityOperationError)
})

test('outbound email always requires approval — never AUTO or AUTO_TELL', () => {
  assert.equal(STANDING_AUTHORITY['business_outreach.send_outbound_email'], 'APPROVAL_REQUIRED')
})

test('secret-item exceptions always require approval', () => {
  assert.equal(STANDING_AUTHORITY['business_outreach.secret_item_exception'], 'APPROVAL_REQUIRED')
})

test('every registered operation has exactly one of the three defined levels', () => {
  const valid = new Set(['AUTO', 'AUTO_TELL', 'APPROVAL_REQUIRED'])
  for (const [op, level] of Object.entries(STANDING_AUTHORITY)) {
    assert.ok(valid.has(level), `operation ${op} has an invalid level ${level}`)
  }
})

test('destructive DB operations and public rollout are approval-required', () => {
  assert.equal(STANDING_AUTHORITY['operational.destructive_db_operation'], 'APPROVAL_REQUIRED')
  assert.equal(STANDING_AUTHORITY['operational.public_global_feature_rollout'], 'APPROVAL_REQUIRED')
})
