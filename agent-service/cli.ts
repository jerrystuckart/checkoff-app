#!/usr/bin/env node
// Chief Phase 2D — operator CLI (spec section 30). A thin, file-backed
// wrapper around the executor runtime so Jerry (or anyone) can inspect
// and drive executions without editing DB rows by hand. This is the
// MANUAL_EXECUTOR bridge's human interface — not the desired end state
// (Chief invoking specialists autonomously is), but a first-class
// fallback that works today.
//
// Usage:
//   tsx agent-service/cli.ts delegate <request.json>
//   tsx agent-service/cli.ts execution show <executionId>
//   tsx agent-service/cli.ts execution list
//   tsx agent-service/cli.ts execution submit-result <executionId> <result.json>
//   tsx agent-service/cli.ts execution retry <executionId>
//
// State lives in .chief-executions.json in the current working directory
// (gitignored — this is local operator state, not a source of truth;
// the real source of truth is agent.tasks/task_events once an execution
// is wired into a playbook engine, per spec section 13's "reuse existing
// agent.runs" instruction).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ExecutionRecord, ExecutionStore, SpecialistExecutionRequest } from './specialists/executor'
import { registerExecution, acceptExecutionResult, retryExecution } from './specialists/executor'
import { buildManualAssignmentPackage } from './specialists/manualExecutor'
import type { SpecialistResultEnvelope } from './specialists/types'

const STORE_PATH = resolve(process.cwd(), '.chief-executions.json')

class FileExecutionStore implements ExecutionStore {
  private records: ExecutionRecord[]

  constructor() {
    this.records = existsSync(STORE_PATH) ? JSON.parse(readFileSync(STORE_PATH, 'utf8')) : []
  }

  get(executionId: string): ExecutionRecord | undefined {
    return this.records.find((r) => r.request.executionId === executionId)
  }

  put(record: ExecutionRecord): void {
    const i = this.records.findIndex((r) => r.request.executionId === record.request.executionId)
    if (i >= 0) this.records[i] = record
    else this.records.push(record)
    this.save()
  }

  findByIdempotencyKey(idempotencyKey: string): ExecutionRecord | undefined {
    return this.records.find((r) => r.request.idempotencyKey === idempotencyKey)
  }

  all(): ExecutionRecord[] {
    return this.records
  }

  private save(): void {
    writeFileSync(STORE_PATH, JSON.stringify(this.records, null, 2))
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T
}

function main() {
  const [, , command, ...args] = process.argv
  const store = new FileExecutionStore()

  if (command === 'delegate') {
    const request = readJson<SpecialistExecutionRequest>(args[0])
    const record = registerExecution(store, request, 'MANUAL_EXECUTOR')
    const pkg = buildManualAssignmentPackage(record.request)
    console.log(JSON.stringify({ record, assignmentPackage: pkg }, null, 2))
    return
  }

  if (command === 'execution') {
    const [sub, ...rest] = args
    if (sub === 'show') {
      const record = store.get(rest[0])
      if (!record) {
        console.error(`No execution "${rest[0]}"`)
        process.exitCode = 1
        return
      }
      console.log(JSON.stringify(record, null, 2))
      return
    }
    if (sub === 'list') {
      console.log(JSON.stringify(store.all().map((r) => ({ executionId: r.request.executionId, specialist: r.request.specialist, stage: r.request.stage, status: r.status, methodology: `${r.request.methodologyId}/${r.request.methodologyVersion}` })), null, 2))
      return
    }
    if (sub === 'submit-result') {
      const record = store.get(rest[0])
      if (!record) {
        console.error(`No execution "${rest[0]}"`)
        process.exitCode = 1
        return
      }
      const envelope = readJson<SpecialistResultEnvelope>(rest[1])
      const outcome = acceptExecutionResult(store, {
        executionId: record.request.executionId,
        projectId: record.request.projectId,
        destinationId: record.request.destinationId,
        metroId: record.request.metroId,
        playbookKey: record.request.playbookKey,
        stage: record.request.stage,
        methodologyId: record.request.methodologyId,
        methodologyVersion: record.request.methodologyVersion,
      }, envelope)
      console.log(JSON.stringify(outcome, null, 2))
      return
    }
    if (sub === 'retry') {
      const record = retryExecution(store, rest[0])
      console.log(JSON.stringify(record, null, 2))
      return
    }
  }

  console.error('Usage: tsx agent-service/cli.ts <delegate <request.json> | execution show <id> | execution list | execution submit-result <id> <result.json> | execution retry <id>>')
  process.exitCode = 1
}

main()
