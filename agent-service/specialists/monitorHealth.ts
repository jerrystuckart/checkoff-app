// Persistent health alerting for the Chief monitor, built on existing parts:
// the counters live in one agent.tasks row (metadata.health), and an alert is an
// ordinary NEEDS_JERRY task — so it shows up in the Chief Brief with everything
// else. No new table, no new status, no new notifier.
//
// Why this exists: Winston's Gmail authorization was dead for a month
// (2026-09-12 → 2026-10-11) and the only trace was a growing error log nobody
// read. Now N consecutive failing ticks open a NEEDS_JERRY task that says
// exactly what to do; the first healthy tick after it resolves it.

import { createTask, transitionTask } from '../mutations'
import { query, withWriteTransaction } from '../db'

export type HealthChannel = 'gmail_auth' | 'gmail_poll' | 'bizdev' | 'send'

export interface ChannelState {
  consecutive: number
  since?: string
  lastError?: string
  lastOkAt?: string
  alertTaskId?: string
}

export interface HealthState {
  channels: Partial<Record<HealthChannel, ChannelState>>
}

/** ~45 minutes at the default 15-minute poll. */
export const ALERT_THRESHOLD = 3

export type HealthAction = 'NONE' | 'OPEN_ALERT' | 'RESOLVE_ALERT'

export function classifyError(message: string): HealthChannel {
  if (/(refresh token|invalid_grant|authorization has likely been revoked|GoogleAuthRevoked)/i.test(message)) return 'gmail_auth'
  return 'gmail_poll'
}

/** Pure: folds one tick's outcome for one channel into the persisted counters. */
export function applyOutcome(state: HealthState, channel: HealthChannel, ok: boolean, now: Date, detail?: string): { state: HealthState; action: HealthAction } {
  const prev = state.channels[channel] ?? { consecutive: 0 }
  const next: ChannelState = { ...prev }
  let action: HealthAction = 'NONE'
  if (ok) {
    next.lastOkAt = now.toISOString()
    if (prev.alertTaskId) action = 'RESOLVE_ALERT'
    next.consecutive = 0
    delete next.since
    delete next.lastError
    if (action !== 'RESOLVE_ALERT') delete next.alertTaskId
  } else {
    next.consecutive = prev.consecutive + 1
    next.since = prev.since ?? now.toISOString()
    next.lastError = (detail ?? '').slice(0, 400)
    if (next.consecutive >= ALERT_THRESHOLD && !prev.alertTaskId) action = 'OPEN_ALERT'
  }
  return { state: { channels: { ...state.channels, [channel]: next } }, action }
}

export function alertText(channel: HealthChannel, c: ChannelState): { title: string; jerryRequest: string; nextAction: string } {
  const header = `Winston monitor health alert: ${channel}\nFailing for ${c.consecutive} consecutive checks since ${c.since}.\nLast error: ${c.lastError}\n`
  const how: Record<HealthChannel, string> = {
    gmail_auth: 'Gmail authorization is failing, so NO replies are being seen and NO follow-ups or campaign emails can go out.\nFix: run `npx tsx agent-service/googleAuthorize.ts`, then REPLACE (do not append) the GOOGLE_REFRESH_TOKEN line in .env, then `launchctl kickstart -k gui/$(id -u)/com.checkoff.chief-monitor`. Also set the Google OAuth app to "In production" so refresh tokens stop expiring after 7 days.',
    gmail_poll: 'The Gmail poll keeps failing (not an authorization problem). Check ~/Library/Logs/ChiefMonitor/monitor.err.log for the error, Google API status, and network.',
    bizdev: 'The business-outreach tick keeps failing. Replies and follow-ups are not being processed. Check monitor.err.log for "bizdev error" lines.',
    send: 'Outgoing sends keep failing or a campaign was auto-paused. Check the "Send mail as" SMTP credentials for jerry@getcheckoff.com (a 535 error means the Resend key was rotated or revoked), Gmail authorization, and the daily provider limit.',
  }
  return { title: `Monitor health: ${channel} failing`, jerryRequest: `${header}${how[channel]}`, nextAction: `Jerry: repair ${channel} (see jerry_request). Winston resolves this automatically on the first healthy check.` }
}

export interface HealthStore {
  load(): Promise<HealthState>
  save(state: HealthState): Promise<void>
  openAlert(channel: HealthChannel, c: ChannelState, now: Date): Promise<string>
  resolveAlert(taskId: string, channel: HealthChannel): Promise<void>
}

export interface TickOutcome {
  /** MonitorTickResult.error from the destination poll, or null. */
  pollError: string | null
  /** runBizDevTick().errors */
  bizdevErrors: string[]
}

/** Returns human-readable actions taken (for the monitor log). */
export async function recordTick(store: HealthStore, outcome: TickOutcome, now: Date = new Date()): Promise<string[]> {
  let state = await store.load()
  const actions: string[] = []
  const authFailing = outcome.pollError ? classifyError(outcome.pollError) === 'gmail_auth' : false
  const sendErrors = outcome.bizdevErrors.filter((e) => /(send failed|PAUSED|sender-configuration|template failed)/i.test(e))
  const otherBizdev = outcome.bizdevErrors.filter((e) => !sendErrors.includes(e))
  const checks: Array<[HealthChannel, boolean, string | undefined]> = [
    ['gmail_auth', !authFailing, authFailing ? outcome.pollError ?? undefined : undefined],
    ['gmail_poll', !(outcome.pollError && !authFailing), outcome.pollError && !authFailing ? outcome.pollError : undefined],
    ['bizdev', otherBizdev.length === 0, otherBizdev[0]],
    ['send', sendErrors.length === 0, sendErrors[0]],
  ]
  for (const [channel, ok, detail] of checks) {
    const r = applyOutcome(state, channel, ok, now, detail)
    state = r.state
    if (r.action === 'OPEN_ALERT') {
      const id = await store.openAlert(channel, state.channels[channel]!, now)
      state.channels[channel] = { ...state.channels[channel]!, alertTaskId: id }
      actions.push(`opened health alert for ${channel}`)
    } else if (r.action === 'RESOLVE_ALERT') {
      const id = state.channels[channel]!.alertTaskId!
      await store.resolveAlert(id, channel)
      delete state.channels[channel]!.alertTaskId
      actions.push(`resolved health alert for ${channel}`)
    }
  }
  await store.save(state)
  return actions
}

// ---------------------------------------------------------------------------
// Postgres-backed store (existing tables only)
// ---------------------------------------------------------------------------

const HEALTH_SOURCE_TYPE = 'chief_health'
const HEALTH_REF = 'monitor-health'
const ALERT_SOURCE_TYPE = 'chief_health_alert'
const PROJECT = 'chief-operations'

export class DbHealthStore implements HealthStore {
  private async ensureRow(): Promise<string> {
    const r = await createTask({
      title: 'Chief monitor health counters',
      projectKey: PROJECT,
      status: 'IN_PROGRESS',
      changedByOwnerKey: 'chief',
      ownerKey: 'chief',
      nextAction: 'Tracks consecutive monitor failures; opens a NEEDS_JERRY alert task after repeated failures.',
      sourceType: HEALTH_SOURCE_TYPE,
      sourceRef: HEALTH_REF,
    })
    return r.task.id
  }

  async load(): Promise<HealthState> {
    const id = await this.ensureRow()
    const rows = await query<{ health: HealthState | null }>(`SELECT metadata->'health' AS health FROM agent.tasks WHERE id = $1`, [id])
    return rows[0]?.health ?? { channels: {} }
  }

  async save(state: HealthState): Promise<void> {
    const id = await this.ensureRow()
    await withWriteTransaction(async (c) => {
      await c.query(`UPDATE agent.tasks SET metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{health}', $2::jsonb) WHERE id = $1`, [id, JSON.stringify(state)])
    })
  }

  async openAlert(channel: HealthChannel, c: ChannelState, now: Date): Promise<string> {
    const t = alertText(channel, c)
    const r = await createTask({
      title: t.title,
      projectKey: PROJECT,
      status: 'NEEDS_JERRY',
      changedByOwnerKey: 'chief',
      ownerKey: 'chief',
      jerryRequest: t.jerryRequest,
      nextAction: t.nextAction,
      sourceType: ALERT_SOURCE_TYPE,
      sourceRef: `${channel}:${now.toISOString()}`,
    })
    return r.task.id
  }

  async resolveAlert(taskId: string, channel: HealthChannel): Promise<void> {
    const rows = await query<{ updated_at: Date; status: string }>(`SELECT updated_at, status FROM agent.tasks WHERE id = $1`, [taskId])
    if (!rows[0] || rows[0].status === 'DONE' || rows[0].status === 'CANCELED') return
    await transitionTask({ taskId, toStatus: 'DONE', actorOwnerKey: 'chief', expectedUpdatedAt: rows[0].updated_at, note: `Auto-resolved: ${channel} is healthy again.` })
  }
}
