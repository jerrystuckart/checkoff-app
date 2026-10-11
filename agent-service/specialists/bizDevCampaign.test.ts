import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBizDevTick, BIZDEV_SEQUENCES, addBusinessDays } from './bizDevOutreach'
import { decideCampaignReply } from './bizDevReplies'
import { buildCampaignPlan, approveCampaign, type CampaignDefinition } from './outreachCampaign'
import { FakeGmail, MemWorld, uuid } from './outreachTestKit'

// Everything here uses FakeGmail + MemWorld: no network, no database, no real email.

const MON = new Date('2026-10-12T15:00:00Z')
const DEF: CampaignDefinition = {
  key: 'gb-test',
  name: 'Green Bay TEST',
  metroSlug: 'green-bay',
  metroLabel: 'Green Bay Metro',
  subjectTemplate: 'We selected {{business_name}} for CheckOff',
  firstTouchBody: 'Hi {{business_name}} team,\n\nWe selected you for CheckOff {{metro}}:\n\n{{items_block}}\n\nFree graphics: {{kit_url}}\n\nYou can also just reply to this email.\n\nJerry',
  followUp1Body: 'Hi {{business_name}} team,\n\nQuick follow-up about {{item_text}}.\n\n{{items_block}}\n\nJerry',
  followUp2Body: 'Last note for {{business_name}}: {{confirm_url}}\n\nJerry',
  approvals: { firstTouchTemplate: true, followUpTemplates: true },
}

async function launch(n: number, o: { def?: Partial<CampaignDefinition>; activate?: boolean; tokens?: boolean } = {}) {
  const w = new MemWorld()
  const rows: string[] = ['business_name,contact_email,item_id']
  for (let i = 1; i <= n; i++) {
    w.itemRows.set(uuid(100 + i), { id: uuid(100 + i), text: `Try the special at 'Biz ${i}'`, isActive: true, isSecret: false, metroSlug: 'green-bay' })
    rows.push(`Biz ${i},biz${i}@example.com,${uuid(100 + i)}`)
  }
  const def = { ...DEF, ...o.def }
  const plan = await buildCampaignPlan(def, rows.join('\n'), { lookups: w })
  assert.equal(plan.counts.errors, 0, JSON.stringify(plan.issues))
  let t = 0
  await approveCampaign(plan, { confirmRecipients: n, previewHash: plan.inputHash, templatesApproved: true, now: MON }, w, () => `TOK_${String(++t).padStart(28, '0')}`)
  if (o.tokens !== false) for (const r of w.recipients.values()) for (const l of r.state.listings ?? []) w.tokens.add(l.token)
  if (o.activate !== false) await w.saveCampaign(def.key, { state: 'ACTIVE' })
  return { w, g: new FakeGmail(), runtime: w.runtimes.get(def.key)! }
}

const tick = (g: FakeGmail, w: MemWorld, now: Date = MON, sequences: Parameters<typeof runBizDevTick>[0]['sequences'] = {}) =>
  runBizDevTick({ gmail: g, store: w, now: () => now, sleep: async () => {}, sequences })

const emailOf = (i: number) => `biz${i}@example.com`

test('before activation nothing is sent; after activation first touches go out from jerry@ with the confirm link', async () => {
  const { w, g } = await launch(5, { activate: false })
  await tick(g, w)
  assert.equal(g.sends.length, 0, 'an APPROVED-but-not-activated campaign sends nothing')
  await w.saveCampaign('gb-test', { state: 'ACTIVE' })
  const r = await tick(g, w)
  assert.equal(g.sends.length, 5)
  assert.equal(r.errors.length, 0)
  for (const s of g.sends) {
    assert.equal(s.from, 'jerry@getcheckoff.com')
    assert.match(s.subject, /^We selected Biz \d for CheckOff$/)
    assert.match(s.bodyText, /getcheckoff\.com\/confirm\/TOK_/)
    assert.match(s.bodyText, /getcheckoff\.com\/downloads\/featured-kit/)
  }
  const rec = w.byEmail(emailOf(1))
  assert.equal(rec.status, 'WAITING')
  assert.equal(rec.state.sequenceStatus, 'ACTIVE')
  assert.equal(rec.state.stepsSent[0].kind, 'INITIAL')
  assert.equal(rec.state.attempts![0].outcome, 'ACCEPTED')
  assert.equal(rec.nextCheckAt!.toISOString().slice(0, 10), '2026-10-19', 'Follow-Up 1 is 5 business days out')
  assert.equal(w.interactions.filter((i) => i.direction === 'OUTBOUND').length, 5, 'every accepted send is recorded')
})

test('a campaign without Jerry\'s recorded approval is never acted on', async () => {
  const { w, g, runtime } = await launch(3)
  delete runtime.approval
  await tick(g, w)
  assert.equal(g.sends.length, 0)
})

test('governor: 80/day total across ticks, counting other outgoing mail; then it pauses instead of exceeding', async () => {
  const { w, g } = await launch(100)
  let total = 0
  const per: number[] = []
  for (let i = 0; i < 6; i++) { const before = g.sends.length; await tick(g, w); per.push(g.sends.length - before); total = g.sends.length }
  assert.equal(total, 80)
  assert.deepEqual(per, [25, 25, 25, 5, 0, 0], 'batches of 25 until the cap, then nothing')
  assert.equal(w.countStatus('READY'), 20, 'the rest stay queued for tomorrow')
  const r = await tick(g, w)
  assert.ok(r.actions.some((a) => /daily cap reached/.test(a)))
})

test('governor includes OTHER outgoing activity and the stricter provider ceiling', async () => {
  const a = await launch(100)
  a.g.otherSent24h = 50
  for (let i = 0; i < 4; i++) await tick(a.g, a.w)
  assert.equal(a.g.sends.length, 30, '80 minus 50 already sent today by other means')
  const b = await launch(100, { def: { dailyCap: 95 } })
  for (let i = 0; i < 6; i++) await tick(b.g, b.w)
  assert.equal(b.g.sends.length, 90, 'dailyCap 95 is limited to providerLimit 100 - reserve 10')
  const c = await launch(10)
  c.g.otherSent24h = 95
  await tick(c.g, c.w)
  assert.equal(c.g.sends.length, 0, 'near the provider limit: pause rather than exceed')
})

test('the cap is configurable', async () => {
  const { w, g } = await launch(30, { def: { dailyCap: 12, batchPerTick: 5 } })
  for (let i = 0; i < 5; i++) await tick(g, w)
  assert.equal(g.sends.length, 12)
})

test('restart-safe and duplicate-proof: re-running ticks never re-sends; a pre-claimed step is never sent', async () => {
  const { w, g } = await launch(6)
  await tick(g, w)
  await tick(g, w)
  await tick(g, w)
  assert.equal(g.sends.length, 6)
  assert.equal(new Set(g.sends.map((s) => s.to)).size, 6)
  const l = await launch(3)
  l.w.byEmail(emailOf(2)).state.claimedStep = 1 // a previous process crashed after claiming
  const r = await tick(l.g, l.w)
  assert.equal(l.g.sends.length, 2)
  assert.ok(r.errors.some((e) => /already claimed/.test(e)))
})

test('a failed send has an UNCERTAIN outcome: recorded, blocked, NEVER retried; other recipients continue', async () => {
  const { w, g } = await launch(4)
  g.failNext = [null, new Error('socket hang up'), null, null]
  const r = await tick(g, w)
  assert.equal(g.sends.length, 3)
  const bad = w.byEmail(emailOf(2))
  assert.equal(bad.status, 'BLOCKED')
  assert.equal(bad.state.sequenceStatus, 'SEND_UNCERTAIN')
  assert.equal(bad.state.attempts![0].outcome, 'UNCERTAIN')
  assert.ok(r.errors.some((e) => /outcome uncertain/.test(e)))
  await tick(g, w)
  await tick(g, w)
  assert.equal(g.sends.length, 3, 'never auto-retried')
  assert.equal(w.runtimes.get('gb-test')!.state, 'ACTIVE', 'one isolated failure does not stop the campaign')
})

test('an uncertain send that actually went out is reconciled from Gmail Sent, never re-sent', async () => {
  const { w, g } = await launch(2)
  g.failNext = [new Error('timeout after request was written')]
  await tick(g, w)
  const bad = w.byEmail(emailOf(1))
  assert.equal(bad.state.sequenceStatus, 'SEND_UNCERTAIN')
  const ghost = g.addGhostSent(emailOf(1), 'We selected Biz 1 for CheckOff')
  const before = g.sends.length
  const r = await tick(g, w)
  assert.equal(g.sends.length, before, 'no resend')
  const fixed = w.byEmail(emailOf(1))
  assert.equal(fixed.status, 'WAITING')
  assert.equal(fixed.state.stepsSent[0].messageId, ghost.id)
  assert.ok(r.actions.some((a) => /reconciled uncertain send/.test(a)))
})

test('a systemic send error (rate limit / auth) pauses the WHOLE campaign and escalates once', async () => {
  const { w, g } = await launch(10)
  g.failNext = [null, new Error('Gmail messages.send returned 429: rateLimitExceeded')]
  const r = await tick(g, w)
  assert.equal(g.sends.length, 1)
  const c = w.runtimes.get('gb-test')!
  assert.equal(c.state, 'PAUSED')
  assert.equal(w.campaignStatus.get('gb-test')!.status, 'NEEDS_JERRY')
  assert.match(w.campaignStatus.get('gb-test')!.jerryRequest!, /PAUSED/)
  assert.ok(r.errors.some((e) => /PAUSED/.test(e)))
  await tick(g, w)
  assert.equal(g.sends.length, 1, 'paused means paused')
})

test('three consecutive ordinary failures also pause the campaign', async () => {
  const { w, g } = await launch(10)
  g.failNext = [new Error('weird 1'), new Error('weird 2'), new Error('weird 3')]
  await tick(g, w)
  assert.equal(w.runtimes.get('gb-test')!.state, 'PAUSED')
  assert.equal(g.sends.length, 0)
})

test('pause / resume: a paused campaign sends nothing (first touches or follow-ups) but still processes replies', async () => {
  const { w, g } = await launch(4)
  await tick(g, w)
  await w.saveCampaign('gb-test', { state: 'PAUSED', pauseReason: 'Paused by Jerry' })
  g.addReply({ from: emailOf(1), subject: 'Re: We selected Biz 1 for CheckOff', body: 'Yes, that is accurate!', threadId: w.byEmail(emailOf(1)).state.threadId })
  const due = addBusinessDays(MON, 5)
  await tick(g, w, due)
  assert.equal(g.sends.length, 4, 'no follow-ups while paused')
  assert.equal(w.byEmail(emailOf(1)).status, 'DONE', 'the reply was still processed')
  await w.saveCampaign('gb-test', { state: 'ACTIVE' })
  await tick(g, w, due)
  assert.equal(g.sends.length, 4 + 3, 'resume: follow-ups go to the 3 who did not reply')
})

test('confirmation tokens must exist before anything is sent', async () => {
  const { w, g } = await launch(3, { tokens: false })
  const r = await tick(g, w)
  assert.equal(g.sends.length, 0)
  assert.ok(r.errors.some((e) => /token/.test(e)))
})

test('the sending identity must be a verified send-as address; otherwise the campaign pauses', async () => {
  const { w, g } = await launch(3)
  g.sendAsOk = false
  await tick(g, w)
  assert.equal(g.sends.length, 0)
  assert.equal(w.runtimes.get('gb-test')!.state, 'PAUSED')
})

test('a suppressed contact is never emailed', async () => {
  const { w, g } = await launch(3)
  for (const c of w.contacts.values()) if (c.email === emailOf(2)) c.suppressed = true
  await tick(g, w)
  assert.equal(g.sends.length, 2)
  assert.ok(!g.sends.some((s) => s.to === emailOf(2)))
  assert.equal(w.byEmail(emailOf(2)).status, 'CANCELED')
})

test('approved cadence: Follow-Up 1 at +5 business days, Follow-Up 2 at +7 more, close at +7 more; max three emails; follow-ups are in-thread Re: replies', async () => {
  const { w, g } = await launch(3)
  await tick(g, w)
  const fu1 = addBusinessDays(MON, 5)
  await tick(g, w, new Date(fu1.getTime() - 3_600_000))
  assert.equal(g.sends.length, 3, 'not yet due')
  await tick(g, w, fu1)
  assert.equal(g.sends.length, 6)
  const f = g.sends[3]
  assert.match(f.subject, /^Re: We selected Biz \d for CheckOff$/)
  assert.ok(f.threadId, 'sent in the original thread')
  assert.match(f.bodyText, /Quick follow-up about Try the special at 'Biz \d'/)
  assert.match(f.bodyText, /getcheckoff\.com\/confirm\/TOK_/)
  const fu2 = addBusinessDays(fu1, 7)
  await tick(g, w, fu2)
  assert.equal(g.sends.length, 9)
  assert.match(g.sends[6].bodyText, /Last note for Biz \d: https:\/\/getcheckoff\.com\/confirm\//)
  const close = addBusinessDays(fu2, 7)
  await tick(g, w, new Date(close.getTime() - 3_600_000))
  assert.equal(w.countStatus('WAITING'), 3)
  await tick(g, w, close)
  assert.equal(w.countStatus('CANCELED'), 3)
  assert.equal(w.byEmail(emailOf(1)).state.sequenceStatus, 'COMPLETE_NO_RESPONSE')
  await tick(g, w, addBusinessDays(close, 30))
  assert.equal(g.sends.length, 9, 'never a fourth email')
  for (const i of [1, 2, 3]) assert.equal(g.sends.filter((s) => s.to === emailOf(i)).length, 3)
})

test('follow-ups share the daily cap with first touches', async () => {
  const { w, g } = await launch(5)
  await tick(g, w)
  g.otherSent24h = 74 // 5 sent by us + 74 other = 79 of 80
  await tick(g, w, addBusinessDays(MON, 5))
  assert.equal(g.sends.length, 5 + 1, 'only one follow-up fits')
})

test('reply scanning is BATCHED: two list queries per tick for the whole campaign, full fetches only for new mail', async () => {
  const { w, g } = await launch(30)
  for (let i = 0; i < 2; i++) await tick(g, w) // 25 + 5
  assert.equal(g.sends.length, 30)
  g.idCalls.length = 0
  for (const i of [3, 9, 17]) g.addReply({ from: emailOf(i), subject: `Re: We selected Biz ${i} for CheckOff`, body: 'Looks good, thanks!', threadId: w.byEmail(emailOf(i)).state.threadId })
  g.fullCalls = 0
  await tick(g, w)
  const scans = g.idCalls.filter((q) => !q.startsWith('in:sent'))
  assert.equal(scans.length, 2, 'one subject-stem query + one bounce query, regardless of 30 recipients')
  assert.equal(g.fullCalls, 3, 'only the three new messages were fetched')
  for (const i of [3, 9, 17]) assert.equal(w.byEmail(emailOf(i)).status, 'DONE')
  assert.equal(w.byEmail(emailOf(4)).status, 'WAITING')
  g.fullCalls = 0
  await tick(g, w)
  assert.equal(g.fullCalls, 0, 'already-handled mail is not re-fetched on the next tick')
})

test('replies relayed through forwarder@getcheckoff.com are matched by Reply-To; unrelated mail from the same address is not a reply', async () => {
  const { w, g } = await launch(3)
  await tick(g, w)
  g.addReply({ from: emailOf(1), subject: 'Re: We selected Biz 1 for CheckOff', body: 'Yes, accurate.', viaRelay: true })
  g.addReply({ from: emailOf(2), subject: 'Our weekly specials newsletter!', body: 'Come see our specials. Unsubscribe', viaRelay: true })
  await tick(g, w)
  assert.equal(w.byEmail(emailOf(1)).status, 'DONE')
  assert.equal(w.byEmail(emailOf(2)).status, 'WAITING')
})

type Case = { name: string; body: string; subject?: string; attachments?: Array<{ filename: string; mimeType: string; size: number }>; expectStatus: string; expectSeq: string; replyClass: string }
const CASES: Case[] = [
  { name: 'confirmation', body: 'Hi Jerry, yes this is accurate. Thanks!', expectStatus: 'DONE', expectSeq: 'CONFIRMED', replyClass: 'listing_confirmed' },
  { name: 'bare yes', body: 'yes', expectStatus: 'DONE', expectSeq: 'CONFIRMED', replyClass: 'listing_confirmed' },
  { name: 'correction', body: "Actually we don't serve that anymore; it should say the Friday fish fry instead.", expectStatus: 'NEEDS_JERRY', expectSeq: 'ESCALATED', replyClass: 'correction_requested' },
  { name: 'photo attached', body: 'Thanks for including us!', attachments: [{ filename: 'front.jpg', mimeType: 'image/jpeg', size: 400000 }], expectStatus: 'NEEDS_JERRY', expectSeq: 'ESCALATED', replyClass: 'photo_provided' },
  { name: 'photo offered', body: "That's right. Here's a photo of our burger, attached.", expectStatus: 'NEEDS_JERRY', expectSeq: 'ESCALATED', replyClass: 'photo_provided' },
  { name: 'question (FAQ off)', body: 'What is CheckOff exactly? How does it work?', expectStatus: 'NEEDS_JERRY', expectSeq: 'ESCALATED', replyClass: 'question' },
  { name: 'partnership interest', body: "We'd love to talk about a partnership. Can we set up a call next week?", expectStatus: 'NEEDS_JERRY', expectSeq: 'ESCALATED', replyClass: 'partnership_interest' },
  { name: 'pricing question', body: 'How much does it cost to be featured?', expectStatus: 'NEEDS_JERRY', expectSeq: 'ESCALATED', replyClass: 'partnership_interest' },
  { name: 'decline', body: "Thanks, but we're not interested.", expectStatus: 'CANCELED', expectSeq: 'DECLINED', replyClass: 'decline' },
  { name: 'opt-out', body: 'Please stop emailing us and remove me from your list.', expectStatus: 'CANCELED', expectSeq: 'OPTED_OUT', replyClass: 'opt_out' },
  { name: 'unclear', body: 'Hmm ok.', expectStatus: 'NEEDS_JERRY', expectSeq: 'ESCALATED', replyClass: 'unclear' },
]

for (const c of CASES) {
  test(`reply class: ${c.name} -> ${c.expectStatus}/${c.expectSeq}; follow-ups cancelled; nothing published`, async () => {
    const { w, g } = await launch(2)
    await tick(g, w)
    g.addReply({ from: emailOf(1), subject: c.subject ?? 'Re: We selected Biz 1 for CheckOff', body: c.body, attachments: c.attachments, threadId: w.byEmail(emailOf(1)).state.threadId })
    await tick(g, w)
    const r = w.byEmail(emailOf(1))
    assert.equal(r.status, c.expectStatus)
    assert.equal(r.state.sequenceStatus, c.expectSeq)
    assert.equal(w.interactions.find((i) => i.direction === 'INBOUND')!.replyClass, c.replyClass)
    const before = g.sends.length
    await tick(g, w, addBusinessDays(MON, 5))
    assert.equal(g.sends.filter((s) => s.to === emailOf(1)).length, 1, 'no follow-up after a substantive reply')
    assert.equal(g.sends.length - before, 1, 'the other recipient still gets its follow-up')
    if (c.expectStatus === 'NEEDS_JERRY') {
      assert.match(r.jerryRequest!, /Listing\(s\) we sent/)
      assert.match(r.jerryRequest!, /Business's Response/)
      assert.match(r.jerryRequest!, /Winston's Recommendation/)
      assert.match(r.jerryRequest!, /Jerry Action Required/)
    }
    if (c.replyClass === 'correction_requested') assert.match(r.jerryRequest!, /never publishes a correction/)
    if (c.replyClass === 'photo_provided') assert.match(r.jerryRequest!, /never publishes a photo/)
    if (c.expectSeq === 'OPTED_OUT') assert.equal([...w.contacts.values()].find((x) => x.email === emailOf(1))!.suppressed, true)
  })
}

test('out-of-office is not a response: the sequence continues and the follow-up still goes out', async () => {
  const { w, g } = await launch(1)
  await tick(g, w)
  g.addReply({ from: emailOf(1), subject: 'Automatic reply: We selected Biz 1 for CheckOff', body: 'I am currently out of the office until Monday.', threadId: w.byEmail(emailOf(1)).state.threadId })
  await tick(g, w)
  assert.equal(w.byEmail(emailOf(1)).state.sequenceStatus, 'ACTIVE')
  await tick(g, w, addBusinessDays(MON, 5))
  assert.equal(g.sends.length, 2)
})

test('"contact me in 2 weeks" defers: follow-ups stop, then it is handed to Jerry on that date', async () => {
  const { w, g } = await launch(1)
  await tick(g, w)
  g.addReply({ from: emailOf(1), subject: 'Re: We selected Biz 1 for CheckOff', body: 'Not a good time. Please reach back out in 2 weeks.', threadId: w.byEmail(emailOf(1)).state.threadId })
  await tick(g, w)
  const r = w.byEmail(emailOf(1))
  assert.equal(r.state.sequenceStatus, 'DEFERRED')
  assert.equal(r.status, 'WAITING')
  assert.match(r.nextAction!, /contacted around/)
  await tick(g, w, addBusinessDays(MON, 5))
  assert.equal(g.sends.length, 1, 'no follow-up while deferred')
  await tick(g, w, new Date(MON.getTime() + 15 * 86_400_000))
  assert.equal(w.byEmail(emailOf(1)).status, 'NEEDS_JERRY')
  assert.equal(g.sends.length, 1)
})

test('routine confirmations do NOT flood NEEDS_JERRY', async () => {
  const { w, g } = await launch(20)
  for (let i = 0; i < 1; i++) { await tick(g, w); }
  await tick(g, w)
  for (let i = 1; i <= 20; i++) g.addReply({ from: emailOf(i), subject: `Re: We selected Biz ${i} for CheckOff`, body: i % 2 ? 'Yes, accurate!' : 'Looks good to me, thanks', threadId: w.byEmail(emailOf(i)).state.threadId })
  await tick(g, w)
  assert.equal(w.countStatus('NEEDS_JERRY'), 0)
  assert.equal(w.countStatus('DONE'), 20)
  await tick(g, w, addBusinessDays(MON, 5))
  assert.equal(g.sends.length, 20, 'and no follow-ups to anyone who confirmed')
})

test('campaign FAQ auto-answers are off by default; when on, they never use the Phoenix-specific answer', () => {
  const now = MON
  const off = decideCampaignReply('Re: x', 'What is CheckOff?', { autoAnswersSoFar: 0, faqEnabled: false, now })
  assert.equal(off.kind, 'ESCALATE')
  const on = decideCampaignReply('Re: x', 'What is CheckOff?', { autoAnswersSoFar: 0, faqEnabled: true, now })
  assert.equal(on.kind, 'FAQ')
  const loc = decideCampaignReply('Re: x', 'Is it available in North Phoenix?', { autoAnswersSoFar: 0, faqEnabled: true, now })
  assert.notEqual(loc.kind, 'FAQ', 'the Blair "West Valley" answer is not reused for campaigns')
})

test('bounces: a bad address closes just that recipient; our own sender failure pauses the campaign; a high bounce rate pauses it', async () => {
  const a = await launch(3)
  await tick(a.g, a.w)
  a.g.addBounce(a.w.byEmail(emailOf(1)).state.threadId, "Address not found. 550 5.1.1 The email account that you tried to reach does not exist.")
  await tick(a.g, a.w)
  assert.equal(a.w.byEmail(emailOf(1)).status, 'CANCELED')
  assert.equal(a.w.byEmail(emailOf(1)).state.sequenceStatus, 'BOUNCED')
  assert.equal(a.w.runtimes.get('gb-test')!.state, 'ACTIVE')
  assert.equal(a.w.runtimes.get('gb-test')!.bounceCount, 1)
  assert.equal(a.w.interactions.find((i) => i.replyClass === 'bounce')!.direction, 'INBOUND')

  const b = await launch(3)
  await tick(b.g, b.w)
  b.g.addBounce(b.w.byEmail(emailOf(2)).state.threadId, "You're sending this from a different address or alias using the 'Send mail as' feature. 535 Authentication credentials invalid")
  await tick(b.g, b.w)
  assert.equal(b.w.runtimes.get('gb-test')!.state, 'PAUSED')
  assert.equal(b.w.byEmail(emailOf(2)).status, 'BLOCKED')
  assert.match(b.w.campaignStatus.get('gb-test')!.jerryRequest!, /Sender-configuration bounce/)
  const before = b.g.sends.length
  await tick(b.g, b.w, addBusinessDays(MON, 5))
  assert.equal(b.g.sends.length, before, 'no more sends while the sender is broken')

  const c = await launch(20)
  await tick(c.g, c.w)
  await tick(c.g, c.w)
  for (const i of [1, 2, 3]) c.g.addBounce(c.w.byEmail(emailOf(i)).state.threadId, '550 5.1.1 user unknown')
  await tick(c.g, c.w)
  assert.equal(c.w.runtimes.get('gb-test')!.state, 'PAUSED')
  assert.match(c.w.runtimes.get('gb-test')!.pauseReason!, /Bounce rate/)
})

test('the campaign completes when every recipient is closed', async () => {
  const { w, g } = await launch(2)
  await tick(g, w)
  for (const i of [1, 2]) g.addReply({ from: emailOf(i), subject: `Re: We selected Biz ${i} for CheckOff`, body: 'yes', threadId: w.byEmail(emailOf(i)).state.threadId })
  await tick(g, w)
  await tick(g, w)
  assert.equal(w.runtimes.get('gb-test')!.state, 'COMPLETE')
  assert.ok(w.progress.length > 0, 'a progress line is kept on the campaign task for the Chief Brief')
})

test('Blair\'s sequence is untouched: it runs on the same engine, same schedule, alongside a live campaign', async () => {
  const { w, g } = await launch(2)
  await tick(g, w)
  const blair = BIZDEV_SEQUENCES['living-north-phoenix-v1']
  w.contacts.set(blair.contactEmail, { id: 'cB', email: blair.contactEmail, org: blair.organization, name: blair.contactName, suppressed: false, hasOutbound: true })
  const sentAt = '2026-10-11T19:16:16.752Z'
  const ghost = g.addGhostSent(blair.contactEmail, blair.subject) // Blair's original email, as Gmail Sent would show it
  w.recipients.set('tBlair', { taskId: 'tBlair', contactId: 'cB', email: blair.contactEmail, status: 'WAITING', nextCheckAt: new Date('2026-10-16T19:16:16.752Z'), nextAction: null, jerryRequest: null, cancelReason: null, blockerNote: null, state: { sequenceKey: blair.key, contactEmail: blair.contactEmail, threadId: ghost.threadId, sequenceStatus: 'ACTIVE', stepsSent: [{ step: 1, kind: 'INITIAL', messageId: ghost.id, sentAt }] } })
  const before = g.sends.length
  await tick(g, w, new Date('2026-10-15T19:00:00Z'), { [blair.key]: blair })
  assert.equal(g.sends.filter((s) => s.to === blair.contactEmail).length, 0, 'not due before Oct 16')
  await tick(g, w, new Date('2026-10-16T19:20:00Z'), { [blair.key]: blair })
  const blairSends = g.sends.filter((s) => s.to === blair.contactEmail)
  assert.equal(blairSends.length, 1)
  assert.equal(blairSends[0].subject, `Re: ${blair.subject}`)
  assert.match(blairSends[0].bodyText, /Just circling back/)
  assert.equal(w.recipients.get('tBlair')!.state.stepsSent.length, 2)
  assert.ok(g.sends.length > before)
})

test('a recipient whose sequence key is not an approved campaign is never sent to', async () => {
  const { w, g } = await launch(1)
  await tick(g, w)
  w.byEmail(emailOf(1)).state.sequenceKey = 'campaign:someone-elses'
  await tick(g, w, addBusinessDays(MON, 5))
  assert.equal(g.sends.length, 1)
})
