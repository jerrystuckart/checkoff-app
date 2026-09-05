#!/usr/bin/env node
// Chief Phase 2P — same reconciliation as reconcileElkhartLakeRealOutreach.ts,
// for Grand Lake. A live Gmail check while refreshing Grand Lake's status
// found Jerry had ALREADY sent a real first-touch email to Patrick
// Randall (Board President) on 2026-08-26, asking to be connected to
// Sara Sable — before this reconciliation existed. Corrects the
// relationship run to WAITING_FOR_REPLY and persists the real message as
// durable interaction evidence. Idempotent — safe to re-run.
//
// `npx tsx agent-service/reconcileGrandLakeRealOutreach.ts`

import { closePool, withWriteTransaction } from './db'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { getOrCreateRun } from './specialists/playbookRun'
import { RELATIONSHIP_PLAYBOOK_KEY } from './playbooks/destinationRelationship'

const REAL_MESSAGE_ID = '1a03eb145b89b5d7'
const REAL_THREAD_ID = '1a03eb0d533b54c7'
const CONTACT_EMAIL = 'board@grandlakechamber.com'
const SENT_AT = '2026-08-26T15:29:59Z' // Wed, 26 Aug 2026 08:29:59 -0700

async function main(): Promise<void> {
  const store = new DbPlaybookRunStore()

  // Real, verified contact route: Patrick Randall, Board President — the
  // SAME address Jerry's real email already used. Sara Sable (ED) has no
  // independently verified email; Jerry's own email confirms he believes
  // she is the new ED but explicitly asked Patrick to forward/share her
  // address, so she is not yet a confirmed direct contact route.
  const contactId = await withWriteTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO agent.contacts (organization_name, person_name, role, email, source, notes)
       SELECT 'Grand Lake Area Chamber of Commerce', 'Patrick Randall', 'Board President', $1, 'jerry_real_outreach_2026-08-26',
         'Real contact Jerry already emailed 2026-08-26, asking to be connected to Sara Sable (ED). Sara Sable herself has no independently verified email on file — a live web search 2026-09-05 could not independently corroborate her name from any public source; Jerry''s own email is the only evidence on file for it.'
       WHERE NOT EXISTS (SELECT 1 FROM agent.contacts WHERE email = $1)
       RETURNING id`,
      [CONTACT_EMAIL]
    )
    if (res.rows.length > 0) return res.rows[0].id as string
    const existing = await client.query(`SELECT id FROM agent.contacts WHERE email = $1`, [CONTACT_EMAIL])
    return existing.rows[0].id as string
  })
  console.log('[reconcile] Grand Lake contact (Patrick Randall) id:', contactId)

  const run = await getOrCreateRun(store, RELATIONSHIP_PLAYBOOK_KEY, 'destination-grand-lake', 'RELATIONSHIP_READY')
  const history = (run.state as { relationshipHistory?: string[] }).relationshipHistory ?? []
  const alreadyReconciled = history.some((h) => h.includes(REAL_MESSAGE_ID))

  run.currentStage = 'WAITING_FOR_REPLY'
  run.status = 'WAITING'
  run.jerryReason = null
  run.decisionPacket = null
  run.state = {
    ...run.state,
    destinationName: 'Grand Lake, CO',
    primaryContact: { contactId, name: 'Patrick Randall', email: CONTACT_EMAIL, role: 'Board President, Grand Lake Area Chamber of Commerce' },
    draftedOutreach: {
      subject: 'A Grand Lake idea for Denver area visitors',
      bodyText:
        'Hi Patrick,\n\nI’m Jerry Stuckart, founder of CheckOff, a free app that gives people specific local experiences to discover and complete.\n\nWe soft-launched CheckOff across Denver, Boulder, and Longmont yesterday. Our next step is adding drivable Destination Hubs that help those users turn a day trip or weekend away into deeper exploration, and Grand Lake immediately stood out.\n\nGrand Lake already attracts people for the lake and Rocky Mountain National Park, but there is a larger story across the boardwalk, restaurants, shops, theater, historic sites, outdoor experiences, and different seasons. CheckOff could help visitors discover more of that while giving Denver area users reasons to return throughout the year.\n\nI saw that Sara Sable recently joined the Chamber as Executive Director. Would you be willing to forward this to her or let me know the best email address to reach her?\n\nI’m not looking to send a large presentation or force a sales conversation during the busy season. I would simply enjoy a short conversation to learn what Grand Lake is prioritizing and see whether the idea is worth exploring further.\n\nThanks, Patrick,\n\nJerry Stuckart\nFounder, CheckOff\njerry@getcheckoff.com\nhttps://getcheckoff.com',
      channel: 'email',
    },
    outreachApproved: true,
    outreachSentReal: true,
    outreachThreadId: REAL_THREAD_ID,
    outreachMessageId: REAL_MESSAGE_ID,
    hasPriorCorrespondence: false,
    contactEmails: { [contactId]: CONTACT_EMAIL },
    contactThreadIds: { [contactId]: REAL_THREAD_ID },
    relationshipHistory: alreadyReconciled
      ? history
      : [...history, `2026-08-26: Jerry sent the real first-touch email to Patrick Randall (${CONTACT_EMAIL}), message ${REAL_MESSAGE_ID}, asking to be connected to Sara Sable — reconciled into Chief state on 2026-09-05, not Chief-drafted.`],
  }
  await store.put(run)
  console.log(`[reconcile] Grand Lake run corrected: currentStage=${run.currentStage} status=${run.status}`)

  const inserted = await withWriteTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO agent.interactions (contact_id, project_id, channel, direction, occurred_at, subject, summary, requires_action, source_ref, metadata)
       SELECT $1,
         (SELECT id FROM agent.projects WHERE project_key = 'destination-grand-lake'),
         'EMAIL', 'OUTBOUND', $2::timestamptz,
         'A Grand Lake idea for Denver area visitors',
         'Jerry sent the real first-touch outreach to Patrick Randall (Board President), asking to be connected to Sara Sable (believed new ED).',
         true,
         $3,
         $4::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM agent.interactions WHERE channel = 'EMAIL' AND source_ref = $3)`,
      [contactId, SENT_AT, `gmail:${REAL_MESSAGE_ID}`, JSON.stringify({ gmailMessageId: REAL_MESSAGE_ID, gmailThreadId: REAL_THREAD_ID })]
    )
    return res.rowCount
  })
  console.log(`[reconcile] Grand Lake outbound interaction: ${inserted ? 'created' : 'already existed'}.`)
}

main()
  .catch((err) => {
    console.error('[agent-service/reconcileGrandLakeRealOutreach] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
