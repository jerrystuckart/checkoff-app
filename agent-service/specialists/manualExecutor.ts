// Chief Phase 2D — the manual executor. First-class fallback bridge, NOT
// the desired operating model (spec section 12): Chief builds a
// structured assignment package for a specific execution, a human (or
// another AI Jerry/Chief directs) does the work out of band, and hands
// back a SpecialistResultEnvelope which goes through the exact same
// acceptExecutionResult validation as any automated executor — no
// special-cased trust for a manual result.
//
// Manual execution is inherently two-phase/asynchronous (assign now,
// receive later — possibly minutes or days later), which doesn't fit
// SpecialistExecutor's synchronous execute() contract used by
// runExecution(). This module exposes the two phases directly instead of
// forcing a fake synchronous shape onto real human latency.

import type { ExecutionStore, ExecutionRecord, SpecialistExecutionRequest } from './executor'
import { registerExecution, acceptExecutionResult, type AcceptResultOutcome } from './executor'
import type { SpecialistResultEnvelope } from './types'

export interface ManualAssignmentPackage {
  executionId: string
  specialist: string
  playbookKey: string
  stage: string
  methodologyId: string
  methodologyVersion: string
  objective: string
  inputs: Record<string, unknown>
  requiredEvidenceKeys: string[]
  /** Human-readable instructions pointing whoever executes this at the exact methodology doc — never a re-derived summary of it. */
  instructions: string
}

export function buildManualAssignmentPackage(request: SpecialistExecutionRequest): ManualAssignmentPackage {
  return {
    executionId: request.executionId,
    specialist: request.specialist,
    playbookKey: request.playbookKey,
    stage: request.stage,
    methodologyId: request.methodologyId,
    methodologyVersion: request.methodologyVersion,
    objective: request.objective,
    inputs: request.inputs,
    requiredEvidenceKeys: request.requiredEvidenceKeys,
    instructions:
      `Execute this as specialist "${request.specialist}" against methodology ` +
      `${request.methodologyId}/${request.methodologyVersion} (agent-service/specialists/methodologies/${request.methodologyId}/${request.methodologyVersion}.md). ` +
      `Return a SpecialistResultEnvelope with executionId="${request.executionId}", methodologyId="${request.methodologyId}", ` +
      `methodologyVersion="${request.methodologyVersion}", and every key of requiredEvidenceKeys populated non-empty.`,
  }
}

/**
 * Phase 1 — Chief registers the execution as MANUAL and hands out the
 * assignment package. Idempotent via the same idempotencyKey discipline
 * as registerExecution.
 */
export function beginManualExecution(store: ExecutionStore, request: SpecialistExecutionRequest): { record: ExecutionRecord; assignmentPackage: ManualAssignmentPackage } {
  const record = registerExecution(store, request, 'MANUAL_EXECUTOR')
  if (record.status === 'PENDING') record.status = 'IN_PROGRESS' // handed off, awaiting the human/other-AI
  store.put(record)
  return { record, assignmentPackage: buildManualAssignmentPackage(request) }
}

/**
 * Phase 2 — the human/other-AI hands back a result. Goes through the
 * EXACT same identity + evidence validation as any automated executor
 * (acceptExecutionResult) — a manual result claiming "done" is never
 * itself accepted as evidence.
 */
export function submitManualResult(store: ExecutionStore, executionId: string, envelope: SpecialistResultEnvelope): AcceptResultOutcome {
  const record = store.get(executionId)
  if (!record) throw new Error(`No execution registered with id "${executionId}" — call beginManualExecution first.`)
  return acceptExecutionResult(
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
}
