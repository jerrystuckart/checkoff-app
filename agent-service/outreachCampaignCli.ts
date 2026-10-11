#!/usr/bin/env node
// Operator CLI for business outreach campaigns. See docs/outreach-campaigns/README.md.
//
//   preview   READ-ONLY. Validates a CSV against a campaign definition and writes preview files. Writes nothing to the database.
//   approve   The ONLY command that writes campaign records. Needs the exact recipient count, the preview hash, and --templates-approved.
//             Emits token SQL for you to apply; sends nothing.
//   activate  Verifies tokens/sender/kit URL, then lets the monitor send (the monitor, not this command, sends).
//   pause / resume / report / status
//
//   npx tsx agent-service/outreachCampaignCli.ts <command> [args]

import * as fs from 'node:fs'
import * as path from 'node:path'
import { closePool } from './db'
import { RealGmailAdapter } from './specialists/googleAdapters'
import { GoogleCredentialProvider } from './specialists/googleCredentialProvider'
import { DbBizDevStore } from './specialists/bizDevOutreach'
import { DbCampaignWriter, DbIntakeLookups, loadCampaignReport } from './specialists/outreachCampaignDb'
import { activationBlockers, approveCampaign, ApprovalRefused, buildCampaignPlan, renderPreviewCsv, renderPreviewMarkdown, renderReport, type CampaignDefinition } from './specialists/outreachCampaign'
import { CANONICAL_KIT_URL } from './specialists/outreachTemplates'

function flags(argv: string[]): { pos: string[]; f: Record<string, string | true> } {
  const pos: string[] = []
  const f: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) f[a.slice(2)] = true
      else { f[a.slice(2)] = next; i++ }
    } else pos.push(a)
  }
  return { pos, f }
}

const need = (f: Record<string, string | true>, k: string): string => {
  const v = f[k]
  if (typeof v !== 'string') throw new Error(`--${k} <value> is required`)
  return v
}

function loadDefinition(p: string): CampaignDefinition {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as CampaignDefinition
}

function makeGmail(): RealGmailAdapter {
  return new RealGmailAdapter({ credentialProvider: new GoogleCredentialProvider({}) })
}

async function planFrom(f: Record<string, string | true>) {
  const def = loadDefinition(need(f, 'campaign'))
  const csv = fs.readFileSync(need(f, 'csv'), 'utf8')
  const gmail = f['gmail-check'] ? makeGmail() : undefined
  if (gmail && !gmail.isConfigured()) throw new Error('--gmail-check needs Google OAuth configured')
  return buildCampaignPlan(def, csv, { lookups: new DbIntakeLookups(gmail) })
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  const { pos, f } = flags(rest)
  const store = new DbBizDevStore()

  switch (cmd) {
    case 'preview': {
      const plan = await planFrom(f)
      const out = typeof f.out === 'string' ? f.out : path.join(__dirname, '.outreach-preview', plan.definition.key)
      fs.mkdirSync(out, { recursive: true })
      fs.writeFileSync(path.join(out, 'preview.md'), renderPreviewMarkdown(plan))
      fs.writeFileSync(path.join(out, 'recipients.csv'), renderPreviewCsv(plan))
      fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify({ counts: plan.counts, inputHash: plan.inputHash, templateHash: plan.templateHash, issues: plan.issues, excluded: plan.excluded }, null, 2))
      console.log(`Recipients ${plan.counts.recipients} · listings ${plan.counts.listings} · excluded ${plan.counts.excluded} · errors ${plan.counts.errors} · warnings ${plan.counts.warnings}`)
      console.log(`Preview hash: ${plan.inputHash}`)
      console.log(`Wrote ${out}/preview.md, recipients.csv, plan.json  (nothing was sent; nothing was written to the database)`)
      if (plan.counts.errors > 0) { console.log('\nErrors:'); for (const i of plan.issues.filter((x) => x.severity === 'ERROR')) console.log(`  - ${i.row ? `row ${i.row}: ` : ''}${i.message}`); process.exitCode = 2 }
      break
    }
    case 'approve': {
      const plan = await planFrom(f)
      const sqlPath = need(f, 'token-sql-out')
      const res = await approveCampaign(
        plan,
        { confirmRecipients: Number(need(f, 'confirm-recipients')), previewHash: need(f, 'preview-hash'), templatesApproved: f['templates-approved'] === true, now: new Date() },
        new DbCampaignWriter(),
        undefined,
        // The token SQL is on disk BEFORE any database write, so it always matches the tokens stored on the recipients.
        (sql) => {
          fs.mkdirSync(path.dirname(path.resolve(sqlPath)), { recursive: true })
          fs.writeFileSync(sqlPath, sql)
        }
      )
      console.log(`Approved campaign ${res.campaignKey}: ${res.recipientsQueued} recipients queued (${res.recipientsAlreadyPresent} already present), ${res.newTokens} new tokens.`)
      console.log(`Token SQL written to ${sqlPath}. Review and apply it, then run: activate ${res.campaignKey}`)
      console.log('Nothing has been sent. Sending starts only after `activate`.')
      break
    }
    case 'activate':
    case 'resume': {
      const key = pos[0]
      if (!key) throw new Error(`usage: ${cmd} <campaignKey>`)
      const runtimes = await store.campaignRuntimes()
      const c = runtimes.find((r) => r.key === key)
      if (!c) throw new Error(`campaign ${key} not found (or already complete)`)
      const queued = (await store.listQueued()).filter((v) => v.state.campaignKey === key)
      const tokensNeeded = queued.flatMap((v) => (v.state.listings ?? []).map((l) => l.token))
      const gmail = makeGmail()
      const senderVerified = gmail.isConfigured() && (await gmail.listSendAsIdentities()).some((i) => i.sendAsEmail.toLowerCase() === c.from.toLowerCase() && i.verificationStatus === 'accepted')
      let kitUrlLive = false
      try { kitUrlLive = (await fetch(CANONICAL_KIT_URL, { method: 'GET' })).ok } catch { kitUrlLive = false }
      const blockers = activationBlockers({ campaign: c, tokensNeeded, tokensPresent: await store.confirmTokensExist(tokensNeeded), senderVerified, kitUrlLive })
      if (blockers.length) { console.log(`Cannot ${cmd} ${key}:`); blockers.forEach((b) => console.log(`  - ${b}`)); process.exitCode = 2; break }
      await store.saveCampaign(key, { state: 'ACTIVE', pauseReason: '' })
      console.log(`Campaign ${key} is ACTIVE. The monitor sends up to ${c.dailyCap}/day (${c.batchPerTick} per 15-minute tick). Pause any time: pause ${key}`)
      break
    }
    case 'pause': {
      const key = pos[0]
      if (!key) throw new Error('usage: pause <campaignKey> [reason]')
      await store.saveCampaign(key, { state: 'PAUSED', pauseReason: pos.slice(1).join(' ') || 'Paused by Jerry' })
      console.log(`Campaign ${key} is PAUSED. No first touches or follow-ups will be sent; replies are still processed.`)
      break
    }
    case 'report':
    case 'status': {
      const key = pos[0]
      if (!key) {
        for (const c of await store.campaignRuntimes()) console.log(`${c.key}  ${c.state}  cap ${c.dailyCap}/day  approved ${c.approval?.approvedAt ?? 'NO'}`)
        break
      }
      console.log(renderReport(await loadCampaignReport(key)))
      break
    }
    default:
      console.log('commands: preview | approve | activate | pause | resume | report | status  (see docs/outreach-campaigns/README.md)')
      process.exitCode = 1
  }
}

main()
  .catch((e) => {
    console.error(e instanceof ApprovalRefused ? e.message : `[outreachCampaignCli] ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
