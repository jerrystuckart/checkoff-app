// Typed domain errors for Phase 0D mutations. These are the primary
// service contract for failure — callers should catch these, not parse
// Postgres error codes or messages. Raw Postgres/pg errors can still
// surface for genuinely unexpected failures (e.g. a dropped connection),
// but every failure mode this phase explicitly designed for has a typed
// class here.

export class AgentServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class TaskNotFoundError extends AgentServiceError {
  constructor(public readonly taskId: string) {
    super(`Task not found: ${taskId}`)
  }
}

export class ProjectNotFoundError extends AgentServiceError {
  constructor(public readonly projectKey: string) {
    super(`Project not found: ${projectKey}`)
  }
}

export class OwnerNotFoundError extends AgentServiceError {
  constructor(public readonly ownerKey: string) {
    super(`Owner not found: ${ownerKey}`)
  }
}

export class InvalidTransitionError extends AgentServiceError {
  constructor(
    public readonly fromStatus: string,
    public readonly toStatus: string
  ) {
    super(`Invalid transition: ${fromStatus} -> ${toStatus} is not an allowed transition`)
  }
}

/** Missing/invalid state-specific fields for a given status (e.g. WAITING with no next_check_at). */
export class InvalidStateFieldsError extends AgentServiceError {
  constructor(message: string) {
    super(message)
  }
}

/** The caller's expectedUpdatedAt no longer matches the stored row — someone else wrote first. */
export class ConcurrencyConflictError extends AgentServiceError {
  constructor(
    public readonly taskId: string,
    public readonly expectedUpdatedAt: Date,
    public readonly actualUpdatedAt: Date
  ) {
    super(
      `Concurrency conflict on task ${taskId}: expected updatedAt ${expectedUpdatedAt.toISOString()}, ` +
        `actual is ${actualUpdatedAt.toISOString()} — reload the task and retry`
    )
  }
}

/**
 * A caller-supplied idempotency identifier (createTask's (sourceType,
 * sourceRef), or transitionTask's idempotencyKey) matches something
 * already recorded, but the new request doesn't match what that identity
 * previously meant — reused for a different title/project/status
 * (createTask), or reused on the same task for a different destination
 * status (transitionTask). NOT treated as a safe retry in either case,
 * because doing so would silently discard the caller's actual request in
 * favor of unrelated existing data. `context` identifies what was reused
 * (e.g. "source agent_platform/foo" or "task <id> idempotencyKey <key>");
 * `reason` explains the specific mismatch.
 */
export class IdempotencyConflictError extends AgentServiceError {
  constructor(
    public readonly context: string,
    public readonly reason: string
  ) {
    super(`Idempotency conflict (${context}): ${reason}`)
  }
}

// ---------------------------------------------------------------------------
// Phase 0F — Open Brain write-back errors.
// ---------------------------------------------------------------------------

export class DecisionNotFoundError extends AgentServiceError {
  constructor(public readonly decisionId: string) {
    super(`Decision not found: ${decisionId}`)
  }
}

/** open_brain_eligible is false (or not yet set true) — existence of a decision is never sufficient on its own. */
export class DecisionNotEligibleError extends AgentServiceError {
  constructor(public readonly decisionId: string) {
    super(`Decision ${decisionId} is not marked open_brain_eligible — it will not be written to Open Brain`)
  }
}

/** The decision's actual current Open Brain sync state doesn't match what the caller expected before writing. */
export class DecisionSyncStateMismatchError extends AgentServiceError {
  constructor(
    public readonly decisionId: string,
    public readonly expectedThoughtId: string | null,
    public readonly actualThoughtId: string | null
  ) {
    super(
      `Decision ${decisionId} sync state mismatch: expected open_brain_thought_id=${expectedThoughtId ?? 'null'}, ` +
        `actual=${actualThoughtId ?? 'null'} — reload the preview and retry`
    )
  }
}

/**
 * The Open Brain transport could not be reached or is not configured.
 * NEVER include the raw credential/URL value in the message — see
 * openBrainClient.ts's redaction helper.
 */
export class OpenBrainUnavailableError extends AgentServiceError {
  constructor(reason: string) {
    super(`Open Brain is unavailable: ${reason}`)
  }
}

/** The remote capture_thought (or equivalent) call itself failed or returned an unusable response. */
export class OpenBrainWriteFailedError extends AgentServiceError {
  constructor(reason: string) {
    super(`Open Brain write failed: ${reason}`)
  }
}

/**
 * capture_thought rejected a repeat call for a (source_system,
 * source_identity) pair whose content differs from what was previously
 * captured under that exact pair — the backend's own idempotency
 * guarantee at work (see openBrainClient.ts's module doc). A genuine
 * content conflict, never silently treated as a successful retry or as
 * "the same decision, reworded." Requires human review; this module never
 * resolves it automatically.
 */
export class OpenBrainSourceIdentityConflictError extends AgentServiceError {
  constructor(
    public readonly sourceSystem: string,
    public readonly sourceIdentity: string,
    reason: string
  ) {
    super(`Open Brain rejected a repeat capture for ${sourceSystem}/${sourceIdentity} with different content: ${reason}`)
  }
}

/**
 * A thought found via an EXACT source-identity lookup (get_thought_by_source
 * — deterministic, never semantic) doesn't match what local state expects:
 * either it resolves to a different thought id than the one recorded
 * locally, or its content no longer exactly matches what this decision
 * would deterministically render (an apparent external edit). NOT
 * automatically resolved, NOT overwritten, NOT recreated. Requires human
 * review.
 */
export class DecisionOpenBrainConflictError extends AgentServiceError {
  constructor(
    public readonly decisionId: string,
    public readonly reason: string,
    public readonly candidateThoughtIds: string[]
  ) {
    super(`Decision ${decisionId} has a conflicting Open Brain state requiring review: ${reason}`)
  }
}

/**
 * Reconciliation could not determine a safe outcome. Retained for typed-
 * error symmetry with other Phase 0F failure modes; get_thought_by_source
 * returns at most one result by construction (the backend enforces
 * uniqueness on (source_system, source_identity)), so no current code path
 * in reconcileDecisionOpenBrainWrite actually throws this — "found
 * nothing" is NOT an error, see its NOTHING_TO_RECONCILE result instead.
 */
export class OpenBrainReconciliationError extends AgentServiceError {
  constructor(
    public readonly decisionId: string,
    reason: string
  ) {
    super(`Could not reconcile Open Brain state for decision ${decisionId}: ${reason}`)
  }
}

/**
 * capture_thought succeeded (the remote memory now exists), but recording
 * its id locally (via record_decision_open_brain_sync) failed. This is an
 * AMBIGUOUS SUCCESS requiring manual reconciliation, NOT a failed
 * operation to retry from scratch: calling writeDecisionToOpenBrain again
 * is actually SAFE here (capture_thought is idempotent on source identity —
 * a retry with identical content returns the same thought id rather than
 * duplicating it), but the preferred recovery path is
 * reconcileDecisionOpenBrainWrite(decisionId), which performs an EXACT
 * get_thought_by_source lookup (never a semantic search) and never calls
 * capture_thought at all. thoughtId is preserved here so it is never
 * silently lost.
 */
export class AmbiguousSyncOutcomeError extends AgentServiceError {
  constructor(
    public readonly decisionId: string,
    public readonly thoughtId: string,
    reason: string
  ) {
    super(
      `Ambiguous outcome: Open Brain thought ${thoughtId} was created for decision ${decisionId}, but recording it locally failed: ${reason}. ` +
        `Prefer reconcileDecisionOpenBrainWrite(decisionId) (exact lookup, no new capture) to recover; a retry of writeDecisionToOpenBrain is also ` +
        `safe since capture_thought is idempotent on source identity, but reconciliation is the more direct fix.`
    )
  }
}

// ---------------------------------------------------------------------------
// Phase 1A — decision creation and durable-memory recommendation errors.
// Note what's deliberately absent here: there is no
// "DecisionApprovalDeniedError" or similar for approve/reject/reconsider —
// agent-service never calls those functions at all (agent_service has no
// EXECUTE grant on them; see the Phase 1A promotion-workflow migration), so
// there is no code path in this codebase that could ever receive their
// errors.
// ---------------------------------------------------------------------------

/** decision_key already exists — agent.decisions.decision_key is UNIQUE. */
export class DecisionKeyConflictError extends AgentServiceError {
  constructor(public readonly decisionKey: string) {
    super(`A decision with decision_key '${decisionKey}' already exists`)
  }
}

/** recommend_decision_for_open_brain() refuses: the decision is already open_brain_eligible — recommending an already-approved decision is not meaningful. */
export class DecisionAlreadyEligibleError extends AgentServiceError {
  constructor(public readonly decisionId: string) {
    super(`Decision ${decisionId} is already open_brain_eligible — recommending it again is not meaningful`)
  }
}

/**
 * recommend_decision_for_open_brain() refuses: durable_memory_recommendation
 * is REJECTED. This is the technical stickiness Jerry's rejection carries
 * against Chief — agent_service cannot reset it (no EXECUTE on
 * reconsider_decision_for_open_brain(), which is agent_approver-only), so
 * this is not a transient state Chief can work around.
 */
export class DecisionRejectedForDurableMemoryError extends AgentServiceError {
  constructor(public readonly decisionId: string) {
    super(
      `Decision ${decisionId} was rejected for durable memory — Chief cannot recommend it again. ` +
        `Only reconsider_decision_for_open_brain() (agent_approver-only, invoked by Jerry) can reopen it.`
    )
  }
}
