// Chief Phase 2K — moves the Gmail inbound monitor's durable state out of
// local files and into the EXISTING agent.tasks/agent.task_events
// primitives, exact same pattern as DbExecutionStore/DbPlaybookRunStore:
// no new table for the checkpoint, one seed row for the singleton's
// project (supabase/migrations/20260905_agent_chief_operations_project_seed.sql
// — createTask() requires a real agent.projects.project_key to resolve,
// and the Gmail checkpoint isn't scoped to any one destination/metro
// project). This is restart-safe and process/machine-independent for the
// same reason DbExecutionStore already is: the state lives in Postgres,
// not on a specific machine's disk.
//
// Two distinct stores live here:
//   DbGmailCheckpointStore — ONE agent.tasks row (source_type=
//     'gmail_checkpoint', a fixed singleton source_ref), the full
//     GmailCheckpoint (lastCheckedAtIso, processedMessageIds,
//     unassociated) snapshotted as PLAYBOOK_STAGE evidence, exactly like
//     DbPlaybookRunStore's own run snapshot.
//   DbContactDirectory — a READ path over the destination_relationship
//     playbook's OWN already-persisted run state (via DbPlaybookRunStore),
//     never a separate writable contacts table. Each relationship run's
//     state already carries its primaryContact/contacts/contactEmails/
//     contactThreadIds (destinationRelationshipDriver.ts), and that run
//     is already durably persisted by DbPlaybookRunStore.put() every
//     time the driver saves it — duplicating that into a second table
//     would just be two sources of truth that can drift. upsertContact()
//     is therefore an intentional no-op here: by the time it would be
//     called, the SAME data has already been written to the run's own
//     state in the SAME driver call, which the driver then persists via
//     runStore.put(). Cross-destination isolation and "no duplicate
//     resume" both fall out of this for free — a contact is scoped to
//     exactly the run.projectId it was read from, never merged across
//     runs.

import { createTask, recordPlaybookStage } from '../mutations'
import { getTaskBySource, getTaskEventsForTask, getTasksBySourceType, getDestinationContactEmails } from '../queries'
import { DbPlaybookRunStore, PLAYBOOK_RUN_SOURCE_TYPE } from './dbPlaybookRunStore'
import { RELATIONSHIP_PLAYBOOK_KEY } from '../playbooks/destinationRelationship'
import type { GmailCheckpoint, GmailCheckpointStore } from './gmailInboundMonitor'
import type { KnownRelationshipContact, MutableContactDirectory } from '../playbooks/gmailRelationshipLogic'

export const GMAIL_CHECKPOINT_SOURCE_TYPE = 'gmail_checkpoint'
/** There is only ever ONE Gmail inbound monitor for this Chief instance — a fixed source_ref, not per-destination. */
export const GMAIL_CHECKPOINT_SINGLETON_REF = 'gmail-inbound-monitor'
export const GMAIL_CHECKPOINT_OWNER_KEY = 'chief'
/** Cross-cutting Chief infrastructure state attaches here — see the seed migration's own doc for why a real project_key is required. */
export const GMAIL_CHECKPOINT_PROJECT_KEY = 'chief-operations'

function emptyCheckpoint(): GmailCheckpoint {
  return { lastCheckedAtIso: null, processedMessageIds: [], unassociated: [] }
}

interface SnapshotEvidence {
  snapshot: GmailCheckpoint
}
function isSnapshotEvidence(evidence: unknown): evidence is SnapshotEvidence {
  return typeof evidence === 'object' && evidence !== null && 'snapshot' in evidence
}

export interface DbGmailCheckpointStoreDeps {
  createTask: typeof createTask
  recordPlaybookStage: typeof recordPlaybookStage
  getTaskBySource: typeof getTaskBySource
  getTaskEventsForTask: typeof getTaskEventsForTask
}

const REAL_DEPS: DbGmailCheckpointStoreDeps = { createTask, recordPlaybookStage, getTaskBySource, getTaskEventsForTask }

export class DbGmailCheckpointStore implements GmailCheckpointStore {
  constructor(private readonly deps: DbGmailCheckpointStoreDeps = REAL_DEPS) {}

  async get(): Promise<GmailCheckpoint> {
    const task = await this.deps.getTaskBySource(GMAIL_CHECKPOINT_SOURCE_TYPE, GMAIL_CHECKPOINT_SINGLETON_REF)
    if (!task) return emptyCheckpoint()
    const events = await this.deps.getTaskEventsForTask(task.id)
    for (let i = events.length - 1; i >= 0; i--) {
      const evidence = events[i].metadata?.evidence
      if (isSnapshotEvidence(evidence)) return evidence.snapshot
    }
    return emptyCheckpoint()
  }

  async put(checkpoint: GmailCheckpoint): Promise<void> {
    const existing = await this.deps.getTaskBySource(GMAIL_CHECKPOINT_SOURCE_TYPE, GMAIL_CHECKPOINT_SINGLETON_REF)
    // Every real poll advances lastCheckedAtIso (or the id/unassociated
    // counts), so this is naturally unique per put() — never collides
    // with a prior snapshot's idempotency key.
    const snapshotKeySuffix = `${checkpoint.lastCheckedAtIso}:${checkpoint.processedMessageIds.length}:${checkpoint.unassociated.length}`

    if (!existing) {
      const created = await this.deps.createTask({
        title: '[gmail checkpoint] inbound monitor',
        projectKey: GMAIL_CHECKPOINT_PROJECT_KEY,
        status: 'IN_PROGRESS',
        changedByOwnerKey: GMAIL_CHECKPOINT_OWNER_KEY,
        ownerKey: GMAIL_CHECKPOINT_OWNER_KEY,
        description: 'Durable checkpoint for the Gmail inbound event source (gmailInboundMonitor.ts) — last-checked time and processed-message-id idempotency set.',
        // agent.tasks' own tasks_next_action_required invariant (transitions.ts
        // validateStateRequirements) requires a meaningful nextAction for
        // any status other than BACKLOG/DONE/CANCELED — a real live proof
        // against Postgres caught this being omitted (the fully-mocked
        // FakeAgentDb in dbGmailCheckpointStore.test.ts didn't enforce the
        // same invariant, so the unit tests alone didn't catch it).
        nextAction: 'poll Gmail on the next scheduled interval',
        sourceType: GMAIL_CHECKPOINT_SOURCE_TYPE,
        sourceRef: GMAIL_CHECKPOINT_SINGLETON_REF,
      })
      await this.deps.recordPlaybookStage({
        taskId: created.task.id,
        playbookKey: 'gmail_inbound_monitor',
        stage: 'CHECKPOINT',
        actorOwnerKey: GMAIL_CHECKPOINT_OWNER_KEY,
        idempotencyKey: `checkpoint:${snapshotKeySuffix}`,
        evidence: { snapshot: checkpoint },
        note: 'gmail inbound monitor checkpoint registered',
      })
      return
    }

    await this.deps.recordPlaybookStage({
      taskId: existing.id,
      playbookKey: 'gmail_inbound_monitor',
      stage: 'CHECKPOINT',
      actorOwnerKey: GMAIL_CHECKPOINT_OWNER_KEY,
      idempotencyKey: `checkpoint:${snapshotKeySuffix}`,
      evidence: { snapshot: checkpoint },
    })
  }
}

// ---------------------------------------------------------------------------
// DbContactDirectory — read-derived from destination_relationship runs
// ---------------------------------------------------------------------------

export interface DbContactDirectoryDeps {
  getTasksBySourceType: typeof getTasksBySourceType
  runStore: DbPlaybookRunStore
  /**
   * Phase 2L — legacy pre-Phase-2I relationship evidence: real
   * destinations (Willcox, Grand Lake, Rim Country, Buena Vista, etc.)
   * had contacts/interactions/tasks before the destination_relationship
   * driver existed. Without this, DbContactDirectory could only resolve
   * inbound email for destinations that already have a driver run — too
   * narrow for real operation. Never manufactures a contact; only reads
   * ones agent.contacts already has.
   */
  getDestinationContactEmails: typeof getDestinationContactEmails
}

const REAL_CONTACT_DIRECTORY_DEPS: DbContactDirectoryDeps = { getTasksBySourceType, runStore: new DbPlaybookRunStore(), getDestinationContactEmails }

export class DbContactDirectory implements MutableContactDirectory {
  constructor(private readonly deps: DbContactDirectoryDeps = REAL_CONTACT_DIRECTORY_DEPS) {}

  async listActiveContacts(): Promise<KnownRelationshipContact[]> {
    const tasks = await this.deps.getTasksBySourceType(PLAYBOOK_RUN_SOURCE_TYPE)
    const relationshipRunRefs = tasks.map((t) => t.sourceRef).filter((ref): ref is string => !!ref && ref.startsWith(`${RELATIONSHIP_PLAYBOOK_KEY}:`))

    const contacts: KnownRelationshipContact[] = []
    for (const runId of relationshipRunRefs) {
      const run = await this.deps.runStore.get(runId)
      if (!run) continue
      const state = run.state as {
        primaryContact?: { contactId: string; email: string }
        contacts?: Array<{ contactId: string }>
        contactEmails?: Record<string, string>
        contactThreadIds?: Record<string, string>
      }
      const contactEmails = state.contactEmails ?? {}
      const contactThreadIds = state.contactThreadIds ?? {}

      // Every contact here — primary or referred — is scoped to THIS
      // run's own projectId, exactly like the in-memory/file directories.
      // No cross-run merge happens anywhere in this loop.
      if (state.primaryContact) {
        contacts.push({ destinationId: run.projectId, contactId: state.primaryContact.contactId, email: contactEmails[state.primaryContact.contactId] ?? state.primaryContact.email, threadId: contactThreadIds[state.primaryContact.contactId] ?? null })
      }
      for (const c of state.contacts ?? []) {
        const email = contactEmails[c.contactId]
        if (!email) continue // an introduced stakeholder with no email on file yet cannot be associated against — never guess one
        contacts.push({ destinationId: run.projectId, contactId: c.contactId, email, threadId: contactThreadIds[c.contactId] ?? null })
      }
    }

    // Legacy pre-Phase-2I contacts — merged in, never overriding a
    // driver-derived contact for the same (destinationId, contactId).
    const seen = new Set(contacts.map((c) => `${c.destinationId}:${c.contactId}`))
    const legacy = await this.deps.getDestinationContactEmails()
    for (const l of legacy) {
      const key = `${l.projectKey}:${l.contactId}`
      if (seen.has(key)) continue
      seen.add(key)
      contacts.push({ destinationId: l.projectKey, contactId: l.contactId, email: l.email, threadId: null })
    }

    return contacts
  }

  /**
   * Intentional no-op — see this module's own header doc. The relationship
   * driver writes the exact same contact/email/thread data into its own
   * run.state within the SAME call that would invoke this, and that run
   * is already persisted via DbPlaybookRunStore.put() — a second write
   * here would just be a duplicate, driftable copy of state already
   * durable elsewhere. listActiveContacts() above reads the canonical copy.
   */
  async upsertContact(_contact: KnownRelationshipContact): Promise<void> {
    // no-op by design
  }
}
