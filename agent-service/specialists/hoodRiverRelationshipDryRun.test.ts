// Chief Phase 2I — the required Hood River hypothetical dry run (spec
// section 14). Uses the REAL Hood River DVA-1/DVA-2/DAP artifact content
// produced by the actual live proofs earlier in Phase 2H/2H-integrity
// (score 92, FITS_CURRENT_STRATEGY, DVA-2 BUILD_DAP_NOW, DAP naming the
// Hood River County Chamber of Commerce as champion) — never fabricated
// destination data. NO real Gmail/Calendar/Contacts adapter is used here
// (FakeGmailAdapter/FakeCalendarAdapter never make HTTP calls, and this
// environment has no Google OAuth token configured anyway, so a real
// adapter would refuse to act even if one were used) and NO real AI
// provider call is made (TestExecutor). This file's entire purpose is to
// prove the ORCHESTRATION end-to-end without contacting anyone or
// spending anything real.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveDestinationRelationship, applyRelationshipResumeEvent, type RelationshipDriverDeps } from './destinationRelationshipDriver'
import { InMemoryPlaybookRunStore, playbookRunId, recordJerryDecision } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import type { GmailAdapter, GmailMessageSummary, GmailSendAsIdentity, GmailSendInput, GoogleCalendarAdapter, FreeBusyWindow, GoogleContactsAdapter, ContactSummary } from './googleAdapters'
import type { DAPArtifact, DVA1Artifact, DVA2Artifact } from '../playbooks/destinationHubLifecycle'

class FakeGmailAdapter implements GmailAdapter {
  searchResults: GmailMessageSummary[] = []
  sentMessages: GmailSendInput[] = []
  drafts: GmailSendInput[] = []
  sendAsIdentities: GmailSendAsIdentity[] = [{ sendAsEmail: 'jerry@getcheckoff.com', displayName: 'Jerry', isDefault: true, isPrimary: false, verificationStatus: 'accepted' }]
  isConfigured() {
    return true
  }
  async searchMessages(): Promise<GmailMessageSummary[]> {
    return this.searchResults
  }
  async listSendAsIdentities(): Promise<GmailSendAsIdentity[]> {
    return this.sendAsIdentities
  }
  async createDraft(input: GmailSendInput) {
    this.drafts.push(input)
    return { draftId: `draft-${this.drafts.length}`, messageId: `draft-msg-${this.drafts.length}`, threadId: input.threadId ?? `thread-${this.drafts.length}` }
  }
  async sendMessage(input: GmailSendInput) {
    this.sentMessages.push(input)
    return { messageId: `msg-${this.sentMessages.length}`, threadId: input.threadId ?? `thread-${this.sentMessages.length}` }
  }
}

class FakeCalendarAdapter implements GoogleCalendarAdapter {
  busy: FreeBusyWindow[] = []
  createdEvents: Array<{ summary: string }> = []
  isConfigured() {
    return true
  }
  async freeBusy(): Promise<FreeBusyWindow[]> {
    return this.busy
  }
  async createEvent(_calendarId: string, input: { summary: string }) {
    this.createdEvents.push(input)
    return { eventId: `event-${this.createdEvents.length}` }
  }
}

class FakeContactsAdapter implements GoogleContactsAdapter {
  isConfigured() {
    return true
  }
  async searchContacts(): Promise<ContactSummary[]> {
    return [{ resourceName: 'people/c1', displayName: 'Katie Kadlub', emails: ['katie.kadlub@hoodriver.org'], organization: 'Hood River County Chamber of Commerce' }]
  }
}

// Real content from the Phase 2H live-provider Hood River proofs
// (destination_hub_lifecycle:hood-river-or-2h-dva2dap-proof-v4).
const REAL_HOOD_RIVER_DVA1: DVA1Artifact = {
  provider: 'dva1_claude_project',
  destinationId: 'destination-hood-river-or',
  destinationName: 'Hood River, OR',
  artifactRef: 'dva1-destination-hood-river-or-2026-09-04',
  executedAt: '2026-09-04T22:28:51.994Z',
  contentHash: null,
  score: 92,
  recommendationText: '🟢 Elite Candidate — Highly recommend Jerry consider DVA-2',
  currentStrategyFit: 'FITS_CURRENT_STRATEGY',
}

const REAL_HOOD_RIVER_DVA2: DVA2Artifact = {
  provider: 'dva2_claude_project',
  destinationId: 'destination-hood-river-or',
  destinationName: 'Hood River, OR',
  artifactRef: 'dva2-destination-hood-river-or-2026-09-08',
  executedAt: '2026-09-04T22:29:46.876Z',
  contentHash: null,
  worthPursuing: 'YES',
  recommendedPriority: 'HIGH_PRIORITY_CREATE_DAP',
  recommendedNextStep: 'BUILD_DAP_NOW',
  rationale: 'Hood River has a strong, seasonally rich visitor economy, a highly engaged DMO/Chamber, and clear market fit in CheckOff’s network.',
  knownRisks: ['Budget cycles for Champion and key Partners may delay commitment.'],
  evidenceGaps: [],
  consumedDva1ArtifactRef: 'dva1-destination-hood-river-or-2026-09-04',
}

const REAL_HOOD_RIVER_DAP: DAPArtifact = {
  provider: 'dap_claude_project',
  destinationId: 'destination-hood-river-or',
  destinationName: 'Hood River, OR',
  artifactRef: 'dap-destination-hood-river-or-2026-09-08-v2-001',
  executedAt: '2026-09-04T22:30:34.462Z',
  contentHash: null,
  consumedDva2ArtifactRef: 'dva2-destination-hood-river-or-2026-09-08',
  extracted: {
    recommendedChampion: 'Hood River Chamber of Commerce',
    secondaryChampions: ['City of Hood River'],
    decisionMakers: ['Hood River Chamber of Commerce', 'City of Hood River'],
    stakeholderOrganizations: ['Hood River Chamber of Commerce', 'City of Hood River', 'Downtown Business Association', 'Visit Hood River'],
    fundingBudgetClues: ['Standard Champion Price from DVA-2: $27,000/year', 'Fiscal budgeting cycle: July 1 - June 30'],
    likelyBuyer: 'Chamber Executive Director or Tourism Director',
    estimatedSalesDifficulty: 'MEDIUM',
    timingConsiderations: ['Peak season for tourism is June-September (summer)', 'Chamber board meets monthly'],
    politicalStakeholderComplexity: 'MEDIUM',
    objectionsHurdles: ['Budget timing (may already be allocated)', 'Desire for proven ROI/examples'],
    destinationPainPoints: ['Complex mix of repeat and first-time visitors', 'Under-leveraged downtown experiences'],
    checkoffValueProposition: "Organizes and activates all of Hood River's best experiences into a single, actionable digital hub for visitors.",
    recommendedEntryStrategy: 'Chamber-led outreach, leveraging local business champions and focused on Chamber/town pain points and event timing.',
    relationshipSequence: [],
    recommendedOfferDirection: 'Standard Champion price and DVA-2 co-op structure',
    rightNowTask: {
      currentStage: 'Relationship Building',
      currentGoal: 'Secure a warm introduction to Hood River Chamber leadership to schedule a discovery conversation',
      highestPriorityTask: 'Identify and engage a mutual contact or business champion to facilitate an introduction to the Hood River Chamber Executive Director.',
      targetDate: '2026-09-15',
      estimatedTime: '1 hour',
      expectedResult: 'A warm, personalized intro request is sent to the key decision maker(s).',
      whyItMatters: 'A personal, low-pressure warm intro dramatically increases the likelihood of a receptive first meeting.',
    },
  },
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

const DESTINATION_ID = 'destination-hood-river-or'
const HOOD_RIVER_CONTACT = { contactId: 'contact-hood-river-chamber-ceo', name: 'Katie Kadlub', email: 'katie.kadlub@hoodriver.org', role: 'Chamber Executive Director' }

function scriptOutreachDraft(executor: TestExecutor) {
  executor.scriptWhen(
    (r) => r.specialist === 'destination_relationship_manager' && r.destinationId === DESTINATION_ID,
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          artifact: {
            draft: {
              subject: 'A quick idea for Hood River visitors',
              bodyText:
                "Hi Katie — I've been looking at how visitors experience Hood River beyond the riverfront, and think there's a real opportunity to help your downtown and valley businesses get discovered by the Fruit Loop and outdoor crowd. Would love to share a quick idea when you have a few minutes.",
              channel: 'email',
            },
          },
        },
        methodologyId: 'destination_commercial',
        methodologyVersion: 'v1',
      })
  )
}

test('Hood River dry run: DAP complete -> RELATIONSHIP_READY -> validates the real Chamber contact -> determines LEVEL_0 asset -> drafts first outreach -> creates an approval request (no send)', async () => {
  const executor = new TestExecutor()
  scriptOutreachDraft(executor)
  const gmail = new FakeGmailAdapter()
  const calendar = new FakeCalendarAdapter()
  const d = deps({ executors: [executor], gmail, calendar })

  const run = await driveDestinationRelationship(d, DESTINATION_ID, {
    destinationName: 'Hood River, OR',
    dap: REAL_HOOD_RIVER_DAP,
    dva1: REAL_HOOD_RIVER_DVA1,
    dva2: REAL_HOOD_RIVER_DVA2,
    contact: HOOD_RIVER_CONTACT,
  })

  assert.equal(run.status, 'NEEDS_JERRY', 'sending requires Jerry — the driver must stop here, not send')
  assert.equal(run.currentStage, 'INITIAL_OUTREACH')
  const state = run.state as any
  assert.equal(state.primaryContact.email, HOOD_RIVER_CONTACT.email)
  assert.equal(state.draftedOutreach.channel, 'email')
  assert.match(state.draftedOutreach.subject, /Hood River/)
  assert.equal((run.decisionPacket as any).to, HOOD_RIVER_CONTACT.email)

  // NO real send, NO real calendar event — this is a dry run.
  assert.equal(gmail.sentMessages.length, 0)
  assert.equal(calendar.createdEvents.length, 0)
})

test('Hood River dry run — Scenario A: a positive reply asking for more information requests/generates a one-pager, still no real send', async () => {
  const executor = new TestExecutor()
  scriptOutreachDraft(executor)
  const gmail = new FakeGmailAdapter()
  const d = deps({ executors: [executor], gmail })
  const runId = playbookRunId('destination_relationship', DESTINATION_ID)

  await driveDestinationRelationship(d, DESTINATION_ID, { destinationName: 'Hood River, OR', dap: REAL_HOOD_RIVER_DAP, dva1: REAL_HOOD_RIVER_DVA1, dva2: REAL_HOOD_RIVER_DVA2, contact: HOOD_RIVER_CONTACT })
  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  await driveDestinationRelationship(d, DESTINATION_ID, { destinationName: 'Hood River, OR', dap: REAL_HOOD_RIVER_DAP, dva1: REAL_HOOD_RIVER_DVA1, dva2: REAL_HOOD_RIVER_DVA2, contact: HOOD_RIVER_CONTACT })

  const result = await applyRelationshipResumeEvent(d, DESTINATION_ID, {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: DESTINATION_ID,
    contactId: HOOD_RIVER_CONTACT.contactId,
    occurredAt: '2026-09-10T00:00:00Z',
    payload: {},
    email: { from: 'katie.kadlub@hoodriver.org', to: [], threadId: 'thread-hr-1', subject: 'Re: A quick idea for Hood River visitors', bodyText: 'This sounds really interesting — could you send over a one-pager with more details?', receivedAt: '2026-09-10T00:00:00Z' },
  })

  assert.equal(result.rejected, false)
  if (!result.rejected) {
    assert.equal(result.run.currentStage, 'MATERIAL_REQUESTED')
    const onePager = (result.run.state as any).onePagerMarkdown as string
    assert.match(onePager, /Hood River/)
    assert.match(onePager, /downtown/i) // real DAP pain point content, not generic boilerplate
    assert.doesNotMatch(onePager, /\$27,000/, 'no unapproved pricing in the one-pager')
  }
  // Jerry DID approve the first outreach in this scenario, so the (fake,
  // in-memory, never-real-network) adapter recorded exactly that one
  // send, to exactly the approved Hood River contact — never a real
  // network call, and never to anyone Jerry didn't approve.
  assert.equal(gmail.sentMessages.length, 1)
  assert.equal(gmail.sentMessages[0].to, HOOD_RIVER_CONTACT.email)
})

test('Hood River dry run — Scenario B: recipient introduces another stakeholder -> contact/relationship graph is updated', async () => {
  const executor = new TestExecutor()
  scriptOutreachDraft(executor)
  const d = deps({ executors: [executor] })
  const runId = playbookRunId('destination_relationship', DESTINATION_ID)

  await driveDestinationRelationship(d, DESTINATION_ID, { destinationName: 'Hood River, OR', dap: REAL_HOOD_RIVER_DAP, dva1: REAL_HOOD_RIVER_DVA1, dva2: REAL_HOOD_RIVER_DVA2, contact: HOOD_RIVER_CONTACT })
  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  await driveDestinationRelationship(d, DESTINATION_ID, { destinationName: 'Hood River, OR', dap: REAL_HOOD_RIVER_DAP, dva1: REAL_HOOD_RIVER_DVA1, dva2: REAL_HOOD_RIVER_DVA2, contact: HOOD_RIVER_CONTACT })

  const result = await applyRelationshipResumeEvent(d, DESTINATION_ID, {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: DESTINATION_ID,
    contactId: HOOD_RIVER_CONTACT.contactId,
    occurredAt: '2026-09-10T00:00:00Z',
    payload: {},
    email: { from: 'katie.kadlub@hoodriver.org', to: [], threadId: 'thread-hr-1', subject: 'Re: A quick idea for Hood River visitors', bodyText: 'Great timing — looping in our Downtown Business Association director, you should talk to her about this too.', receivedAt: '2026-09-10T00:00:00Z' },
    introducedContact: { contactId: 'contact-downtown-biz-director', name: 'Downtown Business Association Director', email: 'director@hoodriverdowntown.org', role: 'Downtown Business Association Director' },
  })

  assert.equal(result.rejected, false)
  if (!result.rejected) {
    const contacts = (result.run.state as any).contacts as Array<{ contactId: string; introducedBy: string | null; destinationId: string }>
    const introduced = contacts.find((c) => c.contactId === 'contact-downtown-biz-director')
    assert.ok(introduced)
    assert.equal(introduced!.introducedBy, HOOD_RIVER_CONTACT.contactId)
    assert.equal(introduced!.destinationId, DESTINATION_ID, 'the new stakeholder is scoped to Hood River, never leaked to another destination')
  }
})

test('Hood River dry run — Scenario C: "let\'s talk next week" checks Jerry\'s calendar, proposes windows, escalates NEEDS_JERRY, and generates a meeting-interest cheat sheet — no real calendar event created', async () => {
  const executor = new TestExecutor()
  scriptOutreachDraft(executor)
  const calendar = new FakeCalendarAdapter()
  calendar.busy = [{ startIso: '2026-09-10T17:00:00.000Z', endIso: '2026-09-10T17:30:00.000Z' }]
  const d = deps({ executors: [executor], calendar })
  const runId = playbookRunId('destination_relationship', DESTINATION_ID)

  await driveDestinationRelationship(d, DESTINATION_ID, { destinationName: 'Hood River, OR', dap: REAL_HOOD_RIVER_DAP, dva1: REAL_HOOD_RIVER_DVA1, dva2: REAL_HOOD_RIVER_DVA2, contact: HOOD_RIVER_CONTACT })
  await recordJerryDecision(d.runStore, runId, { outreachApproved: true })
  await driveDestinationRelationship(d, DESTINATION_ID, { destinationName: 'Hood River, OR', dap: REAL_HOOD_RIVER_DAP, dva1: REAL_HOOD_RIVER_DVA1, dva2: REAL_HOOD_RIVER_DVA2, contact: HOOD_RIVER_CONTACT })

  const result = await applyRelationshipResumeEvent(d, DESTINATION_ID, {
    kind: 'GMAIL_REPLY_RECEIVED',
    destinationId: DESTINATION_ID,
    contactId: HOOD_RIVER_CONTACT.contactId,
    occurredAt: '2026-09-10T00:00:00Z',
    payload: {},
    email: { from: 'katie.kadlub@hoodriver.org', to: [], threadId: 'thread-hr-1', subject: 'Re: A quick idea for Hood River visitors', bodyText: "I'd love to talk next week if you have 20 minutes.", receivedAt: '2026-09-10T00:00:00Z' },
  })

  assert.equal(result.rejected, false)
  if (!result.rejected) {
    assert.equal(result.run.status, 'NEEDS_JERRY')
    const packet = result.run.decisionPacket as { proposedWindows: unknown[]; cheatSheet: string }
    assert.ok(packet.proposedWindows.length >= 2 && packet.proposedWindows.length <= 3, `expected 2-3 proposed windows, got ${packet.proposedWindows.length}`)
    assert.match(packet.cheatSheet, /Hood River/)
    assert.match(packet.cheatSheet, /Katie Kadlub/)
  }
  assert.equal(calendar.createdEvents.length, 0, 'Chief never autonomously books a real Hood River meeting')
})
