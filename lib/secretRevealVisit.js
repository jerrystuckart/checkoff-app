// Screen-VISIT state for the Secret reveal. Nothing here is persisted: every
// new opening of the screen builds a fresh gate, so each visit can play the
// reveal once. Within a visit it plays exactly once, no matter how many GPS
// updates, re-renders, foreground/background changes or boundary jitters
// follow. None of this changes eligibility: `update()` only reports whether the
// live distance is within the configured radius; the unlock decision is the
// radius comparison itself.

/**
 * Pure proximity gate for one visit.
 * update(distance, radius) ->
 *   'reveal'  first time the distance is within the radius this visit (unlock + play)
 *   'far'     still outside the radius (and not yet unlocked)
 *   'done'    already unlocked this visit: later fixes (incl. jitter back out) are ignored
 * reset() re-arms the gate (the explicit "Try again" after a location error).
 */
export function createProximityGate() {
  let unlocked = false
  return {
    update(distance, radius) {
      if (unlocked) return 'done'
      if (distance <= radius) { unlocked = true; return 'reveal' }
      return 'far'
    },
    reset() { unlocked = false },
    get unlocked() { return unlocked },
  }
}

/** Whether the arrival animation (and haptic) plays: once per visit, never under Reduce Motion. */
export function shouldAnimateReveal({ arrival, alreadyPlayed, reduceMotion }) {
  return !!arrival && !alreadyPlayed && !reduceMotion
}
