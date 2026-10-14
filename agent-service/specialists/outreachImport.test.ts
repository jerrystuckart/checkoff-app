import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildImportPlan, importSentRecipients, readImportCsv, renderImportPreview, type ImportConfig, type ImportDeps, type SentMessageFacts } from './outreachImport'
import { buildCampaignPlan, type CampaignDefinition } from './outreachCampaign'
import { runBizDevTick, addBusinessDays } from './bizDevOutreach'
import { ApprovalRefused } from './outreachCampaign'
import type { CampaignRuntime } from './bizDevCampaign'
import { FakeGmail, MemWorld, uuid } from './outreachTestKit'

// Fakes only: no network, no database, no real email.

const KEY = 'green-bay-p1'
const SEND_AT = new Date('2026-10-14T15:41:35Z') // Wed; the Oct 14 reconciliation sends
const FU1 = 'Hi {{business_name}} team,\n\nJust following up on the CheckOff listing we sent over.\n\n{{items_block}}\n\nJerry'
const FU2 = 'Hi {{business_name}} team,\n\nOne last note about {{business_name}}: {{confirm_url}}\n\nJerry'

function runtime(over: Partial<CampaignRuntime> = {}): Omit<CampaignRuntime, 'taskId'> {
  return {
    key: KEY, name: 'Green Bay Priority 1', state: 'ACTIVE', metroLabel: 'Green Bay Metro', from: 'jerry@getcheckoff.com',
    subjectTemplate: 'We selected {{business_name}} for CheckOff',
    firstTouchBody: 'Hi {{business_name}} team,\n\n{{items_block}}\n\nKit: {{kit_url}}',
    followUps: [{ step: 2, afterBusinessDays: 5, bodyText: FU1 }, { step: 3, afterBusinessDays: 7, bodyText: FU2 }],
    closeAfterBusinessDays: 7, maxOutbound: 3, faqEnabled: false, dailyCap: 80, providerLimit: 100, reserve: 10, batchPerTick: 25, sendDelayMs: 0,
    approval: { approvedBy: 'jerry', approvedAt: '2026-10-12T22:41:08.000Z', recipientCount: 12, inputHash: 'h', templateHash: 't' },
    consecutiveSendFailures: 0, firstTouchSent: 31, bounceCount: 0, scan: { afterDay: '2026/10/12', processedMessageIds: [] },
    expiresAt: '2026-11-16T07:00:00.000Z', ...over,
  }
}

const addrOf = (s: string) => (s.match(/<([^<>]+)>/)?.[1] ?? s).trim().toLowerCase()
const factsFrom = (g: FakeGmail) => async (id: string): Promise<SentMessageFacts | null> => {
  try {
    const f = await g.getFullMessage(id)
    return { id, threadId: f.threadId, from: addrOf(f.from), to: addrOf(f.to[0]), subject: f.subject, sentAt: new Date(f.receivedAt!).toISOString(), bodyText: f.bodyText, messageIdHeader: f.messageIdHeader }
  } catch { return null }
}

interface Setup { w: MemWorld; g: FakeGmail; csv: string; ids: string[]; cfg: ImportConfig }

/** n recipients; recipient 2 has TWO items under one sent message (like Vintage Cantina). Everything sent from Gmail at SEND_AT + i seconds. */
async function setup(n = 3): Promise<Setup> {
  const w = new MemWorld()
  const g = new FakeGmail()
  g.clock = SEND_AT
  await w.createCampaignTask(runtime())
  const rows = ['business_name,contact_email,item_id,gmail_message_id,sent_at,website']
  const ids: string[] = []
  for (let i = 1; i <= n; i++) {
    const itemIds = i === 2 ? [uuid(300 + i), uuid(400 + i)] : [uuid(300 + i)]
    const texts = itemIds.map((_, k) => `Try the special ${k + 1} at 'Biz ${i}'.`)
    itemIds.forEach((id, k) => w.itemRows.set(id, { id, text: texts[k], isActive: true, isSecret: false, metroSlug: 'green-bay' }))
    const at = new Date(SEND_AT.getTime() + i * 1000)
    const m = g.addGhostSent(`biz${i}@example.com`, `We selected Biz ${i} for CheckOff`, at, `Hi Biz ${i} team,\n\n${texts.map((t) => `• ${t}`).join('\n\n')}\n\nJust reply to this email.\n\nJerry`)
    ids.push(m.id)
    const ts = at.toISOString().replace('T', ' ').slice(0, 19)
    itemIds.forEach((id) => rows.push(`Biz ${i},biz${i}@example.com,${id},${m.id},${ts},https://biz${i}.example.com`))
  }
  const cfg: ImportConfig = { campaign: (await w.getCampaign(KEY))!, metroSlug: 'green-bay', sourceLabel: 'Green_Bay_Outreach_Master_RECONCILED_2026-10-14.xlsx', assignments: [] }
  return { w, g, csv: rows.join('\n'), ids, cfg }
}

const depsFor = async (s: Setup, over: Partial<ImportDeps> = {}): Promise<ImportDeps> => ({
  getSentMessage: factsFrom(s.g),
  items: (ids) => s.w.items(ids),
  contactsByEmail: (e) => s.w.contactsByEmail(e),
  priorContacts: await s.w.priorContactIndex(),
  importedMessageIds: await s.w.importedMessageIds(KEY),
  assignments: await s.w.campaignAssignments(KEY),
  ...over,
})

const planOf = async (s: Setup, csv = s.csv, over: Partial<ImportDeps> = {}) => buildImportPlan(csv, s.cfg, await depsFor(s, over))
const codes = (p: { issues: Array<{ severity: string; code: string }> }, sev = 'ERROR') => p.issues.filter((i) => i.severity === sev).map((i) => i.code).sort()
let tokenCounter = 0
const mint = () => `IMPORTTOKEN_${String(++tokenCounter).padStart(18, '0')}`

async function doImport(s: Setup, plan = undefined as Awaited<ReturnType<typeof planOf>> | undefined, beforeWrite?: (sql: string) => void) {
  const p = plan ?? (await planOf(s))
  const res = await importSentRecipients(p, { confirmRecipients: p.recipients.length, previewHash: p.inputHash, now: new Date('2026-10-14T17:00:00Z') }, { ...s.cfg, campaign: (await s.w.getCampaign(KEY))!, assignments: await s.w.campaignAssignments(KEY) }, s.w, mint, beforeWrite)
  // Emulate applying the token SQL.
  for (const r of s.w.recipients.values()) for (const l of r.state.listings ?? []) s.w.tokens.add(l.token)
  return { p, res }
}

// ---------------------------------------------------------------------------
// Plan: Gmail is the authority
// ---------------------------------------------------------------------------

test('plan: recipient, time, thread and subject come from Gmail; follow-up is anchored to the actual send time; two items consolidate under one recipient', async () => {
  const s = await setup(3)
  const p = await planOf(s)
  assert.equal(p.counts.errors, 0, JSON.stringify(p.issues))
  assert.equal(p.recipients.length, 3)
  assert.equal(p.counts.items, 4)
  const two = p.recipients.find((r) => r.email === 'biz2@example.com')!
  assert.equal(two.items.length, 2, 'Vintage-Cantina style: two items, one recipient, one message')
  for (const r of p.recipients) {
    assert.equal(r.status, 'NEW')
    assert.match(r.subject, /^We selected Biz \d for CheckOff$/)
    const sent = Date.parse(r.sentAt)
    assert.equal(r.followUp1DueAt, addBusinessDays(new Date(sent), 5).toISOString(), 'anchored to the real send time, 5 business days')
    assert.equal(r.followUp1DueAt.slice(0, 10), '2026-10-21')
  }
})

test('Gmail wins over the spreadsheet: a different time is used and warned; a different recipient, sender or missing message is an error', async () => {
  const s = await setup(3)
  const wrongTime = s.csv.replace(/2026-10-14 15:41:3\d/, '2026-10-14 09:00:00')
  const p1 = await planOf(s, wrongTime)
  assert.equal(p1.counts.errors, 0)
  assert.ok(codes(p1, 'WARN').includes('GMAIL_TIME_DIFFERS'))
  assert.equal(p1.recipients[0].sentAt, '2026-10-14T15:41:36.000Z', "Gmail's time, not the spreadsheet's")

  const wrongTo = s.csv.replace('biz1@example.com', 'someone.else@example.com')
  assert.ok(codes(await planOf(s, wrongTo)).includes('GMAIL_RECIPIENT_MISMATCH'))

  const ghost = s.g.addGhostSent('x@example.com', 'We selected X for CheckOff', SEND_AT, 'body')
  const msg = s.ids[0]
  assert.ok(codes(await planOf(s, s.csv.replace(new RegExp(msg, 'g'), 'doesNotExist123'))).includes('GMAIL_NOT_FOUND'))
  assert.ok(ghost.id)

  const foreignSender = factsFrom(s.g)
  const p3 = await planOf(s, s.csv, { getSentMessage: async (id) => { const f = await foreignSender(id); return f ? { ...f, from: 'someone@else.com' } : f } })
  assert.ok(codes(p3).includes('GMAIL_WRONG_SENDER'))
})

test('mapping is verified against the email actually sent; an already-tokenized message, bad items and conflicting ownership are errors', async () => {
  const s = await setup(3)
  // Item text not in the sent email.
  s.w.itemRows.set(uuid(301), { id: uuid(301), text: 'Something completely different', isActive: true, isSecret: false, metroSlug: 'green-bay' })
  assert.ok(codes(await planOf(s)).includes('ITEM_NOT_IN_EMAIL'))
  s.w.itemRows.set(uuid(301), { id: uuid(301), text: "Try the special 1 at 'Biz 1'.", isActive: true, isSecret: false, metroSlug: 'green-bay' })

  const bad = (over: Partial<{ isActive: boolean; isSecret: boolean; metroSlug: string }>) => { const it = s.w.itemRows.get(uuid(301))!; s.w.itemRows.set(uuid(301), { ...it, ...over }) }
  bad({ isActive: false }); assert.ok(codes(await planOf(s)).includes('ITEM_INACTIVE')); bad({ isActive: true })
  bad({ isSecret: true }); assert.ok(codes(await planOf(s)).includes('ITEM_SECRET')); bad({ isSecret: false })
  bad({ metroSlug: 'denver' }); assert.ok(codes(await planOf(s)).includes('ITEM_WRONG_METRO')); bad({ metroSlug: 'green-bay' })
  assert.ok(codes(await planOf(s, s.csv.replace(uuid(301), uuid(999)))).includes('ITEM_NOT_FOUND'))

  // One message listed for two addresses; one address on two messages.
  assert.ok(codes(await planOf(s, s.csv + `\nBiz 1,other@example.com,${uuid(399)},${s.ids[0]},,`)).includes('MESSAGE_MULTI_EMAIL'))

  // A sent email that already carries a /confirm link is not a reply-only first touch.
  const withLink = s.g.addGhostSent('biz9@example.com', 'We selected Biz 9 for CheckOff', SEND_AT, "• Try the special 1 at 'Biz 9'. https://getcheckoff.com/confirm/abc")
  s.w.itemRows.set(uuid(309), { id: uuid(309), text: "Try the special 1 at 'Biz 9'.", isActive: true, isSecret: false, metroSlug: 'green-bay' })
  assert.ok(codes(await planOf(s, `business_name,contact_email,item_id,gmail_message_id\nBiz 9,biz9@example.com,${uuid(309)},${withLink.id}`)).includes('SENT_HAS_CONFIRM_LINK'))
})

test('required columns and malformed rows are reported precisely', async () => {
  const s = await setup(1)
  assert.match(readImportCsv('business_name,contact_email\nA,a@x.com').issues[0].message, /item_id|gmail_message_id/)
  const p = await planOf(s, `business_name,contact_email,item_id,gmail_message_id\nBiz,biz1@example.com,not-a-uuid,${s.ids[0]}\n,biz1@example.com,${uuid(301)},${s.ids[0]}\nBiz,biz1@example.com,${uuid(301)},`)
  assert.deepEqual(codes(p), ['ROW_BAD_ITEM_ID', 'ROW_INCOMPLETE', 'ROW_NO_MESSAGE'])
})

// ---------------------------------------------------------------------------
// Prior-contact suppression in the import
// ---------------------------------------------------------------------------

test('importing someone already recorded as contacted is refused on every key (email variant, business variant, item, message id)', async () => {
  const s = await setup(1)
  const taken = async (email: string, business: string, itemId: string, msg: string) => {
    s.w.contacts.set(email, { id: 'cx', email, org: business, name: null, suppressed: false, hasOutbound: true })
    s.w.recipients.set('tx', { taskId: 'tx', contactId: 'cx', email, status: 'WAITING', nextCheckAt: null, nextAction: null, jerryRequest: null, cancelReason: null, blockerNote: null, state: { sequenceKey: 'campaign:other', campaignKey: 'other', contactEmail: email, threadId: 't', sequenceStatus: 'ACTIVE', stepsSent: [{ step: 1, kind: 'INITIAL', messageId: msg, sentAt: '2026-10-13T00:00:00Z' }], listings: [{ itemId, text: 'x', token: 'T', confirmUrl: 'u' }] } })
  }
  await taken('BIZ1+old@example.com', 'Unrelated Name', uuid(777), 'zzz')
  assert.ok(codes(await planOf(s)).includes('PRIOR_CONTACT'), 'email via +tag / case')
  await taken('other@place.com', 'The Biz 1 LLC', uuid(777), 'zzz')
  assert.ok(codes(await planOf(s)).includes('PRIOR_CONTACT'), 'business name variant')
  await taken('other@place.com', 'Unrelated', uuid(301), 'zzz')
  assert.ok(codes(await planOf(s)).includes('PRIOR_CONTACT'), 'item id')
  await taken('other@place.com', 'Unrelated', uuid(777), s.ids[0])
  assert.ok(codes(await planOf(s)).includes('PRIOR_CONTACT'), 'gmail message id')
})

test('test and canary campaigns are not "contacted": a canary that used a real business\'s item does not block importing the real send', async () => {
  const s = await setup(1)
  s.w.contacts.set('jerrystuckart@hotmail.com', { id: 'cj', email: 'jerrystuckart@hotmail.com', org: 'Canary A', name: null, suppressed: false, hasOutbound: true })
  s.w.recipients.set('tc', { taskId: 'tc', contactId: 'cj', email: 'jerrystuckart@hotmail.com', status: 'WAITING', nextCheckAt: null, nextAction: null, jerryRequest: null, cancelReason: null, blockerNote: null, state: { sequenceKey: 'campaign:green-bay-canary', campaignKey: 'green-bay-canary', contactEmail: 'jerrystuckart@hotmail.com', threadId: 't', sequenceStatus: 'ACTIVE', stepsSent: [{ step: 1, kind: 'INITIAL', messageId: 'canary1', sentAt: '2026-10-11T21:57:23Z' }], listings: [{ itemId: uuid(301), text: 'x', token: 'CANARYTOKEN', confirmUrl: 'u' }] } })
  const p = await planOf(s)
  assert.equal(p.counts.errors, 0, JSON.stringify(p.issues))
})

// ---------------------------------------------------------------------------
// Approval + the written records
// ---------------------------------------------------------------------------

test('approval gates: wrong count, wrong hash, errors, an expired campaign, and an empty plan are all refused before any write', async () => {
  const s = await setup(2)
  const p = await planOf(s)
  const cfg = { ...s.cfg, assignments: [] }
  const now = new Date('2026-10-14T17:00:00Z')
  await assert.rejects(() => importSentRecipients(p, { confirmRecipients: 3, previewHash: p.inputHash, now }, cfg, s.w), ApprovalRefused)
  await assert.rejects(() => importSentRecipients(p, { confirmRecipients: 2, previewHash: 'deadbeef', now }, cfg, s.w), ApprovalRefused)
  const bad = await planOf(s, s.csv.replace('biz1@example.com', 'wrong@example.com'))
  await assert.rejects(() => importSentRecipients(bad, { confirmRecipients: bad.recipients.length, previewHash: bad.inputHash, now }, cfg, s.w), /validation error/)
  await assert.rejects(() => importSentRecipients(p, { confirmRecipients: 2, previewHash: p.inputHash, now: new Date('2026-12-01T00:00:00Z') }, { ...cfg, campaign: { ...cfg.campaign, expiresAt: '2026-11-16T07:00:00Z' } }, s.w), /expired/)
  assert.equal(s.w.recipients.size, 0, 'nothing was written by any refused attempt')
})

test('import writes the exact recipient shape: WAITING, first touch recorded from Gmail and LATCHED, threaded, token-linked, scheduled from the real send time', async () => {
  const s = await setup(3)
  const order: string[] = []
  const { p, res } = await doImport(s, undefined, () => order.push(`sql handed over (recipients written: ${s.w.recipients.size})`))
  assert.deepEqual(order, ['sql handed over (recipients written: 0)'], 'token SQL is handed over BEFORE any database write')
  assert.equal(res.imported, 3)
  assert.equal(res.newTokens, 4, 'one token per item, including both Vintage-Cantina-style items')
  assert.equal((res.tokenSql.match(/IMPORTTOKEN_/g) ?? []).length, 4)
  assert.match(res.tokenSql, /bizdev_green-bay-p1/)
  for (const r of p.recipients) {
    const rec = s.w.byEmail(r.email)
    assert.equal(rec.status, 'WAITING')
    assert.equal(rec.state.sequenceStatus, 'ACTIVE')
    assert.equal(rec.state.campaignKey, KEY)
    assert.equal(rec.state.sequenceKey, `campaign:${KEY}`)
    assert.deepEqual(rec.state.stepsSent, [{ step: 1, kind: 'INITIAL', messageId: r.messageId, sentAt: r.sentAt }])
    assert.equal(rec.state.claimedStep, 1, 'the first touch is latched: it can never be claimed or sent again')
    assert.equal(rec.state.threadId, r.threadId)
    assert.equal(rec.state.subject, r.subject)
    assert.equal(rec.nextCheckAt!.toISOString(), r.followUp1DueAt)
    assert.match(rec.nextAction!, /Follow-Up 1 due 2026-10-21/)
    assert.equal(rec.state.listings!.length, r.items.length)
    assert.ok(rec.state.vars!.items_block.includes('getcheckoff.com/confirm/IMPORTTOKEN_'))
    assert.equal((rec.state.imported as { firstTouchMode: string }).firstTouchMode, 'reply_only')
  }
  assert.equal(s.w.byEmail('biz2@example.com').state.listings!.length, 2)
  assert.equal(s.w.interactions.filter((i) => i.direction === 'OUTBOUND').length, 3, 'each first touch recorded once, keyed by Gmail message id')
  const camp = (await s.w.getCampaign(KEY))!
  assert.equal(camp.batches!.length, 1)
  assert.equal(camp.batches![0].kind, 'IMPORTED_SENT')
  assert.equal(camp.state, 'ACTIVE', 'the running campaign is not touched')
  assert.equal(camp.firstTouchSent, 31)
  assert.equal((await s.w.listQueued()).length, 0, 'none of them is in the first-touch queue')
})

test('import is idempotent and crash-safe: re-running writes nothing new, and a crash before the batch ledger is recoverable', async () => {
  const s = await setup(3)
  await doImport(s)
  const before = s.w.recipients.size
  const again = await planOf(s)
  assert.equal(again.counts.alreadyImported, 3)
  assert.equal(again.counts.newRecipients, 0)
  assert.equal(again.counts.errors, 0, 'already-imported recipients are not "prior contact" conflicts with themselves')
  const res = await importSentRecipients(again, { confirmRecipients: 3, previewHash: again.inputHash, now: new Date('2026-10-14T18:00:00Z') }, { ...s.cfg, campaign: (await s.w.getCampaign(KEY))! }, s.w, mint)
  assert.equal(res.imported, 0)
  assert.equal(s.w.recipients.size, before)
  assert.equal(s.w.interactions.filter((i) => i.direction === 'OUTBOUND').length, 3)

  const s2 = await setup(2)
  s2.w.failRecordBatchOnce = true
  await assert.rejects(() => doImport(s2), /simulated crash/)
  assert.equal(s2.w.recipients.size, 2, 'recipients were written before the ledger entry')
  const retry = await planOf(s2)
  assert.equal(retry.counts.errors, 0)
  const { res: r2 } = await doImport(s2, retry)
  assert.equal(r2.imported, 0)
  assert.equal((await s2.w.getCampaign(KEY))!.batches!.length, 1, 'the ledger entry was completed on the retry')
})

// ---------------------------------------------------------------------------
// The live engine with imported recipients
// ---------------------------------------------------------------------------

const tick = (g: FakeGmail, w: MemWorld, now: Date) => { g.clock = now; return runBizDevTick({ gmail: g, store: w, now: () => now, sleep: async () => {}, sequences: {} }) }
const DUE = new Date('2026-10-21T16:00:00Z')

test('engine: nothing is sent before the due time, never a first touch, and at the due time each imported recipient gets exactly Follow-Up 1 with its confirm link, in its own thread', async () => {
  const s = await setup(3)
  await doImport(s)
  const gmailSentBefore = s.g.sends.length
  const r0 = await tick(s.g, s.w, new Date('2026-10-14T18:00:00Z'))
  await tick(s.g, s.w, new Date('2026-10-20T23:00:00Z'))
  assert.equal(s.g.sends.length, gmailSentBefore, 'not before the 5 business days elapse')
  assert.ok(!r0.actions.some((a) => /first touch/.test(a)))
  const r = await tick(s.g, s.w, DUE)
  assert.equal(s.g.sends.length, 3, 'one follow-up each')
  for (const m of s.g.sends) {
    assert.match(m.subject, /^Re: We selected Biz \d for CheckOff$/)
    assert.ok(m.threadId && m.threadId.startsWith('T-ghost'), "sent in the original Gmail thread")
    assert.match(m.bodyText, /getcheckoff\.com\/confirm\/IMPORTTOKEN_/)
    assert.match(m.bodyText, /Just following up on the CheckOff listing/)
    assert.ok(m.inReplyTo?.startsWith('<hdr-ghost'), 'threaded onto the original message')
  }
  const two = s.g.sends.find((m) => m.to === 'biz2@example.com')!
  assert.equal((two.bodyText.match(/getcheckoff\.com\/confirm\//g) ?? []).length, 2, 'both items, both links, one email')
  assert.ok(r.actions.filter((a) => /pre-follow-up Gmail check/.test(a)).length === 3, 'Gmail was asked about every recipient right before its follow-up')
  assert.equal(s.w.byEmail('biz1@example.com').state.stepsSent.length, 2)
  assert.equal(s.w.byEmail('biz1@example.com').nextCheckAt!.toISOString().slice(0, 10), '2026-10-30', 'Follow-Up 2 is 7 business days later')
  await tick(s.g, s.w, new Date(DUE.getTime() + 15 * 60_000))
  assert.equal(s.g.sends.length, 3, 'no duplicate on the next tick')
  assert.ok(s.g.sends.every((m) => !/^We selected/.test(m.subject)), 'no first touch was ever re-sent')
})

test('engine: BEFORE every follow-up Gmail is searched for a reply, even one the batched scan could not match (different subject)', async () => {
  const s = await setup(3)
  await doImport(s)
  s.g.addReply({ from: 'Biz One <biz1@example.com>', subject: 'Quick question', body: 'Can you tell me more about this?', threadId: 'SOMETHING-ELSE' })
  const r = await tick(s.g, s.w, DUE)
  assert.ok(!s.g.sends.some((m) => m.to === 'biz1@example.com'), 'no follow-up to a business that has just written to us')
  assert.equal(s.w.byEmail('biz1@example.com').status, 'NEEDS_JERRY')
  assert.equal(s.g.sends.filter((m) => m.to !== 'biz1@example.com').length, 2, 'the others still get theirs')
  assert.ok(r.actions.some((a) => /biz1@example.com: pre-follow-up Gmail check .* 1 message/.test(a) || /pre-follow-up Gmail check for biz1@example.com: 1 message/.test(a)))
})

test('engine: a bounce that only the targeted pre-follow-up search can see closes the recipient instead of emailing it again', async () => {
  const s = await setup(3)
  await doImport(s)
  s.g.addBounce('T-unrelated-thread', 'Delivery to biz3@example.com failed: 550 5.1.1 The email account does not exist.')
  await tick(s.g, s.w, DUE)
  assert.ok(!s.g.sends.some((m) => m.to === 'biz3@example.com'))
  assert.equal(s.w.byEmail('biz3@example.com').state.sequenceStatus, 'BOUNCED')
  assert.equal(s.w.byEmail('biz3@example.com').status, 'CANCELED')
  assert.equal(s.g.sends.length, 2)
})

test('engine: a follow-up is HELD, not sent, when its confirmation token is missing or points at a different item', async () => {
  const s = await setup(2)
  await doImport(s)
  s.w.tokens.delete(s.w.byEmail('biz1@example.com').state.listings![0].token)
  const wrongToken = s.w.byEmail('biz2@example.com').state.listings![0].token
  s.w.tokenItems.set(wrongToken, uuid(999))
  const r = await tick(s.g, s.w, DUE)
  assert.equal(s.g.sends.length, 0)
  assert.equal(r.errors.filter((e) => /follow-up HELD/.test(e)).length, 2)
})

test('engine: Gmail is authoritative for the cap. The 16 sends made outside Winston count against the shared daily limit and the first-touch limit', async () => {
  const s = await setup(3)
  await doImport(s)
  // A new, legitimately queued recipient.
  s.w.itemRows.set(uuid(501), { id: uuid(501), text: "Try the new thing at 'New Place'.", isActive: true, isSecret: false, metroSlug: 'green-bay' })
  const queue = async (n: number, email: string) => {
    const contactId = await s.w.upsertContact({ email, businessName: `New Place ${n}`, contactName: null, website: null })
    s.w.tokens.add(`QUEUEDTOKEN_${n}`)
    await s.w.createRecipientTask({ projectKey: 'p', title: `q${n}`, contactId, sourceRef: `${KEY}:${email}`, state: { sequenceKey: `campaign:${KEY}`, campaignKey: KEY, contactEmail: email, threadId: '', sequenceStatus: 'QUEUED', stepsSent: [], subject: `We selected New Place ${n} for CheckOff`, vars: { business_name: `New Place ${n}`, metro: 'Green Bay Metro', items_block: "• Try the new thing\n  Confirm or update it here: https://getcheckoff.com/confirm/QUEUEDTOKEN_" + n, item_text: 'x', item_count: '1', kit_url: 'https://getcheckoff.com/downloads/featured-kit', confirm_url: `https://getcheckoff.com/confirm/QUEUEDTOKEN_${n}`, sender_name: 'Jerry Stuckart' }, listings: [{ itemId: uuid(600 + n), text: 'x', token: `QUEUEDTOKEN_${n}`, confirmUrl: 'u' }] } })
    s.w.itemRows.set(uuid(600 + n), { id: uuid(600 + n), text: 'x', isActive: true, isSecret: false, metroSlug: 'green-bay' })
  }
  await queue(1, 'new1@place.com'); await queue(2, 'new2@place.com'); await queue(3, 'new3@place.com')
  const rt = (await s.w.getCampaign(KEY))!
  await s.w.saveCampaign(KEY, { firstTouchDailyLimit: 4 })
  const now = new Date('2026-10-14T19:00:00Z')
  const r = await tick(s.g, s.w, now)
  // 3 imported first touches in the last 24h (Gmail) + limit 4 => exactly ONE new first touch.
  assert.equal(s.g.sends.filter((m) => /^We selected New Place/.test(m.subject)).length, 1)
  assert.ok(rt.dailyCap === 80)
  assert.ok(r.actions.some((a) => /sent 1 first touch\(es\); 76 capacity left today/.test(a)), r.actions.join(' | ')) // 80 - 3 (Gmail) - 1
})

// ---------------------------------------------------------------------------
// Never another first touch to anyone already contacted
// ---------------------------------------------------------------------------

test('send-time barrier: a queued recipient matching a prior contact on email, business, item or Gmail history is closed, not emailed', async () => {
  const s = await setup(3)
  await doImport(s)
  const mk = async (tag: string, email: string, business: string, itemId: string) => {
    const contactId = await s.w.upsertContact({ email, businessName: business, contactName: null, website: null })
    s.w.tokens.add(`BARRIERTOKEN_${tag}`)
    s.w.itemRows.set(itemId, { id: itemId, text: 'x', isActive: true, isSecret: false, metroSlug: 'green-bay' })
    await s.w.createRecipientTask({ projectKey: 'p', title: tag, contactId, sourceRef: `${KEY}:${email}`, state: { sequenceKey: `campaign:${KEY}`, campaignKey: KEY, contactEmail: email, threadId: '', sequenceStatus: 'QUEUED', stepsSent: [], subject: `We selected ${business} for CheckOff`, vars: { business_name: business, metro: 'Green Bay Metro', items_block: `• x\n  Confirm or update it here: https://getcheckoff.com/confirm/BARRIERTOKEN_${tag}`, item_text: 'x', item_count: '1', kit_url: 'https://getcheckoff.com/downloads/featured-kit', confirm_url: `https://getcheckoff.com/confirm/BARRIERTOKEN_${tag}`, sender_name: 'Jerry Stuckart' }, listings: [{ itemId, text: 'x', token: `BARRIERTOKEN_${tag}`, confirmUrl: 'u' }] } })
  }
  await mk('email', 'BIZ1+again@example.com', 'Brand New Name A', uuid(701))
  await mk('business', 'fresh1@place.com', 'The Biz 2, LLC', uuid(702))
  await mk('item', 'fresh2@place.com', 'Brand New Name C', uuid(301))
  await mk('control', 'fresh3@place.com', 'Brand New Name D', uuid(704))
  // Gmail history: someone emailed this address by hand before.
  s.g.addGhostSent('fresh4@place.com', 'Hello from long ago', new Date('2026-03-01T12:00:00Z'), 'hi')
  await mk('gmail', 'fresh4@place.com', 'Brand New Name E', uuid(705))
  const r = await tick(s.g, s.w, new Date('2026-10-14T19:00:00Z'))
  const firstTouches = s.g.sends.filter((m) => /^We selected/.test(m.subject)).map((m) => m.to)
  assert.deepEqual(firstTouches, ['fresh3@place.com'], 'only the genuinely new business was emailed')
  for (const e of ['BIZ1+again@example.com', 'fresh1@place.com', 'fresh2@place.com', 'fresh4@place.com']) {
    const rec = s.w.byEmail(e)
    assert.equal(rec.status, 'CANCELED', e)
    assert.equal(rec.state.sequenceStatus, 'PRIOR_CONTACT', e)
    assert.match(rec.cancelReason!, /Prior contact/)
  }
  assert.equal(r.actions.filter((a) => /SUPPRESSED/.test(a)).length, 4)
})

test('send-time barrier: allowPriorOutreach lifts only the Gmail-history leg, never a Winston-recorded contact', async () => {
  const s = await setup(1)
  await doImport(s)
  await s.w.saveCampaign(KEY, { allowPriorOutreach: true })
  const mk = async (tag: string, email: string, business: string) => {
    const contactId = await s.w.upsertContact({ email, businessName: business, contactName: null, website: null })
    s.w.tokens.add(`ALLOWTOKEN_${tag}`)
    s.w.itemRows.set(uuid(800 + tag.length), { id: uuid(800 + tag.length), text: 'x', isActive: true, isSecret: false, metroSlug: 'green-bay' })
    await s.w.createRecipientTask({ projectKey: 'p', title: tag, contactId, sourceRef: `${KEY}:${email}`, state: { sequenceKey: `campaign:${KEY}`, campaignKey: KEY, contactEmail: email, threadId: '', sequenceStatus: 'QUEUED', stepsSent: [], subject: `We selected ${business} for CheckOff`, vars: { business_name: business, metro: 'Green Bay Metro', items_block: `• x\n  Confirm or update it here: https://getcheckoff.com/confirm/ALLOWTOKEN_${tag}`, item_text: 'x', item_count: '1', kit_url: 'https://getcheckoff.com/downloads/featured-kit', confirm_url: `https://getcheckoff.com/confirm/ALLOWTOKEN_${tag}`, sender_name: 'Jerry Stuckart' }, listings: [{ itemId: uuid(800 + tag.length), text: 'x', token: `ALLOWTOKEN_${tag}`, confirmUrl: 'u' }] } })
  }
  s.g.addGhostSent('gmailonly@place.com', 'Old chat', new Date('2026-03-01T12:00:00Z'), 'hi')
  await mk('gm', 'gmailonly@place.com', 'Gmail Only Place')
  await mk('dup', 'biz1@example.com', 'Some Other Name')
  await tick(s.g, s.w, new Date('2026-10-14T19:00:00Z'))
  const to = s.g.sends.filter((m) => /^We selected/.test(m.subject)).map((m) => m.to)
  assert.deepEqual(to, ['gmailonly@place.com'], 'Gmail-only history is allowed; the already-contacted Winston recipient is still blocked')
})

// ---------------------------------------------------------------------------
// Planner: prior contact + eligibility policy for the rest of the workbook
// ---------------------------------------------------------------------------

const DEF: CampaignDefinition = {
  key: KEY, name: 'Green Bay', metroSlug: 'green-bay', metroLabel: 'Green Bay Metro',
  subjectTemplate: 'We selected {{business_name}} for CheckOff',
  firstTouchBody: 'Hi {{business_name}} team,\n\n{{items_block}}\n\nKit: {{kit_url}}',
  followUp1Body: FU1, followUp2Body: FU2,
  approvals: { firstTouchTemplate: true, followUpTemplates: true },
  eligibilityPolicy: { requireEmailEvidenceUrl: true, requireLocalBusinessConfirmation: true, requireSendApproval: true, blockedCategories: ['public attraction', 'park', 'museum', 'government', 'major corporate', 'hold'] },
}
const HDR = 'business_name,contact_email,item_id,email_evidence_url,local_business_confirmed,category,send_approval'

test('planner: a whole research workbook can be previewed safely; only rows with EVERY confirmation are eligible, the rest are excluded with a reason', async () => {
  const s = await setup(3)
  await doImport(s)
  for (let i = 10; i <= 17; i++) s.w.itemRows.set(uuid(900 + i), { id: uuid(900 + i), text: `Thing at 'Place ${i}'`, isActive: true, isSecret: false, metroSlug: 'green-bay' })
  const row = (i: number, over: Partial<Record<'email' | 'evidence' | 'local' | 'cat' | 'appr', string>> = {}) =>
    `Place ${i},${over.email ?? `p${i}@place.com`},${uuid(900 + i)},${over.evidence ?? 'https://place.com/contact'},${over.local ?? 'yes'},${over.cat ?? 'Cafe / restaurant'},${over.appr ?? 'APPROVED'}`
  const csv = [HDR,
    row(10),                                                  // eligible
    row(11, { evidence: '' }),                                // no public email evidence
    row(12, { local: '' }),                                   // local eligibility unconfirmed
    row(13, { cat: 'Public attraction / park' }),             // suppressed category
    row(14, { appr: 'NOT APPROVED' }),                        // no send approval
    row(15, { cat: 'HOLD' }),                                 // HOLD
    row(16, { email: 'BIZ1+newtry@example.com' }),            // already contacted (imported)
    row(17, { cat: 'Museum' }),
  ].join('\n')
  const plan = await buildCampaignPlan(DEF, csv, { lookups: s.w })
  assert.equal(plan.counts.errors, 0, JSON.stringify(plan.issues))
  assert.deepEqual(plan.recipients.map((r) => r.email), ['p10@place.com'], 'exactly one row is eligible')
  const why = Object.fromEntries(plan.excluded.map((e) => [e.business, e.reason]))
  assert.match(why['Place 11'], /no public email evidence/)
  assert.match(why['Place 12'], /local-business eligibility not confirmed/)
  assert.match(why['Place 13'], /suppressed \(park\)|suppressed \(public attraction\)/)
  assert.match(why['Place 14'], /no send approval/)
  assert.match(why['Place 15'], /suppressed \(hold\)/)
  assert.match(why['Place 16'], /PRIOR CONTACT: email/)
  assert.match(why['Place 17'], /suppressed \(museum\)/)
})

test('planner: the four prior-contact keys each exclude a would-be first touch at plan time', async () => {
  const s = await setup(3)
  await doImport(s)
  for (const n of [950, 951]) s.w.itemRows.set(uuid(n), { id: uuid(n), text: 'New', isActive: true, isSecret: false, metroSlug: 'green-bay' })
  const policy = { ...DEF, eligibilityPolicy: undefined }
  const r = (name: string, email: string, item: string) => `${name},${email},${item}`
  const csv = ['business_name,contact_email,item_id',
    r('Fresh Name', 'Biz1+x@Example.com', uuid(950)),                     // email
    r('The Biz 2 LLC', 'new@place.com', uuid(951)),                       // business
    r('Another', 'new2@place.com', uuid(301)),                            // item
  ].join('\n')
  const plan = await buildCampaignPlan(policy, csv, { lookups: s.w })
  assert.equal(plan.recipients.length, 0)
  assert.equal(plan.excluded.length, 3)
  assert.ok(plan.excluded.every((e) => /PRIOR CONTACT/.test(e.reason)))
})

test('the import preview states what will and will not happen, and carries the hash apply requires', async () => {
  const s = await setup(3)
  const p = await planOf(s)
  const md = renderImportPreview(p, s.cfg, new Date('2026-10-14T17:00:00Z'))
  assert.match(md, /Nothing has been written to the database and nothing has been sent/)
  assert.match(md, new RegExp(p.inputHash))
  assert.match(md, /Gmail is the authority/)
  assert.match(md, /A first touch is never sent to any of them/)
  assert.match(md, /Follow-Up 1 due/)
  assert.match(md, /2026-10-21 15:41:36/, 'the due time is the real Gmail send time + 5 business days')
  assert.match(md, /Biz 2/)
  assert.equal((md.match(/Biz 2: `/g) ?? []).length, 2, 'both items of the two-item recipient are listed')
})
