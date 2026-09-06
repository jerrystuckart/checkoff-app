#!/usr/bin/env -S npx tsx
// scripts/generate-san-diego-metadata-enrichment-report.ts
//
// Metadata completeness enrichment — San Diego, dry run only. Applies
// agent-service/playbooks/metroMetadataEnrichment.ts's deterministic
// rules to the real 149 live San Diego/Tijuana items and writes a
// human-readable JSON report of PROPOSED changes. Writes NOTHING to
// production, does not touch catalog membership or editorial wording,
// does not call Google Places. Jerry's one known manual override (The
// Goods: difficulty=10, photo_required=true — the only non-default row
// among the 149 per his own exported field-state report, 2026-09-06) is
// passed in explicitly and preserved rather than overwritten.
//
// Usage: npx tsx scripts/generate-san-diego-metadata-enrichment-report.ts
import { writeFileSync, mkdirSync } from 'node:fs'
import { buildFinalRecords, loadEnvFile } from './sanDiegoReconciliationShared'
import { evaluateItemMetadata, evaluateMetadataCompletenessGate, type MetadataEnrichmentResult } from '../agent-service/playbooks/metroMetadataEnrichment'

loadEnvFile('.env')

// The one confirmed manual override across all 149 live items (Jerry's
// exported field-state report, 2026-09-06: "difficulty: 148/149 = 1; one
// manually edited item = 10" / "photo_required: 148/149 false; one
// manually edited item = true" — both point at the same row).
const KNOWN_MANUAL_OVERRIDES: Record<string, { difficulty?: number; photoRequired?: boolean }> = {
  'The Goods': { difficulty: 10, photoRequired: true },
}

async function main() {
  const sd = await buildFinalRecords('san-diego', [])
  const tj = await buildFinalRecords('san-diego-tijuana-extension', [])
  const allRecords = [...sd.records, ...tj.records]

  const results: MetadataEnrichmentResult[] = allRecords.map((r) =>
    evaluateItemMetadata({
      candidateName: r.candidateName,
      body: r.body,
      dbCategory: r.dbCategory,
      existing: KNOWN_MANUAL_OVERRIDES[r.candidateName],
    })
  )

  const gate = evaluateMetadataCompletenessGate(results)
  console.error(`METADATA_COMPLETENESS_GATE: ${gate.verdict} — ${gate.reason}`)

  // Summaries for the report.
  const countBy = <T extends string | number | boolean | null>(pick: (r: MetadataEnrichmentResult) => T) => {
    const counts = new Map<string, number>()
    for (const r of results) {
      const key = String(pick(r))
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Object.fromEntries(counts)
  }

  const proposedChanges = results.filter((r) => {
    if (r.hasAlcohol.value !== false) return true
    if (r.photoRequired.preservedManualOverride) return true
    if (r.photoRequired.value !== false && !r.photoRequired.preservedManualOverride) return true
    if (r.isSecret.value !== false) return true
    if (r.difficulty.preservedManualOverride) return true
    if (r.difficulty.value !== 1 && !r.difficulty.preservedManualOverride) return true
    return false
  })

  const lowConfidenceFlags = results.filter((r) =>
    [r.hasAlcohol, r.photoRequired, r.isSecret, r.difficulty, r.visitProfileKey].some((f) => f.confidence === 'LOW')
  )

  const report = {
    generatedAt: new Date().toISOString(),
    totalItems: results.length,
    gate,
    summary: {
      hasAlcohol: countBy((r) => r.hasAlcohol.value),
      photoRequired: countBy((r) => r.photoRequired.value),
      checkinType: countBy((r) => r.checkinType.value),
      isSecret: countBy((r) => r.isSecret.value),
      difficulty: countBy((r) => r.difficulty.value),
      visitProfileKey: countBy((r) => r.visitProfileKey.value),
      websiteUrlNeedingResearch: results.filter((r) => !r.websiteUrl.evaluated).length,
      manualOverridesPreserved: results.filter((r) => r.difficulty.preservedManualOverride || r.photoRequired.preservedManualOverride).map((r) => r.candidateName),
    },
    itemsChangingFromDefault: proposedChanges.map((r) => ({
      candidateName: r.candidateName,
      hasAlcohol: r.hasAlcohol,
      photoRequired: r.photoRequired,
      checkinType: r.checkinType,
      isSecret: r.isSecret,
      difficulty: r.difficulty,
      visitProfileKey: r.visitProfileKey,
    })),
    lowConfidenceFlagsForHumanReview: lowConfidenceFlags.map((r) => ({
      candidateName: r.candidateName,
      hasAlcohol: r.hasAlcohol.confidence === 'LOW' ? r.hasAlcohol : undefined,
      photoRequired: r.photoRequired.confidence === 'LOW' ? r.photoRequired : undefined,
      isSecret: r.isSecret.confidence === 'LOW' ? r.isSecret : undefined,
      difficulty: r.difficulty.confidence === 'LOW' ? r.difficulty : undefined,
      visitProfileKey: r.visitProfileKey.confidence === 'LOW' ? r.visitProfileKey : undefined,
    })),
    allItems: results,
  }

  mkdirSync('scripts/output', { recursive: true })
  const outPath = `scripts/output/san-diego-metadata-enrichment-report-${new Date().toISOString().slice(0, 10)}.json`
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.error(`\nWrote ${outPath}`)
  console.error(`Total: ${results.length}. Proposing a non-default value for ${proposedChanges.length} item(s). ${lowConfidenceFlags.length} item(s) have at least one LOW-confidence field worth a human glance.`)
  console.error(`has_alcohol: ${JSON.stringify(report.summary.hasAlcohol)}`)
  console.error(`checkin_type: ${JSON.stringify(report.summary.checkinType)}`)
  console.error(`is_secret: ${JSON.stringify(report.summary.isSecret)}`)
  console.error(`difficulty: ${JSON.stringify(report.summary.difficulty)}`)
  console.error(`visit_profile_key: ${JSON.stringify(report.summary.visitProfileKey)}`)
  console.error(`website_url needing research: ${report.summary.websiteUrlNeedingResearch}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
