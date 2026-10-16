// Campaign runtime shape + pure helpers (no I/O). A "campaign" is one
// agent.tasks row (source_type 'bizdev_campaign') whose metadata.campaign holds
// this object; every recipient is a normal 'bizdev_outreach' task, exactly like
// Blair's, carrying metadata.bizdev.campaignKey. No new tables, no new statuses.
//
// Campaign task status mirrors the runtime state (metadata is the source of truth):
//   APPROVED  -> READY         approved, not yet activated (tokens may still be pending)
//   ACTIVE    -> IN_PROGRESS   sending and following up
//   PAUSED    -> BLOCKED       paused by Jerry or by a safety trip (pauseReason says which)
//                NEEDS_JERRY   paused AND needs a decision (sender broken, repeated failures)
//   COMPLETE  -> DONE

import type { BizDevFollowUp, BizDevSequenceDef } from './bizDevOutreach'
import { staticSubjectStem } from './outreachTemplates'

export type CampaignState = 'APPROVED' | 'ACTIVE' | 'PAUSED' | 'COMPLETE'

export interface CampaignApproval {
  approvedBy: 'jerry'
  approvedAt: string
  recipientCount: number
  /** Hash of the validated recipient list + settings that Jerry reviewed in the preview. */
  inputHash: string
  /** Hash of the subject + first-touch + follow-up templates Jerry approved. */
  templateHash: string
}

export interface CampaignRuntime {
  key: string
  name: string
  taskId: string
  state: CampaignState
  pauseReason?: string
  metroLabel: string
  from: string
  subjectTemplate: string
  firstTouchBody: string
  followUps: BizDevFollowUp[]
  closeAfterBusinessDays: number
  maxOutbound: number
  /** Auto-answers to routine factual questions. Off unless the campaign definition turns it on. */
  faqEnabled: boolean
  /** When true the Gmail-Sent leg of the send-time prior-contact barrier is skipped (Winston-recorded contacts are still enforced). */
  allowPriorOutreach?: boolean
  /** Configurable. Default 80. */
  dailyCap: number
  /** 'experience-v2': every first touch carries the exact experience, its confirmation URL and public item URL, the download and kit links; the sender validates the token AND the public item before sending. */
  firstTouchContract?: 'experience-v2' | 'invitation-v1'
  /** Max NEW first touches per rolling 24h (default CAMPAIGN_DEFAULTS.firstTouchDailyLimit). Follow-ups never count against it. */
  firstTouchDailyLimit?: number
  /** Hard provider/account ceiling (Resend free tier: 100/day). The effective cap never exceeds providerLimit - reserve. */
  providerLimit: number
  /** Headroom for outgoing mail Winston cannot see (e.g. app/notification email sent through the same Resend account). */
  reserve: number
  batchPerTick: number
  sendDelayMs: number
  approval?: CampaignApproval
  /** Append-only ledger of approved batches (the first approval plus every later wave). Never read by the sender. */
  batches?: CampaignBatch[]
  /** Hard stop (ISO). From this instant the campaign sends nothing, closes every recipient, and completes. Always set for canaries. */
  expiresAt?: string
  consecutiveSendFailures: number
  firstTouchSent: number
  bounceCount: number
  scan: { afterDay: string; processedMessageIds: string[] }
}

export interface CampaignBatch {
  /** QUEUED = approved recipients waiting for their first touch (default). IMPORTED_SENT = recipients whose first touch had already been sent from Gmail. */
  kind?: 'QUEUED' | 'IMPORTED_SENT'
  approvedAt: string
  inputHash: string
  recipientCount: number
  recipients: string[]
}

export const CAMPAIGN_DEFAULTS = Object.freeze({
  dailyCap: 80,
  firstTouchDailyLimit: 50,
  providerLimit: 100,
  reserve: 10,
  batchPerTick: 25,
  sendDelayMs: 1000,
  maxOutbound: 3,
  closeAfterBusinessDays: 7,
  followUpDays: [5, 7] as const,
})

/**
 * Campaigns whose follow-up (and close) steps are HELD until Jerry separately approves the follow-up wording. The first touch, replies,
 * bounces and opt-outs are unaffected. Release a campaign by removing its key here (a reviewed commit) after the wording is approved.
 */
export const FOLLOW_UPS_HELD_CAMPAIGNS: ReadonlySet<string> = new Set(['willcox-launch-featured-v1', 'willcox-launch-invitation-v1'])

/** Instantiates the shared sequence engine's definition from a stored campaign. Per-recipient fields are filled by the caller. */
export function campaignToDef(c: CampaignRuntime): BizDevSequenceDef {
  return {
    key: `campaign:${c.key}`,
    mode: 'campaign',
    campaignKey: c.key,
    contactName: '',
    contactEmail: '',
    organization: '',
    from: c.from,
    subject: c.subjectTemplate,
    followUps: c.followUps,
    closeAfterBusinessDays: c.closeAfterBusinessDays,
    maxOutbound: c.maxOutbound,
    answeredWaitBusinessDays: 10,
    faqEnabled: c.faqEnabled,
    subjectSearchTerm: staticSubjectStem(c.subjectTemplate),
    ...(FOLLOW_UPS_HELD_CAMPAIGNS.has(c.key) ? { followUpsHeld: true } : {}),
  }
}

export interface CapacityInput {
  dailyCap: number
  providerLimit: number
  reserve: number
  /** Everything sent from the sending identity in the last rolling 24h, from ANY source Winston can see. */
  sentLast24h: number
}

export interface Capacity {
  effectiveCap: number
  remaining: number
  sentLast24h: number
  limitedBy: 'campaign_cap' | 'provider_limit'
}

/** Pauses (remaining 0) rather than ever exceeding the stricter of the campaign cap and the provider limit minus headroom. */
export function computeCapacity(i: CapacityInput): Capacity {
  const providerCeiling = Math.max(0, i.providerLimit - i.reserve)
  const effectiveCap = Math.max(0, Math.min(i.dailyCap, providerCeiling))
  return { effectiveCap, remaining: Math.max(0, effectiveCap - i.sentLast24h), sentLast24h: i.sentLast24h, limitedBy: providerCeiling < i.dailyCap ? 'provider_limit' : 'campaign_cap' }
}

export interface FirstTouchAllowanceInput {
  dailyLimit: number
  firstTouchesLast24h: number
  /** What is left of the shared daily cap AFTER follow-ups already sent this tick. */
  capacityRemaining: number
  /** Follow-ups that fall due within the next 24h: capacity held back for them so new first touches never crowd them out. */
  reservedFollowUps: number
}

export interface FirstTouchAllowance {
  allowed: number
  limitedBy: 'first_touch_limit' | 'capacity' | 'follow_up_reserve' | 'none'
}

/** How many NEW first touches may go out right now. Follow-ups outrank first touches; the 50/day target never overrides the real cap. */
export function firstTouchAllowance(i: FirstTouchAllowanceInput): FirstTouchAllowance {
  const byLimit = Math.max(0, i.dailyLimit - i.firstTouchesLast24h)
  const byCapacity = Math.max(0, i.capacityRemaining)
  const byReserve = Math.max(0, i.capacityRemaining - Math.max(0, i.reservedFollowUps))
  const allowed = Math.min(byLimit, byReserve)
  if (byLimit <= byReserve) return { allowed, limitedBy: byLimit === 0 ? 'first_touch_limit' : 'none' }
  return { allowed, limitedBy: i.reservedFollowUps > 0 && byReserve < byCapacity ? 'follow_up_reserve' : 'capacity' }
}

/** Gmail's after: wants YYYY/MM/DD. */
export function gmailDay(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '/')
}

/** Two cheap list queries per tick for the WHOLE campaign (replies by subject stem, and delivery failures). */
export function campaignScanQueries(c: CampaignRuntime): string[] {
  const stem = staticSubjectStem(c.subjectTemplate).replace(/"/g, '')
  return [`after:${c.scan.afterDay} -in:sent -in:drafts subject:"${stem}"`, `after:${c.scan.afterDay} from:(mailer-daemon OR postmaster)`]
}

export const MAX_PROCESSED_IDS = 5000
export const MAX_FETCH_PER_TICK = 40

/** Pause on a high bounce rate: ≥3 bounces AND ≥10% of first touches. */
export function bounceRateTripped(bounces: number, firstTouchSent: number): boolean {
  return bounces >= 3 && firstTouchSent > 0 && bounces / firstTouchSent >= 0.1
}

/** Errors that mean "stop everything", not "this one recipient failed". */
export function isSystemicSendError(message: string): boolean {
  return /(429|rate ?limit|quota|invalid_grant|refresh token|535|401|403|unauthori[sz]ed|forbidden|daily user sending)/i.test(message)
}
