#!/usr/bin/env -S npx tsx
// One-off audit helper (read-only) — dumps the raw, pre-intake canonical
// candidates persisted for the san-diego / san-diego-tijuana-extension
// metro_launch runs, for the CheckOffization + attrition audit. Writes
// only to scripts/output/ (gitignored). No public.* access at all.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
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

async function main() {
  mkdirSync('scripts/output', { recursive: true })
  const store = new DbPlaybookRunStore()
  for (const projectId of ['san-diego', 'san-diego-tijuana-extension']) {
    const run = await store.get(playbookRunId('metro_launch', projectId))
    if (!run) { console.error('no run for', projectId); continue }
    const state = run.state as any
    writeFileSync(`scripts/output/raw-candidates-${projectId}.json`, JSON.stringify(state.candidates ?? [], null, 2))
    writeFileSync(`scripts/output/raw-checkoffized-${projectId}.json`, JSON.stringify(state.checkoffizedItems ?? [], null, 2))
    console.error(projectId, 'candidates:', (state.candidates ?? []).length, 'checkoffizedItems:', (state.checkoffizedItems ?? []).length)
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
