/**
 * Badge celebration controller (framework free, unit testable).
 *
 * WHY THIS EXISTS. Badges are awarded in three places: the check_ins trigger
 * (check_and_award_badges -> user_badges + a notification_queue row), the
 * update-streak function (same pair), and the client (lib/points.js, points_*
 * milestones). The celebration used to be driven by ListScreen alone, which
 * drained notification_queue and flipped `delivered` BEFORE anything was on
 * screen. Check-ins made from Item Detail, Photo Check-in, Trip Mode and visit
 * recovery never looked at the queue, and the client-side points_* awards could
 * never queue a row at all (notification_queue INSERT is admin-only under RLS).
 *
 * MODEL. One controller per app, owned by BadgeCelebrationHost.
 *  - SOURCE OF TRUTH: user_badges (the permanent record, readable by its owner).
 *  - UNSEEN = badges earned inside UNSEEN_WINDOW_MS, minus badges this device
 *    already showed to this account (persisted per account), minus badges whose
 *    queue row is already delivered=true (shown by an older build, or on another
 *    device). Older badges are never replayed and never modified.
 *  - SAFE POINT: nothing is presented while any hold is active (post check-off
 *    sheet, tier upgrade, memory prompt, ...), while the app is not active, or
 *    during SHOW_DELAY_MS after the last hold is released (lets a dismissing
 *    native modal finish; iOS refuses to present over one).
 *  - SEEN is written only when the modal reports it is on screen
 *    (onBadgeVisible), never when a badge is merely fetched or queued.
 *  - One batch is presented at a time; badges arriving meanwhile wait for the
 *    next batch. Everything is keyed by account and reset on user change.
 */

export const UNSEEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const SHOW_DELAY_MS = 600
export const SEEN_CAP = 300
export const seenStorageKey = (userId) => `checkoff:badge-celebrations-seen:v1:${userId}`

export function createBadgeCelebrationController({
  supabase,
  storage,                       // { getItem(key) -> Promise<string|null>, setItem(key, value) -> Promise }
  syncMilestones,                // async (userId) => void : awards points_* rows the client owns
  onFirstCheckin,                // async (userId) => void : referral bonus (idempotent server side)
  now = () => Date.now(),
  showDelayMs = SHOW_DELAY_MS,
  settleMs = 350,
  followUpMs = 3000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let userId = null
  let epoch = 0
  let appActive = true
  let holds = new Set()
  let pending = []               // badge definitions waiting for a safe point
  let presenting = null          // { id, badges } currently handed to the modal
  let known = new Set()          // badge ids pending/presenting/shown this session (in-memory dedupe)
  let seen = null                // Set of badge ids persisted for this account (null until loaded)
  let checking = false
  let recheck = false
  let flushTimer = null
  let batchSeq = 0
  let firstCheckinHandled = false
  const timers = new Set()
  const listeners = new Set()

  const emit = () => listeners.forEach(l => { try { l(getState()) } catch {} })
  const later = (fn, ms) => { const t = setTimer(() => { timers.delete(t); fn() }, ms); timers.add(t); return t }
  const getState = () => ({ userId, presenting, pendingCount: pending.length, holds: [...holds], appActive })

  async function loadSeen(uid) {
    if (seen) return seen
    let list = []
    try { list = JSON.parse((await storage?.getItem(seenStorageKey(uid))) ?? '[]') } catch { list = [] }
    if (uid !== userId) return new Set()
    seen = new Set(Array.isArray(list) ? list : [])
    return seen
  }

  async function persistSeen(uid) {
    if (!seen || uid !== userId) return
    const list = [...seen].slice(-SEEN_CAP)
    try { await storage?.setItem(seenStorageKey(uid), JSON.stringify(list)) } catch { /* in-memory still dedupes */ }
  }

  function reset() {
    epoch++
    timers.forEach(clearTimer); timers.clear()
    flushTimer = null
    pending = []; presenting = null; known = new Set(); seen = null
    checking = false; recheck = false; firstCheckinHandled = false
    // holds are NOT cleared: they belong to mounted screens/sheets, which release them themselves.
  }

  function setUser(nextUserId) {
    const next = nextUserId || null
    if (next === userId) return
    reset()
    userId = next
    emit()
    if (userId) requestCheck('user', { immediate: true })
  }

  function setAppActive(active) {
    const was = appActive
    appActive = !!active
    if (appActive && !was) requestCheck('foreground')
    if (appActive) scheduleFlush()
  }

  function hold(key) { holds.add(key); emit() }
  function release(key) {
    if (!holds.delete(key)) return
    emit()
    scheduleFlush()
  }

  /** Ask for a check. `reason` is informational. Debounced; coalesces concurrent calls. */
  function requestCheck(reason, { immediate = false, followUp = reason !== 'foreground' && reason !== 'user' } = {}) {
    if (!userId) return
    const uid = userId, ep = epoch
    const run = () => { if (ep === epoch && uid === userId) check() }
    later(run, immediate ? 0 : settleMs)
    // Awards that land after the check-in returns (points milestones, streak function) get a second look.
    if (followUp) later(run, followUpMs)
  }

  async function check() {
    if (!userId) return
    if (checking) { recheck = true; return }
    checking = true
    const uid = userId, ep = epoch
    try {
      try { await syncMilestones?.(uid) } catch { /* non-critical; keep going with what exists */ }
      if (ep !== epoch) return
      const seenSet = await loadSeen(uid)
      if (ep !== epoch) return
      const since = new Date(now() - UNSEEN_WINDOW_MS).toISOString()

      const [{ data: earned, error: e1 }, { data: queued, error: e2 }] = await Promise.all([
        supabase.from('user_badges').select('badge_id, earned_at').eq('user_id', uid).gte('earned_at', since).order('earned_at', { ascending: true }),
        supabase.from('notification_queue').select('id, delivered, payload').eq('type', 'badge').eq('payload->>to_user_id', uid).gte('created_at', since),
      ])
      if (ep !== epoch || e1 || !earned) return
      // A failed queue read must not cause replays of badges an older build already showed: treat as unknown -> skip this round.
      if (e2) return

      const deliveredIds = new Set((queued ?? []).filter(r => r.delivered).map(r => r.payload?.badge_id))
      const fresh = earned
        .map(r => r.badge_id)
        .filter(id => id && !known.has(id) && !seenSet.has(id) && !deliveredIds.has(id))
      if (!fresh.length) return

      const { data: defs, error: e3 } = await supabase.from('badge_definitions').select('id, name, description, icon').in('id', fresh)
      if (ep !== epoch || e3 || !defs) return
      const byId = new Map(defs.map(d => [d.id, d]))
      const toShow = fresh.map(id => byId.get(id)).filter(Boolean)   // no definition = nothing to render; retried later
      if (!toShow.length) return

      toShow.forEach(d => known.add(d.id))
      pending.push(...toShow)
      if (!firstCheckinHandled && toShow.some(d => d.id === 'first_checkin')) {
        firstCheckinHandled = true
        Promise.resolve(onFirstCheckin?.(uid)).then(() => requestCheck('referral', { followUp: false })).catch(() => {})
      }
      emit()
      scheduleFlush()
    } catch {
      // Celebrations must never affect a check-in.
    } finally {
      checking = false
      if (recheck) { recheck = false; if (ep === epoch) requestCheck('recheck', { immediate: true, followUp: false }) }
    }
  }

  function canPresent() { return !!userId && appActive && holds.size === 0 && !presenting && pending.length > 0 }

  function scheduleFlush() {
    if (flushTimer || !canPresent()) return
    const ep = epoch
    flushTimer = later(() => {
      flushTimer = null
      if (ep !== epoch || !canPresent()) return          // a hold appeared during the delay: wait for its release
      presenting = { id: ++batchSeq, badges: pending, shown: new Set() }
      pending = []
      emit()
    }, showDelayMs)
  }

  /** The modal is on screen showing `badge`. Only now is it recorded as seen. */
  function onBadgeVisible(badge) {
    if (!presenting || !badge || !userId) return
    presenting.shown.add(badge.id)
    const uid = userId
    if (seen) seen.add(badge.id)
    persistSeen(uid)
    // Mirror to the queue row (if any) so older builds / other devices do not replay it. Best effort.
    Promise.resolve(
      supabase.from('notification_queue').update({ delivered: true })
        .eq('type', 'badge').eq('payload->>to_user_id', uid).eq('payload->>badge_id', badge.id)
    ).catch(() => {})
  }

  /** Modal closed (Let's go / Skip all / back). A batch that started showing is acknowledged as a whole ("Skip all"); a batch that never became visible acknowledges nothing. */
  function dismiss() {
    if (!presenting) return
    const batch = presenting
    presenting = null
    if (batch.shown.size > 0 && seen && userId) {
      batch.badges.forEach(b => seen.add(b.id))
      persistSeen(userId)
    } else {
      batch.badges.forEach(b => known.delete(b.id))   // never became visible: eligible again at the next check
    }
    emit()
    scheduleFlush()
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
  function destroy() { reset(); listeners.clear(); userId = null }

  return { setUser, setAppActive, hold, release, requestCheck, check, onBadgeVisible, dismiss, subscribe, getState, destroy }
}
