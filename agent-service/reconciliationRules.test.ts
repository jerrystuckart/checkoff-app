// Phase 1C — reconciliationRules.ts unit tests. Pure computation, no DB
// query is ever actually run (the injected reader is only invoked by a
// rule's own assess(), and these tests define their own trivial/fake
// rules rather than relying on RECONCILIATION_RULES, which is empty by
// design in production).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessTask, assessTasks, type ReconciliationRule, type ReconciliationReader } from './reconciliationRules'
import * as reconciliationRulesModule from './reconciliationRules'
import type { TaskSummary } from './types'

function makeTask(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 'task-1',
    title: 'A task',
    description: null,
    status: 'READY',
    priority: null,
    project: null,
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
    projectType: null,
    ...overrides,
  }
}

const noopReader: ReconciliationReader = { query: async () => [] }

test('production registry is empty by design', () => {
  assert.deepEqual(reconciliationRulesModule.RECONCILIATION_RULES, [])
})

test('no rule registered for this sourceRef -> NO_CHANGE_EVIDENCE, not autoApplicable', async () => {
  const task = makeTask({ sourceRef: 'no-rule-exists-for-this' })
  const finding = await assessTask(task, noopReader)
  assert.equal(finding.evidenceCategory, 'NO_CHANGE_EVIDENCE')
  assert.equal(finding.recommendedStatus, null)
  assert.equal(finding.autoApplicable, false)
})

test('task with no sourceRef at all -> NO_CHANGE_EVIDENCE (never matched against raw id)', async () => {
  const task = makeTask({ sourceRef: null })
  const finding = await assessTask(task, noopReader)
  assert.equal(finding.evidenceCategory, 'NO_CHANGE_EVIDENCE')
  assert.equal(finding.autoApplicable, false)
})

test('a DONE task is never reconciled — NO_CHANGE_EVIDENCE, terminal state short-circuit', async () => {
  const task = makeTask({ status: 'DONE' })
  const finding = await assessTask(task, noopReader)
  assert.equal(finding.evidenceCategory, 'NO_CHANGE_EVIDENCE')
  assert.equal(finding.reason, 'Task is already in a terminal state — nothing to reconcile.')
  assert.equal(finding.autoApplicable, false)
})

test('a CANCELED task is never reconciled — same terminal-state short-circuit', async () => {
  const task = makeTask({ status: 'CANCELED' })
  const finding = await assessTask(task, noopReader)
  assert.equal(finding.evidenceCategory, 'NO_CHANGE_EVIDENCE')
  assert.equal(finding.autoApplicable, false)
})

// ---------------------------------------------------------------------------
// Item 9: completion proof can be auto-applied ONLY when an explicit rule
// exists — proven here by testing assessTask against a locally-defined
// rule set (via a private helper), never by mutating the production
// RECONCILIATION_RULES array.
// ---------------------------------------------------------------------------

function withRules<T>(rules: ReconciliationRule[], fn: () => Promise<T>): Promise<T> {
  // RECONCILIATION_RULES is declared `const` and exported directly — tests
  // splice its contents in place for the duration of the callback rather
  // than reassigning the binding (which isn't possible for a const
  // export), then restore it. This is test-only mutation of a
  // deliberately-empty production array — always restored, never left
  // populated for a later test.
  const original = [...reconciliationRulesModule.RECONCILIATION_RULES]
  reconciliationRulesModule.RECONCILIATION_RULES.splice(0, reconciliationRulesModule.RECONCILIATION_RULES.length, ...rules)
  return fn().finally(() => {
    reconciliationRulesModule.RECONCILIATION_RULES.splice(0, reconciliationRulesModule.RECONCILIATION_RULES.length, ...original)
  })
}

test('completion proof is autoApplicable when an explicit rule exists and the transition is allowed', async () => {
  const rule: ReconciliationRule = {
    id: 'test-completion-rule',
    description: 'test',
    sourceRef: 'has-a-rule',
    async assess() {
      return {
        recommendedStatus: 'DONE',
        evidenceCategory: 'COMPLETION_PROOF',
        confidence: 'HIGH',
        evidenceSources: ['test:structured-evidence'],
        reason: 'Literal acceptance condition proven',
      }
    },
  }
  await withRules([rule], async () => {
    const task = makeTask({ sourceRef: 'has-a-rule', status: 'READY' })
    const finding = await assessTask(task, noopReader)
    assert.equal(finding.evidenceCategory, 'COMPLETION_PROOF')
    assert.equal(finding.recommendedStatus, 'DONE')
    assert.equal(finding.autoApplicable, true)
  })
})

test('completion proof is NOT autoApplicable when the resulting transition is not permitted by the state machine', async () => {
  const rule: ReconciliationRule = {
    id: 'test-bad-transition-rule',
    description: 'test',
    sourceRef: 'has-a-bad-rule',
    async assess() {
      // DONE -> DONE is not a valid entry in ALLOWED_TRANSITIONS (DONE has
      // no outgoing transitions at all — it's terminal), so even a
      // COMPLETION_PROOF result here must not be autoApplicable... but
      // the terminal-state short-circuit in assessTask already prevents
      // DONE tasks from reaching a rule at all, so use a case where the
      // FROM status genuinely disallows the recommended TO status instead:
      // there is no such case in the current ALLOWED_TRANSITIONS map for
      // any non-terminal status (every non-terminal status allows DONE),
      // so this exercises the same code path with a status that IS
      // reachable — BACKLOG only allows READY/CANCELED, never DONE
      // directly.
      return {
        recommendedStatus: 'DONE',
        evidenceCategory: 'COMPLETION_PROOF',
        confidence: 'HIGH',
        evidenceSources: ['test:structured-evidence'],
        reason: 'Claims completion but the task is still in BACKLOG',
      }
    },
  }
  await withRules([rule], async () => {
    const task = makeTask({ sourceRef: 'has-a-bad-rule', status: 'BACKLOG' })
    const finding = await assessTask(task, noopReader)
    assert.equal(finding.evidenceCategory, 'COMPLETION_PROOF')
    assert.equal(finding.autoApplicable, false, 'BACKLOG -> DONE is not an allowed transition')
  })
})

test('SUPERSESSION_PROOF from a rule is never autoApplicable, regardless of confidence', async () => {
  const rule: ReconciliationRule = {
    id: 'test-supersession-rule',
    description: 'test',
    sourceRef: 'superseded-task',
    async assess() {
      return {
        recommendedStatus: 'CANCELED',
        evidenceCategory: 'SUPERSESSION_PROOF',
        confidence: 'HIGH',
        evidenceSources: ['docs/some-architectural-decision.sql'],
        reason: 'Superseded by later architecture',
      }
    },
  }
  await withRules([rule], async () => {
    const task = makeTask({ sourceRef: 'superseded-task', status: 'READY' })
    const finding = await assessTask(task, noopReader)
    assert.equal(finding.evidenceCategory, 'SUPERSESSION_PROOF')
    assert.equal(finding.autoApplicable, false, 'SUPERSESSION_PROOF must never be autoApplicable, even at HIGH confidence with a recommended status')
  })
})

test('AMBIGUOUS from a rule is never autoApplicable', async () => {
  const rule: ReconciliationRule = {
    id: 'test-ambiguous-rule',
    description: 'test',
    sourceRef: 'ambiguous-task',
    async assess() {
      return {
        recommendedStatus: null,
        evidenceCategory: 'AMBIGUOUS',
        confidence: 'LOW',
        evidenceSources: ['test:inconclusive'],
        reason: 'Evidence exists but proves neither completion nor supersession',
      }
    },
  }
  await withRules([rule], async () => {
    const task = makeTask({ sourceRef: 'ambiguous-task', status: 'READY' })
    const finding = await assessTask(task, noopReader)
    assert.equal(finding.evidenceCategory, 'AMBIGUOUS')
    assert.equal(finding.autoApplicable, false)
  })
})

test('NO_CHANGE_EVIDENCE from a rule performs no transition (recommendedStatus null, never autoApplicable)', async () => {
  const rule: ReconciliationRule = {
    id: 'test-no-change-rule',
    description: 'test',
    sourceRef: 'no-change-task',
    async assess() {
      return {
        recommendedStatus: null,
        evidenceCategory: 'NO_CHANGE_EVIDENCE',
        confidence: 'HIGH',
        evidenceSources: [],
        reason: 'No evidence of execution found — preserve current state',
      }
    },
  }
  await withRules([rule], async () => {
    const task = makeTask({ sourceRef: 'no-change-task', status: 'READY' })
    const finding = await assessTask(task, noopReader)
    assert.equal(finding.evidenceCategory, 'NO_CHANGE_EVIDENCE')
    assert.equal(finding.recommendedStatus, null)
    assert.equal(finding.autoApplicable, false)
  })
})

test('related-but-not-literal evidence: a rule matched by sourceRef but whose evidence is about a DIFFERENT capability must still be reviewed by a human — this test documents the expectation at the framework level: the framework itself cannot detect "wrong evidence," that is a rule-authoring/code-review responsibility, but it CAN and does still gate autoApplicable behind an explicit rule + allowed transition, which is the structural half of the guard', async () => {
  // This is the canonical counter-example from the Phase 1C audit: a
  // hypothetical rule for open-brain-chatgpt-reconnect that (incorrectly)
  // treated "standalone Chief -> Open Brain works" as COMPLETION_PROOF for
  // "ChatGPT's own direct connection was repaired" would still pass the
  // structural checks here (rule exists, transition allowed) — the actual
  // fix was catching this at rule-authoring time (this task's real outcome
  // is SUPERSESSION_PROOF, not COMPLETION_PROOF, per the corrected audit),
  // never at assessTask's level. No RECONCILIATION_RULES entry exists for
  // this task's real sourceRef today — asserting that directly.
  const rule = reconciliationRulesModule.RECONCILIATION_RULES.find((r) => r.sourceRef === 'open-brain-chatgpt-reconnect')
  assert.equal(rule, undefined, 'no auto-applicable rule must exist for the superseded ChatGPT reconnect task')
})

test('assessTasks assesses a batch and preserves task-to-finding correspondence', async () => {
  const tasks = [makeTask({ id: 'a', sourceRef: 'x' }), makeTask({ id: 'b', sourceRef: 'y', status: 'DONE' })]
  const findings = await assessTasks(tasks, noopReader)
  assert.equal(findings.length, 2)
  assert.equal(findings[0].taskId, 'a')
  assert.equal(findings[1].taskId, 'b')
  assert.equal(findings[1].evidenceCategory, 'NO_CHANGE_EVIDENCE')
})
