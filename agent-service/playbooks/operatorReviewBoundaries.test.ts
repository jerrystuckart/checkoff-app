import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateOperatorReviewBoundary, actionsRequiringApproval, actionsThatMustNeverRequireApproval, type OperatorReviewAction } from './operatorReviewBoundaries'

const ALL_REQUIRE_APPROVAL: OperatorReviewAction[] = [
  'CREATE_NEW_LIST_CONCEPT',
  'REMOVE_OR_REPLACE_COMPLETED_LIST',
  'CONCEPT_WITH_SUBSTANTIAL_OVERLAP',
  'LIST_NEEDS_WEAK_ITEMS_TO_MEET_PREFERRED_SIZE',
  'UNSUPPORTED_SECRET_DESIGNATION',
  'MARKET_BOUNDARY_EXCEPTION',
  'REOPEN_COMPLETED_METRO',
  'AMBIGUOUS_DIFFICULTY_10_OR_25',
]

for (const action of ALL_REQUIRE_APPROVAL) {
  test(`evaluateOperatorReviewBoundary: ${action} requires Jerry's approval, with a real reason`, () => {
    const decision = evaluateOperatorReviewBoundary(action)
    assert.equal(decision.requiresApproval, true)
    assert.ok(decision.reason.length > 20)
  })
}

test('evaluateOperatorReviewBoundary: routine candidate scoring does NOT require approval — verified as real behavior, not just documented', () => {
  const decision = evaluateOperatorReviewBoundary('ROUTINE_CANDIDATE_SCORING')
  assert.equal(decision.requiresApproval, false)
})

test('evaluateOperatorReviewBoundary: routine report generation does NOT require approval', () => {
  const decision = evaluateOperatorReviewBoundary('ROUTINE_REPORT_GENERATION')
  assert.equal(decision.requiresApproval, false)
})

test('evaluateOperatorReviewBoundary: routine list-fit scoring does NOT require approval', () => {
  const decision = evaluateOperatorReviewBoundary('ROUTINE_LIST_FIT_SCORING')
  assert.equal(decision.requiresApproval, false)
})

test('actionsRequiringApproval: matches exactly the 8 actions named in the Phase 5 spec, no more, no fewer', () => {
  const result = actionsRequiringApproval().sort()
  assert.deepEqual(result, [...ALL_REQUIRE_APPROVAL].sort())
})

test('actionsThatMustNeverRequireApproval: every listed action is independently confirmed to not require approval', () => {
  for (const action of actionsThatMustNeverRequireApproval()) {
    assert.equal(evaluateOperatorReviewBoundary(action).requiresApproval, false, `${action} must never require approval`)
  }
})

test('evaluateOperatorReviewBoundary: every approval-required decision names the existing driver mechanism it ties into (never invents a new mechanism from scratch)', () => {
  for (const action of ALL_REQUIRE_APPROVAL) {
    const decision = evaluateOperatorReviewBoundary(action)
    assert.ok(decision.tiesIntoExistingMechanism, `${action} should name an existing mechanism`)
  }
})
