// Read-only-by-default safety checks. Split into:
//   - static checks (no DB needed): the public surface exposes EXACTLY the
//     approved mutations (Phase 0D's task mutations + Phase 0F's single
//     Open Brain write function) and nothing else write-shaped, and the
//     internal writable-transaction helper is never re-exported.
//   - a live check (skipped without AGENT_SERVICE_DATABASE_URL): the
//     plain read `query()` helper still cannot write, proving the
//     `SET default_transaction_read_only = on` session default from
//     Phase 0C is intact and unaffected by later phases' changes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as agentService from './index'
import { query } from './db'

// Phase 1A adds createDecision (decision creation) and
// recommendDecisionForOpenBrain (Chief's ONLY write into the promotion
// workflow — agent_service has no EXECUTE grant on approve/reject/
// reconsider, so there is deliberately no exported function for those; see
// supabase/migrations/20260901_agent_decisions_promotion_workflow.sql).
//
// Phase 1D adds executeAutonomousAction — the ONLY function anywhere in
// agent-service that can autonomously transition a task on Chief's own
// initiative (via transitionTask() internally), and only within the
// narrow authority documented in actionExecution.ts's module doc: claim
// (READY->IN_PROGRESS), an operational condition -> WAITING/BLOCKED/
// NEEDS_JERRY, or ->DONE after independent verifyCompletion(). Its name
// doesn't match the writeLikeName regex below (starts with "execute", not
// create/update/etc.), so it's listed here explicitly rather than relying
// on the heuristic to catch it.
// Phase 1E adds writeArtifact — the ONLY filesystem write in agent-service,
// bounded to docs/whats-good-widget/ ONLY (see artifactWriter.ts's module
// doc for the hardened path-containment implementation). It is a
// filesystem write, not a database write, but it's still write-shaped and
// belongs in this approved set for the same reason as everything else
// here: an explicit, reviewed, narrow capability — never a generic one.
// Phase 2A adds recordPlaybookStage (mutations.ts's fourth, narrowly-scoped
// write primitive — a task_events-only record of a playbook's fine-grained
// stage, never touching agent.tasks columns) plus the Business Photo
// Outreach playbook engine's own write-shaped operations: recordOutreachSent
// and createClingFulfillmentTask (both thin, reviewed wrappers around
// transitionTask/createTask — no new write path underneath them).
// seedBusinessPhotoOutreachTasks and reconcileBusinessPhotoOutreach are
// listed here too for completeness even though neither matches the
// writeLikeName heuristic below (their names start with "seed"/"reconcile")
// — both ultimately call only createTask/transitionTask/recordPlaybookStage.
const APPROVED_MUTATIONS = new Set([
  'createTask',
  'transitionTask',
  'updateTaskPlan',
  'writeDecisionToOpenBrain',
  'createDecision',
  'recommendDecisionForOpenBrain',
  'syncDecisionToOpenBrain',
  'executeAutonomousAction',
  'writeArtifact',
  'recordPlaybookStage',
  'recordOutreachSent',
  'createClingFulfillmentTask',
  'seedBusinessPhotoOutreachTasks',
  'reconcileBusinessPhotoOutreach',
  // Phase 2B — Photo Moderation. detectNewCandidates/runAssessment only
  // ever create tasks and record recommendations (never mutate
  // item_cover_candidates); applyJerryDecision is the one function that
  // does mutate it, and ONLY by calling the existing, already-approved
  // coverCandidateModeration.ts operations — never new SQL.
  'detectNewCandidates',
  'runAssessment',
  'applyJerryDecision',
])

test('read-only safety: agent-service exports exactly the approved mutation set, nothing else write-shaped', () => {
  const writeLikeName = /^(create|update|delete|insert|transition|record|schedule|mutate|write|remove|set|patch)/i

  const exportedFunctionNames = Object.keys(agentService).filter(
    (key) => typeof (agentService as Record<string, unknown>)[key] === 'function'
  )

  const writeLike = exportedFunctionNames.filter((name) => writeLikeName.test(name))
  const unexpected = writeLike.filter((name) => !APPROVED_MUTATIONS.has(name))

  assert.deepEqual(unexpected, [], `found unapproved write-like exported function(s): ${unexpected.join(', ')}`)
  for (const approved of APPROVED_MUTATIONS) {
    assert.ok(exportedFunctionNames.includes(approved), `expected ${approved} to be exported`)
  }

  // No generic patch/arbitrary-field mutator of any name.
  const forbiddenExactNames = [
    'updateTask',
    'patchTask',
    'setTaskField',
    'recordInteraction',
    'recordDecision',
    'scheduleFollowup',
    // Phase 1A: agent_service has no EXECUTE grant on any of these three —
    // exporting a wrapper for them from agent-service would be dead code
    // masquerading as a supported operation. This is a regression guard,
    // not just documentation.
    'approveDecisionForOpenBrain',
    'rejectDecisionForOpenBrain',
    'reconsiderDecisionForOpenBrain',
  ]
  for (const forbidden of forbiddenExactNames) {
    assert.ok(!exportedFunctionNames.includes(forbidden), `${forbidden} must not exist`)
  }
})

test('read-only safety: the writable-transaction helper is never part of the public surface', () => {
  assert.ok(
    !('withWriteTransaction' in agentService),
    'withWriteTransaction must stay internal to db.ts/mutations.ts — exporting it would let arbitrary callers open a writable transaction'
  )
})

// Phase 1B: getChiefBrief is a deliberate, explicit exception to "every
// get* function is purely read-only" — it writes exactly one agent.runs
// row per call (its own RUNNING -> SUCCEEDED/FAILED lifecycle record). The
// naming-heuristic test above does NOT catch this (its regex has no "get"
// prefix to flag), so this is a separate, explicit assertion rather than
// relying on the general check to happen to notice.
test('read-only safety: getChiefBrief is the one documented get* exception — it performs no OTHER mutation beyond its own run-lifecycle record (and no reconciliation apply when there is nothing to reconcile)', async () => {
  const { getChiefBrief } = agentService
  const emptyDataSource = {
    needsJerryTasks: async () => [],
    waitingTasks: async () => [],
    blockedTasks: async () => [],
    readyTasks: async () => [],
    pendingRecommendations: async () => [],
    decisionsAwaitingSync: async () => [],
    interactionsRequiringAction: async () => [],
    recentTaskChanges: async () => [],
    recentDecisionEvents: async () => [],
    recentInteractions: async () => [],
    assessReconciliation: async () => [],
    applyReconciliationFinding: async () => {
      throw new Error('must never be called when assessReconciliation finds nothing')
    },
    planActions: async () => [],
  }
  const calls: string[] = []
  const runRepo = {
    getPreviousSuccessfulRunStartedAt: async () => {
      calls.push('getPreviousSuccessfulRunStartedAt')
      return null
    },
    createRunningRun: async () => {
      calls.push('createRunningRun')
      return 'run-1'
    },
    markRunSucceeded: async () => {
      calls.push('markRunSucceeded')
    },
    markRunFailed: async () => {
      calls.push('markRunFailed')
    },
  }
  await getChiefBrief(new Date(), emptyDataSource, runRepo)
  assert.deepEqual(calls, ['getPreviousSuccessfulRunStartedAt', 'createRunningRun', 'markRunSucceeded'], 'only the run-lifecycle sequence — nothing else')
})

const hasDb = Boolean(process.env.AGENT_SERVICE_DATABASE_URL)
const skip = hasDb ? false : 'AGENT_SERVICE_DATABASE_URL not set — skipping live read-only check'

test('read-only safety: the plain read query() helper still cannot write (live check)', { skip }, async () => {
  // Deliberately targets a table agent_service DOES have INSERT on
  // (agent.projects) — if this succeeded, it would prove the session-level
  // read-only default from Phase 0C had regressed. project_key is chosen
  // to be obviously never real, and this must fail before ever reaching
  // the unique constraint, so no cleanup is needed even in principle.
  await assert.rejects(
    () => query("INSERT INTO agent.projects (project_key, name, project_type, status) VALUES ('__readonly_probe__', 'x', 'INTERNAL', 'ACTIVE')"),
    /read-only transaction/i,
    'expected the plain query() helper to reject a write with a read-only-transaction error'
  )
})
