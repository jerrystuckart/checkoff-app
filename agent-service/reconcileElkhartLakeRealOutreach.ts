#!/usr/bin/env node
// Chief Phase 2P — reconciles a REAL, already-sent Elkhart Lake outreach
// email into operational state. While preparing Elkhart Lake as the
// first Chief-originated relationship test, a live Gmail check (the
// same hasPriorCorrespondence check destinationRelationshipDriver.ts
// already runs at RELATIONSHIP_READY) found that Jerry had ALREADY sent
// the real first-touch email to Kathleen Eickhoff on 2026-08-15 —
// before this reconciliation existed. Never draft a second "first
// touch" over a real one: this script corrects the relationship run to
// reflect that reality (WAITING_FOR_REPLY, not RELATIONSHIP_READY) and
// persists the real message as durable interaction evidence.
//
// Idempotent — safe to re-run.
//
// `npx tsx agent-service/reconcileElkhartLakeRealOutreach.ts`

import { closePool, withWriteTransaction } from './db'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { RELATIONSHIP_PLAYBOOK_KEY } from './playbooks/destinationRelationship'

const REAL_MESSAGE_ID = '1a0070448ac4701f'
const REAL_THREAD_ID = '1a00703323004d93'
const CONTACT_EMAIL = 'tourism@elkhartlake.com'
const SENT_AT = '2026-08-15T20:01:56Z' // Sat, 15 Aug 2026 13:01:56 -0700

async function main(): Promise<void> {
  const store = new DbPlaybookRunStore()
  const run = await store.get(`${RELATIONSHIP_PLAYBOOK_KEY}:destination-elkhart-lake-wi`)
  if (!run) throw new Error('No destination_relationship run found for Elkhart Lake — run the RELATIONSHIP_READY seeding step first.')

  const contactId = (run.state as { primaryContact?: { contactId?: string } }).primaryContact?.contactId
  if (!contactId) throw new Error('No primaryContact.contactId on the Elkhart Lake run — cannot correct.')

  const history = (run.state as { relationshipHistory?: string[] }).relationshipHistory ?? []
  const alreadyReconciled = history.some((h) => h.includes(REAL_MESSAGE_ID))

  run.currentStage = 'WAITING_FOR_REPLY'
  run.status = 'WAITING'
  run.jerryReason = null
  run.decisionPacket = null
  run.state = {
    ...run.state,
    draftedOutreach: {
      subject: 'An idea for helping Elkhart Lake visitors discover more',
      bodyText:
        "Hi Kathleen,\n\nI’m Jerry Stuckart, founder of CheckOff, a free app built around giving visitors specific local experiences to discover and complete.\n\nI’ve been looking closely at Elkhart Lake, and one thing really stood out to me: you already have tremendous reasons for people to come - the lake, Road America, the resorts and your seasonal events - but there seems to be an opportunity to help those visitors discover much more of the village while they’re there, and then give them a reason to come back in a different season.\n\nThat’s exactly the kind of destination CheckOff is being built for.\n\nWe’re beginning to work with smaller drive-to destinations on branded Destination Hubs that combine curated local experiences, seasonal programming and physical visitor activation around town.\n\nI know you’re still in the heart of summer, so I’m not looking to pile something onto your plate right now. But I’d love to introduce the idea and hear how you think about visitor discovery and year-round visitation in Elkhart Lake.\n\nWould you be open to a short conversation sometime in the next few weeks?\n\nJerry\nCheckOff\ngetcheckoff.com",
      channel: 'email',
    },
    outreachApproved: true,
    outreachSentReal: true,
    outreachThreadId: REAL_THREAD_ID,
    outreachMessageId: REAL_MESSAGE_ID,
    hasPriorCorrespondence: false, // false AT THE TIME this message was sent — it was itself the first touch
    contactEmails: { [contactId]: CONTACT_EMAIL },
    contactThreadIds: { [contactId]: REAL_THREAD_ID },
    relationshipHistory: alreadyReconciled
      ? history
      : [...history, `2026-08-15: Jerry sent the real first-touch email to Kathleen Eickhoff (tourism@elkhartlake.com), message ${REAL_MESSAGE_ID} — reconciled into Chief state on 2026-09-05, not Chief-drafted.`],
  }
  await store.put(run)
  console.log(`[reconcile] Elkhart Lake run corrected: currentStage=${run.currentStage} status=${run.status}`)

  const inserted = await withWriteTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO agent.interactions (contact_id, project_id, channel, direction, occurred_at, subject, summary, requires_action, source_ref, metadata)
       SELECT $1,
         (SELECT id FROM agent.projects WHERE project_key = 'destination-elkhart-lake-wi'),
         'EMAIL', 'OUTBOUND', $2::timestamptz,
         'An idea for helping Elkhart Lake visitors discover more',
         'Jerry sent the real first-touch outreach to Kathleen Eickhoff (Elkhart Lake Tourism), introducing CheckOff and asking for a short conversation.',
         true,
         $3,
         $4::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM agent.interactions WHERE channel = 'EMAIL' AND source_ref = $3)`,
      [contactId, SENT_AT, `gmail:${REAL_MESSAGE_ID}`, JSON.stringify({ gmailMessageId: REAL_MESSAGE_ID, gmailThreadId: REAL_THREAD_ID })]
    )
    return res.rowCount
  })
  console.log(`[reconcile] Elkhart Lake outbound interaction: ${inserted ? 'created' : 'already existed'}.`)
}

main()
  .catch((err) => {
    console.error('[agent-service/reconcileElkhartLakeRealOutreach] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
