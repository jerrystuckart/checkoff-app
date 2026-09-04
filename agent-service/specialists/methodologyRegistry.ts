// Chief Phase 2D — the methodology registry. Every specialist execution
// must run a versioned CheckOff methodology (a file under
// specialists/methodologies/), never a generic prompt invented at
// delegation time. This module is the closed set of known
// (methodologyId, version) pairs Chief will accept — an execution
// naming an unregistered pair is rejected before it ever reaches an
// executor, same discipline as standingAuthority.ts's
// UnknownAuthorityOperationError.

import type { SpecialistKey } from './types'

export interface MethodologyDefinition {
  methodologyId: string
  version: string
  /**
   * Every specialist genuinely allowed to execute against this
   * methodology — several playbooks (metro_launch, destination_commercial)
   * are coordinated by one specialist but executed in part by another
   * (e.g. metro_builder coordinates, research_verifier does the actual
   * M3/M5/M6 discovery/verification legwork under the SAME methodology
   * doc). A single "owner" field would wrongly reject that real pattern.
   */
  allowedSpecialists: readonly SpecialistKey[]
  /** Repo-relative path to the canonical instructions. */
  docPath: string
  /**
   * false = the doc above is gate-semantics-only; the real methodology
   * still lives in an external system (a Claude Project) not yet
   * recoverable. true = this doc IS the complete, executable
   * methodology. Never claim true for a doc that is honestly partial —
   * see destination/dva1|dva2|dap's own doc for why they're false.
   */
  complete: boolean
  /**
   * Chief Phase 2E addition. sha256 of the exact file content, recorded
   * ONLY once a methodology has gone through a real, deliberate
   * ingestion (methodologyIngestion.ts's ingestMethodology()) — null for
   * every doc this codebase authored itself (the gate-semantics-only DVA
   * placeholders, and the metro_launch/checkoff_editor/
   * destination_commercial docs distilled from repo+Open Brain evidence).
   * verifyMethodologyIntegrity() checks every non-null hash still matches
   * the file on disk, so a hand-edit after ingestion is caught rather
   * than silently drifting from what Jerry actually provided.
   */
  contentHash: string | null
}

export const METHODOLOGY_REGISTRY: readonly MethodologyDefinition[] = Object.freeze([
  {
    methodologyId: 'metro_launch',
    version: 'v1',
    allowedSpecialists: ['metro_builder', 'research_verifier'],
    docPath: 'agent-service/specialists/methodologies/metro_launch/v1.md',
    complete: true,
    contentHash: null,
  },
  {
    methodologyId: 'checkoff_editor',
    version: 'v1',
    allowedSpecialists: ['checkoff_editor'],
    docPath: 'agent-service/specialists/methodologies/checkoff_editor/v1.md',
    complete: true,
    contentHash: null,
  },
  {
    methodologyId: 'destination_commercial',
    version: 'v1',
    allowedSpecialists: ['destination_relationship_manager', 'destination_activation'],
    docPath: 'agent-service/specialists/methodologies/destination_commercial/v1.md',
    complete: true,
    contentHash: null,
  },
  {
    methodologyId: 'destination/dva1',
    version: 'v1',
    allowedSpecialists: ['destination_strategist'],
    docPath: 'agent-service/specialists/methodologies/destination/dva1/v1.md',
    complete: false, // gate semantics only — full DVA-1 question set/rubric lives in an external Claude Project, not yet exported
    contentHash: null,
  },
  {
    methodologyId: 'destination/dva2',
    version: 'v1',
    allowedSpecialists: ['destination_strategist'],
    docPath: 'agent-service/specialists/methodologies/destination/dva2/v1.md',
    complete: false,
    contentHash: null,
  },
  {
    methodologyId: 'destination/dap',
    version: 'v1',
    allowedSpecialists: ['destination_strategist'],
    docPath: 'agent-service/specialists/methodologies/destination/dap/v1.md',
    complete: false,
    contentHash: null,
  },
])

export class UnknownMethodologyError extends Error {
  constructor(
    public readonly methodologyId: string,
    public readonly version: string
  ) {
    super(`No registered methodology "${methodologyId}"/"${version}" — every specialist execution must run a versioned, registered methodology. Add it to METHODOLOGY_REGISTRY first.`)
    this.name = this.constructor.name
  }
}

export function getMethodology(methodologyId: string, version: string): MethodologyDefinition {
  const found = METHODOLOGY_REGISTRY.find((m) => m.methodologyId === methodologyId && m.version === version)
  if (!found) throw new UnknownMethodologyError(methodologyId, version)
  return found
}

export function methodologyExists(methodologyId: string, version: string): boolean {
  return METHODOLOGY_REGISTRY.some((m) => m.methodologyId === methodologyId && m.version === version)
}

/** Every methodology a given specialist is registered to execute. */
export function methodologiesFor(specialist: SpecialistKey): MethodologyDefinition[] {
  return METHODOLOGY_REGISTRY.filter((m) => m.allowedSpecialists.includes(specialist))
}
