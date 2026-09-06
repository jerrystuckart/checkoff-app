#!/usr/bin/env -S npx tsx
// scripts/metro-catalog-dry-run.ts
//
// Chief M7-M9 — Metro Catalog Construction dry run. Reusable across
// metros: reads a metro_launch run's persisted canonical candidates and
// runs them through agent-service/playbooks/metroCatalog.ts's single
// consolidated runIntakePipeline() — the SAME function
// scripts/generate-san-diego-catalog-sql.ts calls to produce the actual
// SQL, so this report's gate results can never drift from what the
// generator actually emits (San Diego catalog SQL review, 2026-09-06).
//
// THIS SCRIPT NEVER WRITES TO ANY public.* TABLE — agent_service has no
// INSERT/UPDATE/DELETE grant on public schema at all, so it structurally
// could not even if it tried. It writes ONLY to local review files under
// scripts/output/.
//
// Usage: npx tsx scripts/metro-catalog-dry-run.ts

import { writeFileSync, mkdirSync } from 'node:fs'
import { Pool } from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { DbPlaybookRunStore } from '../agent-service/specialists/dbPlaybookRunStore'
import { playbookRunId } from '../agent-service/specialists/playbookRun'
import { classifyCategory } from '../agent-service/playbooks/categoryNormalization'
import { runIntakePipeline, type MetroCatalogCandidate } from '../agent-service/playbooks/metroCatalog'
import { CANONICAL_NEIGHBORHOODS, NEIGHBORHOOD_ALIASES, MEXICO_NEIGHBORHOODS, SAN_DIEGO_GENERIC_PLACE_WORDS } from './metroCatalogSanDiegoConfig'

function loadEnvFile(relPath: string): void {
  const envPath = require('node:path').join(__dirname, '..', relPath)
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvFile('.env')

const PROJECTS = [
  { projectId: 'san-diego', metroLabel: 'San Diego' },
  { projectId: 'san-diego-tijuana-extension', metroLabel: 'Tijuana (cross-border extension)' },
]

async function loadCandidates(projectId: string): Promise<MetroCatalogCandidate[]> {
  const store = new DbPlaybookRunStore()
  const run = await store.get(playbookRunId('metro_launch', projectId))
  if (!run) throw new Error(`No metro_launch run found for project "${projectId}"`)
  const state = run.state as {
    candidates?: Array<{ name: string; category: string | null; neighborhood: string | null; claimSupported: string; source: string; mergedSourceUrls?: string[]; verificationConfidence?: 'LOW' | 'MEDIUM' | 'HIGH' }>
    checkoffizedItems?: Array<{ name: string; checkoffizedItem: string }>
  }
  const checkoffizedByName = new Map((state.checkoffizedItems ?? []).map((c) => [c.name, c.checkoffizedItem]))
  return (state.candidates ?? []).map((c) => ({
    name: c.name,
    canonicalCategory: classifyCategory(c.category).canonical,
    neighborhood: c.neighborhood,
    checkoffizedItem: checkoffizedByName.get(c.name) ?? '',
    claimSupported: c.claimSupported,
    sourceUrls: c.mergedSourceUrls ?? [c.source].filter(Boolean),
    verificationConfidence: c.verificationConfidence,
  }))
}

async function fetchExistingProductionMapsQueries(): Promise<string[]> {
  const pool = new Pool({ connectionString: process.env.AGENT_SERVICE_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 })
  try {
    const result = await pool.query<{ maps_query: string }>('SELECT maps_query FROM public.items WHERE maps_query IS NOT NULL')
    return result.rows.map((r) => r.maps_query)
  } finally {
    await pool.end()
  }
}

async function main() {
  mkdirSync('scripts/output', { recursive: true })
  const existingProductionMapsQueries = await fetchExistingProductionMapsQueries()
  console.error(`Loaded ${existingProductionMapsQueries.length} existing production items' maps_query values for global dedup check.`)

  const reports = []
  for (const config of PROJECTS) {
    console.error(`\nBuilding dry-run report for ${config.metroLabel}...`)
    const candidates = await loadCandidates(config.projectId)
    const result = runIntakePipeline({
      candidates,
      existingProductionMapsQueries,
      canonicalNeighborhoods: CANONICAL_NEIGHBORHOODS,
      neighborhoodAliases: NEIGHBORHOOD_ALIASES,
      mexicoNeighborhoods: MEXICO_NEIGHBORHOODS,
      additionalGenericWords: SAN_DIEGO_GENERIC_PLACE_WORDS,
    })
    const categoryCounts: Record<string, number> = {}
    for (const r of result.finalRecords) categoryCounts[r.dbCategory] = (categoryCounts[r.dbCategory] ?? 0) + 1
    reports.push({ projectId: config.projectId, metroLabel: config.metroLabel, canonicalCandidateCount: candidates.length, categoryCounts, ...result })
  }

  const outPath = `scripts/output/metro-catalog-dry-run-${new Date().toISOString().slice(0, 10)}.json`
  writeFileSync(outPath, JSON.stringify(reports, null, 2))
  console.error(`\nWrote dry-run report to ${outPath}`)

  for (const r of reports) {
    console.error(`\n=== ${r.metroLabel} (${r.projectId}) ===`)
    console.error(`canonical candidates: ${r.canonicalCandidateCount}`)
    console.error(`final, ready-to-insert records: ${r.finalRecords.length}`)
    console.error(`total excluded: ${r.failures.length}`)
    console.error(`semantic duplicate groups collapsed: ${r.semanticDuplicatesRemoved.length}`)
    console.error(`category counts: ${JSON.stringify(r.categoryCounts)}`)
    for (const g of r.gates) console.error(`  ${g.key}: ${g.verdict} — ${g.reason}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
