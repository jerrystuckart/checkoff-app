#!/usr/bin/env node
// Chief Phase 2Q — drafts the overdue follow-up to Jerry's real
// 2026-08-15 Elkhart Lake outreach (reconciled in Phase 2P via
// reconcileElkhartLakeRealOutreach.ts). Short, relationship-first, same
// thread. Stops at NEEDS_JERRY — never sends.
//
// Idempotent — safe to re-run.
//
// `npx tsx agent-service/draftElkhartLakeFollowUp.ts`

import { closePool } from './db'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { RELATIONSHIP_PLAYBOOK_KEY } from './playbooks/destinationRelationship'
import { computeNextFollowUpAt, isFollowUpDue, type FollowUpState } from './playbooks/followUpEngine'

const SENT_AT = '2026-08-15T20:01:56Z'
const CONTACT_EMAIL = 'tourism@elkhartlake.com'
const REAL_THREAD_ID = '1a00703323004d93'
const ORIGINAL_SUBJECT = 'An idea for helping Elkhart Lake visitors discover more'

async function main(): Promise<void> {
  const followUpState: FollowUpState = { attemptsMade: 0, lastContactAt: SENT_AT, requestedWaitUntil: null, parked: false }
  const now = new Date().toISOString()
  const nextDue = computeNextFollowUpAt(followUpState, now)
  const due = isFollowUpDue(nextDue, now)
  const daysSince = Math.floor((new Date(now).getTime() - new Date(SENT_AT).getTime()) / 86_400_000)
  console.log(`[follow-up] ${daysSince} days since send. Follow-up due: ${due} (next due at ${nextDue}).`)
  if (!due) {
    console.log('[follow-up] Not due yet — no draft prepared.')
    return
  }

  const store = new DbPlaybookRunStore()
  const run = await store.get(`${RELATIONSHIP_PLAYBOOK_KEY}:destination-elkhart-lake-wi`)
  if (!run) throw new Error('No destination_relationship run found for Elkhart Lake.')

  const history = (run.state as { relationshipHistory?: string[] }).relationshipHistory ?? []
  const alreadyDrafted = history.some((h) => h.includes('follow-up drafted'))

  const followUpDraft = {
    subject: `Re: ${ORIGINAL_SUBJECT}`,
    bodyText:
      "Hi Kathleen,\n\nJust circling back on the note below — totally understand if the tail end of summer has been non-stop.\n\nNo pressure at all, but if a short conversation about visitor discovery in Elkhart Lake is ever useful, I'd love to find 15 minutes whenever works for you.\n\nThanks,\nJerry",
    channel: 'email',
  }

  run.status = 'NEEDS_JERRY'
  run.jerryReason = `Elkhart Lake first-touch outreach (Kathleen Eickhoff) has had no reply in ${daysSince} days — a short follow-up is drafted and ready; sending requires Jerry.`
  run.decisionPacket = { decisionNeeded: 'Approve sending this follow-up message.', why: 'destination_relationship.send_email is APPROVAL_REQUIRED with no exception path.', to: CONTACT_EMAIL, subject: followUpDraft.subject, bodyPreview: followUpDraft.bodyText, threadId: REAL_THREAD_ID }
  run.state = {
    ...run.state,
    followUpDraft,
    relationshipHistory: alreadyDrafted ? history : [...history, `${now.slice(0, 10)}: ${daysSince} days with no reply — follow-up drafted, awaiting Jerry approval to send.`],
  }
  await store.put(run)
  console.log(`[follow-up] Elkhart Lake run updated: status=${run.status}`)
  console.log('[follow-up] draft:', JSON.stringify(followUpDraft, null, 2))
}

main()
  .catch((err) => {
    console.error('[agent-service/draftElkhartLakeFollowUp] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
