#!/usr/bin/env -S npx tsx
// Chief M6.5 — final-target duplicate collapse (San Diego reconciliation
// defect #3, 2026-09-06). Jerry's manual review of the exact FINAL rows
// (not upstream candidates) found three pairs describing the same
// real-world checkoffable experience under two different candidate names:
//
//   - "Petco Park (Padres Baseball)" vs "San Diego Padres" — both are
//     "watch a Padres game at Petco Park". Kept the Petco Park version
//     (names both the specific venue AND the team).
//   - "La Jolla Sea Cave Kayaking Tours" vs "Kayaking La Jolla Sea Caves" —
//     both describe kayaking the same sea caves. Kept the "...Tours"
//     version (reads as a specific bookable operator name; the other is a
//     generic activity phrase, not a distinct business).
//   - "Balboa Park Cultural Institutions" vs "Balboa Park (multiple
//     museums & cultural institutions)" — the first ("Visit one of the 18
//     museums in Balboa Park") is also independently generic (fails the
//     "HAVE TO ___" test — no museum is named), so it loses on BOTH
//     genericness and duplication grounds. Kept the version that names
//     specific institutions (The Old Globe, Centro Cultural de la Raza,
//     Museum of Us).
//
// findSemanticDuplicates() (candidate-NAME based) cannot catch any of
// these — stadium name vs. team name, and two differently-worded activity
// names share no significant name tokens. This exclusion is a deliberate,
// human-reviewed decision recorded here (not an automated body-text
// similarity heuristic, which was tried and produced false positives
// against genuinely distinct venues — e.g. two different restaurants both
// serving "dry-aged" steak — and is documented as rejected in the
// reconciliation report).
//
// Mechanism: setting checkoffizedItem to '' makes
// mapCandidateToIntakeRecord() exclude the candidate from the pipeline
// entirely (see agent-service/playbooks/metroCatalog.ts:155) — the same
// mechanism already used to exclude "By The Sea (new restaurant)".
import { readFileSync, existsSync } from 'node:fs'
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

const EXCLUDED_AS_DUPLICATE_OR_GENERIC = [
  { name: 'San Diego Padres', reason: 'Duplicate of "Petco Park (Padres Baseball)" — same real experience (watch a Padres game at Petco Park); Petco Park version kept as more specific.' },
  { name: 'Kayaking La Jolla Sea Caves', reason: 'Duplicate of "La Jolla Sea Cave Kayaking Tours" — same real experience (kayak the La Jolla sea caves); the "...Tours" version kept as the specific operator name.' },
  { name: 'Balboa Park Cultural Institutions', reason: 'Generic ("visit one of the 18 museums", no museum named) AND duplicate of "Balboa Park (multiple museums & cultural institutions)", which names specific institutions — that version kept.' },
]

async function main() {
  const targetNames = new Set(EXCLUDED_AS_DUPLICATE_OR_GENERIC.map((x) => x.name))
  for (const projectId of ['san-diego', 'san-diego-tijuana-extension']) {
    const store = new DbPlaybookRunStore()
    const run = await store.get(playbookRunId('metro_launch', projectId))
    if (!run) continue
    const state = run.state as any
    const checkoffizedItems: Array<{ name: string; checkoffizedItem: string }> = state.checkoffizedItems ?? []
    let changed = false
    for (const entry of checkoffizedItems) {
      if (targetNames.has(entry.name.trim()) && entry.checkoffizedItem !== '') {
        console.error(`[${projectId}] Excluding "${entry.name}" (was: "${entry.checkoffizedItem}")`)
        entry.checkoffizedItem = ''
        changed = true
      }
    }
    if (changed) {
      state.checkoffizedItems = checkoffizedItems
      run.updatedAt = new Date().toISOString()
      await store.put(run)
      console.error(`[${projectId}] Saved.`)
    } else {
      console.error(`[${projectId}] No matching candidates found (already excluded or not present in this project).`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
