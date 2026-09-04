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

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const useFile = rawArgs.includes('--file')
  const args = rawArgs.filter((a) => a !== '--file')
  const [command, ...rest0] = args
  const store: ExecutionStore = useFile ? new FileExecutionStore() : new DbExecutionStore()

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

  console.error('Usage: tsx agent-service/cli.ts [--file] <delegate <request.json> | execution show <id> | execution list | execution submit-result <id> <result.json> | execution retry <id>>')
  process.exitCode = 1
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
