#!/usr/bin/env -S npx tsx
// Chief M6.5 — retry pass for OpenAI editorial outputs that came back as
// sentence fragments (no verb) rather than complete imperative CheckOff
// items. Per the "failures retry through the OpenAI editorial path or
// are rejected" rule — this NEVER hand-fixes the wording itself; it asks
// OpenAI again with an explicit correction instruction.
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

// Names identified as genuine sentence fragments (no main verb at all) from
// scripts/output/openai-editorial-run-log.json's first pass — NOT the two
// (Mission San Luis Rey, California Surf Museum) that are grammatically
// complete descriptive sentences, just non-imperative voice, which is fine.
const FRAGMENT_NAMES = [
  'SeaWorld San Diego',
  'San Diego Zoo Safari Park',
  'Fleurette',
  'Harland Clubhouse',
  'The Rady Shell at Jacobs Park',
  'Addison',
  'Cori Pastificio Trattoria',
  'Hot Air Balloon over San Diego Coast',
  'Diversionary Theatre',
  "Tita's Kitchenette",
  'Ambrogio15',
  'Et Voilà! French Bistro',
  'Solare Ristorante',
  "Rich's",
  'Harper’s Topiary Garden',
  'USS Recruit (“Ship Out of Water”)',
  'Chula Vista Elite Athlete Training Center',
  'Hotel del Coronado',
  'Chicano Park Museum & Cultural Center',
  'The Goods',
  'Escape To VR (VR escape rooms & arcade)',
  'Tijuana Cultural Center (CECUT)',
]

interface RetryLogEntry {
  name: string
  previousBody: string
  newBody: string | null
  model: string | null
  status: 'OK' | 'PARSE_FAILED' | 'PROVIDER_ERROR' | 'STILL_FRAGMENT'
  error?: string
}

async function processProject(projectId: string, targetNames: Set<string>, adapter: OpenAiAdapter): Promise<RetryLogEntry[]> {
  const store = new DbPlaybookRunStore()
  const run = await store.get(playbookRunId('metro_launch', projectId))
  if (!run) throw new Error(`No metro_launch run found for project "${projectId}"`)
  const state = run.state as any
  const candidates: Array<{ name: string; neighborhood: string | null; claimSupported: string }> = state.candidates ?? []
  const checkoffizedItems: Array<{ name: string; checkoffizedItem: string }> = state.checkoffizedItems ?? []
  const checkoffizedByNormalizedName = new Map(checkoffizedItems.map((c) => [normalizeWhitespace(c.name), c]))

  const log: RetryLogEntry[] = []
  let changed = false

  for (const c of candidates) {
    const normalized = normalizeWhitespace(c.name.trim())
    if (!targetNames.has(normalized)) continue
    const existing = checkoffizedByNormalizedName.get(normalized)
    const previousBody = existing?.checkoffizedItem ?? ''

    const request: any = {
      specialist: 'checkoff_editor',
      methodologyId: 'checkoff_editor',
      methodologyVersion: 'v1',
      requiredEvidenceKeys: ['factualSource', 'checkoffizedItem', 'fidelityAssessment'],
      inputs: {
        candidateName: c.name,
        factualSource: c.claimSupported,
        neighborhood: c.neighborhood,
        priorAttemptRejected: previousBody,
        rejectionReason:
          'Your previous output was a sentence fragment with no main verb (a noun phrase, not a command). Rewrite it as ONE complete imperative sentence — a command telling the reader exactly what to do — while keeping the same specific fact and never adding anything not in factualSource.',
      },
      objective: `Rewrite the CheckOff item for ${c.name} as a complete imperative sentence`,
    }
    const { systemPrompt, userPrompt } = buildCheckoffEditorPrompt(request)

    try {
      const completion = await adapter.complete({ systemPrompt, userPrompt, requiresLiveWebResearch: false, specialist: 'checkoff_editor', methodologyId: 'checkoff_editor' })
      const parsed = parseModelEnvelope(completion.text)
      if (!parsed.ok || !parsed.envelope) {
        log.push({ name: c.name, previousBody, newBody: null, model: completion.model ?? null, status: 'PARSE_FAILED', error: parsed.reason ?? 'unparseable' })
        continue
      }
      const evidence = parsed.envelope.evidence as { checkoffizedItem?: string }
      const newBody = evidence.checkoffizedItem?.trim()
      if (!newBody) {
        log.push({ name: c.name, previousBody, newBody: null, model: completion.model ?? null, status: 'PARSE_FAILED', error: 'no evidence.checkoffizedItem' })
        continue
      }
      if (existing) existing.checkoffizedItem = newBody
      changed = true
      log.push({ name: c.name, previousBody, newBody, model: completion.model ?? null, status: 'OK' })
      console.error(`[${projectId}] RETRY OK  ${c.name}: "${previousBody}" -> "${newBody}"`)
    } catch (err) {
      log.push({ name: c.name, previousBody, newBody: null, model: null, status: 'PROVIDER_ERROR', error: err instanceof Error ? err.message : String(err) })
      console.error(`[${projectId}] RETRY PROVIDER ERROR  ${c.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (changed) {
    state.checkoffizedItems = checkoffizedItems
    run.updatedAt = new Date().toISOString()
    await store.put(run)
  }

  return log
}

async function main() {
  const adapter = new OpenAiAdapter()
  if (!adapter.isConfigured()) {
    console.error('FATAL: OPENAI_API_KEY not configured — stopping, no fallback author.')
    process.exitCode = 1
    return
  }
  const targetNames = new Set(FRAGMENT_NAMES.map(normalizeWhitespace))
  const allLogs: RetryLogEntry[] = []
  for (const projectId of ['san-diego', 'san-diego-tijuana-extension']) {
    console.error(`\n=== ${projectId} ===`)
    const log = await processProject(projectId, targetNames, adapter)
    allLogs.push(...log)
  }
  const okCount = allLogs.filter((l) => l.status === 'OK').length
  console.error(`\nRetried ${allLogs.length}, OK: ${okCount}, failed: ${allLogs.length - okCount}`)
  writeFileSync('scripts/output/openai-editorial-retry-log.json', JSON.stringify(allLogs, null, 2))
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
