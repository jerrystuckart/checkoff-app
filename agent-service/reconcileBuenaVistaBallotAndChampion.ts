#!/usr/bin/env node
// Chief Phase 2Q — updates Buena Vista's DAP context with the verified
// real-world outcome of Chaffee County Ballot Issue 1A (REJECTED,
// 2025-11-04, 58.19% no — confirmed via live search: Colorado Sun, the
// Mountain Mail, Chaffee County Times), removes the stale "verify ballot
// outcome" blocker the DAP itself flagged, and identifies/verifies the
// current likely champion/decision-maker.
//
// Live verification found a real, material change: longtime Chaffee
// County Visitors Bureau director Scott Peterson resigned, and
// DestinationiQ (the county's contracted marketing agency, already
// named in the DAP as a stakeholder/potential ally) began its own
// contract with the county on 2026-01-01 — making its owner, Bryan
// Jordan (a Buena Vista resident, bryan@destinationiq.com), the real
// current operational lead for Chaffee County tourism marketing, not
// merely a vendor. DVA-1/DVA-2 are NOT rerun — this only patches the
// DAP's own extracted fields with verified facts and moves Buena Vista
// into the relationship-ready queue with a real drafted first outreach.
// Stops at NEEDS_JERRY. Never sends.
//
// `npx tsx agent-service/reconcileBuenaVistaBallotAndChampion.ts`

import { closePool, withWriteTransaction } from './db'
import { DbExecutionStore } from './specialists/dbExecutionStore'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { RemoteAiExecutor, AnthropicMessagesAdapter } from './specialists/remoteAiExecutor'
import { OpenAiAdapter } from './specialists/openAiAdapter'
import { RealGmailAdapter, RealGoogleCalendarAdapter, RealGoogleContactsAdapter } from './specialists/googleAdapters'
import { GoogleCredentialProvider } from './specialists/googleCredentialProvider'
import { driveDestinationRelationship } from './specialists/destinationRelationshipDriver'
import { DESTINATION_HUB_DRIVER_PLAYBOOK_KEY } from './specialists/destinationHubDriver'
import type { DAPArtifact } from './playbooks/destinationHubLifecycle'

const CONTACT_EMAIL = 'bryan@destinationiq.com'

async function main(): Promise<void> {
  const runStore = new DbPlaybookRunStore()

  const hubRun = await runStore.get(`${DESTINATION_HUB_DRIVER_PLAYBOOK_KEY}:destination-buena-vista`)
  if (!hubRun) throw new Error('No hub-lifecycle run found for Buena Vista — run runBuenaVistaDap.ts first.')
  const originalDap = (hubRun.state as { dap?: DAPArtifact }).dap
  if (!originalDap) throw new Error('No DAP on file for Buena Vista.')

  // Patch the DAP's own extracted fields with the verified real outcome
  // — never regenerated, never rerun, just corrected with a fact that
  // resolves the exact blocker the DAP itself named.
  const patchedDap: DAPArtifact = {
    ...originalDap,
    extracted: {
      ...originalDap.extracted,
      recommendedChampion: 'DestinationiQ (Bryan Jordan) — contracted Chaffee County tourism marketing lead',
      likelyBuyer: 'Bryan Jordan, President/Owner, DestinationiQ (operational tourism-marketing lead for Chaffee County since the 2026-01-01 contract start, following longtime Visitors Bureau director Scott Peterson\'s resignation)',
      stakeholderOrganizations: originalDap.extracted.stakeholderOrganizations,
      timingConsiderations: [
        'VERIFIED 2026-09: Chaffee County Ballot Issue 1A was REJECTED (2025-11-04, 58.19% no) — the DMC\'s marketing budget stays at its current ~$480K/year envelope, no near-term increase. This resolves the DAP\'s own "confirm ballot outcome" blocker; pricing stays at the original conservative low-end guidance ($12,000/yr), not revised upward.',
        'VERIFIED 2026-09: longtime Visitors Bureau director Scott Peterson has resigned; DestinationiQ (contracted 2026-01-01) is now the real operational tourism-marketing lead for the county, not merely a vendor — Bryan Jordan is the practical first point of contact.',
        'DMC DestinationiQ engagement is an active, in-progress strategy process — a live window to position CheckOff as complementary',
        'Fall shoulder-season is an internal DMC priority for new programming',
      ],
      rightNowTask: {
        currentStage: 'Relationship Building',
        currentGoal: 'Open a low-key relationship with Bryan Jordan (DestinationiQ) now that the ballot-outcome and leadership-transition blockers are resolved.',
        highestPriorityTask: 'Send a short, warm first-touch email to Bryan Jordan introducing CheckOff as complementary to DestinationiQ\'s year-round marketing work, referencing the DMC\'s own stated shift toward sustained engagement.',
        targetDate: new Date().toISOString().slice(0, 10),
        estimatedTime: '30-45 minutes',
        expectedResult: 'A warm first touch that opens a conversation with the person who now actually runs Chaffee County tourism marketing.',
        whyItMatters: 'Both blockers the original DAP named (ballot outcome, org stability) are now resolved with verified facts — outreach is no longer premature.',
      },
    },
  }

  const contactId = await withWriteTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO agent.contacts (organization_name, person_name, role, email, source, notes)
       SELECT 'DestinationiQ', 'Bryan Jordan', 'President & Owner', $1, 'live_web_verification_2026-09',
         'Verified live 2026-09: Mountain Mail profile confirms Bryan Jordan as DestinationiQ owner, Buena Vista resident since 2003; DestinationiQ''s contract with Chaffee County started 2026-01-01, following longtime Visitors Bureau director Scott Peterson''s resignation — making Jordan the real current operational lead for county tourism marketing, not merely a contracted vendor.'
       WHERE NOT EXISTS (SELECT 1 FROM agent.contacts WHERE email = $1)
       RETURNING id`,
      [CONTACT_EMAIL]
    )
    if (res.rows.length > 0) return res.rows[0].id as string
    const existing = await client.query(`SELECT id FROM agent.contacts WHERE email = $1`, [CONTACT_EMAIL])
    return existing.rows[0].id as string
  })
  console.log('[reconcile] Bryan Jordan contact id:', contactId)

  const runStoreForDrive = runStore
  const execStore = new DbExecutionStore()
  const executors = [new RemoteAiExecutor([new OpenAiAdapter(), new AnthropicMessagesAdapter()])]
  const credentialProvider = new GoogleCredentialProvider({})
  const gmail = new RealGmailAdapter({ credentialProvider })
  const calendar = new RealGoogleCalendarAdapter({ credentialProvider })
  const contacts = new RealGoogleContactsAdapter({ credentialProvider })

  const run = await driveDestinationRelationship(
    { runStore: runStoreForDrive, execStore, executors, gmail, calendar, contacts, jerryCalendarId: process.env.CHIEF_JERRY_CALENDAR_ID ?? 'primary' },
    'destination-buena-vista',
    { destinationName: 'Buena Vista, CO', dap: patchedDap, dva1: null, dva2: null, contact: { contactId, name: 'Bryan Jordan', email: CONTACT_EMAIL, role: 'President & Owner, DestinationiQ' } }
  )

  console.log(`[reconcile] Buena Vista relationship run: currentStage=${run.currentStage} status=${run.status}`)
  console.log('[reconcile] jerryReason:', run.jerryReason)
  console.log('[reconcile] decisionPacket:', JSON.stringify(run.decisionPacket, null, 2))
}

main()
  .catch((err) => {
    console.error('[agent-service/reconcileBuenaVistaBallotAndChampion] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
