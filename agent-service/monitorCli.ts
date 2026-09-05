#!/usr/bin/env node
// Chief Phase 2J — the production Gmail monitor entrypoint. Run under
// whatever process supervisor Jerry chooses (pm2, systemd, launchd, or a
// persistent terminal/tmux session) — agent-service has no existing
// always-on host to reuse, so this IS the durable process, not a wrapper
// around one. Restart safety comes from the checkpoint/contact files
// (.chief-gmail-checkpoint.json, .chief-contacts.json — both gitignored,
// same pattern as cli.ts's .chief-executions.json), not from this script
// remembering anything itself.
//
// Usage: tsx agent-service/monitorCli.ts
// Env: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
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

import { resolve } from 'node:path'
import { DbExecutionStore } from './specialists/dbExecutionStore'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { RemoteAiExecutor, AnthropicMessagesAdapter } from './specialists/remoteAiExecutor'
import { OpenAiAdapter } from './specialists/openAiAdapter'
import { RealGmailAdapter, RealGoogleCalendarAdapter, RealGoogleContactsAdapter } from './specialists/googleAdapters'
import { GoogleCredentialProvider } from './specialists/googleCredentialProvider'
import { pollGmailForNewMessages, FileGmailCheckpointStore, FileContactDirectory } from './specialists/gmailInboundMonitor'
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
  const contactDirectory = new FileContactDirectory(resolve(process.cwd(), '.chief-contacts.json'))
  const checkpointStore = new FileGmailCheckpointStore(resolve(process.cwd(), '.chief-gmail-checkpoint.json'))

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
