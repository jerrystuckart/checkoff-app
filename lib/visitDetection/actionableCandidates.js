// ONE definition of "a suggestion the user can act on", used by the inbox list AND the Home/Profile badges (they used to
// differ: the badge counted every unexpired pending candidate, the inbox additionally hid items already checked off, so a
// place checked off by hand during the stay counted on the badge and never appeared in the inbox: 3 vs 2, then 2 vs 1).
//
// A candidate is actionable when ALL hold (the display mirror of the server rules; the server stays authoritative):
//   * status is candidate / medium_confidence / high_confidence, not confirmed or rejected
//   * not expired
//   * its item is readable (an inactive/hidden item cannot be shown or confirmed)
//   * the user has no check-in for that item, by ANY path and at ANY time (manual, list, earlier confirmation)
import { selectInboxRows } from './candidateVisitConfirmation.js'

export const PENDING_STATUSES = ['candidate', 'medium_confidence', 'high_confidence']

export function mapCandidateRow(row) {
  const it = row.items
  if (!it) return null
  return {
    candidateVisitId: row.id,
    status: row.status,
    expiresAt: row.expires_at,
    departureAt: row.departure_at,
    itemId: it.id,
    itemBody: it.body ?? '',
    neighborhoodName: it.neighborhoods?.name ?? null,
    competingVenueCount: row.metadata?.competingVenueCount ?? 0,
    // 'estimated' = the exit was never observed: dwellMinutes is ESTIMATED from a few location checks (they do not prove presence
    // in between) and departureAt is when the phone was last seen there. Rows written before 20260930m used dwellBound='lower'.
    // Anything else (null) = observed enter and exit. Nothing here is a proven minimum, so the UI never says "at least".
    dwellBasis: row.metadata?.dwellBasis ?? (row.metadata?.dwellBound === 'lower' ? 'estimated' : null),
    dwellMinutes: row.dwell_minutes ?? null,
    confirmedAt: row.confirmed_at ?? null,
    rejectedAt: row.rejected_at ?? null,
  }
}

/** Pure part: candidate_visits rows (with items) + the item ids the user already checked off -> actionable rows and why others are hidden. */
export function selectActionable({ data, checkedOffItemIds, highlightId = null, now = new Date() }) {
  const all = data ?? []
  const mapped = all.map(mapCandidateRow).filter(Boolean)
  const rows = selectInboxRows({ rows: mapped, checkedOffItemIds, highlightId, now })
  const shown = new Set(rows.map((r) => r.candidateVisitId))
  const hidden = { item_unreadable: all.length - mapped.length, already_checked_off: 0, other: 0 }
  for (const r of mapped) {
    if (shown.has(r.candidateVisitId)) continue
    if (checkedOffItemIds?.has(r.itemId)) hidden.already_checked_off += 1
    else hidden.other += 1
  }
  return { rows, hidden }
}

/** I/O part. `supabase` is injected so the same code runs in the app and in tests. */
export async function loadActionableCandidates(supabase, userId, { highlightId = null, now = new Date() } = {}) {
  if (!userId) return { rows: [], hidden: { item_unreadable: 0, already_checked_off: 0, other: 0 } }
  const { data, error } = await supabase
    .from('candidate_visits')
    .select(`
      id, status, expires_at, departure_at, dwell_minutes, confirmed_at, rejected_at, metadata,
      items ( id, body, neighborhoods!items_neighborhood_id_fkey ( name ) )
    `)
    .eq('user_id', userId)
    .in('status', PENDING_STATUSES)
    .order('departure_at', { ascending: false })
  if (error) throw new Error(error.message ?? 'candidate lookup failed')

  const itemIds = [...new Set((data ?? []).map((r) => r.items?.id).filter(Boolean))]
  let checkedOffItemIds = new Set()
  if (itemIds.length > 0) {
    const { data: existing, error: ckError } = await supabase.from('check_ins').select('item_id').eq('user_id', userId).in('item_id', itemIds)
    if (ckError) throw new Error(ckError.message ?? 'check-in lookup failed') // never show a count/list that might include already-checked-off places
    checkedOffItemIds = new Set((existing ?? []).map((r) => r.item_id))
  }
  return selectActionable({ data, checkedOffItemIds, highlightId, now })
}

export async function countActionableCandidates(supabase, userId, opts = {}) {
  return (await loadActionableCandidates(supabase, userId, opts)).rows.length
}
