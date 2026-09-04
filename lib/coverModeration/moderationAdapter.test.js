import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localSanityOnlyAdapter, initialStatusFromAssessment } from './moderationAdapter.js'

test('a well-formed image (positive dimensions, non-zero size) is routed to needs_review, never auto-passed', async () => {
  const assessment = await localSanityOnlyAdapter({ width: 1200, height: 900, fileSizeBytes: 250000 })
  assert.equal(assessment.safetyVerdict, 'needs_review')
  assert.equal(assessment.qualityVerdict, 'needs_review')
})

test('a zero-byte (failed) capture is automated_rejected', async () => {
  const assessment = await localSanityOnlyAdapter({ width: 1200, height: 900, fileSizeBytes: 0 })
  assert.equal(assessment.safetyVerdict, 'reject')
  assert.equal(assessment.qualityVerdict, 'reject')
})

test('zero/negative declared dimensions are treated as malformed', async () => {
  const assessment = await localSanityOnlyAdapter({ width: 0, height: 900, fileSizeBytes: 5000 })
  assert.equal(assessment.safetyVerdict, 'reject')
})

test('missing dimension/size info does not throw and does not falsely reject', async () => {
  const assessment = await localSanityOnlyAdapter({})
  assert.equal(assessment.safetyVerdict, 'needs_review')
})

test('signals never include anything beyond simple booleans/timestamps (no raw vendor payload shape to accidentally leak)', async () => {
  const assessment = await localSanityOnlyAdapter({ width: 100, height: 100, fileSizeBytes: 500 })
  for (const value of Object.values(assessment.signals)) {
    assert.ok(['boolean', 'string'].includes(typeof value))
  }
})

test('initialStatusFromAssessment: a reject verdict (either dimension) maps to automated_rejected', () => {
  assert.equal(initialStatusFromAssessment({ safetyVerdict: 'reject', qualityVerdict: 'needs_review' }), 'automated_rejected')
  assert.equal(initialStatusFromAssessment({ safetyVerdict: 'needs_review', qualityVerdict: 'reject' }), 'automated_rejected')
})

test('initialStatusFromAssessment: needs_review/needs_review maps to needs_review', () => {
  assert.equal(initialStatusFromAssessment({ safetyVerdict: 'needs_review', qualityVerdict: 'needs_review' }), 'needs_review')
})

test('initialStatusFromAssessment never returns approved/cover_eligible/selected -- those require a human decision', () => {
  const possibleInputs = [
    { safetyVerdict: 'pass', qualityVerdict: 'pass' },
    { safetyVerdict: 'needs_review', qualityVerdict: 'pass' },
  ]
  for (const input of possibleInputs) {
    const status = initialStatusFromAssessment(input)
    assert.ok(!['approved', 'cover_eligible', 'selected'].includes(status))
  }
})
