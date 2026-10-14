import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { runBizDevTick } from './bizDevOutreach'
import { buildCampaignPlan, approveCampaign, validateDefinition, activationBlockers, type CampaignDefinition } from './outreachCampaign'
import { buildExperiencesBlock, publicItemUrlFor, pluralPhrases, renderTemplate, DOWNLOAD_URL } from './outreachTemplates'
import { mergeVars } from './outreachCampaign'
import { FakeGmail, MemWorld, uuid } from './outreachTestKit'

// Experience-v2 first touch. FakeGmail + MemWorld only: no network, no database, no real email.

const real = JSON.parse(readFileSync(path.join(__dirname, '../../docs/outreach-campaigns/green-bay/campaign.v2.json'), 'utf8')) as CampaignDefinition
const DEF: CampaignDefinition = { ...real, key: 'gb-v2-test', eligibilityPolicy: undefined, approvals: { firstTouchTemplate: true, followUpTemplates: true } }

// The singular text Jerry approved on 2026-10-14 (campaign.v2.json @0e75b69). One experience must still render EXACTLY this.
const APPROVED_SINGULAR = {
  "firstTouchBody": "Hi {{business_name}} team,\n\nWe're launching CheckOff in {{metro}}. It's a free app that helps people discover and check off great local experiences, and we selected {{business_name}} as one of the places worth discovering.\n\nCheckOff features specific local experiences rather than creating a conventional business listing. The CheckOff experience we selected for {{business_name}} is:\n\n{{experiences_block}}\n\nTo find it in the app, download CheckOff free at {{download_url}}, open it, and choose {{metro}}: your experience appears there. The public page above also opens it directly on your phone, no sign-in needed.\n\nThere is no fee to be included and nothing to sign up for. We feature exceptional businesses for free because a great CheckOff app needs great places.\n\nTwo quick things would help:\n- Use your private link above to confirm the experience is still accurate, or tell us what to change.\n- If you have a photo you'd prefer us to use, add it there or just reply and attach it.\n\nWe also made a free set of print, social, Story, and in-business graphics you can use: {{kit_url}}\n\nYou can reply to this email any time.\n\nThanks for being part of it!\n\nJerry Stuckart\nFounder, CheckOff\ngetcheckoff.com",
  "followUp1Body": "Hi {{business_name}} team,\n\nJust following up on the CheckOff experience we sent over for {{business_name}}.\n\nWe're helping people discover great local places around Green Bay, and we'd love to make sure we've represented your business accurately.\n\nYou can review your CheckOff experience here:\n\n{{items_block}}\n\nIf everything looks good, a quick confirmation is all we need. If something needs changing, just reply and let me know.\n\nThanks!\n\nJerry\nFounder, CheckOff\njerry@getcheckoff.com",
  "followUp2Body": "Hi {{business_name}} team,\n\nOne last note about {{business_name}} on CheckOff.\n\nWe're building a local discovery app that encourages people to get out and experience places worth visiting around Green Bay.\n\nWe'd still love your input on the CheckOff experience:\n\n{{confirm_url}}\n\nThere's no cost to confirm your information, and you're welcome to reply with corrections.\n\nI'll leave it here after this message. Thanks for everything you do for the Green Bay community!\n\nJerry\nFounder, CheckOff\njerry@getcheckoff.com"
}
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
  for (const f of ['{{experiences_block}}', '{{experience_intro}}', '{{find_in_app}}', '{{private_link_instruction}}', '{{kit_url}}', '{{business_name}}', '{{metro}}']) assert.ok(real.firstTouchBody.includes(f), f)
  assert.match(real.firstTouchBody, /rather than creating a conventional business listing/)
  assert.ok(!/\b(your|our|the)\s+(\w+\s+)?listings?\b/i.test(real.firstTouchBody + real.followUp1Body + real.followUp2Body), 'no "your/the listing" wording anywhere in the sequence')
})

test('the v2 contract is enforced: missing links or "listing" wording are validation errors', () => {
  const bad = (body: string) => validateDefinition({ ...DEF, firstTouchBody: body }).filter((i) => i.severity === 'ERROR').map((i) => i.code)
  assert.ok(bad('Hi {{business_name}}, your experience: {{items_block}} kit {{kit_url}}').includes('DEF_V2_FIELD'), 'no experiences_block / download_url')
  assert.ok(bad(real.firstTouchBody.replace('{{find_in_app}}', 'Download CheckOff.')).includes('DEF_V2_FIELD'), 'no download link at all')
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

function renderFor(items: Array<{ itemId: string; text: string; token: string }>) {
  const tokenOf = new Map(items.map((i) => [i.itemId, i.token]))
  const planned: any = { businessName: 'Vintage Cantina', email: 'x@example.invalid', contactName: null, website: null, items: items.map((i) => ({ ...i, previewToken: i.token })) }
  const vars = mergeVars(real, planned, (i: any) => tokenOf.get(i.itemId)!)
  const render = (t: string) => renderTemplate(t, vars)
  return { first: render(real.firstTouchBody), fu1: render(real.followUp1Body), fu2: render(real.followUp2Body) }
}
const ONE = [{ itemId: uuid(1), text: "Try the tacos at 'Vintage Cantina'.", token: 'TOK_ONE' }]
const TWO = [...ONE, { itemId: uuid(2), text: "Sip a tiki cocktail at 'Vintage Cantina'.", token: 'TOK_TWO' }]

test('ONE experience: the rendered first touch and both follow-ups are byte-for-byte the text Jerry approved (singular)', () => {
  const got = renderFor(ONE)
  const old = (t: string) => {
    const tokenOf = new Map(ONE.map((i) => [i.itemId, i.token]))
    const planned: any = { businessName: 'Vintage Cantina', email: 'x@example.invalid', contactName: null, website: null, items: ONE.map((i) => ({ ...i, previewToken: i.token })) }
    return renderTemplate(t, mergeVars(real, planned, (i: any) => tokenOf.get(i.itemId)!))
  }
  assert.equal(got.first, old(APPROVED_SINGULAR.firstTouchBody))
  assert.equal(got.fu1, old(APPROVED_SINGULAR.followUp1Body))
  assert.equal(got.fu2, old(APPROVED_SINGULAR.followUp2Body))
})

test('MULTIPLE experiences: plural wording throughout, every item gets its own private link, nothing singular is left behind', () => {
  const got = renderFor(TWO)
  assert.match(got.first, /The CheckOff experiences we selected are:/)
  assert.match(got.first, /Use your private links above to confirm the experiences are still accurate/)
  assert.match(got.first, /To find them in the app, download CheckOff free at https:\/\/getcheckoff\.com\/download, open it, and choose Green Bay Metro: your experiences appear there\. The public pages above also open them directly/)
  assert.ok(!/we selected for Vintage Cantina is:|your experience appears|Use your private link above|the experience is still/.test(got.first), 'no singular phrasing in the plural email')
  for (const i of TWO) assert.ok(got.first.includes(`/confirm/${i.token}`) && got.first.includes(`/item/${i.itemId}`), 'both experiences carry both links')
  assert.match(got.fu1, /Just following up on the CheckOff experiences we sent over for Vintage Cantina\./)
  assert.match(got.fu1, /You can review your CheckOff experiences here:/)
  assert.match(got.fu2, /We'd still love your input on the CheckOff experiences:/)
  for (const i of TWO) assert.ok(got.fu2.includes(`/confirm/${i.token}`), 'Follow-Up 2 links EVERY experience, not just the first')
})

test('plural/singular is decided only by the item count, and the phrase table is exact', () => {
  const p = (n: number) => pluralPhrases({ count: n, businessName: 'B', metro: 'M', downloadUrl: 'D', confirmUrls: Array.from({ length: n }, (_, i) => `U${i}`) })
  assert.equal(p(1).experience_intro, 'The CheckOff experience we selected for B is:')
  assert.equal(p(2).experience_intro, 'The CheckOff experiences we selected are:')
  assert.equal(p(5).private_link_instruction, 'Use your private links above to confirm the experiences are still accurate, or tell us what to change.')
  assert.equal(p(1).confirm_links, 'U0')
  assert.equal(p(3).confirm_links, 'U0\nU1\nU2')
})

test('the v2 contract now also requires the plural-aware fields so an old-style template cannot slip through', () => {
  const codes = (body: string) => validateDefinition({ ...DEF, firstTouchBody: body }).filter((i) => i.severity === 'ERROR').map((i) => i.code)
  assert.ok(codes(real.firstTouchBody.replace('{{experience_intro}}', 'The experience is:')).includes('DEF_V2_FIELD'))
  assert.ok(codes(real.firstTouchBody.replace('{{private_link_instruction}}', 'Use your private link.')).includes('DEF_V2_FIELD'))
  assert.deepEqual(codes(real.firstTouchBody), [])
})
