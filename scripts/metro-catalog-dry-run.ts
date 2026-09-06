#!/usr/bin/env -S npx tsx
// scripts/metro-catalog-dry-run.ts
//
// Chief M7-M9 — Metro Catalog Construction dry run. Reusable across
// metros: reads a metro_launch run's persisted canonical candidates,
// maps them to real item-intake records (agent-service/playbooks/
// metroCatalog.ts), checks for duplicates against the REAL production
// `items` table (agent_service has read-only access to it), evaluates
// the real CATALOG/LOCATION/PRESENTATION/OUTREACH gates, and generates
// a reviewed SQL file for a human with elevated (service_role) database
// access to run — the same role every prior metro (Denver, Tucson,
// Phoenix, Milwaukee) was actually loaded by, per
// docs/metro-launch-audit/patches/denver_catalog_insert_CORRECTED.sql.
//
// THIS SCRIPT NEVER WRITES TO ANY public.* TABLE — agent_service has no
// INSERT/UPDATE/DELETE grant on public schema at all (confirmed via
// information_schema.role_table_grants), so it structurally could not
// even if it tried. It writes ONLY to local review files under
// scripts/output/.
//
// Usage: npx tsx scripts/metro-catalog-dry-run.ts

import { writeFileSync, mkdirSync } from 'node:fs'
import { Pool } from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { DbPlaybookRunStore } from '../agent-service/specialists/dbPlaybookRunStore'
import { playbookRunId } from '../agent-service/specialists/playbookRun'
import { classifyCategory } from '../agent-service/playbooks/categoryNormalization'
import {
  mapCandidatesToIntakeRecords,
  checkForDuplicates,
  evaluateCatalogGate,
  evaluateLocationGate,
  evaluatePresentationGate,
  evaluateOutreachGate,
  type MetroCatalogCandidate,
  type ItemIntakeRecord,
} from '../agent-service/playbooks/metroCatalog'

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

interface ProjectConfig {
  projectId: string
  metroLabel: string
  /** Real production `categories.name` this project's items should use — resolved from state.candidates' raw category via categoryNormalization. */
}

const PROJECTS: ProjectConfig[] = [
  { projectId: 'san-diego', metroLabel: 'San Diego' },
  { projectId: 'san-diego-tijuana-extension', metroLabel: 'Tijuana (cross-border extension)' },
]

async function loadCandidates(projectId: string): Promise<{ candidates: MetroCatalogCandidate[]; neighborhoods: Array<{ name: string; kind: string }> }> {
  const store = new DbPlaybookRunStore()
  const run = await store.get(playbookRunId('metro_launch', projectId))
  if (!run) throw new Error(`No metro_launch run found for project "${projectId}"`)
  const state = run.state as {
    candidates?: Array<{ name: string; category: string | null; neighborhood: string | null; claimSupported: string; source: string; mergedSourceUrls?: string[]; verificationConfidence?: 'LOW' | 'MEDIUM' | 'HIGH' }>
    checkoffizedItems?: Array<{ name: string; checkoffizedItem: string }>
    neighborhoods?: Array<{ name: string; kind: string }>
  }
  const checkoffizedByName = new Map((state.checkoffizedItems ?? []).map((c) => [c.name, c.checkoffizedItem]))
  const candidates: MetroCatalogCandidate[] = (state.candidates ?? []).map((c) => ({
    name: c.name,
    canonicalCategory: classifyCategory(c.category).canonical,
    neighborhood: c.neighborhood,
    checkoffizedItem: checkoffizedByName.get(c.name) ?? '',
    claimSupported: c.claimSupported,
    sourceUrls: c.mergedSourceUrls ?? [c.source].filter(Boolean),
    verificationConfidence: c.verificationConfidence,
  }))
  return { candidates, neighborhoods: state.neighborhoods ?? [] }
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

interface ProjectReport {
  projectId: string
  metroLabel: string
  canonicalCandidateCount: number
  intakeFailures: Array<{ candidateName: string; reason: string }>
  categoryCounts: Record<string, number>
  duplicates: ReturnType<typeof checkForDuplicates>
  cleanRecords: ItemIntakeRecord[]
  gates: ReturnType<typeof evaluateCatalogGate>[]
  neighborhoods: Array<{ name: string; kind: string }>
}

async function buildReportFor(config: ProjectConfig, existingProductionMapsQueries: string[]): Promise<ProjectReport> {
  const { candidates, neighborhoods } = await loadCandidates(config.projectId)
  const { records, failures } = mapCandidatesToIntakeRecords(candidates)
  const duplicates = checkForDuplicates(records, existingProductionMapsQueries)

  const categoryCounts: Record<string, number> = {}
  for (const r of duplicates.clean) categoryCounts[r.dbCategory] = (categoryCounts[r.dbCategory] ?? 0) + 1

  const catalogGate = evaluateCatalogGate({ expectedCanonicalCount: candidates.length, stagedRecords: records, intakeFailures: failures, duplicates })
  const locationGate = evaluateLocationGate({ records: duplicates.clean })
  const presentationGate = evaluatePresentationGate({ records: duplicates.clean })
  const outreachGate = evaluateOutreachGate({ records: duplicates.clean })

  return {
    projectId: config.projectId,
    metroLabel: config.metroLabel,
    canonicalCandidateCount: candidates.length,
    intakeFailures: failures,
    categoryCounts,
    duplicates,
    cleanRecords: duplicates.clean,
    gates: [catalogGate, locationGate, presentationGate, outreachGate],
    neighborhoods,
  }
}

async function main() {
  mkdirSync('scripts/output', { recursive: true })
  const existingProductionMapsQueries = await fetchExistingProductionMapsQueries()
  console.error(`Loaded ${existingProductionMapsQueries.length} existing production items' maps_query values for global dedup check.`)

  const reports: ProjectReport[] = []
  for (const config of PROJECTS) {
    console.error(`\nBuilding dry-run report for ${config.metroLabel}...`)
    reports.push(await buildReportFor(config, existingProductionMapsQueries))
  }

  const outPath = `scripts/output/metro-catalog-dry-run-${new Date().toISOString().slice(0, 10)}.json`
  writeFileSync(outPath, JSON.stringify(reports, null, 2))
  console.error(`\nWrote dry-run report to ${outPath}`)

  for (const r of reports) {
    console.error(`\n=== ${r.metroLabel} (${r.projectId}) ===`)
    console.error(`canonical candidates: ${r.canonicalCandidateCount}`)
    console.error(`intake failures: ${r.intakeFailures.length}`)
    console.error(`clean, ready-to-insert records: ${r.cleanRecords.length}`)
    console.error(`duplicates vs. production: ${r.duplicates.collidesWithProduction.length}`)
    console.error(`duplicates within batch: ${r.duplicates.collidesWithinBatch.length}`)
    console.error(`category counts: ${JSON.stringify(r.categoryCounts)}`)
    for (const g of r.gates) console.error(`  ${g.key}: ${g.verdict} — ${g.reason}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
