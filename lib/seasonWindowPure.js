// Nearby Redesign (2026-09-19) — pure extraction of lib/seasonWindow.js's
// isWithinWindow()/toMetroDateString(), split out so this exact logic can
// be imported WITHOUT dragging in lib/seasonWindow.js's own `import {
// supabase } from './supabase'` (which — like every other Supabase-
// touching module in this codebase — cannot be loaded under plain
// node:test; it needs a React Native runtime). lib/seasonWindow.js
// re-exports isWithinWindow from here unchanged, so every existing
// caller (ItemDetailScreen.jsx, useItems.js, useLeaderboard.js, and this
// pass's own lib/nearbyCompletedIdsBuilder.js) is still using the
// IDENTICAL function — this is a load-path split, not a second
// definition of the rule.
//
// No behavior change from the pre-split lib/seasonWindow.js — see that
// file for the full rationale/history comment, preserved there.

export function toMetroDateString(isoTimestamp, metroTimezone = 'America/Phoenix') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: metroTimezone }).format(new Date(isoTimestamp))
}

export function isWithinWindow(checkedAt, startsAt, endsAt, metroTimezone = 'America/Phoenix') {
  if (!checkedAt) return false
  const checkedDate = toMetroDateString(checkedAt, metroTimezone)
  if (startsAt && checkedDate < startsAt) return false
  if (endsAt && checkedDate > endsAt) return false
  return true
}
