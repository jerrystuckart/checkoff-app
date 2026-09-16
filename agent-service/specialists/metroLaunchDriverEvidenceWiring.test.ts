// End-to-end proof that the M5 targeted-research evidence contract
// (ownershipType/secretEvidence/difficultyEvidence/placeId) — previously
// declared in requiredEvidenceKeys nowhere on the real driver's
// candidate-producing call sites — now actually reaches the M5.75 Seed
// Portfolio Audit through the REAL stepM3 -> stepM4 -> stepM5_75 call
// path, not a synthetic shortcut that injects state.candidates directly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, toSeedCandidateInput, type MetroM0Decisions } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'

const RESOLVED_M0: MetroM0Decisions = {
  geographicScope: 'Downtown only',
  categoryCatalogTargets: 'n/a',
  launchSeason: null,
  executionGoAhead: true,
  metroCountry: 'US',
  metroCenter: { lat: 0, lng: 0 },
}

const EMPTY_PLAN: CategoryCoveragePlan = { targets: [] }

function baseDeps() {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  return { runStore, execStore, executor, deps: { runStore, execStore, executors: [executor] } }
}

test('stepM3 requests "candidates" in requiredEvidenceKeys (unchanged, still validated) and the full per-candidate evidence-contract set in optionalEvidenceKeys (prompt-only, never validated — see DelegationRequest.optionalEvidenceKeys)', async () => {
  const { runStore, executor, deps } = baseDeps()
  const run = await getOrCreateRun(runStore, 'metro_launch', 'evidence-wiring-1', 'M0_METRO_DEFINITION')
  run.currentStage = 'M3_BROAD_DISCOVERY'
  run.status = 'RUNNING'
  run.state = { m0Decisions: RESOLVED_M0, plan: EMPTY_PLAN, depthTargets: [], neighborhoods: [], candidates: [] }
  await runStore.put(run)

  let capturedRequired: string[] | undefined
  let capturedOptional: string[] | undefined
  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) => {
      capturedRequired = r.requiredEvidenceKeys
      capturedOptional = r.optionalEvidenceKeys
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { candidates: [] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
    }
  )

  await driveMetroLaunch(deps, 'evidence-wiring-1', { categoryPlan: EMPTY_PLAN, maxSteps: 2 })
  assert.ok(capturedRequired, 'stepM3 must actually have dispatched a research_verifier execution')
  assert.deepEqual(capturedRequired, ['candidates'], 'requiredEvidenceKeys stays exactly as before — these fields must never be validated as top-level evidence keys')
  assert.ok(capturedOptional, 'optionalEvidenceKeys must be set')
  for (const key of ['ownershipType', 'secretEvidence', 'difficultyEvidence', 'placeId']) {
    assert.ok(capturedOptional!.includes(key), `optionalEvidenceKeys should include "${key}"`)
  }
})

test('a real M3 response carrying full evidence-contract extension fields reaches the M5.75 Seed Portfolio Audit report intact, sanitized and typed — not dropped, not fabricated', async () => {
  const { runStore, executor, deps } = baseDeps()
  const run = await getOrCreateRun(runStore, 'metro_launch', 'evidence-wiring-2', 'M0_METRO_DEFINITION')
  run.currentStage = 'M3_BROAD_DISCOVERY'
  run.status = 'RUNNING'
  run.state = { m0Decisions: RESOLVED_M0, plan: EMPTY_PLAN, depthTargets: [], neighborhoods: [], candidates: [] }
  await runStore.put(run)

  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          candidates: [
            {
              name: 'Magnus Bauch',
              category: 'Shopping',
              neighborhood: 'Downtown',
              claimSupported: "Buy a house-made sausage from fourth-generation butcher 'Magnus Bauch'.",
              source: 'https://example.com/magnus-bauch',
              needsVerification: true,
              verificationConfidence: 'HIGH',
              // Evidence-contract extension fields — KNOWN, well-formed.
              ownershipType: 'INDEPENDENT_LOCAL',
              ownershipEvidence: 'Fourth-generation family butcher, per venue history page.',
              ownershipConfidence: 'HIGH',
              isSecretClaimed: true,
              secretEvidence: {
                mechanic: 'A back-room counter accessible only through an unmarked door behind the main shop.',
                evidenceType: 'LOCAL_EDITORIAL_GUIDE',
                source: 'https://example.com/magnus-bauch-guide',
                dateVerified: '2026-09-01',
                confidence: 'MEDIUM',
                verdict: 'HOLD',
              },
              placeId: 'ChIJ_test_magnus_bauch',
              difficultyEvidence: {
                cost: { present: false, detail: '' },
                advanceBooking: { present: false, detail: '' },
                timingRestriction: { present: true, detail: 'Only available at the Saturday morning market.' },
                physicalEffort: { present: false, detail: '' },
                limitedAvailability: { present: false, detail: '' },
                specialOrderingComplexity: { present: false, detail: '' },
                travel: { level: 'NONE', detail: '' },
                source: 'https://example.com/magnus-bauch',
              },
            },
            {
              // A SECOND candidate whose research pass could not confirm
              // anything beyond the base contract — must arrive at M5.75 as
              // explicit UNKNOWN, never guessed.
              name: 'Unconfirmed Spot',
              category: 'Food & drink',
              neighborhood: 'Downtown',
              claimSupported: 'Order the off-menu tasting flight, a specific multi-course pairing found nowhere else.',
              source: 'https://example.com/unconfirmed-spot',
              needsVerification: true,
              verificationConfidence: 'LOW',
              // A vague, colorful ownership claim with NO evidence — must be downgraded, never trusted.
              ownershipType: 'INDEPENDENT_LOCAL',
            },
          ],
        },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
  )

  executor.scriptWhen(
    (r) => r.stage === 'M6_QUALITY_VERIFICATION',
    (r) => {
      const toVerify = ((r.inputs as { candidates?: Array<{ name: string }> }).candidates ?? []).map((c) => c.name)
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { verifiedCandidateNames: toVerify }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
    }
  )

  const result = await driveMetroLaunch(deps, 'evidence-wiring-2', { categoryPlan: EMPTY_PLAN, maxSteps: 4 })
  const report = (result.state as {
    seedPortfolioAuditReport?: { commercialMix: { locallyOwnedCount: number; unknownCount: number; verdict: string }; candidateDecisions: { ready: string[]; hold: unknown[]; reject: unknown[] } }
  }).seedPortfolioAuditReport
  assert.ok(report, 'a real M3 candidate must actually reach M5.75 and produce a report')

  // Prove the evidence reached the REAL M5.75 audit output, not just raw
  // driver state: Magnus Bauch's real ownershipType='INDEPENDENT_LOCAL'
  // (with evidence) must count toward commercialMix.locallyOwnedCount, and
  // Unconfirmed Spot's bare, unsupported ownershipType label must be
  // downgraded and counted as unknown instead — both are the actual
  // seedPortfolioAudit.ts evaluateCommercialMix output, not a synthetic
  // re-check.
  assert.equal(report!.commercialMix.locallyOwnedCount, 1, 'Magnus Bauch (real ownershipEvidence) counted as locally owned')
  assert.equal(report!.commercialMix.unknownCount, 1, 'Unconfirmed Spot (no ownershipEvidence) counted as unknown, never silently independent')

  // Prove the raw candidate the real stepM3/dedupe path produced is EXACTLY
  // what toSeedCandidateInput() — the real function stepM5_75 calls per
  // candidate — turns into sanitized M5.75 input, end to end.
  const candidates = (result.state as { candidates?: Array<Record<string, unknown>> }).candidates ?? []
  const rawMagnusBauch = candidates.find((c) => c.name === 'Magnus Bauch')
  assert.ok(rawMagnusBauch, 'Magnus Bauch must survive stepM3 -> state.candidates')
  const seedInput = toSeedCandidateInput(rawMagnusBauch as never)
  assert.equal(seedInput.ownershipType, 'INDEPENDENT_LOCAL')
  assert.equal(seedInput.isSecretClaimed, true)
  assert.equal(seedInput.secretEvidence?.mechanic, 'A back-room counter accessible only through an unmarked door behind the main shop.')
  assert.equal(seedInput.placeId, 'ChIJ_test_magnus_bauch')
  assert.equal(seedInput.proposedDifficulty, 5, 'derived from the real difficultyEvidence (one timing-restriction factor), never a fabricated fallback')

  const rawUnconfirmed = candidates.find((c) => c.name === 'Unconfirmed Spot')
  assert.ok(rawUnconfirmed, 'Unconfirmed Spot must also survive')
  const unconfirmedSeedInput = toSeedCandidateInput(rawUnconfirmed as never)
  assert.equal(unconfirmedSeedInput.ownershipType, 'UNKNOWN_REQUIRES_VERIFICATION', 'a bare ownershipType label with no ownershipEvidence must be downgraded to explicit UNKNOWN, never silently trusted')
  assert.equal(unconfirmedSeedInput.proposedDifficulty, undefined, 'no difficultyEvidence was ever supplied for this candidate — INSUFFICIENT_DATA, never a fabricated 1')
})
