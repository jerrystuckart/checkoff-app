import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv, readCampaignCsv, buildCampaignPlan, validateDefinition, renderPreviewMarkdown, renderPreviewCsv, approveCampaign, ApprovalRefused, assertApprovable, buildTokenSql, mintTokens, activationBlockers, summarizeCampaign, renderReport, type CampaignDefinition } from './outreachCampaign'
import { computeCapacity } from './bizDevCampaign'
import { renderTemplate, checkTemplate, validateOutreachCopy, staticSubjectStem } from './outreachTemplates'
import { MemWorld, uuid } from './outreachTestKit'

const DEF: CampaignDefinition = {
  key: 'gb-sample',
  name: 'Green Bay SAMPLE',
  metroSlug: 'green-bay',
  metroLabel: 'Green Bay Metro',
  subjectTemplate: 'We selected {{business_name}} for CheckOff',
  firstTouchBody: 'Hi {{business_name}} team,\n\nWe selected you for CheckOff {{metro}}:\n\n{{items_block}}\n\nFree graphics: {{kit_url}}\n\nJust reply to this email too.\n\nJerry',
  followUp1Body: 'Hi {{business_name}} team,\n\nQuick follow-up about {{item_text}}.\n\n{{items_block}}\n\nJerry',
  followUp2Body: 'Last note for {{business_name}}: {{confirm_url}}\n\nJerry',
  approvals: { firstTouchTemplate: true, followUpTemplates: true },
}

function world() {
  const w = new MemWorld()
  const mk = (n: number, text: string, extra: Partial<{ isActive: boolean; isSecret: boolean; metroSlug: string; existingToken: string }> = {}) =>
    w.itemRows.set(uuid(n), { id: uuid(n), text, isActive: extra.isActive ?? true, isSecret: extra.isSecret ?? false, metroSlug: extra.metroSlug ?? 'green-bay', existingToken: extra.existingToken })
  mk(1, "Order the Packers burger at 'Cafe One'")
  mk(2, "Try the cheese curds at 'Cafe One'")
  mk(3, "Tour the brewery at 'Brew Two'", { existingToken: 'EXISTINGTOKEN_brew_two_00000001' })
  mk(4, "Find the secret room at 'Spoiler Bar'", { isSecret: true })
  mk(5, "See the mural at 'Old Place'", { isActive: false })
  mk(6, "Walk the trail at 'Elsewhere'", { metroSlug: 'denver' })
  mk(7, "Sip the latte at 'Coffee Seven'")
  mk(8, "Bite the pretzel at 'Pretzel Eight'")
  return w
}

const HEADER = 'business_name,contact_email,item_id,contact_name,metro,exact_checkoff_item,excluded_reason'
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n')

test('CSV parser handles quotes, commas, CRLF and a BOM', () => {
  const t = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n')
  assert.deepEqual(t, [['a', 'b'], ['x, y', 'he said "hi"']])
})

test('column aliases from the earlier workbooks are accepted; missing required columns are reported', () => {
  const ok = readCampaignCsv('Business,Best Researched Email,Item ID\nCafe,a@b.com,x')
  assert.equal(ok.issues.length, 0)
  assert.equal(ok.rows[0].contact_email, 'a@b.com')
  const bad = readCampaignCsv('Business,Email\nCafe,a@b.com')
  assert.match(bad.issues.map((i) => i.message).join(' '), /item_id/)
})

test('validation: bad rows are reported precisely and never silently included', async () => {
  const w = world()
  const plan = await buildCampaignPlan(DEF, csv(
    `Cafe One,owner@cafeone.com,${uuid(1)},Pat,Green Bay Metro,,`,
    `No Email,,${uuid(7)},,,,`,
    `Bad Email,not-an-email,${uuid(7)},,,,`,
    `Two Emails,"a@x.com; b@x.com",${uuid(7)},,,,`,
    `Noreply,noreply@x.com,${uuid(7)},,,,`,
    `Internal,jerry@getcheckoff.com,${uuid(7)},,,,`,
    `Missing Item,m@x.com,${uuid(99)},,,,`,
    `Inactive,i@x.com,${uuid(5)},,,,`,
    `Wrong Metro,w@x.com,${uuid(6)},,,,`,
    `Not UUID,u@x.com,12345,,,,`,
    `Secret Bar,s@x.com,${uuid(4)},,,,`,
    `Sheet Excluded,e@x.com,${uuid(8)},,,,Chain restaurant`
  ), { lookups: w })
  const codes = plan.issues.filter((i) => i.severity === 'ERROR').map((i) => i.code).sort()
  assert.deepEqual(codes, ['ITEM_INACTIVE', 'ITEM_NOT_FOUND', 'ITEM_WRONG_METRO', 'ROW_BAD_EMAIL', 'ROW_BAD_ITEM_ID', 'ROW_INTERNAL', 'ROW_MULTI_EMAIL', 'ROW_NOREPLY', 'ROW_NO_EMAIL'])
  assert.deepEqual(plan.recipients.map((r) => r.email), ['owner@cafeone.com'])
  assert.ok(plan.excluded.some((e) => /Secret/.test(e.reason)), 'secret items are excluded from confirmation outreach')
  assert.ok(plan.excluded.some((e) => /Chain restaurant/.test(e.reason)))
})

test('consolidation: several items for one contact become ONE email carrying every listing and its own confirmation link', async () => {
  const w = world()
  const plan = await buildCampaignPlan(DEF, csv(
    `Cafe One,owner@cafeone.com,${uuid(1)},Pat,,,`,
    `Cafe One,OWNER@cafeone.com,${uuid(2)},Pat,,,`,
    `Cafe One,owner@cafeone.com,${uuid(2)},Pat,,,` // exact duplicate
  ), { lookups: w })
  assert.equal(plan.recipients.length, 1)
  assert.equal(plan.recipients[0].items.length, 2)
  assert.equal(plan.counts.listings, 2)
  assert.ok(plan.issues.some((i) => i.code === 'ROW_DUPLICATE'))
  const body = plan.recipients[0].body
  assert.match(body, /Packers burger/)
  assert.match(body, /cheese curds/)
  assert.equal((body.match(/getcheckoff\.com\/confirm\//g) ?? []).length, 2)
  assert.match(body, /getcheckoff\.com\/downloads\/featured-kit/)
  assert.equal(plan.recipients[0].subject, 'We selected Cafe One for CheckOff')
})

test('an item owned by two different contacts is an error; a shared mailbox for two businesses is a warning', async () => {
  const w = world()
  const plan = await buildCampaignPlan(DEF, csv(
    `Cafe One,a@x.com,${uuid(1)},,,,`,
    `Cafe One Too,b@x.com,${uuid(1)},,,,`,
    `Coffee Seven,shared@x.com,${uuid(7)},,,,`,
    `Pretzel Eight,shared@x.com,${uuid(8)},,,,`
  ), { lookups: w })
  assert.ok(plan.issues.some((i) => i.code === 'ITEM_MULTI_OWNER' && i.severity === 'ERROR'))
  assert.ok(plan.issues.some((i) => i.code === 'GROUP_MULTI_BUSINESS' && i.severity === 'WARN'))
  assert.equal(plan.recipients.find((r) => r.email === 'shared@x.com')!.items.length, 2)
})

test('prior outreach, suppression, Gmail Sent history and already-queued contacts are excluded, not emailed again', async () => {
  const w = world()
  w.contacts.set('old@x.com', { id: 'c1', email: 'old@x.com', org: 'Old', name: null, suppressed: false, hasOutbound: true })
  w.contacts.set('dnc@x.com', { id: 'c2', email: 'dnc@x.com', org: 'Dnc', name: null, suppressed: true, hasOutbound: false })
  w.gmailPriorSent = async () => new Set(['gmailsent@x.com'])
  const plan = await buildCampaignPlan(DEF, csv(
    `Old,old@x.com,${uuid(1)},,,,`,
    `Dnc,dnc@x.com,${uuid(2)},,,,`,
    `GmailSent,gmailsent@x.com,${uuid(7)},,,,`,
    `Fresh,fresh@x.com,${uuid(8)},,,,`
  ), { lookups: w })
  assert.deepEqual(plan.recipients.map((r) => r.email), ['fresh@x.com'])
  assert.equal(plan.excluded.length, 3)
  // allowPriorOutreach flips the prior-outreach exclusion into a warning (suppression is NEVER overridable)
  const plan2 = await buildCampaignPlan({ ...DEF, allowPriorOutreach: true }, csv(`Old,old@x.com,${uuid(1)},,,,`, `Dnc,dnc@x.com,${uuid(2)},,,,`), { lookups: w })
  assert.deepEqual(plan2.recipients.map((r) => r.email), ['old@x.com'])
  assert.ok(plan2.excluded.some((e) => /suppressed/i.test(e.reason)))
})

test('template safety: unknown fields, a missing confirm link, and metro-specific kits are rejected up front', () => {
  assert.ok(validateDefinition({ ...DEF, firstTouchBody: 'Hi {{busines_name}} {{items_block}}' }).some((i) => /unknown merge field/.test(i.message)))
  assert.ok(validateDefinition({ ...DEF, firstTouchBody: 'Hi {{business_name}}, reply to confirm.' }).some((i) => i.code === 'DEF_NO_CONFIRM_LINK'))
  assert.ok(validateDefinition({ ...DEF, key: 'Bad Key' }).some((i) => i.code === 'DEF_KEY'))
  assert.ok(validateDefinition({ ...DEF, followUp1Body: 'DRAFT, NOT APPROVED. Hi {{business_name}} {{items_block}}' }).some((i) => i.code === 'DEF_DRAFT_MARKER'), 'draft markers block approval even if the flags are true')
  assert.ok(validateDefinition({ ...DEF, cadence: { followUp1AfterBusinessDays: 0 } }).some((i) => i.code === 'DEF_CADENCE'))
  assert.equal(validateDefinition(DEF).filter((i) => i.severity === 'ERROR').length, 0)
  assert.equal(validateOutreachCopy('Graphics: https://getcheckoff.com/downloads/featured-kit-green-bay').pass, false, 'metro-specific kit still rejected (businessActivationKit rule)')
  assert.equal(validateOutreachCopy('Kit https://getcheckoff.com/downloads/featured-kit and confirm https://getcheckoff.com/confirm/abc_DEF-123').pass, true, 'a business-facing confirm link beside the canonical kit is allowed')
  assert.equal(checkTemplate('{{nope}}', 't').ok, false)
  assert.equal(staticSubjectStem('We selected {{business_name}} for CheckOff'), 'We selected')
  assert.throws(() => renderTemplate('Hi {{contact_name}}', {}), /no value/)
})

test('a template that needs {{contact_name}} fails per recipient when the sheet has none (not silently blank)', async () => {
  const w = world()
  const plan = await buildCampaignPlan({ ...DEF, firstTouchBody: DEF.firstTouchBody.replace('Hi {{business_name}} team', 'Hi {{contact_name}}') }, csv(`Cafe One,a@x.com,${uuid(1)},,,,`, `Coffee,b@x.com,${uuid(7)},Sam,,,`), { lookups: w })
  assert.ok(plan.issues.some((i) => i.code === 'RENDER' && /contact_name/.test(i.message)))
  assert.deepEqual(plan.recipients.map((r) => r.email), ['b@x.com'])
})

test('daily-cap math: 80 default, never above provider limit minus reserve, pauses instead of exceeding', () => {
  assert.equal(computeCapacity({ dailyCap: 80, providerLimit: 100, reserve: 10, sentLast24h: 0 }).remaining, 80)
  assert.equal(computeCapacity({ dailyCap: 80, providerLimit: 100, reserve: 10, sentLast24h: 35 }).remaining, 45)
  assert.equal(computeCapacity({ dailyCap: 95, providerLimit: 100, reserve: 10, sentLast24h: 0 }).remaining, 90, 'stricter provider ceiling wins')
  assert.equal(computeCapacity({ dailyCap: 95, providerLimit: 100, reserve: 10, sentLast24h: 0 }).limitedBy, 'provider_limit')
  assert.equal(computeCapacity({ dailyCap: 80, providerLimit: 100, reserve: 10, sentLast24h: 120 }).remaining, 0)
})

test('preview: complete, honest about sending nothing, and its hash is stable but sensitive to content', async () => {
  const w = world()
  const rows = [`Cafe One,owner@cafeone.com,${uuid(1)},Pat,,,`, `Brew Two,b@x.com,${uuid(3)},,,,`]
  const a = await buildCampaignPlan(DEF, csv(...rows), { lookups: w })
  const b = await buildCampaignPlan(DEF, csv(...rows), { lookups: w })
  assert.equal(a.inputHash, b.inputHash)
  const c = await buildCampaignPlan(DEF, csv(rows[0]), { lookups: w })
  assert.notEqual(a.inputHash, c.inputHash)
  const md = renderPreviewMarkdown(a, new Date('2026-10-12T15:00:00Z'))
  assert.match(md, /Nothing has been sent and nothing has been written to the database/)
  assert.match(md, new RegExp(a.inputHash))
  assert.match(md, /Cafe One <owner@cafeone.com>/)
  assert.match(md, /Follow-Up 1/)
  assert.match(md, /2026-10-19/, 'follow-up 1 is 5 business days after Mon Oct 12')
  assert.match(md, /Max 3 emails/)
  assert.match(md, /EXISTINGTOKEN_brew_two_00000001/, 'an item that already has a token reuses it')
  assert.match(md, /NEW_TOKEN_1/)
  assert.equal(a.counts.reusedTokens, 1)
  assert.equal(a.counts.newTokensNeeded, 1)
  assert.match(renderPreviewCsv(a), /owner@cafeone.com/)
})

test('approval gates: every missing confirmation is a refusal with a reason; nothing is written when refused', async () => {
  const w = world()
  const plan = await buildCampaignPlan(DEF, csv(`Cafe One,a@x.com,${uuid(1)},,,,`, `Coffee,b@x.com,${uuid(7)},,,,`), { lookups: w })
  const good = { confirmRecipients: 2, previewHash: plan.inputHash, templatesApproved: true, now: new Date('2026-10-12T15:00:00Z') }
  for (const [label, args, def] of [
    ['wrong count', { ...good, confirmRecipients: 3 }, DEF],
    ['wrong hash', { ...good, previewHash: 'deadbeef' }, DEF],
    ['templates flag missing', { ...good, templatesApproved: false }, DEF],
    ['first-touch template not approved', good, { ...DEF, approvals: { firstTouchTemplate: false, followUpTemplates: true } }],
    ['follow-up templates not approved', good, { ...DEF, approvals: { firstTouchTemplate: true, followUpTemplates: false } }],
  ] as const) {
    const p = def === DEF ? plan : { ...plan, definition: def }
    await assert.rejects(() => approveCampaign(p, args, w), ApprovalRefused, label)
  }
  assert.equal(w.recipients.size, 0)
  assert.equal(w.runtimes.size, 0)
  assert.equal(w.projects.length, 0)
  const withErrors = await buildCampaignPlan(DEF, csv(`Bad,not-an-email,${uuid(1)},,,,`, `Coffee,b@x.com,${uuid(7)},,,,`), { lookups: w })
  assert.throws(() => assertApprovable(withErrors, { ...good, confirmRecipients: 1, previewHash: withErrors.inputHash }), /validation error/)
})

test('approval writes the campaign + one QUEUED recipient task each, mints tokens only now, and emits SQL for only the NEW tokens', async () => {
  const w = world()
  const plan = await buildCampaignPlan(DEF, csv(`Cafe One,a@x.com,${uuid(1)},Pat,,,`, `Cafe One,a@x.com,${uuid(2)},Pat,,,`, `Brew Two,b@x.com,${uuid(3)},,,,`), { lookups: w })
  assert.ok(!JSON.stringify(plan).match(/"token":/), 'the plan/preview contains no minted tokens')
  let n = 0
  const res = await approveCampaign(plan, { confirmRecipients: 2, previewHash: plan.inputHash, templatesApproved: true, now: new Date('2026-10-12T15:00:00Z') }, w, () => `MINTED_TOKEN_${String(++n).padStart(18, '0')}`)
  assert.equal(res.recipientsQueued, 2)
  assert.equal(res.newTokens, 2)
  assert.equal((res.tokenSql.match(/MINTED_TOKEN_/g) ?? []).length, 2)
  assert.doesNotMatch(res.tokenSql, /EXISTINGTOKEN/, 'existing tokens are reused, never re-inserted')
  assert.match(res.tokenSql, /bizdev_gb-sample/)
  assert.match(res.tokenSql, /NOT applied automatically/)
  const c = [...w.runtimes.values()][0]
  assert.equal(c.state, 'APPROVED')
  assert.equal(c.approval?.approvedBy, 'jerry')
  assert.equal(c.approval?.recipientCount, 2)
  assert.deepEqual(c.followUps.map((f) => [f.step, f.afterBusinessDays]), [[2, 5], [3, 7]])
  assert.equal(c.closeAfterBusinessDays, 7)
  assert.equal(c.maxOutbound, 3)
  assert.equal(c.dailyCap, 80)
  const r = w.byEmail('a@x.com')
  assert.equal(r.status, 'READY')
  assert.equal(r.state.sequenceStatus, 'QUEUED')
  assert.equal(r.state.listings?.length, 2)
  assert.match(r.state.vars!.items_block, /MINTED_TOKEN_/)
  assert.equal(w.byEmail('b@x.com').state.listings![0].token, 'EXISTINGTOKEN_brew_two_00000001')
  // approving the same campaign again is refused and does not duplicate anything
  await assert.rejects(() => approveCampaign(plan, { confirmRecipients: 2, previewHash: plan.inputHash, templatesApproved: true, now: new Date() }, w), /exists/)
  assert.equal(w.recipients.size, 2)
  assert.equal(buildTokenSql(DEF, mintTokens(plan, () => 'X'.repeat(32)).map((m) => ({ ...m, items: m.items.map((i) => ({ ...i, isNew: false })) }))).includes('INSERT'), false)
})

test('crash-safe approval: token SQL is handed over BEFORE any write, the campaign record is written LAST, and a re-run after a crash is consistent', async () => {
  const w = world()
  const plan = await buildCampaignPlan(DEF, csv(`Cafe One,a@x.com,${uuid(1)},,,,`, `Coffee,b@x.com,${uuid(7)},,,,`), { lookups: w })
  const args = { confirmRecipients: 2, previewHash: plan.inputHash, templatesApproved: true, now: new Date('2026-10-12T15:00:00Z') }
  const order: string[] = []
  w.failCampaignCreateOnce = true
  let n = 0
  await assert.rejects(() => approveCampaign(plan, args, w, () => `RUN1_TOKEN_${String(++n).padStart(20, '0')}`, () => { order.push(`sql-on-disk(recipientsWritten=${w.recipients.size})`) }), /simulated crash/)
  assert.deepEqual(order, ['sql-on-disk(recipientsWritten=0)'], 'the SQL was handed over before any recipient was written')
  assert.equal(w.runtimes.size, 0, 'no campaign record exists, so nothing can send')
  assert.equal(w.recipients.size, 2, 'orphan recipients exist but are inert')
  // Re-run: the plan must not treat the orphans as "already queued", and the SQL must match the tokens now stored.
  const again = await buildCampaignPlan(DEF, csv(`Cafe One,a@x.com,${uuid(1)},,,,`, `Coffee,b@x.com,${uuid(7)},,,,`), { lookups: w })
  assert.equal(again.recipients.length, 2)
  assert.equal(again.inputHash, plan.inputHash)
  let m = 0
  const res = await approveCampaign(again, { ...args, previewHash: again.inputHash }, w, () => `RUN2_TOKEN_${String(++m).padStart(20, '0')}`)
  assert.equal(w.runtimes.size, 1)
  const stored = [...w.recipients.values()].flatMap((r) => r.state.listings!.map((l) => l.token)).sort()
  const inSql = [...res.tokenSql.matchAll(/RUN\d_TOKEN_\d+/g)].map((x) => x[0]).sort()
  assert.deepEqual(stored, inSql, 'every stored token is in the SQL, and nothing else is')
  assert.ok(stored.every((t) => t.startsWith('RUN2_')), 'never-sent orphans were refreshed with the second run\'s tokens')
})

test('expiresAt: validated, must be in the future at approval, and carried onto the campaign record', async () => {
  const w = world()
  const rows = csv(`Cafe One,a@x.com,${uuid(1)},,,,`)
  const bad = await buildCampaignPlan({ ...DEF, expiresAt: 'not-a-date' }, rows, { lookups: w })
  assert.ok(bad.issues.some((i) => i.code === 'DEF_EXPIRES'))
  const past = await buildCampaignPlan({ ...DEF, expiresAt: '2026-10-01T00:00:00Z' }, rows, { lookups: w })
  await assert.rejects(() => approveCampaign(past, { confirmRecipients: 1, previewHash: past.inputHash, templatesApproved: true, now: new Date('2026-10-12T15:00:00Z') }, w), /not in the future/)
  assert.equal(w.runtimes.size, 0)
  const ok = await buildCampaignPlan({ ...DEF, expiresAt: '2026-10-19T15:00:00Z' }, rows, { lookups: w })
  await approveCampaign(ok, { confirmRecipients: 1, previewHash: ok.inputHash, templatesApproved: true, now: new Date('2026-10-12T15:00:00Z') }, w)
  assert.equal([...w.runtimes.values()][0].expiresAt, '2026-10-19T15:00:00.000Z')
})

test('activation is blocked until approval, tokens, sender verification and the kit gate all hold', () => {
  const base = { campaign: { key: 'k', state: 'APPROVED' as const, approval: { approvedBy: 'jerry' as const, approvedAt: 'x', recipientCount: 1, inputHash: 'h', templateHash: 't' } }, tokensNeeded: ['T1', 'T2'], tokensPresent: new Set(['T1', 'T2']), senderVerified: true, kitUrlLive: true }
  assert.deepEqual(activationBlockers(base), [])
  assert.match(activationBlockers({ ...base, tokensPresent: new Set(['T1']) }).join(' '), /1 confirmation token/)
  assert.match(activationBlockers({ ...base, senderVerified: false }).join(' '), /send-as/)
  assert.match(activationBlockers({ ...base, kitUrlLive: false }).join(' '), /Activation Kit/)
  assert.match(activationBlockers({ ...base, campaign: { ...base.campaign, approval: undefined } }).join(' '), /no recorded approval/)
})

test('campaign report covers every required measure', () => {
  const r = (status: string, seq: string, steps: Array<{ kind: string; sentAt: string }> = [], next: string | null = null) => ({ status, state: { sequenceStatus: seq, stepsSent: steps }, nextCheckAt: next, nextAction: status === 'NEEDS_JERRY' ? 'Jerry: look' : null })
  const initial = { kind: 'INITIAL', sentAt: '2026-10-12T00:00:00Z' }
  const rep = summarizeCampaign({ key: 'k', state: 'ACTIVE', bounceCount: 1 }, 'k', [
    r('READY', 'QUEUED'), r('WAITING', 'ACTIVE', [initial], '2026-10-19T00:00:00Z'), r('WAITING', 'ACTIVE', [initial, { kind: 'FOLLOW_UP', sentAt: 'x' }], '2026-10-27T00:00:00Z'),
    r('DONE', 'CONFIRMED', [initial]), r('CANCELED', 'DECLINED', [initial]), r('CANCELED', 'OPTED_OUT', [initial]), r('CANCELED', 'BOUNCED', [initial]), r('NEEDS_JERRY', 'ESCALATED', [initial]), r('CANCELED', 'COMPLETE_NO_RESPONSE', [initial]),
  ], { correction_requested: 2, photo_provided: 1, partnership_interest: 1, question: 3 })
  assert.equal(rep.recipients, 9)
  assert.equal(rep.queued, 1)
  assert.equal(rep.firstTouchesSent, 8)
  assert.equal(rep.followUpsSent, 1)
  assert.equal(rep.pendingFollowUps, 2)
  assert.equal(rep.nextFollowUpDue, '2026-10-19T00:00:00Z')
  assert.equal(rep.confirmations, 1)
  assert.equal(rep.corrections, 2)
  assert.equal(rep.photos, 1)
  assert.equal(rep.bounces, 1)
  assert.equal(rep.optOuts, 1)
  assert.equal(rep.declines, 1)
  assert.equal(rep.needsJerry, 1)
  assert.equal(rep.closedNoResponse, 1)
  assert.match(renderReport(rep), /NEEDS_JERRY \.* 1/)
})
