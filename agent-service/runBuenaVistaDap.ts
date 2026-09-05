#!/usr/bin/env node
// Chief Phase 2P — runs the single missing methodology stage for Buena
// Vista: DAP, using the existing canonical DVA-2 already on file
// (ingested in Phase 2O — see reconcileLegacyDestinationArtifacts.ts).
// DVA-1 and DVA-2 are NOT rerun — driveDestinationHub() picks up exactly
// where the destination_hub_lifecycle run already sits (D4_DAP) and
// calls the real methodology executor for that one stage only. The
// driver stops on its own at NEEDS_JERRY (approve outreach) once DAP
// completes — this script never sends or drafts outreach itself.
//
// `npx tsx agent-service/runBuenaVistaDap.ts`

import { closePool } from './db'
import { DbExecutionStore } from './specialists/dbExecutionStore'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { RemoteAiExecutor, AnthropicMessagesAdapter } from './specialists/remoteAiExecutor'
import { OpenAiAdapter } from './specialists/openAiAdapter'
import { driveDestinationHub } from './specialists/destinationHubDriver'

async function main(): Promise<void> {
  const runStore = new DbPlaybookRunStore()
  const execStore = new DbExecutionStore()
  const executors = [new RemoteAiExecutor([new OpenAiAdapter(), new AnthropicMessagesAdapter()])]

  const before = await runStore.get('destination_hub_lifecycle:destination-buena-vista')
  console.log(`[dap] BEFORE stage=${before?.currentStage} status=${before?.status}`)

  // The run already sits at D4_DAP (seeded by Phase 2O's reconciliation),
  // so stepD0 — the only step that reads the discovery-screen fields
  // below — is never reached. They're filled with plausible-but-unused
  // placeholders solely to satisfy the type; never treat them as a real
  // D0 screen for Buena Vista.
  const run = await driveDestinationHub({ runStore, execStore, executors }, 'destination-buena-vista', {
    candidate: {
      destinationId: 'destination-buena-vista',
      destinationName: 'Buena Vista, CO',
      name: 'Buena Vista',
      state: 'CO',
      manageableGeography: true,
      stakeholderComplexity: 'MEDIUM',
      tourismIdentity: true,
      sufficientThingsToDo: true,
      localBusinessDensity: 'MEDIUM',
      compellingStoryFit: true,
      likelyDecisionMakerAccessible: true,
    },
  })

  console.log(`[dap] AFTER stage=${run.currentStage} status=${run.status}`)
  console.log('[dap] jerryReason:', run.jerryReason)
  const state = run.state as { dap?: { extracted: { recommendedChampion: string | null; likelyBuyer: string | null } } }
  if (state.dap) {
    console.log('[dap] recommendedChampion:', state.dap.extracted.recommendedChampion)
    console.log('[dap] likelyBuyer:', state.dap.extracted.likelyBuyer)
  } else {
    console.log('[dap] No DAP produced this run.')
  }
}

main()
  .catch((err) => {
    console.error('[agent-service/runBuenaVistaDap] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
