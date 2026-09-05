#!/usr/bin/env node
// Chief Phase 2N — reconciles Jerry's REAL manual reply to Desiree Gerth
// (Willcox) into operational state. Jerry replied directly in Gmail after
// Chief's Phase 2M NEEDS_JERRY task ("Willcox — confirm pricing with
// Desiree before Thursday Chamber board vote") surfaced the need — this
// script never sends anything; it only reads the real Sent message
// (already verified: message id 1a0726835de40856, same thread as
// Desiree's original 1a071eba028425e5, sent Sat 5 Sep 2026 09:30:25 -0700,
// confirms pricing and answers board questions ahead of the Thursday
// 2026-09-10 Chamber vote) and persists that fact.
//
// Idempotent — safe to re-run:
//   1. transitionTask(NEEDS_JERRY -> DONE) on the Phase 2M task, guarded
//      by expectedUpdatedAt + an idempotencyKey (a second run sees the
//      task already DONE and is a no-op).
//   2. INSERT ... ON CONFLICT DO NOTHING for the outbound interaction,
//      keyed by the existing (channel, source_ref) unique index.
//   3. createTask() for the new WAITING checkpoint — idempotent via
//      (source_type, source_ref), same as every other task this codebase
//      creates.
//
// No destination_relationship playbook run is created or assumed — none
// exists yet for Willcox (confirmed in Phase 2M), and this script does
// not fabricate one. The waiting state is represented the same way
// Grand Lake/Rim Country's pre-existing follow-up state already is: a
// plain WAITING task under the destination's own project.
//
// `npx tsx agent-service/reconcileWillcoxJerryReply.ts`

import { closePool, withWriteTransaction } from './db'
import { getTaskBySource } from './queries'
import { createTask, transitionTask } from './mutations'

const ACTOR = 'chief'

const NEEDS_JERRY_SOURCE_TYPE = 'gmail_forwarded_message_reclassification'
const NEEDS_JERRY_SOURCE_REF = 'gmail:1a071eba028425e5'

const JERRY_REPLY_GMAIL_MESSAGE_ID = '1a0726835de40856'
const JERRY_REPLY_GMAIL_THREAD_ID = '1a071eba028425e5' // same thread as Desiree's original message
const JERRY_REPLY_SENT_AT = '2026-09-05T16:30:25Z' // Sat, 5 Sep 2026 09:30:25 -0700
const DESIREE_EMAIL = 'dez@strivevineyards.com'

const BOARD_VOTE_SOURCE_TYPE = 'destination_relationship_checkpoint'
const BOARD_VOTE_SOURCE_REF = 'willcox-chamber-board-vote-2026-09-10'
// The email only says "this upcoming Thursday" relative to a Sat 2026-09-05
// send — the next Thursday is 2026-09-10. No specific meeting TIME was
// given anywhere, so the checkpoint is set to that evening as a
// deliberately approximate "check back after the vote" point, not a
// precise meeting time we don't actually have.
const BOARD_VOTE_CHECK_AT = new Date('2026-09-10T20:00:00Z')

async function completeNeedsJerryTask(): Promise<void> {
  const task = await getTaskBySource(NEEDS_JERRY_SOURCE_TYPE, NEEDS_JERRY_SOURCE_REF)
  if (!task) {
    throw new Error(`Expected the Phase 2M NEEDS_JERRY task (${NEEDS_JERRY_SOURCE_TYPE}/${NEEDS_JERRY_SOURCE_REF}) to exist — run reconcileDestinationPortfolioNeedsJerry.ts first.`)
  }
  if (task.status === 'DONE') {
    console.log(`[reconcile] NEEDS_JERRY task ${task.id} already DONE — no-op.`)
    return
  }
  const result = await transitionTask({
    taskId: task.id,
    toStatus: 'DONE',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: task.updatedAt,
    idempotencyKey: `willcox-jerry-reply-completion:${JERRY_REPLY_GMAIL_MESSAGE_ID}`,
    note: `Jerry replied directly to Desiree in Gmail (message ${JERRY_REPLY_GMAIL_MESSAGE_ID}, same thread), confirming the proposed pricing and answering additional board questions ahead of the Thursday board vote. No duplicate follow-up is needed.`,
    reconciliation: {
      evidenceCategory: 'COMPLETION_PROOF',
      evidenceSources: [`gmail:${JERRY_REPLY_GMAIL_MESSAGE_ID}`],
      evidenceSummary: "Jerry's real Sent-mail reply to dez@strivevineyards.com confirms pricing and answers board questions before the Chamber vote — the exact action this task asked for.",
    },
  })
  console.log(`[reconcile] NEEDS_JERRY task ${task.id}: transitioned to DONE (changed=${result.changed}).`)
}

async function recordOutboundInteraction(): Promise<void> {
  const inserted = await withWriteTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO agent.interactions (contact_id, project_id, channel, direction, occurred_at, subject, summary, requires_action, source_ref, metadata)
       SELECT
         (SELECT id FROM agent.contacts WHERE email = $1),
         (SELECT id FROM agent.projects WHERE project_key = 'destination-willcox'),
         'EMAIL', 'OUTBOUND', $2::timestamptz,
         'Re: Reviewing Check-Off App before Chamber meeting',
         $3,
         false,
         $4,
         $5::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM agent.interactions WHERE channel = 'EMAIL' AND source_ref = $4)
       RETURNING id`,
      [
        DESIREE_EMAIL,
        JERRY_REPLY_SENT_AT,
        "Jerry confirmed the proposed Willcox pricing is correct and provided additional detail for the board: content/business selection approach (~50-60 curated experiences), a Chamber review sheet (Include/Exclude/Discuss), business verification/outreach options, non-business experience categories, and next steps if the board approves. Invited any further questions before Thursday's vote.",
        `gmail:${JERRY_REPLY_GMAIL_MESSAGE_ID}`,
        JSON.stringify({ gmailMessageId: JERRY_REPLY_GMAIL_MESSAGE_ID, gmailThreadId: JERRY_REPLY_GMAIL_THREAD_ID, inReplyToSourceRef: NEEDS_JERRY_SOURCE_REF }),
      ]
    )
    return res.rows.length > 0
  })
  console.log(`[reconcile] outbound interaction (gmail:${JERRY_REPLY_GMAIL_MESSAGE_ID}): ${inserted ? 'created' : 'already existed'}.`)
}

async function createBoardVoteWaitingCheckpoint(): Promise<void> {
  const result = await createTask({
    title: 'Willcox — awaiting Chamber board vote (Thursday 2026-09-10)',
    projectKey: 'destination-willcox',
    status: 'WAITING',
    changedByOwnerKey: ACTOR,
    ownerKey: ACTOR,
    description:
      "Jerry confirmed pricing and answered the board's outstanding questions on 2026-09-05 (gmail thread 1a071eba028425e5). The Willcox Chamber board is expected to vote on adopting CheckOff at its meeting this Thursday, 2026-09-10 — no exact meeting time is known, so this checkpoint is deliberately approximate. No destination_relationship playbook run exists for Willcox yet (it predates that driver); this task tracks the waiting state directly.",
    nextAction: "Check for a reply from Desiree/the Chamber about the board's decision on or shortly after 2026-09-10. If nothing has arrived, follow up.",
    nextCheckAt: BOARD_VOTE_CHECK_AT,
    sourceType: BOARD_VOTE_SOURCE_TYPE,
    sourceRef: BOARD_VOTE_SOURCE_REF,
  })
  console.log(`[reconcile] Willcox board-vote WAITING checkpoint: ${result.created ? 'created' : 'already existed'} (task ${result.task.id}, nextCheckAt=${BOARD_VOTE_CHECK_AT.toISOString()}).`)
}

async function main(): Promise<void> {
  await completeNeedsJerryTask()
  await recordOutboundInteraction()
  await createBoardVoteWaitingCheckpoint()
}

main()
  .catch((err) => {
    console.error('[agent-service/reconcileWillcoxJerryReply] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
