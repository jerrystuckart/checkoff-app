// Centralized, deterministic task lifecycle rules. Pure functions only —
// no database access anywhere in this file — so the lifecycle rules can be
// reasoned about (and tested) independently of any I/O.

import type { TaskStatus } from './types'
import { InvalidTransitionError, InvalidStateFieldsError } from './errors'

// The lifecycle given in the Phase 0D spec. DONE and CANCELED are terminal
// in this phase — that emptiness IS the explicit policy for "leaving
// DONE/CANCELED," not an oversight. If a future phase needs to reopen a
// DONE/CANCELED task, that's a deliberate, separate design decision, not
// something this map should drift into silently.
export const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = Object.freeze({
  BACKLOG: ['READY', 'CANCELED'],
  READY: ['IN_PROGRESS', 'WAITING', 'BLOCKED', 'NEEDS_JERRY', 'DONE', 'CANCELED'],
  IN_PROGRESS: ['READY', 'WAITING', 'BLOCKED', 'NEEDS_JERRY', 'DONE', 'CANCELED'],
  WAITING: ['READY', 'IN_PROGRESS', 'BLOCKED', 'NEEDS_JERRY', 'DONE', 'CANCELED'],
  BLOCKED: ['READY', 'IN_PROGRESS', 'WAITING', 'NEEDS_JERRY', 'DONE', 'CANCELED'],
  NEEDS_JERRY: ['READY', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'DONE', 'CANCELED'],
  DONE: [],
  CANCELED: [],
})

/**
 * Same-status "transitions" are handled separately by callers as an
 * idempotent no-op (see mutations.ts transitionTask) — they are
 * deliberately NOT valid entries in this map, so a genuine attempt to
 * re-run READY -> READY through this function is rejected here, while
 * mutations.ts short-circuits before ever calling this when
 * from === to (the retry-safety case).
 */
export function assertTransitionAllowed(from: TaskStatus, to: TaskStatus): void {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new InvalidTransitionError(from, to)
  }
}

export function isMeaningful(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** Fields relevant to state-specific validation/cleanup — a subset of Task, using resolved ids rather than caller-supplied keys. */
export interface TaskStateFields {
  status: TaskStatus
  nextAction: string | null
  nextCheckAt: Date | null
  blockedByTaskId: string | null
  blockerNote: string | null
  jerryRequest: string | null
  ownerId: string | null
  startedAt: Date | null
  completedAt: Date | null
}

/**
 * Validates that `fields` (the COMPLETE resulting row, already computed by
 * computeResultingFields) satisfies every Phase 0A invariant this
 * application layer is responsible for enforcing before the SQL even runs.
 * Mirrors the actual CHECK constraints in
 * supabase/migrations/20260830_agent_operational_schema_phase0a.sql
 * exactly — the DB constraints remain the second line of defense, not the
 * first.
 */
export function validateStateRequirements(fields: TaskStateFields): void {
  const { status } = fields

  // tasks_next_action_required
  if (status !== 'BACKLOG' && status !== 'DONE' && status !== 'CANCELED' && !isMeaningful(fields.nextAction)) {
    throw new InvalidStateFieldsError(`status ${status} requires a meaningful nextAction`)
  }

  // tasks_waiting_requires_check_at
  if (status === 'WAITING' && fields.nextCheckAt === null) {
    throw new InvalidStateFieldsError('WAITING requires nextCheckAt')
  }

  // tasks_blocked_requires_reason
  if (status === 'BLOCKED' && fields.blockedByTaskId === null && !isMeaningful(fields.blockerNote)) {
    throw new InvalidStateFieldsError('BLOCKED requires either blockedByTaskId or a meaningful blockerNote')
  }

  // tasks_needs_jerry_requires_request (requires_jerry itself is derived — see computeResultingFields)
  if (status === 'NEEDS_JERRY' && !isMeaningful(fields.jerryRequest)) {
    throw new InvalidStateFieldsError('NEEDS_JERRY requires a meaningful jerryRequest')
  }

  // tasks_in_progress_requires_owner_and_start
  if (status === 'IN_PROGRESS' && (fields.ownerId === null || fields.startedAt === null)) {
    throw new InvalidStateFieldsError('IN_PROGRESS requires an owner and a startedAt')
  }

  // tasks_done_requires_completed_at
  if (status === 'DONE' && fields.completedAt === null) {
    throw new InvalidStateFieldsError('DONE requires completedAt')
  }
}

export interface ResultingFieldsInput {
  status: TaskStatus
  nextAction?: string | null
  nextCheckAt?: Date | null
  blockedByTaskId?: string | null
  blockerNote?: string | null
  jerryRequest?: string | null
  ownerId?: string | null
}

export interface CurrentRowForCleanup {
  ownerId: string | null
  startedAt: Date | null
  completedAt: Date | null
  nextAction: string | null
}

/**
 * Deterministically computes the COMPLETE resulting row for a task moving
 * into `input.status`, applying the Phase 0D state-cleanup rules so stale
 * state-specific data never survives a transition it no longer applies to.
 * Used by both createTask (current = all-null "nothing yet") and
 * transitionTask/updateTaskPlan (current = the locked existing row).
 *
 * Cleanup rules (see Phase 0D spec "State cleanup is important"):
 *   - nextCheckAt: only carried forward if the caller explicitly supplies
 *     one for this transition, or the destination is WAITING (which
 *     requires it). Otherwise cleared. This makes "does the destination
 *     legitimately need it" the CALLER's call, not a hardcoded per-status
 *     list — if a future status wants to keep a check-in date, the caller
 *     just passes nextCheckAt again.
 *   - blockedByTaskId/blockerNote: only kept for BLOCKED, cleared for every
 *     other destination — a blocker concept that doesn't apply once you've
 *     left BLOCKED.
 *   - jerryRequest: only kept for NEEDS_JERRY, cleared otherwise.
 *   - requiresJerry: always exactly (status === 'NEEDS_JERRY') — never
 *     caller-settable, which is what actually keeps it in sync with status
 *     (Phase 0A's tasks_requires_jerry_matches_status CHECK).
 *   - ownerId: caller-supplied value wins if given; otherwise the
 *     PREVIOUS owner is carried forward unchanged (status changes don't
 *     un-assign a task).
 *   - startedAt: set once, the first time status becomes IN_PROGRESS
 *     (kept thereafter regardless of later status changes — it records
 *     when work began, not "is currently in progress").
 *   - completedAt: set to `now` the moment status becomes DONE. DONE has
 *     no outgoing transitions in this phase (see ALLOWED_TRANSITIONS), so
 *     there is no "leaving DONE" case to define cleanup for yet.
 *   - nextAction: caller-supplied value wins if given; otherwise the
 *     previous value is left untouched (never silently cleared just
 *     because the caller didn't mention it) — validateStateRequirements
 *     is what actually enforces it's present when the destination status
 *     requires it.
 */
export function computeResultingFields(
  input: ResultingFieldsInput,
  current: CurrentRowForCleanup,
  now: Date
): TaskStateFields {
  const status = input.status

  return {
    status,
    nextAction: input.nextAction !== undefined ? input.nextAction : current.nextAction,
    // Cleared unless the caller explicitly supplies one for THIS
    // transition. WAITING requires a non-null value — if the caller
    // didn't supply one, this deliberately resolves to null so
    // validateStateRequirements rejects it below, rather than silently
    // reusing a stale value from a previous WAITING period.
    nextCheckAt: input.nextCheckAt !== undefined ? input.nextCheckAt : null,
    blockedByTaskId: status === 'BLOCKED' ? (input.blockedByTaskId ?? null) : null,
    blockerNote: status === 'BLOCKED' ? (input.blockerNote ?? null) : null,
    jerryRequest: status === 'NEEDS_JERRY' ? (input.jerryRequest ?? null) : null,
    ownerId: input.ownerId !== undefined ? input.ownerId : current.ownerId,
    startedAt: status === 'IN_PROGRESS' ? (current.startedAt ?? now) : current.startedAt,
    completedAt: status === 'DONE' ? now : current.completedAt,
  }
}
