#!/usr/bin/env node
// READ-ONLY dry run of the business-outreach engine against the REAL database and REAL Gmail.
// Every database write and every email send is intercepted and printed, never executed. Use it to
// prove what the monitor WOULD do (e.g. right after a merge, before a restart; or "as of" a future
// date to see exactly what Blair's next follow-up will do).
//
//   npx tsx agent-service/verifyBizDevReadOnly.ts [--now 2026-10-16T19:30:00Z]

import { createHash } from 'node:crypto'
import { closePool } from './db'
import { DbBizDevStore, runBizDevTick, type BizDevState } from './specialists/bizDevOutreach'
import { RealGmailAdapter, type GmailSendInput } from './specialists/googleAdapters'
import { GoogleCredentialProvider } from './specialists/googleCredentialProvider'

const log: Array<Record<string, unknown>> = []

class InterceptingStore extends DbBizDevStore {
  async claimStep(_t: string, step: number) { log.push({ op: 'claimStep', step }); return true }
  async saveState(_t: string, s: BizDevState) { log.push({ op: 'saveState', sequenceStatus: s.sequenceStatus, steps: s.stepsSent.length, thread: s.threadId }) }
  async recordInteraction(i: { direction: string; subject: string; summary: string }) { log.push({ op: 'interaction', direction: i.direction, subject: i.subject, summary: i.summary }) }
  async suppressContact() { log.push({ op: 'suppressContact' }) }
  async setPlan(_t: string, p: { nextCheckAt: Date; nextAction: string }) { log.push({ op: 'setPlan', nextCheckAt: p.nextCheckAt.toISOString(), nextAction: p.nextAction }) }
  async transition(_t: string, to: string, d: { nextAction?: string; nextCheckAt?: Date; jerryRequest?: string }) { log.push({ op: 'transition', to, nextCheckAt: d.nextCheckAt?.toISOString(), nextAction: d.nextAction, jerryRequest: d.jerryRequest?.slice(0, 100) }) }
  async saveCampaign(key: string, patch: Record<string, unknown>) { log.push({ op: 'saveCampaign', key, state: patch.state }) }
  async setCampaignProgress() { /* a write: intercepted */ }
}

class NoSendGmail extends RealGmailAdapter {
  async sendMessage(input: GmailSendInput) {
    log.push({ op: 'WOULD_SEND', to: input.to, from: input.from, subject: input.subject, threadId: input.threadId, bodyChars: input.bodyText.length, bodySha1: createHash('sha1').update(input.bodyText).digest('hex').slice(0, 10) })
    return { messageId: 'NOT-SENT', threadId: input.threadId ?? 'NOT-SENT' }
  }
}

async function main(): Promise<void> {
  const i = process.argv.indexOf('--now')
  const now = i >= 0 ? new Date(process.argv[i + 1]) : new Date()
  const gmail = new NoSendGmail({ credentialProvider: new GoogleCredentialProvider({}) })
  const store = new InterceptingStore()
  const active = await store.listActive()
  const res = await runBizDevTick({ gmail, store, now: () => now, sleep: async () => {} })
  console.log(JSON.stringify({ asOf: now.toISOString(), activeSequences: active.map((v) => ({ contact: v.contactEmail, sequenceKey: v.state.sequenceKey, sequenceStatus: v.state.sequenceStatus, stepsSent: v.state.stepsSent.length, thread: v.state.threadId })), actions: res.actions, errors: res.errors, interceptedWrites: log }, null, 2))
  console.log('\nNothing was written and nothing was sent. Every operation above was intercepted.')
}

main()
  .catch((e) => { console.error('[verifyBizDevReadOnly]', e instanceof Error ? e.message : String(e)); process.exitCode = 1 })
  .finally(() => { void closePool() })
