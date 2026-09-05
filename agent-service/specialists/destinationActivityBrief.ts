// Chief Phase 2J — the destination-activity section of the daily brief
// (spec section 15). Pure, no I/O. Takes one classified outcome per
// destination for the period (computed by whoever assembles the brief,
// from that destination's relationship run + today's poll results) and
// renders plain-English bullets — NEVER raw inbox message dumps. Same
// "secondary, opt-in, don't clutter" discipline as usageAggregation.ts's
// computeChiefBriefUsageSummary: this is a standalone function a caller
// attaches to a brief, not something wired into every brief by default.

export type DailyDestinationOutcome = 'REPLY_INFO_REQUEST' | 'REPLY_MEETING_INTEREST' | 'REPLY_OTHER' | 'FOLLOW_UP_DUE' | 'NO_ACTION'

export interface DestinationActivityBrief {
  counts: Record<DailyDestinationOutcome, number>
  /** Plain-English bullets, ready to drop into a brief as-is. */
  lines: string[]
}

export function summarizeDestinationActivity(outcomes: readonly DailyDestinationOutcome[]): DestinationActivityBrief {
  const counts: Record<DailyDestinationOutcome, number> = { REPLY_INFO_REQUEST: 0, REPLY_MEETING_INTEREST: 0, REPLY_OTHER: 0, FOLLOW_UP_DUE: 0, NO_ACTION: 0 }
  for (const outcome of outcomes) counts[outcome]++

  const repliesArrived = counts.REPLY_INFO_REQUEST + counts.REPLY_MEETING_INTEREST + counts.REPLY_OTHER
  const lines: string[] = []

  if (repliesArrived > 0) lines.push(`${repliesArrived} destination ${repliesArrived === 1 ? 'reply' : 'replies'} arrived`)
  if (counts.REPLY_INFO_REQUEST > 0) lines.push(`${counts.REPLY_INFO_REQUEST} ${counts.REPLY_INFO_REQUEST === 1 ? 'asks' : 'ask'} for information and Chief prepared the one-pager`)
  if (counts.REPLY_MEETING_INTEREST > 0) lines.push(`${counts.REPLY_MEETING_INTEREST} ${counts.REPLY_MEETING_INTEREST === 1 ? 'wants' : 'want'} a meeting and ${counts.REPLY_MEETING_INTEREST === 1 ? 'needs' : 'need'} Jerry`)
  if (counts.FOLLOW_UP_DUE > 0) lines.push(`${counts.FOLLOW_UP_DUE} follow-up${counts.FOLLOW_UP_DUE === 1 ? ' is' : 's are'} due`)
  if (counts.NO_ACTION > 0) lines.push(`${counts.NO_ACTION} destination${counts.NO_ACTION === 1 ? '' : 's'} need${counts.NO_ACTION === 1 ? 's' : ''} no action today`)

  return { counts, lines }
}
