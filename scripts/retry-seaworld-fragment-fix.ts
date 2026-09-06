#!/usr/bin/env -S npx tsx
// One-off follow-up to retry-openai-genericness-fix.ts: that pass's SECOND
// run (needed to also fix the "Harland Brewing Co. – The Clubhouse" dup
// survivor) regenerated SeaWorld San Diego's text and this time OpenAI
// returned a sentence fragment ("Orca Encounter live show at SeaWorld San
// Diego's orca stadium." — no main verb) instead of a complete imperative
// sentence. Retrying once more with an explicit fragment-correction
// instruction, same pattern as retry-openai-fragment-items.ts.
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

async function main() {
  const adapter = new OpenAiAdapter()
  if (!adapter.isConfigured()) {
    console.error('FATAL: OPENAI_API_KEY not configured — stopping, no fallback author.')
    process.exitCode = 1
    return
  }
  const store = new DbPlaybookRunStore()
  const run = await store.get(playbookRunId('metro_launch', 'san-diego'))
  if (!run) throw new Error('No metro_launch run found for san-diego')
  const state = run.state as any
  const item = (state.checkoffizedItems as Array<{ name: string; checkoffizedItem: string }>).find((c) => c.name.trim() === 'SeaWorld San Diego')
  if (!item) throw new Error('SeaWorld San Diego not found in checkoffizedItems')

  const request: any = {
    specialist: 'checkoff_editor',
    methodologyId: 'checkoff_editor',
    methodologyVersion: 'v1',
    requiredEvidenceKeys: ['factualSource', 'checkoffizedItem', 'fidelityAssessment'],
    inputs: {
      candidateName: 'SeaWorld San Diego',
      factualSource: "SeaWorld San Diego's signature live show is Orca Encounter, an educational orca presentation at the park's dedicated orca stadium.",
      neighborhood: 'Mission Bay',
      priorAttemptRejected: item.checkoffizedItem,
      rejectionReason:
        'Your previous output was a sentence fragment with no main verb (a noun phrase, not a command). Rewrite it as ONE complete imperative sentence — a command telling the reader exactly what to do — while keeping the specific named show (Orca Encounter) and never adding anything not in factualSource.',
    },
    objective: 'Rewrite the CheckOff item for SeaWorld San Diego as a complete imperative sentence',
  }
  const { systemPrompt, userPrompt } = buildCheckoffEditorPrompt(request)
  const completion = await adapter.complete({ systemPrompt, userPrompt, requiresLiveWebResearch: false, specialist: 'checkoff_editor', methodologyId: 'checkoff_editor' })
  const parsed = parseModelEnvelope(completion.text)
  if (!parsed.ok || !parsed.envelope) throw new Error(`Parse failed: ${parsed.reason ?? 'unparseable'}`)
  const evidence = parsed.envelope.evidence as { checkoffizedItem?: string }
  const newBody = evidence.checkoffizedItem?.trim()
  if (!newBody) throw new Error('No evidence.checkoffizedItem in response')

  console.error(`"${item.checkoffizedItem}" -> "${newBody}"`)
  item.checkoffizedItem = newBody
  run.updatedAt = new Date().toISOString()
  await store.put(run)
  console.error('Saved.')

  const logPath = 'scripts/output/openai-genericness-fix-retry-log.json'
  const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : []
  log.push({ name: 'SeaWorld San Diego', previousBody: item.checkoffizedItem, newBody, model: completion.model ?? null, status: 'OK', note: 'fragment-correction follow-up retry' })
  writeFileSync(logPath, JSON.stringify(log, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
