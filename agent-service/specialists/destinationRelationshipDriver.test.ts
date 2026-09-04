import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveDestinationRelationship, applyRelationshipResumeEvent, type RelationshipDriverDeps, type DriveDestinationRelationshipOptions } from './destinationRelationshipDriver'
import { InMemoryPlaybookRunStore, playbookRunId, recordJerryDecision } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import type { GmailAdapter, GmailMessageSummary, GoogleCalendarAdapter, FreeBusyWindow, GoogleContactsAdapter, ContactSummary } from './googleAdapters'
import type { DAPArtifact, DVA1Artifact, DVA2Artifact } from '../playbooks/destinationHubLifecycle'

// ---------------------------------------------------------------------------
// In-memory fakes — never real HTTP, same discipline as TestExecutor. Used
// so driver tests exercise real orchestration logic without needing a
// live Google OAuth token (this environment has none).
// ---------------------------------------------------------------------------

class FakeGmailAdapter implements GmailAdapter {
  configured = true
  searchResults: GmailMessageSummary[] = []
  sentMessages: Array<{ to: string; subject: string; bodyText: string }> = []
  drafts: Array<{ to: string; subject: string; bodyText: string }> = []
  isConfigured() {
    return this.configured
  }
  async searchMessages(): Promise<GmailMessageSummary[]> {
    return this.searchResults
  }
  async createDraft(input: { to: string; subject: string; bodyText: string; threadId?: string }): Promise<{ draftId: string }> {
    this.drafts.push(input)
    return { draftId: `draft-${this.drafts.length}` }
  }
  async sendMessage(input: { to: string; subject: string; bodyText: string; threadId?: string }): Promise<{ messageId: string }> {
    this.sentMessages.push(input)
    return { messageId: `msg-${this.sentMessages.length}` }
  }
}

class FakeCalendarAdapter implements GoogleCalendarAdapter {
  configured = true
  busy: FreeBusyWindow[] = []
  createdEvents: Array<{ summary: string }> = []
  isConfigured() {
    return this.configured
  }
  async freeBusy(): Promise<FreeBusyWindow[]> {
    return this.busy
  }
  async createEvent(_calendarId: string, input: { summary: string }): Promise<{ eventId: string }> {
    this.createdEvents.push(input)
    return { eventId: `event-${this.createdEvents.length}` }
  }
}

class FakeContactsAdapter implements GoogleContactsAdapter {
  configured = true
  results: ContactSummary[] = []
  isConfigured() {
    return this.configured
  }
  async searchContacts(): Promise<ContactSummary[]> {
    return this.results
  }
}

function deps(overrides: Partial<RelationshipDriverDeps> = {}): RelationshipDriverDeps {
  return {
    runStore: new InMemoryPlaybookRunStore(),
    execStore: new InMemoryExecutionStore(),
    executors: [],
    gmail: new FakeGmailAdapter(),
    calendar: new FakeCalendarAdapter(),
    contacts: new FakeContactsAdapter(),
    jerryCalendarId: 'jerry@checkoff.app',
    ...overrides,
  }
}

function dap(destinationId: string, destinationName: string, overrides: Partial<DAPArtifact['extracted']> = {}): DAPArtifact {
  return {
    provider: 'dap_claude_project',
    destinationId,
    destinationName,
    artifactRef: `dap-${destinationId}`,
    executedAt: '2026-09-08T00:00:00Z',
    contentHash: null,
    consumedDva2ArtifactRef: `dva2-${destinationId}`,
    extracted: {
      recommendedChampion: `${destinationName} Chamber`,
      secondaryChampions: [],
      decisionMakers: [],
      stakeholderOrganizations: [],
      fundingBudgetClues: ['Fiscal year starts July 1'],
      likelyBuyer: 'Chamber CEO',
      estimatedSalesDifficulty: 'MEDIUM',
      timingConsiderations: ['Peak season June-September'],
      politicalStakeholderComplexity: 'MEDIUM',
      objectionsHurdles: ['App fatigue'],
      destinationPainPoints: ['Visitors miss experiences beyond downtown'],
      checkoffValueProposition: `CheckOff surfaces the hidden layer of ${destinationName}.`,
      recommendedEntryStrategy: 'Warm intro to the Chamber CEO.',
      relationshipSequence: [],
      recommendedOfferDirection: 'Standard: $20,000/yr',
      rightNowTask: { currentStage: 'Relationship Building', currentGoal: 'g', highestPriorityTask: 't', targetDate: '2026-09-15', estimatedTime: '1h', expectedResult: 'r', whyItMatters: 'w' },
      ...overrides,
    },
  }
}

function dva1(destinationId: string, destinationName: string): DVA1Artifact {
  return { provider: 'dva1_claude_project', destinationId, destinationName, artifactRef: `dva1-${destinationId}`, executedAt: '2026-09-08T00:00:00Z', contentHash: null, score: 90, recommendationText: '🟢 Elite Candidate', currentStrategyFit: 'FITS_CURRENT_STRATEGY' }
}

function dva2(destinationId: string, destinationName: string): DVA2Artifact {
  return { provider: 'dva2_claude_project', destinationId, destinationName, artifactRef: `dva2-${destinationId}`, executedAt: '2026-09-08T00:00:00Z', contentHash: null, worthPursuing: 'YES', recommendedPriority: 'HIGH_PRIORITY_CREATE_DAP', recommendedNextStep: 'BUILD_DAP_NOW', rationale: 'Strong opportunity.', knownRisks: [], evidenceGaps: [], consumedDva1ArtifactRef: `dva1-${destinationId}` }
}

function scriptDraftOutreach(executor: TestExecutor, destinationId: string) {
  executor.scriptWhen(
    (r) => r.specialist === 'destination_relationship_manager' && r.destinationId === destinationId,
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { artifact: { draft: { subject: `Introducing CheckOff to ${destinationId}`, bodyText: 'Hi there — personalized outreach text.', channel: 'email' } } },
        methodologyId: 'destination_commercial',
        methodologyVersion: 'v1',
      })
  )
}

function options(destinationId: string, destinationName: string, overrides: Partial<DriveDestinationRelationshipOptions> = {}): DriveDestinationRelationshipOptions {
  return {
    destinationName,
    dap: dap(destinationId, destinationName),
    dva1: dva1(destinationId, destinationName),
    dva2: dva2(destinationId, destinationName),
    contact: { contactId: `contact-${destinationId}`, name: 'Jane Doe', email: `jane@${destinationId}.example.com`, role: 'Chamber CEO' },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Forward path
// ---------------------------------------------------------------------------

test('driveDestinationRelationship: DAP complete -> validates contact -> drafts first outreach -> creates an approval request, never sends on its own', async () => {
  const executor = new TestExecutor()
  scriptDraftOutreach(executor, 'destination-hood-river-or')
  const d = deps({ executors: [executor] })
  const run = await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))

  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'INITIAL_OUTREACH')
  assert.match(run.jerryReason ?? '', /sending requires Jerry/)
  assert.equal((d.gmail as any).sentMessages.length, 0, 'never sends without Jerry approval')
})

test('driveDestinationRelationship: without a validated contact email, escalates rather than drafting outreach to nobody', async () => {
  const executor = new TestExecutor()
  const d = deps({ executors: [executor] })
  const run = await driveDestinationRelationship(d, 'destination-no-contact', options('destination-no-contact', 'No Contact', { contact: { contactId: 'c1', name: 'Unknown', email: '', role: null } }))
  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'RELATIONSHIP_READY')
})

test('driveDestinationRelationship: after Jerry approves, the driver simulates the send (Gmail unconfigured in real production today) and moves to WAITING_FOR_REPLY', async () => {
  const executor = new TestExecutor()
  scriptDraftOutreach(executor, 'destination-hood-river-or')
  const gmail = new FakeGmailAdapter()
  gmail.configured = false // honest real-world state: no Google OAuth token configured
  const d = deps({ executors: [executor], gmail })
  const runId = playbookRunId('destination_relationship', 'destination-hood-river-or')
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))

  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  const run = await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))

  assert.equal(run.currentStage, 'WAITING_FOR_REPLY')
  assert.equal(run.status, 'RUNNING')
  assert.equal(gmail.sentMessages.length, 0, 'Gmail is unconfigured — never a real send')
  assert.equal((run.state as any).outreachSentSimulated, true)
})

test('driveDestinationRelationship: prior Gmail correspondence is detected BEFORE first outreach and never treated as a cold relationship', async () => {
  const executor = new TestExecutor()
  scriptDraftOutreach(executor, 'destination-hood-river-or')
  const gmail = new FakeGmailAdapter()
  gmail.searchResults = [{ id: 'm1', threadId: 't1', from: 'jane@destination-hood-river-or.example.com', to: [], subject: 'Old thread', snippet: '', receivedAt: null }]
  const d = deps({ executors: [executor], gmail })
  const run = await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))
  assert.equal((run.state as any).hasPriorCorrespondence, true)
})

// ---------------------------------------------------------------------------
// Scenario A — positive reply asking for more information -> one-pager
// ---------------------------------------------------------------------------

test('Scenario A: an information-request reply generates a Level-1 one-pager and moves to MATERIAL_REQUESTED', async () => {
  const executor = new TestExecutor()
  scriptDraftOutreach(executor, 'destination-hood-river-or')
  const gmail = new FakeGmailAdapter()
  const d = deps({ executors: [executor], gmail })
  const runId = playbookRunId('destination_relationship', 'destination-hood-river-or')
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))
  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))

  const result = await applyRelationshipResumeEvent(d, 'destination-hood-river-or', {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: 'destination-hood-river-or',
    contactId: 'contact-destination-hood-river-or',
    occurredAt: '2026-09-10T00:00:00Z',
    payload: {},
    email: { from: 'jane@destination-hood-river-or.example.com', to: [], threadId: 'thread-1', subject: 'Re: intro', bodyText: 'This looks great — can you send over a one-pager with more info?', receivedAt: '2026-09-10T00:00:00Z' },
  })

  assert.equal(result.rejected, false)
  if (!result.rejected) {
    assert.equal(result.run.currentStage, 'MATERIAL_REQUESTED')
    assert.ok((result.run.state as any).onePagerMarkdown)
    assert.match((result.run.state as any).onePagerMarkdown, /Hood River/)
  }
})

// ---------------------------------------------------------------------------
// Scenario B — recipient introduces another stakeholder -> contact graph
// ---------------------------------------------------------------------------

test('Scenario B: a referral reply updates the contact/relationship graph with the new stakeholder', async () => {
  const executor = new TestExecutor()
  scriptDraftOutreach(executor, 'destination-hood-river-or')
  const d = deps({ executors: [executor] })
  const runId = playbookRunId('destination_relationship', 'destination-hood-river-or')
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))
  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))

  const result = await applyRelationshipResumeEvent(d, 'destination-hood-river-or', {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: 'destination-hood-river-or',
    contactId: 'contact-destination-hood-river-or',
    occurredAt: '2026-09-10T00:00:00Z',
    payload: {},
    email: { from: 'jane@destination-hood-river-or.example.com', to: [], threadId: 'thread-1', subject: 'Re: intro', bodyText: 'Looping in our marketing director, you should talk to her too.', receivedAt: '2026-09-10T00:00:00Z' },
    introducedContact: { contactId: 'contact-marketing-director', name: 'Marketing Director', email: 'md@destination-hood-river-or.example.com', role: 'Marketing Director' },
  })

  assert.equal(result.rejected, false)
  if (!result.rejected) {
    const contacts = (result.run.state as any).contacts as Array<{ contactId: string; introducedBy: string | null }>
    assert.ok(contacts.some((c) => c.contactId === 'contact-marketing-director' && c.introducedBy === 'contact-destination-hood-river-or'))
  }
})

test('an introduced stakeholder can be correctly associated on THEIR OWN later reply, not just the original contact', async () => {
  const executor = new TestExecutor()
  scriptDraftOutreach(executor, 'destination-hood-river-or')
  const d = deps({ executors: [executor] })
  const runId = playbookRunId('destination_relationship', 'destination-hood-river-or')
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))
  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))

  await applyRelationshipResumeEvent(d, 'destination-hood-river-or', {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: 'destination-hood-river-or',
    contactId: 'contact-destination-hood-river-or',
    occurredAt: '2026-09-10T00:00:00Z',
    payload: {},
    email: { from: 'jane@destination-hood-river-or.example.com', to: [], threadId: 'thread-1', subject: 'Re: intro', bodyText: 'Looping in our marketing director, you should talk to her too.', receivedAt: '2026-09-10T00:00:00Z' },
    introducedContact: { contactId: 'contact-marketing-director', name: 'Marketing Director', email: 'md@destination-hood-river-or.example.com', role: 'Marketing Director' },
  })

  // The introduced person now emails in on her own, from a fresh thread.
  const result = await applyRelationshipResumeEvent(d, 'destination-hood-river-or', {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: 'destination-hood-river-or',
    contactId: 'contact-marketing-director',
    occurredAt: '2026-09-11T00:00:00Z',
    payload: {},
    email: { from: 'md@destination-hood-river-or.example.com', to: [], threadId: 'thread-2-new', subject: 'Following up', bodyText: 'This looks great — can you send over a one-pager?', receivedAt: '2026-09-11T00:00:00Z' },
  })

  assert.equal(result.rejected, false, 'the introduced stakeholder must be resolvable by her own email even on a brand-new thread')
})

// ---------------------------------------------------------------------------
// Scenario C — "let's talk next week" -> calendar availability -> NEEDS_JERRY
// ---------------------------------------------------------------------------

test('Scenario C: meeting-interest reply checks calendar availability, proposes windows, and escalates to Jerry with a cheat sheet', async () => {
  const executor = new TestExecutor()
  scriptDraftOutreach(executor, 'destination-hood-river-or')
  const calendar = new FakeCalendarAdapter()
  const d = deps({ executors: [executor], calendar })
  const runId = playbookRunId('destination_relationship', 'destination-hood-river-or')
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))
  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))

  const result = await applyRelationshipResumeEvent(d, 'destination-hood-river-or', {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: 'destination-hood-river-or',
    contactId: 'contact-destination-hood-river-or',
    occurredAt: '2026-09-10T00:00:00Z',
    payload: {},
    email: { from: 'jane@destination-hood-river-or.example.com', to: [], threadId: 'thread-1', subject: 'Re: intro', bodyText: "I'd love to talk next week if you're free.", receivedAt: '2026-09-10T00:00:00Z' },
  })

  assert.equal(result.rejected, false)
  if (!result.rejected) {
    assert.equal(result.run.status, 'NEEDS_JERRY')
    const packet = result.run.decisionPacket as { proposedWindows: unknown[]; cheatSheet: string }
    assert.ok(packet.proposedWindows.length > 0, 'must propose 2-3 viable meeting windows')
    assert.ok(packet.cheatSheet.length > 0)
    assert.match(packet.cheatSheet, /Hood River/)
  }
})

// ---------------------------------------------------------------------------
// Meeting scheduled -> prep packet; meeting complete -> follow-up tasks
// ---------------------------------------------------------------------------

test('MEETING_SCHEDULED resume event generates a full meeting-prep packet', async () => {
  const executor = new TestExecutor()
  scriptDraftOutreach(executor, 'destination-hood-river-or')
  const d = deps({ executors: [executor] })
  const runId = playbookRunId('destination_relationship', 'destination-hood-river-or')
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))
  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))
  // Real flow: a reply must express meeting interest (-> MEETING_REQUESTED) before a meeting can be scheduled.
  await applyRelationshipResumeEvent(d, 'destination-hood-river-or', {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: 'destination-hood-river-or',
    contactId: 'contact-destination-hood-river-or',
    occurredAt: '2026-09-09T00:00:00Z',
    payload: {},
    email: { from: 'jane@destination-hood-river-or.example.com', to: [], threadId: 'thread-1', subject: 'Re: intro', bodyText: "Let's talk next week.", receivedAt: '2026-09-09T00:00:00Z' },
  })
  await recordJerryDecision(d.runStore, runId, { meetingWindowChosen: '2026-09-10T17:00:00Z' })

  const result = await applyRelationshipResumeEvent(d, 'destination-hood-river-or', {
    kind: 'MEETING_SCHEDULED',
    destinationId: 'destination-hood-river-or',
    contactId: 'contact-destination-hood-river-or',
    occurredAt: '2026-09-12T00:00:00Z',
    payload: {},
    meetingSummary: 'Discovery call with the Chamber CEO.',
  })

  assert.equal(result.rejected, false)
  if (!result.rejected) {
    assert.equal(result.run.currentStage, 'MEETING_PREP')
    const packet = (result.run.state as any).meetingPrepPacket as string
    assert.match(packet, /Meeting Prep — Hood River, OR/)
  }
})

test('MEETING_COMPLETE resume event derives real follow-up tasks and recommends only explicitly-tagged durable lessons for Open Brain', async () => {
  const executor = new TestExecutor()
  scriptDraftOutreach(executor, 'destination-hood-river-or')
  const d = deps({ executors: [executor] })
  const runId = playbookRunId('destination_relationship', 'destination-hood-river-or')
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))
  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))
  await applyRelationshipResumeEvent(d, 'destination-hood-river-or', {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: 'destination-hood-river-or',
    contactId: 'contact-destination-hood-river-or',
    occurredAt: '2026-09-09T00:00:00Z',
    payload: {},
    email: { from: 'jane@destination-hood-river-or.example.com', to: [], threadId: 'thread-1', subject: 'Re: intro', bodyText: "Let's talk next week.", receivedAt: '2026-09-09T00:00:00Z' },
  })
  await recordJerryDecision(d.runStore, runId, { meetingWindowChosen: '2026-09-10T17:00:00Z' })
  await applyRelationshipResumeEvent(d, 'destination-hood-river-or', { kind: 'MEETING_SCHEDULED', destinationId: 'destination-hood-river-or', contactId: 'c', occurredAt: '2026-09-12T00:00:00Z', payload: {}, meetingSummary: 'Discovery call.' })

  const result = await applyRelationshipResumeEvent(d, 'destination-hood-river-or', {
    kind: 'MEETING_COMPLETE',
    destinationId: 'destination-hood-river-or',
    contactId: 'c',
    occurredAt: '2026-09-13T00:00:00Z',
    payload: {},
    outcome: { destinationId: 'destination-hood-river-or', contactsInvolved: ['Jane Doe'], keyStatements: [], decisions: [], promisesMade: ['Send a proposal by Friday'], materialsRequested: ['Pitch deck'], nextSteps: ['Draft proposal'], durableLessons: ['Lead with the Fruit Loop story.'] },
  })

  assert.equal(result.rejected, false)
  if (!result.rejected) {
    assert.equal(result.run.currentStage, 'FOLLOW_UP')
    const tasks = (result.run.state as any).meetingFollowUpTasks
    assert.ok(tasks.some((t: any) => t.description.includes('Send a proposal by Friday')))
    assert.deepEqual((result.run.state as any).recommendedForOpenBrain, ['Lead with the Fruit Loop story.'])
  }
})

// ---------------------------------------------------------------------------
// Association isolation, pricing escalation, no-interest parking
// ---------------------------------------------------------------------------

test('A reply that cannot be associated to ANY known contact is rejected outright — never guessed', async () => {
  const executor = new TestExecutor()
  scriptDraftOutreach(executor, 'destination-hood-river-or')
  const d = deps({ executors: [executor] })
  const runId = playbookRunId('destination_relationship', 'destination-hood-river-or')
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))
  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))

  const result = await applyRelationshipResumeEvent(d, 'destination-hood-river-or', {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: 'destination-hood-river-or',
    contactId: 'contact-destination-hood-river-or',
    occurredAt: '2026-09-10T00:00:00Z',
    payload: {},
    email: { from: 'stranger@nowhere.example.com', to: [], threadId: null, subject: 'Huh?', bodyText: 'Who is this?', receivedAt: '2026-09-10T00:00:00Z' },
  })

  assert.equal(result.rejected, true)
})

test('a pricing/budget reply is escalated to Jerry — Chief never discusses pricing unilaterally', async () => {
  const executor = new TestExecutor()
  scriptDraftOutreach(executor, 'destination-hood-river-or')
  const d = deps({ executors: [executor] })
  const runId = playbookRunId('destination_relationship', 'destination-hood-river-or')
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))
  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))

  const result = await applyRelationshipResumeEvent(d, 'destination-hood-river-or', {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: 'destination-hood-river-or',
    contactId: 'contact-destination-hood-river-or',
    occurredAt: '2026-09-10T00:00:00Z',
    payload: {},
    email: { from: 'jane@destination-hood-river-or.example.com', to: [], threadId: 'thread-1', subject: 'Re: intro', bodyText: 'How much does this cost?', receivedAt: '2026-09-10T00:00:00Z' },
  })

  assert.equal(result.rejected, false)
  if (!result.rejected) assert.equal(result.run.status, 'NEEDS_JERRY')
})

test('a decline reply parks the relationship with history preserved, never loops', async () => {
  const executor = new TestExecutor()
  scriptDraftOutreach(executor, 'destination-hood-river-or')
  const d = deps({ executors: [executor] })
  const runId = playbookRunId('destination_relationship', 'destination-hood-river-or')
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))
  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  await driveDestinationRelationship(d, 'destination-hood-river-or', options('destination-hood-river-or', 'Hood River, OR'))

  const result = await applyRelationshipResumeEvent(d, 'destination-hood-river-or', {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: 'destination-hood-river-or',
    contactId: 'contact-destination-hood-river-or',
    occurredAt: '2026-09-10T00:00:00Z',
    payload: {},
    email: { from: 'jane@destination-hood-river-or.example.com', to: [], threadId: 'thread-1', subject: 'Re: intro', bodyText: "Thanks, but we're not interested at this time.", receivedAt: '2026-09-10T00:00:00Z' },
  })

  assert.equal(result.rejected, false)
  if (!result.rejected) {
    assert.equal(result.run.status, 'WAITING')
    assert.equal((result.run.state as any).followUp.parked, true)
    assert.ok((result.run.state as any).relationshipHistory.length > 0, 'history is preserved, not discarded')
  }
})

// ---------------------------------------------------------------------------
// 20 concurrent relationships stay fully isolated
// ---------------------------------------------------------------------------

test('20 concurrent destination relationships stay fully isolated — drafts, contacts, and stages never cross runs', async () => {
  const executor = new TestExecutor()
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const gmail = new FakeGmailAdapter()
  const calendar = new FakeCalendarAdapter()
  const contactsAdapter = new FakeContactsAdapter()
  const d: RelationshipDriverDeps = { runStore, execStore, executors: [executor], gmail, calendar, contacts: contactsAdapter, jerryCalendarId: 'jerry@checkoff.app' }

  const destinationIds = Array.from({ length: 20 }, (_, i) => `destination-${i.toString().padStart(2, '0')}`)
  for (const id of destinationIds) scriptDraftOutreach(executor, id)

  await Promise.all(destinationIds.map((id) => driveDestinationRelationship(d, id, options(id, `Destination ${id}`))))

  const runs = await Promise.all(destinationIds.map((id) => runStore.get(playbookRunId('destination_relationship', id))))
  assert.equal(runs.length, 20)
  for (let i = 0; i < 20; i++) {
    const run = runs[i]!
    assert.equal(run.projectId, destinationIds[i])
    const state = run.state as any
    assert.equal(state.dap.destinationId, destinationIds[i])
    assert.match(state.draftedOutreach.subject, new RegExp(destinationIds[i]))
  }
  // Global uniqueness — any cross-contamination would collapse this below 20.
  assert.equal(new Set(runs.map((r) => r!.state && (r!.state as any).dap.destinationId)).size, 20)
})
