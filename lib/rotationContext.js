// Multi-Image Rotation (2026-09-03) — the ONE place "today" gets computed
// for lib/whatsGoodImageSource.js's deterministic resolver. Every screen
// that calls resolvedItemImage(item, context) should build its context
// via this helper (with the same userId) so Home, What's the Thing, and
// Item Detail hash to the same seed and show the same image within a
// session — see the resolver's own doc comment for why dateKey must be
// caller-supplied rather than read internally.

/**
 * @param {string|null} [userId]
 * @returns {{userId: string|null, dateKey: string}}
 */
export function currentRotationContext(userId) {
  return { userId: userId ?? null, dateKey: new Date().toISOString().slice(0, 10) }
}
