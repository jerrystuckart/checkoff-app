#!/usr/bin/env node
// Chief Phase 2S — sends the three outbound emails Jerry explicitly
// approved in chat: Williams (follow-up, as drafted), Elkhart Lake
// (follow-up, as drafted), and Buena Vista (first touch, Jerry's own
// revised copy replacing the AI draft). This is the one script in this
// whole reconciliation effort that ACTUALLY SENDS — every prior script
// stopped at NEEDS_JERRY. Do not re-run this file for a new approval;
// write a new one, since it is already naturally guarded against
// double-sending the SAME approved action (sendApprovedFollowUp requires
// a live followUpDraft, cleared after sending; recordJerryDecision
// requires status === NEEDS_JERRY, no longer true after Buena Vista's
// send) — but it is not meant to be a reusable "send anything" utility.
//
// For each send: uses jerry@getcheckoff.com, preserves the existing
// Gmail thread for Williams/Elkhart Lake (Buena Vista is a genuine first
// touch — a new thread is correct), persists the real Gmail message id
// as the OUTBOUND interaction's source_ref, and returns each
// relationship to WAITING_FOR_REPLY with a fresh follow-up cadence
// checkpoint (followUpEngine.ts).
//
// `npx tsx agent-service/sendApprovedThreeOutreach.ts`

import { closePool, withWriteTransaction } from './db'
import type { PoolClient } from 'pg'
import { DbExecutionStore } from './specialists/dbExecutionStore'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { RemoteAiExecutor, AnthropicMessagesAdapter } from './specialists/remoteAiExecutor'
import { OpenAiAdapter } from './specialists/openAiAdapter'
import { RealGmailAdapter, RealGoogleCalendarAdapter, RealGoogleContactsAdapter } from './specialists/googleAdapters'
import { GoogleCredentialProvider } from './specialists/googleCredentialProvider'
import { sendApprovedFollowUp, driveDestinationRelationship, DESTINATION_RELATIONSHIP_DRIVER_PLAYBOOK_KEY, type RelationshipDriverDeps } from './specialists/destinationRelationshipDriver'
import { recordJerryDecision } from './specialists/playbookRun'

async function persistInteraction(
  client: PoolClient,
  params: { contactEmail: string; projectKey: string; subject: string; summary: string; occurredAt: string; sourceRef: string; messageId: string; threadId: string }
): Promise<void> {
  await client.query(
    `INSERT INTO agent.interactions (contact_id, project_id, channel, direction, occurred_at, subject, summary, requires_action, source_ref, metadata)
     SELECT c.id,
       (SELECT id FROM agent.projects WHERE project_key = $2),
       'EMAIL', 'OUTBOUND', $3::timestamptz, $4, $5, true, $6, $7::jsonb
     FROM agent.contacts c WHERE c.email = $1
     ON CONFLICT DO NOTHING`,
    [params.contactEmail, params.projectKey, params.occurredAt, params.subject, params.summary, params.sourceRef, JSON.stringify({ gmailMessageId: params.messageId, gmailThreadId: params.threadId })]
  )
}

async function main(): Promise<void> {
  const runStore = new DbPlaybookRunStore()
  const execStore = new DbExecutionStore()
  const executors = [new RemoteAiExecutor([new OpenAiAdapter(), new AnthropicMessagesAdapter()])]
  const credentialProvider = new GoogleCredentialProvider({})
  const gmail = new RealGmailAdapter({ credentialProvider })
  const calendar = new RealGoogleCalendarAdapter({ credentialProvider })
  const contacts = new RealGoogleContactsAdapter({ credentialProvider })
  if (!gmail.isConfigured()) throw new Error('Gmail is not configured — refusing to proceed with an approved-send script.')

  const deps: RelationshipDriverDeps = { runStore, execStore, executors, gmail, calendar, contacts, jerryCalendarId: process.env.CHIEF_JERRY_CALENDAR_ID ?? 'primary' }

  // --- 1. Williams — send the follow-up as drafted, same thread ---
  console.log('[send] Williams...')
  const williamsRun = await sendApprovedFollowUp(deps, 'destination-williams-az')
  const wState = williamsRun.state as { outreachSentReal?: boolean; outreachMessageId?: string; outreachThreadId?: string; followUp?: unknown }
  console.log(`[send] Williams: sent=${wState.outreachSentReal} messageId=${wState.outreachMessageId} threadId=${wState.outreachThreadId}`)
  await withWriteTransaction((client) =>
    persistInteraction(client, {
      contactEmail: 'jessica@wanderwestdestinations.com',
      projectKey: 'destination-williams-az',
      subject: 'Re: An idea for helping Williams visitors discover more of town',
      summary: 'Jerry sent the approved follow-up to Jessica Mitchell Remington (Wander West Destinations) — no reply to the 2026-08-17 first touch after 19+ days.',
      occurredAt: williamsRun.updatedAt,
      sourceRef: `gmail:${wState.outreachMessageId}`,
      messageId: wState.outreachMessageId!,
      threadId: wState.outreachThreadId!,
    })
  )

  // --- 2. Elkhart Lake — send the follow-up as drafted, same thread ---
  console.log('[send] Elkhart Lake...')
  const elkhartRun = await sendApprovedFollowUp(deps, 'destination-elkhart-lake-wi')
  const eState = elkhartRun.state as { outreachSentReal?: boolean; outreachMessageId?: string; outreachThreadId?: string }
  console.log(`[send] Elkhart Lake: sent=${eState.outreachSentReal} messageId=${eState.outreachMessageId} threadId=${eState.outreachThreadId}`)
  await withWriteTransaction((client) =>
    persistInteraction(client, {
      contactEmail: 'tourism@elkhartlake.com',
      projectKey: 'destination-elkhart-lake-wi',
      subject: 'Re: An idea for helping Elkhart Lake visitors discover more',
      summary: 'Jerry sent the approved follow-up to Kathleen Eickhoff (Elkhart Lake Tourism) — no reply to the 2026-08-15 first touch after 21+ days.',
      occurredAt: elkhartRun.updatedAt,
      sourceRef: `gmail:${eState.outreachMessageId}`,
      messageId: eState.outreachMessageId!,
      threadId: eState.outreachThreadId!,
    })
  )

  // --- 3. Buena Vista — replace the draft with Jerry's revised copy, then send (new thread) ---
  console.log('[send] Buena Vista...')
  const REVISED_SUBJECT = 'An idea for helping Buena Vista visitors discover more'
  const REVISED_BODY =
    'Hi Bryan,\n\nI’m Jerry Stuckart, founder of CheckOff, a free app built around helping visitors discover specific local experiences worth doing once they arrive.\n\nI’ve been looking closely at Buena Vista, and what stands out is how much there is beyond the experiences people already associate with the area. Outdoor recreation may get someone there, but there’s a much bigger opportunity around the food, shops, local favorites, smaller experiences and seasonal reasons to spend more time in town.\n\nWe’re beginning to work with smaller drive-to destinations on curated Destination Hubs designed to help visitors discover that next layer and give local businesses and experiences more visibility throughout the trip.\n\nGiven DestinationiQ’s work with Chaffee County tourism, I’d really value your perspective on whether something like this could complement what you’re already doing around visitor discovery and year-round engagement.\n\nWould you be open to a short conversation?\n\nJerry Stuckart\nFounder, CheckOff\ngetcheckoff.com'

  const runId = `${DESTINATION_RELATIONSHIP_DRIVER_PLAYBOOK_KEY}:destination-buena-vista`
  await recordJerryDecision(runStore, runId, { outreachApproved: true, draftedOutreach: { subject: REVISED_SUBJECT, bodyText: REVISED_BODY, channel: 'email' } })

  const bvRunBefore = await runStore.get(runId)
  if (!bvRunBefore) throw new Error('No Buena Vista relationship run found.')
  const bvState = bvRunBefore.state as { destinationName: string; dap: unknown; dva1: unknown; dva2: unknown; primaryContact: { contactId: string; name: string; email: string; role: string | null } }
  const bvRun = await driveDestinationRelationship(deps, 'destination-buena-vista', {
    destinationName: bvState.destinationName,
    dap: bvState.dap as never,
    dva1: bvState.dva1 as never,
    dva2: bvState.dva2 as never,
    contact: bvState.primaryContact,
  })
  const finalBvState = bvRun.state as { outreachSentReal?: boolean; outreachMessageId?: string; outreachThreadId?: string }
  console.log(`[send] Buena Vista: sent=${finalBvState.outreachSentReal} messageId=${finalBvState.outreachMessageId} threadId=${finalBvState.outreachThreadId} currentStage=${bvRun.currentStage} status=${bvRun.status}`)

  await withWriteTransaction((client) =>
    persistInteraction(client, {
      contactEmail: 'bryan@destinationiq.com',
      projectKey: 'destination-buena-vista',
      subject: REVISED_SUBJECT,
      summary: 'Jerry sent the real first-touch outreach to Bryan Jordan (DestinationiQ), introducing CheckOff and asking for a short conversation about Buena Vista visitor discovery.',
      occurredAt: bvRun.updatedAt,
      sourceRef: `gmail:${finalBvState.outreachMessageId}`,
      messageId: finalBvState.outreachMessageId!,
      threadId: finalBvState.outreachThreadId!,
    })
  )

  // Initialize the follow-up cadence for Buena Vista's first send — the
  // forward driver's own INITIAL_OUTREACH step doesn't seed this (only
  // sendApprovedFollowUp does, for the follow-up path).
  const bvFinalRun = await runStore.get(runId)
  if (bvFinalRun) {
    bvFinalRun.state = { ...bvFinalRun.state, followUp: { attemptsMade: 0, lastContactAt: bvRun.updatedAt, requestedWaitUntil: null, parked: false } }
    await runStore.put(bvFinalRun)
  }
  console.log('[send] All three sends complete. Follow-up checkpoints established.')
}

main()
  .catch((err) => {
    console.error('[agent-service/sendApprovedThreeOutreach] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
