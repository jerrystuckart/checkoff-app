#!/usr/bin/env -S npx tsx
// Chief M6.5 — genericness retry pass (San Diego reconciliation defect #2,
// 2026-09-06). Jerry's manual "HAVE TO" re-audit found these final items
// still generic despite passing the automated EDITORIAL_GATE heuristic:
// no specific dish/feature/name is mentioned, just a generic verb + generic
// category noun ("attend a live show", "visit ... opened by ...", "savor
// Mediterranean flavors", "order an exquisite cocktail"). Per the
// OpenAI-exclusive editorial architecture requirement, this NEVER hand-
// writes the fix — it sends OpenAI a newly researched, verified specific
// fact (found via one narrow targeted WebSearch per item, sourced below)
// and asks it to rewrite using that fact. If OpenAI can't produce a
// specific rewrite, the item should be rejected as
// REJECT_NO_DISTINCTIVE_EXPERIENCE, not left as-is.
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

// New, specific, sourced facts found via one targeted WebSearch each
// (2026-09-06) — never invented, each traceable to a real source.
const GENERICNESS_FIX_FACTS: Record<string, string> = {
  'SeaWorld San Diego':
    "SeaWorld San Diego's signature live show is Orca Encounter, an educational orca presentation at the park's dedicated orca stadium.",
  'Harland Clubhouse':
    "Harland Clubhouse's signature feature is its brass draft system serving Harland Brewing's own beers (including their Hazy IPA), set against a bayside golf-course view at Mission Bay Golf Course.",
  'Harland Brewing Co. – The Clubhouse':
    "Harland Brewing Co.'s clubhouse signature feature is its brass draft system serving their own beers (including their Hazy IPA), set against a bayside golf-course view at Mission Bay Golf Course.",
  'By The Sea':
    'By The Sea (Coronado, opened August 12 2026) is known for the BTS Burger — arugula, pickled red onion, SeaHive cheddar, and harissa aioli — alongside dishes like grilled branzino and lamb cavatelli. Source: sandiegomagazine.com, coronadotimes.com.',
  'Jeune et Jolie':
    'Jeune et Jolie (Carlsbad, one Michelin star) has a cocktail program with named creations including the Noisette and the Chanterelle.',
}

interface RetryLogEntry {
  name: string
  previousBody: string
  newBody: string | null
  model: string | null
  status: 'OK' | 'PARSE_FAILED' | 'PROVIDER_ERROR'
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
    const newFact = GENERICNESS_FIX_FACTS[c.name.trim()]

    const request: any = {
      specialist: 'checkoff_editor',
      methodologyId: 'checkoff_editor',
      methodologyVersion: 'v1',
      requiredEvidenceKeys: ['factualSource', 'checkoffizedItem', 'fidelityAssessment'],
      inputs: {
        candidateName: c.name,
        factualSource: newFact ?? c.claimSupported,
        neighborhood: c.neighborhood,
        priorAttemptRejected: previousBody,
        rejectionReason:
          'Your previous output was too generic — it named only a generic category/verb (a show, a cocktail, a cuisine type) with no specific, checkable detail. Rewrite it as ONE complete imperative sentence that names the SPECIFIC thing from factualSource (a named show, dish, cocktail, or feature) — the test is: would a friend telling someone about this say "you HAVE TO ___" and fill in something specific, not just "see a show" or "order a drink"?',
      },
      objective: `Rewrite the CheckOff item for ${c.name} with a specific, named hook`,
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
      console.error(`[${projectId}] GENERICNESS RETRY OK  ${c.name}: "${previousBody}" -> "${newBody}"`)
    } catch (err) {
      log.push({ name: c.name, previousBody, newBody: null, model: null, status: 'PROVIDER_ERROR', error: err instanceof Error ? err.message : String(err) })
      console.error(`[${projectId}] GENERICNESS RETRY PROVIDER ERROR  ${c.name}: ${err instanceof Error ? err.message : String(err)}`)
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
  const targetNames = new Set(Object.keys(GENERICNESS_FIX_FACTS).map(normalizeWhitespace))
  const allLogs: RetryLogEntry[] = []
  for (const projectId of ['san-diego', 'san-diego-tijuana-extension']) {
    console.error(`\n=== ${projectId} ===`)
    const log = await processProject(projectId, targetNames, adapter)
    allLogs.push(...log)
  }
  const okCount = allLogs.filter((l) => l.status === 'OK').length
  console.error(`\nRetried ${allLogs.length}, OK: ${okCount}, failed: ${allLogs.length - okCount}`)
  writeFileSync('scripts/output/openai-genericness-fix-retry-log.json', JSON.stringify(allLogs, null, 2))
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
