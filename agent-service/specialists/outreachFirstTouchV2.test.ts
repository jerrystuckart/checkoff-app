import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { runBizDevTick } from './bizDevOutreach'
import { buildCampaignPlan, approveCampaign, validateDefinition, activationBlockers, type CampaignDefinition } from './outreachCampaign'
import { buildExperiencesBlock, publicItemUrlFor, DOWNLOAD_URL } from './outreachTemplates'
import { FakeGmail, MemWorld, uuid } from './outreachTestKit'

// Experience-v2 first touch. FakeGmail + MemWorld only: no network, no database, no real email.

const real = JSON.parse(readFileSync(path.join(__dirname, '../../docs/outreach-campaigns/green-bay/campaign.v2.json'), 'utf8')) as CampaignDefinition
const DEF: CampaignDefinition = { ...real, key: 'gb-v2-test', eligibilityPolicy: undefined, approvals: { firstTouchTemplate: true, followUpTemplates: true } }
const MON = new Date('2026-10-12T15:00:00Z')

async function launch(n: number, def: Partial<CampaignDefinition> = {}) {
  const w = new MemWorld()
  const rows = ['business_name,contact_email,item_id']
  for (let i = 1; i <= n; i++) {
    w.itemRows.set(uuid(500 + i), { id: uuid(500 + i), text: `Settle into a sauna session with 'Biz ${i}'.`, isActive: true, isSecret: false, metroSlug: 'green-bay' })
    rows.push(`Biz ${i},biz${i}@example.com,${uuid(500 + i)}`)
  }
  const d = { ...DEF, ...def }
  const plan = await buildCampaignPlan(d, rows.join('\n'), { lookups: w })
  assert.equal(plan.counts.errors, 0, JSON.stringify(plan.issues))
  let t = 0
  await approveCampaign(plan, { confirmRecipients: n, previewHash: plan.inputHash, templatesApproved: true, now: MON }, w, () => `TOK_${String(++t).padStart(28, '0')}`)
  for (const r of w.recipients.values()) for (const l of r.state.listings ?? []) w.tokens.add(l.token)
  await w.saveCampaign(d.key, { state: 'ACTIVE' })
  return { w, g: new FakeGmail(), d }
}
const tick = (g: FakeGmail, w: MemWorld) => { g.clock = MON; return runBizDevTick({ gmail: g, store: w, now: () => MON, sleep: async () => {} }) }

test('the shipped v2 template passes validation and carries every required element', () => {
  const issues = validateDefinition({ ...real, approvals: { firstTouchTemplate: true, followUpTemplates: true } }).filter((i) => i.severity === 'ERROR')
  assert.deepEqual(issues, [])
  for (const f of ['{{experiences_block}}', '{{download_url}}', '{{kit_url}}', '{{business_name}}', '{{metro}}']) assert.ok(real.firstTouchBody.includes(f), f)
  assert.match(real.firstTouchBody, /rather than creating a conventional business listing/)
  assert.ok(!/\b(your|our|the)\s+(\w+\s+)?listings?\b/i.test(real.firstTouchBody + real.followUp1Body + real.followUp2Body), 'no "your/the listing" wording anywhere in the sequence')
})

test('the v2 contract is enforced: missing links or "listing" wording are validation errors', () => {
  const bad = (body: string) => validateDefinition({ ...DEF, firstTouchBody: body }).filter((i) => i.severity === 'ERROR').map((i) => i.code)
  assert.ok(bad('Hi {{business_name}}, your experience: {{items_block}} kit {{kit_url}}').includes('DEF_V2_FIELD'), 'no experiences_block / download_url')
  assert.ok(bad(real.firstTouchBody.replace('{{download_url}}', 'getcheckoff.com')).includes('DEF_V2_FIELD'))
  assert.ok(bad(real.firstTouchBody.replace('{{kit_url}}', 'the kit')).includes('DEF_V2_FIELD'))
  assert.ok(bad(real.firstTouchBody + '\nConfirm your listing.').includes('DEF_V2_WORDING'))
  assert.equal(validateDefinition({ ...DEF, firstTouchContract: 'v3' as never }).some((i) => i.code === 'DEF_CONTRACT'), true)
})

test('rendered first touch: exact experience, private confirmation URL, public item URL, download and kit URLs; the public URL never holds a token', async () => {
  const { w, g } = await launch(2)
  await tick(g, w)
  assert.equal(g.sends.length, 2)
  for (const s of g.sends) {
    const r = [...w.recipients.values()].find((x) => x.email === s.to)!
    const l = r.state.listings![0]
    assert.ok(s.bodyText.includes(l.text), 'exact experience')
    assert.ok(s.bodyText.includes(l.confirmUrl), 'verified confirmation URL')
    assert.ok(s.bodyText.includes(`https://getcheckoff.com/item/${l.itemId}`), 'public item URL')
    assert.ok(s.bodyText.includes(DOWNLOAD_URL) && s.bodyText.includes('https://getcheckoff.com/downloads/featured-kit'))
    assert.match(s.bodyText, /CheckOff experience/)
    assert.ok(!/\b(your|the)\s+listing\b/i.test(s.bodyText))
    const pub = s.bodyText.match(/https:\/\/getcheckoff\.com\/item\/[^\s]+/g) ?? []
    assert.ok(pub.length === 1 && !pub[0].includes(l.token), 'the public URL carries only the item id')
  }
})

test('the public URL builder refuses malformed ids and experiences render both links in order', () => {
  assert.throws(() => publicItemUrlFor('not-a-uuid'))
  assert.equal(publicItemUrlFor('B320C748-9EB2-450A-A91A-59F4FD762629'), 'https://getcheckoff.com/item/b320c748-9eb2-450a-a91a-59f4fd762629')
  const b = buildExperiencesBlock([{ text: 'Try X', confirmUrl: 'https://getcheckoff.com/confirm/T', publicUrl: 'https://getcheckoff.com/item/I' }])
  assert.ok(b.indexOf('/item/I') < b.indexOf('/confirm/T'))
})

test('no first touch until BOTH the token and the public item page validate: hidden items and missing tokens are held individually', async () => {
  const { w, g } = await launch(4)
  w.publicHidden.add(uuid(502)) // public page would show "unavailable"
  const t3 = [...w.recipients.values()].find((r) => r.email === 'biz3@example.com')!.state.listings![0].token
  w.tokens.delete(t3) // token row missing
  const r = await tick(g, w)
  assert.deepEqual(g.sends.map((s) => s.to).sort(), ['biz1@example.com', 'biz4@example.com'])
  assert.ok(r.errors.some((e) => /public item page is not available/.test(e)))
  assert.ok(r.actions.some((a) => /held until their confirmation token exists/.test(a)))
  // Recovery: the page comes back and the token arrives -> they send, once, and the first two are not re-sent.
  w.publicHidden.clear(); w.tokens.add(t3)
  await tick(g, w)
  assert.deepEqual(g.sends.map((s) => s.to).sort(), ['biz1@example.com', 'biz2@example.com', 'biz3@example.com', 'biz4@example.com'])
})

test('a campaign whose frozen message lost a required link refuses to send and pauses (never emails a business without both URLs)', async () => {
  const { w, g, d } = await launch(1)
  const r = [...w.recipients.values()][0]
  r.state.vars = { ...r.state.vars!, experiences_block: `• ${r.state.listings![0].text}\n  Confirm: ${r.state.listings![0].confirmUrl}` } // public URL dropped
  await tick(g, w)
  assert.equal(g.sends.length, 0)
  assert.equal(w.runtimes.get(d.key)!.state, 'PAUSED')
})

test('activation also requires the download page to be live for a v2 campaign', () => {
  const base = { campaign: { key: 'k', state: 'APPROVED' as const, approval: { approvedBy: 'jerry' } as never, firstTouchContract: 'experience-v2' as const }, tokensNeeded: [], tokensPresent: new Set<string>(), senderVerified: true, kitUrlLive: true }
  assert.ok(activationBlockers({ ...base, downloadUrlLive: false }).some((b) => b.includes(DOWNLOAD_URL)))
  assert.deepEqual(activationBlockers({ ...base, downloadUrlLive: true }), [])
  assert.deepEqual(activationBlockers({ ...base, campaign: { ...base.campaign, firstTouchContract: undefined }, downloadUrlLive: false }), [], 'legacy campaigns are not affected')
})

test('case 12: nobody already contacted receives another first touch (existing recipients and prior outreach are excluded by planning)', async () => {
  const { w, g, d } = await launch(3)
  await tick(g, w)
  assert.equal(g.sends.length, 3)
  const again = await buildCampaignPlan(d, ['business_name,contact_email,item_id', `Biz 1,biz1@example.com,${uuid(501)}`, `Biz 2,biz2@example.com,${uuid(502)}`].join('\n'), { lookups: w })
  assert.equal(again.recipients.length, 0, 'recipients already in the campaign are excluded')
  const w2 = new MemWorld()
  w2.itemRows.set(uuid(900), { id: uuid(900), text: "Try 'Old Friend Cafe'.", isActive: true, isSecret: false, metroSlug: 'green-bay' })
  w2.contacts.set('old@example.com', { id: 'c-old', email: 'old@example.com', org: 'Old Friend', name: null, suppressed: false, hasOutbound: true })
  const prior = await buildCampaignPlan(d, ['business_name,contact_email,item_id', `Old Friend,old@example.com,${uuid(900)}`].join('\n'), { lookups: w2 })
  assert.equal(prior.recipients.length, 0, 'a business we already emailed is excluded unless the campaign explicitly allows prior outreach')
})
