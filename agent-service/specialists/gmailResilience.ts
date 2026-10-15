// Gmail resilience helpers: classify errors, retry READS with backoff, and pace calls.
//
// Why: Gmail enforces a per-minute "Total Query Cost" quota. A single busy tick (dozens of pre-follow-up checks, each
// with two searches plus fetches) can exceed it. Before this module a quota 403 raised from a READ was treated like a
// failed send: the recipient was PAUSED, escalated to NEEDS_JERRY and the whole campaign was paused. A per-minute
// quota is transient and says nothing about the safety of sending, so it must delay work, never stop a campaign.
//
// Safety rules kept:
//  - Only READ calls are retried here. A send is never retried automatically (see bizDevOutreach.ts).
//  - A Gmail rejection that happens before the message is accepted (per-minute quota) is "not sent". Real sending
//    limits ("daily user sending limit") and auth failures stay systemic and still pause the campaign.

export type GmailErrorClass = 'QUOTA' | 'TRANSIENT' | 'AUTH' | 'OTHER'

/** Per-minute / per-user rate limiting: transient by nature. Excludes the daily SENDING limit, which is a real stop. */
export function isTransientQuotaError(message: string): boolean {
  if (/daily user sending|sending limit/i.test(message)) return false
  return /\b429\b|Total Query Cost|rateLimitExceeded|userRateLimitExceeded|Quota exceeded for quota metric|Retry after \d{4}-\d{2}-\d{2}T/i.test(message)
}

export function classifyGmailError(message: string): GmailErrorClass {
  if (isTransientQuotaError(message)) return 'QUOTA'
  if (/returned 5\d\d\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|socket hang up|network/i.test(message)) return 'TRANSIENT'
  if (/invalid_grant|refresh token|\b401\b|unauthori[sz]ed|\b403\b|forbidden|\b535\b|daily user sending|sending limit/i.test(message)) return 'AUTH'
  return 'OTHER'
}

/** True when waiting and trying again later is the right response (never "stop the campaign"). */
export function isTransientGmailError(message: string): boolean {
  const c = classifyGmailError(message)
  return c === 'QUOTA' || c === 'TRANSIENT'
}

/** Gmail's quota errors often say "Retry after 2026-10-19T22:50:00.000Z". Returns the wait in ms (capped), or null. */
export function retryAfterMs(message: string, now: number = Date.now(), capMs = 60_000): number | null {
  const m = /Retry after (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i.exec(message)
  if (!m) return null
  const wait = Date.parse(m[1]) - now
  return Number.isFinite(wait) && wait > 0 ? Math.min(wait, capMs) : null
}

export interface RetryOptions {
  /** Total attempts including the first (default 4). */
  attempts?: number
  /** Base backoff in ms; attempt n waits base * 3^(n-1) (default 2000 -> 2s, 6s, 18s). */
  baseDelayMs?: number
  /** Hard cap for any single wait (default 60s). */
  maxDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Optional hook for logging each retry. */
  onRetry?: (info: { attempt: number; waitMs: number; error: string }) => void
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Runs `fn`, retrying only when the thrown error is a transient Gmail error. Non-transient errors throw immediately. */
export async function withGmailRetry<T>(fn: () => Promise<T>, o: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, o.attempts ?? 4)
  const base = o.baseDelayMs ?? 2000
  const maxDelay = o.maxDelayMs ?? 60_000
  const sleep = o.sleep ?? realSleep
  const now = o.now ?? Date.now
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt >= attempts || !isTransientGmailError(msg)) throw err
      const hinted = retryAfterMs(msg, now(), maxDelay)
      const jitter = Math.floor(Math.random() * 250)
      const waitMs = Math.min(maxDelay, hinted ?? base * 3 ** (attempt - 1)) + jitter
      o.onRetry?.({ attempt, waitMs, error: msg.slice(0, 160) })
      await sleep(waitMs)
    }
  }
  throw lastErr
}

/** Serializes calls so consecutive Gmail requests are at least `minIntervalMs` apart. */
export class GmailPacer {
  private last = 0
  private chain: Promise<void> = Promise.resolve()
  constructor(private readonly minIntervalMs: number, private readonly sleep: (ms: number) => Promise<void> = realSleep, private readonly now: () => number = Date.now) {}

  wait(): Promise<void> {
    if (this.minIntervalMs <= 0) return Promise.resolve()
    const turn = this.chain.then(async () => {
      const gap = this.last + this.minIntervalMs - this.now()
      if (gap > 0) await this.sleep(gap)
      this.last = this.now()
    })
    this.chain = turn.catch(() => undefined)
    return turn
  }
}
