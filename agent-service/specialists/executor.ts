// Chief Phase 2D — the executable specialist runtime. Provider-agnostic:
// this module never names Claude/ChatGPT/OpenAI/Anthropic. A specialist
// role + a versioned methodology are stable; WHO/WHAT actually executes
// a given delegation (a local tool, a remote AI provider, or a human via
// the manual bridge) is an interchangeable adapter implementing
// SpecialistExecutor.
//
// This is the minimum runtime needed for Chief to delegate real work and
// safely consume the result — not a distributed-agent platform. It
// reuses every existing primitive rather than inventing new ones:
// evaluateAuthority (standingAuthority.ts) for authority enforcement,
// validateResultEnvelope (delegation.ts) for evidence, getMethodology
// (methodologyRegistry.ts) for methodology validation. The only new
// concept is the ExecutionRecord — a persistence-shaped wrapper around a
// DelegationRequest that adds identity (executionId/projectId/
// destinationId/metroId), idempotency, and retry/status tracking.

import { evaluateAuthority } from '../playbooks/standingAuthority'
import { validateResultEnvelope } from './delegation'
import { getMethodology } from './methodologyRegistry'
import type { DelegationRequest, SpecialistResultEnvelope } from './types'

// ---------------------------------------------------------------------------
// Executor types (spec section 11)
// ---------------------------------------------------------------------------

export type ExecutorType = 'LOCAL_TOOL_EXECUTOR' | 'REMOTE_AI_EXECUTOR' | 'MANUAL_EXECUTOR'

/**
 * Spec section 14/16 — the closed set of execution states. NEEDS_MORE_EVIDENCE
 * and BLOCKED are distinct from FAILED: a specialist that ran but came up
 * short is not the same failure mode as an executor that couldn't run at
 * all (EXECUTOR_UNAVAILABLE) or one whose own logic errored (FAILED).
 */
export type ExecutionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED' | 'NEEDS_MORE_EVIDENCE' | 'BLOCKED' | 'EXECUTOR_UNAVAILABLE'

// ---------------------------------------------------------------------------
// The request/record shape (spec section 9 + 13 + 15)
// ---------------------------------------------------------------------------

export interface SpecialistExecutionRequest extends DelegationRequest {
  executionId: string
  projectId: string
  /** Exactly one of destinationId/metroId is set for a scoped playbook; both null for a project-wide operation. Never guessed — the caller states scope explicitly. */
  destinationId: string | null
  metroId: string | null
  allowedCapabilities: string[]
  /** Standing-authority operation key(s) this execution may perform — checked before the execution is ever created (assertExecutionAuthorized). */
  authorityOperations: string[]
  /** Same (executionId, idempotencyKey) submitted twice must never create a second execution or advance the parent playbook twice. */
  idempotencyKey: string
}

export interface ExecutionRecord {
  readonly request: SpecialistExecutionRequest
  status: ExecutionStatus
  executorType: ExecutorType | null
  readonly startedAt: string
  completedAt: string | null
  envelope: SpecialistResultEnvelope | null
  /** Result-submission attempts (acceptExecutionResult calls), successful or not — spec section 12 "duplicate remote result" tests key off this staying at 1 for a true duplicate. */
  attempts: number
  /** Retry lineage (spec section 12) — every retryExecution() call appends its timestamp here. The SAME executionId is reused across retries (never a new id), so this array IS the full retry history for one logical execution. */
  retriedAt: string[]
  errorReason: string | null
}

// ---------------------------------------------------------------------------
// Authority enforcement (spec section 17) — an executor can never bypass
// Chief's authority policy. Every operation an execution names must
// resolve to "may act without Jerry" BEFORE the execution is created —
// an execution that would require Jerry is never silently auto-run.
// ---------------------------------------------------------------------------

export class AuthorityRejectedExecutionError extends Error {
  constructor(public readonly operation: string) {
    super(`Execution requests operation "${operation}" which requires Jerry (APPROVAL_REQUIRED, or AUTO_TELL while inactive) — an executor may never bypass Chief's authority policy.`)
    this.name = this.constructor.name
  }
}

export function assertExecutionAuthorized(request: SpecialistExecutionRequest): void {
  for (const op of request.authorityOperations) {
    const { mayActWithoutJerry } = evaluateAuthority(op) // throws UnknownAuthorityOperationError if op is unregistered — never treated as implicitly safe
    if (!mayActWithoutJerry) throw new AuthorityRejectedExecutionError(op)
  }
}

// ---------------------------------------------------------------------------
// Methodology validation — every execution must run a real, registered,
// versioned methodology (Phase 2D requirement, section 0).
// ---------------------------------------------------------------------------

export function assertMethodologyValid(request: SpecialistExecutionRequest): void {
  const methodology = getMethodology(request.methodologyId, request.methodologyVersion) // throws UnknownMethodologyError otherwise
  if (!methodology.allowedSpecialists.includes(request.specialist)) {
    throw new Error(
      `Methodology ${request.methodologyId}/${request.methodologyVersion} may be executed by [${methodology.allowedSpecialists.join(', ')}], not "${request.specialist}" — a delegation must target a specialist actually allowed to run this methodology.`
    )
  }
}

// ---------------------------------------------------------------------------
// Hard result isolation (spec section 15) — a result from one destination/
// metro/project must never be accepted into another. Checked against the
// EXACT identity fields recorded on the execution at creation time, never
// against whatever the incoming result claims about itself.
// ---------------------------------------------------------------------------

export interface ExecutionIdentityCheck {
  executionId: string
  projectId: string
  destinationId: string | null
  metroId: string | null
  playbookKey: string
  stage: string
  methodologyId: string
  methodologyVersion: string
}

export function identityMismatches(record: ExecutionRecord, check: ExecutionIdentityCheck): string[] {
  const mismatches: string[] = []
  const r = record.request
  if (r.executionId !== check.executionId) mismatches.push(`executionId: expected ${r.executionId}, got ${check.executionId}`)
  if (r.projectId !== check.projectId) mismatches.push(`projectId: expected ${r.projectId}, got ${check.projectId}`)
  if (r.destinationId !== check.destinationId) mismatches.push(`destinationId: expected ${r.destinationId}, got ${check.destinationId}`)
  if (r.metroId !== check.metroId) mismatches.push(`metroId: expected ${r.metroId}, got ${check.metroId}`)
  if (r.playbookKey !== check.playbookKey) mismatches.push(`playbookKey: expected ${r.playbookKey}, got ${check.playbookKey}`)
  if (r.stage !== check.stage) mismatches.push(`stage: expected ${r.stage}, got ${check.stage}`)
  if (r.methodologyId !== check.methodologyId) mismatches.push(`methodologyId: expected ${r.methodologyId}, got ${check.methodologyId}`)
  if (r.methodologyVersion !== check.methodologyVersion) mismatches.push(`methodologyVersion: expected ${r.methodologyVersion}, got ${check.methodologyVersion}`)
  return mismatches
}

export function assertExecutionIdentity(record: ExecutionRecord, check: ExecutionIdentityCheck): void {
  const mismatches = identityMismatches(record, check)
  if (mismatches.length > 0) {
    throw new Error(`Execution identity mismatch — refusing to accept this result (cross-contamination guard): ${mismatches.join('; ')}`)
  }
}

// ---------------------------------------------------------------------------
// The execution store — a minimal persistence interface. Phase 2D
// requirement (section 13): reuse existing agent.runs where appropriate
// rather than adding new tables. This interface is intentionally
// storage-agnostic so a future implementation can back it with
// agent.runs; InMemoryExecutionStore (below) is what the test executor
// and this module's own tests use, and is also a legitimate lightweight
// runtime store for the manual-fallback CLI workflow.
// ---------------------------------------------------------------------------

// Phase 2E revision: EVERY method is async, deliberately, even though
// InMemoryExecutionStore's own implementation never actually awaits
// anything. A production execution MUST survive a service/machine/CLI
// restart and days/weeks of WAITING (Phase 2E spec section 1) — that is
// only true if persistence is real I/O the caller awaits before treating
// a write as durable, not a synchronous in-process side effect a
// DB-backed adapter would have to fake. See dbExecutionStore.ts for the
// production implementation (agent.tasks/agent.task_events-backed);
// InMemoryExecutionStore remains the test/dev adapter, unchanged in
// behavior, just now returning resolved Promises.
export interface ExecutionStore {
  get(executionId: string): Promise<ExecutionRecord | undefined>
  put(record: ExecutionRecord): Promise<void>
  findByIdempotencyKey(idempotencyKey: string): Promise<ExecutionRecord | undefined>
  all(): Promise<ExecutionRecord[]>
}

export class InMemoryExecutionStore implements ExecutionStore {
  private byId = new Map<string, ExecutionRecord>()
  private byIdempotencyKey = new Map<string, string>() // idempotencyKey -> executionId

  async get(executionId: string): Promise<ExecutionRecord | undefined> {
    return this.byId.get(executionId)
  }

  async put(record: ExecutionRecord): Promise<void> {
    this.byId.set(record.request.executionId, record)
    this.byIdempotencyKey.set(record.request.idempotencyKey, record.request.executionId)
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<ExecutionRecord | undefined> {
    const executionId = this.byIdempotencyKey.get(idempotencyKey)
    return executionId ? this.byId.get(executionId) : undefined
  }

  async all(): Promise<ExecutionRecord[]> {
    return [...this.byId.values()]
  }
}

// ---------------------------------------------------------------------------
// Registration — creating an execution. Idempotent: a second
// registration with the same idempotencyKey never creates a duplicate
// execution, it returns the existing one (spec section 12/16).
// ---------------------------------------------------------------------------

export async function registerExecution(
  store: ExecutionStore,
  request: SpecialistExecutionRequest,
  executorType: ExecutorType | null,
  now: () => string = () => new Date().toISOString()
): Promise<ExecutionRecord> {
  const existing = await store.findByIdempotencyKey(request.idempotencyKey)
  if (existing) return existing

  assertExecutionAuthorized(request) // throws AuthorityRejectedExecutionError / UnknownAuthorityOperationError
  assertMethodologyValid(request) // throws UnknownMethodologyError / ownership mismatch

  const record: ExecutionRecord = {
    request,
    status: executorType === null ? 'BLOCKED' : 'PENDING',
    executorType,
    startedAt: now(),
    completedAt: null,
    envelope: null,
    attempts: 0,
    retriedAt: [],
    errorReason: executorType === null ? 'EXECUTOR_UNAVAILABLE at registration — no executor type provided' : null,
  }
  await store.put(record)
  return record
}

// ---------------------------------------------------------------------------
// Accepting a result (spec section 14-16). The ONLY path by which an
// execution's envelope is recorded and the record marked COMPLETE.
// ---------------------------------------------------------------------------

export interface AcceptResultOutcome {
  accepted: boolean
  /** true when this call found an already-COMPLETE record for the same execution and did nothing — the required "second submission = no-op" behavior. */
  duplicate: boolean
  record: ExecutionRecord
  reasons: string[]
}

export async function acceptExecutionResult(
  store: ExecutionStore,
  check: ExecutionIdentityCheck,
  envelope: SpecialistResultEnvelope,
  now: () => string = () => new Date().toISOString()
): Promise<AcceptResultOutcome> {
  const record = await store.get(check.executionId)
  if (!record) throw new Error(`No execution registered with id "${check.executionId}" — an execution must be registered (registerExecution) before a result can be accepted.`)

  if (record.status === 'COMPLETE') {
    return { accepted: false, duplicate: true, record, reasons: ['execution already COMPLETE — duplicate submission ignored, parent playbook not advanced twice'] }
  }

  assertExecutionIdentity(record, check) // throws on any cross-contamination

  const validation = validateResultEnvelope(record.request, envelope)
  record.attempts += 1

  if (!validation.valid) {
    record.status = validation.missingEvidenceKeys.length > 0 ? 'NEEDS_MORE_EVIDENCE' : 'FAILED'
    record.errorReason = validation.reasons.join('; ')
    await store.put(record)
    return { accepted: false, duplicate: false, record, reasons: validation.reasons }
  }

  record.status = 'COMPLETE'
  record.envelope = envelope
  record.completedAt = now()
  record.errorReason = null
  await store.put(record)
  return { accepted: true, duplicate: false, record, reasons: [] }
}

// ---------------------------------------------------------------------------
// Retry / failure transitions (spec section 16). A FAILED/NEEDS_MORE_EVIDENCE/
// BLOCKED/EXECUTOR_UNAVAILABLE execution can be reissued — this resets it
// to PENDING for a fresh attempt WITHOUT touching a COMPLETE record (retrying
// a completed execution is refused, same discipline as duplicate submission).
// ---------------------------------------------------------------------------

export async function retryExecution(store: ExecutionStore, executionId: string, now: () => string = () => new Date().toISOString()): Promise<ExecutionRecord> {
  const record = await store.get(executionId)
  if (!record) throw new Error(`No execution registered with id "${executionId}".`)
  if (record.status === 'COMPLETE') {
    throw new Error(`Execution "${executionId}" is already COMPLETE — retrying a completed execution is refused (it would risk advancing the parent playbook twice).`)
  }
  record.status = 'PENDING'
  record.errorReason = null
  record.retriedAt = [...record.retriedAt, now()]
  await store.put(record)
  return record
}

export async function markExecutorUnavailable(store: ExecutionStore, executionId: string, reason: string): Promise<ExecutionRecord> {
  const record = await store.get(executionId)
  if (!record) throw new Error(`No execution registered with id "${executionId}".`)
  if (record.status === 'COMPLETE') throw new Error(`Execution "${executionId}" is already COMPLETE — cannot mark EXECUTOR_UNAVAILABLE.`)
  record.status = 'EXECUTOR_UNAVAILABLE'
  record.errorReason = reason
  await store.put(record)
  return record
}

// ---------------------------------------------------------------------------
// The provider-agnostic executor interface (spec section 9-10). An
// implementation NEVER names a vendor/model in this module — see
// manualExecutor.ts and testExecutor.ts for the two concrete
// implementations this codebase ships.
// ---------------------------------------------------------------------------

export interface SpecialistExecutor {
  readonly executorType: ExecutorType
  /** Whether this executor instance can currently handle the given specialist/methodology — an executor that cannot must be represented as EXECUTOR_UNAVAILABLE, never silently skipped or faked. */
  canExecute(request: SpecialistExecutionRequest): boolean
  execute(request: SpecialistExecutionRequest): Promise<SpecialistResultEnvelope | { unavailable: true; reason: string }>
}

/**
 * The one function Chief actually calls to run a delegation end-to-end
 * through a given executor: register (idempotent) -> authority/methodology
 * checks -> execute -> accept result. Never bypasses acceptExecutionResult's
 * validation just because the executor claims success.
 */
export async function runExecution(store: ExecutionStore, request: SpecialistExecutionRequest, executor: SpecialistExecutor, now: () => string = () => new Date().toISOString()): Promise<AcceptResultOutcome | ExecutionRecord> {
  if (!executor.canExecute(request)) {
    const record = await registerExecution(store, request, null, now)
    return markExecutorUnavailable(store, record.request.executionId, `${executor.executorType} cannot execute specialist=${request.specialist} methodology=${request.methodologyId}/${request.methodologyVersion}`)
  }

  const record = await registerExecution(store, request, executor.executorType, now)
  if (record.status === 'COMPLETE') return record // idempotent replay

  record.status = 'IN_PROGRESS'
  await store.put(record)

  const outcome = await executor.execute(request)
  if ('unavailable' in outcome) {
    return markExecutorUnavailable(store, request.executionId, outcome.reason)
  }

  return acceptExecutionResult(
    store,
    {
      executionId: request.executionId,
      projectId: request.projectId,
      destinationId: request.destinationId,
      metroId: request.metroId,
      playbookKey: request.playbookKey,
      stage: request.stage,
      methodologyId: request.methodologyId,
      methodologyVersion: request.methodologyVersion,
    },
    outcome,
    now
  )
}
