#!/usr/bin/env node
// Chief operator CLI (Phase 2D spec section 30, DB-backed by default as
// of Phase 2E). A thin wrapper around the executor runtime so Jerry (or
// anyone) can inspect and drive executions without editing DB rows by
// hand. This is the MANUAL_EXECUTOR bridge's human interface — not the
// desired end state (Chief invoking specialists autonomously is), but a
// first-class fallback that works today.
//
// Usage:
//   tsx agent-service/cli.ts delegate <request.json>
//   tsx agent-service/cli.ts execution show <executionId>
//   tsx agent-service/cli.ts execution list
//   tsx agent-service/cli.ts execution submit-result <executionId> <result.json>
//   tsx agent-service/cli.ts execution retry <executionId>
//
// Phase 2F — the HIGH-LEVEL commands (spec section 4). Jerry does not
// manage individual execution ids for normal operation; these drive a
// whole playbook run to completion/NEEDS_JERRY/BLOCKED in one command:
//   tsx agent-service/cli.ts run metro_launch <projectKey> [--category-plan file.json] [--m0 decisions.json]
//   tsx agent-service/cli.ts run destination_hub_lifecycle <projectKey> --candidate candidate.json
//   tsx agent-service/cli.ts status <playbookKey> <projectKey>
//   tsx agent-service/cli.ts pause <playbookKey> <projectKey>
//   tsx agent-service/cli.ts resume <playbookKey> <projectKey>
//   tsx agent-service/cli.ts decide <playbookKey> <projectKey> <decision.json>   (records a pending Jerry decision and resumes)
//
// STORE SELECTION (Phase 2E): by default this uses the real, durable
// DbExecutionStore (agent.tasks/agent.task_events — see
// dbExecutionStore.ts), which requires AGENT_SERVICE_DATABASE_URL to be
// set (same variable db.ts already uses — no new config surface). Pass
// --file to use the local, non-durable FileExecutionStore instead
// (.chief-executions.json in the cwd, gitignored) — useful for
// dry-running the CLI without a database, but this is explicitly NOT
// production execution state; it never survives being deleted and is
// invisible to any other process.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ExecutionRecord, ExecutionStore, SpecialistExecutionRequest } from './specialists/executor'
import { registerExecution, acceptExecutionResult, retryExecution } from './specialists/executor'
import { buildManualAssignmentPackage } from './specialists/manualExecutor'
import { DbExecutionStore } from './specialists/dbExecutionStore'
import type { SpecialistResultEnvelope } from './specialists/types'
import type { PlaybookRunStore, PlaybookRunRecord } from './specialists/playbookRun'
import { playbookRunId, pauseRun, resumeRun, recordJerryDecision, getOrCreateRun } from './specialists/playbookRun'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { driveMetroLaunch, type MetroM0Decisions } from './specialists/metroLaunchDriver'
import { driveDestinationHub } from './specialists/destinationHubDriver'
import { RemoteAiExecutor } from './specialists/remoteAiExecutor'
import { AnthropicMessagesAdapter } from './specialists/remoteAiExecutor'
import { OpenAiAdapter } from './specialists/openAiAdapter'
import { SAN_DIEGO_CATEGORY_PLAN, SAN_DIEGO_GEOGRAPHIC_DEPTH_TARGETS } from './playbooks/sanDiegoManifest'
import type { CategoryCoveragePlan, GeographicDepthTarget } from './playbooks/metroLaunch'
import type { DiscoveryCandidate } from './playbooks/destinationHubLifecycle'

const STORE_PATH = resolve(process.cwd(), '.chief-executions.json')

class FileExecutionStore implements ExecutionStore {
  private records: ExecutionRecord[]

  constructor() {
    this.records = existsSync(STORE_PATH) ? JSON.parse(readFileSync(STORE_PATH, 'utf8')) : []
  }

  async get(executionId: string): Promise<ExecutionRecord | undefined> {
    return this.records.find((r) => r.request.executionId === executionId)
  }

  async put(record: ExecutionRecord): Promise<void> {
    const i = this.records.findIndex((r) => r.request.executionId === record.request.executionId)
    if (i >= 0) this.records[i] = record
    else this.records.push(record)
    this.save()
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<ExecutionRecord | undefined> {
    return this.records.find((r) => r.request.idempotencyKey === idempotencyKey)
  }

  async all(): Promise<ExecutionRecord[]> {
    return this.records
  }

  private save(): void {
    writeFileSync(STORE_PATH, JSON.stringify(this.records, null, 2))
  }
}

const RUN_STORE_PATH = resolve(process.cwd(), '.chief-playbook-runs.json')

class FilePlaybookRunStore implements PlaybookRunStore {
  private records: PlaybookRunRecord[]
  constructor() {
    this.records = existsSync(RUN_STORE_PATH) ? JSON.parse(readFileSync(RUN_STORE_PATH, 'utf8')) : []
  }
  async get(runId: string): Promise<PlaybookRunRecord | undefined> {
    return this.records.find((r) => r.runId === runId)
  }
  async put(record: PlaybookRunRecord): Promise<void> {
    const i = this.records.findIndex((r) => r.runId === record.runId)
    if (i >= 0) this.records[i] = record
    else this.records.push(record)
    writeFileSync(RUN_STORE_PATH, JSON.stringify(this.records, null, 2))
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T
}

/**
 * Every configured, capability-qualified provider — credential names are
 * documented, never pasted into chat (spec section 12): set
 * ANTHROPIC_API_KEY and/or OPENAI_API_KEY as environment variables. An
 * unconfigured provider is simply absent from this list — it never makes
 * the WHOLE specialist unavailable if another qualified one exists (spec
 * section 11).
 */
function buildDefaultExecutors() {
  return [new RemoteAiExecutor([new AnthropicMessagesAdapter(), new OpenAiAdapter()])]
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const useFile = rawArgs.includes('--file')
  const args = rawArgs.filter((a) => a !== '--file')
  const [command, ...rest0] = args
  const store: ExecutionStore = useFile ? new FileExecutionStore() : new DbExecutionStore()
  const runStore: PlaybookRunStore = useFile ? new FilePlaybookRunStore() : new DbPlaybookRunStore()

  if (command === 'run') {
    const [playbookKey, projectId, ...flags] = rest0
    const executors = buildDefaultExecutors()
    if (playbookKey === 'metro_launch') {
      const planFlagIdx = flags.indexOf('--category-plan')
      const categoryPlan: CategoryCoveragePlan = planFlagIdx >= 0 ? readJson(flags[planFlagIdx + 1]) : SAN_DIEGO_CATEGORY_PLAN
      const geoDepthFlagIdx = flags.indexOf('--geo-depth-plan')
      const depthTargets: GeographicDepthTarget[] = geoDepthFlagIdx >= 0 ? readJson(flags[geoDepthFlagIdx + 1]) : SAN_DIEGO_GEOGRAPHIC_DEPTH_TARGETS
      const m0FlagIdx = flags.indexOf('--m0')
      if (m0FlagIdx >= 0) {
        const m0: MetroM0Decisions = readJson(flags[m0FlagIdx + 1])
        const runId = playbookRunId(playbookKey, projectId)
        const existing = await runStore.get(runId)
        if (existing && existing.status === 'NEEDS_JERRY') {
          await recordJerryDecision(runStore, runId, { m0Decisions: m0 })
        } else if (!existing) {
          // Seed the M0 decisions before the run's very first step —
          // getOrCreateRun (also called inside driveMetroLaunch) is idempotent.
          const seeded = await getOrCreateRun(runStore, playbookKey, projectId, 'M0_METRO_DEFINITION')
          seeded.state = { ...seeded.state, m0Decisions: m0 }
          // DbPlaybookRunStore's recordPlaybookStage is idempotency-keyed on
          // (status, currentStage, loopIteration, totalRetries, updatedAt) —
          // getOrCreateRun's own put() and this one would otherwise share
          // the exact same updatedAt (and thus idempotency key), so this
          // second put (the one actually carrying m0Decisions) would be
          // silently deduped as a no-op replay of the first, empty-state
          // snapshot. Bumping updatedAt makes it a distinct snapshot.
          seeded.updatedAt = new Date().toISOString()
          await runStore.put(seeded)
        }
      }
      const run = await driveMetroLaunch({ runStore, execStore: store, executors }, projectId, { categoryPlan, depthTargets })
      console.log(JSON.stringify(run, null, 2))
      return
    }
    if (playbookKey === 'destination_hub_lifecycle') {
      const candidateFlagIdx = flags.indexOf('--candidate')
      if (candidateFlagIdx < 0) {
        console.error('destination_hub_lifecycle requires --candidate <candidate.json>')
        process.exitCode = 1
        return
      }
      const candidate: DiscoveryCandidate & { destinationId: string; destinationName: string } = readJson(flags[candidateFlagIdx + 1])
      const run = await driveDestinationHub({ runStore, execStore: store, executors }, projectId, { candidate })
      console.log(JSON.stringify(run, null, 2))
      return
    }
    console.error(`Unknown playbook "${playbookKey}" — expected metro_launch or destination_hub_lifecycle.`)
    process.exitCode = 1
    return
  }

  if (command === 'status') {
    const [playbookKey, projectId] = rest0
    const run = await runStore.get(playbookRunId(playbookKey, projectId))
    if (!run) {
      console.error(`No playbook run for ${playbookKey}:${projectId} — has it been started with "run" yet?`)
      process.exitCode = 1
      return
    }
    console.log(JSON.stringify(run, null, 2))
    return
  }

  if (command === 'pause') {
    const [playbookKey, projectId] = rest0
    const run = await pauseRun(runStore, playbookRunId(playbookKey, projectId))
    console.log(JSON.stringify(run, null, 2))
    return
  }

  if (command === 'resume') {
    const [playbookKey, projectId] = rest0
    const run = await resumeRun(runStore, playbookRunId(playbookKey, projectId))
    console.log(JSON.stringify(run, null, 2))
    return
  }

  if (command === 'decide') {
    const [playbookKey, projectId, decisionFile] = rest0
    const decision = readJson<Record<string, unknown>>(decisionFile)
    const run = await recordJerryDecision(runStore, playbookRunId(playbookKey, projectId), decision)
    console.log(JSON.stringify(run, null, 2))
    return
  }

  if (command === 'delegate') {
    const request = readJson<SpecialistExecutionRequest>(rest0[0])
    const record = await registerExecution(store, request, 'MANUAL_EXECUTOR')
    const pkg = buildManualAssignmentPackage(record.request)
    console.log(JSON.stringify({ record, assignmentPackage: pkg }, null, 2))
    return
  }

  if (command === 'execution') {
    const [sub, ...rest] = rest0
    if (sub === 'show') {
      const record = await store.get(rest[0])
      if (!record) {
        console.error(`No execution "${rest[0]}"`)
        process.exitCode = 1
        return
      }
      console.log(JSON.stringify(record, null, 2))
      return
    }
    if (sub === 'list') {
      const records = await store.all()
      console.log(
        JSON.stringify(
          records.map((r) => ({ executionId: r.request.executionId, specialist: r.request.specialist, stage: r.request.stage, status: r.status, methodology: `${r.request.methodologyId}/${r.request.methodologyVersion}` })),
          null,
          2
        )
      )
      return
    }
    if (sub === 'submit-result') {
      const record = await store.get(rest[0])
      if (!record) {
        console.error(`No execution "${rest[0]}"`)
        process.exitCode = 1
        return
      }
      const envelope = readJson<SpecialistResultEnvelope>(rest[1])
      const outcome = await acceptExecutionResult(
        store,
        {
          executionId: record.request.executionId,
          projectId: record.request.projectId,
          destinationId: record.request.destinationId,
          metroId: record.request.metroId,
          playbookKey: record.request.playbookKey,
          stage: record.request.stage,
          methodologyId: record.request.methodologyId,
          methodologyVersion: record.request.methodologyVersion,
        },
        envelope
      )
      console.log(JSON.stringify(outcome, null, 2))
      return
    }
    if (sub === 'retry') {
      const record = await retryExecution(store, rest[0])
      console.log(JSON.stringify(record, null, 2))
      return
    }
  }

  console.error(
    'Usage: tsx agent-service/cli.ts [--file] <' +
      'run <metro_launch|destination_hub_lifecycle> <projectKey> [--category-plan f.json] [--geo-depth-plan f.json] [--m0 f.json] [--candidate f.json] | ' +
      'status <playbookKey> <projectKey> | pause <playbookKey> <projectKey> | resume <playbookKey> <projectKey> | ' +
      'decide <playbookKey> <projectKey> <decision.json> | ' +
      'delegate <request.json> | execution show <id> | execution list | execution submit-result <id> <result.json> | execution retry <id>>'
  )
  process.exitCode = 1
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
