// agent-service/playbooks/neighborhoodCompletenessGate.ts
//
// Chief Phase 2AK (2026-09-10, methodology hardening postmortem, Green Bay
// Hobart/Allouez case) — a metro's approved canonical neighborhood model
// (decided at M0/coverage-planning time — see docs/metro-launch-playbook.md
// Part 4 item 2) may legitimately include a neighborhood the real discovery
// pass never found anything in. That is an accepted, REPORTED fact, never
// a reason to fabricate or misassign an item to fill the gap. This gate
// makes that reporting structural rather than something a human has to
// remember to ask about: given the full approved canonical list and the
// real per-neighborhood item counts, it always PASSes (a zero-item
// neighborhood is never itself a build blocker) but the reason text names
// every empty one explicitly, and `emptyNeighborhoods` is a real, typed
// field a caller/report can't silently drop.
//
// This module does NOT decide whether/how to create a production row for
// an empty neighborhood (that's real per-metro geography knowledge no
// generic module has — see e.g. greenBayNeighborhoodModel.ts's own
// documented village-center fallback convention for one specific metro).
// It only guarantees the fact of "zero items here" is surfaced, every
// time, for every canonical neighborhood, never silently omitted from a
// report that only lists neighborhoods with content.
//
// Chief Phase 2AL (2026-09-11) — a required, FAIL-CLOSED precondition:
// `canonicalNeighborhoods` must be an explicit, real, frozen list a caller
// deliberately supplied (see MetroDriverDeps.canonicalNeighborhoods).
// Passing `null` (no canonical model available yet) is now a hard FAIL,
// not silently treated as "no neighborhoods to check" or backfilled from
// whatever M1 happened to discover — that silent fallback is exactly what
// let an incomplete/wrong model reach production packaging undetected.
// The canonical model may be produced earlier in the methodology (M0/
// coverage-planning), but by the time this gate runs (M8, before M9's SQL
// generation) it must be explicit and frozen.

export interface NeighborhoodCompletenessResult {
  key: 'NEIGHBORHOOD_COMPLETENESS_GATE'
  verdict: 'PASS' | 'FAIL'
  reason: string
  perNeighborhoodCounts: Array<{ neighborhoodName: string; count: number }>
  emptyNeighborhoods: string[]
}

export function evaluateNeighborhoodCompletenessGate(canonicalNeighborhoods: readonly string[] | null, itemNeighborhoodCounts: ReadonlyMap<string, number> | Record<string, number>): NeighborhoodCompletenessResult {
  if (canonicalNeighborhoods === null) {
    return {
      key: 'NEIGHBORHOOD_COMPLETENESS_GATE',
      verdict: 'FAIL',
      perNeighborhoodCounts: [],
      emptyNeighborhoods: [],
      reason:
        'No explicit, frozen canonical neighborhood model was supplied for this metro — refusing to silently treat whatever M1 happened to discover as the final canonical model. Supply the real, approved neighborhood list (MetroDriverDeps.canonicalNeighborhoods) before this metro can reach production-ready status.',
    }
  }
  const getCount = (name: string): number => {
    if (itemNeighborhoodCounts instanceof Map) return itemNeighborhoodCounts.get(name) ?? 0
    return (itemNeighborhoodCounts as Record<string, number>)[name] ?? 0
  }
  const perNeighborhoodCounts = canonicalNeighborhoods.map((name) => ({ neighborhoodName: name, count: getCount(name) }))
  const emptyNeighborhoods = perNeighborhoodCounts.filter((n) => n.count === 0).map((n) => n.neighborhoodName)

  return {
    key: 'NEIGHBORHOOD_COMPLETENESS_GATE',
    verdict: 'PASS',
    perNeighborhoodCounts,
    emptyNeighborhoods,
    reason:
      emptyNeighborhoods.length === 0
        ? `All ${canonicalNeighborhoods.length} canonical neighborhood(s) have at least one retained item.`
        : `${emptyNeighborhoods.length}/${canonicalNeighborhoods.length} canonical neighborhood(s) have ZERO retained items — accepted, not a build blocker, never filled by fabricating or misassigning an item: ${emptyNeighborhoods.join(', ')}. Flag as a targeted future enrichment need, never auto-remediated.`,
  }
}
