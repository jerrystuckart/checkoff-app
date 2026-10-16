import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { runBizDevTick } from './bizDevOutreach'
import { buildCampaignPlan, approveCampaign, validateDefinition, type CampaignDefinition } from './outreachCampaign'
import { FakeGmail, MemWorld, uuid } from './outreachTestKit'

// invitation-v1: Willcox non-featured businesses. No experience, no token, no item link, ever. Fakes only.
const real = JSON.parse(readFileSync(path.join(__dirname, '../../docs/outreach-campaigns/willcox/campaign.invitation.json'), 'utf8')) as CampaignDefinition
const DEF: CampaignDefinition = { ...real, key: 'willcox-invite-test', eligibilityPolicy: undefined }
const NOW = new Date('2026-10-16T18:00:00Z')

test('the shipped invitation definition is valid and carries no experience/token/item fields', () => {
  assert.deepEqual(validateDefinition(real).filter((i) => i.severity === 'ERROR'), [])
  assert.ok(real.firstTouchBody.includes('{{kit_url}}'))
  assert.ok(!/getcheckoff\.com\/(confirm|item)\//.test(real.firstTouchBody))
})

test('the invitation contract refuses any experience, token or item field', () => {
  const codes = (b: string) => validateDefinition({ ...DEF, firstTouchBody: b }).map((i) => i.code)
  assert.ok(codes(real.firstTouchBody + '\n{{experiences_block}}').includes('DEF_INVITATION_FIELD'))
  assert.ok(codes(real.firstTouchBody + '\n{{confirm_url}}').includes('DEF_INVITATION_FIELD'))
  assert.ok(codes(real.firstTouchBody + '\nhttps://getcheckoff.com/item/abc').includes('DEF_INVITATION_LINK'))
})

test('an invitation row with an item_id is refused (it would imply a listing)', async () => {
  const w = new MemWorld()
  const plan = await buildCampaignPlan(DEF, `business_name,contact_email,item_id,contact_name\nBiz,biz@example.com,${uuid(1)},Pat`, { lookups: w })
  assert.ok(plan.issues.some((i) => i.code === 'ROW_INVITATION_ITEM'))
})

test('end to end: approve mints no token, the monitor sends the invitation with the kit link only, and a second tick never resends', async () => {
  const w = new MemWorld()
  const plan = await buildCampaignPlan(DEF, 'business_name,contact_email,contact_name\nBear,bear@example.com,Bear\nSoaring Wines,info@example.org,Soaring Wines team', { lookups: w })
  assert.equal(plan.counts.errors, 0, JSON.stringify(plan.issues))
  assert.equal(plan.counts.newTokensNeeded, 0)
  const res = await approveCampaign(plan, { confirmRecipients: 2, previewHash: plan.inputHash, templatesApproved: true, now: NOW }, w)
  assert.equal(res.newTokens, 0)
  await w.saveCampaign(DEF.key, { state: 'ACTIVE' })
  const g = new FakeGmail(); g.clock = NOW
  await runBizDevTick({ gmail: g, store: w, now: () => NOW, sleep: async () => {} })
  assert.equal(g.sends.length, 2)
  for (const m of g.sends) {
    assert.match(m.bodyText, /^Hi (Bear|Soaring Wines team),/)
    assert.ok(m.bodyText.includes('https://getcheckoff.com/willcox/kit'))
    assert.ok(!/getcheckoff\.com\/(confirm|item)\//.test(m.bodyText))
    assert.ok(!/featured/i.test(m.bodyText))
  }
  await runBizDevTick({ gmail: g, store: w, now: () => NOW, sleep: async () => {} })
  assert.equal(g.sends.length, 2)
})

test('Willcox follow-ups are HELD: nothing is due even long after the schedule, until the campaign key is released', async () => {
  const { campaignToDef, FOLLOW_UPS_HELD_CAMPAIGNS } = await import('./bizDevCampaign')
  const { dueAction } = await import('./bizDevOutreach')
  assert.ok(FOLLOW_UPS_HELD_CAMPAIGNS.has('willcox-launch-featured-v1') && FOLLOW_UPS_HELD_CAMPAIGNS.has('willcox-launch-invitation-v1'))
  const base = { state: 'ACTIVE', metroLabel: 'Willcox', from: 'jerry@getcheckoff.com', subjectTemplate: 's', firstTouchBody: 'b', followUps: [{ step: 2, afterBusinessDays: 30, bodyText: 'x' }], closeAfterBusinessDays: 30, maxOutbound: 3, faqEnabled: false, name: 'n', taskId: 't' } as never
  const state = { sequenceStatus: 'ACTIVE', stepsSent: [{ step: 1, kind: 'INITIAL', messageId: 'm', sentAt: '2026-10-16T15:00:00Z' }] } as never
  const far = new Date('2027-06-01T00:00:00Z')
  assert.equal(dueAction(campaignToDef({ ...(base as object), key: 'willcox-launch-featured-v1' } as never), state, far).kind, 'NONE')
  assert.equal(dueAction(campaignToDef({ ...(base as object), key: 'willcox-launch-invitation-v1' } as never), state, far).kind, 'NONE')
  assert.equal(dueAction(campaignToDef({ ...(base as object), key: 'green-bay-p1' } as never), state, far).kind, 'SEND')
})
