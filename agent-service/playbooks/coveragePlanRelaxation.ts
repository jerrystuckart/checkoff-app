// Chief Phase 2Y — adaptive coverage-plan relaxation. metroLaunchDriver's
// M4<->M5 gap-loop is bounded (DriverGuardrails.maxLoopIterations) so it
// never researches forever — but hitting that bound used to mean an
// immediate NEEDS_JERRY escalation, even when the real cause was
// nothing more than an over-ambitious initial category/geography plan
// (Vienna, 2026-09-09: a 13-category x 10-district plan hit the loop
// bound on real, honest research that simply couldn't sustain every
// target everywhere). That is an ordinary implementation-planning
// mistake, not a genuine human/product decision, and Winston should
// self-repair it the same way it self-repairs a weak item or a tag
// mismatch: bounded, automatic, and never by manufacturing filler.
//
// This module is pure — no AI calls, no DB access — exactly like
// metroLaunch.ts's auditCoverage/deriveMetroLoopAction it builds on.
// It answers exactly one question, twice: "is this specific blocking
// gap proven unrealistic, or does it just need more research?", and
// then applies whichever relaxations that classification licenses.

import type { CategoryCoveragePlan, CategoryCount, CoverageGap, GeographicDepthTarget, NeighborhoodCount, NeighborhoodDefinition } from './metroLaunch'

// ---------------------------------------------------------------------------
// Per-gap research history — tracks REAL dispatched research (not merely
// "was still blocking at the last audit" — a gap can sit in the blocking
// list for several audits without ever actually being dispatched, since
// M5 only researches maxConcurrentExecutions gaps per pass).
// ---------------------------------------------------------------------------

export interface GapResearchRecord {
  timesDispatched: number
  /** The achieved count (category or neighborhood count), recorded at each M4 audit AFTER at least one dispatch — used to detect a plateau (no improvement on the most recent dispatch). */
  countAfterDispatch: number[]
}

export type GapResearchHistory = Record<string, GapResearchRecord>

export function gapHistoryKey(gap: Pick<CoverageGap, 'kind' | 'name'>): string {
  return `${gap.kind}:${gap.name}`
}

/** Priority order for the NEXT M5 dispatch — least-dispatched gaps first, so a long tail of gaps (more than maxConcurrentExecutions) rotates through fairly across loop iterations instead of the same handful being re-researched every time while the rest starve at zero attempts. */
export function sortGapsForDispatch(gaps: readonly CoverageGap[], history: GapResearchHistory): CoverageGap[] {
  return [...gaps].sort((a, b) => (history[gapHistoryKey(a)]?.timesDispatched ?? 0) - (history[gapHistoryKey(b)]?.timesDispatched ?? 0))
}

// ---------------------------------------------------------------------------
// Classification — the "genuine missing coverage" vs "unrealistic
// target" decision the whole module exists to make correctly.
// ---------------------------------------------------------------------------

export type GapRelaxClassification = 'GENUINE_MISSING_COVERAGE' | 'UNREALISTIC_CATEGORY_MINIMUM' | 'UNREALISTIC_DISTRICT_DEPTH' | 'INSUFFICIENT_REAL_WORLD_INVENTORY'

export interface GapClassification {
  gap: CoverageGap
  classification: GapRelaxClassification
  /** true only for a gap proven (via real dispatched research that plateaued) to reflect insufficient real-world inventory rather than insufficient effort. */
  eligibleForRelaxation: boolean
  reason: string
}

export const DEFAULT_MIN_DISPATCHES_BEFORE_RELAXATION = 2

/**
 * A gap is eligible for relaxation ONLY when it has been genuinely
 * dispatched for targeted research at least `minDispatches` times AND
 * the most recent dispatch added no new candidates (a real plateau, not
 * a guess). A gap that was never dispatched, or dispatched only once, or
 * is still gaining candidates, is GENUINE_MISSING_COVERAGE — it needs
 * more research, never a relaxed target, no matter how many audits it
 * has silently sat in the blocking list.
 */
export function classifyGapForRelaxation(gap: CoverageGap, history: GapResearchRecord | undefined, minDispatches: number = DEFAULT_MIN_DISPATCHES_BEFORE_RELAXATION): GapClassification {
  const dispatched = history?.timesDispatched ?? 0
  if (dispatched < minDispatches) {
    return {
      gap,
      classification: 'GENUINE_MISSING_COVERAGE',
      eligibleForRelaxation: false,
      reason: `researched only ${dispatched} time(s) so far (< ${minDispatches} required before relaxation is even considered) — real coverage may still close this with more targeted research`,
    }
  }
  const counts = history?.countAfterDispatch ?? []
  const plateaued = counts.length >= 2 && counts[counts.length - 1] <= counts[counts.length - 2]
  if (!plateaued) {
    return {
      gap,
      classification: 'GENUINE_MISSING_COVERAGE',
      eligibleForRelaxation: false,
      reason: `still gaining candidates after ${dispatched} research pass(es) (${counts.join(' -> ') || 'no count history yet'}) — not yet proven unrealistic`,
    }
  }
  const classification: GapRelaxClassification =
    gap.kind === 'CATEGORY_BELOW_MINIMUM' ? 'UNREALISTIC_CATEGORY_MINIMUM' : gap.kind === 'GEOGRAPHIC_BELOW_MINIMUM' ? 'UNREALISTIC_DISTRICT_DEPTH' : 'INSUFFICIENT_REAL_WORLD_INVENTORY'
  return {
    gap,
    classification,
    eligibleForRelaxation: true,
    reason: `${dispatched} targeted research pass(es) plateaued at ${counts[counts.length - 1]} (no improvement on the most recent pass) — real-world inventory for this target appears insufficient, not a research shortfall`,
  }
}

export function classifyGapsForRelaxation(gaps: readonly CoverageGap[], history: GapResearchHistory, minDispatches: number = DEFAULT_MIN_DISPATCHES_BEFORE_RELAXATION): GapClassification[] {
  return gaps.map((g) => classifyGapForRelaxation(g, history[gapHistoryKey(g)], minDispatches))
}

// ---------------------------------------------------------------------------
// Applying a relaxation — only ever loosens a target down to what was
// ACTUALLY achieved (never below), and only for gaps already classified
// eligible. Never touches candidates/certification — quality gates and
// rejected-candidate state are completely untouched by this module.
// ---------------------------------------------------------------------------

export interface PlanRelaxationRecord {
  kind: 'CATEGORY_MINIMUM' | 'DISTRICT_DEPTH' | 'NEIGHBORHOOD_KIND_DOWNGRADE'
  targetName: string
  fromValue: string
  toValue: string
  reason: string
  relaxedAtRound: number
}

export interface RelaxPlanInput {
  plan: CategoryCoveragePlan
  depthTargets: GeographicDepthTarget[]
  neighborhoods: NeighborhoodDefinition[]
  categoryCounts: readonly CategoryCount[]
  neighborhoodCounts: readonly NeighborhoodCount[]
  /** Must already be filtered to eligibleForRelaxation gaps only — this function applies relaxation unconditionally to whatever it's given. */
  gapsToRelax: readonly CoverageGap[]
  round: number
}

export interface RelaxPlanResult {
  plan: CategoryCoveragePlan
  depthTargets: GeographicDepthTarget[]
  neighborhoods: NeighborhoodDefinition[]
  relaxations: PlanRelaxationRecord[]
}

export function relaxPlanForGaps(input: RelaxPlanInput): RelaxPlanResult {
  const countByCategory = new Map(input.categoryCounts.map((c) => [c.categoryName, c.count]))
  const countByNeighborhood = new Map(input.neighborhoodCounts.map((n) => [n.neighborhoodName, n.count]))
  const relaxations: PlanRelaxationRecord[] = []

  const plan: CategoryCoveragePlan = { targets: input.plan.targets.map((t) => ({ ...t })) }
  const depthTargets: GeographicDepthTarget[] = input.depthTargets.map((d) => ({ ...d }))
  const neighborhoods: NeighborhoodDefinition[] = input.neighborhoods.map((n) => ({ ...n }))

  for (const gap of input.gapsToRelax) {
    if (gap.kind === 'CATEGORY_BELOW_MINIMUM') {
      const target = plan.targets.find((t) => t.categoryName === gap.name)
      if (!target) continue
      const achieved = countByCategory.get(gap.name) ?? 0
      const from = target.minimumViable
      if (achieved >= from) continue // nothing to relax — the gap must have closed since it was classified
      target.minimumViable = achieved
      if (target.healthyTarget < target.minimumViable) target.healthyTarget = target.minimumViable
      relaxations.push({
        kind: 'CATEGORY_MINIMUM',
        targetName: gap.name,
        fromValue: String(from),
        toValue: String(achieved),
        reason: `real-world inventory plateaued at ${achieved} after repeated targeted research — minimum lowered to match what was actually found, never raised or backfilled with filler`,
        relaxedAtRound: input.round,
      })
    } else if (gap.kind === 'GEOGRAPHIC_BELOW_MINIMUM') {
      const target = depthTargets.find((d) => d.neighborhoodName === gap.name)
      if (!target) continue
      const achieved = countByNeighborhood.get(gap.name) ?? 0
      const from = target.minimumItems
      if (achieved >= from) continue
      target.minimumItems = achieved
      relaxations.push({
        kind: 'DISTRICT_DEPTH',
        targetName: gap.name,
        fromValue: String(from),
        toValue: String(achieved),
        reason: `real-world inventory plateaued at ${achieved} after repeated targeted research — depth minimum lowered to match what was actually found, never raised or backfilled with filler`,
        relaxedAtRound: input.round,
      })
    } else if (gap.kind === 'GEOGRAPHIC_HOLE') {
      const n = neighborhoods.find((nb) => nb.name === gap.name)
      if (!n) continue
      const from = n.kind
      if (from !== 'core_urban' && from !== 'important_neighborhood') continue // already not zero-tolerance
      n.kind = 'destination_worthy_outer'
      relaxations.push({
        kind: 'NEIGHBORHOOD_KIND_DOWNGRADE',
        targetName: gap.name,
        fromValue: from,
        toValue: n.kind,
        reason: 'zero items found after repeated targeted research — downgraded from zero-tolerance coverage to a peripheral/destination-worthy classification, never backfilled with filler',
        relaxedAtRound: input.round,
      })
    }
  }

  return { plan, depthTargets, neighborhoods, relaxations }
}
