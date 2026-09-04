// What's Good V1 — deterministic local-context fingerprint. Pure, no I/O.
// The point: comparing "did the CheckOff-relevant context actually change"
// via nearest-item identity/order and at-place membership is a better
// refresh trigger than a raw movement-distance threshold (a fixed number
// of meters means very different things in a dense downtown vs. a sparse
// rural stretch) — see the "Data Adapter Preflight" design discussion.
//
// Deterministic: identical inputs always produce an identical string;
// order-sensitive on purpose (a reordering of the nearest items IS a
// meaningful context change, not noise).

/**
 * @param {{nearestItemIds: string[], atPlaceItemId: string|null}} context
 * @returns {string}
 */
export function computeContextFingerprint({ nearestItemIds, atPlaceItemId }) {
  return JSON.stringify({ nearest: nearestItemIds ?? [], atPlace: atPlaceItemId ?? null })
}
