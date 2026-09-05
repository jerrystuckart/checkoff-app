import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pollGmailForNewMessages, reevaluateUnassociatedForwardedMessages, InMemoryGmailCheckpointStore, InMemoryContactDirectory, FileGmailCheckpointStore, emptyCheckpoint, type GmailCheckpointStore } from './gmailInboundMonitor'
import type { GmailAdapter, GmailFullMessage, GmailMessageSummary, GmailSendAsIdentity } from './googleAdapters'
import type { KnownRelationshipContact } from '../playbooks/gmailRelationshipLogic'
import type { RelationshipResumeEventInput, ResumeEventResult } from './destinationRelationshipDriver'

class FakeGmail implements GmailAdapter {
  configured = true
  messages: GmailMessageSummary[] = []
  fullMessages: Record<string, GmailFullMessage> = {}
  isConfigured() {
    return this.configured
  }
  async searchMessages(): Promise<GmailMessageSummary[]> {
    return this.messages
  }
  async getFullMessage(messageId: string): Promise<GmailFullMessage> {
    const full = this.fullMessages[messageId]
    if (!full) throw new Error(`FakeGmail.getFullMessage: no fixture registered for ${messageId}`)
    return full
  }
  async listSendAsIdentities(): Promise<GmailSendAsIdentity[]> {
    return []
  }
  async createDraft(): Promise<{ draftId: string; messageId: string; threadId: string }> {
    throw new Error('not used in monitor tests')
  }
  async sendMessage(): Promise<{ messageId: string; threadId: string }> {
    throw new Error('not used in monitor tests')
  }
}

function msg(overrides: Partial<GmailMessageSummary> = {}): GmailMessageSummary {
  return { id: 'm1', threadId: 't1', from: 'jane@hoodriver.example.com', to: ['chief@checkoff.app'], subject: 'Re: intro', snippet: 'Sounds interesting!', receivedAt: '2026-09-08T10:00:00Z', replyTo: null, ...overrides }
}

function fullMsg(overrides: Partial<GmailFullMessage> = {}): GmailFullMessage {
  return { id: 'm1', threadId: 't1', from: 'jane@hoodriver.example.com', to: ['chief@checkoff.app'], cc: [], replyTo: null, subject: 'Re: intro', bodyText: 'Sounds interesting!', receivedAt: '2026-09-08T10:00:00Z', ...overrides }
}

function recorder(): { apply: (destinationId: string, event: RelationshipResumeEventInput) => Promise<ResumeEventResult>; calls: Array<{ destinationId: string; event: RelationshipResumeEventInput }> } {
  const calls: Array<{ destinationId: string; event: RelationshipResumeEventInput }> = []
  return {
    calls,
    apply: async (destinationId, event) => {
      calls.push({ destinationId, event })
      return { rejected: false, run: {} as any }
    },
  }
}

const contact: KnownRelationshipContact = { destinationId: 'destination-hood-river-or', contactId: 'contact-1', email: 'jane@hoodriver.example.com', threadId: 't1' }

test('pollGmailForNewMessages: a new message is associated, classified, and resumes the correct destination', async () => {
  const gmail = new FakeGmail()
  gmail.messages = [msg()]
  const checkpointStore = new InMemoryGmailCheckpointStore()
  const contacts = new InMemoryContactDirectory([contact])
  const { apply, calls } = recorder()

  const result = await pollGmailForNewMessages(gmail, checkpointStore, contacts, apply)
  assert.equal(result.newMessagesFound, 1)
  assert.equal(result.resumeEventsEmitted, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].destinationId, 'destination-hood-river-or')
})

test('pollGmailForNewMessages: the SAME message is never processed twice — idempotent even within one poll call', async () => {
  const gmail = new FakeGmail()
  gmail.messages = [msg(), msg()] // duplicate entry, simulating a Gmail search returning overlap
  const checkpointStore = new InMemoryGmailCheckpointStore()
  const contacts = new InMemoryContactDirectory([contact])
  const { apply, calls } = recorder()

  await pollGmailForNewMessages(gmail, checkpointStore, contacts, apply)
  assert.equal(calls.length, 1, 'the second identical message id must be a no-op')
})

test('pollGmailForNewMessages: re-running after a "crash" (checkpoint already persisted) never reprocesses an already-handled message', async () => {
  const gmail = new FakeGmail()
  gmail.messages = [msg()]
  const checkpointStore = new InMemoryGmailCheckpointStore()
  const contacts = new InMemoryContactDirectory([contact])
  const { apply, calls } = recorder()

  await pollGmailForNewMessages(gmail, checkpointStore, contacts, apply)
  // Simulate Gmail's search window still overlapping (same message reappears in the next poll).
  const secondResult = await pollGmailForNewMessages(gmail, checkpointStore, contacts, apply)
  assert.equal(secondResult.newMessagesFound, 0)
  assert.equal(calls.length, 1, 'the relationship must never be resumed twice from the same message')
})

test('pollGmailForNewMessages: checkpoint survives a process restart (a FRESH checkpoint store instance built from the SAME persisted data)', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'chief-gmail-checkpoint-'))
  const filePath = join(tmpDir, 'checkpoint.json')
  try {
    const gmail = new FakeGmail()
    gmail.messages = [msg()]
    const contacts = new InMemoryContactDirectory([contact])
    const { apply, calls } = recorder()

    const storeBeforeRestart: GmailCheckpointStore = new FileGmailCheckpointStore(filePath)
    await pollGmailForNewMessages(gmail, storeBeforeRestart, contacts, apply)
    assert.equal(calls.length, 1)

    // A brand-new store instance, as if the process restarted — must read the SAME file.
    const storeAfterRestart: GmailCheckpointStore = new FileGmailCheckpointStore(filePath)
    await pollGmailForNewMessages(gmail, storeAfterRestart, contacts, apply)
    assert.equal(calls.length, 1, 'the message must still be recognized as already-processed after a simulated restart')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('FileGmailCheckpointStore: get() on a non-existent file returns an empty checkpoint rather than throwing', async () => {
  const store = new FileGmailCheckpointStore(join(tmpdir(), `chief-nonexistent-${Date.now()}.json`))
  const checkpoint = await store.get()
  assert.deepEqual(checkpoint, emptyCheckpoint())
})

test('pollGmailForNewMessages: an ambiguous/unassociated message is recorded for Jerry, never guessed onto a destination', async () => {
  const gmail = new FakeGmail()
  gmail.messages = [msg({ from: 'stranger@nowhere.example.com', threadId: 'unknown-thread' })]
  const checkpointStore = new InMemoryGmailCheckpointStore()
  const contacts = new InMemoryContactDirectory([contact])
  const { apply, calls } = recorder()

  const result = await pollGmailForNewMessages(gmail, checkpointStore, contacts, apply)
  assert.equal(result.resumeEventsEmitted, 0)
  assert.equal(result.ambiguousOrUnassociatedCount, 1)
  assert.equal(calls.length, 0, 'never resumes any relationship for an unassociated message')

  const checkpoint = await checkpointStore.get()
  assert.equal(checkpoint.unassociated.length, 1)
  assert.equal(checkpoint.unassociated[0].from, 'stranger@nowhere.example.com')
})

test('pollGmailForNewMessages: a message matching contacts across TWO destinations is refused, never cross-associated', async () => {
  const gmail = new FakeGmail()
  gmail.messages = [msg({ from: 'shared@example.com', threadId: null as any })]
  const checkpointStore = new InMemoryGmailCheckpointStore()
  const contactA: KnownRelationshipContact = { destinationId: 'destination-a', contactId: 'contact-a', email: 'shared@example.com', threadId: null }
  const contactB: KnownRelationshipContact = { destinationId: 'destination-b', contactId: 'contact-b', email: 'shared@example.com', threadId: null }
  const contacts = new InMemoryContactDirectory([contactA, contactB])
  const { apply, calls } = recorder()

  const result = await pollGmailForNewMessages(gmail, checkpointStore, contacts, apply)
  assert.equal(result.ambiguousOrUnassociatedCount, 1)
  assert.equal(calls.length, 0)
})

test('pollGmailForNewMessages: an introduced stakeholder (added to the directory after the fact) can be resolved on her own later poll', async () => {
  const gmail = new FakeGmail()
  const introducedContact: KnownRelationshipContact = { destinationId: 'destination-hood-river-or', contactId: 'contact-2', email: 'md@hoodriver.example.com', threadId: null }
  const contacts = new InMemoryContactDirectory([contact, introducedContact])
  const checkpointStore = new InMemoryGmailCheckpointStore()
  const { apply, calls } = recorder()

  gmail.messages = [msg({ id: 'm2', from: 'md@hoodriver.example.com', threadId: 'new-thread-2', subject: 'Following up' })]
  const result = await pollGmailForNewMessages(gmail, checkpointStore, contacts, apply)
  assert.equal(result.resumeEventsEmitted, 1)
  assert.equal(calls[0].destinationId, 'destination-hood-river-or')
  assert.equal(calls[0].event.contactId, 'contact-2')
})

test('pollGmailForNewMessages: thread id is the association signal actually used when present — proves thread continuity matters for real association', async () => {
  const gmail = new FakeGmail()
  // Sender email deliberately absent from the directory — ONLY the thread id can resolve this.
  const threadOnlyContact: KnownRelationshipContact = { destinationId: 'destination-hood-river-or', contactId: 'contact-1', email: 'different-address-now@hoodriver.example.com', threadId: 't1' }
  gmail.messages = [msg({ from: 'jane@hoodriver.example.com', threadId: 't1' })]
  const contacts = new InMemoryContactDirectory([threadOnlyContact])
  const checkpointStore = new InMemoryGmailCheckpointStore()
  const { apply, calls } = recorder()

  const result = await pollGmailForNewMessages(gmail, checkpointStore, contacts, apply)
  assert.equal(result.resumeEventsEmitted, 1)
  assert.equal(calls[0].destinationId, 'destination-hood-river-or')
})

test('pollGmailForNewMessages: returns cleanly (no throw, no checkpoint corruption) when Gmail is unconfigured', async () => {
  const gmail = new FakeGmail()
  gmail.configured = false
  const checkpointStore = new InMemoryGmailCheckpointStore()
  const contacts = new InMemoryContactDirectory([contact])
  const { apply } = recorder()
  const result = await pollGmailForNewMessages(gmail, checkpointStore, contacts, apply)
  assert.equal(result.newMessagesFound, 0)
  assert.equal(result.error, null)
})

test('pollGmailForNewMessages: a Gmail search failure is reported, and does NOT advance the checkpoint (safe to retry from the same point)', async () => {
  class FailingGmail extends FakeGmail {
    async searchMessages(): Promise<GmailMessageSummary[]> {
      throw new Error('Gmail API returned 503')
    }
  }
  const gmail = new FailingGmail()
  const checkpointStore = new InMemoryGmailCheckpointStore()
  const contacts = new InMemoryContactDirectory([contact])
  const { apply } = recorder()

  const result = await pollGmailForNewMessages(gmail, checkpointStore, contacts, apply)
  assert.match(result.error ?? '', /503/)
  const checkpoint = await checkpointStore.get()
  assert.equal(checkpoint.lastCheckedAtIso, null, 'a failed poll must not advance the checkpoint')
})

test('pollGmailForNewMessages: 20 active destinations with mixed inbound activity all resolve to their OWN destination, never cross-contaminating', async () => {
  const destinationIds = Array.from({ length: 20 }, (_, i) => `destination-${i.toString().padStart(2, '0')}`)
  const contacts = destinationIds.map((id, i): KnownRelationshipContact => ({ destinationId: id, contactId: `contact-${id}`, email: `contact@${id}.example.com`, threadId: i % 2 === 0 ? `thread-${id}` : null }))

  const gmail = new FakeGmail()
  gmail.messages = destinationIds.map(
    (id, i): GmailMessageSummary => ({
      id: `msg-${id}`,
      threadId: i % 2 === 0 ? `thread-${id}` : `unrelated-thread-${id}`,
      from: `contact@${id}.example.com`,
      to: ['chief@checkoff.app'],
      subject: `Re: ${id}`,
      snippet: i % 3 === 0 ? "I'd love to talk next week." : i % 3 === 1 ? 'Can you send more info?' : 'Sounds good, thanks!',
      receivedAt: '2026-09-08T10:00:00Z',
      replyTo: null,
    })
  )

  const contactDirectory = new InMemoryContactDirectory(contacts)
  const checkpointStore = new InMemoryGmailCheckpointStore()
  const { apply, calls } = recorder()

  const result = await pollGmailForNewMessages(gmail, checkpointStore, contactDirectory, apply)
  assert.equal(result.resumeEventsEmitted, 20)
  assert.equal(calls.length, 20)

  // Every call's destinationId matches the message it was actually generated from — a leak would show up as a mismatch or a collapsed Set below 20.
  const gmailCalls = calls.filter((c): c is { destinationId: string; event: Extract<RelationshipResumeEventInput, { kind: 'GMAIL_REPLY_RECEIVED' }> } => c.event.kind === 'GMAIL_REPLY_RECEIVED')
  for (let i = 0; i < 20; i++) {
    const call = gmailCalls.find((c) => c.event.email.from === `contact@${destinationIds[i]}.example.com`)
    assert.ok(call)
    assert.equal(call!.destinationId, destinationIds[i])
  }
  assert.equal(new Set(calls.map((c) => c.destinationId)).size, 20)
})

// ---------------------------------------------------------------------------
// Phase 2L — reevaluateUnassociatedForwardedMessages(). A real overnight
// proof caught that pollGmailForNewMessages()'s search-result snippet is
// too short to ever contain a forwarded-header block, so a Resend-relayed
// message always landed in `unassociated`. This targeted reprocessing
// function fetches the FULL body only for the forwarding-address subset
// and re-associates them — never blindly replaying the whole backlog.
// ---------------------------------------------------------------------------

const WILLCOX_CONTACT: KnownRelationshipContact = { destinationId: 'destination-willcox-az', contactId: 'contact-lisa', email: 'lisa@willcoxchamber.org', threadId: null }

function willcoxUnassociatedEntry(overrides: Partial<{ messageId: string; from: string; subject: string; reason: string; detectedAtIso: string }> = {}) {
  return { messageId: 'fwd-1', from: 'CheckOff Forwarder <forwarder@getcheckoff.com>', subject: 'Fwd: Willcox pricing', reason: 'no known relationship contact matches transport sender forwarder@getcheckoff.com.', detectedAtIso: '2026-09-04T09:00:00Z', ...overrides }
}

test('reevaluateUnassociatedForwardedMessages: only re-evaluates entries whose transport sender is a known forwarding address — an ordinary unmatched sender is left untouched', async () => {
  const checkpointStore = new InMemoryGmailCheckpointStore()
  await checkpointStore.put({
    lastCheckedAtIso: '2026-09-04T09:00:00Z',
    processedMessageIds: ['fwd-1', 'ordinary-1'],
    unassociated: [willcoxUnassociatedEntry(), { messageId: 'ordinary-1', from: 'newsletter@substack.com', subject: 'Weekly digest', reason: 'no known relationship contact matches transport sender newsletter@substack.com.', detectedAtIso: '2026-09-04T09:00:00Z' }],
  })
  const gmail = new FakeGmail()
  gmail.fullMessages['fwd-1'] = fullMsg({
    id: 'fwd-1',
    from: 'CheckOff Forwarder <forwarder@getcheckoff.com>',
    to: ['jerry@getcheckoff.com'],
    subject: 'Fwd: Willcox pricing',
    bodyText: ['---------- Forwarded message ---------', 'From: Desiree Gerth <desiree@example.com>', 'To: Lisa Ramirez <lisa@willcoxchamber.org>, Jerry Stuckart <jerry@getcheckoff.com>', 'Subject: Willcox pricing', '', 'Hi Lisa, following up on pricing...'].join('\n'),
  })
  const contactDirectory = new InMemoryContactDirectory([WILLCOX_CONTACT])
  const { apply, calls } = recorder()

  const result = await reevaluateUnassociatedForwardedMessages(gmail, checkpointStore, contactDirectory, apply)
  assert.equal(result.candidatesConsidered, 1, 'only the forwarding-address entry is a candidate, never the ordinary newsletter noise')
  assert.equal(result.resumeEventsEmitted, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].destinationId, 'destination-willcox-az')

  const finalCheckpoint = await checkpointStore.get()
  assert.equal(finalCheckpoint.unassociated.some((u) => u.messageId === 'fwd-1'), false, 'resolved entry is removed from unassociated')
  assert.equal(finalCheckpoint.unassociated.some((u) => u.messageId === 'ordinary-1'), true, 'untouched entry remains exactly as it was')
  assert.deepEqual(finalCheckpoint.processedMessageIds, ['fwd-1', 'ordinary-1'], 'processedMessageIds is never touched by reprocessing — idempotency is preserved from the original poll')
})

test('reevaluateUnassociatedForwardedMessages: the SAME forwarded message can never resume the relationship twice — a second call after resolution is a no-op', async () => {
  const checkpointStore = new InMemoryGmailCheckpointStore()
  await checkpointStore.put({ lastCheckedAtIso: '2026-09-04T09:00:00Z', processedMessageIds: ['fwd-1'], unassociated: [willcoxUnassociatedEntry()] })
  const gmail = new FakeGmail()
  gmail.fullMessages['fwd-1'] = fullMsg({
    id: 'fwd-1',
    from: 'CheckOff Forwarder <forwarder@getcheckoff.com>',
    to: ['jerry@getcheckoff.com'],
    subject: 'Fwd: Willcox pricing',
    bodyText: ['---------- Forwarded message ---------', 'From: Desiree Gerth <desiree@example.com>', 'To: Lisa Ramirez <lisa@willcoxchamber.org>, Jerry Stuckart <jerry@getcheckoff.com>', 'Subject: Willcox pricing', '', 'Hi Lisa...'].join('\n'),
  })
  const contactDirectory = new InMemoryContactDirectory([WILLCOX_CONTACT])
  const { apply, calls } = recorder()

  const first = await reevaluateUnassociatedForwardedMessages(gmail, checkpointStore, contactDirectory, apply)
  assert.equal(first.resumeEventsEmitted, 1)

  const second = await reevaluateUnassociatedForwardedMessages(gmail, checkpointStore, contactDirectory, apply)
  assert.equal(second.candidatesConsidered, 0, 'already resolved — no longer a candidate on the second call')
  assert.equal(second.resumeEventsEmitted, 0)
  assert.equal(calls.length, 1, 'the relationship was resumed exactly once, never twice')
})

test('reevaluateUnassociatedForwardedMessages: an ambiguous forwarded message stays unassociated after reprocessing — never guessed', async () => {
  const checkpointStore = new InMemoryGmailCheckpointStore()
  await checkpointStore.put({ lastCheckedAtIso: '2026-09-04T09:00:00Z', processedMessageIds: ['fwd-1'], unassociated: [willcoxUnassociatedEntry()] })
  const gmail = new FakeGmail()
  gmail.fullMessages['fwd-1'] = fullMsg({
    id: 'fwd-1',
    from: 'CheckOff Forwarder <forwarder@getcheckoff.com>',
    subject: 'Fwd: Willcox pricing',
    bodyText: 'Just a relayed note, no forward header block, no Reply-To.',
  })
  const contactDirectory = new InMemoryContactDirectory([WILLCOX_CONTACT])
  const { apply, calls } = recorder()

  const result = await reevaluateUnassociatedForwardedMessages(gmail, checkpointStore, contactDirectory, apply)
  assert.equal(result.candidatesConsidered, 1)
  assert.equal(result.resumeEventsEmitted, 0)
  assert.equal(calls.length, 0)
  assert.equal(result.results[0].outcome, 'STILL_UNASSOCIATED')

  const finalCheckpoint = await checkpointStore.get()
  assert.equal(finalCheckpoint.unassociated.length, 1, 'still-unresolved entry is retained, not silently dropped')
})

test('reevaluateUnassociatedForwardedMessages: with no forwarding-address entries in the backlog, does nothing — never touches Gmail or the checkpoint', async () => {
  const checkpointStore = new InMemoryGmailCheckpointStore()
  await checkpointStore.put({ lastCheckedAtIso: '2026-09-04T09:00:00Z', processedMessageIds: ['ordinary-1'], unassociated: [{ messageId: 'ordinary-1', from: 'newsletter@substack.com', subject: 'Weekly digest', reason: 'no match', detectedAtIso: '2026-09-04T09:00:00Z' }] })
  const gmail = new FakeGmail()
  const contactDirectory = new InMemoryContactDirectory([WILLCOX_CONTACT])
  const { apply, calls } = recorder()

  const result = await reevaluateUnassociatedForwardedMessages(gmail, checkpointStore, contactDirectory, apply)
  assert.equal(result.candidatesConsidered, 0)
  assert.equal(calls.length, 0)
})

test('Phase 2M portfolio: a message that stays unassociated (no contact yet) becomes associable once the contact directory is backfilled, and is never reprocessed again afterward — mirrors the real Willcox backfill sequence', async () => {
  const checkpointStore = new InMemoryGmailCheckpointStore()
  await checkpointStore.put({ lastCheckedAtIso: '2026-09-04T09:00:00Z', processedMessageIds: ['fwd-1'], unassociated: [willcoxUnassociatedEntry()] })
  const gmail = new FakeGmail()
  gmail.fullMessages['fwd-1'] = fullMsg({
    id: 'fwd-1',
    from: 'CheckOff Forwarder <forwarder@getcheckoff.com>',
    to: ['jerrystuckart@gmail.com'],
    replyTo: 'dez@strivevineyards.com',
    subject: 'Fwd: Willcox pricing',
    bodyText: 'No forwarded-header block here — recovered only via Reply-To, exactly like the real message.',
  })

  // BEFORE backfill: no known contact directory entry yet — stays unassociated.
  const emptyDirectory = new InMemoryContactDirectory([])
  const { apply: apply1, calls: calls1 } = recorder()
  const before = await reevaluateUnassociatedForwardedMessages(gmail, checkpointStore, emptyDirectory, apply1)
  assert.equal(before.resumeEventsEmitted, 0)
  assert.equal(calls1.length, 0)
  assert.equal((await checkpointStore.get()).unassociated.length, 1, 'still unassociated before the contact backfill')

  // AFTER backfill: the contact directory now has Desiree Gerth scoped to Willcox.
  const desireeContact: KnownRelationshipContact = { destinationId: 'destination-willcox-az', contactId: 'contact-desiree', email: 'dez@strivevineyards.com', threadId: null }
  const backfilledDirectory = new InMemoryContactDirectory([desireeContact])
  const { apply: apply2, calls: calls2 } = recorder()
  const after = await reevaluateUnassociatedForwardedMessages(gmail, checkpointStore, backfilledDirectory, apply2)
  assert.equal(after.resumeEventsEmitted, 1)
  assert.equal(calls2.length, 1)
  assert.equal(calls2[0].destinationId, 'destination-willcox-az')
  assert.equal((await checkpointStore.get()).unassociated.length, 0, 'resolved after backfill')

  // A THIRD run must never resume it again — idempotency survives across
  // a contact-directory change, not just within one directory's lifetime.
  const { apply: apply3, calls: calls3 } = recorder()
  const third = await reevaluateUnassociatedForwardedMessages(gmail, checkpointStore, backfilledDirectory, apply3)
  assert.equal(third.candidatesConsidered, 0)
  assert.equal(calls3.length, 0)
})
