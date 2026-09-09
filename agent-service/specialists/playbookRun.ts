// Chief Phase 2F — durable playbook-run identity (spec section 3). The
// driver's own persisted state, separate from (but referencing) the
// individual specialist ExecutionRecords a run creates along the way.
// Same async-store, DB-backed-by-default shape as executor.ts's
// ExecutionStore — this is what makes the driver resumable across a
// service/machine/CLI restart: every meaningful step persists the run
// record before doing anything else, so a fresh process re-reading the
// same runId picks up exactly where the last one left off.

export type PlaybookRunStatus = 'RUNNING' | 'WAITING' | 'NEEDS_JERRY' | 'BLOCKED' | 'DONE' | 'PAUSED'

export interface PlaybookRunRecord {
  /** Deterministic: `${playbookKey}:${projectId}` — never randomly generated, so "start" and "resume" are the same lookup. */
  readonly runId: string
  readonly projectId: string
  readonly playbookKey: string
  status: PlaybookRunStatus
  currentStage: string
  /** Current gap-loop (M4<->M5) iteration count — guardrail-checked (spec section 20) to prevent infinite gap research. */
  loopIteration: number
  /** Cumulative retry count across every execution this run has created — guardrail-checked to prevent unbounded retry loops. */
  totalRetries: number
  /** Executions currently believed in-flight for this run's CURRENT stage — cleared once each is accepted/resolved. */
  pendingExecutionIds: string[]
  /**
   * Driver-specific accumulated state (candidates, gaps, DVA artifacts,
   * relationship stage, whatever the specific playbook driver needs) —
   * deliberately untyped here so playbookRun.ts stays generic across
   * metro_launch and destination_hub_lifecycle; each driver module casts
   * this to its own shape.
   */
  state: Record<string, unknown>
  /** Set only when status is NEEDS_JERRY — never left implicit, same discipline as SpecialistResultEnvelope.jerryReason. */
  jerryReason: string | null
  /** The executive decision packet (spec section 17) when status is NEEDS_JERRY — concise context, never raw logs. */
  decisionPacket: Record<string, unknown> | null
  readonly startedAt: string
  updatedAt: string
}

export function playbookRunId(playbookKey: string, projectId: string): string {
  return `${playbookKey}:${projectId}`
}

export interface PlaybookRunStore {
  get(runId: string): Promise<PlaybookRunRecord | undefined>
  put(record: PlaybookRunRecord): Promise<void>
}

export class InMemoryPlaybookRunStore implements PlaybookRunStore {
  private byId = new Map<string, PlaybookRunRecord>()

  async get(runId: string): Promise<PlaybookRunRecord | undefined> {
    return this.byId.get(runId)
  }

  async put(record: PlaybookRunRecord): Promise<void> {
    this.byId.set(record.runId, record)
  }
}

/** Fetches the existing run or creates a fresh one at its initial stage — the "start or resume" primitive every driver entry point uses. */
export async function getOrCreateRun(store: PlaybookRunStore, playbookKey: string, projectId: string, initialStage: string, now: () => string = () => new Date().toISOString()): Promise<PlaybookRunRecord> {
  const runId = playbookRunId(playbookKey, projectId)
  const existing = await store.get(runId)
  if (existing) return existing

  const record: PlaybookRunRecord = {
    runId,
    projectId,
    playbookKey,
    status: 'RUNNING',
    currentStage: initialStage,
    loopIteration: 0,
    totalRetries: 0,
    pendingExecutionIds: [],
    state: {},
    jerryReason: null,
    decisionPacket: null,
    startedAt: now(),
    updatedAt: now(),
  }
  await store.put(record)
  return record
}

export async function pauseRun(store: PlaybookRunStore, runId: string, now: () => string = () => new Date().toISOString()): Promise<PlaybookRunRecord> {
  const record = await store.get(runId)
  if (!record) throw new Error(`No playbook run "${runId}".`)
  if (record.status === 'DONE') throw new Error(`Playbook run "${runId}" is already DONE — nothing to pause.`)
  record.status = 'PAUSED'
  record.updatedAt = now()
  await store.put(record)
  return record
}

/**
 * The generic "Jerry made the decision this run was waiting on" resume
 * primitive (spec section 5/14 — a decision gate resumes automatically
 * once resolved, never re-asks for something already recorded). Merges
 * `decision` into run.state (so the driver's own next stepping logic can
 * read exactly what was decided) and flips status back to RUNNING —
 * every driver's step functions are themselves responsible for reading
 * the merged decision and acting on it correctly; this function only
 * handles the generic "un-stick the run" part.
 */
export async function recordJerryDecision(store: PlaybookRunStore, runId: string, decision: Record<string, unknown>, now: () => string = () => new Date().toISOString()): Promise<PlaybookRunRecord> {
  const record = await store.get(runId)
  if (!record) throw new Error(`No playbook run "${runId}".`)
  if (record.status !== 'NEEDS_JERRY') throw new Error(`Playbook run "${runId}" is not NEEDS_JERRY (currently ${record.status}) — nothing pending to decide.`)
  record.state = { ...record.state, ...decision }
  record.status = 'RUNNING'
  record.jerryReason = null
  record.decisionPacket = null
  record.updatedAt = now()
  await store.put(record)
  return record
}

export async function resumeRun(store: PlaybookRunStore, runId: string, now: () => string = () => new Date().toISOString()): Promise<PlaybookRunRecord> {
  const record = await store.get(runId)
  if (!record) throw new Error(`No playbook run "${runId}".`)
  if (record.status !== 'PAUSED') throw new Error(`Playbook run "${runId}" is not PAUSED (currently ${record.status}) — nothing to resume.`)
  record.status = 'RUNNING'
  record.updatedAt = now()
  await store.put(record)
  return record
}

/**
 * The generic "an operator has judged it's safe to retry" primitive for
 * a BLOCKED run. BLOCKED is deliberately distinct from NEEDS_JERRY (see
 * block()'s own doc in each driver): it's reserved for retriable
 * infrastructure/provider failures — a transient rate limit, a timeout,
 * a momentarily-unavailable executor — never a genuine product/strategy
 * decision (that's what NEEDS_JERRY + recordJerryDecision is for). A
 * BLOCKED run was never meant to require hand-editing run state to
 * recover: this is that recovery's sanctioned, generic entry point,
 * exactly parallel to resumeRun for PAUSED. Deliberately takes no
 * decision payload (unlike recordJerryDecision) — an unblock is "try
 * again," not "here's new information."
 */
export async function unblockRun(store: PlaybookRunStore, runId: string, now: () => string = () => new Date().toISOString()): Promise<PlaybookRunRecord> {
  const record = await store.get(runId)
  if (!record) throw new Error(`No playbook run "${runId}".`)
  if (record.status !== 'BLOCKED') throw new Error(`Playbook run "${runId}" is not BLOCKED (currently ${record.status}) — nothing to unblock.`)
  record.status = 'RUNNING'
  record.jerryReason = null
  record.updatedAt = now()
  await store.put(record)
  return record
}

/**
 * The sanctioned "an operator has fixed the methodology, re-derive
 * downstream stages from what's still valid" recovery primitive. Unlike
 * unblockRun (retries the SAME stage/state after a transient failure)
 * or recordJerryDecision (merges new state without ever moving
 * currentStage), this is for the case a methodology defect invalidates
 * data a LATER stage already produced — e.g. the Vienna 2026-09-09
 * VENUE_QUOTING_GATE fix: 449 rejections were computed against the
 * wrong field, so those rejections (and the checkoffized bodies written
 * before the corrected editor prompt existed) are invalid evidence and
 * must be regenerated, but the 450 real, paid-for M1-M6 research
 * candidates are NOT invalidated and must never be discarded.
 *
 * `stateReset` is shallow-merged over `record.state` (same merge
 * semantics as recordJerryDecision) — a caller clears exactly the keys
 * invalidated by the fix (e.g. `{checkoffizedItems: [], itemCertifications:
 * {}, finalCertificationReport: null}`) while every OTHER key (candidates,
 * neighborhoods, plan, gapResearchHistory, planRelaxations, ...) passes
 * through untouched. This function does not know or validate which keys
 * are "safe" to clear — that judgment belongs to whoever is applying a
 * specific methodology fix, same as recordJerryDecision's decision
 * payload is never validated against the driver's own state shape here.
 *
 * Restricted to NEEDS_JERRY/BLOCKED (a run that has already stopped for
 * review) — never a RUNNING run, which could be actively persisting a
 * concurrent step.
 */
export async function reopenStage(
  store: PlaybookRunStore,
  runId: string,
  toStage: string,
  stateReset: Record<string, unknown> = {},
  now: () => string = () => new Date().toISOString()
): Promise<PlaybookRunRecord> {
  const record = await store.get(runId)
  if (!record) throw new Error(`No playbook run "${runId}".`)
  if (record.status !== 'NEEDS_JERRY' && record.status !== 'BLOCKED') {
    throw new Error(`Playbook run "${runId}" is not NEEDS_JERRY or BLOCKED (currently ${record.status}) — reopening a stage is only for a run an operator is explicitly correcting after it already stopped for review, never a RUNNING run.`)
  }
  record.currentStage = toStage
  record.state = { ...record.state, ...stateReset }
  record.status = 'RUNNING'
  record.jerryReason = null
  record.decisionPacket = null
  record.loopIteration = 0
  record.updatedAt = now()
  await store.put(record)
  return record
}
