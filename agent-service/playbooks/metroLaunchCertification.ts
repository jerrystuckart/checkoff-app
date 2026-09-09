// agent-service/playbooks/metroLaunchCertification.ts
//
// Chief Phase 2U — the permanent METRO_LAUNCH_CERTIFICATION stage,
// converted from the full set of San Diego post-launch lessons. This is
// the single, final, fail-closed gate a metro build must pass before
// Winston can report READY TO ACTIVATE — never "stops after research,
// catalog creation, or SQL generation and leaves Jerry to discover
// additional missing production layers manually" (Jerry, 2026-09-07).
//
// Pure aggregation only — this module has NO DB access, no AI calls, no
// SQL generation of its own. It combines the StagingGateResult[] already
// produced by every other real gate in this pipeline (metroCatalog.ts's
// CATALOG_GATE/LOCATION_GATE/PRESENTATION_GATE/EDITORIAL_GATE/
// OUTREACH_GATE, metroMetadataEnrichment.ts's
// METADATA_COMPLETENESS_GATE/GEO_ENRICHMENT_GATE,
// editorialDistinctiveness.ts's DISTINCTIVE_EXPERIENCE_GATE/
// VENUE_QUOTING_GATE/OPENING_DISTRIBUTION_GATE,
// itemCertificationLoop.ts's ITEM_CERTIFICATION_GATE,
// metroTagCertification.ts's TAG_CERTIFICATION_GATE,
// homeListCertification.ts's HOME_LIST_CERTIFICATION_GATE/
// CURATED_LIST_LAYER_GATE) into one final verdict.
//
// A metro is READY_TO_ACTIVATE only when every REQUIRED gate PASSes.
// Otherwise BLOCKED, with the report listing every failing gate as an
// explicit, named reason — never a vague "needs more work."

import type { StagingGateResult } from './metroCatalog'

export type MetroLaunchVerdict = 'READY_TO_ACTIVATE' | 'BLOCKED'

/**
 * The full set of gate keys METRO_LAUNCH_CERTIFICATION requires, grouped
 * exactly per Jerry's 2026-09-07 category list (Catalog / Editorial /
 * Tags / Metadata / Geo / Lists / Presentation / Activation). Every key
 * here must appear, PASSing, in the gates supplied to
 * `certifyMetroLaunch()` — a gate that's simply MISSING from the input
 * (never run) is treated the same as a FAIL, never silently skipped.
 */
export const REQUIRED_GATE_CATEGORIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  Catalog: ['CATALOG_GATE', 'LOCATION_GATE'],
  // ITEM_CERTIFICATION_GATE (itemCertificationLoop.ts) is listed FIRST in
  // Editorial deliberately: every item must individually certify via the
  // bounded ITEM_CERTIFICATION_LOOP (own research, own critique) BEFORE
  // the batch-wide editorial gates run — a batch-level PASS never
  // substitutes for per-item certification (Jerry, 2026-09-07, after
  // manually rewriting ~15-20 San Diego items that survived every batch
  // gate but were still generic/venue-level).
  Editorial: ['ITEM_CERTIFICATION_GATE', 'PRESENTATION_GATE', 'EDITORIAL_GATE', 'DISTINCTIVE_EXPERIENCE_GATE', 'VENUE_QUOTING_GATE', 'OPENING_DISTRIBUTION_GATE'],
  Tags: ['TAG_CERTIFICATION_GATE'],
  Metadata: ['METADATA_COMPLETENESS_GATE'],
  Geo: ['GEO_ENRICHMENT_GATE'],
  Lists: ['HOME_LIST_CERTIFICATION_GATE'],
  // Images: intentionally its own category, evaluated LAST alongside
  // everything else, never used to stop the pipeline early — see
  // imageReadiness.ts. Winston cannot autonomously select images; that
  // is fine. What is not fine is treating a missing image as an
  // early-exit instead of one more named, complete gate.
  Images: ['IMAGE_READINESS_GATE'],
  // Outreach: verification-only, never an asset-generation stage — see
  // businessActivationKit.ts. A metro can never reach READY_TO_ACTIVATE
  // while proposing/referencing a metro-specific Featured Kit instead of
  // the one permanent, universal URL.
  Outreach: ['BUSINESS_ACTIVATION_KIT_GATE'],
})

export interface MetroLaunchCertificationSummary {
  catalogCount: number
  geoCoveragePercent: number
  geoExceptionsCount: number
  tagsComplete: boolean
  metadataComplete: boolean
  officialListsCount: number
  themedListsCount: number
  imagesComplete: boolean
  homeQueryPass: boolean
}

export interface MetroLaunchCertificationInput {
  metroName: string
  gates: readonly StagingGateResult[]
  summary: MetroLaunchCertificationSummary
}

export interface MetroLaunchCertificationReport {
  verdict: MetroLaunchVerdict
  metroName: string
  passingGates: string[]
  failingGates: StagingGateResult[]
  /** Gate keys REQUIRED_GATE_CATEGORIES expects but that never appeared in the supplied gates at all — treated as blocking, same as an explicit FAIL. */
  missingGates: string[]
  summary: MetroLaunchCertificationSummary
  /** Human-readable, ready-to-paste report matching the exact shape Jerry specified. */
  reportText: string
  /** true when the ONLY thing keeping this metro from READY_TO_ACTIVATE is IMAGE_READINESS_GATE — every other required gate passed. The pipeline still reports BLOCKED (image selection is a genuine human decision), but with the distinct "BLOCKED — image selection required" framing rather than a generic blocked report, and only ever computed AFTER every other gate has already run. */
  imageSelectionOnlyBlock: boolean
}

/**
 * The single, fail-closed launch-certification function. READY_TO_ACTIVATE
 * requires every gate key in REQUIRED_GATE_CATEGORIES to be present AND
 * PASSing in the supplied `gates` — nothing here re-derives or re-checks
 * the underlying evidence; that's each individual gate module's job. This
 * function's only responsibility is refusing to report ready while
 * anything required is missing or failing, and producing one clear,
 * complete summary instead of Jerry having to reconstruct the picture
 * from a dozen separate tool outputs.
 */
export function certifyMetroLaunch(input: MetroLaunchCertificationInput): MetroLaunchCertificationReport {
  const byKey = new Map(input.gates.map((g) => [g.key, g]))
  const requiredKeys = Object.values(REQUIRED_GATE_CATEGORIES).flat()

  const missingGates: string[] = []
  const failingGates: StagingGateResult[] = []
  const passingGates: string[] = []

  for (const key of requiredKeys) {
    const gate = byKey.get(key)
    if (!gate) {
      missingGates.push(key)
      continue
    }
    if (gate.verdict === 'FAIL') failingGates.push(gate)
    else passingGates.push(key)
  }

  const verdict: MetroLaunchVerdict = missingGates.length === 0 && failingGates.length === 0 ? 'READY_TO_ACTIVATE' : 'BLOCKED'
  // "The only unresolved thing is images" — computed AFTER every other
  // gate already ran, never used to short-circuit the pipeline earlier.
  const imageSelectionOnlyBlock = verdict === 'BLOCKED' && missingGates.length === 0 && failingGates.length === 1 && failingGates[0].key === 'IMAGE_READINESS_GATE'

  const reportText = buildReportText(input.metroName, verdict, input.summary, passingGates, failingGates, missingGates, imageSelectionOnlyBlock)

  return { verdict, metroName: input.metroName, passingGates, failingGates, missingGates, summary: input.summary, reportText, imageSelectionOnlyBlock }
}

function buildReportText(
  metroName: string,
  verdict: MetroLaunchVerdict,
  summary: MetroLaunchCertificationSummary,
  passingGates: string[],
  failingGates: readonly StagingGateResult[],
  missingGates: readonly string[],
  imageSelectionOnlyBlock: boolean
): string {
  const lines: string[] = []
  if (imageSelectionOnlyBlock) {
    lines.push(`METRO_LAUNCH_CERTIFICATION — ${metroName}`)
    lines.push('Verdict: BLOCKED — image selection required')
    lines.push('')
    lines.push('Every other required gate passed. The only remaining step is selecting/uploading images for the Home cards below — a human/business judgment call, never an automated pick:')
    lines.push(`  - ${failingGates[0].reason}`)
    lines.push('')
    lines.push(`Passing gates (${passingGates.length}): ${passingGates.join(', ')}`)
    return lines.join('\n')
  }
  lines.push(`METRO_LAUNCH_CERTIFICATION — ${metroName}`)
  lines.push(`Verdict: ${verdict}`)
  lines.push('')
  if (verdict === 'READY_TO_ACTIVATE') {
    lines.push(`Catalog: ${summary.catalogCount} items`)
    lines.push(`Geo coverage: ${summary.geoCoveragePercent}% (${summary.geoExceptionsCount} recorded exception(s))`)
    lines.push(`Tags: ${summary.tagsComplete ? 'complete (6-8 canonical tags/item)' : 'INCOMPLETE'}`)
    lines.push(`Metadata: ${summary.metadataComplete ? 'complete (all required fields evaluated)' : 'INCOMPLETE'}`)
    lines.push(`Official lists: ${summary.officialListsCount}`)
    lines.push(`Themed lists: ${summary.themedListsCount}`)
    lines.push(`Images: ${summary.imagesComplete ? 'complete' : 'INCOMPLETE'}`)
    lines.push(`Runtime Home query: ${summary.homeQueryPass ? 'PASS' : 'FAIL'}`)
  } else {
    lines.push('BLOCKED — the following are true human blockers or unresolved gate failures:')
    for (const key of missingGates) lines.push(`  - ${key}: never ran (missing from certification input)`)
    for (const gate of failingGates) lines.push(`  - ${gate.key}: ${gate.reason}`)
  }
  lines.push('')
  lines.push(`Passing gates (${passingGates.length}): ${passingGates.join(', ') || '(none)'}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Self-repair loop — bounded retries so an automatable failure never
// requires Jerry to manually re-invoke the pipeline, but also never
// spins forever. Generic over whatever "repair + rerun the gate"
// function the caller supplies for a given failure category (research
// gap, weak item, missing tags, ambiguous geo match, etc.) — this module
// only owns the bounding/looping discipline, never the repair logic
// itself (that's specific to each failure category and lives in its own
// module).
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_REPAIR_ATTEMPTS = 3

export interface RepairLoopResult<T> {
  finalResult: T
  attempts: number
  /** true only when the loop exited because the gate finally passed — false means it exited because the retry budget was exhausted, which the caller must then treat as a genuine BLOCKED/human-decision case, never silently reported as success. */
  succeeded: boolean
}

/**
 * `attempt` runs one repair-and-check cycle and returns both the latest
 * result and whether it now passes. This function does not know or care
 * WHAT is being repaired — a caller wraps e.g. "re-run the editorial
 * generator for the failing items, then re-check DISTINCTIVE_EXPERIENCE_GATE"
 * as one `attempt` call. Stops as soon as `isPassing` returns true, or
 * once `maxAttempts` is exhausted — never loops unbounded.
 */
export async function runWithBoundedRetries<T>(attempt: (attemptNumber: number, previousResult: T | null) => Promise<T>, isPassing: (result: T) => boolean, maxAttempts: number = DEFAULT_MAX_REPAIR_ATTEMPTS): Promise<RepairLoopResult<T>> {
  let previousResult: T | null = null
  let lastResult!: T
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    lastResult = await attempt(attemptNumber, previousResult)
    if (isPassing(lastResult)) {
      return { finalResult: lastResult, attempts: attemptNumber, succeeded: true }
    }
    previousResult = lastResult
  }
  return { finalResult: lastResult, attempts: maxAttempts, succeeded: false }
}

// ---------------------------------------------------------------------------
// Dynamic production-state discovery — a real, callable guard against the
// exact San Diego failure mode Jerry named: hardcoding a historical fact
// ("San Diego should currently have 143 items") into a certification
// check causes false failures the moment real production state legitimately
// changes. This function doesn't fetch anything itself (no DB access in
// this module, by design) — it exists so a caller MUST explicitly choose
// between "query live" and "use an explicitly frozen launch snapshot,"
// rather than accidentally hardcoding a number that will go stale.
// ---------------------------------------------------------------------------

export interface ProductionStateSource {
  kind: 'LIVE_QUERY' | 'FROZEN_LAUNCH_SNAPSHOT'
  /** For FROZEN_LAUNCH_SNAPSHOT: when the snapshot was taken and why it's still valid to compare against (e.g. "the exact set of items this catalog build produced, captured at generation time — never re-derived from a later, possibly-drifted live count"). Required so a frozen snapshot is always an explicit, justified choice, never an implicit stale assumption. */
  snapshotJustification?: string
}

export function assertExplicitProductionStateSource(source: ProductionStateSource): void {
  if (source.kind === 'FROZEN_LAUNCH_SNAPSHOT' && !source.snapshotJustification) {
    throw new Error('A FROZEN_LAUNCH_SNAPSHOT production-state source requires an explicit snapshotJustification — never compare against a frozen historical number without saying why it is still the right number to compare against.')
  }
}
