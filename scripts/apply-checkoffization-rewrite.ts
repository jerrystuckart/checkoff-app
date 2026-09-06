#!/usr/bin/env -S npx tsx
// Chief M6.5 CheckOff Editor re-run (San Diego CheckOffization quality
// regression, 2026-09) — applies the manually-authored specificity
// rewrite pass (scripts/output/rewrite-mapping.json) to the persisted
// san-diego / san-diego-tijuana-extension candidate state.
//
// Every rewrite uses ONLY facts already present in the original research
// claim or verified via the approved targeted specificity-research pass
// (real web searches, one per item, for a single concrete "what to do/
// order/find" fact — never a broad new discovery round). Items whose
// underlying research claim contains no genuinely distinctive fact even
// after that targeted pass are NOT rewritten — they are marked
// NEEDS_SPECIFICITY_RESEARCH and excluded from this batch's candidate
// set entirely, per Jerry's explicit rule: never force a weak-source item
// through EDITORIAL_GATE by cleaning up its prose alone.
//
// This writes to agent.tasks (internal Chief run state), NOT to any
// public.* table — no production write, no geocoding, no activation.
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { DbPlaybookRunStore } from '../agent-service/specialists/dbPlaybookRunStore'
import { playbookRunId } from '../agent-service/specialists/playbookRun'

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

interface RewriteMapping {
  rewrites: Record<string, string>
  needsSpecificityResearch: string[]
}

// Bug fix (same class as the NBSP neighborhood-matching bug fixed earlier
// in metroCatalog.ts): "Realm of the 52 Remedies" also has a real
// non-breaking space (U+00A0) in its actual persisted name, which a
// plain-string mapping key never matches. Normalize whitespace on both
// sides before matching, everywhere this script looks up a name.
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

async function processProject(projectId: string, mapping: RewriteMapping): Promise<{ rewritten: string[]; excluded: string[]; unaccounted: string[] }> {
  const store = new DbPlaybookRunStore()
  const run = await store.get(playbookRunId('metro_launch', projectId))
  if (!run) throw new Error(`No metro_launch run found for project "${projectId}"`)
  const state = run.state as any
  const candidates: Array<{ name: string }> = state.candidates ?? []
  const checkoffizedItems: Array<{ name: string; checkoffizedItem: string }> = state.checkoffizedItems ?? []
  const checkoffizedByNormalizedName = new Map(checkoffizedItems.map((c) => [normalizeWhitespace(c.name), c]))
  const rewritesByNormalizedName = new Map(Object.entries(mapping.rewrites).map(([k, v]) => [normalizeWhitespace(k), v]))
  const needsResearchNormalized = new Set(mapping.needsSpecificityResearch.map(normalizeWhitespace))

  const rewritten: string[] = []
  const excluded: string[] = []
  const unaccounted: string[] = []

  for (const c of candidates) {
    const name = c.name.trim()
    const normalized = normalizeWhitespace(name)
    if (rewritesByNormalizedName.has(normalized)) {
      const newBody = rewritesByNormalizedName.get(normalized)!
      const existing = checkoffizedByNormalizedName.get(normalized)
      if (existing) {
        existing.checkoffizedItem = newBody
      } else {
        checkoffizedItems.push({ name, checkoffizedItem: newBody })
      }
      rewritten.push(name)
    } else if (needsResearchNormalized.has(normalized)) {
      // Excluded from this batch entirely — blank out checkoffizedItem so
      // mapCandidateToIntakeRecord's own "no checkoffized item text" check
      // fails it deterministically (never silently reuses old generic text).
      const existing = checkoffizedByNormalizedName.get(normalized)
      if (existing) existing.checkoffizedItem = ''
      excluded.push(name)
    } else {
      unaccounted.push(name)
    }
  }

  state.checkoffizedItems = checkoffizedItems
  // Bug fix: the run's real idempotency/dedup key (dbPlaybookRunStore.ts's
  // snapshotKeySuffix) is built from the RunRecord's own top-level
  // updatedAt field, not anything inside the opaque `state` blob — a
  // first version of this script bumped state.updatedAt (meaningless to
  // the store) and the write was silently deduped as a no-op replay,
  // exactly the class of bug already fixed once before in cli.ts for M0
  // seeding. Must bump the real field.
  run.updatedAt = new Date().toISOString()
  await store.put(run)

  return { rewritten, excluded, unaccounted }
}

async function main() {
  const mapping: RewriteMapping = JSON.parse(readFileSync('scripts/output/rewrite-mapping.json', 'utf8'))

  for (const projectId of ['san-diego', 'san-diego-tijuana-extension']) {
    console.error(`\n=== ${projectId} ===`)
    const { rewritten, excluded, unaccounted } = await processProject(projectId, mapping)
    console.error(`Rewritten: ${rewritten.length}`)
    console.error(`Excluded (NEEDS_SPECIFICITY_RESEARCH): ${excluded.length}`)
    if (unaccounted.length > 0) {
      console.error(`WARNING: ${unaccounted.length} candidate(s) in this project's persisted state were not in the rewrite mapping at all:`)
      for (const n of unaccounted) console.error(`  - ${n}`)
    }
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
