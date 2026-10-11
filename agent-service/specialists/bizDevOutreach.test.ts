import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addBusinessDays, runBizDevTick, decideReply, dueAction, stripQuoted, BIZDEV_SEQUENCES, type BizDevStore, type BizDevSequenceView, type BizDevState, type BizDevSequenceDef } from './bizDevOutreach'
import type { GmailAdapter, GmailFullMessage, GmailMessageSummary, GmailSendInput } from './googleAdapters'

const DEF = BIZDEV_SEQUENCES['living-north-phoenix-v1']
const SENT0 = '2026-10-11T18:42:00.000Z' // Sunday
const d = (s: string) => new Date(s)

class FakeGmail implements GmailAdapter {
  inbox: GmailMessageSummary[] = []
  bodies: Record<string, string> = {}
  sentSearchCount = 1 // the initial email
  sends: GmailSendInput[] = []
  failSend = false
  configured = true
  isConfigured() { return this.configured }
  async searchMessages(q: string): Promise<GmailMessageSummary[]> {
    if (q.startsWith('in:sent')) return Array.from({ length: this.sentSearchCount + this.sends.length }, (_, i) => ({ id: `s${i}`, threadId: 'T1', from: DEF.from, to: [DEF.contactEmail], subject: DEF.subject, snippet: '', receivedAt: null, replyTo: null }))
    return this.inbox
  }
  async getFullMessage(id: string): Promise<GmailFullMessage> {
    const m = this.inbox.find((x) => x.id === id)
    return { id, threadId: m?.threadId ?? 'T1', from: m?.from ?? DEF.from, to: [], cc: [], replyTo: m?.replyTo ?? null, subject: m?.subject ?? DEF.subject, bodyText: this.bodies[id] ?? '', receivedAt: m?.receivedAt ?? null, messageIdHeader: `<hdr-${id}@mail>` }
  }
  async listSendAsIdentities() { return [] }
  async createDraft(): Promise<never> { throw new Error('no drafts') }
  async sendMessage(input: GmailSendInput) {
    if (this.failSend) throw new Error('boom')
    this.sends.push(input)
    return { messageId: `out${this.sends.length}`, threadId: input.threadId ?? 'T1' }
  }
  reply(id: string, body: string, opts: { from?: string; replyTo?: string | null; subject?: string; threadId?: string } = {}) {
    this.inbox.push({ id, threadId: opts.threadId ?? 'T1', from: opts.from ?? 'Blair Ballin <blair@livingnorthphoenix.com>', to: [DEF.from], subject: opts.subject ?? 'Re: ' + DEF.subject, snippet: body.slice(0, 50), receivedAt: '2026-10-13T16:00:00.000Z', replyTo: opts.replyTo ?? null })
    this.bodies[id] = body
  }
}

class MemStore implements BizDevStore {
  state: BizDevState
  status: string = 'WAITING'
  suppressed = false
  claimed = 0
  jerryRequest: string | null = null
  cancelReason: string | null = null
  plan: { nextCheckAt: Date; nextAction: string } | null = null
  interactions: Array<{ direction: string; messageId: string }> = []
  constructor(overrides: Partial<BizDevState> = {}) {
    this.state = { sequenceKey: DEF.key, contactEmail: DEF.contactEmail, threadId: 'T1', sequenceStatus: 'ACTIVE', stepsSent: [{ step: 1, kind: 'INITIAL', messageId: 'm0', sentAt: SENT0 }], ...overrides }
  }
  async listActive(): Promise<BizDevSequenceView[]> {
    if (this.status !== 'WAITING') return []
    return [{ taskId: 't1', taskUpdatedAt: new Date(), contactId: 'c1', contactEmail: DEF.contactEmail, contactSuppressed: this.suppressed, state: JSON.parse(JSON.stringify(this.state)) }]
  }
  async claimStep(_t: string, step: number) { if (this.claimed >= step) return false; this.claimed = step; return true }
  async saveState(_t: string, s: BizDevState) { this.state = JSON.parse(JSON.stringify(s)) }
  async recordInteraction(i: { direction: 'INBOUND' | 'OUTBOUND'; messageId: string }) {
    if (!this.interactions.some((x) => x.messageId === i.messageId)) this.interactions.push({ direction: i.direction, messageId: i.messageId })
  }
  async suppressContact() { this.suppressed = true }
  async setPlan(_t: string, p: { nextCheckAt: Date; nextAction: string }) { this.plan = p }
  async transition(_t: string, to: 'NEEDS_JERRY' | 'CANCELED', det: { jerryRequest?: string; reason?: string }) {
    this.status = to
    if (to === 'NEEDS_JERRY') this.jerryRequest = det.jerryRequest ?? null
    else this.cancelReason = det.reason ?? null
  }
}

const run = (g: FakeGmail, s: MemStore, now: string, sequences?: Record<string, BizDevSequenceDef>) => runBizDevTick({ gmail: g, store: s, now: () => d(now), sequences })

test('business days skip weekends: Sunday + 5 = Friday; +7 more = following Tuesday... Wed', () => {
  assert.equal(addBusinessDays(d(SENT0), 5).toISOString().slice(0, 10), '2026-10-16')
  assert.equal(addBusinessDays(d('2026-10-16T18:00:00Z'), 7).toISOString().slice(0, 10), '2026-10-27')
  assert.equal(addBusinessDays(d('2026-10-27T18:00:00Z'), 7).toISOString().slice(0, 10), '2026-11-05')
})

test('scheduling: nothing before due, exactly one follow-up when due, no duplicate on re-tick', async () => {
  const g = new FakeGmail(), s = new MemStore()
  await run(g, s, '2026-10-15T12:00:00Z')
  assert.equal(g.sends.length, 0)
  const r = await run(g, s, '2026-10-16T19:00:00Z')
  assert.equal(g.sends.length, 1)
  assert.match(r.actions[0], /sent step 2/)
  assert.equal(g.sends[0].from, 'jerry@getcheckoff.com')
  assert.equal(g.sends[0].to, 'blair@livingnorthphoenix.com')
  assert.equal(g.sends[0].threadId, 'T1')
  assert.equal(g.sends[0].inReplyTo, '<hdr-m0@mail>')
  assert.equal(s.plan?.nextCheckAt.toISOString().slice(0, 10), '2026-10-27')
  // re-tick same instant, and a later tick before FU2 is due: still one send
  await run(g, s, '2026-10-16T19:15:00Z')
  await run(g, s, '2026-10-20T19:15:00Z')
  assert.equal(g.sends.length, 1)
  assert.equal(s.state.stepsSent.length, 2)
})

test('full sequence: 3 emails max, then close with NO fourth email', async () => {
  const g = new FakeGmail(), s = new MemStore()
  await run(g, s, '2026-10-16T19:00:00Z')
  await run(g, s, '2026-10-27T19:00:00Z')
  assert.equal(g.sends.length, 2)
  assert.match(g.sends[1].bodyText, /Living North Phoenix Favorites/)
  assert.doesNotMatch(g.sends[1].bodyText, /(we('ve| have) (created|built|made)|is now live|already (created|built))/i)
  assert.equal(s.state.stepsSent.length, 3)
  await run(g, s, '2026-11-04T19:00:00Z') // day before close
  assert.equal(s.status, 'WAITING')
  await run(g, s, '2026-11-05T19:00:00Z')
  assert.equal(s.status, 'CANCELED')
  assert.equal(s.state.sequenceStatus, 'COMPLETE_NO_RESPONSE')
  assert.equal(g.sends.length, 2, 'no email at close')
  await run(g, s, '2026-12-01T19:00:00Z')
  assert.equal(g.sends.length, 2)
})

test('reply matching via CheckOff relay (Reply-To) cancels pending follow-ups immediately and escalates interest', async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.reply('r1', "I'd love to learn more. Sounds interesting, let's talk next week.", { from: 'CheckOff <forwarder@getcheckoff.com>', replyTo: 'blair@livingnorthphoenix.com', threadId: 'OTHER' })
  const r = await run(g, s, '2026-10-16T19:00:00Z') // follow-up was also due
  assert.equal(g.sends.length, 0, 'follow-up must not go out when a reply is pending')
  assert.equal(s.status, 'NEEDS_JERRY')
  assert.equal(s.state.sequenceStatus, 'ESCALATED')
  assert.match(s.jerryRequest!, /Opportunity: Living North Phoenix Partnership/)
  assert.match(s.jerryRequest!, /Current Stage: NEEDS_JERRY/)
  assert.match(s.jerryRequest!, /let's talk next week/)
  assert.match(s.jerryRequest!, /Jerry Action Required/)
  assert.match(s.jerryRequest!, /Winston's Recommendation/)
  assert.ok(s.interactions.some((i) => i.direction === 'INBOUND' && i.messageId === 'r1'))
  assert.match(r.actions.join(' '), /follow-ups cancelled/)
  // after escalation the task is NEEDS_JERRY -> never listed again -> never sends
  await run(g, s, '2026-10-30T19:00:00Z')
  assert.equal(g.sends.length, 0)
})

test('commercial reply: captures terms, escalates, authorizes nothing', async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.reply('r2', 'Our newsletter sponsorship is $250 per issue, about 4,200 subscribers. Banner placement available.')
  await run(g, s, '2026-10-14T12:00:00Z')
  assert.equal(s.status, 'NEEDS_JERRY')
  assert.match(s.jerryRequest!, /\$250/)
  assert.match(s.jerryRequest!, /No spend is authorized/)
  assert.equal(g.sends.length, 0)
})

test('routine factual question is answered once, in-thread; follow-ups stop; second question escalates', async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.reply('r3', 'What is CheckOff? Is it available in North Phoenix?')
  await run(g, s, '2026-10-14T12:00:00Z')
  assert.equal(g.sends.length, 1)
  assert.equal(g.sends[0].threadId, 'T1')
  assert.equal(g.sends[0].from, 'jerry@getcheckoff.com')
  assert.match(g.sends[0].bodyText, /local bucket list/)
  assert.match(g.sends[0].bodyText, /Phoenix area/)
  assert.equal(s.state.sequenceStatus, 'ANSWERED')
  assert.equal(s.status, 'WAITING')
  // scheduled follow-up must not fire while ANSWERED
  await run(g, s, '2026-10-30T12:00:00Z')
  assert.equal(g.sends.length, 1)
  // wait elapsed with no reply -> back to Jerry, nothing more sent
  assert.equal(s.status, 'NEEDS_JERRY')
  assert.equal(g.sends.length, 1)
})

test('a question outside the verified FAQ, or mixed with commercial language, is NOT auto-answered', () => {
  assert.equal(decideReply('Re: x', 'How do businesses appear in the app?', 0).kind, 'ESCALATE')
  assert.equal(decideReply('Re: x', 'What is CheckOff? And what would advertising cost?', 0).kind, 'ESCALATE')
  assert.equal(decideReply('Re: x', 'How many users do you have?', 0).kind, 'ESCALATE')
  assert.equal(decideReply('Re: x', 'What is CheckOff?', 1).kind, 'ESCALATE', 'only one auto-answer per sequence')
  assert.equal(decideReply('Re: x', 'Thanks!', 0).kind, 'ESCALATE', 'unclear -> Jerry, never a guess')
})

test('opt-out: suppress contact, close, no sends even if a follow-up was due', async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.reply('r4', 'Please stop emailing me. Unsubscribe.')
  await run(g, s, '2026-10-16T19:00:00Z')
  assert.equal(s.suppressed, true)
  assert.equal(s.status, 'CANCELED')
  assert.equal(s.state.sequenceStatus, 'OPTED_OUT')
  assert.equal(g.sends.length, 0)
})

test('polite decline closes and stops', async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.reply('r5', "Thanks, but we're not interested right now.")
  await run(g, s, '2026-10-14T12:00:00Z')
  assert.equal(s.status, 'CANCELED')
  assert.equal(s.state.sequenceStatus, 'DECLINED')
  assert.equal(g.sends.length, 0)
})

test('auto-reply is not a response: follow-up still goes out afterwards', async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.reply('r6', 'I am currently out of the office with limited email access.', { subject: 'Automatic reply: ' + DEF.subject })
  await run(g, s, '2026-10-14T12:00:00Z')
  assert.equal(s.status, 'WAITING')
  assert.equal(s.state.sequenceStatus, 'ACTIVE')
  await run(g, s, '2026-10-16T19:00:00Z')
  assert.equal(g.sends.length, 1)
})

test('unrelated senders are never matched', async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.reply('r7', 'Buy our SEO services!', { from: 'Spam <seo@example.com>', threadId: 'X1' })
  g.reply('r8', 'Hello', { from: 'CheckOff <forwarder@getcheckoff.com>', replyTo: 'someone@else.com', threadId: 'X2' })
  g.reply('r9', 'Hello', { from: 'CheckOff <forwarder@getcheckoff.com>', replyTo: null, threadId: 'X3' })
  await run(g, s, '2026-10-14T12:00:00Z')
  assert.equal(s.status, 'WAITING')
  assert.equal(s.interactions.length, 0)
})

test('a colleague answering inside our thread counts as a response', async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.reply('r10', 'Blair asked me to reply: we are interested in a feature.', { from: 'Assistant <asst@livingnorthphoenix.com>', threadId: 'T1' })
  await run(g, s, '2026-10-14T12:00:00Z')
  assert.equal(s.status, 'NEEDS_JERRY')
})

test('suppressed contact blocks the send and stops the sequence', async () => {
  const g = new FakeGmail(), s = new MemStore()
  s.suppressed = true
  await run(g, s, '2026-10-16T19:00:00Z')
  assert.equal(g.sends.length, 0)
  assert.equal(s.status, 'CANCELED')
})

test('only explicitly authorized sequence keys are ever sent to', async () => {
  const g = new FakeGmail(), s = new MemStore({ sequenceKey: 'not-authorized' })
  await run(g, s, '2026-12-16T19:00:00Z')
  assert.equal(g.sends.length, 0)
  assert.equal(s.status, 'WAITING')
})

test('duplicate-send latch: an already-claimed step is never re-sent', async () => {
  const g = new FakeGmail(), s = new MemStore()
  s.claimed = 2 // crashed after claim previously
  const r = await run(g, s, '2026-10-16T19:00:00Z')
  assert.equal(g.sends.length, 0)
  assert.match(r.errors.join(' '), /already claimed/)
})

test('manual email to the contact since start pauses automation and hands to Jerry', async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.sentSearchCount = 2 // Jerry emailed Blair himself
  await run(g, s, '2026-10-16T19:00:00Z')
  assert.equal(g.sends.length, 0)
  assert.equal(s.status, 'NEEDS_JERRY')
  assert.equal(s.state.sequenceStatus, 'PAUSED')
})

test('an earlier BOUNCED send is not mistaken for manual contact after a resend', async () => {
  const g = new FakeGmail(), s = new MemStore({ failedSends: [{ messageId: 'old', threadId: 'T0', sentAt: '2026-10-11T18:42:00.000Z', bounceMessageId: 'bx', reason: '535' }] })
  g.sentSearchCount = 2 // bounced original + the resend
  await run(g, s, '2026-10-16T19:00:00Z')
  assert.equal(g.sends.length, 1)
  assert.equal(s.status, 'WAITING')
})

test('send failure is never retried and escalates', async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.failSend = true
  const r = await run(g, s, '2026-10-16T19:00:00Z')
  assert.equal(s.status, 'NEEDS_JERRY')
  assert.match(r.errors.join(' '), /send failed/)
  g.failSend = false
  await run(g, s, '2026-10-16T19:30:00Z')
  assert.equal(g.sends.length, 0)
})

test('the same inbound message is processed once (idempotent interactions)', async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.reply('r11', "Thanks, but we're not interested.")
  await run(g, s, '2026-10-14T12:00:00Z')
  await run(g, s, '2026-10-14T12:15:00Z')
  assert.equal(s.interactions.filter((i) => i.messageId === 'r11').length, 1)
})

test('bounce (delivery failure) is not a response: pauses, escalates with the provider error, never follows up', async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.reply('b1', "Message not delivered. 535 Authentication credentials invalid", { from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)' })
  await run(g, s, '2026-10-11T19:00:00Z')
  assert.equal(s.status, 'NEEDS_JERRY')
  assert.equal(s.state.sequenceStatus, 'PAUSED')
  assert.match(s.jerryRequest!, /did NOT receive it/)
  assert.match(s.jerryRequest!, /535 Authentication credentials invalid/)
  await run(g, s, '2026-10-16T19:00:00Z')
  assert.equal(g.sends.length, 0)
})

test("the contact's unrelated newsletter (same address, new thread, different subject) is NOT a reply", async () => {
  const g = new FakeGmail(), s = new MemStore()
  g.reply('n1', 'LNP NOTES: we are interested in your thoughts on HOAs. Read online. Unsubscribe', { from: 'CheckOff <forwarder@getcheckoff.com>', replyTo: 'blair@livingnorthphoenix.com', subject: 'Is anything real anymore?', threadId: 'NEWS1' })
  await run(g, s, '2026-10-14T12:00:00Z')
  assert.equal(s.status, 'WAITING')
  assert.equal(s.state.sequenceStatus, 'ACTIVE')
  assert.equal(s.interactions.length, 0)
  await run(g, s, '2026-10-16T19:00:00Z')
  assert.equal(g.sends.length, 1, 'follow-up still goes out; newsletter did not cancel it')
})

test('self-heal: a stranded ESCALATED/DECLINED state with a still-WAITING task is completed, never left drifting', async () => {
  const g = new FakeGmail(), s1 = new MemStore({ sequenceStatus: 'ESCALATED' })
  await run(g, s1, '2026-10-12T12:00:00Z')
  assert.equal(s1.status, 'NEEDS_JERRY')
  const s2 = new MemStore({ sequenceStatus: 'DECLINED' })
  await run(g, s2, '2026-10-12T12:00:00Z')
  assert.equal(s2.status, 'CANCELED')
  assert.equal(g.sends.length, 0)
})

test('stripQuoted ignores quoted history so our own words are not classified', () => {
  assert.equal(stripQuoted('Sounds good!\n\nOn Mon, Oct 12, 2026 at 9:00 AM Jerry wrote:\n> please unsubscribe me if not interested'), 'Sounds good!')
})

test('dueAction is pure and respects maxOutbound', () => {
  const st: BizDevState = { sequenceKey: DEF.key, contactEmail: DEF.contactEmail, threadId: 'T', sequenceStatus: 'ACTIVE', stepsSent: [{ step: 1, kind: 'INITIAL', messageId: 'a', sentAt: SENT0 }, { step: 2, kind: 'FOLLOW_UP', messageId: 'b', sentAt: '2026-10-16T19:00:00Z' }, { step: 3, kind: 'FOLLOW_UP', messageId: 'c', sentAt: '2026-10-27T19:00:00Z' }] }
  assert.equal(dueAction(DEF, st, d('2026-11-04T00:00:00Z')).kind, 'NONE')
  assert.equal(dueAction(DEF, st, d('2026-11-05T19:00:00Z')).kind, 'CLOSE')
})
