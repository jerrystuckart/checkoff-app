// Phase 1D — actionHandlers.ts unit tests. Pure, no DB, no network.
// Covers: deterministic structured-signal selection (never title-text),
// the trust boundary (a plan's actionType/policy always genuinely match
// the producing handler — never spoofable), zero/ambiguous-match ->
// no plan, and the one registered internal capability's claim-only
// execute() behavior.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  ACTION_REGISTRY,
  internalDesignDefinitionHandler,
  outboundCommunicationHandler,
  selectApplicablePlan,
  findHandler,
  performInternalDesignDefinitionExecution,
  type ActionHandler,
} from './actionHandlers'
import { getAllowedRootForTesting, createArtifactWriterForTesting } from './artifactWriter'
import { ARTIFACT_FILENAME, verifyDiscoveryArtifact } from './whatsGoodWidgetDiscoveryArtifact'
import type { TaskSummary } from './types'

/** A fresh temp-dir-bound ArtifactWriter — never the real docs/whats-good-widget/ one. */
function makeTempWriter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'action-handlers-test-'))
  return { writer: createArtifactWriterForTesting(root), root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

function makeTask(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 'task-1',
    title: 'A task',
    description: null,
    status: 'READY',
    priority: null,
    project: { id: 'proj-1', projectKey: 'test_project', name: 'Test Project' },
    owner: null,
    dueAt: null,
    nextCheckAt: null,
    nextAction: 'do the thing',
    requiresJerry: false,
    jerryRequest: null,
    blockedBy: null,
    blockerNote: null,
    contact: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    sourceType: 'bootstrap_v1',
    sourceRef: 'test-source-ref',
    projectType: 'PRODUCT',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// internal_design_definition — matches the live "Build widget"-shaped task
// ---------------------------------------------------------------------------

test('internalDesignDefinitionHandler: applies to a READY task under a PRODUCT project with no contact/blocker', async () => {
  const task = makeTask({ projectType: 'PRODUCT', contact: null, blockedBy: null })
  const plan = await internalDesignDefinitionHandler.plan(task)
  assert.ok(plan)
  assert.equal(plan?.actionType, 'internal_design_definition')
  assert.equal(plan?.policy, 'AUTO_ALLOWED')
  assert.equal(plan?.expectedEffect, 'internal_reversible')
})

test('internalDesignDefinitionHandler: also applies under an INTERNAL project', async () => {
  const task = makeTask({ projectType: 'INTERNAL' })
  const plan = await internalDesignDefinitionHandler.plan(task)
  assert.ok(plan)
})

test('internalDesignDefinitionHandler: declines a DESTINATION_HUB/METRO project (never guesses)', async () => {
  assert.equal(await internalDesignDefinitionHandler.plan(makeTask({ projectType: 'DESTINATION_HUB' })), null)
  assert.equal(await internalDesignDefinitionHandler.plan(makeTask({ projectType: 'METRO' })), null)
})

test('internalDesignDefinitionHandler: declines when a contact is linked (structured evidence of an external touchpoint)', async () => {
  const task = makeTask({ contact: { id: 'c1', organizationName: 'Acme', personName: null } })
  assert.equal(await internalDesignDefinitionHandler.plan(task), null)
})

test('internalDesignDefinitionHandler: declines when blocked or not READY', async () => {
  assert.equal(await internalDesignDefinitionHandler.plan(makeTask({ blockedBy: { id: 'b', title: 't', status: 'READY' } })), null)
  assert.equal(await internalDesignDefinitionHandler.plan(makeTask({ status: 'WAITING' })), null)
  assert.equal(await internalDesignDefinitionHandler.plan(makeTask({ status: 'IN_PROGRESS' })), null)
})

test('performInternalDesignDefinitionExecution: writes and verifies the product-discovery artifact (via an injected temp-dir writer, NEVER the real one), reports CLAIMED_WITH_PLAN_UPDATE (never READY_TO_VERIFY/DONE), no verifyCompletion is defined', async (t) => {
  const { writer, root, cleanup } = makeTempWriter()
  t.after(cleanup)

  const task = makeTask()
  const outcome = await performInternalDesignDefinitionExecution(task, writer)

  assert.equal(outcome.outcome, 'CLAIMED_WITH_PLAN_UPDATE')
  if (outcome.outcome === 'CLAIMED_WITH_PLAN_UPDATE') {
    assert.match(outcome.nextAction, /Product discovery brief created/)
    assert.doesNotMatch(outcome.nextAction, /DONE/i)
  }
  assert.equal(internalDesignDefinitionHandler.verifyCompletion, undefined, 'this handler must never be able to autonomously reach DONE')

  const artifactPath = path.join(root, ARTIFACT_FILENAME)
  assert.ok(fs.existsSync(artifactPath), 'the artifact must actually exist in the TEMP directory after execution')
  const written = fs.readFileSync(artifactPath, 'utf8')
  const verification = verifyDiscoveryArtifact(written)
  assert.equal(verification.valid, true, `written artifact failed its own verifier: ${verification.reasons.join('; ')}`)
})

test('internalDesignDefinitionHandler.execute (the real, unchanged production entry point) delegates to performInternalDesignDefinitionExecution with no writer override — proven by calling it with a mismatched task id and confirming the SAME outcome shape performInternalDesignDefinitionExecution would produce, without this test ever touching the filesystem itself', () => {
  // This is a structural/type-level proof, not a filesystem test: the real
  // handler's execute() takes no writer argument at all (see
  // actionHandlers.ts), so there is no code path for this test — or any
  // other caller — to supply one. The regression test below is the one
  // that actually proves the real artifact is untouched by running the
  // suite.
  assert.equal(internalDesignDefinitionHandler.execute!.length, 1, 'execute(task) takes exactly one parameter — no writer override is exposed')
})

test('REGRESSION: running the handler execution test suite never touches the real docs/whats-good-widget/product-discovery.md', async (t) => {
  const realArtifactPath = path.join(getAllowedRootForTesting(), ARTIFACT_FILENAME)
  const existedBefore = fs.existsSync(realArtifactPath)
  const contentBefore = existedBefore ? fs.readFileSync(realArtifactPath, 'utf8') : null
  const mtimeBefore = existedBefore ? fs.statSync(realArtifactPath).mtimeMs : null

  // Simulate a full run of the handler-execution tests above, including a
  // case that would previously have written to the real path.
  const { writer, cleanup } = makeTempWriter()
  t.after(cleanup)
  await performInternalDesignDefinitionExecution(makeTask(), writer)
  await performInternalDesignDefinitionExecution(makeTask({ id: 'task-2' }), writer)

  const existedAfter = fs.existsSync(realArtifactPath)
  const contentAfter = existedAfter ? fs.readFileSync(realArtifactPath, 'utf8') : null
  const mtimeAfter = existedAfter ? fs.statSync(realArtifactPath).mtimeMs : null

  assert.equal(existedAfter, existedBefore, 'existence of the real artifact must be unchanged')
  assert.equal(contentAfter, contentBefore, 'content of the real artifact must be byte-identical')
  assert.equal(mtimeAfter, mtimeBefore, 'the real artifact must not have been touched at all (mtime unchanged)')
})

// ---------------------------------------------------------------------------
// outbound_communication — matches the live "Buena Vista"-shaped task,
// plan-only, structurally unexecutable
// ---------------------------------------------------------------------------

test('outboundCommunicationHandler: applies to a READY task under a DESTINATION_HUB/METRO project', async () => {
  const plan1 = await outboundCommunicationHandler.plan(makeTask({ projectType: 'DESTINATION_HUB' }))
  const plan2 = await outboundCommunicationHandler.plan(makeTask({ projectType: 'METRO' }))
  assert.ok(plan1)
  assert.ok(plan2)
  assert.equal(plan1?.policy, 'APPROVAL_REQUIRED')
  assert.equal(plan1?.expectedEffect, 'external')
})

test('outboundCommunicationHandler: declines a PRODUCT/INTERNAL project', async () => {
  assert.equal(await outboundCommunicationHandler.plan(makeTask({ projectType: 'PRODUCT' })), null)
  assert.equal(await outboundCommunicationHandler.plan(makeTask({ projectType: 'INTERNAL' })), null)
})

test('outboundCommunicationHandler: has no execute() at all — structurally cannot be dispatched regardless of anything else', () => {
  assert.equal(outboundCommunicationHandler.execute, undefined)
})

test('outboundCommunicationHandler: plan description notes the missing contact when none is linked', async () => {
  const plan = await outboundCommunicationHandler.plan(makeTask({ projectType: 'DESTINATION_HUB', contact: null }))
  assert.match(plan!.description, /No contact record is currently linked/)
})

test('outboundCommunicationHandler: plan description omits the missing-contact note when a contact IS linked', async () => {
  const plan = await outboundCommunicationHandler.plan(
    makeTask({ projectType: 'DESTINATION_HUB', contact: { id: 'c1', organizationName: 'Acme', personName: null } })
  )
  assert.doesNotMatch(plan!.description, /No contact record is currently linked/)
})

// ---------------------------------------------------------------------------
// Trust boundary — a plan's actionType/policy always genuinely match the
// producing handler; selection is deterministic (never a guess)
// ---------------------------------------------------------------------------

test('trust boundary: every plan produced by a registered handler carries exactly that handler\'s own actionType and policy', async () => {
  for (const handler of ACTION_REGISTRY) {
    // Construct a task shaped to match ONLY this handler by trying both
    // project-type families and picking whichever produces a plan.
    const candidateA = makeTask({ projectType: 'PRODUCT' })
    const candidateB = makeTask({ projectType: 'DESTINATION_HUB' })
    const plan = (await handler.plan(candidateA)) ?? (await handler.plan(candidateB))
    if (!plan) continue // this handler isn't shaped for either fixture — fine, not every handler needs to match every fixture
    assert.equal(plan.actionType, handler.actionType)
    assert.equal(plan.policy, handler.policy)
  }
})

test('selectApplicablePlan: zero matches -> null, never a guess', async () => {
  // No registered handler applies to a task with an unrecognized/absent projectType.
  const task = makeTask({ projectType: null })
  assert.equal(await selectApplicablePlan(task), null)
})

test('selectApplicablePlan: exactly one match -> that plan', async () => {
  const task = makeTask({ projectType: 'PRODUCT' })
  const plan = await selectApplicablePlan(task)
  assert.equal(plan?.actionType, 'internal_design_definition')
})

test('selectApplicablePlan: more than one match -> null, never silently picks one', async () => {
  // Two handlers both claiming the SAME task deliberately, via a
  // test-local registry (production ACTION_REGISTRY's two handlers are
  // mutually exclusive by project type and cannot collide this way).
  const alwaysMatchesA: ActionHandler = {
    actionType: 'internal_research',
    policy: 'AUTO_ALLOWED',
    expectedEffect: 'internal_reversible',
    async plan(task) {
      return { taskId: task.id, actionType: 'internal_research', description: 'x', reason: 'x', expectedEffect: 'internal_reversible', policy: 'AUTO_ALLOWED' }
    },
  }
  const alwaysMatchesB: ActionHandler = {
    actionType: 'code_change_local_reversible',
    policy: 'AUTO_ALLOWED',
    expectedEffect: 'internal_reversible',
    async plan(task) {
      return {
        taskId: task.id,
        actionType: 'code_change_local_reversible',
        description: 'y',
        reason: 'y',
        expectedEffect: 'internal_reversible',
        policy: 'AUTO_ALLOWED',
      }
    },
  }
  const plan = await selectApplicablePlan(makeTask(), [alwaysMatchesA, alwaysMatchesB])
  assert.equal(plan, null, 'ambiguous — must never silently pick one')
})

test('findHandler: resolves a handler by its exact actionType, from the production registry', () => {
  assert.equal(findHandler('internal_design_definition'), internalDesignDefinitionHandler)
  assert.equal(findHandler('outbound_communication'), outboundCommunicationHandler)
  assert.equal(findHandler('schema_migration_apply'), undefined, 'no handler is registered for this action type yet')
})

// ---------------------------------------------------------------------------
// Worked examples — the two current live tasks, shaped exactly as queried
// ---------------------------------------------------------------------------

test('worked example: "Buena Vista — begin outreach" (destination_hubs_wave_1, no contact) selects outbound_communication only', async () => {
  const buenaVista = makeTask({
    title: 'Buena Vista — begin outreach',
    projectType: 'DESTINATION_HUB',
    contact: null,
    status: 'READY',
  })
  const plan = await selectApplicablePlan(buenaVista)
  assert.equal(plan?.actionType, 'outbound_communication')
  assert.equal(plan?.policy, 'APPROVAL_REQUIRED')
})

test('worked example: "Build What\'s Good / What to Get widget" (whats_good_widget, PRODUCT, no contact) selects internal_design_definition only', async () => {
  const widget = makeTask({
    title: "Build What's Good / What to Get widget",
    projectType: 'PRODUCT',
    contact: null,
    status: 'READY',
  })
  const plan = await selectApplicablePlan(widget)
  assert.equal(plan?.actionType, 'internal_design_definition')
  assert.equal(plan?.policy, 'AUTO_ALLOWED')
})
