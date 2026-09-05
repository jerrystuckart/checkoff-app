#!/usr/bin/env node
// Chief Phase 2Q — reconciles Jerry's REAL, already-sent Williams AZ
// outreach into operational state, and (since it is now well overdue)
// drafts a short in-thread follow-up — stopping at NEEDS_JERRY, never
// sending.
//
// Live verification found the recipient, jessica@wanderwestdestinations.com,
// is Jessica Mitchell Remington, Director of Travel Industry Marketing at
// Wander West Destinations — the CONTRACTED destination-marketing agency
// for "Experience Williams" (confirmed: wanderwestdestinations.com/our-clients
// lists Experience Williams as a client). This is the real "person
// responsible for destination marketing" the DAP was looking for — not a
// fabricated or reused stale Chamber name (Thomas P. Kelley / Donna
// Cochran, which the DAP itself already flagged as dated).
//
// Idempotent — safe to re-run.
//
// `npx tsx agent-service/reconcileWilliamsRealOutreach.ts`

import { closePool, withWriteTransaction } from './db'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { getOrCreateRun } from './specialists/playbookRun'
import { RELATIONSHIP_PLAYBOOK_KEY } from './playbooks/destinationRelationship'
import { RealGmailAdapter } from './specialists/googleAdapters'
import { GoogleCredentialProvider } from './specialists/googleCredentialProvider'
import { computeNextFollowUpAt, isFollowUpDue, type FollowUpState } from './playbooks/followUpEngine'

const REAL_MESSAGE_ID = '1a0116ccd388c551'
const REAL_THREAD_ID = '1a011672d990ad54'
const CONTACT_EMAIL = 'jessica@wanderwestdestinations.com'
const SENT_AT = '2026-08-17T20:32:18Z' // Mon, 17 Aug 2026 13:32:18 -0700

const ORIGINAL_SUBJECT = 'An idea for helping Williams visitors discover more of town'
const ORIGINAL_BODY =
  "Hi Jessica,\n\nI’m Jerry Stuckart, founder of CheckOff, a free app built around giving visitors specific local experiences to discover and complete.\n\nI’ve been looking closely at Williams, and there’s an opportunity that really jumped out at me.\n\nYou already have enormous reasons for people to arrive - Route 66, the Grand Canyon Railway, Bearizona and the Grand Canyon itself. What interests me is the next layer: helping someone who came for one of those anchors discover the restaurants, shops, local history, outdoor experiences and other things that turn Williams from a stop into more of the trip.\n\nThat’s the problem CheckOff is designed to solve.\n\nWe’re beginning to work with smaller drive-to destinations on branded Destination Hubs built around curated experiences, seasonal reasons to return and visitor activation around town.\n\nWilliams especially caught my attention because the experience can be so different from one season to the next.\n\nI’d love to introduce what we’re building and, more importantly, hear how you currently think about getting visitors beyond the major anchors and into more of Williams.\n\nWould you be open to a short conversation?\n\nJerry\nCheckOff\ngetcheckoff.com"

async function main(): Promise<void> {
  const credentialProvider = new GoogleCredentialProvider({})
  const gmail = new RealGmailAdapter({ credentialProvider })

  // 1. Verify the real message is still there and check for any reply in the thread.
  const found = await gmail.searchMessages(`subject:"${ORIGINAL_SUBJECT}"`)
  if (!found.some((m) => m.id === REAL_MESSAGE_ID)) throw new Error(`Real Williams outreach message ${REAL_MESSAGE_ID} not found via live Gmail search — aborting rather than guessing.`)
  const threadMessages = await gmail.searchMessages(`in:anywhere ${CONTACT_EMAIL}`)
  const hasReply = threadMessages.some((m) => m.threadId === REAL_THREAD_ID && m.id !== REAL_MESSAGE_ID)
  console.log(`[reconcile] Real message confirmed via live search. Reply in thread: ${hasReply}`)

  // 2. Real, verified contact.
  const contactId = await withWriteTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO agent.contacts (organization_name, person_name, role, email, source, notes)
       SELECT 'Wander West Destinations (contracted marketing agency for Experience Williams)', 'Jessica Mitchell Remington', 'Director of Travel Industry Marketing', $1, 'live_web_verification_2026-09',
         'Verified live 2026-09: wanderwestdestinations.com/our-clients lists Experience Williams as a client; LinkedIn search corroborates her title. Not Chamber staff directly — she is the contracted destination-marketing contact, which is who Jerry actually reached and who is responsible for Williams visitor promotion.'
       WHERE NOT EXISTS (SELECT 1 FROM agent.contacts WHERE email = $1)
       RETURNING id`,
      [CONTACT_EMAIL]
    )
    if (res.rows.length > 0) return res.rows[0].id as string
    const existing = await client.query(`SELECT id FROM agent.contacts WHERE email = $1`, [CONTACT_EMAIL])
    return existing.rows[0].id as string
  })
  console.log('[reconcile] Contact id (Jessica Mitchell Remington):', contactId)

  // 3. Determine whether a follow-up is due (Chief's own followUpEngine.ts, never a second competing clock).
  const followUpState: FollowUpState = { attemptsMade: 0, lastContactAt: SENT_AT, requestedWaitUntil: null, parked: false }
  const now = new Date().toISOString()
  const nextDue = computeNextFollowUpAt(followUpState, now)
  const due = isFollowUpDue(nextDue, now)
  const daysSince = Math.floor((new Date(now).getTime() - new Date(SENT_AT).getTime()) / 86_400_000)
  console.log(`[reconcile] ${daysSince} days since send. Follow-up due: ${due} (next due at ${nextDue}).`)

  // 4. Correct the relationship run to WAITING_FOR_REPLY (never a duplicate first-touch draft).
  const store = new DbPlaybookRunStore()
  const run = await getOrCreateRun(store, RELATIONSHIP_PLAYBOOK_KEY, 'destination-williams-az', 'RELATIONSHIP_READY')
  const history = (run.state as { relationshipHistory?: string[] }).relationshipHistory ?? []
  const alreadyReconciled = history.some((h) => h.includes(REAL_MESSAGE_ID))

  const followUpDraft = due && !hasReply
    ? {
        subject: `Re: ${ORIGINAL_SUBJECT}`,
        bodyText:
          "Hi Jessica,\n\nJust following up on the note below — I know late summer/early fall gets busy with client work, so no pressure at all.\n\nIf it's easier, I'm happy to send a couple of specific examples of what a Williams Destination Hub could look like, or just grab 15 minutes whenever works. Either way, I'd still love to hear how you and Experience Williams currently think about the \"beyond the anchors\" piece.\n\nThanks again,\nJerry",
        channel: 'email',
      }
    : null

  run.currentStage = 'WAITING_FOR_REPLY'
  run.status = followUpDraft ? 'NEEDS_JERRY' : 'WAITING'
  run.jerryReason = followUpDraft ? 'Williams, AZ first-touch outreach (Jessica Mitchell Remington) has had no reply in over 2 weeks — a short follow-up is drafted and ready; sending requires Jerry.' : null
  run.decisionPacket = followUpDraft
    ? { decisionNeeded: 'Approve sending this follow-up message.', why: 'destination_relationship.send_email is APPROVAL_REQUIRED with no exception path.', to: CONTACT_EMAIL, subject: followUpDraft.subject, bodyPreview: followUpDraft.bodyText, threadId: REAL_THREAD_ID }
    : null
  run.state = {
    ...run.state,
    destinationName: 'Williams, AZ',
    primaryContact: { contactId, name: 'Jessica Mitchell Remington', email: CONTACT_EMAIL, role: 'Director of Travel Industry Marketing, Wander West Destinations (Experience Williams\' contracted marketing agency)' },
    draftedOutreach: { subject: ORIGINAL_SUBJECT, bodyText: ORIGINAL_BODY, channel: 'email' },
    followUpDraft,
    outreachApproved: true,
    outreachSentReal: true,
    outreachThreadId: REAL_THREAD_ID,
    outreachMessageId: REAL_MESSAGE_ID,
    hasPriorCorrespondence: false,
    contactEmails: { [contactId]: CONTACT_EMAIL },
    contactThreadIds: { [contactId]: REAL_THREAD_ID },
    relationshipHistory: alreadyReconciled
      ? history
      : [
          ...history,
          `2026-08-17: Jerry sent the real first-touch email to Jessica Mitchell Remington (${CONTACT_EMAIL}), message ${REAL_MESSAGE_ID} — reconciled into Chief state on ${now.slice(0, 10)}, not Chief-drafted.`,
          ...(followUpDraft ? [`${now.slice(0, 10)}: ${daysSince} days with no reply — follow-up drafted, awaiting Jerry approval to send.`] : []),
        ],
  }
  await store.put(run)
  console.log(`[reconcile] Williams run corrected: currentStage=${run.currentStage} status=${run.status}`)

  // 5. Persist the real outbound interaction as durable evidence.
  const inserted = await withWriteTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO agent.interactions (contact_id, project_id, channel, direction, occurred_at, subject, summary, requires_action, source_ref, metadata)
       SELECT $1,
         (SELECT id FROM agent.projects WHERE project_key = 'destination-williams-az'),
         'EMAIL', 'OUTBOUND', $2::timestamptz,
         $3,
         'Jerry sent the real first-touch outreach to Jessica Mitchell Remington (Wander West Destinations, Experience Williams'' contracted marketing agency), introducing CheckOff and asking for a short conversation.',
         true,
         $4,
         $5::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM agent.interactions WHERE channel = 'EMAIL' AND source_ref = $4)`,
      [contactId, SENT_AT, ORIGINAL_SUBJECT, `gmail:${REAL_MESSAGE_ID}`, JSON.stringify({ gmailMessageId: REAL_MESSAGE_ID, gmailThreadId: REAL_THREAD_ID })]
    )
    return res.rowCount
  })
  console.log(`[reconcile] Williams outbound interaction: ${inserted ? 'created' : 'already existed'}.`)
}

main()
  .catch((err) => {
    console.error('[agent-service/reconcileWilliamsRealOutreach] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
