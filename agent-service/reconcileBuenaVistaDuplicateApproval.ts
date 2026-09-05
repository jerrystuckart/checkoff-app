#!/usr/bin/env node
// Chief Phase 2R — reconciles the duplicate Buena Vista NEEDS_JERRY.
//
// Two separate playbook runs both escalated to NEEDS_JERRY for what is,
// in reality, the SAME underlying decision — approve sending Buena
// Vista's first outreach to Bryan Jordan:
//   - destination_hub_lifecycle:destination-buena-vista — the hub
//     driver's own generic "relationship is ready for initial outreach"
//     handoff gate (RELATIONSHIP_ASSETS_PREP), raised BEFORE a real
//     contact or draft existed.
//   - destination_relationship:destination-buena-vista — the actual
//     relationship run, which now holds the REAL verified contact
//     (Bryan Jordan) and the REAL AI-drafted first-touch email, and is
//     the run that will actually perform the send once approved.
//
// The hub-lifecycle run's job (D0 through D6 + the handoff) is complete
// — the relationship run has taken over and is the one true approval
// gate for this send. Marking the hub run DONE (not deleting or
// rewriting its history) removes the duplicate NEEDS_JERRY without
// losing the DAP/D6 lineage it carried.
//
// Idempotent — safe to re-run.
//
// `npx tsx agent-service/reconcileBuenaVistaDuplicateApproval.ts`

import { closePool } from './db'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { DESTINATION_HUB_DRIVER_PLAYBOOK_KEY } from './specialists/destinationHubDriver'

async function main(): Promise<void> {
  const store = new DbPlaybookRunStore()
  const hubRun = await store.get(`${DESTINATION_HUB_DRIVER_PLAYBOOK_KEY}:destination-buena-vista`)
  if (!hubRun) throw new Error('No hub-lifecycle run found for Buena Vista.')

  if (hubRun.status === 'DONE') {
    console.log('[reconcile] Buena Vista hub-lifecycle run already DONE — no-op.')
    return
  }

  hubRun.status = 'DONE'
  hubRun.jerryReason = null
  hubRun.decisionPacket = null
  hubRun.state = {
    ...hubRun.state,
    supersededBy: 'destination_relationship:destination-buena-vista',
    supersededNote: "Hub-lifecycle's own generic outreach-approval gate is superseded by the relationship run's real, contact-verified, AI-drafted approval — the same underlying send decision must not appear to Jerry as two separate ones.",
  }
  await store.put(hubRun)
  console.log('[reconcile] Buena Vista hub-lifecycle run marked DONE — superseded by destination_relationship:destination-buena-vista, the single remaining approval gate for this send.')
}

main()
  .catch((err) => {
    console.error('[agent-service/reconcileBuenaVistaDuplicateApproval] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
