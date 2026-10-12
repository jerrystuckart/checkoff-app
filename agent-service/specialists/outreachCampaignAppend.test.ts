import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBizDevTick } from './bizDevOutreach'
import { buildCampaignPlan, approveCampaign, ApprovalRefused, isTestTokenCampaign, TEST_TOKEN_CAMPAIGN_PATTERN, type CampaignDefinition } from './outreachCampaign'
import { FakeGmail, MemWorld, uuid } from './outreachTestKit'

// Appending approved batches to an already-active campaign. FakeGmail + MemWorld only: no network, no database, no real email.

const MON = new Date('2026-10-12T15:00:00Z')
const DEF: CampaignDefinition = {
  key: 'gb-append',
  name: 'Green Bay APPEND TEST',
  metroSlug: 'green-bay',
  metroLabel: 'Green Bay Metro',
  subjectTemplate: 'We selected {{business_name}} for CheckOff',
  firstTouchBody: 'Hi {{business_name}} team,\n\nWe selected you for CheckOff {{metro}}:\n\n{{items_block}}\n\nFree graphics: {{kit_url}}\n\nYou can also just reply to this email.\n\nJerry',
  followUp1Body: 'Hi {{business_name}} team,\n\nQuick follow-up.\n\n{{items_block}}\n\nJerry',
  followUp2Body: 'Last note for {{business_name}}: {{confirm_url}}\n\nJerry',
  approvals: { firstTouchTemplate: true, followUpTemplates: true },
}

const email = (i: number) => `biz${i}@example.com`
let tokenSeq = 0
const mintFor = (tag: string) => () => `${tag}_${String(++tokenSeq).padStart(24, '0')}`

function world(n: number) {
  const w = new MemWorld()
  for (let i = 1; i <= n; i++) w.itemRows.set(uuid(100 + i), { id: uuid(100 + i), text: `Try the special at 'Biz ${i}'`, isActive: true, isSecret: false, metroSlug: 'green-bay' })
  return w
}
const csvOf = (...ids: number[]) => ['business_name,contact_email,item_id', ...ids.map((i) => `Biz ${i},${email(i)},${uuid(100 + i)}`)].join('\n')
const approve = (w: MemWorld, plan: Awaited<ReturnType<typeof buildCampaignPlan>>, mint = mintFor('TOK'), now = MON) =>
  approveCampaign(plan, { confirmRecipients: plan.recipients.length, previewHash: plan.inputHash, templatesApproved: true, now }, w, mint)
const applyTokens = (w: MemWorld, only?: string[]) => { for (const r of w.recipients.values()) for (const l of r.state.listings ?? []) if (!only || only.includes(r.email)) w.tokens.add(l.token) }
const tick = (g: FakeGmail, w: MemWorld) => { g.clock = MON; return runBizDevTick({ gmail: g, store: w, now: () => MON, sleep: async () => {} }) }

/** Batch 1 approved, tokens applied, activated and SENT, exactly like the real Green Bay campaign. */
async function liveCampaign(n1 = 3, total = 9) {
  const w = world(total)
  const g = new FakeGmail()
  const plan1 = await buildCampaignPlan(DEF, csvOf(...Array.from({ length: n1 }, (_, i) => i + 1)), { lookups: w })
  assert.equal(plan1.counts.errors, 0, JSON.stringify(plan1.issues))
  await approve(w, plan1)
  applyTokens(w)
  await w.saveCampaign(DEF.key, { state: 'ACTIVE' })
  await tick(g, w)
  assert.equal(g.sends.length, n1)
  return { w, g }
}
const planFor = (w: MemWorld, ...ids: number[]) => buildCampaignPlan(DEF, csvOf(...ids), { lookups: w })
const snapshotCampaign = (w: MemWorld) => { const { batches: _b, ...rest } = w.runtimes.get(DEF.key)!; return JSON.parse(JSON.stringify(rest)) }
const snapshotRecipients = (w: MemWorld, ...ids: number[]) => JSON.parse(JSON.stringify(ids.map((i) => [...w.recipients.values()].find((r) => r.email === email(i))!)))

test('append to an ACTIVE campaign: only the approved recipients are added; status, counters, schedule and earlier history are untouched', async () => {
  const { w, g } = await liveCampaign()
  const campaignBefore = snapshotCampaign(w)
  const oldBefore = snapshotRecipients(w, 1, 2, 3)
  // The batch-2 CSV still lists the first three (already sent): the plan must exclude them and append only 4-6.
  const plan2 = await planFor(w, 1, 2, 3, 4, 5, 6)
  assert.deepEqual(plan2.recipients.map((r) => r.email).sort(), [email(4), email(5), email(6)])
  const res = await approve(w, plan2)
  assert.equal(res.appended, true)
  assert.equal(res.recipientsQueued, 3)
  assert.equal(w.runtimes.size, 1, 'no second campaign record')
  assert.deepEqual(snapshotCampaign(w), campaignBefore, 'state, counters, schedule, scan cursor and approval are exactly as they were')
  assert.equal(w.runtimes.get(DEF.key)!.batches!.length, 2)
  assert.deepEqual(w.runtimes.get(DEF.key)!.batches![1].recipients.sort(), [email(4), email(5), email(6)])
  assert.deepEqual(snapshotRecipients(w, 1, 2, 3), oldBefore, 'earlier recipients are byte-for-byte unchanged')
  assert.equal(w.runtimes.get(DEF.key)!.state, 'ACTIVE')
  // Not sendable until the token SQL is applied; nothing already sent is re-sent.
  const held = await tick(g, w)
  assert.equal(g.sends.length, 3)
  assert.ok(held.actions.some((a) => /3 queued recipient\(s\) held/.test(a)))
  applyTokens(w)
  await tick(g, w)
  assert.equal(g.sends.length, 6)
  assert.deepEqual(g.sends.slice(3).map((s) => s.to).sort(), [email(4), email(5), email(6)])
  assert.equal(w.runtimes.get(DEF.key)!.firstTouchSent, 6)
})

test('append never changes a PAUSED campaign, and is refused for COMPLETE, expired, or changed-template campaigns', async () => {
  const { w } = await liveCampaign()
  await w.saveCampaign(DEF.key, { state: 'PAUSED', pauseReason: 'Paused by Jerry' })
  await approve(w, await planFor(w, 4))
  assert.equal(w.runtimes.get(DEF.key)!.state, 'PAUSED', 'appending does not resume a paused campaign')
  assert.equal(w.runtimes.get(DEF.key)!.pauseReason, 'Paused by Jerry')

  const changed = await buildCampaignPlan({ ...DEF, followUp2Body: 'Different last note for {{business_name}}: {{confirm_url}}' }, csvOf(5), { lookups: w })
  await assert.rejects(() => approve(w, changed), /templates\/cadence differ/)
  assert.equal([...w.recipients.values()].some((r) => r.email === email(5)), false, 'nothing was written')

  await w.saveCampaign(DEF.key, { state: 'COMPLETE' })
  await assert.rejects(async () => approve(w, await planFor(w, 6)), /COMPLETE/)
  const expiring = await liveCampaign()
  await expiring.w.saveCampaign(DEF.key, { expiresAt: '2026-10-12T00:00:00.000Z' })
  await assert.rejects(async () => approve(expiring.w, await planFor(expiring.w, 4)), /expired/)
})

test('only the exact approved preview is appended: a stale hash or wrong count writes nothing', async () => {
  const { w } = await liveCampaign()
  const plan = await planFor(w, 4, 5)
  const before = w.recipients.size
  await assert.rejects(() => approveCampaign(plan, { confirmRecipients: 2, previewHash: 'deadbeefdeadbeef', templatesApproved: true, now: MON }, w), ApprovalRefused)
  await assert.rejects(() => approveCampaign(plan, { confirmRecipients: 3, previewHash: plan.inputHash, templatesApproved: true, now: MON }, w), ApprovalRefused)
  assert.equal(w.recipients.size, before)
  assert.equal(w.runtimes.get(DEF.key)!.batches!.length, 1)
})

test('duplicates are refused: existing recipient, an item already assigned to someone else, and a reused or doubly-minted token', async () => {
  const { w } = await liveCampaign()
  // 1. A recipient already in the campaign is excluded by the plan, so a CSV containing only them yields nothing to approve.
  const dupe = await planFor(w, 1)
  assert.equal(dupe.recipients.length, 0)
  await assert.rejects(() => approveCampaign(dupe, { confirmRecipients: 0, previewHash: dupe.inputHash, templatesApproved: true, now: MON }, w), /no recipients/)
  // 2. A DIFFERENT address for an item that already belongs to biz1.
  const other = await buildCampaignPlan(DEF, ['business_name,contact_email,item_id', `Biz 1 again,other@example.com,${uuid(101)}`].join('\n'), { lookups: w })
  assert.equal(other.recipients.length, 1)
  await assert.rejects(() => approve(w, other), /already belongs to biz1@example\.com/)
  assert.equal([...w.recipients.values()].some((r) => r.email === 'other@example.com'), false)
  // 3. A minted token equal to one already assigned to a different item.
  const reuse = Array.from(w.recipients.values())[0].state.listings![0].token
  await assert.rejects(async () => approve(w, await planFor(w, 4), () => reuse), /already assigned to a different item/)
  // 4. The same token minted twice in one batch.
  await assert.rejects(async () => approve(w, await planFor(w, 5, 6), () => 'SAMETOKEN_' + 'x'.repeat(22)), /minted twice/)
  assert.equal(w.recipients.size, 3, 'every refusal happened before any write')
})

test('repeated approval is idempotent: no duplicate recipients, tasks, tokens or ledger entries', async () => {
  const { w } = await liveCampaign()
  const plan = await planFor(w, 4, 5)
  const first = await approve(w, plan, mintFor('A'))
  // The same plan is approved again (operator retry, or a double click) - never-sent recipients are refreshed in place.
  const replan = await planFor(w, 4, 5)
  assert.equal(replan.recipients.length, 2, 'queued-but-unsent recipients are re-approvable')
  const second = await approve(w, replan, mintFor('B'))
  assert.equal(second.recipientsQueued, 0)
  assert.equal(second.recipientsAlreadyPresent, 2)
  assert.equal(w.recipients.size, 5)
  assert.equal(w.runtimes.get(DEF.key)!.batches!.length, 2, 'one ledger entry per distinct approved preview')
  const stored = [...w.recipients.values()].filter((r) => [email(4), email(5)].includes(r.email)).flatMap((r) => r.state.listings!.map((l) => l.token)).sort()
  const inSql = [...second.tokenSql.matchAll(/B_\d+/g)].map((m) => m[0]).sort()
  assert.deepEqual(stored, inSql, 'the SQL of the latest run matches exactly what is stored')
  assert.equal(first.appended && second.appended, true)
})

test('token insertion failure: unfinished recipients are held individually; ready ones still send; a wrong-item token is never used', async () => {
  const { w, g } = await liveCampaign()
  await approve(w, await planFor(w, 4, 5, 6))
  // The SQL partly failed / was only partly applied: only biz4's token exists.
  applyTokens(w, [email(4)])
  const r = await tick(g, w)
  assert.deepEqual(g.sends.slice(3).map((s) => s.to), [email(4)], 'the ready recipient is not blocked by the others')
  assert.ok(r.actions.some((a) => /2 queued recipient\(s\) held/.test(a)))
  // A token row that exists but points at a DIFFERENT item must never be used.
  const t5 = [...w.recipients.values()].find((x) => x.email === email(5))!.state.listings![0].token
  w.tokens.add(t5)
  w.tokenItems.set(t5, uuid(999))
  const bad = await tick(g, w)
  assert.equal(g.sends.length, 4, 'wrong-item token: not sent')
  assert.ok(bad.errors.some((e) => /different item/.test(e) && e.includes(email(5))))
  // Recovery: the row is corrected and the last token arrives.
  w.tokenItems.delete(t5)
  applyTokens(w)
  await tick(g, w)
  assert.deepEqual(g.sends.slice(3).map((s) => s.to).sort(), [email(4), email(5), email(6)])
  assert.equal(g.sends.filter((s) => s.to === email(4)).length, 1, 'never re-sent')
})

test('recovery after a partial approval: a crash mid-recipients or before the ledger write leaves the campaign untouched and a retry converges', async () => {
  const { w, g } = await liveCampaign()
  const campaignBefore = snapshotCampaign(w)
  const plan = await planFor(w, 4, 5, 6)
  // Crash while writing the 2nd of 3 recipients.
  w.crashOnRecipientWrite = 2
  await assert.rejects(() => approve(w, plan, mintFor('R1')), /simulated crash while writing recipients/)
  assert.deepEqual(snapshotCampaign(w), campaignBefore, 'campaign record untouched')
  assert.equal(w.runtimes.get(DEF.key)!.batches!.length, 1, 'no ledger entry for an unfinished approval')
  assert.equal(w.recipients.size, 4, 'one recipient was written before the crash')
  // The half-written recipient has no token row, so it cannot send; the campaign keeps working.
  await tick(g, w)
  assert.equal(g.sends.length, 3)
  // Retry: the plan includes the half-written recipient (never sent), and the retry completes everything.
  const replan = await planFor(w, 4, 5, 6)
  assert.equal(replan.recipients.length, 3)
  const res = await approve(w, replan, mintFor('R2'))
  assert.equal(res.recipientsQueued, 2)
  assert.equal(res.recipientsAlreadyPresent, 1)
  assert.equal(w.recipients.size, 6)
  const stored = [...w.recipients.values()].filter((r) => [4, 5, 6].map(email).includes(r.email)).flatMap((r) => r.state.listings!.map((l) => l.token)).sort()
  assert.deepEqual(stored, [...res.tokenSql.matchAll(/R2_\d+/g)].map((m) => m[0]).sort(), 'every stored token is in the new SQL; the aborted run\'s tokens are gone')
  // Crash at the very last step (ledger write): recipients exist, a retry records the batch exactly once.
  const plan3 = await planFor(w, 7)
  w.failRecordBatchOnce = true
  await assert.rejects(() => approve(w, plan3, mintFor('R3')), /before the batch was recorded/)
  assert.equal(w.runtimes.get(DEF.key)!.batches!.length, 2)
  await approve(w, await planFor(w, 7), mintFor('R4'))
  assert.equal(w.runtimes.get(DEF.key)!.batches!.length, 3)
  assert.equal([...w.recipients.values()].filter((r) => r.email === email(7)).length, 1)
  // And after all of that: once every token exists, exactly the new recipients are sent, once each.
  applyTokens(w)
  await tick(g, w)
  assert.deepEqual(g.sends.slice(3).map((s) => s.to).sort(), [4, 5, 6, 7].map(email))
})

test('a fresh campaign still behaves as before: created last, with a one-entry ledger', async () => {
  const w = world(2)
  const res = await approve(w, await planFor(w, 1, 2))
  assert.equal(res.appended, false)
  assert.equal(w.runtimes.get(DEF.key)!.batches!.length, 1)
  assert.equal(w.runtimes.get(DEF.key)!.state, 'APPROVED')
})

test('test and canary token campaigns are retired from planning; production campaigns are not', () => {
  for (const t of ['bizdev_green-bay-p1-test', 'bizdev_green-bay-canary', 'bizdev_denver-test']) assert.equal(isTestTokenCampaign(t), true, t)
  for (const t of ['bizdev_green-bay-p1', 'bizdev_green-bay-2026-10', 'bizdev_testing-grounds-launch', null, undefined, '']) assert.equal(isTestTokenCampaign(t), false, String(t))
  assert.equal(new RegExp(TEST_TOKEN_CAMPAIGN_PATTERN).test('bizdev_x-test'), true, 'the exact string passed to SQL behaves the same way')
})
