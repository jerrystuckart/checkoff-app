// Session 3 PREREQUISITE 2 — structured evidence-resolution hardening
// tests, exercised directly through runM9EnforcedCuration (no driver
// involved) for tight, fast unit coverage of the resolution rules
// themselves. metroLaunchDriverM9Enforced.test.ts covers the same rules
// end-to-end through the real driveMetroLaunch entry point.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runM9EnforcedCuration } from './m9ListCurationAdapter'
import type { M9AdapterCertifiedItem } from './m9ListCurationAdapter'
import type { M9OperatorDecisionInput } from './m9EnforcedTypes'

function makeItem(i: number, tagged: boolean): M9AdapterCertifiedItem {
  return {
    candidateName: `Venue ${i}`,
    venueName: `Venue ${i}`,
    dbCategory: 'Adventure',
    finalTags: tagged ? ['canal-crawl', `u-${i}`] : [`u-${i}`, `o-${i}`],
    finalBody: `Try the thing at Venue ${i}.`,
    neighborhoodName: 'Downtown',
  }
}

function cleanCatalog(): M9AdapterCertifiedItem[] {
  return Array.from({ length: 40 }, (_, i) => makeItem(i, i < 20))
}

function duplicateCatalog(): M9AdapterCertifiedItem[] {
  const items: M9AdapterCertifiedItem[] = []
  items.push({ candidateName: 'Vereinsheim Pub Quiz', venueName: 'Vereinsheim', dbCategory: 'Adventure', finalTags: ['riverside-walk', 'v-1'], finalBody: 'Join pub quiz.', neighborhoodName: 'Schwabing' })
  items.push({ candidateName: 'Vereinsheim Live Music', venueName: 'Vereinsheim', dbCategory: 'Adventure', finalTags: ['riverside-walk', 'v-2'], finalBody: 'Catch live music.', neighborhoodName: 'Schwabing' })
  for (let i = 0; i < 13; i++) items.push({ candidateName: `Beer Garden ${i}`, venueName: `Beer Garden ${i}`, dbCategory: 'Adventure', finalTags: ['riverside-walk', `bg-${i}`], finalBody: `Enjoy Beer Garden ${i}.`, neighborhoodName: 'Downtown' })
  for (let i = 0; i < 40; i++) items.push({ candidateName: `Filler ${i}`, venueName: `Filler ${i}`, dbCategory: 'Adventure', finalTags: [`filler-${i}`], finalBody: `Filler ${i}.`, neighborhoodName: 'Downtown' })
  return items
}

function getPendingConceptId(certifiedItems: M9AdapterCertifiedItem[]) {
  const out = runM9EnforcedCuration({ metroSlug: 'test-metro', certifiedItems, legacyPlan: [], storedOperatorDecisions: {}, now: () => '2026-09-15T00:00:00.000Z' })
  const rd = out.artifact.requiredDecisions[0]
  return { conceptId: rd.affectedConceptIds[0], action: rd.action, reasonCode: rd.reasonCode }
}

test('RESOLUTION: APPROVE cannot resolve an EVIDENCE_REQUIRED decision (unresolved venue duplicate)', () => {
  const items = duplicateCatalog()
  const out1 = runM9EnforcedCuration({ metroSlug: 'test-metro', certifiedItems: items, legacyPlan: [], storedOperatorDecisions: {}, now: () => '2026-09-15T00:00:00.000Z' })
  const dupDecision = out1.artifact.requiredDecisions.find((d) => d.reasonCode === 'UNRESOLVED_VENUE_DUPLICATE')!
  assert.ok(dupDecision, 'a duplicate finding must produce an outstanding decision')
  const input: M9OperatorDecisionInput = { conceptId: dupDecision.affectedConceptIds[0]!, action: dupDecision.action, resolutionAction: 'APPROVE', decisionText: 'Approved, looks good.', decidedBy: 'jerry' }
  const out2 = runM9EnforcedCuration({ metroSlug: 'test-metro', certifiedItems: items, legacyPlan: [], storedOperatorDecisions: {}, newOperatorDecisionInputs: [input], now: () => '2026-09-15T00:00:00.000Z' })
  assert.equal(out2.acceptedDecisions.length, 0, 'APPROVE must never be accepted for an EVIDENCE_REQUIRED decision')
  assert.equal(out2.rejectedDecisionInputs.length, 1)
  assert.match(out2.rejectedDecisionInputs[0]!.reason, /APPROVE cannot resolve/)
})

test('RESOLUTION: SUPPLY_EVIDENCE with no evidence object is refused (arbitrary prose is not evidence)', () => {
  const items = duplicateCatalog()
  const { conceptId, action } = getPendingConceptId(items)
  const input: M9OperatorDecisionInput = { conceptId, action, resolutionAction: 'SUPPLY_EVIDENCE', decisionText: 'This is a very long and thorough explanation that still is not structured evidence.', decidedBy: 'jerry' }
  const out = runM9EnforcedCuration({ metroSlug: 'test-metro', certifiedItems: items, legacyPlan: [], storedOperatorDecisions: {}, newOperatorDecisionInputs: [input], now: () => '2026-09-15T00:00:00.000Z' })
  assert.equal(out.acceptedDecisions.length, 0)
  assert.match(out.rejectedDecisionInputs[0]!.reason, /requires structured evidence/)
})

test('RESOLUTION: SUPPLY_EVIDENCE with incomplete structured evidence is refused', () => {
  const items = duplicateCatalog()
  const { conceptId, action } = getPendingConceptId(items)
  const input: M9OperatorDecisionInput = {
    conceptId,
    action,
    resolutionAction: 'SUPPLY_EVIDENCE',
    decisionText: 'Attaching evidence.',
    decidedBy: 'jerry',
    evidence: { sourceOrEvidenceId: '', evidenceSummary: 'summary', dateVerified: '', confidence: 'HIGH', affectedConceptId: conceptId, issueResolved: 'UNRESOLVED_VENUE_DUPLICATE' },
  }
  const out = runM9EnforcedCuration({ metroSlug: 'test-metro', certifiedItems: items, legacyPlan: [], storedOperatorDecisions: {}, newOperatorDecisionInputs: [input], now: () => '2026-09-15T00:00:00.000Z' })
  assert.equal(out.acceptedDecisions.length, 0)
  assert.match(out.rejectedDecisionInputs[0]!.reason, /incomplete/)
})

test('RESOLUTION: SUPPLY_EVIDENCE whose issueResolved does not match the real outstanding reasonCode is refused (unrelated evidence)', () => {
  const items = duplicateCatalog()
  const { conceptId, action } = getPendingConceptId(items)
  const input: M9OperatorDecisionInput = {
    conceptId,
    action,
    resolutionAction: 'SUPPLY_EVIDENCE',
    decisionText: 'Attaching a real source.',
    decidedBy: 'jerry',
    evidence: { sourceOrEvidenceId: 'https://example.com/hours', evidenceSummary: 'This documents opening hours, unrelated to the duplicate.', dateVerified: '2026-09-15', confidence: 'HIGH', affectedConceptId: conceptId, issueResolved: 'CONCEPT_CREATE_PENDING_APPROVAL' },
  }
  const out = runM9EnforcedCuration({ metroSlug: 'test-metro', certifiedItems: items, legacyPlan: [], storedOperatorDecisions: {}, newOperatorDecisionInputs: [input], now: () => '2026-09-15T00:00:00.000Z' })
  assert.equal(out.acceptedDecisions.length, 0)
  assert.match(out.rejectedDecisionInputs[0]!.reason, /does not match/)
})

test('RESOLUTION: complete, on-issue structured evidence is accepted and resolves the duplicate', () => {
  const items = duplicateCatalog()
  const { conceptId, action } = getPendingConceptId(items)
  const input: M9OperatorDecisionInput = {
    conceptId,
    action,
    resolutionAction: 'SUPPLY_EVIDENCE',
    decisionText: 'Confirmed distinct recurring events at the same venue.',
    decidedBy: 'jerry',
    evidence: {
      sourceOrEvidenceId: 'operator-review-2026-09-15',
      evidenceSummary: 'Venue calendar confirms pub quiz (Tuesdays) and live music (Fridays) are separately bookable events.',
      dateVerified: '2026-09-15',
      confidence: 'HIGH',
      affectedConceptId: conceptId,
      issueResolved: 'UNRESOLVED_VENUE_DUPLICATE',
    },
  }
  const out = runM9EnforcedCuration({ metroSlug: 'test-metro', certifiedItems: items, legacyPlan: [], storedOperatorDecisions: {}, newOperatorDecisionInputs: [input], now: () => '2026-09-15T00:00:00.000Z' })
  assert.equal(out.acceptedDecisions.length, 1)
  assert.equal(out.acceptedDecisions[0]!.decision, 'APPROVED')
  assert.ok(out.artifact.finalApprovedMemberships[conceptId])
})

test('RESOLUTION: REJECT always resolves by exclusion, even for an EVIDENCE_REQUIRED decision, with no evidence needed', () => {
  const items = duplicateCatalog()
  const { conceptId, action } = getPendingConceptId(items)
  const input: M9OperatorDecisionInput = { conceptId, action, resolutionAction: 'REJECT', decisionText: 'Dropping this concept rather than resolving the duplicate.', decidedBy: 'jerry' }
  const out = runM9EnforcedCuration({ metroSlug: 'test-metro', certifiedItems: items, legacyPlan: [], storedOperatorDecisions: {}, newOperatorDecisionInputs: [input], now: () => '2026-09-15T00:00:00.000Z' })
  assert.equal(out.acceptedDecisions.length, 1)
  assert.equal(out.acceptedDecisions[0]!.decision, 'REJECTED')
  assert.equal(out.artifact.conceptVerdicts.find((v) => v.conceptId === conceptId)?.approvalState, 'REJECTED')
})

test('RESOLUTION: ACCEPT_EXCEPTION is refused for every reasonCode this codebase produces today (none are whitelisted)', () => {
  const items = duplicateCatalog()
  const { conceptId, action } = getPendingConceptId(items)
  const input: M9OperatorDecisionInput = { conceptId, action, resolutionAction: 'ACCEPT_EXCEPTION', decisionText: 'Granting an exception.', decidedBy: 'jerry' }
  const out = runM9EnforcedCuration({ metroSlug: 'test-metro', certifiedItems: items, legacyPlan: [], storedOperatorDecisions: {}, newOperatorDecisionInputs: [input], now: () => '2026-09-15T00:00:00.000Z' })
  assert.equal(out.acceptedDecisions.length, 0)
  assert.match(out.rejectedDecisionInputs[0]!.reason, /does not explicitly permit an exception/)
})

test('RESOLUTION: REQUEST_RESEARCH never resolves anything, even with real decisionText', () => {
  const items = cleanCatalog()
  const { conceptId, action } = getPendingConceptId(items)
  const input: M9OperatorDecisionInput = { conceptId, action, resolutionAction: 'REQUEST_RESEARCH', decisionText: 'Requesting deeper research on this cluster.', decidedBy: 'jerry' }
  const out = runM9EnforcedCuration({ metroSlug: 'test-metro', certifiedItems: items, legacyPlan: [], storedOperatorDecisions: {}, newOperatorDecisionInputs: [input], now: () => '2026-09-15T00:00:00.000Z' })
  assert.equal(out.acceptedDecisions.length, 0)
  assert.match(out.rejectedDecisionInputs[0]!.reason, /never itself resolves/)
})

test('RESOLUTION: APPROVE resolves an ordinary APPROVAL_SUFFICIENT decision (a plain new-concept CREATE, no duplicate)', () => {
  const items = cleanCatalog()
  const { conceptId, action } = getPendingConceptId(items)
  const input: M9OperatorDecisionInput = { conceptId, action, resolutionAction: 'APPROVE', decisionText: 'Reviewed and approved.', decidedBy: 'jerry' }
  const out = runM9EnforcedCuration({ metroSlug: 'test-metro', certifiedItems: items, legacyPlan: [], storedOperatorDecisions: {}, newOperatorDecisionInputs: [input], now: () => '2026-09-15T00:00:00.000Z' })
  assert.equal(out.acceptedDecisions.length, 1)
  assert.equal(out.artifact.result.kind, 'READY')
})
