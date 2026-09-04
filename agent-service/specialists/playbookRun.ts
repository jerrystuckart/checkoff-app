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
