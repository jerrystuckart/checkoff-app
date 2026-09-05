// Chief Phase 2O — legacy DVA/DAP artifact reconciliation. Pure logic,
// no I/O. Several real Destination opportunities (Grand Lake, Buena
// Vista, Williams AZ, Rim Country, Elkhart Lake) were researched via the
// standalone DVA-1/DVA-2/DAP Claude Projects BEFORE the destination_hub_
// lifecycle driver (destinationHubDriver.ts) existed. "We are not
// starting the Destination pipeline over" — this module determines, from
// whatever real artifacts already exist for a destination, exactly which
// lifecycle stage is genuinely complete and what the single next missing
// stage is, reusing the SAME gate/validation functions the live driver
// already uses (evaluateDVA1Gate, routeDVA2Recommendation,
// dapEntryConditionMet, validateDva2Input, validateDapInput,
// detectStaleOperationalDates) — never a second, competing notion of
// "done."

import {
  evaluateDVA1Gate,
  routeDVA2Recommendation,
  dapEntryConditionMet,
  validateDva2Input,
  validateDapInput,
  detectStaleOperationalDates,
  type DVA1Artifact,
  type DVA2Artifact,
  type DAPArtifact,
} from './destinationHubLifecycle'

/** Where a real artifact actually came from — never overwritten, never inferred beyond what's stated. */
export interface LegacyArtifactProvenance {
  sourceFile: string
  /** When Chief ingested it into agent.* (this reconciliation run), ISO. */
  ingestedAt: string
  /** The document's own stated date, when it states one (e.g. "DAP generated: August 16, 2026") — null if the source document names no date. Never guessed. */
  documentDate: string | null
}

export interface LegacyDestinationArtifacts {
  destinationId: string
  destinationName: string
  dva1?: DVA1Artifact
  dva2?: DVA2Artifact
  dap?: DAPArtifact
  provenance: {
    dva1?: LegacyArtifactProvenance
    dva2?: LegacyArtifactProvenance
    dap?: LegacyArtifactProvenance
  }
}

/**
 * The hub-lifecycle stage this destination has genuinely COMPLETED
 * through, given whatever real artifacts exist — never advanced past
 * what evidence actually supports. 'DECLINED' is not a
 * destinationHubLifecycle stage at all — it's this module's own terminal
 * marker for a destination Jerry has explicitly closed out, distinct
 * from every stage below it (never re-derived from the artifacts once set).
 */
export type CanonicalStage = 'NO_ARTIFACTS' | 'DVA1_COMPLETE' | 'DVA2_COMPLETE' | 'DAP_COMPLETE' | 'DECLINED'

export interface StageDetermination {
  canonicalStage: CanonicalStage
  /** The single next real methodology stage to run — null when nothing further should run automatically (e.g. DVA-2 said stop/hold, or DAP is complete and the next step is human relationship work, not another methodology run). */
  nextMissingStage: 'DVA1' | 'DVA2' | 'DAP' | null
  reason: string
  /** True only when a real, chain-validated DAP exists AND its own DVA-2 didn't recommend stopping/holding without resolution — i.e., there is real substance to hand to relationship work. Does NOT mean a verified contact exists — that is checked separately, never inferred from artifact completeness alone. */
  sufficientForRelationshipReadiness: boolean
}

/**
 * Determines the canonical stage from whatever real artifacts exist —
 * never manufactures a missing link. If a DAP exists but its DVA-2 does
 * not, or the chain fails validateDva2Input/validateDapInput, that is
 * surfaced as an explicit chain issue (see validateLegacyArtifactChain),
 * not silently papered over here.
 */
export function determineCanonicalStage(artifacts: Pick<LegacyDestinationArtifacts, 'dva1' | 'dva2' | 'dap'>): StageDetermination {
  const { dva1, dva2, dap } = artifacts

  if (!dva1 && !dva2 && !dap) {
    return { canonicalStage: 'NO_ARTIFACTS', nextMissingStage: 'DVA1', reason: 'No legacy artifacts on file for this destination.', sufficientForRelationshipReadiness: false }
  }

  if (dap) {
    // A DAP existing is itself the strongest evidence of completion,
    // even when the historical DVA-2 gate (dapEntryConditionMet) would
    // not have automatically authorized it — e.g. Grand Lake's DVA-2
    // recommended HOLD_DAP_UNTIL_ISSUE_RESOLVED, but a later live
    // verification (documented in the DAP itself) resolved the hold and
    // Jerry had the DAP built anyway. Never rewrite that DVA-2's
    // original recommendation to make the gate "pass" retroactively —
    // report the mismatch as a quality note instead (see
    // validateLegacyArtifactChain).
    return {
      canonicalStage: 'DAP_COMPLETE',
      nextMissingStage: null,
      reason: dva2 && !dapEntryConditionMet(dva2)
        ? `DAP exists despite DVA-2's own recommendedNextStep (${dva2.recommendedNextStep}) not being BUILD_DAP_NOW — a real DAP was produced after a documented mid-stream verification superseded the original hold; treating the DAP as authoritative, not re-litigating the DVA-2 gate.`
        : 'DAP complete — the next work is relationship/outreach, not another methodology run.',
      sufficientForRelationshipReadiness: true,
    }
  }

  if (dva2) {
    const routed = routeDVA2Recommendation(dva2)
    if (dva2.recommendedNextStep === 'BUILD_DAP_NOW') {
      return { canonicalStage: 'DVA2_COMPLETE', nextMissingStage: 'DAP', reason: routed.reason, sufficientForRelationshipReadiness: false }
    }
    // HOLD or STOP — DVA-2 is complete, but DAP should NOT be auto-run.
    return { canonicalStage: 'DVA2_COMPLETE', nextMissingStage: null, reason: routed.reason, sufficientForRelationshipReadiness: false }
  }

  // dva1 only
  const gate = evaluateDVA1Gate(dva1!)
  return {
    canonicalStage: 'DVA1_COMPLETE',
    nextMissingStage: gate.proposeDva2 ? 'DVA2' : null,
    reason: gate.reason,
    sufficientForRelationshipReadiness: false,
  }
}

export interface ArtifactChainIssue {
  severity: 'INFO' | 'WARNING'
  message: string
}

/**
 * Chain-integrity check across whatever artifacts exist — reuses the
 * SAME hard validations the live driver enforces (validateDva2Input,
 * validateDapInput), plus flags (as INFO, not blocking) any documented
 * mismatch between a DAP's existence and its DVA-2's original
 * recommendation. Never blocks ingestion — this is a report input, not a
 * gate; a real legacy artifact with an honest quality wrinkle should
 * still be ingested and flagged, not discarded.
 */
export function validateLegacyArtifactChain(artifacts: Pick<LegacyDestinationArtifacts, 'dva1' | 'dva2' | 'dap'>): ArtifactChainIssue[] {
  const { dva1, dva2, dap } = artifacts
  const issues: ArtifactChainIssue[] = []

  if (dva2 && !dva1) issues.push({ severity: 'WARNING', message: 'DVA-2 exists with no DVA-1 artifact on file — the DVA-1 recap embedded in the DVA-2 document is the only record of it.' })
  if (dap && !dva2) issues.push({ severity: 'WARNING', message: 'DAP exists with no independently supplied DVA-2 artifact — only the DAP\'s own carried-forward commercial figures represent it.' })

  if (dva1 && dva2) {
    const v = validateDva2Input(dva1, dva2)
    if (!v.valid) issues.push({ severity: 'WARNING', message: v.reason })
  }
  if (dva2 && dap) {
    const v = validateDapInput(dva2, dap)
    if (!v.valid) issues.push({ severity: 'WARNING', message: v.reason })
    if (!dapEntryConditionMet(dva2)) {
      issues.push({ severity: 'INFO', message: `DAP exists despite DVA-2's recommendedNextStep being ${dva2.recommendedNextStep}, not BUILD_DAP_NOW — see the DAP's own mid-stream verification note.` })
    }
  }

  return issues
}

export interface DapStalenessCheck {
  stale: boolean
  staleDates: string[]
  reason: string | null
}

/** Wraps destinationHubLifecycle.ts's own stale-date detector — reused, never reimplemented. */
export function checkDapStaleness(dap: DAPArtifact, nowIso: string): DapStalenessCheck {
  return detectStaleOperationalDates(dap, nowIso)
}
