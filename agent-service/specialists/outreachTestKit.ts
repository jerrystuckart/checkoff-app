// Test-only fakes for the campaign engine: an in-memory "world" that plays the
// database (BizDevStore + CampaignWriter + IntakeLookups) and a fake Gmail. No
// network, no database, and nothing here can send a real email.

import type { GmailAdapter, GmailFullMessage, GmailMessageSummary, GmailSendInput, GmailSendAsIdentity, GmailAttachmentInfo } from './googleAdapters'
import type { BizDevSequenceView, BizDevState, BizDevStore, TransitionDetail, TransitionTarget } from './bizDevOutreach'
import type { CampaignRuntime } from './bizDevCampaign'
import type { CampaignWriter, ContactInfo, IntakeLookups, ItemInfo } from './outreachCampaign'

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// ---------------------------------------------------------------------------
// Fake Gmail
// ---------------------------------------------------------------------------

interface Stored {
  full: GmailFullMessage
  labels: Set<string>
}

export class FakeGmail implements GmailAdapter {
  configured = true
  sendAsOk = true
  sends: GmailSendInput[] = []
  /** Extra "already sent in the last 24h" (manual replies, other activity) that Winston did not send itself. */
  otherSent24h = 0
  failNext: Array<Error | null> = []
  failAll: Error | null = null
  idCalls: string[] = []
  searchCalls: string[] = []
  fullCalls = 0
  private msgs = new Map<string, Stored>()
  private seq = 0
  private sentLog: Array<{ id: string; threadId: string; to: string }> = []

  isConfigured() { return this.configured }
  async listSendAsIdentities(): Promise<GmailSendAsIdentity[]> {
    return [{ sendAsEmail: 'jerry@getcheckoff.com', displayName: 'Jerry Stuckart', isDefault: false, isPrimary: false, verificationStatus: this.sendAsOk ? 'accepted' : 'pending' }]
  }
  async createDraft(): Promise<never> { throw new Error('drafts are never used') }

  async sendMessage(input: GmailSendInput) {
    const scripted = this.failNext.length ? this.failNext.shift()! : null
    if (this.failAll) throw this.failAll
    if (scripted) throw scripted
    this.sends.push(input)
    const id = `sent${++this.seq}`
    const threadId = input.threadId ?? `T-${id}`
    this.sentLog.push({ id, threadId, to: input.to })
    this.msgs.set(id, { labels: new Set(['SENT']), full: { id, threadId, from: input.from, to: [input.to], cc: [], replyTo: null, subject: input.subject, bodyText: input.bodyText, receivedAt: new Date().toISOString(), messageIdHeader: `<hdr-${id}@mail>` } })
    return { messageId: id, threadId }
  }

  /** A sent message the engine does NOT know about (simulates an uncertain send that actually went out). */
  addGhostSent(to: string, subject: string): { id: string; threadId: string } {
    const id = `ghost${++this.seq}`
    const threadId = `T-${id}`
    this.sentLog.push({ id, threadId, to })
    this.msgs.set(id, { labels: new Set(['SENT']), full: { id, threadId, from: 'jerry@getcheckoff.com', to: [to], cc: [], replyTo: null, subject, bodyText: '', receivedAt: new Date().toISOString(), messageIdHeader: `<hdr-${id}@mail>` } })
    return { id, threadId }
  }

  /** An inbound reply. `viaRelay` mimics the Resend forwarder (From=forwarder, Reply-To=the real sender). */
  addReply(opts: { from: string; subject: string; body: string; threadId?: string; viaRelay?: boolean; attachments?: GmailAttachmentInfo[]; id?: string }): string {
    const id = opts.id ?? `in${++this.seq}`
    this.msgs.set(id, {
      labels: new Set(['INBOX']),
      full: { id, threadId: opts.threadId ?? `T-${id}`, from: opts.viaRelay ? 'CheckOff <forwarder@getcheckoff.com>' : opts.from, to: ['jerry@getcheckoff.com'], cc: [], replyTo: opts.viaRelay ? opts.from : null, subject: opts.subject, bodyText: opts.body, receivedAt: new Date().toISOString(), messageIdHeader: `<hdr-${id}@x>`, attachments: opts.attachments },
    })
    return id
  }

  addBounce(threadId: string, body: string): string {
    return this.addReply({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)', body, threadId })
  }

  private list(q: string): Array<{ id: string; threadId: string }> {
    if (q.startsWith('in:sent from:')) {
      const base = this.sentLog.map((s) => ({ id: s.id, threadId: s.threadId }))
      const filler = Array.from({ length: this.otherSent24h }, (_, i) => ({ id: `other${i}`, threadId: `T-other${i}` }))
      return [...base, ...filler]
    }
    const all = [...this.msgs.values()].filter((m) => m.labels.has('INBOX')).map((m) => m.full)
    if (q.includes('mailer-daemon')) return all.filter((m) => /mailer-daemon|postmaster/i.test(m.from)).map((m) => ({ id: m.id, threadId: m.threadId }))
    const stem = q.match(/subject:"([^"]+)"/)?.[1]
    if (stem) return all.filter((m) => m.subject.toLowerCase().includes(stem.toLowerCase())).map((m) => ({ id: m.id, threadId: m.threadId }))
    return all.map((m) => ({ id: m.id, threadId: m.threadId }))
  }

  async searchMessageIds(q: string): Promise<Array<{ id: string; threadId: string }>> {
    this.idCalls.push(q)
    return this.list(q)
  }

  async searchMessages(q: string): Promise<GmailMessageSummary[]> {
    this.searchCalls.push(q)
    const m = q.match(/^in:sent to:(\S+)/)
    if (m) {
      return this.sentLog.filter((s) => s.to === m[1]).map((s) => {
        const f = this.msgs.get(s.id)!.full
        return { id: s.id, threadId: s.threadId, from: f.from, to: f.to, subject: f.subject, snippet: '', receivedAt: f.receivedAt, replyTo: null }
      })
    }
    return this.list(q).map((x) => {
      const f = this.msgs.get(x.id)!.full
      return { id: f.id, threadId: f.threadId, from: f.from, to: f.to, subject: f.subject, snippet: '', receivedAt: f.receivedAt, replyTo: f.replyTo }
    })
  }

  async getFullMessage(id: string): Promise<GmailFullMessage> {
    this.fullCalls++
    const s = this.msgs.get(id)
    if (!s) throw new Error(`FakeGmail: no message ${id}`)
    return s.full
  }
}

// ---------------------------------------------------------------------------
// In-memory "database"
// ---------------------------------------------------------------------------

export interface MemRecipient {
  taskId: string
  contactId: string
  email: string
  status: string
  state: BizDevState
  nextCheckAt: Date | null
  nextAction: string | null
  jerryRequest: string | null
  cancelReason: string | null
  blockerNote: string | null
}

export class MemWorld implements BizDevStore, CampaignWriter, IntakeLookups {
  recipients = new Map<string, MemRecipient>()
  contacts = new Map<string, { id: string; email: string; org: string; name: string | null; suppressed: boolean; hasOutbound: boolean }>()
  runtimes = new Map<string, CampaignRuntime>()
  campaignStatus = new Map<string, { status: string; jerryRequest?: string }>()
  interactions: Array<{ taskId: string; direction: string; messageId: string; replyClass?: string; summary: string }> = []
  tokens = new Set<string>()
  itemRows = new Map<string, ItemInfo>()
  projects: string[] = []
  progress: string[] = []
  private n = 0

  // ---- IntakeLookups ----
  async items(ids: string[]): Promise<Map<string, ItemInfo>> { return new Map(ids.filter((i) => this.itemRows.has(i)).map((i) => [i, this.itemRows.get(i)!])) }
  async contactsByEmail(emails: string[]): Promise<Map<string, ContactInfo>> {
    const m = new Map<string, ContactInfo>()
    for (const e of emails) { const c = this.contacts.get(e); if (c) m.set(e, { id: c.id, suppressed: c.suppressed, hasOutbound: c.hasOutbound }) }
    return m
  }
  async existingCampaignRecipients(key: string): Promise<Set<string>> {
    if (!this.runtimes.has(key)) return new Set() // orphans from an interrupted approval are refreshed, not excluded
    return new Set([...this.recipients.values()].filter((r) => r.state.campaignKey === key).map((r) => r.email))
  }
  gmailPriorSent?: (emails: string[]) => Promise<Set<string>>

  // ---- CampaignWriter ----
  async ensureProject(projectKey: string): Promise<void> { if (!this.projects.includes(projectKey)) this.projects.push(projectKey) }
  async upsertContact(r: { email: string; businessName: string; contactName: string | null }): Promise<string> {
    const ex = this.contacts.get(r.email)
    if (ex) return ex.id
    const id = `c${++this.n}`
    this.contacts.set(r.email, { id, email: r.email, org: r.businessName, name: r.contactName, suppressed: false, hasOutbound: false })
    return id
  }
  failCampaignCreateOnce = false
  async createCampaignTask(runtime: Omit<CampaignRuntime, 'taskId'>): Promise<string> {
    if (this.failCampaignCreateOnce) { this.failCampaignCreateOnce = false; throw new Error('simulated crash before the campaign record was written') }
    if (this.runtimes.has(runtime.key)) throw new Error('campaign exists')
    const taskId = `camp${++this.n}`
    this.runtimes.set(runtime.key, { ...runtime, taskId })
    this.campaignStatus.set(runtime.key, { status: 'READY' })
    return taskId
  }
  async createRecipientTask(i: { contactId: string; sourceRef: string; state: Record<string, unknown> }): Promise<boolean> {
    const state = i.state as unknown as BizDevState
    const existing = [...this.recipients.values()].find((r) => r.email === state.contactEmail && r.state.campaignKey === state.campaignKey)
    if (existing) {
      if (existing.status === 'READY' && existing.state.sequenceStatus === 'QUEUED' && !existing.state.claimedStep) existing.state = state // refresh a never-sent recipient
      return false
    }
    const taskId = `t${++this.n}`
    this.recipients.set(taskId, { taskId, contactId: i.contactId, email: state.contactEmail, status: 'READY', state, nextCheckAt: null, nextAction: null, jerryRequest: null, cancelReason: null, blockerNote: null })
    return true
  }

  // ---- BizDevStore ----
  private view(r: MemRecipient): BizDevSequenceView {
    const c = this.contacts.get(r.email)!
    return { taskId: r.taskId, taskUpdatedAt: new Date(), contactId: r.contactId, contactEmail: r.email, contactName: c.name, organization: c.org, contactSuppressed: c.suppressed, state: JSON.parse(JSON.stringify(r.state)) }
  }
  private where(status: string, seq?: string) { return [...this.recipients.values()].filter((r) => r.status === status && (!seq || r.state.sequenceStatus === seq)).map((r) => this.view(r)) }
  async listActive() { return this.where('WAITING') }
  async listQueued() { return this.where('READY', 'QUEUED') }
  async listUncertain() { return this.where('BLOCKED', 'SEND_UNCERTAIN') }
  async campaignRuntimes() { return [...this.runtimes.values()].filter((c) => this.campaignStatus.get(c.key)?.status !== 'DONE') }
  async saveCampaign(key: string, patch: Partial<CampaignRuntime> & { escalate?: { jerryRequest: string; nextAction: string } }) {
    const c = this.runtimes.get(key)!
    const { escalate, ...rest } = patch
    Object.assign(c, rest)
    if (escalate) this.campaignStatus.set(key, { status: 'NEEDS_JERRY', jerryRequest: escalate.jerryRequest })
    else if (rest.state === 'ACTIVE') this.campaignStatus.set(key, { status: 'IN_PROGRESS' })
    else if (rest.state === 'PAUSED') this.campaignStatus.set(key, { status: 'BLOCKED' })
    else if (rest.state === 'COMPLETE') this.campaignStatus.set(key, { status: 'DONE' })
  }
  async setCampaignProgress(_k: string, line: string) { this.progress.push(line) }
  async confirmTokensExist(tokens: string[]) { return new Set(tokens.filter((t) => this.tokens.has(t))) }
  async claimStep(taskId: string, step: number) {
    const r = this.recipients.get(taskId)!
    if ((r.state.claimedStep ?? 0) >= step) return false
    r.state = { ...r.state, claimedStep: step }
    return true
  }
  async saveState(taskId: string, state: BizDevState) {
    const r = this.recipients.get(taskId)!
    // The engine's in-flight copy may not carry the latch; the real DB keeps it in the same jsonb.
    r.state = { ...JSON.parse(JSON.stringify(state)), claimedStep: Math.max(state.claimedStep ?? 0, r.state.claimedStep ?? 0) || undefined }
  }
  async recordInteraction(i: { taskId: string; direction: 'INBOUND' | 'OUTBOUND'; messageId: string; summary: string; extra?: Record<string, unknown> }) {
    if (this.interactions.some((x) => x.messageId === i.messageId)) return
    this.interactions.push({ taskId: i.taskId, direction: i.direction, messageId: i.messageId, replyClass: i.extra?.replyClass as string | undefined, summary: i.summary })
  }
  async suppressContact(contactId: string) { for (const c of this.contacts.values()) if (c.id === contactId) c.suppressed = true }
  async setPlan(taskId: string, plan: { nextCheckAt: Date; nextAction: string }) {
    const r = this.recipients.get(taskId)!
    r.nextCheckAt = plan.nextCheckAt
    r.nextAction = plan.nextAction
  }
  async transition(taskId: string, to: TransitionTarget, d: TransitionDetail) {
    const r = this.recipients.get(taskId)!
    r.status = to
    if (to === 'NEEDS_JERRY') { r.jerryRequest = d.jerryRequest ?? null; r.nextAction = d.nextAction ?? null }
    if (to === 'CANCELED') r.cancelReason = d.reason ?? null
    if (to === 'WAITING') { r.nextCheckAt = d.nextCheckAt ?? null; r.nextAction = d.nextAction ?? null }
    if (to === 'BLOCKED') { r.blockerNote = d.blockerNote ?? null; r.nextAction = d.nextAction ?? null }
  }

  // ---- helpers for assertions ----
  byEmail(email: string): MemRecipient { return [...this.recipients.values()].find((r) => r.email === email)! }
  countStatus(status: string): number { return [...this.recipients.values()].filter((r) => r.status === status).length }
}
