// Chief production-integrity pass — aggregate real per-execution usage
// data (agent-service/specialists/usagePricing.ts computes the per-call
// figures; this module rolls them up). Pure, operates over whatever
// ExecutionRecord[] an ExecutionStore hands back — no I/O of its own.

import type { ExecutionRecord } from './executor'

export interface UsageAggregate {
  executionCount: number
  /** Executions that completed without usable usage data — counted separately, never silently folded into $0 cost. */
  unavailableCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
}

export interface UsageSummary {
  byProject: Record<string, UsageAggregate>
  byPlaybook: Record<string, UsageAggregate>
  byMethodology: Record<string, UsageAggregate>
  bySpecialist: Record<string, UsageAggregate>
  byProvider: Record<string, UsageAggregate>
  overall: UsageAggregate
}

function emptyAggregate(): UsageAggregate {
  return { executionCount: 0, unavailableCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
}

function addInto(bucket: Record<string, UsageAggregate>, key: string, record: ExecutionRecord): void {
  const agg = bucket[key] ?? emptyAggregate()
  agg.executionCount += 1
  const usage = record.envelope?.providerUsage ?? null
  if (!usage || !usage.available) {
    agg.unavailableCount += 1
  } else {
    agg.inputTokens += usage.inputTokens ?? 0
    agg.outputTokens += usage.outputTokens ?? 0
    agg.totalTokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    agg.costUsd += usage.costUsd ?? 0
  }
  bucket[key] = agg
}

/**
 * Rolls up usage/cost across every dimension asked for: project,
 * playbook, methodology, specialist, provider — plus an overall total.
 * Only REMOTE_AI executions carry providerUsage; a MANUAL_EXECUTOR or
 * deterministic TestExecutor result simply has none, which counts as
 * "unavailable" here rather than $0 — never conflating "no cost" with
 * "no data."
 */
export function summarizeExecutionUsage(records: readonly ExecutionRecord[]): UsageSummary {
  const byProject: Record<string, UsageAggregate> = {}
  const byPlaybook: Record<string, UsageAggregate> = {}
  const byMethodology: Record<string, UsageAggregate> = {}
  const bySpecialist: Record<string, UsageAggregate> = {}
  const byProvider: Record<string, UsageAggregate> = {}
  const overall = emptyAggregate()

  for (const record of records) {
    addInto(byProject, record.request.projectId, record)
    addInto(byPlaybook, record.request.playbookKey, record)
    addInto(byMethodology, `${record.request.methodologyId}/${record.request.methodologyVersion}`, record)
    addInto(bySpecialist, record.request.specialist, record)
    addInto(byProvider, record.envelope?.providerUsage?.provider ?? record.envelope?.providerKey ?? '(none)', record)

    overall.executionCount += 1
    const usage = record.envelope?.providerUsage ?? null
    if (!usage || !usage.available) {
      overall.unavailableCount += 1
    } else {
      overall.inputTokens += usage.inputTokens ?? 0
      overall.outputTokens += usage.outputTokens ?? 0
      overall.totalTokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      overall.costUsd += usage.costUsd ?? 0
    }
  }

  return { byProject, byPlaybook, byMethodology, bySpecialist, byProvider, overall }
}
