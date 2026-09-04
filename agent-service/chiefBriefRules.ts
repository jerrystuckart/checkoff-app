// Phase 1B — Chief Brief pure computation. No I/O, no database — takes
// already-fetched data and produces a ChiefBrief. Fully unit-testable
// without a DB (mirrors auditRules.ts's split from audit.ts).
//
// PRIORITIZATION: four deterministic tiers (P0-P3), never an opaque score
// — membership by explicit rule, ties broken by relevantAt (staler/older
// first, nulls last), then project key, then title. Same philosophy as
// auditRules.ts's compareFindings().
//
// INTERACTION CLASSIFICATION (Phase 1B design revision): agent.interactions
// has zero live rows to validate a WAITING/NEEDS_RESPONSE/INFORMATIONAL
// split against, `direction` is nullable, and requires_action's own Phase
// 0A doc comment describes an untriaged flag ("the future service layer
// creates a task for it"), not a durable ownership signal. Every
// requires_action=true interaction is therefore surfaced conservatively in
// needsYou at P1, with resolutionOwner-equivalent honesty: it says "needs
// triage," it does not claim to know who owns it.

import type { TaskSummary, JerryTaskSummary, WaitingTaskSummary, BlockedTaskSummary, InteractionSummary, TaskEventSummary, DecisionEventSummary, BlockerRef } from './types'
import type { DecisionPromotionSummary } from './queries'
import type { ChiefBrief, ChiefBriefItem, ChiefBriefBlockedItem, ChiefBriefTier, ResolutionOwner, StaleSignal } from './chiefBriefTypes'
import type { ReconciliationFinding } from './reconciliationTypes'
import type { ActionPlan } from './actionPolicyTypes'

export interface ChiefBriefInputs {
  needsJerryTasks: JerryTaskSummary[]
  waitingTasks: WaitingTaskSummary[]
  blockedTasks: BlockedTaskSummary[]
  readyTasks: TaskSummary[]
  pendingRecommendations: DecisionPromotionSummary[]
  decisionsAwaitingSync: DecisionPromotionSummary[]
  interactionsRequiringAction: InteractionSummary[]
  /** Pass [] when since is null — computeChiefBrief also enforces this itself regardless, so an accidental non-empty array on a first-ever brief is never silently included. */
  recentTaskEvents: TaskEventSummary[]
  recentDecisionEvents: DecisionEventSummary[]
  recentInteractions: InteractionSummary[]
  /**
   * Phase 1C. Findings assessed against the SAME task snapshot passed in
   * needsJerryTasks/waitingTasks/blockedTasks/readyTasks above — i.e. this
   * is the state AFTER any autoApplicable finding was already applied by
   * the caller (chiefBrief.ts), so a task auto-reconciled to DONE never
   * appears in these lists at all (real state change, not a filter here).
   * Findings still present here (non-auto-applied) are used only to
   * derive each item's staleSignal — never to change what section it's in.
   */
  findings: ReconciliationFinding[]
  /**
   * Phase 1D. Pre-computed by the caller (chiefBrief.ts) via
   * selectApplicablePlan() — read-only planning ONLY, never execute() —
   * against the SAME task snapshot as needsJerryTasks/waitingTasks/
   * blockedTasks/readyTasks. One entry per task that has an applicable
   * plan; a task with no registered capability simply has no entry here
   * (see actionHandlers.ts's selectApplicablePlan for the zero/ambiguous
   * -matches-both-mean-no-plan rule).
   */
  actionPlans: ActionPlan[]
}

const TIER_ORDER: Record<ChiefBriefTier, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

function isOverdue(dueAt: Date | null, now: Date): boolean {
  return dueAt !== null && dueAt.getTime() < now.getTime()
}

/**
 * ONLY structured evidence: the blocking task's own status. Never inspects
 * blockerNote text — a free-text note mentioning "Jerry" is not reliable
 * evidence of who must act, per the Phase 1B design revision. No linked
 * blocker task at all is UNKNOWN, not a guess from the note.
 */
export function computeResolutionOwner(blockedBy: BlockerRef | null): ResolutionOwner {
  if (!blockedBy) return 'UNKNOWN'
  switch (blockedBy.status) {
    case 'READY':
    case 'IN_PROGRESS':
      return 'CHIEF'
    case 'NEEDS_JERRY':
      return 'JERRY'
    case 'WAITING':
      return 'EXTERNAL'
    // BACKLOG (not yet triaged), BLOCKED (transitively blocked — avoid
    // recursive guessing beyond one hop), DONE/CANCELED (an active
    // blocker in a terminal state is a data inconsistency, not a signal):
    // all deliberately UNKNOWN rather than a weak inference.
    default:
      return 'UNKNOWN'
  }
}

function blockerReasonFor(task: BlockedTaskSummary): string {
  if (task.blockerNote && task.blockerNote.trim() !== '') return task.blockerNote
  if (task.blockedBy) return `Blocked by "${task.blockedBy.title}" (${task.blockedBy.status})`
  return 'No blocker reason recorded'
}

function compareItems(a: ChiefBriefItem, b: ChiefBriefItem): number {
  if (TIER_ORDER[a.tier] !== TIER_ORDER[b.tier]) return TIER_ORDER[a.tier] - TIER_ORDER[b.tier]
  const aTime = a.relevantAt ? a.relevantAt.getTime() : null
  const bTime = b.relevantAt ? b.relevantAt.getTime() : null
  if (aTime !== bTime) {
    if (aTime === null) return 1
    if (bTime === null) return -1
    return aTime - bTime
  }
  const aProjectKey = a.project?.projectKey ?? ''
  const bProjectKey = b.project?.projectKey ?? ''
  if (aProjectKey !== bProjectKey) return aProjectKey.localeCompare(bProjectKey)
  return a.title.localeCompare(b.title)
}

/**
 * Derived ONLY from a finding's evidenceCategory — never set
 * independently, and deliberately NOT conditioned on autoApplicable here:
 * by the time an item reaches this function, either (a) an autoApplicable
 * COMPLETION_PROOF finding was actually applied by the caller
 * (chiefBrief.ts) and the task already transitioned — it's simply absent
 * from every input list now (real state change), so this function is
 * never even called for it, or (b) it wasn't applied (assessment-only
 * mode, or autoApplicable was false) — in which case PROVABLY_COMPLETE is
 * exactly the right, honest signal either way: something proves this task
 * is done, but the database hasn't caught up yet.
 */
function staleSignalFor(finding: ReconciliationFinding | undefined): StaleSignal {
  if (!finding) return null
  switch (finding.evidenceCategory) {
    case 'SUPERSESSION_PROOF':
      return 'SUPERSEDED_REVIEW'
    case 'AMBIGUOUS':
      return 'POSSIBLY_STALE'
    case 'COMPLETION_PROOF':
      return 'PROVABLY_COMPLETE'
    case 'NO_CHANGE_EVIDENCE':
    default:
      return null
  }
}

function taskItem(task: TaskSummary, tier: ChiefBriefTier, reason: string, finding?: ReconciliationFinding, proposedAction?: ActionPlan): ChiefBriefItem {
  return {
    id: task.id,
    kind: 'task',
    tier,
    title: task.title,
    project: task.project,
    reason,
    relevantAt: task.dueAt ?? task.nextCheckAt ?? task.updatedAt,
    sourceRef: { table: 'agent.tasks', id: task.id },
    staleSignal: staleSignalFor(finding),
    proposedAction: proposedAction ?? null,
  }
}

function decisionItem(d: DecisionPromotionSummary, tier: ChiefBriefTier, reason: string): ChiefBriefItem {
  return {
    id: d.id,
    kind: 'decision',
    tier,
    title: d.decisionKey,
    project: d.project,
    reason,
    relevantAt: d.decidedAt,
    sourceRef: { table: 'agent.decisions', id: d.id },
    staleSignal: null,
    proposedAction: null,
  }
}

function interactionItem(i: InteractionSummary, tier: ChiefBriefTier, reason: string): ChiefBriefItem {
  return {
    id: i.id,
    kind: 'interaction',
    tier,
    title: i.subject ?? `${i.channel} interaction`,
    project: i.project,
    reason,
    relevantAt: i.occurredAt,
    sourceRef: { table: 'agent.interactions', id: i.id },
    staleSignal: null,
    proposedAction: null,
  }
}

export function computeChiefBrief(inputs: ChiefBriefInputs, now: Date, since: Date | null): ChiefBrief {
  const needsYou: ChiefBriefItem[] = []
  const waiting: ChiefBriefItem[] = []
  const chiefCanHandle: ChiefBriefItem[] = []
  const blocked: ChiefBriefBlockedItem[] = []

  const findingsByTaskId = new Map(inputs.findings.map((f) => [f.taskId, f]))
  const actionPlansByTaskId = new Map(inputs.actionPlans.map((p) => [p.taskId, p]))

  for (const t of inputs.needsJerryTasks) {
    needsYou.push(taskItem(t, isOverdue(t.dueAt, now) ? 'P0' : 'P1', t.jerryRequest ?? 'Needs Jerry', findingsByTaskId.get(t.id), actionPlansByTaskId.get(t.id)))
  }

  for (const d of inputs.pendingRecommendations) {
    needsYou.push(decisionItem(d, 'P1', 'Chief recommends this for durable memory — awaiting Jerry approve/reject'))
  }

  for (const i of inputs.interactionsRequiringAction) {
    needsYou.push(interactionItem(i, 'P1', 'Interaction needs triage — schema does not indicate who owns follow-up'))
  }

  for (const t of inputs.waitingTasks) {
    waiting.push(
      taskItem(
        t,
        t.isDueForCheck ? 'P1' : 'P3',
        t.isDueForCheck ? 'Due for check — external follow-up may be going stale' : 'Waiting, not yet due for check',
        findingsByTaskId.get(t.id),
        actionPlansByTaskId.get(t.id)
      )
    )
  }

  for (const t of inputs.readyTasks) {
    chiefCanHandle.push(taskItem(t, isOverdue(t.dueAt, now) ? 'P0' : 'P2', 'Ready for Chief to work', findingsByTaskId.get(t.id), actionPlansByTaskId.get(t.id)))
  }

  for (const d of inputs.decisionsAwaitingSync) {
    chiefCanHandle.push(decisionItem(d, 'P2', 'Approved by Jerry — Chief should sync to Open Brain'))
  }

  for (const t of inputs.blockedTasks) {
    const resolutionOwner = computeResolutionOwner(t.blockedBy)
    const base = taskItem(t, isOverdue(t.dueAt, now) ? 'P0' : 'P1', 'Blocked', findingsByTaskId.get(t.id), actionPlansByTaskId.get(t.id))
    blocked.push({ ...base, blockerReason: blockerReasonFor(t), resolutionOwner })
  }

  needsYou.sort(compareItems)
  waiting.sort(compareItems)
  chiefCanHandle.sort(compareItems)
  blocked.sort(compareItems)

  // Enforced here too, not just by the caller: a first-ever brief (since
  // === null) NEVER reports recent changes, regardless of what inputs were
  // passed — avoids an everything-since-epoch backlog dump by construction,
  // not by caller discipline alone.
  const recentChanges: ChiefBriefItem[] =
    since === null
      ? []
      : [
          ...inputs.recentTaskEvents.map(
            (e): ChiefBriefItem => ({
              id: e.task.id,
              kind: 'task',
              tier: 'P3',
              title: e.task.title,
              project: e.project,
              reason: `${e.eventType}${e.fromStatus && e.toStatus ? `: ${e.fromStatus} -> ${e.toStatus}` : ''}`,
              relevantAt: e.changedAt,
              sourceRef: { table: 'agent.tasks', id: e.task.id },
              staleSignal: null,
              proposedAction: null,
            })
          ),
          ...inputs.recentDecisionEvents.map(
            (e): ChiefBriefItem => ({
              id: e.decision.id,
              kind: 'decision',
              tier: 'P3',
              title: e.decision.decisionKey,
              project: null,
              reason: e.eventType,
              relevantAt: e.occurredAt,
              sourceRef: { table: 'agent.decisions', id: e.decision.id },
              staleSignal: null,
              proposedAction: null,
            })
          ),
          ...inputs.recentInteractions.map((i) => interactionItem(i, 'P3', 'New interaction logged')),
        ].sort(compareItems)

  return {
    generatedAt: now,
    since,
    needsYou,
    waiting,
    chiefCanHandle,
    blocked,
    recentChanges,
    summary: {
      needsYouCount: needsYou.length,
      waitingCount: waiting.length,
      chiefCanHandleCount: chiefCanHandle.length,
      blockedCount: blocked.length,
      recentChangesCount: recentChanges.length,
    },
  }
}
