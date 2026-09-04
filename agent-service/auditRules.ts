// Phase 0E — pure computation logic for the Chief Audit / Exception
// Report. NO DATABASE ACCESS ANYWHERE IN THIS FILE — every function here
// takes already-fetched ProjectSummary[]/TaskSummary[] and returns
// findings deterministically. This is deliberate: it makes the entire
// anomaly-detection surface unit-testable with plain fixture objects,
// with zero dependency on a live database (see audit.test.ts).
//
// WHY THESE CHECKS AND NOT OTHERS (Phase 0E spec point 4 — don't
// reimplement Phase 0A's CHECK constraints as audit noise): every check
// below verifies something the schema does NOT and cannot prevent —
// - Stale IN_PROGRESS/READY: the schema has no concept of "too long,"
//   only of valid states.
// - ACTIVE project / no open tasks, ON_HOLD project / active work,
//   terminal project / open tasks: agent.projects and agent.tasks have no
//   FK or CHECK linking a project's status to its tasks' statuses at all.
// - Blocker is terminal, self-blocker, blocker cycles: blocked_by_task_id
//   is a plain FK to agent.tasks(id) — Postgres has no way to express
//   "not equal to the referencing row's own id" or "not part of a cycle"
//   as a CHECK constraint. Phase 0D's transitionTask() rejects a
//   self-block AT THE MOMENT of an application-mediated transition, but
//   rows written any other way (a future direct SQL correction, a bug)
//   are not protected by that — hence checking for it here too.
// None of these are "conditions that cannot legally exist" per Phase 0A's
// own constraints; that's exactly why they belong in an audit instead of
// being noise.

import type { ProjectSummary, TaskSummary, TaskStatus } from './types'
import {
  DEFAULT_STALE_IN_PROGRESS_DAYS,
  DEFAULT_STALE_READY_DAYS,
  type AttentionCode,
  type ExceptionCode,
  type AuditFinding,
  type FindingRef,
  type FindingSeverity,
  type ProjectHealth,
  type ProjectHealthCounts,
  type ChiefAuditReport,
  type ChiefAuditOptions,
} from './auditTypes'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const TERMINAL_STATUSES: readonly TaskStatus[] = ['DONE', 'CANCELED']
const ACTIVE_WORK_STATUSES: readonly TaskStatus[] = ['READY', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'NEEDS_JERRY']

function isOpen(status: TaskStatus): boolean {
  return !TERMINAL_STATUSES.includes(status)
}

function taskRef(task: TaskSummary): FindingRef {
  return { id: task.id, key: null, title: task.title }
}

function projectRef(project: ProjectSummary): FindingRef {
  return { id: project.id, key: project.projectKey, title: project.name }
}

function projectRefFromTaskProject(p: TaskSummary['project']): FindingRef | null {
  if (!p) return null
  return { id: p.id, key: p.projectKey, title: p.name }
}

// ---------------------------------------------------------------------------
// Attention — valid operational work, not anomalies.
// ---------------------------------------------------------------------------

export function computeAttentionFindings(tasks: TaskSummary[], now: Date): AuditFinding[] {
  const findings: AuditFinding[] = []

  for (const task of tasks) {
    const project = projectRefFromTaskProject(task.project)
    const ref = taskRef(task)

    if (task.status === 'NEEDS_JERRY') {
      findings.push({
        code: 'TASK_NEEDS_JERRY',
        severity: 'HIGH',
        entityType: 'task',
        entityId: task.id,
        project,
        task: ref,
        message: `"${task.title}" needs Jerry: ${task.jerryRequest ?? '(no request recorded)'}`,
        relevantAt: task.dueAt,
        metadata: { jerryRequest: task.jerryRequest },
      })
    }

    if (task.dueAt !== null && task.dueAt.getTime() < now.getTime() && isOpen(task.status)) {
      findings.push({
        code: 'TASK_OVERDUE',
        severity: 'HIGH',
        entityType: 'task',
        entityId: task.id,
        project,
        task: ref,
        message: `"${task.title}" is overdue (due ${task.dueAt.toISOString()})`,
        relevantAt: task.dueAt,
        metadata: { dueAt: task.dueAt.toISOString(), status: task.status },
      })
    }

    if (task.status === 'WAITING' && task.nextCheckAt !== null && task.nextCheckAt.getTime() <= now.getTime()) {
      findings.push({
        code: 'WAITING_DUE_FOR_CHECK',
        severity: 'MEDIUM',
        entityType: 'task',
        entityId: task.id,
        project,
        task: ref,
        message: `"${task.title}" is due for check (next check was ${task.nextCheckAt.toISOString()})`,
        relevantAt: task.nextCheckAt,
        metadata: { nextCheckAt: task.nextCheckAt.toISOString() },
      })
    }

    if (task.status === 'READY') {
      findings.push({
        code: 'TASK_READY',
        severity: 'LOW',
        entityType: 'task',
        entityId: task.id,
        project,
        task: ref,
        message: `"${task.title}" is ready for work`,
        relevantAt: null,
        metadata: {},
      })
    }

    if (task.status === 'BLOCKED') {
      const blockerDesc = task.blockedBy
        ? `blocked by "${task.blockedBy.title}" (${task.blockedBy.status})`
        : task.blockerNote
          ? `blocked: ${task.blockerNote}`
          : 'blocked (no reason recorded)'
      findings.push({
        code: 'TASK_BLOCKED',
        severity: 'MEDIUM',
        entityType: 'task',
        entityId: task.id,
        project,
        task: ref,
        message: `"${task.title}" is ${blockerDesc}`,
        relevantAt: null,
        metadata: {
          blockedByTaskId: task.blockedBy?.id ?? null,
          blockedByTitle: task.blockedBy?.title ?? null,
          blockedByStatus: task.blockedBy?.status ?? null,
          blockerNote: task.blockerNote,
        },
      })
    }
  }

  return findings
}

// ---------------------------------------------------------------------------
// Blocker cycle detection. blocked_by_task_id gives every task out-degree
// <= 1, so this is a functional graph — cycle detection is a single
// linear walk per unvisited node (like linked-list cycle detection), not
// general graph traversal. Iterating tasks in a fixed (id-sorted) order
// and marking every node visited as soon as its chain is walked — whether
// or not it turned out to be part of a cycle — guarantees each cycle is
// discovered exactly once, from whichever of its members happens to sort
// first: no other member re-triggers it, because by the time it's
// iterated it's already marked visited. That's the entire
// deduplication mechanism; no separate "seen cycles" set is needed.
//
// A length-1 "cycle" (a task blocking itself) is deliberately excluded
// here and left to the separate, dedicated TASK_BLOCKS_ITSELF check —
// the spec lists them as distinct codes, and reporting a self-block as
// BOTH would double up on the same underlying fact.
// ---------------------------------------------------------------------------

export function computeBlockerCycles(tasks: TaskSummary[]): AuditFinding[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const visited = new Set<string>()
  const findings: AuditFinding[] = []

  const sortedStartPoints = [...tasks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const start of sortedStartPoints) {
    if (visited.has(start.id)) continue

    const path: TaskSummary[] = []
    const pathIndex = new Map<string, number>()
    let current: TaskSummary | undefined = start

    while (current && !visited.has(current.id) && !pathIndex.has(current.id)) {
      pathIndex.set(current.id, path.length)
      path.push(current)
      const nextId: string | null = current.blockedBy?.id ?? null
      current = nextId ? byId.get(nextId) : undefined
    }

    if (current && pathIndex.has(current.id)) {
      const cycleStart = pathIndex.get(current.id) as number
      const cycle = path.slice(cycleStart)
      if (cycle.length >= 2) {
        const sortedCycle = [...cycle].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        const primary = sortedCycle[0]
        findings.push({
          code: 'BLOCKER_CYCLE',
          severity: 'HIGH',
          entityType: 'task',
          entityId: primary.id,
          project: projectRefFromTaskProject(primary.project),
          task: taskRef(primary),
          message: `Blocker cycle detected among ${cycle.length} tasks: ${sortedCycle.map((t) => `"${t.title}"`).join(' -> ')}`,
          relevantAt: null,
          metadata: {
            cycle: sortedCycle.map((t) => ({ id: t.id, title: t.title, status: t.status })),
          },
        })
      }
    }

    for (const t of path) visited.add(t.id)
  }

  return findings
}

// ---------------------------------------------------------------------------
// Exceptions — operationally stale or inconsistent state.
// ---------------------------------------------------------------------------

export function computeExceptionFindings(
  projects: ProjectSummary[],
  tasks: TaskSummary[],
  now: Date,
  staleInProgressDays: number,
  staleReadyDays: number
): AuditFinding[] {
  const findings: AuditFinding[] = []

  const tasksByProjectId = new Map<string, TaskSummary[]>()
  for (const t of tasks) {
    if (!t.project) continue
    const list = tasksByProjectId.get(t.project.id) ?? []
    list.push(t)
    tasksByProjectId.set(t.project.id, list)
  }

  for (const task of tasks) {
    const project = projectRefFromTaskProject(task.project)
    const ref = taskRef(task)
    const ageDays = (now.getTime() - task.updatedAt.getTime()) / MS_PER_DAY

    if (task.status === 'IN_PROGRESS' && ageDays > staleInProgressDays) {
      findings.push({
        code: 'IN_PROGRESS_STALE',
        severity: 'MEDIUM',
        entityType: 'task',
        entityId: task.id,
        project,
        task: ref,
        message: `"${task.title}" has been IN_PROGRESS for ${Math.floor(ageDays)} day(s) with no update (threshold ${staleInProgressDays})`,
        relevantAt: task.updatedAt,
        metadata: { updatedAt: task.updatedAt.toISOString(), ageDays: Math.floor(ageDays), thresholdDays: staleInProgressDays },
      })
    }

    if (task.status === 'READY' && ageDays > staleReadyDays) {
      findings.push({
        code: 'READY_STALE',
        severity: 'LOW',
        entityType: 'task',
        entityId: task.id,
        project,
        task: ref,
        message: `"${task.title}" has been READY for ${Math.floor(ageDays)} day(s) with no update (threshold ${staleReadyDays})`,
        relevantAt: task.updatedAt,
        metadata: { updatedAt: task.updatedAt.toISOString(), ageDays: Math.floor(ageDays), thresholdDays: staleReadyDays },
      })
    }

    if (task.blockedBy && task.blockedBy.id === task.id) {
      findings.push({
        code: 'TASK_BLOCKS_ITSELF',
        severity: 'HIGH',
        entityType: 'task',
        entityId: task.id,
        project,
        task: ref,
        message: `"${task.title}" is recorded as blocking itself`,
        relevantAt: null,
        metadata: {},
      })
    }

    if (task.status === 'BLOCKED' && task.blockedBy && TERMINAL_STATUSES.includes(task.blockedBy.status)) {
      findings.push({
        code: 'BLOCKER_IS_TERMINAL',
        severity: 'MEDIUM',
        entityType: 'task',
        entityId: task.id,
        project,
        task: ref,
        message: `"${task.title}" is BLOCKED by "${task.blockedBy.title}", which is already ${task.blockedBy.status} — reconsider this task's status`,
        relevantAt: null,
        metadata: { blockedByTaskId: task.blockedBy.id, blockedByTitle: task.blockedBy.title, blockedByStatus: task.blockedBy.status },
      })
    }
  }

  for (const project of projects) {
    const projectTasks = tasksByProjectId.get(project.id) ?? []
    const openTasks = projectTasks.filter((t) => isOpen(t.status))
    const ref = projectRef(project)

    if (project.status === 'ACTIVE' && openTasks.length === 0) {
      findings.push({
        code: 'ACTIVE_PROJECT_NO_OPEN_TASKS',
        severity: 'INFO',
        entityType: 'project',
        entityId: project.id,
        project: ref,
        task: null,
        message: `"${project.name}" is ACTIVE with no open tasks`,
        relevantAt: null,
        metadata: { totalTasks: projectTasks.length },
      })
    }

    if (project.status === 'ON_HOLD') {
      const activeWork = projectTasks.filter((t) => ACTIVE_WORK_STATUSES.includes(t.status))
      if (activeWork.length > 0) {
        findings.push({
          code: 'ON_HOLD_PROJECT_HAS_ACTIVE_WORK',
          severity: 'MEDIUM',
          entityType: 'project',
          entityId: project.id,
          project: ref,
          task: null,
          message: `"${project.name}" is ON_HOLD but has ${activeWork.length} task(s) in active-work status`,
          relevantAt: null,
          metadata: { taskIds: activeWork.map((t) => t.id), statuses: activeWork.map((t) => t.status) },
        })
      }
    }

    if (project.status === 'COMPLETED' || project.status === 'CANCELED') {
      if (openTasks.length > 0) {
        findings.push({
          code: 'TERMINAL_PROJECT_HAS_OPEN_TASKS',
          severity: 'HIGH',
          entityType: 'project',
          entityId: project.id,
          project: ref,
          task: null,
          message: `"${project.name}" is ${project.status} but has ${openTasks.length} non-terminal task(s)`,
          relevantAt: null,
          metadata: { taskIds: openTasks.map((t) => t.id), statuses: openTasks.map((t) => t.status) },
        })
      }
    }
  }

  findings.push(...computeBlockerCycles(tasks))

  return findings
}

// ---------------------------------------------------------------------------
// Deterministic sort — see Phase 0E spec point 6.
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<FindingSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 }

export function compareFindings(a: AuditFinding, b: AuditFinding): number {
  if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  }
  const aTime = a.relevantAt ? a.relevantAt.getTime() : null
  const bTime = b.relevantAt ? b.relevantAt.getTime() : null
  if (aTime !== bTime) {
    if (aTime === null) return 1
    if (bTime === null) return -1
    return aTime - bTime
  }
  const aProjectKey = a.project?.key ?? ''
  const bProjectKey = b.project?.key ?? ''
  if (aProjectKey !== bProjectKey) return aProjectKey.localeCompare(bProjectKey)
  const aTaskTitle = a.task?.title ?? ''
  const bTaskTitle = b.task?.title ?? ''
  if (aTaskTitle !== bTaskTitle) return aTaskTitle.localeCompare(bTaskTitle)
  return a.code.localeCompare(b.code)
}

// ---------------------------------------------------------------------------
// Project health — deterministic counts, no manufactured score.
// ---------------------------------------------------------------------------

export function computeProjectHealth(
  projects: ProjectSummary[],
  tasks: TaskSummary[],
  now: Date,
  exceptionFindings: AuditFinding[]
): ProjectHealth[] {
  const tasksByProjectId = new Map<string, TaskSummary[]>()
  for (const t of tasks) {
    if (!t.project) continue
    const list = tasksByProjectId.get(t.project.id) ?? []
    list.push(t)
    tasksByProjectId.set(t.project.id, list)
  }

  const flagsByProjectId = new Map<string, ExceptionCode[]>()
  for (const f of exceptionFindings) {
    if (f.entityType === 'project') {
      const list = flagsByProjectId.get(f.entityId) ?? []
      list.push(f.code as ExceptionCode)
      flagsByProjectId.set(f.entityId, list)
    }
  }

  return projects
    .filter((p) => p.status === 'ACTIVE' || p.status === 'ON_HOLD')
    .map((project) => {
      const projectTasks = tasksByProjectId.get(project.id) ?? []
      const counts: ProjectHealthCounts = {
        open: projectTasks.filter((t) => isOpen(t.status)).length,
        ready: projectTasks.filter((t) => t.status === 'READY').length,
        inProgress: projectTasks.filter((t) => t.status === 'IN_PROGRESS').length,
        waiting: projectTasks.filter((t) => t.status === 'WAITING').length,
        blocked: projectTasks.filter((t) => t.status === 'BLOCKED').length,
        needsJerry: projectTasks.filter((t) => t.status === 'NEEDS_JERRY').length,
        overdue: projectTasks.filter((t) => t.dueAt !== null && t.dueAt.getTime() < now.getTime() && isOpen(t.status)).length,
        dueForCheck: projectTasks.filter((t) => t.status === 'WAITING' && t.nextCheckAt !== null && t.nextCheckAt.getTime() <= now.getTime())
          .length,
      }
      return {
        project: projectRef(project),
        counts,
        flags: flagsByProjectId.get(project.id) ?? [],
      }
    })
    .sort((a, b) => (a.project.key ?? '').localeCompare(b.project.key ?? ''))
}

// ---------------------------------------------------------------------------
// Top-level composition.
// ---------------------------------------------------------------------------

export function computeChiefAuditReport(
  projects: ProjectSummary[],
  tasks: TaskSummary[],
  options: ChiefAuditOptions = {}
): ChiefAuditReport {
  const now = options.now ?? new Date()
  const staleInProgressDays = options.staleInProgressDays ?? DEFAULT_STALE_IN_PROGRESS_DAYS
  const staleReadyDays = options.staleReadyDays ?? DEFAULT_STALE_READY_DAYS

  const attention = computeAttentionFindings(tasks, now).sort(compareFindings)
  const exceptions = computeExceptionFindings(projects, tasks, now, staleInProgressDays, staleReadyDays).sort(compareFindings)
  const projectHealth = computeProjectHealth(projects, tasks, now, exceptions)

  const attentionByCode: Partial<Record<AttentionCode, number>> = {}
  for (const f of attention) {
    const code = f.code as AttentionCode
    attentionByCode[code] = (attentionByCode[code] ?? 0) + 1
  }
  const exceptionByCode: Partial<Record<ExceptionCode, number>> = {}
  for (const f of exceptions) {
    const code = f.code as ExceptionCode
    exceptionByCode[code] = (exceptionByCode[code] ?? 0) + 1
  }

  const uniqueTasksNeedingAttention = new Set(attention.filter((f) => f.entityType === 'task').map((f) => f.entityId)).size

  return {
    generatedAt: now,
    summary: {
      generatedAt: now,
      attentionFindingCount: attention.length,
      uniqueTasksNeedingAttention,
      attentionByCode,
      exceptionFindingCount: exceptions.length,
      exceptionByCode,
    },
    attention,
    exceptions,
    projectHealth,
  }
}
