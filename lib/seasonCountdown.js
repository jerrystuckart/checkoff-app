// Home seasonal-list countdown text. Pure (the caller supplies `now`), so it is testable with a fixed clock.
//
// A list with no end date is open ended and must never show a countdown. A finite season is at most about a
// year; an end date further out than MAX_SEASON_COUNTDOWN_DAYS is a placeholder (the Positano lists were
// seeded with 2027-12-31 and showed "455 days left"), so it is treated as open ended too instead of showing
// a fabricated number. The data was corrected on 2026-10-02 (supabase/migrations/20261002_*); this guard keeps
// a future placeholder from reaching the screen.

export const MAX_SEASON_COUNTDOWN_DAYS = 366

export function calendarDaysLeft(endsAt, now = new Date()) {
  if (!endsAt) return null
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const end = new Date(`${endsAt}T00:00:00`); end.setHours(0, 0, 0, 0)
  return Math.round((end - today) / (1000 * 60 * 60 * 24))
}

/** @returns {string|null} null when there is nothing honest to show (no end, ended, or a placeholder end). */
export function seasonTimeLeftLabel(endsAt, now = new Date()) {
  if (!endsAt) return null
  const days = calendarDaysLeft(endsAt, now)
  if (days < 0) return null
  if (days > MAX_SEASON_COUNTDOWN_DAYS) return null
  if (days === 0) {
    const endOfDay = new Date(`${endsAt}T23:59:59`)
    const msLeft = endOfDay - now
    if (msLeft <= 0) return 'Ends tonight'
    const h = Math.floor(msLeft / 3600000)
    const m = Math.floor((msLeft % 3600000) / 60000)
    return h > 0 ? `${h}h ${m}m left` : `${m}m left`
  }
  if (days === 1) return '1 day left'
  return `${days} days left`
}
