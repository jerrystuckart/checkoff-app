#!/usr/bin/env node
// Chief Phase 2P — prepares Elkhart Lake as a Chief-originated
// relationship: creates the verified contact (Kathleen Eickhoff,
// Executive Director — confirmed live via elkhartlake.com and a 2026
// local news mention), seeds/normalizes the destination_relationship run
// at RELATIONSHIP_READY with a freshly re-dated copy of the existing DAP
// (the original archived DAP artifact in the destination_hub_lifecycle
// run is left untouched — this only re-dates a working copy for the live
// relationship push), and runs driveDestinationRelationship(), which by
// design stops at NEEDS_JERRY once outreach is drafted — this script
// never sends anything.
//
// NOTE: running this against Elkhart Lake surfaced that Jerry had
// ALREADY sent the real first-touch email before this script existed —
// see reconcileElkhartLakeRealOutreach.ts, which must be run AFTER this
// one to correct the run to reflect that reality (WAITING_FOR_REPLY, not
// a fresh outreach draft).
//
// `npx tsx agent-service/reconcileElkhartLakeRelationshipReady.ts`

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

const CONTACT_EMAIL = 'tourism@elkhartlake.com'

function reDateSequence(dap: DAPArtifact, newTargetDate: string): DAPArtifact {
  const oldTarget = new Date(dap.extracted.rightNowTask.targetDate).getTime()
  const newTarget = new Date(newTargetDate).getTime()
  const offsetMs = newTarget - oldTarget

  const relationshipSequence = dap.extracted.relationshipSequence.map((entry) => {
    const match = entry.match(/^(\d{4}-\d{2}-\d{2}):(.*)$/)
    if (!match) return entry
    const shifted = new Date(new Date(match[1]).getTime() + offsetMs).toISOString().slice(0, 10)
    return `${shifted}:${match[2]}`
  })

  return { ...dap, extracted: { ...dap.extracted, rightNowTask: { ...dap.extracted.rightNowTask, targetDate: newTargetDate }, relationshipSequence } }
}

async function main(): Promise<void> {
  const runStore = new DbPlaybookRunStore()
  const execStore = new DbExecutionStore()
  const executors = [new RemoteAiExecutor([new OpenAiAdapter(), new AnthropicMessagesAdapter()])]
  const credentialProvider = new GoogleCredentialProvider({})
  const gmail = new RealGmailAdapter({ credentialProvider })
  const calendar = new RealGoogleCalendarAdapter({ credentialProvider })
  const contacts = new RealGoogleContactsAdapter({ credentialProvider })

  const hubRun = await runStore.get(`${DESTINATION_HUB_DRIVER_PLAYBOOK_KEY}:destination-elkhart-lake-wi`)
  if (!hubRun) throw new Error('No hub-lifecycle run found for Elkhart Lake — run reconcileLegacyDestinationArtifacts.ts first.')
  const originalDap = (hubRun.state as { dap?: DAPArtifact }).dap
  if (!originalDap) throw new Error('No DAP on file for Elkhart Lake.')

  const today = new Date().toISOString().slice(0, 10)
  const refreshedDap = reDateSequence(originalDap, today)
  console.log('[relationship-ready] refreshed relationshipSequence:', refreshedDap.extracted.relationshipSequence)

  const contactId = await withWriteTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO agent.contacts (organization_name, person_name, role, email, source, notes)
       SELECT 'Elkhart Lake Tourism', 'Kathleen Eickhoff', 'Executive Director', $1, 'live_web_verification_2026-09',
         'Verified live 2026-09 via elkhartlake.com/contact-us and a 2026 local news mention (Shop & Sip 10th anniversary). No personal email publicly listed — using the Tourism office address, addressed to her by name.'
       WHERE NOT EXISTS (SELECT 1 FROM agent.contacts WHERE email = $1)
       RETURNING id`,
      [CONTACT_EMAIL]
    )
    if (res.rows.length > 0) return res.rows[0].id as string
    const existing = await client.query(`SELECT id FROM agent.contacts WHERE email = $1`, [CONTACT_EMAIL])
    return existing.rows[0].id as string
  })
  console.log('[relationship-ready] contact id:', contactId)

  const run = await driveDestinationRelationship(
    { runStore, execStore, executors, gmail, calendar, contacts, jerryCalendarId: process.env.CHIEF_JERRY_CALENDAR_ID ?? 'primary' },
    'destination-elkhart-lake-wi',
    { destinationName: 'Elkhart Lake, WI', dap: refreshedDap, dva1: null, dva2: null, contact: { contactId, name: 'Kathleen Eickhoff', email: CONTACT_EMAIL, role: 'Executive Director, Elkhart Lake Tourism' } }
  )

  console.log(`[relationship-ready] currentStage=${run.currentStage} status=${run.status}`)
  console.log('[relationship-ready] jerryReason:', run.jerryReason)
  console.log('[relationship-ready] decisionPacket:', JSON.stringify(run.decisionPacket, null, 2))
}

main()
  .catch((err) => {
    console.error('[agent-service/reconcileElkhartLakeRelationshipReady] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
