// Pure layout/state logic for the What's Good horizontal rail (see
// components/home/WhatsGoodDiscovery.jsx and EditorialCard.jsx's RailCard).
// Extracted so it's unit-testable without a React Native render harness —
// this project's established pattern for RN-adjacent pure decisions.

/** ~80% of the section's content width -> one full card + an obvious peek of the next. */
export const RAIL_CARD_WIDTH_RATIO = 0.8

/** The three existing-palette accent hues cycled by card index for no-photo cards. */
export const RAIL_ACCENT_KEYS = ['AMBER', 'GREEN', 'ENDED_TEXT']

/**
 * computeRailCardWidth(windowWidth, sectionHorizontalPadding, ratio)
 * @returns {number} card width in points, rounded to a whole pixel.
 */
export function computeRailCardWidth(windowWidth, sectionHorizontalPadding = 16, ratio = RAIL_CARD_WIDTH_RATIO) {
  const contentWidth = windowWidth - sectionHorizontalPadding * 2
  return Math.round(contentWidth * ratio)
}

/**
 * railAccentForIndex(index, colors, isSpecial)
 *
 * Deterministic by card index (not random, not item-id-hash-based — the
 * rail always has exactly 3 slots, so index is simpler and stable across
 * re-renders/re-fetches) so three no-photo cards in the same rail read as
 * intentionally different, not cloned. A secret item always gets the
 * purple "special" accent regardless of its position — that signal takes
 * priority over the position-based cycle.
 *
 * @param {number} index
 * @param {Record<string, string>} colors  theme color tokens (ThemeContext)
 * @param {boolean} isSpecial
 * @returns {string} a hex/rgba color string from the existing palette
 */
export function railAccentForIndex(index, colors, isSpecial) {
  if (isSpecial) return colors.ENDED_TEXT
  const key = RAIL_ACCENT_KEYS[((index % RAIL_ACCENT_KEYS.length) + RAIL_ACCENT_KEYS.length) % RAIL_ACCENT_KEYS.length]
  return colors[key] ?? colors.AMBER
}
