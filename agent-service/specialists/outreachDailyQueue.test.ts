import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBizDevTick } from './bizDevOutreach'
import { firstTouchAllowance } from './bizDevCampaign'
import { buildCampaignPlan, approveCampaign, validateDefinition, renderDigest, summarizeCampaign, type CampaignDefinition } from './outreachCampaign'
import { FakeGmail, MemWorld, uuid } from './outreachTestKit'

// One-time roster approval -> automatic daily sending. FakeGmail + MemWorld only: no network, no database, no real email.

const at = (day: number, hhmm = '15:00') => new Date(`2026-10-${String(day).padStart(2, '0')}T${hhmm}:00Z`) // Mon Oct 12 .. Fri Oct 16, Mon Oct 19 ..
const DEF: CampaignDefinition = {
  key: 'gb-roster',
  name: 'Green Bay ROSTER TEST',
  metroSlug: 'green-bay',
  metroLabel: 'Green Bay Metro',
  subjectTemplate: 'We selected {{business_name}} for CheckOff',
  firstTouchBody: 'Hi {{business_name}} team,\n\nWe selected you for CheckOff {{metro}}:\n\n{{items_block}}\n\nFree graphics: {{kit_url}}\n\nJust reply to this email too.\n\nJerry',
  followUp1Body: 'Hi {{business_name}} team,\n\nQuick follow-up.\n\n{{items_block}}\n\nJerry',
  followUp2Body: 'Last note for {{business_name}}: {{confirm_url}}\n\nJerry',
  approvals: { firstTouchTemplate: true, followUpTemplates: true },
}
let seq = 0
async function roster(n: number, def: Partial<CampaignDefinition> = {}, w = new MemWorld(), offset = 0) {
  const rows = ['business_name,contact_email,item_id']
  for (let i = 1; i <= n; i++) {
    const k = offset + i
    w.itemRows.set(uuid(1000 + k), { id: uuid(1000 + k), text: `Try the special at 'Biz ${k}'`, isActive: true, isSecret: false, metroSlug: 'green-bay' })
    rows.push(`Biz ${k},biz${k}@example.com,${uuid(1000 + k)}`)
  }
  const d = { ...DEF, ...def }
  const plan = await buildCampaignPlan(d, rows.join('\n'), { lookups: w })
  assert.equal(plan.counts.errors, 0, JSON.stringify(plan.issues))
  await approveCampaign(plan, { confirmRecipients: n, previewHash: plan.inputHash, templatesApproved: true, now: at(12, '14:00') }, w, () => `T_${String(++seq).padStart(30, '0')}`)
  for (const r of w.recipients.values()) for (const l of r.state.listings ?? []) w.tokens.add(l.token)
  await w.saveCampaign(d.key, { state: 'ACTIVE' })
  return w
}
const tickAt = (g: FakeGmail, w: MemWorld, now: Date) => { g.clock = now; return runBizDevTick({ gmail: g, store: w, now: () => now, sleep: async () => {} }) }
const firstTouches = (g: FakeGmail) => g.sends.filter((s) => !/^Re: /.test(s.subject)).length
const followUps = (g: FakeGmail) => g.sends.filter((s) => /^Re: /.test(s.subject)).length

test('allowance: the daily first-touch limit is a ceiling, follow-up reserve and real capacity both outrank it', () => {
  assert.deepEqual(firstTouchAllowance({ dailyLimit: 50, firstTouchesLast24h: 0, capacityRemaining: 80, reservedFollowUps: 0 }), { allowed: 50, limitedBy: 'none' })
  assert.deepEqual(firstTouchAllowance({ dailyLimit: 50, firstTouchesLast24h: 50, capacityRemaining: 30, reservedFollowUps: 0 }), { allowed: 0, limitedBy: 'first_touch_limit' })
  assert.deepEqual(firstTouchAllowance({ dailyLimit: 50, firstTouchesLast24h: 20, capacityRemaining: 80, reservedFollowUps: 60 }), { allowed: 20, limitedBy: 'follow_up_reserve' })
  assert.deepEqual(firstTouchAllowance({ dailyLimit: 50, firstTouchesLast24h: 0, capacityRemaining: 80, reservedFollowUps: 60 }), { allowed: 20, limitedBy: 'follow_up_reserve' })
  assert.deepEqual(firstTouchAllowance({ dailyLimit: 50, firstTouchesLast24h: 0, capacityRemaining: 40, reservedFollowUps: 0 }), { allowed: 40, limitedBy: 'capacity' })
  assert.deepEqual(firstTouchAllowance({ dailyLimit: 50, firstTouchesLast24h: 0, capacityRemaining: 0, reservedFollowUps: 5 }), { allowed: 0, limitedBy: 'capacity' })
  assert.equal(firstTouchAllowance({ dailyLimit: 50, firstTouchesLast24h: 0, capacityRemaining: 10, reservedFollowUps: 99 }).allowed, 0, 'never negative')
})

test('ONE approval of a 120-recipient roster sends 50 on day 1, 50 on day 2, 20 on day 3, with no further approvals and no more than 50 in 24h', async () => {
  const w = await roster(120)
  const g = new FakeGmail()
  const perTick: number[] = []
  for (const t of [at(12), at(12, '15:15'), at(12, '15:30'), at(12, '18:00')]) { const b = g.sends.length; await tickAt(g, w, t); perTick.push(g.sends.length - b) }
  assert.deepEqual(perTick, [25, 25, 0, 0], '25 per tick up to the 50/day limit, then nothing more that day')
  const held = await tickAt(g, w, at(12, '18:15'))
  assert.ok(held.actions.some((a) => /daily first-touch limit reached \(50\/50 in 24h\)/.test(a)))
  assert.equal(firstTouches(g), 50)
  const day2 = g.sends.length
  await tickAt(g, w, at(13)); await tickAt(g, w, at(13, '15:15'))
  assert.equal(g.sends.length - day2, 50, 'day 2: the next 50 go out automatically')
  const day3 = g.sends.length
  for (let i = 0; i < 4; i++) await tickAt(g, w, at(14, `15:${String(i * 15).padStart(2, '0')}`))
  assert.equal(g.sends.length - day3, 20, 'day 3: the remaining 20; the roster is exhausted')
  assert.equal(w.countStatus('READY'), 0)
  assert.equal(new Set(g.sends.map((s) => s.to)).size, 120, 'every recipient got exactly one first touch')
  assert.equal(w.runtimes.get(DEF.key)!.batches!.length, 1, 'approved once')
})

test('follow-ups outrank first touches: due follow-ups go first, then first touches only fit in what is left', async () => {
  const w = await roster(40, { dailyCap: 12, firstTouchDailyLimit: 10 })
  const g = new FakeGmail()
  await tickAt(g, w, at(12)); await tickAt(g, w, at(12, '15:15'))
  assert.equal(firstTouches(g), 10, 'day 1: the limit of 10')
  // Next Monday the 10 follow-ups are due. Cap 12: follow-ups first (10), only 2 first touches fit.
  await tickAt(g, w, at(19)); await tickAt(g, w, at(19, '15:15'))
  assert.equal(followUps(g), 10, 'all due follow-ups were sent')
  assert.equal(firstTouches(g), 12, 'only the 2 remaining slots went to new first touches')
  assert.ok(g.sends.length - 10 <= 12 + 0, 'never above the cap in 24h')
})

test('capacity is reserved for follow-ups due within 24h: new first touches stop early enough to leave room', async () => {
  const w = await roster(60, { dailyCap: 12, firstTouchDailyLimit: 10 })
  const g = new FakeGmail()
  await tickAt(g, w, at(12)); await tickAt(g, w, at(12, '15:15')) // Monday cohort: 10
  await tickAt(g, w, at(13)); await tickAt(g, w, at(13, '15:15')) // Tuesday cohort: 10
  assert.equal(firstTouches(g), 20)
  // Monday 19th: Monday's 10 follow-ups are due now, Tuesday's 10 fall due within 24h. Cap 12.
  const before = g.sends.length
  const r = await tickAt(g, w, at(19))
  assert.equal(g.sends.length - before, 10, 'only the due follow-ups; zero new first touches')
  assert.ok(r.actions.some((a) => /capacity reserved for 10 follow-up\(s\) due within 24h|daily cap reached/.test(a)), JSON.stringify(r.actions))
  assert.equal(firstTouches(g), 20)
})

test('the 50/day target never overrides the real cap: a 40/day cap sends at most 40 first touches', async () => {
  const w = await roster(100, { dailyCap: 40 })
  const g = new FakeGmail()
  for (let i = 0; i < 6; i++) await tickAt(g, w, at(12, `15:${String(i * 10).padStart(2, '0')}`))
  assert.equal(g.sends.length, 40)
})

test('other outgoing mail shrinks the day: 50 limit, 80 cap, 60 already sent by other means -> only 20 first touches', async () => {
  const w = await roster(100)
  const g = new FakeGmail()
  g.otherSent24h = 60
  for (let i = 0; i < 4; i++) await tickAt(g, w, at(12, `15:${String(i * 15).padStart(2, '0')}`))
  assert.equal(g.sends.length, 20)
})

test('two campaigns on one sender share ONE cap and each keeps its own first-touch limit', async () => {
  const w = await roster(30, { key: 'gb-roster', dailyCap: 30, firstTouchDailyLimit: 25 })
  await roster(30, { key: 'denver-roster', metroSlug: 'green-bay', dailyCap: 30, firstTouchDailyLimit: 25 }, w, 100)
  const g = new FakeGmail()
  for (let i = 0; i < 6; i++) await tickAt(g, w, at(12, `15:${String(i * 10).padStart(2, '0')}`))
  assert.equal(g.sends.length, 30, 'the shared 30/day cap holds across both campaigns, not 30 each')
  assert.ok(w.runtimes.get('gb-roster')!.firstTouchSent <= 25 && w.runtimes.get('denver-roster')!.firstTouchSent <= 25)
})

test('suppressed contacts, token problems and expiry still apply to roster sends', async () => {
  const w = await roster(6, { expiresAt: '2026-10-14T00:00:00Z' })
  for (const c of w.contacts.values()) if (c.email === 'biz2@example.com') c.suppressed = true
  const wrong = [...w.recipients.values()].find((r) => r.email === 'biz3@example.com')!.state.listings![0].token
  w.tokenItems.set(wrong, uuid(9999))
  const g = new FakeGmail()
  const r = await tickAt(g, w, at(12))
  assert.deepEqual(g.sends.map((s) => s.to).sort(), ['biz1@example.com', 'biz4@example.com', 'biz5@example.com', 'biz6@example.com'], 'suppressed and wrong-token recipients are not sent')
  assert.ok(r.errors.some((e) => /different item/.test(e)))
  const after = g.sends.length
  await tickAt(g, w, at(14, '15:00'))
  assert.equal(g.sends.length, after, 'past the stop date nothing more is sent')
})

test('definition validation: firstTouchDailyLimit must be an integer between 1 and dailyCap', () => {
  assert.equal(validateDefinition({ ...DEF, firstTouchDailyLimit: 50 }).filter((i) => i.code === 'DEF_FIRST_TOUCH_LIMIT').length, 0)
  for (const bad of [0, -1, 2.5, 81]) assert.equal(validateDefinition({ ...DEF, firstTouchDailyLimit: bad }).filter((i) => i.code === 'DEF_FIRST_TOUCH_LIMIT').length, 1, String(bad))
})

test('digest: a few lines covering what went out, what is queued, what is due, and whether anything needs Jerry', () => {
  const report = summarizeCampaign({ key: 'gb-roster', state: 'ACTIVE', bounceCount: 0, expiresAt: '2026-11-16T07:00:00.000Z' }, 'gb-roster', [], {})
  const text = renderDigest({ ...report, queued: 120, firstTouchesSent: 18, awaitingReply: 18, confirmations: 2, needsJerry: 1, needsJerryItems: ['Jerry: unclear reply from X'] }, { firstTouchesLast24h: 50, followUpsLast24h: 7, followUpsDueNext24h: 12, dailyLimit: 50, dailyCap: 80 })
  assert.match(text, /Last 24h: 50 first touches \(limit 50\/day\), 7 follow-ups/)
  assert.match(text, /Queue: 120 waiting \(about 3 sending days at 50\/day\)/)
  assert.match(text, /follow-ups due next 24h: 12/)
  assert.match(text, /NEEDS YOU: 1/)
  assert.match(text, /stops 2026-11-16/)
  assert.ok(text.split('\n').length <= 6)
})
