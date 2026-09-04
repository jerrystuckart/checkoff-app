// Chief Phase 2F — the production PlaybookRunStore. Exact same pattern
// as dbExecutionStore.ts: one agent.tasks row per run
// (source_type='playbook_run', source_ref=runId), every put() recorded
// as a PLAYBOOK_STAGE task_events snapshot (metadata.evidence.snapshot)
// which is what get() actually reads back — no new table.

import { createTask, transitionTask, recordPlaybookStage } from '../mutations'
import { getTaskBySource, getTaskEventsForTask } from '../queries'
import type { PlaybookRunStore, PlaybookRunRecord } from './playbookRun'
import type { TaskStatus } from '../types'

export const PLAYBOOK_RUN_SOURCE_TYPE = 'playbook_run'
/** The owner every playbook-run task is created/transitioned under — Chief itself, not any one specialist (a run spans many). */
export const DRIVER_OWNER_KEY = 'chief'

export function taskStatusForRunStatus(status: PlaybookRunRecord['status']): TaskStatus {
  switch (status) {
    case 'RUNNING':
      return 'IN_PROGRESS'
    case 'WAITING':
      return 'WAITING'
    case 'NEEDS_JERRY':
      return 'NEEDS_JERRY'
    case 'BLOCKED':
      return 'BLOCKED'
    case 'DONE':
      return 'DONE'
    case 'PAUSED':
      return 'BLOCKED'
  }
}

interface SnapshotEvidence {
  snapshot: PlaybookRunRecord
}
function isSnapshotEvidence(evidence: unknown): evidence is SnapshotEvidence {
  return typeof evidence === 'object' && evidence !== null && 'snapshot' in evidence
}

export interface DbPlaybookRunStoreDeps {
  createTask: typeof createTask
  transitionTask: typeof transitionTask
  recordPlaybookStage: typeof recordPlaybookStage
  getTaskBySource: typeof getTaskBySource
  getTaskEventsForTask: typeof getTaskEventsForTask
}

const REAL_DEPS: DbPlaybookRunStoreDeps = { createTask, transitionTask, recordPlaybookStage, getTaskBySource, getTaskEventsForTask }

export class DbPlaybookRunStore implements PlaybookRunStore {
  constructor(private readonly deps: DbPlaybookRunStoreDeps = REAL_DEPS) {}

  async get(runId: string): Promise<PlaybookRunRecord | undefined> {
    const task = await this.deps.getTaskBySource(PLAYBOOK_RUN_SOURCE_TYPE, runId)
    if (!task) return undefined
    const events = await this.deps.getTaskEventsForTask(task.id)
    for (let i = events.length - 1; i >= 0; i--) {
      const evidence = events[i].metadata?.evidence
      if (isSnapshotEvidence(evidence)) return evidence.snapshot
    }
    return undefined
  }

  async put(record: PlaybookRunRecord): Promise<void> {
    const targetStatus = taskStatusForRunStatus(record.status)
    const existing = await this.deps.getTaskBySource(PLAYBOOK_RUN_SOURCE_TYPE, record.runId)
    const snapshotKeySuffix = `${record.status}:${record.currentStage}:${record.loopIteration}:${record.totalRetries}:${record.updatedAt}`

    if (!existing) {
      const created = await this.deps.createTask({
        title: `[playbook run] ${record.playbookKey} — ${record.projectId}`.slice(0, 500),
        projectKey: record.projectId,
        status: targetStatus,
        changedByOwnerKey: DRIVER_OWNER_KEY,
        ownerKey: DRIVER_OWNER_KEY,
        description: `Chief orchestration driver run for playbook "${record.playbookKey}".`,
        nextAction: `advance stage ${record.currentStage}`,
        blockerNote: targetStatus === 'BLOCKED' ? (record.jerryReason ?? `run status ${record.status}`) : undefined,
        jerryRequest: targetStatus === 'NEEDS_JERRY' ? (record.jerryReason ?? 'decision required') : undefined,
        sourceType: PLAYBOOK_RUN_SOURCE_TYPE,
        sourceRef: record.runId,
      })
      await this.deps.recordPlaybookStage({
        taskId: created.task.id,
        playbookKey: record.playbookKey,
        stage: record.currentStage,
        actorOwnerKey: DRIVER_OWNER_KEY,
        idempotencyKey: `run-snapshot:${record.runId}:${snapshotKeySuffix}`,
        evidence: { snapshot: record },
        note: `playbook run ${record.runId} registered`,
      })
      return
    }

    if (existing.status !== targetStatus) {
      await this.deps.transitionTask({
        taskId: existing.id,
        toStatus: targetStatus,
        actorOwnerKey: DRIVER_OWNER_KEY,
        expectedUpdatedAt: existing.updatedAt,
        ownerKey: DRIVER_OWNER_KEY,
        nextAction: `advance stage ${record.currentStage}`,
        nextCheckAt: targetStatus === 'WAITING' ? new Date(Date.now() + 60 * 60 * 1000) : undefined,
        blockerNote: targetStatus === 'BLOCKED' ? (record.jerryReason ?? `run status ${record.status}`) : undefined,
        jerryRequest: targetStatus === 'NEEDS_JERRY' ? (record.jerryReason ?? 'decision required') : undefined,
        idempotencyKey: `run-status:${record.runId}:${snapshotKeySuffix}`,
        playbookStage: { playbookKey: record.playbookKey, stage: record.currentStage },
      })
    }

    await this.deps.recordPlaybookStage({
      taskId: existing.id,
      playbookKey: record.playbookKey,
      stage: record.currentStage,
      actorOwnerKey: DRIVER_OWNER_KEY,
      idempotencyKey: `run-snapshot:${record.runId}:${snapshotKeySuffix}`,
      evidence: { snapshot: record },
    })
  }
}
