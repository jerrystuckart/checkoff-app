// Chief Phase 2I — Chief owns the follow-up clock. Pure logic, no I/O.
// Bounded, widening cadence (never spam); an explicit "contact me after
// X" always overrides the default cadence; once attempts are exhausted
// the relationship parks with its history intact rather than looping
// forever or silently vanishing.

export interface FollowUpState {
  attemptsMade: number
  lastContactAt: string | null
  /** An explicit future date the contact/champion asked to be revisited — always wins over the default cadence. */
  requestedWaitUntil: string | null
  parked: boolean
}

export const MAX_FOLLOWUP_ATTEMPTS = 3
/** Widening cadence in days, indexed by attemptsMade (0 = first follow-up). Beyond the array's length, the last interval repeats — but shouldPark() stops the clock at MAX_FOLLOWUP_ATTEMPTS regardless. */
const FOLLOWUP_INTERVAL_DAYS = [5, 10, 21]

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

/**
 * Null means "nothing scheduled" — either parked, or an explicit request
 * to wait has no target set (caller error), or attempts are exhausted
 * (caller should park). Never returns a date once parked=true.
 */
export function computeNextFollowUpAt(state: FollowUpState, now: string): string | null {
  if (state.parked) return null
  if (state.requestedWaitUntil) return state.requestedWaitUntil
  if (state.attemptsMade >= MAX_FOLLOWUP_ATTEMPTS) return null
  const intervalDays = FOLLOWUP_INTERVAL_DAYS[state.attemptsMade] ?? FOLLOWUP_INTERVAL_DAYS[FOLLOWUP_INTERVAL_DAYS.length - 1]
  const base = state.lastContactAt ?? now
  return addDays(base, intervalDays)
}

export function isFollowUpDue(nextFollowUpAt: string | null, now: string): boolean {
  if (!nextFollowUpAt) return false
  return new Date(nextFollowUpAt).getTime() <= new Date(now).getTime()
}

/**
 * A legitimate future wait (explicit request, or a not-yet-due scheduled
 * follow-up) must NEVER be treated as stale — this is the one function a
 * portfolio-staleness check should consult before flagging a relationship
 * as neglected.
 */
export function isLegitimateFutureWait(state: FollowUpState, now: string): boolean {
  if (state.parked) return false
  const next = computeNextFollowUpAt(state, now)
  return next !== null && !isFollowUpDue(next, now)
}

export function shouldPark(state: FollowUpState): boolean {
  return !state.requestedWaitUntil && !state.parked && state.attemptsMade >= MAX_FOLLOWUP_ATTEMPTS
}

// ---------------------------------------------------------------------------
// Parsing "contact me after X" — a real, bounded set of recognized
// phrasings, never free-form NLP. Anything not recognized returns null
// (caller falls back to the default cadence) rather than guessing.
// ---------------------------------------------------------------------------

export interface RequestedWait {
  kind: 'EXPLICIT_DATE' | 'RELATIVE' | 'NAMED_WINDOW'
  resumeAt: string
  label: string
}

const RELATIVE_UNIT_DAYS: Record<string, number> = { day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30 }

export function parseRequestedWait(text: string, now: string): RequestedWait | null {
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (isoMatch) {
    const parsed = new Date(isoMatch[1])
    if (!Number.isNaN(parsed.getTime())) return { kind: 'EXPLICIT_DATE', resumeAt: parsed.toISOString(), label: `explicit date ${isoMatch[1]}` }
  }

  const relativeMatch = text.match(/\bin (\d+) (day|days|week|weeks|month|months)\b/i)
  if (relativeMatch) {
    const n = parseInt(relativeMatch[1], 10)
    const unit = relativeMatch[2].toLowerCase()
    return { kind: 'RELATIVE', resumeAt: addDays(now, n * RELATIVE_UNIT_DAYS[unit]), label: `in ${n} ${unit}` }
  }

  if (/\bnext week\b/i.test(text)) return { kind: 'RELATIVE', resumeAt: addDays(now, 7), label: 'next week' }
  if (/\bnext month\b/i.test(text)) return { kind: 'RELATIVE', resumeAt: addDays(now, 30), label: 'next month' }

  // Named windows are deliberately conservative heuristics (~90 days) — a
  // real budget/season boundary is not something this function can know
  // precisely; the point is to never treat the wait as due tomorrow.
  if (/\b(after|until) (the )?budget (season|cycle)\b/i.test(text) || /\bnext (fiscal year|budget cycle)\b/i.test(text)) {
    return { kind: 'NAMED_WINDOW', resumeAt: addDays(now, 90), label: 'after budget cycle (~90 days)' }
  }
  if (/\bnext quarter\b/i.test(text)) return { kind: 'NAMED_WINDOW', resumeAt: addDays(now, 90), label: 'next quarter (~90 days)' }
  if (/\b(after|in the) (peak|high) season\b/i.test(text) || /\bafter (the )?(summer|fall|winter|spring)\b/i.test(text)) {
    return { kind: 'NAMED_WINDOW', resumeAt: addDays(now, 90), label: 'after seasonal peak (~90 days)' }
  }

  return null
}
