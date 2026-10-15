import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBizDevTick, addBusinessDays } from './bizDevOutreach'
import { buildCampaignPlan, approveCampaign, type CampaignDefinition } from './outreachCampaign'
import { FakeGmail, MemWorld, uuid } from './outreachTestKit'

// Gmail per-minute quota / transient failures must DELAY work, never pause a campaign or escalate a recipient.
// Fakes only: no network, no database, no email.

const MON = new Date('2026-10-12T15:00:00Z')
const DEF: CampaignDefinition = {
  key: 'gb-res', name: 'Green Bay RES', metroSlug: 'green-bay', metroLabel: 'Green Bay Metro',
  subjectTemplate: 'We selected {{business_name}} for CheckOff',
  firstTouchBody: 'Hi {{business_name}} team,\n\nWe selected you for CheckOff {{metro}}:\n\n{{items_block}}\n\nFree graphics: {{kit_url}}\n\nYou can also just reply to this email.\n\nJerry',
  followUp1Body: 'Hi {{business_name}} team,\n\nQuick follow-up about {{item_text}}.\n\n{{items_block}}\n\nJerry',
  followUp2Body: 'Last note for {{business_name}}: {{confirm_url}}\n\nJerry',
  approvals: { firstTouchTemplate: true, followUpTemplates: true },
}
const QUOTA = new Error(`Gmail messages.list returned 403: {"error":{"code":403,"message":"Quota exceeded for quota metric 'Total Query Cost' and limit 'Total Query Cost per minute per user'"}}`)
const emailOf = (i: number) => `biz${i}@example.com`

async function launch(n: number) {
  const w = new MemWorld()
  const rows: string[] = ['business_name,contact_email,item_id']
  for (let i = 1; i <= n; i++) {
    w.itemRows.set(uuid(100 + i), { id: uuid(100 + i), text: `Try the special at 'Biz ${i}'`, isActive: true, isSecret: false, metroSlug: 'green-bay' })
    rows.push(`Biz ${i},biz${i}@example.com,${uuid(100 + i)}`)
  }
  const plan = await buildCampaignPlan(DEF, rows.join('\n'), { lookups: w })
  assert.equal(plan.counts.errors, 0)
  let t = 0
  await approveCampaign(plan, { confirmRecipients: n, previewHash: plan.inputHash, templatesApproved: true, now: MON }, w, () => `TOK_${String(++t).padStart(28, '0')}`)
  for (const r of w.recipients.values()) for (const l of r.state.listings ?? []) w.tokens.add(l.token)
  await w.saveCampaign(DEF.key, { state: 'ACTIVE' })
  const g = new FakeGmail()
  const tick = (now: Date = MON) => { g.clock = now; return runBizDevTick({ gmail: g, store: w, now: () => now, sleep: async () => {} }) }
  await tick() // first touches
  return { w, g, tick, fu1: addBusinessDays(MON, 5) }
}

test('a Gmail quota error during the reply scan defers every follow-up: nothing sent, nothing paused, nothing escalated, no state changed', async () => {
  const { w, g, tick, fu1 } = await launch(4)
  const before = JSON.stringify([...w.recipients.values()].map((r) => r.state))
  g.readFault = () => QUOTA
  const r = await tick(fu1)
  assert.equal(g.sends.length, 4, 'only the 4 first touches; no follow-up while Gmail is rate limiting')
  assert.equal(w.runtimes.get('gb-res')!.state, 'ACTIVE', 'the campaign is NOT paused')
  assert.equal(w.countStatus('NEEDS_JERRY'), 0)
  assert.equal(JSON.stringify([...w.recipients.values()].map((x) => x.state)), before, 'recipient state is untouched')
  assert.equal(r.errors.length, 0, 'a transient quota is not an error')
  assert.ok(r.actions.some((a) => /rate limit \/ transient error.*deferred to the next tick; nothing paused/.test(a)), r.actions.join(' | '))
  g.readFault = null
  await tick(fu1)
  assert.equal(g.sends.length, 8, 'the next healthy tick sends each follow-up exactly once')
  await tick(new Date(fu1.getTime() + 15 * 60_000))
  assert.equal(g.sends.length, 8, 'and never twice')
})

test('a quota error fetching the first message happens BEFORE the claim, so the recipient is untouched and retried next tick', async () => {
  const { w, g, tick, fu1 } = await launch(2)
  const firstId = w.byEmail(emailOf(1)).state.stepsSent[0].messageId
  g.readFault = (kind, arg) => (kind === 'full' && arg === firstId ? QUOTA : null)
  const r = await tick(fu1)
  assert.equal(w.byEmail(emailOf(1)).state.claimedStep, 1, 'step 2 was never claimed')
  assert.equal(w.byEmail(emailOf(1)).state.sequenceStatus, 'ACTIVE')
  assert.equal(w.runtimes.get('gb-res')!.state, 'ACTIVE')
  assert.equal(r.errors.length, 0)
  assert.equal(g.sends.filter((s) => s.to === emailOf(1)).length, 1, 'no follow-up yet to the affected recipient')
  g.readFault = null
  await tick(fu1)
  assert.equal(g.sends.filter((s) => s.to === emailOf(1)).length, 2)
  assert.equal(w.byEmail(emailOf(1)).state.claimedStep, 2)
})

test('a send REJECTED at admission by a per-minute quota is not a failed send: claim released, no pause, no NEEDS_JERRY, retried next tick', async () => {
  const { w, g, tick, fu1 } = await launch(3)
  g.failNext = [new Error('Gmail messages.send returned 429: {"error":{"message":"Rate Limit Exceeded: rateLimitExceeded"}}')]
  const r = await tick(fu1)
  assert.equal(w.runtimes.get('gb-res')!.state, 'ACTIVE')
  assert.equal(w.countStatus('NEEDS_JERRY'), 0)
  assert.equal(r.errors.length, 0)
  const sent = g.sends.length - 3
  assert.ok(sent <= 2, 'the rejected one is not recorded as sent')
  const stuck = [...w.recipients.values()].filter((x) => x.state.stepsSent.length === 1)
  assert.equal(stuck.length, 3 - sent)
  for (const x of stuck) {
    assert.equal(x.state.claimedStep, 1, 'claim released')
    assert.equal(x.state.sequenceStatus, 'ACTIVE')
    assert.ok(!(x.state.attempts ?? []).some((a) => a.step === 2), 'no dangling attempt for the rejected step')
  }
  await tick(fu1)
  assert.equal(g.sends.length, 6, 'every recipient gets exactly one follow-up after recovery')
})

test('a REAL send failure (auth / daily sending limit) still pauses the campaign and escalates, exactly as before', async () => {
  for (const msg of ['Gmail messages.send returned 535: authentication failed', 'Gmail messages.send returned 403: Daily user sending quota exceeded']) {
    const { w, g, tick, fu1 } = await launch(3)
    g.failNext = [new Error(msg)]
    const r = await tick(fu1)
    assert.equal(w.runtimes.get('gb-res')!.state, 'PAUSED', msg)
    assert.ok(r.errors.some((e) => /PAUSED|send failed/.test(e)), msg)
    assert.ok(w.countStatus('NEEDS_JERRY') >= 1, msg)
  }
})

test('circuit breaker: after the first quota error the tick stops making Gmail reads instead of hammering', async () => {
  const { g, tick, fu1 } = await launch(12)
  let reads = 0
  g.readFault = () => { reads++; return QUOTA }
  await tick(fu1)
  assert.ok(reads <= 4, `expected a handful of reads, got ${reads}`)
  assert.equal(g.sends.length, 12)
})

test('a non-transient Gmail read error is still reported as an error (not silently deferred)', async () => {
  const { tick, g, fu1 } = await launch(2)
  g.readFault = (kind) => (kind === 'ids' ? new Error('Gmail messages.list returned 404: not found') : null)
  const r = await tick(fu1)
  assert.ok(r.errors.some((e) => /404/.test(e)), r.errors.join(' | '))
})

test('first touches are not attempted while Gmail is rate limiting', async () => {
  const w = new MemWorld(); const g = new FakeGmail()
  const rows = ['business_name,contact_email,item_id']
  for (let i = 1; i <= 3; i++) { w.itemRows.set(uuid(200 + i), { id: uuid(200 + i), text: `Item ${i}`, isActive: true, isSecret: false, metroSlug: 'green-bay' }); rows.push(`Q${i},q${i}@example.com,${uuid(200 + i)}`) }
  const plan = await buildCampaignPlan({ ...DEF, key: 'gb-res2' }, rows.join('\n'), { lookups: w })
  let t = 0
  await approveCampaign(plan, { confirmRecipients: 3, previewHash: plan.inputHash, templatesApproved: true, now: MON }, w, () => `TOQ_${String(++t).padStart(28, '0')}`)
  for (const r of w.recipients.values()) for (const l of r.state.listings ?? []) w.tokens.add(l.token)
  await w.saveCampaign('gb-res2', { state: 'ACTIVE' })
  g.readFault = () => QUOTA
  const r = await runBizDevTick({ gmail: g, store: w, now: () => MON, sleep: async () => {} })
  assert.equal(g.sends.length, 0)
  assert.equal(w.runtimes.get('gb-res2')!.state, 'ACTIVE')
  assert.equal(r.errors.length, 0)
  g.readFault = null
  await runBizDevTick({ gmail: g, store: w, now: () => MON, sleep: async () => {} })
  assert.equal(g.sends.length, 3, 'queue untouched; sends once Gmail recovers')
})
