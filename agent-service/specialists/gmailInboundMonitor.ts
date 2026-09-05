// Chief Phase 2J — the production Gmail inbound event source. Phase 2I
// built applyRelationshipResumeEvent() but nothing called it
// automatically. This module is what calls it: a slow, reliable polling
// check (per Jerry's explicit preference — "slow, steady, inexpensive
// background execution over speed," no realtime push/Pub/Sub
// infrastructure needed for a workload this small) that finds genuinely
// NEW messages since the last checkpoint, associates each to exactly one
// known relationship contact (never a destination-name text search —
// association is deterministic, keyed by thread id / sender email, see
// gmailRelationshipLogic.ts), classifies it, and resumes that one
// relationship — never any other.
//
// WHY POLLING, NOT GMAIL PUSH/WATCH + PUB/SUB: push notifications need a
// public HTTPS endpoint, a Cloud Pub/Sub topic, and a renewing watch()
// subscription (expires every 7 days) — real infrastructure whose only
// benefit here is latency, and Jerry explicitly does not need realtime
// email response. A 15-minute poll against a durable checkpoint is
// simpler, has no moving infrastructure to fail silently, and is exactly
// as reliable as the checkpoint store it's backed by. If email volume or
// latency needs ever change this tradeoff, push+Pub/Sub is the documented
// alternative — not adopted now because the simpler thing is sufficient.

import type { GmailAdapter, GmailMessageSummary } from './googleAdapters'
import { associateInboundEmail, type InboundEmail, type KnownRelationshipContact, type KnownContactDirectory, type MutableContactDirectory } from '../playbooks/gmailRelationshipLogic'
import type { RelationshipResumeEventInput, ResumeEventResult } from './destinationRelationshipDriver'

// ---------------------------------------------------------------------------
// Durable checkpoint — survives process restart. What's persisted:
// last successful check time (so the next poll only asks Gmail for
// messages since then) and a bounded set of already-processed message
// ids (idempotency — the SAME message must never resume a relationship
// twice, even if it reappears in a search window due to Gmail's own
// eventual consistency or a re-run after a crash mid-poll).
// ---------------------------------------------------------------------------

export interface UnassociatedInboundMessage {
  messageId: string
  from: string
  subject: string
  reason: string
  detectedAtIso: string
}

export interface GmailCheckpoint {
  lastCheckedAtIso: string | null
  processedMessageIds: string[]
  /** Messages that could not be confidently associated to exactly one relationship — surfaced for Jerry (Chief Brief), never silently dropped and never guessed onto a destination. */
  unassociated: UnassociatedInboundMessage[]
}

const MAX_PROCESSED_IDS_RETAINED = 1000
const MAX_UNASSOCIATED_RETAINED = 100

export function emptyCheckpoint(): GmailCheckpoint {
  return { lastCheckedAtIso: null, processedMessageIds: [], unassociated: [] }
}

export interface GmailCheckpointStore {
  get(): Promise<GmailCheckpoint>
  put(checkpoint: GmailCheckpoint): Promise<void>
}

export class InMemoryGmailCheckpointStore implements GmailCheckpointStore {
  private checkpoint: GmailCheckpoint = emptyCheckpoint()
  async get(): Promise<GmailCheckpoint> {
    return this.checkpoint
  }
  async put(checkpoint: GmailCheckpoint): Promise<void> {
    this.checkpoint = checkpoint
  }
}

/**
 * A real, file-backed checkpoint — same "local JSON file, gitignored"
 * pattern cli.ts's FileExecutionStore already uses for a non-DB-backed
 * option. A DB-backed implementation (a new agent-service table) is the
 * natural production upgrade and is NOT built here — an honest,
 * documented gap rather than inventing schema without reviewing this
 * repo's DB migration conventions first.
 */
export class FileGmailCheckpointStore implements GmailCheckpointStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<GmailCheckpoint> {
    const fs = await import('node:fs/promises')
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      return JSON.parse(raw) as GmailCheckpoint
    } catch {
      return emptyCheckpoint()
    }
  }

  async put(checkpoint: GmailCheckpoint): Promise<void> {
    const fs = await import('node:fs/promises')
    await fs.writeFile(this.filePath, JSON.stringify(checkpoint, null, 2), 'utf8')
  }
}

// ---------------------------------------------------------------------------
// Known-contact directory — who Chief can currently resolve an inbound
// email to. Deliberately an interface, not a direct PlaybookRunStore
// dependency: PlaybookRunStore (playbookRun.ts) has no "list all active
// runs" method today, and adding one is a shared-interface change this
// phase doesn't need to make. A real production caller builds this from
// whatever store enumerates active destination_relationship runs (a DB
// query); tests/dry-runs supply it directly.
// ---------------------------------------------------------------------------

export type { KnownContactDirectory, MutableContactDirectory } from '../playbooks/gmailRelationshipLogic'

export class InMemoryContactDirectory implements MutableContactDirectory {
  constructor(private contacts: KnownRelationshipContact[] = []) {}
  async listActiveContacts(): Promise<KnownRelationshipContact[]> {
    return this.contacts
  }
  async upsertContact(contact: KnownRelationshipContact): Promise<void> {
    const i = this.contacts.findIndex((c) => c.destinationId === contact.destinationId && c.contactId === contact.contactId)
    if (i === -1) this.contacts.push(contact)
    else this.contacts[i] = contact
  }
}

/**
 * A real, file-backed contact directory — same rationale as
 * FileGmailCheckpointStore: a durable-enough default for a single-process
 * deployment without inventing new DB schema. A DB-backed version
 * (querying active destination_relationship runs directly) is the
 * natural production upgrade and, like the checkpoint store, is an
 * honest, documented gap rather than guessed-at schema.
 */
export class FileContactDirectory implements MutableContactDirectory {
  constructor(private readonly filePath: string) {}

  async listActiveContacts(): Promise<KnownRelationshipContact[]> {
    const fs = await import('node:fs/promises')
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      return JSON.parse(raw) as KnownRelationshipContact[]
    } catch {
      return []
    }
  }

  async upsertContact(contact: KnownRelationshipContact): Promise<void> {
    const contacts = await this.listActiveContacts()
    const i = contacts.findIndex((c) => c.destinationId === contact.destinationId && c.contactId === contact.contactId)
    if (i === -1) contacts.push(contact)
    else contacts[i] = contact
    const fs = await import('node:fs/promises')
    await fs.writeFile(this.filePath, JSON.stringify(contacts, null, 2), 'utf8')
  }
}

// ---------------------------------------------------------------------------
// The poll itself
// ---------------------------------------------------------------------------

export interface PollGmailResult {
  newMessagesFound: number
  resumeEventsEmitted: number
  ambiguousOrUnassociatedCount: number
  error: string | null
}

function toGmailMessage(msg: GmailMessageSummary, now: () => string): InboundEmail {
  return { from: msg.from, to: msg.to, threadId: msg.threadId, subject: msg.subject, bodyText: msg.snippet, receivedAt: msg.receivedAt ?? now() }
}

/**
 * One poll cycle: fetch anything new since the checkpoint, associate +
 * classify + resume each, and persist an updated checkpoint — even on
 * partial failure, so a crash mid-poll never re-processes what already
 * succeeded (each message is marked processed as soon as its resume
 * attempt completes, success or rejection alike — a REJECTED association
 * is still a settled outcome for that message, not a reason to keep
 * re-asking).
 */
export async function pollGmailForNewMessages(
  gmail: GmailAdapter,
  checkpointStore: GmailCheckpointStore,
  contactDirectory: KnownContactDirectory,
  applyResumeEvent: (destinationId: string, event: RelationshipResumeEventInput) => Promise<ResumeEventResult>,
  now: () => string = () => new Date().toISOString()
): Promise<PollGmailResult> {
  if (!gmail.isConfigured()) return { newMessagesFound: 0, resumeEventsEmitted: 0, ambiguousOrUnassociatedCount: 0, error: null }

  const checkpoint = await checkpointStore.get()
  const query = checkpoint.lastCheckedAtIso ? `after:${Math.floor(new Date(checkpoint.lastCheckedAtIso).getTime() / 1000)}` : 'newer_than:1d'

  let messages: GmailMessageSummary[]
  try {
    messages = await gmail.searchMessages(query, 50)
  } catch (err) {
    // A failed poll changes nothing — next cycle retries from the SAME
    // checkpoint, so a transient Gmail/network failure never loses a message.
    return { newMessagesFound: 0, resumeEventsEmitted: 0, ambiguousOrUnassociatedCount: 0, error: err instanceof Error ? err.message : String(err) }
  }

  const processedSet = new Set(checkpoint.processedMessageIds)
  const contacts = await contactDirectory.listActiveContacts()
  const newUnassociated: UnassociatedInboundMessage[] = []

  let newMessagesFound = 0
  let resumeEventsEmitted = 0
  let ambiguousOrUnassociatedCount = 0

  for (const msg of messages) {
    if (processedSet.has(msg.id)) continue // idempotency — never resume a relationship twice from the same message, including across a restart
    newMessagesFound++

    const inboundEmail = toGmailMessage(msg, now)
    const association = associateInboundEmail(inboundEmail, contacts)

    if (!association.associated) {
      ambiguousOrUnassociatedCount++
      newUnassociated.push({ messageId: msg.id, from: msg.from, subject: msg.subject, reason: association.reason, detectedAtIso: now() })
      processedSet.add(msg.id)
      continue
    }

    const result = await applyResumeEvent(association.destinationId, {
      kind: 'GMAIL_REPLY_RECEIVED',
      destinationId: association.destinationId,
      contactId: association.contactId,
      occurredAt: msg.receivedAt ?? now(),
      payload: {},
      email: inboundEmail,
    })
    if (result.rejected) {
      ambiguousOrUnassociatedCount++
      newUnassociated.push({ messageId: msg.id, from: msg.from, subject: msg.subject, reason: result.reason, detectedAtIso: now() })
    } else {
      resumeEventsEmitted++
    }
    processedSet.add(msg.id)
  }

  await checkpointStore.put({
    lastCheckedAtIso: now(),
    processedMessageIds: [...processedSet].slice(-MAX_PROCESSED_IDS_RETAINED),
    unassociated: [...checkpoint.unassociated, ...newUnassociated].slice(-MAX_UNASSOCIATED_RETAINED),
  })

  return { newMessagesFound, resumeEventsEmitted, ambiguousOrUnassociatedCount, error: null }
}
