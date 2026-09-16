// Munich regression fix (2026-09-16) — end-to-end proof that the REAL
// driveMetroLaunch entry point (not just the pure catalogVoiceDiagnostics.ts
// functions) auto-repairs a Munich-shaped catalog at M8_75_CATALOG_VOICE_PASS,
// and that state.openingWordDiversityReport reflects the real before/after
// counts. Seeded directly at M8_75_CATALOG_VOICE_PASS (established pattern
// in this codebase — see metroLaunchDriverM9Enforced.test.ts's own
// seedAtM9) rather than driving the full M0-M8 pipeline, so this test
// stays fast and focused on the one stage under test. No SQL, no
// production writes — InMemoryPlaybookRunStore/InMemoryExecutionStore/
// TestExecutor throughout.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type DriverItemCertificationRecord } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import { checkVenueQuoted } from '../playbooks/editorialDistinctiveness'
import type { OpeningWordDiversityReport } from '../playbooks/catalogVoiceDiagnostics'

function distinctWord(i: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  const first = letters[Math.floor(i / 26) % 26]
  const second = letters[i % 26]
  const word = `${first}${second}word`
  return word.charAt(0).toUpperCase() + word.slice(1)
}

const MUNICH_GROUPS: Array<{ opener: string; count: number }> = [
  { opener: 'Catch', count: 12 },
  { opener: 'Choose', count: 8 },
  { opener: 'Find', count: 12 },
  { opener: 'Order', count: 18 },
  { opener: 'Take', count: 9 },
]

function buildMunichItemCertifications(): Record<string, DriverItemCertificationRecord> {
  const certs: Record<string, DriverItemCertificationRecord> = {}
  const push = (candidateName: string, venueName: string, body: string) => {
    certs[candidateName] = {
      candidateName,
      venueName,
      attempts: 1,
      outcome: 'ITEM_CERTIFIED',
      finalBody: body,
      finalTags: ['tag1', 'tag2'],
      supportingFact: `${candidateName} has a real specific attraction.`,
      verifiedAt: '2026-09-16T00:00:00.000Z',
      rejectionReasons: [],
      dbCategory: 'Adventure',
    }
  }
  for (const { opener, count } of MUNICH_GROUPS) {
    for (let i = 0; i < count; i++) {
      const venueName = `Venue ${opener}${i}`
      // A DISTINCT concrete noun phrase per item (real Munich shape — same
      // generic opener, different specific order/object each time) so
      // only the diffuse-concentration (shared opening WORD) signal
      // fires, never the separate repeated-3-word-phrase mechanism.
      push(`${opener} Item ${i}`, venueName, `${opener} the ${distinctWord(300 + i)} at '${venueName}'.`)
    }
  }
  for (let i = 0; i < 125; i++) {
    const venueName = `Venue Varied${i}`
    push(`Varied Item ${i}`, venueName, `${distinctWord(i)} the detail at '${venueName}'.`)
  }
  return certs
}

async function seedAtM875(runStore: InMemoryPlaybookRunStore, projectId: string) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = (await runStore.get(playbookRunId('metro_launch', projectId)))!
  seeded.state = { itemCertifications: buildMunichItemCertifications(), batchCertificationGates: [] }
  seeded.currentStage = 'M8_75_CATALOG_VOICE_PASS'
  await runStore.put(seeded)
  return seeded
}

/**
 * Scripts a real-shaped VOICE_REWRITE response: varies ONLY the opening
 * word (every item gets its own distinct new opener — never one shared
 * new template), leaving the rest of the body — the specific concrete
 * order/activity/object — completely untouched. This is what a genuine
 * "vary the opening, keep the substance" rewrite looks like, and is what
 * the experience-anchor safeguard is specifically there to require.
 *
 * `forcedBodies`, when supplied, overrides the response for specific
 * candidateNames (checked BEFORE the general vary-only-the-opening
 * behavior) — used to script a deliberately bad (anchor-dropping)
 * response for one target item while every other item still gets a real,
 * valid rewrite.
 */
function makeVoiceRewriteExecutor(forcedBodies: Record<string, string> = {}): TestExecutor {
  const executor = new TestExecutor()
  let counter = 0
  executor.scriptWhen(
    (request) => request.specialist === 'checkoff_editor' && (request.inputs as { mode?: string })?.mode === 'VOICE_REWRITE',
    (request) => {
      const inputs = request.inputs as { body: string; venueName: string; dominantOpeningWord: string }
      const forcedCandidateName = Object.keys(forcedBodies).find((name) => request.objective.includes(`vary the opening of ${name} `))
      if (forcedCandidateName) {
        return fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { body: forcedBodies[forcedCandidateName]! }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
      }
      counter += 1
      const newOpener = distinctWord(500 + counter)
      const rest = inputs.body.replace(/^[A-Za-z]+(?:'[A-Za-z]+)*\s*/, '')
      const newBody = `${newOpener} ${rest}`
      return fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { body: newBody }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
    }
  )
  return executor
}

function stateOf(run: Awaited<ReturnType<typeof driveMetroLaunch>>) {
  return run.state as { itemCertifications?: Record<string, DriverItemCertificationRecord>; openingWordDiversityReport?: OpeningWordDiversityReport; catalogVoiceRewrites?: Array<{ candidateName: string; dominantOpeningWord: string }> }
}

test('DRIVER E2E: the real driveMetroLaunch M8_75_CATALOG_VOICE_PASS stage auto-repairs a Munich-shaped catalog and produces a structured before/after report', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtM875(runStore, 'munich-voice-pass')
  const deps = {
    runStore,
    execStore: new InMemoryExecutionStore(),
    executors: [makeVoiceRewriteExecutor()],
    // Large enough that every flagged item is processed in ONE step call —
    // keeps this test to a single, fast driveMetroLaunch invocation
    // without needing to also stand up M8_BATCH_CERTIFICATION's own,
    // much larger set of gate dependencies (unrelated to this fix).
    guardrails: { maxConcurrentExecutions: 200, maxLoopIterations: 50, maxInfraRetriesPerStep: 3, maxPlanRelaxationRounds: 3 },
    ensureProject: async () => ({ projectId: 'test-project', created: false }),
    now: () => '2026-09-16T00:00:00.000Z',
  }

  const run = await driveMetroLaunch(deps as never, 'munich-voice-pass', { categoryPlan: { targets: [] }, maxSteps: 1 })
  const state = stateOf(run)

  // 1. The real stage rewrote a real, STRICT SUBSET of the 59 items behind
  // a notable opener — proof of the minimum-necessary-repair fix, through
  // the live driver, not just the pure diagnostic function.
  assert.ok(state.catalogVoiceRewrites && state.catalogVoiceRewrites.length > 0 && state.catalogVoiceRewrites.length < 59, `expected a real strict subset of 59, got ${state.catalogVoiceRewrites?.length}`)

  // 2. Every rewritten body still quotes its real venue name — repairs
  // preserved venue shape.
  for (const rewrite of state.catalogVoiceRewrites!) {
    const record = state.itemCertifications![rewrite.candidateName]!
    assert.ok(checkVenueQuoted(record.finalBody!, record.venueName).pass, `${rewrite.candidateName}'s rewritten body must still quote its venue name`)
  }

  // 3. The structured before/after report shows the REAL Munich counts
  // before, and a genuinely reduced (passing) concentration after —
  // achieved by repairing FEWER than all 59 contributing items.
  const report = state.openingWordDiversityReport!
  assert.ok(report, 'state.openingWordDiversityReport must be populated by the real driver')
  assert.equal(report.before.rows.find((r) => r.word === 'order')?.count, 18)
  assert.equal(report.before.rows.find((r) => r.word === 'catch')?.count, 12)
  assert.equal(report.before.rows.find((r) => r.word === 'choose')?.count, 8)
  assert.equal(report.before.rows.find((r) => r.word === 'find')?.count, 12)
  assert.equal(report.before.rows.find((r) => r.word === 'take')?.count, 9)
  assert.equal(report.before.concentrationVerdict, 'FAIL')
  assert.ok(Math.abs(report.before.combinedNotableSharePercent - 32.0652) < 0.01)

  assert.equal(report.after.concentrationVerdict, 'PASS', 'the real repair must bring the catalog under the concentration threshold')
  assert.equal(report.itemsRewritten, state.catalogVoiceRewrites!.length)
})

test('DRIVER E2E: a proposed rewrite that drops the specific named order/object (generic synonym substitution) is rejected — the real driver keeps the original body', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtM875(runStore, 'munich-voice-pass-anchor-reject')

  // The FIRST item the repair loop reaches gets a deliberately BAD rewrite
  // (a vague synonym that drops the specific named detail) scripted for
  // BOTH of its bounded attempts; every other item gets the normal, real
  // vary-only-the-opening rewrite.
  const targetCandidateName = 'Order Item 0'
  const badBody = "Enjoy something nice at 'Venue Order0'." // no specific order/object — the real "generic synonym" failure mode
  const executor = makeVoiceRewriteExecutor({ [targetCandidateName]: badBody })

  const deps = {
    runStore,
    execStore: new InMemoryExecutionStore(),
    executors: [executor],
    guardrails: { maxConcurrentExecutions: 200, maxLoopIterations: 50, maxInfraRetriesPerStep: 3, maxPlanRelaxationRounds: 3 },
    ensureProject: async () => ({ projectId: 'test-project', created: false }),
    now: () => '2026-09-16T00:00:00.000Z',
  }

  const run = await driveMetroLaunch(deps as never, 'munich-voice-pass-anchor-reject', { categoryPlan: { targets: [] }, maxSteps: 1 })
  const state = stateOf(run)

  // The target item must NOT appear among successful rewrites, and its
  // body must be completely unchanged — the anchor check rejected the
  // proposed rewrite on both attempts, so rewriteOneItemVoice returned
  // null and the original, specific body was kept (never regressed to a
  // vague synonym just to satisfy opening-word variety).
  assert.ok(!state.catalogVoiceRewrites!.some((r) => r.candidateName === targetCandidateName), 'the anchor-dropping rewrite must never be recorded as a successful rewrite')
  const targetRecord = state.itemCertifications![targetCandidateName]!
  assert.match(targetRecord.finalBody!, /^Order the /, 'the original, specific body must be preserved verbatim when every proposed rewrite drops the experience anchor')
  assert.notEqual(targetRecord.finalBody, badBody)
})
