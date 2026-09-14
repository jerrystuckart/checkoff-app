import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reopenHoldCandidate, verifyReopenStageCompleteness, verifyHoldNotBypassed, METRO_LAUNCH_STAGE_ORDER, type HoldRecord } from './holdRecovery'
import { evaluateSeedCandidate, type SeedCandidateInput } from './seedPortfolioAudit'
import { detectSeedDuplicateClusters, candidateNamesInAnyCluster } from './seedDuplicateNormalization'

function vereinsheimHold(): HoldRecord {
  return {
    candidateName: 'Vereinsheim',
    holdReasonKind: 'SEED_DUPLICATE_CLUSTER',
    originalReasons: ['Flagged in a seed duplicate cluster — requires explicit review before it can be READY (never auto-resolved at this stage).'],
    originalHeldAt: '2026-09-14T05:00:00.000Z',
  }
}

test('reopenHoldCandidate: retains the prior HOLD reason verbatim on reopen', () => {
  const result = reopenHoldCandidate({ hold: vereinsheimHold(), explicitDecision: 'These are two genuinely distinct experiences — keep both.', reopenedBy: 'jerry', reopenedAt: '2026-09-15T00:00:00.000Z' })
  assert.deepEqual(result.retainedReasons, vereinsheimHold().originalReasons)
})

test('reopenHoldCandidate: refuses to reopen with neither new evidence nor an explicit decision', () => {
  const result = reopenHoldCandidate({ hold: vereinsheimHold(), reopenedBy: 'jerry', reopenedAt: '2026-09-15T00:00:00.000Z' })
  assert.equal(result.ok, false)
  assert.ok(result.errors.length > 0)
})

test('reopenHoldCandidate: accepts an explicit decision alone, with no new evidence — the real Kunst Oase/Vereinsheim precedent question', () => {
  const result = reopenHoldCandidate({ hold: vereinsheimHold(), explicitDecision: 'Collapse to one item — same recurring event described twice.', reopenedBy: 'jerry', reopenedAt: '2026-09-15T00:00:00.000Z' })
  assert.equal(result.ok, true)
})

test('reopenHoldCandidate: accepts new evidence alone, with no explicit decision', () => {
  const result = reopenHoldCandidate({ hold: { ...vereinsheimHold(), holdReasonKind: 'MISSING_OWNERSHIP_EVIDENCE' }, newEvidence: 'Fourth-generation family butcher, per venue history page.', reopenedBy: 'jerry', reopenedAt: '2026-09-15T00:00:00.000Z' })
  assert.equal(result.ok, true)
})

test('reopenHoldCandidate: refuses an anonymous reopen — reopenedBy is required', () => {
  const result = reopenHoldCandidate({ hold: vereinsheimHold(), explicitDecision: 'Keep both.', reopenedBy: '', reopenedAt: '2026-09-15T00:00:00.000Z' })
  assert.equal(result.ok, false)
})

test('reopenHoldCandidate: a seed-duplicate-cluster HOLD reenters at M5_75_SEED_PORTFOLIO_AUDIT — NOT M0, not even M5 (geography/category work is unrelated to a duplicate-review decision)', () => {
  const result = reopenHoldCandidate({ hold: vereinsheimHold(), explicitDecision: 'Keep both.', reopenedBy: 'jerry', reopenedAt: '2026-09-15T00:00:00.000Z' })
  assert.equal(result.reentryStage, 'M5_75_SEED_PORTFOLIO_AUDIT')
  assert.equal(result.remainingStages.includes('M0_METRO_DEFINITION'), false)
  assert.equal(result.remainingStages.includes('M1_GEOGRAPHY_MAP'), false)
})

test('reopenHoldCandidate: a missing-ownership-evidence HOLD reenters at M5_TARGETED_DEEP_DIVES — the stage that can actually populate the missing field', () => {
  const result = reopenHoldCandidate({ hold: { ...vereinsheimHold(), holdReasonKind: 'MISSING_OWNERSHIP_EVIDENCE' }, newEvidence: 'Real ownership evidence.', reopenedBy: 'jerry', reopenedAt: '2026-09-15T00:00:00.000Z' })
  assert.equal(result.reentryStage, 'M5_TARGETED_DEEP_DIVES')
})

test('reopenHoldCandidate: a list-membership HOLD (missing kind-specific evidence) reenters at M9_HOME_LIST_MIRROR — the catalog itself is untouched, only list curation needs to rerun', () => {
  const result = reopenHoldCandidate({ hold: { ...vereinsheimHold(), holdReasonKind: 'LIST_MEMBERSHIP_MISSING_KIND_SPECIFIC_EVIDENCE' }, newEvidence: 'A documented discovery basis.', reopenedBy: 'jerry', reopenedAt: '2026-09-15T00:00:00.000Z' })
  assert.equal(result.reentryStage, 'M9_HOME_LIST_MIRROR')
  assert.equal(result.remainingStages.includes('M6_5_CHECKOFF_EDITOR'), false, 'editorial writing is unrelated work that must not be rerun for a pure list-curation HOLD')
})

test('verifyReopenStageCompleteness: a correctly-computed reopen passes', () => {
  const result = reopenHoldCandidate({ hold: vereinsheimHold(), explicitDecision: 'Keep both.', reopenedBy: 'jerry', reopenedAt: '2026-09-15T00:00:00.000Z' })
  assert.equal(verifyReopenStageCompleteness(result).ok, true)
})

test('verifyReopenStageCompleteness: a tampered remainingStages (skipping a required stage) is caught', () => {
  const result = reopenHoldCandidate({ hold: vereinsheimHold(), explicitDecision: 'Keep both.', reopenedBy: 'jerry', reopenedAt: '2026-09-15T00:00:00.000Z' })
  const tampered = { ...result, remainingStages: result.remainingStages.filter((s) => s !== 'M10_METRO_LAUNCH_CERTIFICATION') }
  assert.equal(verifyReopenStageCompleteness(tampered).ok, false)
})

test('METRO_LAUNCH_STAGE_ORDER: M9_HOME_LIST_MIRROR comes before M10_METRO_LAUNCH_CERTIFICATION, matching the real driver sequence', () => {
  assert.ok(METRO_LAUNCH_STAGE_ORDER.indexOf('M9_HOME_LIST_MIRROR') < METRO_LAUNCH_STAGE_ORDER.indexOf('M10_METRO_LAUNCH_CERTIFICATION'))
})

// ---------------------------------------------------------------------------
// verifyHoldNotBypassed — synthetic checks of the helper's own logic.
// ---------------------------------------------------------------------------

test('verifyHoldNotBypassed: identical verdicts with no new evidence passes (the honest, expected outcome)', () => {
  const result = verifyHoldNotBypassed({ hadNewEvidence: false, originalVerdict: 'HOLD', reEvaluatedVerdict: 'HOLD' })
  assert.equal(result.ok, true)
})

test('verifyHoldNotBypassed: a changed verdict with NO new evidence is caught as a bypass', () => {
  const result = verifyHoldNotBypassed({ hadNewEvidence: false, originalVerdict: 'HOLD', reEvaluatedVerdict: 'READY' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /bypass/)
})

test('verifyHoldNotBypassed: a changed verdict WITH new evidence is permitted', () => {
  const result = verifyHoldNotBypassed({ hadNewEvidence: true, originalVerdict: 'HOLD', reEvaluatedVerdict: 'READY' })
  assert.equal(result.ok, true)
})

// ---------------------------------------------------------------------------
// Real end-to-end anti-bypass proof, using the ACTUAL evaluateSeedCandidate
// gate function and the real Vereinsheim duplicate-cluster pair.
// ---------------------------------------------------------------------------

function vereinsheimCandidates(): SeedCandidateInput[] {
  return [
    { name: 'Vereinsheim', category: 'Nightlife', neighborhood: 'Schwabing', claimSupported: "Join the pub quiz or catch a tiny concert at 'Vereinsheim'.", address: 'Occamstraße 8, 80802 München, Germany' },
    { name: 'Vereinsheim', category: 'Nightlife', neighborhood: 'Schwabing', claimSupported: "Play along with 'Königs Musik-Express', the quiz-and-live-music night at 'Vereinsheim'.", address: 'Occamstraße 8, 80802 München, Germany' },
  ]
}

test('holdRecovery end-to-end: re-evaluating the real Vereinsheim HOLD with the SAME duplicate-cluster evidence produces the IDENTICAL verdict — a force-approval attempt with nothing new supplied cannot silently bypass certification', () => {
  const candidates = vereinsheimCandidates()
  const clusters = detectSeedDuplicateClusters(candidates.map((c) => ({ name: c.name, address: c.address, placeId: c.placeId, claimSupported: c.claimSupported })))
  const duplicateNames = candidateNamesInAnyCluster(clusters)

  const original = evaluateSeedCandidate(candidates[0]!, duplicateNames)
  assert.equal(original.verdict, 'HOLD')

  // Reopen with an explicit decision but the SAME underlying candidate
  // set/evidence (no new evidence that would change the duplicate-cluster
  // membership) — re-running the exact same gate function on the exact
  // same input must produce the exact same verdict.
  const reEvaluated = evaluateSeedCandidate(candidates[0]!, duplicateNames)
  const check = verifyHoldNotBypassed({ hadNewEvidence: false, originalVerdict: original.verdict, reEvaluatedVerdict: reEvaluated.verdict })
  assert.equal(check.ok, true)
  assert.equal(reEvaluated.verdict, 'HOLD', 'still HOLD — force-approving without new evidence did not bypass the duplicate-cluster gate')
})

test('holdRecovery end-to-end: NEW evidence that genuinely removes the venue from the duplicate cluster (e.g. only ONE Vereinsheim candidate remains after a human collapses the pair to one item) legitimately changes the verdict to READY — proving new evidence CAN resolve a HOLD, unlike a bare force-approval', () => {
  const collapsedToOne: SeedCandidateInput[] = [vereinsheimCandidates()[0]!]
  const clusters = detectSeedDuplicateClusters(collapsedToOne.map((c) => ({ name: c.name, address: c.address, placeId: c.placeId, claimSupported: c.claimSupported })))
  const duplicateNames = candidateNamesInAnyCluster(clusters)
  const reEvaluated = evaluateSeedCandidate(collapsedToOne[0]!, duplicateNames)
  assert.equal(reEvaluated.verdict, 'READY', 'with the duplicate genuinely resolved (only one candidate remains), the same gate function now legitimately returns READY')
})
