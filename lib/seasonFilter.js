// Single source of truth for the client-side seasonal visibility filter
// (Priorities 1 & 2). Non-overlapping windows, matching the currently-live
// definition — will be superseded once the DB-level seasonal is_active
// sync (Priority 3) lands.
export const SEASON_WINDOWS = {
  fall:   [9, 10, 11],
  winter: [12, 1, 2],
  spring: [3, 4, 5],
  summer: [6, 7, 8],
}

export function isItemInSeason(item) {
  if (!item.season_tag) return true // null = always show
  const currentMonth = new Date().getMonth() + 1 // 1–12
  return (SEASON_WINDOWS[item.season_tag] || []).includes(currentMonth)
}
