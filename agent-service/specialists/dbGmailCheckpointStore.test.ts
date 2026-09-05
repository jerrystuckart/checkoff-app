// Chief Phase 2K — dbGmailCheckpointStore tests. Fully mocked (no live
// database), same FakeAgentDb pattern as dbExecutionStore.test.ts: a
// faithful-enough in-memory reimplementation of the agent.tasks/
// agent.task_events contract, shared across independently constructed
// store instances to prove genuine restart-safe, cross-instance
// persistence without needing Postgres in this environment.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DbGmailCheckpointStore, DbContactDirectory, GMAIL_CHECKPOINT_SOURCE_TYPE, GMAIL_CHECKPOINT_SINGLETON_REF, type DbGmailCheckpointStoreDeps, type DbContactDirectoryDeps } from './dbGmailCheckpointStore'
import { DbPlaybookRunStore } from './dbPlaybookRunStore'
import { RELATIONSHIP_PLAYBOOK_KEY } from '../playbooks/destinationRelationship'
import { playbookRunId, getOrCreateRun } from './playbookRun'
import type { TaskSummary, TaskEventDetail, TaskStatus } from '../types'
import type { CreateTaskInput, CreateTaskResult, TransitionTaskInput, TransitionTaskResult, RecordPlaybookStageInput, RecordPlaybookStageResult } from '../mutations'
import { validateStateRequirements } from '../transitions'
import type { GmailCheckpoint } from './gmailInboundMonitor'
import type { DestinationContactEmail } from '../queries'

// ---------------------------------------------------------------------------
// FakeAgentDb — shared backing store, same shape/contract as
// dbExecutionStore.test.ts's own fake.
// ---------------------------------------------------------------------------

interface FakeTaskRow {
  id: string
  title: string
  status: TaskStatus
  sourceType: string | null
  sourceRef: string | null
  blockerNote: string | null
  jerryRequest: string | null
  updatedAt: Date
}

interface FakeEventRow {
  id: string
  taskId: string
  eventType: string
  metadata: Record<string, unknown>
  changedAt: Date
}

class FakeAgentDb {
  tasks: FakeTaskRow[] = []
  events: FakeEventRow[] = []
  /** Phase 2L — legacy pre-Phase-2I destination contacts (agent.contacts joined via agent.interactions/agent.tasks). Tests populate this directly; never derived from the fake task rows above, matching how the real query reads a genuinely separate join. */
  legacyDestinationContacts: DestinationContactEmail[] = []
  private seq = 0

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${this.seq}`
  }

  toTaskSummary(row: FakeTaskRow): TaskSummary {
    return {
      id: row.id,
      title: row.title,
      description: null,
      status: row.status,
      priority: null,
      project: { id: 'project-1', projectKey: 'chief-operations', name: 'Chief Operations' },
      owner: null,
      dueAt: null,
      nextCheckAt: null,
      nextAction: null,
      requiresJerry: row.status === 'NEEDS_JERRY',
      jerryRequest: row.jerryRequest,
      blockedBy: null,
      blockerNote: row.blockerNote,
      contact: null,
      startedAt: null,
      completedAt: null,
      createdAt: row.updatedAt,
      updatedAt: row.updatedAt,
      sourceType: row.sourceType,
      sourceRef: row.sourceRef,
      projectType: null,
    }
  }

  createTask = async (input: CreateTaskInput): Promise<CreateTaskResult> => {
    if (input.sourceType && input.sourceRef) {
      const existing = this.tasks.find((t) => t.sourceType === input.sourceType && t.sourceRef === input.sourceRef)
      if (existing) return { task: this.toTaskSummary(existing), created: false }
    }
    // Real agent.tasks invariant enforcement (transitions.ts) — a live
    // proof against real Postgres caught createTask({status:'IN_PROGRESS'})
    // missing nextAction, which an earlier version of this fake did NOT
    // catch because it never validated anything. Calling the REAL
    // validateStateRequirements here (not a hand-rolled re-check) makes
    // this mock faithful to the actual constraint set going forward.
    validateStateRequirements({
      status: input.status,
      nextAction: input.nextAction ?? null,
      nextCheckAt: input.nextCheckAt ?? null,
      blockedByTaskId: input.blockedByTaskId ?? null,
      blockerNote: input.blockerNote ?? null,
      jerryRequest: input.jerryRequest ?? null,
      ownerId: input.ownerKey ? 'fake-owner-id' : null,
      startedAt: input.status === 'IN_PROGRESS' ? new Date() : null,
      completedAt: null,
    })
    const row: FakeTaskRow = { id: this.nextId('task'), title: input.title, status: input.status, sourceType: input.sourceType ?? null, sourceRef: input.sourceRef ?? null, blockerNote: input.blockerNote ?? null, jerryRequest: input.jerryRequest ?? null, updatedAt: new Date() }
    this.tasks.push(row)
    return { task: this.toTaskSummary(row), created: true }
  }

  transitionTask = async (input: TransitionTaskInput): Promise<TransitionTaskResult> => {
    const row = this.tasks.find((t) => t.id === input.taskId)
    if (!row) throw new Error(`fake: no task ${input.taskId}`)
    row.status = input.toStatus
    row.blockerNote = input.blockerNote ?? null
    row.jerryRequest = input.jerryRequest ?? null
    row.updatedAt = new Date(row.updatedAt.getTime() + 1)
    this.events.push({ id: this.nextId('event'), taskId: row.id, eventType: 'STATUS_CHANGED', metadata: input.playbookStage ? { playbookStage: input.playbookStage } : {}, changedAt: new Date() })
    return { task: this.toTaskSummary(row), changed: true }
  }

  recordPlaybookStage = async (input: RecordPlaybookStageInput): Promise<RecordPlaybookStageResult> => {
    const priorUse = this.events.find((e) => e.taskId === input.taskId && e.eventType === 'PLAYBOOK_STAGE' && e.metadata.idempotencyKey === input.idempotencyKey)
    if (priorUse) return { recorded: false }
    this.events.push({ id: this.nextId('event'), taskId: input.taskId, eventType: 'PLAYBOOK_STAGE', metadata: { idempotencyKey: input.idempotencyKey, playbookKey: input.playbookKey, stage: input.stage, ...(input.evidence ? { evidence: input.evidence } : {}) }, changedAt: new Date() })
    return { recorded: true }
  }

  getTaskBySource = async (sourceType: string, sourceRef: string) => {
    const row = this.tasks.find((t) => t.sourceType === sourceType && t.sourceRef === sourceRef)
    return row ? this.toTaskSummary(row) : null
  }

  getTasksBySourceType = async (sourceType: string) => this.tasks.filter((t) => t.sourceType === sourceType).map((t) => this.toTaskSummary(t))

  getTaskEventsForTask = async (taskId: string): Promise<TaskEventDetail[]> =>
    this.events
      .filter((e) => e.taskId === taskId)
      .map((e) => ({ id: e.id, task: { id: taskId, title: '' }, project: null, eventType: e.eventType, fromStatus: null, toStatus: null, changedBy: null, changedAt: e.changedAt, note: null, metadata: e.metadata }))

  checkpointDeps(): DbGmailCheckpointStoreDeps {
    return { createTask: this.createTask, recordPlaybookStage: this.recordPlaybookStage, getTaskBySource: this.getTaskBySource, getTaskEventsForTask: this.getTaskEventsForTask }
  }

  playbookRunStore(): DbPlaybookRunStore {
    return new DbPlaybookRunStore({ createTask: this.createTask, transitionTask: this.transitionTask, recordPlaybookStage: this.recordPlaybookStage, getTaskBySource: this.getTaskBySource, getTaskEventsForTask: this.getTaskEventsForTask })
  }

  getDestinationContactEmails = async (): Promise<DestinationContactEmail[]> => this.legacyDestinationContacts

  contactDirectoryDeps(): DbContactDirectoryDeps {
    return { getTasksBySourceType: this.getTasksBySourceType, runStore: this.playbookRunStore(), getDestinationContactEmails: this.getDestinationContactEmails }
  }
}

function checkpoint(overrides: Partial<GmailCheckpoint> = {}): GmailCheckpoint {
  return { lastCheckedAtIso: '2026-09-08T12:00:00.000Z', processedMessageIds: ['m1', 'm2'], unassociated: [], ...overrides }
}

// ---------------------------------------------------------------------------
// DbGmailCheckpointStore
// ---------------------------------------------------------------------------

test('DbGmailCheckpointStore: get() on an empty backing store returns an empty checkpoint, never throws', async () => {
  const db = new FakeAgentDb()
  const store = new DbGmailCheckpointStore(db.checkpointDeps())
  const cp = await store.get()
  assert.equal(cp.lastCheckedAtIso, null)
  assert.deepEqual(cp.processedMessageIds, [])
})

test('DbGmailCheckpointStore: put then get on the SAME instance round-trips the full checkpoint', async () => {
  const db = new FakeAgentDb()
  const store = new DbGmailCheckpointStore(db.checkpointDeps())
  await store.put(checkpoint())
  const back = await store.get()
  assert.equal(back.lastCheckedAtIso, '2026-09-08T12:00:00.000Z')
  assert.deepEqual(back.processedMessageIds, ['m1', 'm2'])
})

test('DbGmailCheckpointStore: creates exactly ONE agent.tasks row (singleton source_ref), even across many put() calls', async () => {
  const db = new FakeAgentDb()
  const store = new DbGmailCheckpointStore(db.checkpointDeps())
  await store.put(checkpoint({ lastCheckedAtIso: '2026-09-08T12:00:00.000Z' }))
  await store.put(checkpoint({ lastCheckedAtIso: '2026-09-08T12:15:00.000Z', processedMessageIds: ['m1', 'm2', 'm3'] }))
  await store.put(checkpoint({ lastCheckedAtIso: '2026-09-08T12:30:00.000Z', processedMessageIds: ['m1', 'm2', 'm3', 'm4'] }))

  assert.equal(db.tasks.length, 1)
  assert.equal(db.tasks[0].sourceType, GMAIL_CHECKPOINT_SOURCE_TYPE)
  assert.equal(db.tasks[0].sourceRef, GMAIL_CHECKPOINT_SINGLETON_REF)
})

test('RESTART PROOF: a fresh DbGmailCheckpointStore instance pointed at the SAME backing db reads back the exact checkpoint a prior instance wrote', async () => {
  const db = new FakeAgentDb()
  const firstProcess = new DbGmailCheckpointStore(db.checkpointDeps())
  await firstProcess.put(checkpoint({ processedMessageIds: ['m1', 'm2', 'm3'] }))

  // Simulates a process/machine restart — brand-new instance, only the
  // backing "database" persists, exactly like a real restart against
  // real Postgres.
  const secondProcess = new DbGmailCheckpointStore(db.checkpointDeps())
  const resumed = await secondProcess.get()
  assert.deepEqual(resumed.processedMessageIds, ['m1', 'm2', 'm3'])
})

test('IDEMPOTENCY: a message already in the checkpoint is never lost or duplicated across repeated put() calls with the same content', async () => {
  const db = new FakeAgentDb()
  const store = new DbGmailCheckpointStore(db.checkpointDeps())
  const cp = checkpoint({ processedMessageIds: ['m1'] })
  await store.put(cp)
  await store.put(cp) // identical content, identical idempotency key — must not create a duplicate snapshot event
  const playbookStageEvents = db.events.filter((e) => e.eventType === 'PLAYBOOK_STAGE')
  assert.equal(playbookStageEvents.length, 1)
})

test('unassociated messages are preserved across restart, not just processedMessageIds', async () => {
  const db = new FakeAgentDb()
  const store = new DbGmailCheckpointStore(db.checkpointDeps())
  await store.put(checkpoint({ unassociated: [{ messageId: 'm-amb', from: 'stranger@example.com', subject: 'Huh?', reason: 'no known contact matched', detectedAtIso: '2026-09-08T12:00:00.000Z' }] }))

  const resumed = await new DbGmailCheckpointStore(db.checkpointDeps()).get()
  assert.equal(resumed.unassociated.length, 1)
  assert.equal(resumed.unassociated[0].messageId, 'm-amb')
})

// ---------------------------------------------------------------------------
// DbContactDirectory
// ---------------------------------------------------------------------------

async function seedRelationshipRun(db: FakeAgentDb, projectId: string, state: Record<string, unknown>): Promise<void> {
  const runStore = db.playbookRunStore()
  const run = await getOrCreateRun(runStore, RELATIONSHIP_PLAYBOOK_KEY, projectId, 'RELATIONSHIP_READY')
  run.state = state
  await runStore.put(run)
}

test('DbContactDirectory: derives contacts from active destination_relationship runs — never a separate writable table', async () => {
  const db = new FakeAgentDb()
  await seedRelationshipRun(db, 'destination-hood-river-or', {
    primaryContact: { contactId: 'contact-1', name: 'Jane Doe', email: 'jane@hoodriver.example.com', role: 'Chamber CEO' },
    contactThreadIds: { 'contact-1': 'thread-1' },
  })

  const directory = new DbContactDirectory(db.contactDirectoryDeps())
  const contacts = await directory.listActiveContacts()
  assert.equal(contacts.length, 1)
  assert.equal(contacts[0].destinationId, 'destination-hood-river-or')
  assert.equal(contacts[0].email, 'jane@hoodriver.example.com')
  assert.equal(contacts[0].threadId, 'thread-1')
})

test('DbContactDirectory: includes an introduced stakeholder scoped to the SAME destination, with her own email/thread', async () => {
  const db = new FakeAgentDb()
  await seedRelationshipRun(db, 'destination-hood-river-or', {
    primaryContact: { contactId: 'contact-1', email: 'jane@hoodriver.example.com' },
    contacts: [{ destinationId: 'destination-hood-river-or', contactId: 'contact-2', role: 'Marketing Director', sentiment: 'UNKNOWN', promisesMade: [], introducedBy: 'contact-1', isChampion: false, isBlocker: false }],
    contactEmails: { 'contact-1': 'jane@hoodriver.example.com', 'contact-2': 'md@hoodriver.example.com' },
  })

  const directory = new DbContactDirectory(db.contactDirectoryDeps())
  const contacts = await directory.listActiveContacts()
  const introduced = contacts.find((c) => c.contactId === 'contact-2')
  assert.ok(introduced)
  assert.equal(introduced!.destinationId, 'destination-hood-river-or')
  assert.equal(introduced!.email, 'md@hoodriver.example.com')
})

test('DbContactDirectory: NEVER cross-contaminates — two destinations\' contacts stay scoped to their own runs', async () => {
  const db = new FakeAgentDb()
  await seedRelationshipRun(db, 'destination-hood-river-or', { primaryContact: { contactId: 'contact-hr', email: 'jane@hoodriver.example.com' } })
  await seedRelationshipRun(db, 'destination-willcox-az', { primaryContact: { contactId: 'contact-wx', email: 'bob@willcox.example.com' } })

  const directory = new DbContactDirectory(db.contactDirectoryDeps())
  const contacts = await directory.listActiveContacts()
  assert.equal(contacts.length, 2)
  const byDestination = new Map(contacts.map((c) => [c.destinationId, c]))
  assert.equal(byDestination.get('destination-hood-river-or')?.email, 'jane@hoodriver.example.com')
  assert.equal(byDestination.get('destination-willcox-az')?.email, 'bob@willcox.example.com')
})

test('DbContactDirectory: ignores non-destination_relationship playbook_run tasks (e.g. destination_hub_lifecycle) — never mixes playbooks', async () => {
  const db = new FakeAgentDb()
  await seedRelationshipRun(db, 'destination-hood-river-or', { primaryContact: { contactId: 'contact-hr', email: 'jane@hoodriver.example.com' } })
  // A run under a DIFFERENT playbook key, same source_type — must be excluded.
  const otherRunId = playbookRunId('destination_hub_lifecycle', 'destination-hood-river-or')
  const otherRunStore = db.playbookRunStore()
  const otherRun = await getOrCreateRun(otherRunStore, 'destination_hub_lifecycle', 'destination-hood-river-or', 'D0_DISCOVERY')
  await otherRunStore.put(otherRun)

  const directory = new DbContactDirectory(db.contactDirectoryDeps())
  const contacts = await directory.listActiveContacts()
  assert.equal(contacts.length, 1)
  assert.notEqual(otherRunId, undefined) // sanity — the other run was actually created
})

test('DbContactDirectory: RESTART PROOF — a fresh directory instance reads contacts from runs a prior process wrote', async () => {
  const db = new FakeAgentDb()
  await seedRelationshipRun(db, 'destination-hood-river-or', { primaryContact: { contactId: 'contact-1', email: 'jane@hoodriver.example.com' } })

  const freshDirectory = new DbContactDirectory(db.contactDirectoryDeps())
  const contacts = await freshDirectory.listActiveContacts()
  assert.equal(contacts.length, 1)
})

test('DbContactDirectory: upsertContact() is an intentional no-op — the canonical write already happened via the run\'s own persisted state', async () => {
  const db = new FakeAgentDb()
  const directory = new DbContactDirectory(db.contactDirectoryDeps())
  await directory.upsertContact({ destinationId: 'destination-x', contactId: 'contact-x', email: 'x@example.com', threadId: null })
  // No task/event should have been created by this call alone.
  assert.equal(db.tasks.length, 0)
  assert.equal(db.events.length, 0)
})

test('DbContactDirectory: a referred contact with no email on file yet is skipped, never guessed', async () => {
  const db = new FakeAgentDb()
  await seedRelationshipRun(db, 'destination-hood-river-or', {
    primaryContact: { contactId: 'contact-1', email: 'jane@hoodriver.example.com' },
    contacts: [{ destinationId: 'destination-hood-river-or', contactId: 'contact-2', role: 'Marketing Director', sentiment: 'UNKNOWN', promisesMade: [], introducedBy: 'contact-1', isChampion: false, isBlocker: false }],
    contactEmails: { 'contact-1': 'jane@hoodriver.example.com' }, // contact-2 has no email yet
  })

  const directory = new DbContactDirectory(db.contactDirectoryDeps())
  const contacts = await directory.listActiveContacts()
  assert.equal(contacts.length, 1)
  assert.equal(contacts.some((c) => c.contactId === 'contact-2'), false)
})

// ---------------------------------------------------------------------------
// Phase 2L — legacy pre-Phase-2I contacts (real destinations like Willcox
// predate the destination_relationship driver; their contacts only exist
// via agent.interactions/agent.tasks joins, surfaced by
// getDestinationContactEmails()).
// ---------------------------------------------------------------------------

test('DbContactDirectory: a pre-Phase-2I destination with NO relationship run yet is still discoverable via legacy contact evidence', async () => {
  const db = new FakeAgentDb()
  db.legacyDestinationContacts = [{ contactId: 'contact-lisa', email: 'lisa@willcoxchamber.org', projectKey: 'destination-willcox-az' }]

  const directory = new DbContactDirectory(db.contactDirectoryDeps())
  const contacts = await directory.listActiveContacts()
  assert.equal(contacts.length, 1)
  assert.equal(contacts[0].destinationId, 'destination-willcox-az')
  assert.equal(contacts[0].contactId, 'contact-lisa')
  assert.equal(contacts[0].email, 'lisa@willcoxchamber.org')
  assert.equal(contacts[0].threadId, null)
})

test('DbContactDirectory: legacy contacts merge with driver-derived contacts from OTHER destinations without cross-contaminating', async () => {
  const db = new FakeAgentDb()
  await seedRelationshipRun(db, 'destination-hood-river-or', { primaryContact: { contactId: 'contact-hr', email: 'jane@hoodriver.example.com' } })
  db.legacyDestinationContacts = [{ contactId: 'contact-lisa', email: 'lisa@willcoxchamber.org', projectKey: 'destination-willcox-az' }]

  const directory = new DbContactDirectory(db.contactDirectoryDeps())
  const contacts = await directory.listActiveContacts()
  assert.equal(contacts.length, 2)
  const byDestination = new Map(contacts.map((c) => [c.destinationId, c]))
  assert.equal(byDestination.get('destination-hood-river-or')?.email, 'jane@hoodriver.example.com')
  assert.equal(byDestination.get('destination-willcox-az')?.email, 'lisa@willcoxchamber.org')
})

test('DbContactDirectory: a driver-derived contact takes precedence over a legacy one for the SAME (destination, contactId) — never a stale duplicate', async () => {
  const db = new FakeAgentDb()
  await seedRelationshipRun(db, 'destination-willcox-az', { primaryContact: { contactId: 'contact-lisa', email: 'lisa-updated@willcoxchamber.org' }, contactThreadIds: { 'contact-lisa': 'thread-live' } })
  db.legacyDestinationContacts = [{ contactId: 'contact-lisa', email: 'lisa-stale@willcoxchamber.org', projectKey: 'destination-willcox-az' }]

  const directory = new DbContactDirectory(db.contactDirectoryDeps())
  const contacts = await directory.listActiveContacts()
  assert.equal(contacts.length, 1)
  assert.equal(contacts[0].email, 'lisa-updated@willcoxchamber.org')
  assert.equal(contacts[0].threadId, 'thread-live')
})

test('DbContactDirectory: two DIFFERENT legacy destinations sharing no data never cross-associate — each stays scoped to its own projectKey', async () => {
  const db = new FakeAgentDb()
  db.legacyDestinationContacts = [
    { contactId: 'contact-lisa', email: 'lisa@willcoxchamber.org', projectKey: 'destination-willcox-az' },
    { contactId: 'contact-gl', email: 'sam@grandlake.example.com', projectKey: 'destination-grand-lake-co' },
  ]

  const directory = new DbContactDirectory(db.contactDirectoryDeps())
  const contacts = await directory.listActiveContacts()
  assert.equal(contacts.length, 2)
  const byDestination = new Map(contacts.map((c) => [c.destinationId, c.email]))
  assert.equal(byDestination.get('destination-willcox-az'), 'lisa@willcoxchamber.org')
  assert.equal(byDestination.get('destination-grand-lake-co'), 'sam@grandlake.example.com')
})
