// PostCheckoffSheet — Phase 3 immediate-payoff line(s). Pure, no I/O, kept
// out of the .jsx component file so it can be unit-tested with plain
// `node --test` (no RN render harness / JSX transform needed) — same split
// as lib/whatsGoodCoverageMode.js's relationship to its screen.

// Which payoff line(s) to show given what's actually available. Never
// fabricates: pointsLabel is omitted entirely (not a placeholder) unless
// pointsAwarded is a valid positive, finite number.
export function derivePayoffLines({ pointsAwarded } = {}) {
  const hasPoints = typeof pointsAwarded === 'number' && Number.isFinite(pointsAwarded) && pointsAwarded > 0
  return {
    pointsLabel: hasPoints ? `+${pointsAwarded} points` : null,
  }
}
