#!/usr/bin/env -S npx tsx
// Chief M6.5 — the REAL OpenAI/ChatGPT CheckOff Editor pass (San Diego
// launch, 2026-09). Architecture requirement: Claude Code must never be
// the author of final CheckOff item wording — that belongs to Winston's
// OpenAI editorial provider (agent-service/specialists/openAiAdapter.ts,
// routed exclusively for checkoff_editor via
// SPECIALIST_EXCLUSIVE_PROVIDER in remoteAiExecutor.ts).
//
// For every candidate that already has a verified, specific fact
// (deterministic research logic — the raw claim, plus any fact found in
// a targeted specificity-research pass, both already gathered and
// reviewed by Jerry/Claude, never invented here), this script sends that
// fact to the real, live OpenAI Responses API and asks it to write the
// final checkoffizedItem sentence. It does NOT write the wording itself.
//
// If OpenAI is not configured, or every call fails, this script exits
// non-zero and writes nothing — it does not substitute Claude-authored
// prose as a fallback.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { OpenAiAdapter } from '../agent-service/specialists/openAiAdapter'
import { buildCheckoffEditorPrompt } from '../agent-service/specialists/promptBuilders'
import { parseModelEnvelope } from '../agent-service/specialists/remoteAiExecutor'
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

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

interface RewriteMapping {
  rewrites: Record<string, string>
  needsSpecificityResearch: string[]
}

interface RunLogEntry {
  name: string
  neighborhood: string | null
  factualSource: string
  model: string | null
  provider: 'openai'
  checkoffizedItem: string | null
  fidelityAssessment: string | null
  status: 'OK' | 'PARSE_FAILED' | 'PROVIDER_ERROR'
  error?: string
}

async function processProject(
  projectId: string,
  mapping: RewriteMapping,
  supplements: Record<string, string>,
  adapter: OpenAiAdapter
): Promise<RunLogEntry[]> {
  const store = new DbPlaybookRunStore()
  const run = await store.get(playbookRunId('metro_launch', projectId))
  if (!run) throw new Error(`No metro_launch run found for project "${projectId}"`)
  const state = run.state as any
  const candidates: Array<{ name: string; neighborhood: string | null; claimSupported: string }> = state.candidates ?? []
  const checkoffizedItems: Array<{ name: string; checkoffizedItem: string }> = state.checkoffizedItems ?? []
  const checkoffizedByNormalizedName = new Map(checkoffizedItems.map((c) => [normalizeWhitespace(c.name), c]))
  const rewriteNames = new Set(Object.keys(mapping.rewrites).map(normalizeWhitespace))

  const log: RunLogEntry[] = []

  for (const c of candidates) {
    const normalized = normalizeWhitespace(c.name.trim())
    if (!rewriteNames.has(normalized)) continue // not a candidate this pass is writing wording for

    const supplement = supplements[c.name.trim()]
    const factualSource = supplement ? `${c.claimSupported} ${supplement}` : c.claimSupported

    const request: any = {
      specialist: 'checkoff_editor',
      methodologyId: 'checkoff_editor',
      methodologyVersion: 'v1',
      requiredEvidenceKeys: ['factualSource', 'checkoffizedItem', 'fidelityAssessment'],
      inputs: { candidateName: c.name, factualSource, neighborhood: c.neighborhood },
      objective: `CheckOffize ${c.name}`,
    }
    const { systemPrompt, userPrompt } = buildCheckoffEditorPrompt(request)

    try {
      const completion = await adapter.complete({ systemPrompt, userPrompt, requiresLiveWebResearch: false, specialist: 'checkoff_editor', methodologyId: 'checkoff_editor' })
      const parsed = parseModelEnvelope(completion.text)
      if (!parsed.ok || !parsed.envelope) {
        log.push({ name: c.name, neighborhood: c.neighborhood, factualSource, model: completion.model ?? null, provider: 'openai', checkoffizedItem: null, fidelityAssessment: null, status: 'PARSE_FAILED', error: parsed.reason ?? 'unparseable' })
        continue
      }
      const evidence = parsed.envelope.evidence as { checkoffizedItem?: string; fidelityAssessment?: string }
      const checkoffizedItem = evidence.checkoffizedItem?.trim()
      if (!checkoffizedItem) {
        log.push({ name: c.name, neighborhood: c.neighborhood, factualSource, model: completion.model ?? null, provider: 'openai', checkoffizedItem: null, fidelityAssessment: null, status: 'PARSE_FAILED', error: 'envelope had no evidence.checkoffizedItem' })
        continue
      }

      const existing = checkoffizedByNormalizedName.get(normalized)
      if (existing) {
        existing.checkoffizedItem = checkoffizedItem
      } else {
        checkoffizedItems.push({ name: c.name, checkoffizedItem })
      }
      log.push({
        name: c.name,
        neighborhood: c.neighborhood,
        factualSource,
        model: completion.model ?? null,
        provider: 'openai',
        checkoffizedItem,
        fidelityAssessment: evidence.fidelityAssessment ?? null,
        status: 'OK',
      })
      console.error(`[${projectId}] OK  ${c.name} -> "${checkoffizedItem}" (${completion.model})`)
    } catch (err) {
      log.push({ name: c.name, neighborhood: c.neighborhood, factualSource, model: null, provider: 'openai', checkoffizedItem: null, fidelityAssessment: null, status: 'PROVIDER_ERROR', error: err instanceof Error ? err.message : String(err) })
      console.error(`[${projectId}] PROVIDER ERROR  ${c.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  state.checkoffizedItems = checkoffizedItems
  run.updatedAt = new Date().toISOString()
  await store.put(run)

  return log
}

async function main() {
  const adapter = new OpenAiAdapter()
  if (!adapter.isConfigured()) {
    console.error('FATAL: OPENAI_API_KEY not configured. Per the OpenAI-exclusive editorial architecture requirement, this script refuses to substitute any other author for final CheckOff wording. Stopping — no writes made.')
    process.exitCode = 1
    return
  }

  const mapping: RewriteMapping = JSON.parse(readFileSync('scripts/output/rewrite-mapping.json', 'utf8'))
  const supplements: Record<string, string> = JSON.parse(readFileSync('scripts/output/factual-supplements.json', 'utf8'))

  const allLogs: RunLogEntry[] = []
  for (const projectId of ['san-diego', 'san-diego-tijuana-extension']) {
    console.error(`\n=== ${projectId} ===`)
    const log = await processProject(projectId, mapping, supplements, adapter)
    allLogs.push(...log)
  }

  const okCount = allLogs.filter((l) => l.status === 'OK').length
  const failCount = allLogs.length - okCount
  console.error(`\nTotal: ${allLogs.length}, OK: ${okCount}, failed: ${failCount}`)
  if (failCount > 0) {
    console.error('Failures (left with their prior wording — NOT overwritten with a fabricated result):')
    for (const l of allLogs.filter((l) => l.status !== 'OK')) console.error(`  - ${l.name}: ${l.status} — ${l.error}`)
  }

  writeFileSync('scripts/output/openai-editorial-run-log.json', JSON.stringify(allLogs, null, 2))
  console.error('\nWrote scripts/output/openai-editorial-run-log.json')
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
