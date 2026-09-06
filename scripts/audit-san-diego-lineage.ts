#!/usr/bin/env -S npx tsx
// Read-only audit (no public.* writes, no geocoding, no activation) —
// builds the full 203->124 candidate lineage report for San Diego, per
// Jerry's attrition-audit request (2026-09-06). Joins the raw, pre-intake
// canonical candidates (scripts/output/raw-candidates-san-diego.json) with
// the dry-run pipeline's finalRecords/failures
// (scripts/output/metro-catalog-dry-run-*.json) to classify exactly what
// happened to every one of the 203.
import { readFileSync, writeFileSync } from 'node:fs'

interface RawCandidate {
  name: string
  category: string
  neighborhood: string | null
  claimSupported: string
  verificationConfidence?: string
  needsVerification?: boolean
}

const raw: RawCandidate[] = JSON.parse(readFileSync('scripts/output/raw-candidates-san-diego.json', 'utf8'))
const dryRun = JSON.parse(readFileSync('scripts/output/metro-catalog-dry-run-2026-09-06.json', 'utf8'))
const sd = dryRun.find((d: any) => d.projectId === 'san-diego')

const finalByName = new Map<string, any>(sd.finalRecords.map((r: any) => [r.candidateName.trim(), r]))
const failureByName = new Map<string, string>(sd.failures.map((f: any) => [f.candidateName.trim(), f.reason]))
const semDupByDiscarded = new Map<string, { target: string; matchKind: 'exact' | 'similar' }>()
for (const g of sd.semanticDuplicatesRemoved) {
  for (const d of g.discarded) semDupByDiscarded.set(d.candidateName.trim(), { target: g.kept.candidateName.trim(), matchKind: g.matchKind })
}

type Bucket =
  | 'KEPT'
  | 'TRUE_DUPLICATE'
  | 'SAME_VENUE_DISTINCT_COLLAPSED'
  | 'CATEGORY_FAILURE'
  | 'NEIGHBORHOOD_FAILURE'
  | 'VERIFICATION_FAILURE'
  | 'PRESENTATION_FAILURE'
  | 'INTENTIONAL_QUALITY_EXCLUSION'
  | 'OTHER'

interface LineageRow {
  name: string
  originalCategory: string
  originalNeighborhood: string | null
  disposition: 'KEPT' | 'REMOVED'
  stage: string
  reasonCode: string
  reason: string
  duplicateTarget: string | null
  deterministicOrJudgment: 'DETERMINISTIC' | 'JUDGMENT'
  stillAppearsElsewhere: boolean
  bucket: Bucket | null
}

function classifyReason(name: string, reason: string): { stage: string; reasonCode: string; bucket: Bucket; deterministic: 'DETERMINISTIC' | 'JUDGMENT' } {
  if (reason.includes('candidate has no name') || reason.includes('no checkoffized item text') || reason.includes('no name/neighborhood text')) {
    return { stage: 'MAPPING', reasonCode: 'MISSING_REQUIRED_FIELD', bucket: 'OTHER', deterministic: 'DETERMINISTIC' }
  }
  if (reason.includes('canonical category') || reason.includes('unclassified upstream')) {
    return { stage: 'MAPPING', reasonCode: 'CATEGORY_MAPPING_FAILURE', bucket: 'CATEGORY_FAILURE', deterministic: 'DETERMINISTIC' }
  }
  if (reason.startsWith('neighborhood:')) {
    if (reason.includes('country mismatch')) return { stage: 'NEIGHBORHOOD_RESOLUTION', reasonCode: 'COUNTRY_MISMATCH', bucket: 'NEIGHBORHOOD_FAILURE', deterministic: 'DETERMINISTIC' }
    if (reason.includes('ambiguous')) return { stage: 'NEIGHBORHOOD_RESOLUTION', reasonCode: 'AMBIGUOUS_NEIGHBORHOOD', bucket: 'NEIGHBORHOOD_FAILURE', deterministic: 'DETERMINISTIC' }
    if (reason.includes('no neighborhood text at all')) return { stage: 'NEIGHBORHOOD_RESOLUTION', reasonCode: 'NO_NEIGHBORHOOD_TEXT', bucket: 'NEIGHBORHOOD_FAILURE', deterministic: 'DETERMINISTIC' }
    return { stage: 'NEIGHBORHOOD_RESOLUTION', reasonCode: 'NO_CANONICAL_MATCH', bucket: 'NEIGHBORHOOD_FAILURE', deterministic: 'DETERMINISTIC' }
  }
  if (reason.startsWith('semantic duplicate of')) {
    const info = semDupByDiscarded.get(name)
    const isExact = info?.matchKind === 'exact'
    return { stage: 'SEMANTIC_DEDUP', reasonCode: isExact ? 'SEMANTIC_DUP_EXACT' : 'SEMANTIC_DUP_SIMILAR', bucket: isExact ? 'TRUE_DUPLICATE' : 'SAME_VENUE_DISTINCT_COLLAPSED', deterministic: isExact ? 'DETERMINISTIC' : 'JUDGMENT' }
  }
  if (reason.startsWith('rejected by presentation content check')) {
    return { stage: 'PRESENTATION_FILTER', reasonCode: 'PRESENTATION_CONTENT_REJECTED', bucket: 'PRESENTATION_FAILURE', deterministic: 'DETERMINISTIC' }
  }
  return { stage: 'UNKNOWN', reasonCode: 'UNCLASSIFIED', bucket: 'OTHER', deterministic: 'JUDGMENT' }
}

const rows: LineageRow[] = []
for (const c of raw) {
  const name = c.name.trim()
  const final = finalByName.get(name)
  if (final) {
    rows.push({
      name,
      originalCategory: c.category,
      originalNeighborhood: c.neighborhood,
      disposition: 'KEPT',
      stage: 'STAGED',
      reasonCode: 'KEPT',
      reason: 'Present in final 124-item staged San Diego catalog.',
      duplicateTarget: null,
      deterministicOrJudgment: 'DETERMINISTIC',
      stillAppearsElsewhere: true,
      bucket: null,
    })
    continue
  }
  const reason = failureByName.get(name) ?? '(no matching failure record found — investigate)'
  const { stage, reasonCode, bucket, deterministic } = classifyReason(name, reason)
  const duplicateTarget = semDupByDiscarded.get(name)?.target ?? null
  const stillAppearsElsewhere = duplicateTarget ? finalByName.has(duplicateTarget) : false
  rows.push({
    name,
    originalCategory: c.category,
    originalNeighborhood: c.neighborhood,
    disposition: 'REMOVED',
    stage,
    reasonCode,
    reason,
    duplicateTarget,
    deterministicOrJudgment: deterministic,
    stillAppearsElsewhere,
    bucket,
  })
}

// Sanity check: every raw candidate must be accounted for exactly once.
if (rows.length !== raw.length) throw new Error(`accounting error: ${rows.length} rows for ${raw.length} raw candidates`)
const keptCount = rows.filter((r) => r.disposition === 'KEPT').length
const removedCount = rows.filter((r) => r.disposition === 'REMOVED').length
console.error(`Total: ${rows.length}, kept: ${keptCount}, removed: ${removedCount}`)

const unaccounted = rows.filter((r) => r.reasonCode === 'UNCLASSIFIED' || r.reason.includes('no matching failure record found'))
if (unaccounted.length > 0) {
  console.error(`WARNING: ${unaccounted.length} candidate(s) could not be matched to a final record or a failure reason:`, unaccounted.map((r) => r.name))
}

// Bucket counts (only over the 79 removed)
const bucketCounts: Record<string, number> = {}
for (const r of rows.filter((r) => r.disposition === 'REMOVED')) {
  const b = r.bucket ?? 'OTHER'
  bucketCounts[b] = (bucketCounts[b] ?? 0) + 1
}
console.error('\nBucket counts (of 79 removed):')
for (const [b, count] of Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])) {
  console.error(`  ${b}: ${count}`)
}

const deterministicCount = rows.filter((r) => r.disposition === 'REMOVED' && r.deterministicOrJudgment === 'DETERMINISTIC').length
const judgmentCount = rows.filter((r) => r.disposition === 'REMOVED' && r.deterministicOrJudgment === 'JUDGMENT').length
console.error(`\nDeterministic removals: ${deterministicCount}, judgment-based removals: ${judgmentCount}`)

const stillAppearsCount = rows.filter((r) => r.disposition === 'REMOVED' && r.stillAppearsElsewhere).length
console.error(`Removed candidates whose underlying experience still appears elsewhere in the final 124: ${stillAppearsCount}`)

writeFileSync('scripts/output/san-diego-203-lineage-report.json', JSON.stringify(rows, null, 2))
console.error('\nWrote scripts/output/san-diego-203-lineage-report.json')

// CSV for easy review
const csvHeader = ['name', 'originalCategory', 'originalNeighborhood', 'disposition', 'stage', 'reasonCode', 'bucket', 'duplicateTarget', 'deterministicOrJudgment', 'stillAppearsElsewhere', 'reason']
function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csvLines = [csvHeader.join(','), ...rows.map((r) => csvHeader.map((h) => csvEscape((r as any)[h])).join(','))]
writeFileSync('scripts/output/san-diego-203-lineage-report.csv', csvLines.join('\n'))
console.error('Wrote scripts/output/san-diego-203-lineage-report.csv')
