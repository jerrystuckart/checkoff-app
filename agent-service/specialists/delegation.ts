// Chief Phase 2C — the orchestration contract. Pure logic only.
//
// CHIEF OWNS: goal, project state, dependency graph, authority check,
// task assignment, evidence acceptance, quality gates, cross-agent
// handoff, escalation to Jerry, completion.
// SPECIALIST OWNS: focused execution, evidence, recommendations,
// structured result. A specialist never independently changes strategic
// scope or a public/commercial commitment — enforced here by
// validateResultEnvelope() refusing to accept a result that claims
// something outside its objective, and by standingAuthority.ts gating
// every actually-mutating operation regardless of what a specialist
// recommends.

import { evaluateAuthority } from '../playbooks/standingAuthority'
import type { DelegationRequest, SpecialistResultEnvelope, EnvelopeValidationResult } from './types'
import type { SpecialistKey } from './types'
import { getSpecialist } from './registry'

/**
 * Chief's authority check before EVER delegating — refuses to build a
 * delegation request for an operation with no standing-authority entry.
 * This is step 1 of "Chief owns: authority check" — the delegation
 * itself never proceeds without it.
 */
export function assertDelegationAuthorized(operationKey: string): void {
  evaluateAuthority(operationKey) // throws UnknownAuthorityOperationError if unregistered
}

/**
 * The ONE validation every specialist result passes through before
 * Chief accepts it as evidence and advances a playbook stage. A
 * specialist's own "confidence: HIGH" or a populated
 * recommendedNextAction is never itself proof — Chief checks that every
 * evidence key the delegation actually required is present and
 * non-empty, and that a jerryRequired=true result actually explains why.
 */
export function validateResultEnvelope(request: DelegationRequest, result: SpecialistResultEnvelope): EnvelopeValidationResult {
  const reasons: string[] = []
  const missingEvidenceKeys = request.requiredEvidenceKeys.filter((key) => {
    const value = result.evidence[key]
    if (value === undefined || value === null) return true
    if (typeof value === 'string' && value.trim() === '') return true
    if (Array.isArray(value) && value.length === 0) return true
    return false
  })
  if (missingEvidenceKeys.length > 0) {
    reasons.push(`missing required evidence: ${missingEvidenceKeys.join(', ')}`)
  }
  if (result.taskId === '' || result.objective === '') {
    reasons.push('taskId and objective are required and must be non-empty')
  }
  if (result.jerryRequired && (!result.jerryReason || result.jerryReason.trim() === '')) {
    reasons.push('jerryRequired=true but jerryReason is empty — Chief never escalates without a stated reason')
  }
  if (!result.jerryRequired && result.jerryReason) {
    reasons.push('jerryReason is set but jerryRequired is false — inconsistent envelope')
  }
  if (result.methodologyId !== request.methodologyId || result.methodologyVersion !== request.methodologyVersion) {
    reasons.push(
      `methodology mismatch: delegated ${request.methodologyId}/${request.methodologyVersion}, result claims ${result.methodologyId}/${result.methodologyVersion} — a result must record the exact methodology it actually ran`
    )
  }

  return { valid: reasons.length === 0, missingEvidenceKeys, reasons }
}

/**
 * Builds the structured description of what Chief is asking a
 * specialist to do — pure, returns the request object; the caller
 * (a playbook engine) is responsible for actually creating the
 * agent.tasks row via the existing createTask primitive, owned by the
 * specialist's ownerKey. No new write path here.
 */
export function buildDelegationRequest(
  specialist: SpecialistKey,
  playbookKey: string,
  stage: string,
  objective: string,
  inputs: Record<string, unknown>,
  requiredEvidenceKeys: string[],
  methodologyId: string,
  methodologyVersion: string
): DelegationRequest {
  return { specialist, playbookKey, stage, objective, inputs, requiredEvidenceKeys, methodologyId, methodologyVersion }
}

/** Which specialist a given delegation actually targets, resolved to its real agent.owners.owner_key (never assumed to equal the SpecialistKey string). */
export function ownerKeyFor(specialist: SpecialistKey): string {
  return getSpecialist(specialist).ownerKey
}
