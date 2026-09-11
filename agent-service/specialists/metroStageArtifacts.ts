// Chief Phase 3B — durable stage artifacts (Vienna post-mortem, item 7).
//
// Vienna's biggest operational problem: nothing persisted a clean,
// machine-readable answer to "what does Winston currently consider the
// final catalog?" — recovering that required grepping a >1MB
// resume-run*.log. Logs are observability, not state storage.
//
// This module is a PURE function: MetroDriverState-shaped data in,
// named JSON/CSV file contents out. It never touches the filesystem
// itself — metroLaunchDriver.ts calls this after the relevant stage and
// hands the results to `deps.writeStageArtifact` (a real fs.writeFile
// by default, a no-op unless a caller wires one in — same DI discipline
// as every other side effect in this codebase). This keeps the pure
// logic testable without touching disk and keeps the driver's own
// resumability untouched (these files are a convenience export, never
// read back by the driver itself as its source of truth — the durable
// PlaybookRunStore state remains that).
//
// File names follow the semantics item 7 asked for; content shape is
// this codebase's own (RawCandidate / DriverItemCertificationRecord /
// HomeListPlanEntry), not a re-derivation.

import type { RawCandidate } from './candidateMerge'
import type { DriverItemCertificationRecord, HomeListPlanEntry } from './metroLaunchDriver'
import type { VenueCluster } from '../playbooks/venueDuplicateDetection'
import type { MetroFinisherReport } from '../playbooks/metroFinisherReport'
import type { MetroFinisherWorkPackets } from '../playbooks/metroFinisherIntegration'

export interface StageArtifactInput {
  candidates: readonly (RawCandidate & { needsVerification: boolean })[]
  itemCertifications: Readonly<Record<string, DriverItemCertificationRecord>>
  catalogPruningDrops: readonly { candidateName: string; reason: string; detail: string }[]
  homeListPlan: readonly HomeListPlanEntry[]
  categoryCounts: readonly { categoryName: string; count: number }[]
  neighborhoodCounts: readonly { neighborhoodName: string; count: number }[]
  homeListSqlPatch: string | null
  venueDuplicateClusters: readonly VenueCluster[]
  finalReportJson: unknown
  /** Chief Phase 3C — METRO_FINISHER_DEEP_RESEARCH's report, when this run has one. Never fabricated: absent (null/undefined) is reflected as an honest "not yet available" file, same discipline as every other not-yet-run stage here. */
  metroFinisherReport?: MetroFinisherReport | null
  /** Chief Phase 3C — METRO_FINISHER_INTEGRATION's deterministic work packets, when this run has computed them. */
  metroFinisherPackets?: MetroFinisherWorkPackets | null
}

function certifiedOnly(itemCertifications: Readonly<Record<string, DriverItemCertificationRecord>>) {
  return Object.values(itemCertifications).filter((r): r is DriverItemCertificationRecord & { finalBody: string } => r.outcome === 'ITEM_CERTIFIED' && r.finalBody !== null)
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function toCsv(rows: readonly Record<string, string>[], columns: readonly string[]): string {
  const lines = [columns.join(',')]
  for (const row of rows) lines.push(columns.map((c) => csvEscape(row[c] ?? '')).join(','))
  return lines.join('\n')
}

/**
 * Builds every artifact this run can currently produce. A caller
 * invokes this at whichever stage(s) it has real data for — an earlier
 * call naturally produces fewer non-empty files than a later one; this
 * function never errors on missing upstream data, it just reflects
 * "not yet available" as an empty array/null.
 */
export function buildStageArtifactFiles(input: StageArtifactInput): Record<string, string> {
  const certified = certifiedOnly(input.itemCertifications)
  const rejected = Object.values(input.itemCertifications).filter((r) => r.outcome !== 'ITEM_CERTIFIED')

  const files: Record<string, string> = {}

  files['01-discovered-candidates.json'] = JSON.stringify(input.candidates, null, 2)

  files['02-canonical-venues.json'] = JSON.stringify(
    input.venueDuplicateClusters.map((c) => ({ placeId: c.placeId, candidateNames: c.members.map((m) => m.candidateName) })),
    null,
    2
  )

  files['03-editorial-certified.json'] = JSON.stringify(
    certified.map((r) => ({ candidateName: r.candidateName, venueName: r.venueName, finalBody: r.finalBody, finalTags: r.finalTags, dbCategory: r.dbCategory ?? null })),
    null,
    2
  )

  files['04-pruning-decisions.json'] = JSON.stringify(
    [
      ...input.catalogPruningDrops.map((d) => ({ candidateName: d.candidateName, decision: 'DROPPED', reason: d.reason, detail: d.detail })),
      ...rejected.filter((r) => !input.catalogPruningDrops.some((d) => d.candidateName === r.candidateName)).map((r) => ({ candidateName: r.candidateName, decision: 'REJECTED', reason: r.outcome, detail: r.rejectionReasons.join('; ') })),
    ],
    null,
    2
  )

  files['05-final-retained-catalog.json'] = JSON.stringify(
    certified.map((r) => ({ candidateName: r.candidateName, venueName: r.venueName, body: r.finalBody, tags: r.finalTags, dbCategory: r.dbCategory ?? null })),
    null,
    2
  )

  files['05-final-retained-catalog.csv'] = toCsv(
    certified.map((r) => ({ candidateName: r.candidateName, venueName: r.venueName, dbCategory: r.dbCategory ?? '', body: r.finalBody ?? '', tags: r.finalTags.join('|') })),
    ['candidateName', 'venueName', 'dbCategory', 'body', 'tags']
  )

  files['06-category-coverage.json'] = JSON.stringify(input.categoryCounts, null, 2)

  files['07-geographic-coverage.json'] = JSON.stringify(input.neighborhoodCounts, null, 2)

  files['07a-metro-finisher-report.json'] = JSON.stringify(input.metroFinisherReport ?? null, null, 2)

  files['07b-metro-finisher-packets.json'] = JSON.stringify(input.metroFinisherPackets ?? null, null, 2)

  files['08-home-list-package.json'] = JSON.stringify(input.homeListPlan, null, 2)

  files['09-production-package.sql'] = input.homeListSqlPatch ?? '-- not yet generated'

  files['10-final-report.json'] = JSON.stringify(input.finalReportJson ?? null, null, 2)

  return files
}
