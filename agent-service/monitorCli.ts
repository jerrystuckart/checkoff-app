#!/usr/bin/env node
// Chief Phase 2J/2K — the production Gmail monitor entrypoint. Run under
// whatever process supervisor Jerry chooses (pm2, systemd, launchd, or a
// persistent terminal/tmux session) — agent-service has no existing
// always-on host to reuse, so this IS the durable process, not a wrapper
// around one. Restart safety (Phase 2K) comes from Postgres — the
// checkpoint and contact directory are backed by
// DbGmailCheckpointStore/DbContactDirectory (agent.tasks/agent.task_events,
// same pattern as DbExecutionStore/DbPlaybookRunStore), never a local
// file — so this process can restart on the SAME machine or move to a
// different one entirely with zero loss of state, exactly like the
// destination-relationship runs it drives already do.
//
// Usage: tsx agent-service/monitorCli.ts
// Env: AGENT_SERVICE_DATABASE_URL must be set (same variable every other
//      DB-backed store in this repo uses — loaded via db.ts's .env side
//      effect, see the import below).
//      GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
//      (see googleCredentialProvider.ts) must be set — run
//      agent-service/googleAuthorize.ts once first if they aren't yet.
//      CHIEF_GMAIL_POLL_INTERVAL_MINUTES overrides the default 15.
//      CHIEF_JERRY_CALENDAR_ID — Jerry's calendar id for freeBusy checks
//      (defaults to "primary").
//
// This process does NOT send outreach or create calendar events on its
// own — those stay APPROVAL_REQUIRED, gated inside destinationRelationshipDriver.ts
// exactly as before. It only polls, associates, classifies, and advances
// relationship state — all AUTO per standingAuthority.ts.

import './db' // .env side effect (AGENT_SERVICE_DATABASE_URL, GOOGLE_*) — same convention every other DB-backed entrypoint in this repo relies on
import { DbExecutionStore } from './specialists/dbExecutionStore'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { DbGmailCheckpointStore, DbContactDirectory } from './specialists/dbGmailCheckpointStore'
import { RemoteAiExecutor, AnthropicMessagesAdapter } from './specialists/remoteAiExecutor'
import { OpenAiAdapter } from './specialists/openAiAdapter'
import { RealGmailAdapter, RealGoogleCalendarAdapter, RealGoogleContactsAdapter } from './specialists/googleAdapters'
import { GoogleCredentialProvider } from './specialists/googleCredentialProvider'
import { pollGmailForNewMessages } from './specialists/gmailInboundMonitor'
import { applyRelationshipResumeEvent, type RelationshipDriverDeps } from './specialists/destinationRelationshipDriver'
import { runChiefMonitorLoop, DEFAULT_POLL_INTERVAL_MS } from './chiefMonitorLoop'

async function main() {
  const credentialProvider = new GoogleCredentialProvider({
    onTokenRefreshed: (info) => console.log(`[chief-monitor] Google access token refreshed, expires ${info.expiresAtIso}`),
  })
  if (!credentialProvider.isConfigured()) {
    console.error('Google OAuth is not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN). Run: tsx agent-service/googleAuthorize.ts')
    process.exitCode = 1
    return
  }

  const gmail = new RealGmailAdapter({ credentialProvider })
  const calendar = new RealGoogleCalendarAdapter({ credentialProvider })
  const contacts = new RealGoogleContactsAdapter({ credentialProvider })

  const runStore = new DbPlaybookRunStore()
  const execStore = new DbExecutionStore()
  const executors = [new RemoteAiExecutor([new OpenAiAdapter(), new AnthropicMessagesAdapter()])]
  const contactDirectory = new DbContactDirectory()
  const checkpointStore = new DbGmailCheckpointStore()

  const driverDeps: RelationshipDriverDeps = {
    runStore,
    execStore,
    executors,
    gmail,
    calendar,
    contacts,
    contactDirectory,
    jerryCalendarId: process.env.CHIEF_JERRY_CALENDAR_ID ?? 'primary',
  }

  const intervalMinutes = Number(process.env.CHIEF_GMAIL_POLL_INTERVAL_MINUTES ?? '')
  const intervalMs = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes * 60 * 1000 : DEFAULT_POLL_INTERVAL_MS

  console.log(`[chief-monitor] starting — polling Gmail every ${intervalMs / 60_000} minute(s)`)

  await runChiefMonitorLoop({
    intervalMs,
    pollGmail: () => pollGmailForNewMessages(gmail, checkpointStore, contactDirectory, (destinationId, event) => applyRelationshipResumeEvent(driverDeps, destinationId, event)),
    onTick: (result) => {
      if (result.error) console.error(`[chief-monitor] poll error: ${result.error}`)
      else if (result.newMessagesFound > 0) console.log(`[chief-monitor] ${result.newMessagesFound} new message(s), ${result.resumeEventsEmitted} resumed, ${result.ambiguousOrUnassociatedCount} needs review`)
    },
  })
}

main().catch((err) => {
  console.error('[chief-monitor] fatal:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
