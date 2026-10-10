// Pure rules for the Home header recovery icon (components/home/VisitRecoveryHeaderIcon.jsx).

/** Red badge text: nothing at zero (icon only), the number up to 9, then "9+" so it never grows past the icon. */
export function recoveryIconBadgeText(count) {
  const n = Number(count)
  if (!Number.isFinite(n) || n < 1) return null
  return n > 9 ? '9+' : String(Math.floor(n))
}

/**
 * What a tap does. Pending suggestions always win (the user can act on them now); otherwise a user who has not turned
 * recovery on is taken to the existing setup flow; everyone else gets the inbox (which explains empty/paused states).
 * @returns {'inbox'|'setup'}
 */
export function recoveryIconAction({ state, suggestionCount }) {
  if (suggestionCount > 0) return 'inbox'
  return state === 'off' ? 'setup' : 'inbox'
}
