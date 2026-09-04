// Chief Phase 2C — the Metro Launch playbook. Pure logic only.
//
// RECONSTRUCTED FROM (not invented): docs/metro-launch-playbook.md (v2,
// the authoritative, code-verified process from the Denver/Boulder/
// Longmont cycle — geography model, staging mechanism, the 6-phase
// audit/decide/generate/apply process, the Part 3 launch-day checklist),
// docs/metro-launch-audit/05_item_intake_contract.md (the live-verified
// items.* column contract), docs/metro-launch-audit/08_future_metro_
// build_sequence.md (dependency order), and Open Brain (the July 2026
// "Metro Launch Playbook FINAL" 10-step sequence, the June 2026 "Adding
// New Metros Playbook", and the real Tucson/Phoenix Fall/Denver launch
// records — including denver_sports_intake_approved.sql and
// denver_catalog_intake_manifest.csv found in the actual repo, which
// prove a real historical "targeted deep dive for a weak category"
// (Sports) already happened for Denver, just never formalized as a
// named, repeatable playbook stage).
//
// GENUINELY MISSING piece this playbook adds (not previously
// documented anywhere as a formal process, confirmed by its absence
// from every source above): the CONTENT discovery/coverage loop —
// M2 through M6 below. Every prior "metro launch playbook" document
// covers geography/schema/staging (M0, M1's mechanics, M7, M8, M13,
// M14) in detail, but the actual item-research work was done ad hoc
// each time ("Tucson: ~58 items researched... located in past
// conversation", "Phoenix Fall list finalized at 32 items") with no
// named category-coverage target, no formal gap-detection step, and no
// repeatable targeted-research loop — even though that loop demonstrably
// happened in practice (the Denver Sports intake file is direct
// evidence of it). M2-M6 formalize what was already being learned by
// doing, using the real fields already used in practice
// (denver_catalog_intake_manifest.csv's category/neighborhood/
// eligibility/reason/source_group columns) as the evidence shape.

import { evaluateAuthority } from './standingAuthority'

export type MetroLaunchStage =
  | 'M0_METRO_DEFINITION'
  | 'M1_GEOGRAPHY_MAP'
  | 'M2_CATEGORY_COVERAGE_PLAN'
  | 'M3_BROAD_DISCOVERY'
  | 'M4_COVERAGE_AUDIT'
  | 'M5_TARGETED_DEEP_DIVES'
  | 'M6_QUALITY_VERIFICATION'
  | 'M7_CATALOG_CONSTRUCTION'
  | 'M8_CURATED_LAUNCH_EXPERIENCE'
  | 'M9_VISUAL_COVERAGE'
  | 'M10_OUTREACH_PREPARATION'
  | 'M11_OUTREACH_EXECUTION'
  | 'M12_RESPONSE_OPERATIONS'
  | 'M13_LAUNCH_READINESS'
  | 'M14_LAUNCH'
  | 'M15_POST_LAUNCH'

export const METRO_LAUNCH_PLAYBOOK_KEY = 'metro_launch'
export const METRO_LAUNCH_SOURCE_TYPE = 'metro_launch_stage'

export const METRO_LAUNCH_STAGE_ORDER: readonly MetroLaunchStage[] = [
  'M0_METRO_DEFINITION',
  'M1_GEOGRAPHY_MAP',
  'M2_CATEGORY_COVERAGE_PLAN',
  'M3_BROAD_DISCOVERY',
  'M4_COVERAGE_AUDIT',
  'M5_TARGETED_DEEP_DIVES', // loops back to M4 — see deriveMetroLoopAction
  'M6_QUALITY_VERIFICATION',
  'M7_CATALOG_CONSTRUCTION',
  'M8_CURATED_LAUNCH_EXPERIENCE',
  'M9_VISUAL_COVERAGE',
  'M10_OUTREACH_PREPARATION',
  'M11_OUTREACH_EXECUTION', // hands off to the existing Business Photo Outreach playbook (Phase 2A)
  'M12_RESPONSE_OPERATIONS',
  'M13_LAUNCH_READINESS',
  'M14_LAUNCH', // APPROVAL_REQUIRED — metro_launch.public_launch
  'M15_POST_LAUNCH',
]

// ---------------------------------------------------------------------------
// M0 — Metro Definition
// ---------------------------------------------------------------------------

export interface MetroDefinition {
  metroName: string
  slug: string
  includedCities: string[]
  excludedAreas: string[]
  timezone: string // IANA, e.g. America/Los_Angeles — set correctly at creation, per the v2 playbook's explicit Milwaukee-timezone-bug lesson
  launchSeason: string | null // null is valid — v2 playbook: season_tag at launch is a real open decision, not required
  targetCatalogSize: number
  audienceContext: string
}

// ---------------------------------------------------------------------------
// M1 — Geography / Neighborhood map
// ---------------------------------------------------------------------------

export interface NeighborhoodDefinition {
  name: string
  kind: 'core_urban' | 'important_neighborhood' | 'suburb' | 'destination_worthy_outer'
  /** Metro-appropriate ring radii, in meters — v2 playbook's explicit Denver lesson: schema defaults (20mi/40mi) are unsafe for tightly-packed metros. */
  ring1RadiusM: number
  ring2RadiusM: number
}

/** Programmatic, not eyeballed — the v2 playbook's own verified invariant for every neighborhood set so far. */
export function verifyNoRingOverlap(neighborhoods: Array<{ name: string; lat: number; lng: number; ring2RadiusM: number }>): { ok: boolean; overlaps: Array<[string, string]> } {
  const overlaps: Array<[string, string]> = []
  for (let i = 0; i < neighborhoods.length; i++) {
    for (let j = i + 1; j < neighborhoods.length; j++) {
      const a = neighborhoods[i]
      const b = neighborhoods[j]
      const distanceM = haversineMeters(a.lat, a.lng, b.lat, b.lng)
      if (distanceM < a.ring2RadiusM + b.ring2RadiusM) overlaps.push([a.name, b.name])
    }
  }
  return { ok: overlaps.length === 0, overlaps }
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ---------------------------------------------------------------------------
// M2 — Category coverage plan. Configurable, category-specific targets —
// per explicit instruction, never one arbitrary fixed count for every
// category (the historical evidence itself shows this: Denver's Sports
// intake was a targeted response to Sports specifically being weak, not
// a blanket rule).
// ---------------------------------------------------------------------------

export interface CategoryTarget {
  categoryName: string
  minimumViable: number
  healthyTarget: number
  /** e.g. "must include at least one hidden/secret-style experience" — category-specific quality rules, documentation only, checked by whoever runs the deep dive. */
  qualityNotes: string[]
}

export interface CategoryCoveragePlan {
  targets: CategoryTarget[]
}

// ---------------------------------------------------------------------------
// M4 — Coverage audit evidence + M5 targeted deep-dive loop
// ---------------------------------------------------------------------------

export interface CategoryCount {
  categoryName: string
  count: number
}

export interface NeighborhoodCount {
  neighborhoodName: string
  count: number
}

export interface CoverageAuditEvidence {
  categoryCounts: CategoryCount[]
  neighborhoodCounts: NeighborhoodCount[]
  plan: CategoryCoveragePlan
  /** Every core_urban/important_neighborhood area should have at least one item — a truly empty one is a geographic hole. */
  allNeighborhoods: NeighborhoodDefinition[]
}

export interface CoverageGap {
  kind: 'CATEGORY_BELOW_MINIMUM' | 'CATEGORY_BELOW_TARGET' | 'GEOGRAPHIC_HOLE' | 'CATEGORY_OVERREPRESENTED'
  name: string
  detail: string
}

/**
 * The M4 checkpoint. Never mutates anything — pure evidence-in,
 * gaps-out. An overrepresented category is flagged (not itself a
 * blocker) so a future deep-dive pass can be redirected away from it.
 */
export function auditCoverage(evidence: CoverageAuditEvidence): CoverageGap[] {
  const gaps: CoverageGap[] = []
  const countByCategory = new Map(evidence.categoryCounts.map((c) => [c.categoryName, c.count]))

  for (const target of evidence.plan.targets) {
    const count = countByCategory.get(target.categoryName) ?? 0
    if (count < target.minimumViable) {
      gaps.push({ kind: 'CATEGORY_BELOW_MINIMUM', name: target.categoryName, detail: `${count}/${target.minimumViable} minimum viable` })
    } else if (count < target.healthyTarget) {
      gaps.push({ kind: 'CATEGORY_BELOW_TARGET', name: target.categoryName, detail: `${count}/${target.healthyTarget} healthy target` })
    } else if (count > target.healthyTarget * 2) {
      gaps.push({ kind: 'CATEGORY_OVERREPRESENTED', name: target.categoryName, detail: `${count} vs. healthy target ${target.healthyTarget}` })
    }
  }

  const countByNeighborhood = new Map(evidence.neighborhoodCounts.map((n) => [n.neighborhoodName, n.count]))
  for (const n of evidence.allNeighborhoods) {
    if (n.kind === 'core_urban' || n.kind === 'important_neighborhood') {
      const count = countByNeighborhood.get(n.name) ?? 0
      if (count === 0) gaps.push({ kind: 'GEOGRAPHIC_HOLE', name: n.name, detail: `0 items in a ${n.kind.replace('_', ' ')}` })
    }
  }

  return gaps
}

export type MetroLoopAction = 'TARGETED_RESEARCH' | 'PROCEED_TO_VERIFICATION'

/**
 * The M4 <-> M5 self-correction loop (spec section 13's "Example Metro
 * loop"): broad research -> count -> detect gaps -> targeted research
 * -> recount -> ... -> gate pass. This function IS the loop's decision
 * point, called after every M4 pass.
 */
export function deriveMetroLoopAction(gaps: CoverageGap[]): { action: MetroLoopAction; blockingGaps: CoverageGap[]; note: string } {
  const blockingGaps = gaps.filter((g) => g.kind === 'CATEGORY_BELOW_MINIMUM' || g.kind === 'GEOGRAPHIC_HOLE')
  if (blockingGaps.length > 0) {
    return { action: 'TARGETED_RESEARCH', blockingGaps, note: `${blockingGaps.length} blocking gap(s) — targeted research needed before proceeding.` }
  }
  return { action: 'PROCEED_TO_VERIFICATION', blockingGaps: [], note: 'No category-minimum or geographic-hole gaps remain.' }
}

// ---------------------------------------------------------------------------
// Quality gates (spec section 4) — configurable, not arbitrary fixed
// counts baked in. Each gate is a pure function of structured evidence.
// ---------------------------------------------------------------------------

export type GateVerdict = 'PASS' | 'FAIL' | 'PASS_WITH_EXCEPTION'

export interface GateResult {
  key: string
  verdict: GateVerdict
  reason: string
}

export interface QualityAuditEvidence {
  knownClosures: string[] // item ids/names flagged closed by research_verifier
  suspectedDuplicates: Array<[string, string]>
  filler: string[]
}

export interface LocationEvidence {
  totalItems: number
  itemsWithCoordinates: number
}

export interface PresentationEvidence {
  homeRenders: boolean
  listsRender: boolean
  imagesRender: boolean
}

export interface OutreachReadinessEvidence {
  targetBusinessCount: number
  queuedCount: number
}

export interface MetroGateEvidence {
  coverageGaps: CoverageGap[]
  quality: QualityAuditEvidence
  catalog: { viableItemCount: number; targetCatalogSize: number }
  location: LocationEvidence
  presentation: PresentationEvidence
  outreach: OutreachReadinessEvidence
  /** Category-minimum exceptions Jerry has explicitly approved — the ONLY way a category gate can pass despite a real gap. */
  approvedCategoryExceptions: string[]
}

export function evaluateMetroGates(evidence: MetroGateEvidence): GateResult[] {
  const results: GateResult[] = []

  const geoHoles = evidence.coverageGaps.filter((g) => g.kind === 'GEOGRAPHIC_HOLE')
  results.push({
    key: 'GEOGRAPHY_GATE',
    verdict: geoHoles.length === 0 ? 'PASS' : 'FAIL',
    reason: geoHoles.length === 0 ? 'No unintentionally empty target neighborhood/area.' : `${geoHoles.length} empty target area(s): ${geoHoles.map((g) => g.name).join(', ')}`,
  })

  const belowMin = evidence.coverageGaps.filter((g) => g.kind === 'CATEGORY_BELOW_MINIMUM' && !evidence.approvedCategoryExceptions.includes(g.name))
  results.push({
    key: 'CATEGORY_GATE',
    verdict: belowMin.length === 0 ? 'PASS' : 'FAIL',
    reason: belowMin.length === 0 ? 'No important category below minimum without an approved exception.' : `Below minimum, no exception: ${belowMin.map((g) => g.name).join(', ')}`,
  })

  const qualityIssues = evidence.quality.knownClosures.length + evidence.quality.suspectedDuplicates.length + evidence.quality.filler.length
  results.push({
    key: 'QUALITY_GATE',
    verdict: qualityIssues === 0 ? 'PASS' : 'FAIL',
    reason: qualityIssues === 0 ? 'No known closures, duplicates, or filler.' : `${evidence.quality.knownClosures.length} closure(s), ${evidence.quality.suspectedDuplicates.length} duplicate pair(s), ${evidence.quality.filler.length} filler item(s).`,
  })

  results.push({
    key: 'CATALOG_GATE',
    verdict: evidence.catalog.viableItemCount >= evidence.catalog.targetCatalogSize ? 'PASS' : 'FAIL',
    reason: `${evidence.catalog.viableItemCount}/${evidence.catalog.targetCatalogSize} target viable items.`,
  })

  const locationOk = evidence.location.totalItems > 0 && evidence.location.itemsWithCoordinates === evidence.location.totalItems
  results.push({
    key: 'LOCATION_GATE',
    verdict: locationOk ? 'PASS' : 'FAIL',
    reason: locationOk
      ? 'All items have required coordinates/profile data.'
      : `${evidence.location.itemsWithCoordinates}/${evidence.location.totalItems} items have coordinates — every item must have maps_lat/maps_lng (item intake contract).`,
  })

  const presentationOk = evidence.presentation.homeRenders && evidence.presentation.listsRender && evidence.presentation.imagesRender
  results.push({
    key: 'PRESENTATION_GATE',
    verdict: presentationOk ? 'PASS' : 'FAIL',
    reason: presentationOk ? 'Home/lists/images render.' : 'One or more of Home/lists/images does not render correctly.',
  })

  results.push({
    key: 'OUTREACH_GATE',
    verdict: evidence.outreach.queuedCount >= evidence.outreach.targetBusinessCount ? 'PASS' : 'FAIL',
    reason: `${evidence.outreach.queuedCount}/${evidence.outreach.targetBusinessCount} target businesses queued for outreach.`,
  })

  return results
}

export function allGatesPass(results: GateResult[]): boolean {
  return results.every((r) => r.verdict === 'PASS' || r.verdict === 'PASS_WITH_EXCEPTION')
}

export function coarseStatusForStage(stage: MetroLaunchStage): 'READY' | 'IN_PROGRESS' | 'WAITING' | 'NEEDS_JERRY' | 'DONE' {
  if (stage === 'M0_METRO_DEFINITION') return 'READY'
  if (stage === 'M14_LAUNCH') return 'NEEDS_JERRY' // public_launch is always APPROVAL_REQUIRED
  if (stage === 'M15_POST_LAUNCH') return 'DONE'
  if (stage === 'M11_OUTREACH_EXECUTION' || stage === 'M12_RESPONSE_OPERATIONS') return 'WAITING' // hands off to Business Photo Outreach's own WAITING/resume loop
  return 'IN_PROGRESS'
}

export function verifyAuthorityCoverage(): void {
  for (const op of [
    'metro_launch.research',
    'metro_launch.coverage_count',
    'metro_launch.identify_gap',
    'metro_launch.create_draft_task',
    'metro_launch.build_internal_artifact',
    'metro_launch.deterministic_db_bookkeeping',
    'metro_launch.stage_catalog_write',
    'metro_launch.public_launch',
    'metro_launch.destructive_data_change',
  ]) {
    evaluateAuthority(op)
  }
}
