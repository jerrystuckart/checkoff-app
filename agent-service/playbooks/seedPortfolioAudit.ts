// agent-service/playbooks/seedPortfolioAudit.ts
//
// M5_75_SEED_PORTFOLIO_AUDIT — pure playbook module. Runs after candidate
// research/verification settle (after M4_COVERAGE_AUDIT's coverage loop,
// M6_QUALITY_VERIFICATION, and M5B_REPLACEMENT all complete) and BEFORE
// M6_5_CHECKOFF_EDITOR (item intake/editorial writing) begins — see
// metroLaunchDriver.ts's stepM5_75 for the driver-stage wiring.
//
// This is NOT a replacement for:
//   - M8_5_CATALOG_PRUNING, which prunes the already-CERTIFIED catalog
//     later (geo/tag/metadata unresolved items, out-of-market, etc.).
//   - The Metro Finisher stages (METRO_FINISHER_DEEP_RESEARCH/INTEGRATION/
//     PACKET_EXECUTION), which do late negative-space research on an
//     ALREADY-WRITTEN catalog.
// This stage operates on the RAW, UNWRITTEN candidate seed — the last real
// checkpoint before expensive editorial writing (M6.5) spends AI calls
// turning candidates into finished CheckOff bodies.
//
// Pure — no I/O, no AI call. Composes categoryPolicy.ts (adjustments 1-3, 5)
// and seedDuplicateNormalization.ts (adjustment 6). Follows
// metroFinisherReport.ts's validated-parser discipline (adjustment 10) so a
// malformed persisted report can never crash a reader.
//
// Munich calibration Phase 2 (docs/metro-launch-audit/munich/calibration-analysis/
// 00-executive-summary.md's headline finding) + its follow-up wiring pass:
// SeedCandidateInput's ownershipType/isSecretClaimed/secretEvidence/
// difficultyEvidence fields are evaluated correctly by
// evaluateSeedCandidate/evaluateCommercialMix/evaluateSecretEvidence, and
// the real M3/M5/M5B driver call sites now request
// 'ownershipType'/'secretEvidence'/'difficultyEvidence'/'placeId' in
// requiredEvidenceKeys (see ../specialists/promptBuilders.ts's
// buildResearchVerifierPrompt) — metroLaunchDriver.ts's
// toSeedCandidateInput() runs every raw research_verifier candidate through
// ../specialists/researchEvidence.ts's sanitizeExtendedCandidateEvidence
// before it reaches this stage, so a candidate whose research pass
// genuinely couldn't confirm a field still arrives here as explicit
// UNKNOWN_REQUIRES_VERIFICATION/null/absent (never guessed), which is the
// correct, honest input for this module's existing evaluation logic
// (unchanged by this wiring pass).

import { checkDistinctiveExperience } from './editorialDistinctiveness'
import { auditCoverage, type CoverageAuditEvidence, type CoverageGap } from './metroLaunch'
import {
  evaluateCategoryPolicies,
  categoryPolicyGatePasses,
  evaluateCommercialMix,
  evaluateSecretEvidence,
  type CategoryPolicySet,
  type CategoryPolicyResult,
  type CategoryPolicyException,
  type CommercialMixItem,
  type CommercialMixResult,
  type CommercialOwnershipType,
  type SecretEvidenceRecord,
  DEFAULT_COMMERCIAL_MIX_MIN_LOCAL_PERCENT,
  DEFAULT_UNKNOWN_OWNERSHIP_VOLUME_THRESHOLD,
} from './categoryPolicy'
import { detectSeedDuplicateClusters, candidateNamesInAnyCluster, type SeedDuplicateCandidate, type SeedDuplicateCluster } from './seedDuplicateNormalization'
import type { DifficultyEvidence, DifficultyBand } from './difficultyEvidence'

// ---------------------------------------------------------------------------
// Adjustment 7 — loop termination controls. Generic/configurable, following
// packetExecutionBudget.ts's pattern (every field caller-configured, the
// exported DEFAULT is only a fallback).
// ---------------------------------------------------------------------------

export type GapResolutionStatus = 'FILLED' | 'DOCUMENTED_ZERO' | 'WAIVED' | 'UNRESOLVED'

export interface SeedPortfolioAuditLoopControls {
  maxTargetedResearchIterations: number
  maxCandidatesAddedPerIteration: number
}

export const DEFAULT_SEED_PORTFOLIO_AUDIT_LOOP_CONTROLS: SeedPortfolioAuditLoopControls = {
  maxTargetedResearchIterations: 3,
  maxCandidatesAddedPerIteration: 20,
}

export interface GapStatusRecord {
  gapKey: string
  kind: 'CATEGORY' | 'GEOGRAPHIC' | 'COMMERCIAL_MIX' | 'UNKNOWN_OWNERSHIP_VOLUME'
  status: GapResolutionStatus
  detail: string
}

/**
 * Classifies every CURRENTLY-failing category/geographic/commercial-mix
 * finding into its required explicit status (adjustment 7). `documentedZeroKeys`
 * is caller-supplied (the driver's own gapResearchHistory-plateau
 * classification — see coveragePlanRelaxation.ts's classifyGapsForRelaxation,
 * the established precedent for "real, plateaued research effort" this
 * module deliberately reuses rather than re-deriving) — this function does
 * not itself have visibility into research-attempt history, so it never
 * guesses DOCUMENTED_ZERO on its own; everything not WAIVED or
 * DOCUMENTED_ZERO defaults to UNRESOLVED. FILLED is never produced here —
 * a gap that has been filled is, by definition, no longer in the failing
 * set this function is fed; the driver records FILLED itself when a
 * previously-failing key drops out of a fresh audit pass.
 */
export function deriveGapResolutionStatuses(params: {
  categoryFailures: readonly CategoryPolicyResult[]
  geographicGaps: readonly CoverageGap[]
  commercialMix: CommercialMixResult
  documentedZeroKeys?: ReadonlySet<string>
}): GapStatusRecord[] {
  const documentedZeroKeys = params.documentedZeroKeys ?? new Set<string>()
  const records: GapStatusRecord[] = []

  for (const failure of params.categoryFailures) {
    // FLAG_OVERCONCENTRATION is a soft, non-blocking warning (see
    // categoryPolicy.ts's own doc) — it never produces a GapStatusRecord;
    // it is still visible in the report's categoryCoverage.results.
    if (failure.verdict === 'PASS' || failure.verdict === 'PASS_WITH_EXCEPTION' || failure.verdict === 'FLAG_OVERCONCENTRATION') continue
    const status: GapResolutionStatus = failure.exceptionApplied ? 'WAIVED' : documentedZeroKeys.has(failure.categoryName) ? 'DOCUMENTED_ZERO' : 'UNRESOLVED'
    records.push({ gapKey: failure.categoryName, kind: 'CATEGORY', status, detail: failure.reasons.join('; ') })
  }

  for (const gap of params.geographicGaps) {
    const status: GapResolutionStatus = documentedZeroKeys.has(gap.name) ? 'DOCUMENTED_ZERO' : 'UNRESOLVED'
    records.push({ gapKey: gap.name, kind: 'GEOGRAPHIC', status, detail: gap.detail })
  }

  if (params.commercialMix.verdict === 'FAIL') {
    const status: GapResolutionStatus = documentedZeroKeys.has('COMMERCIAL_MIX') ? 'DOCUMENTED_ZERO' : 'UNRESOLVED'
    records.push({ gapKey: 'COMMERCIAL_MIX', kind: 'COMMERCIAL_MIX', status, detail: params.commercialMix.reason })
  }
  if (params.commercialMix.unknownVolumeFinding) {
    records.push({ gapKey: 'UNKNOWN_OWNERSHIP_VOLUME', kind: 'UNKNOWN_OWNERSHIP_VOLUME', status: 'UNRESOLVED', detail: params.commercialMix.unknownVolumeFinding })
  }

  return records
}

// ---------------------------------------------------------------------------
// Adjustment 4 — READY/HOLD/REJECT per-candidate verdicts. Zero-defect rules
// (duplicate rate zero, generic rate zero, unsupported-secret rate zero)
// apply ONLY to candidates that would advance to M6_5_CHECKOFF_EDITOR as
// READY — HOLD/REJECT candidates may retain documented issues; they simply
// don't advance.
// ---------------------------------------------------------------------------

export type SeedCandidateVerdict = 'READY' | 'HOLD' | 'REJECT'

export interface SeedCandidateInput {
  name: string
  category: string | null
  neighborhood: string | null
  claimSupported: string
  address?: string | null
  placeId?: string | null
  /** Defaults to UNKNOWN_REQUIRES_VERIFICATION when omitted — never silently treated as INDEPENDENT_LOCAL (adjustment 3). */
  ownershipType?: CommercialOwnershipType
  isSecretClaimed?: boolean
  secretEvidence?: SecretEvidenceRecord | null
  /** Reuses difficultyEvidence.ts's rubric verbatim — absent means INSUFFICIENT_DATA (never yet evaluated), not "no friction." */
  difficultyEvidence?: DifficultyEvidence
  /** Always the evaluateDifficultyEvidence-derived band for difficultyEvidence when present — carried alongside it, never independently asserted. */
  proposedDifficulty?: DifficultyBand
}

export interface SeedCandidateDecision {
  candidateName: string
  verdict: SeedCandidateVerdict
  reasons: string[]
  /** Whether an isSecret claim survives evaluateSecretEvidence — false whenever isSecretClaimed is falsy too. Never blocks READY on its own (adjustment 5: the claim is stripped, the item is not rejected). */
  isSecretRetained: boolean
  /** Passed through from SeedCandidateInput, unchanged — absent means difficulty is INSUFFICIENT_DATA for this candidate, not "1". */
  difficultyEvidence?: DifficultyEvidence
  proposedDifficulty?: DifficultyBand
}

/**
 * Per-candidate READY/HOLD/REJECT call. Generic-action candidates (no
 * distinctive experience — reuses editorialDistinctiveness.ts's exact
 * checkDistinctiveExperience heuristic against the raw claimSupported text,
 * rather than inventing a second generic-detector) are REJECTed outright —
 * they are filler at the seed stage, not worth an editorial pass. Candidates
 * caught in an unresolved seedDuplicateNormalization cluster are HOLD, never
 * auto-resolved (adjustment 6) — they may still turn out to be legitimate
 * distinct experiences at the same venue. A weak/unsupported isSecret claim
 * never blocks READY by itself; only isSecretRetained is set to false.
 */
export function evaluateSeedCandidate(candidate: SeedCandidateInput, duplicateClusterNames: ReadonlySet<string>): SeedCandidateDecision {
  const reasons: string[] = []

  // checkDistinctiveExperience's own venueName-stripping only strips a
  // SINGLE-QUOTED span ('Venue Name') — the certified-body convention
  // downstream of M6.5. Raw, pre-editorial claimSupported text has no such
  // quoting yet, so the raw candidate NAME is stripped here instead
  // (case-insensitive, unquoted) before the generic-concept scan — a real
  // venue literally named "...Diner"/"...Cafe"/etc. must never
  // substring-match a generic category noun via its own name text alone.
  const nameStrippedClaim = candidate.name ? candidate.claimSupported.split(new RegExp(candidate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).join(' ') : candidate.claimSupported
  const distinctiveness = checkDistinctiveExperience(nameStrippedClaim)
  const isGeneric = !distinctiveness.pass

  const isDuplicateFlagged = duplicateClusterNames.has(candidate.name)
  if (isDuplicateFlagged) reasons.push('Flagged in a seed duplicate cluster — requires explicit review before it can be READY (never auto-resolved at this stage).')

  const secretEval = candidate.isSecretClaimed ? evaluateSecretEvidence(candidate.secretEvidence ?? null) : { supported: false, reason: 'No isSecret claim made.' }
  const isSecretRetained = Boolean(candidate.isSecretClaimed) && secretEval.supported

  if (isGeneric) {
    reasons.push(`Generic action, no distinctive experience: ${distinctiveness.reason}`)
    return { candidateName: candidate.name, verdict: 'REJECT', reasons, isSecretRetained, difficultyEvidence: candidate.difficultyEvidence, proposedDifficulty: candidate.proposedDifficulty }
  }

  if (isDuplicateFlagged) {
    return { candidateName: candidate.name, verdict: 'HOLD', reasons, isSecretRetained, difficultyEvidence: candidate.difficultyEvidence, proposedDifficulty: candidate.proposedDifficulty }
  }

  return { candidateName: candidate.name, verdict: 'READY', reasons: [], isSecretRetained, difficultyEvidence: candidate.difficultyEvidence, proposedDifficulty: candidate.proposedDifficulty }
}

// ---------------------------------------------------------------------------
// Adjustment 10 — Structured A-F report.
// ---------------------------------------------------------------------------

export interface SeedPortfolioAuditReport {
  metro: string
  generatedAt: string
  /** A. Executive verdict. */
  executiveVerdict: {
    verdict: 'READY_FOR_EDITORIAL' | 'NEEDS_JERRY' | 'BLOCKED'
    summary: string
  }
  /** B. Category coverage. */
  categoryCoverage: {
    results: CategoryPolicyResult[]
    gatePasses: boolean
  }
  /** C. Geographic coverage. */
  geographicCoverage: {
    gaps: CoverageGap[]
    gatePasses: boolean
  }
  /** D. Commercial mix. */
  commercialMix: CommercialMixResult
  /** E. Candidate-level decisions and defects. */
  candidateDecisions: {
    ready: string[]
    hold: SeedCandidateDecision[]
    reject: SeedCandidateDecision[]
    duplicateClusters: SeedDuplicateCluster[]
    /** Candidates whose isSecret claim was stripped for insufficient evidence — the venue itself is retained. */
    secretClaimsStripped: string[]
  }
  /** F. Remaining gaps / exceptions / required human decisions. */
  remainingGaps: {
    gapStatuses: GapStatusRecord[]
    exceptionsApplied: CategoryPolicyException[]
    requiredHumanDecisions: string[]
  }
}

export interface SeedPortfolioAuditInput {
  metro: string
  now: string
  candidates: readonly SeedCandidateInput[]
  geographicEvidence: CoverageAuditEvidence
  categoryPolicySet: CategoryPolicySet
  commercialMixMinLocalPercent?: number
  unknownOwnershipVolumeThreshold?: number
  documentedZeroKeys?: ReadonlySet<string>
}

function toSeedDuplicateCandidate(c: SeedCandidateInput): SeedDuplicateCandidate {
  return { name: c.name, address: c.address, placeId: c.placeId, claimSupported: c.claimSupported }
}

/**
 * Runs the full Seed Portfolio Audit over the raw candidate seed. Idempotent:
 * calling this twice with identical input produces byte-identical output
 * (every step is a pure function of the input, no randomness, no wall-clock
 * reads except the caller-supplied `now`).
 */
export function runSeedPortfolioAudit(input: SeedPortfolioAuditInput): SeedPortfolioAuditReport {
  const categoryCounts = new Map<string, number>()
  for (const c of input.candidates) {
    const key = c.category ?? 'Uncategorized'
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1)
  }
  const categoryResults = evaluateCategoryPolicies(
    [...categoryCounts.entries()].map(([categoryName, count]) => ({ categoryName, count })),
    input.categoryPolicySet,
    input.candidates.length
  )
  const categoryGatePasses = categoryPolicyGatePasses(categoryResults)

  // Geographic gaps ONLY — auditCoverage also computes CATEGORY_* gaps from
  // its own older raw-count-only logic, which categoryPolicy.ts's richer
  // count+percentage model now supersedes for this stage; only its
  // GEOGRAPHIC_HOLE/GEOGRAPHIC_BELOW_MINIMUM output is reused here.
  const allGaps = auditCoverage(input.geographicEvidence)
  const geographicGaps = allGaps.filter((g) => g.kind === 'GEOGRAPHIC_HOLE' || g.kind === 'GEOGRAPHIC_BELOW_MINIMUM')
  const geographicGatePasses = geographicGaps.length === 0

  const commercialMixItems: CommercialMixItem[] = input.candidates.map((c) => ({ candidateName: c.name, ownershipType: c.ownershipType ?? 'UNKNOWN_REQUIRES_VERIFICATION' }))
  const commercialMix = evaluateCommercialMix(commercialMixItems, input.commercialMixMinLocalPercent ?? DEFAULT_COMMERCIAL_MIX_MIN_LOCAL_PERCENT, input.unknownOwnershipVolumeThreshold ?? DEFAULT_UNKNOWN_OWNERSHIP_VOLUME_THRESHOLD)

  const duplicateClusters = detectSeedDuplicateClusters(input.candidates.map(toSeedDuplicateCandidate))
  const duplicateNames = candidateNamesInAnyCluster(duplicateClusters)

  const decisions = input.candidates.map((c) => evaluateSeedCandidate(c, duplicateNames))
  const ready = decisions.filter((d) => d.verdict === 'READY').map((d) => d.candidateName)
  const hold = decisions.filter((d) => d.verdict === 'HOLD')
  const reject = decisions.filter((d) => d.verdict === 'REJECT')
  const secretClaimsStripped = input.candidates.filter((c) => c.isSecretClaimed).map((c) => c.name).filter((name) => !decisions.find((d) => d.candidateName === name)!.isSecretRetained)

  // Zero-defect enforcement (adjustment 4): READY candidates must carry zero
  // unresolved defects by construction — evaluateSeedCandidate never returns
  // READY with a non-empty reasons array. This assertion documents/protects
  // that invariant rather than silently trusting it.
  const readyWithDefects = decisions.filter((d) => d.verdict === 'READY' && d.reasons.length > 0)
  if (readyWithDefects.length > 0) {
    throw new Error(`Invariant violated: ${readyWithDefects.length} READY candidate(s) carry unresolved defects — READY must be zero-defect. This is a bug in evaluateSeedCandidate, not a legitimate audit outcome.`)
  }

  const gapStatuses = deriveGapResolutionStatuses({ categoryFailures: categoryResults, geographicGaps, commercialMix, documentedZeroKeys: input.documentedZeroKeys })
  const exceptionsApplied = categoryResults.filter((r): r is CategoryPolicyResult & { exceptionApplied: CategoryPolicyException } => r.exceptionApplied !== null).map((r) => r.exceptionApplied)

  const unresolvedGaps = gapStatuses.filter((g) => g.status === 'UNRESOLVED')
  const requiredHumanDecisions = unresolvedGaps.map((g) => `${g.kind} ${g.gapKey}: ${g.detail}`)
  if (hold.length > 0) requiredHumanDecisions.push(`${hold.length} candidate(s) on HOLD pending duplicate-cluster review: ${hold.map((h) => h.candidateName).join(', ')}`)

  const overallGatePasses = categoryGatePasses && geographicGatePasses && commercialMix.verdict !== 'FAIL'
  const verdict: SeedPortfolioAuditReport['executiveVerdict']['verdict'] = overallGatePasses ? 'READY_FOR_EDITORIAL' : unresolvedGaps.length > 0 ? 'NEEDS_JERRY' : 'READY_FOR_EDITORIAL'

  return {
    metro: input.metro,
    generatedAt: input.now,
    executiveVerdict: {
      verdict,
      summary:
        verdict === 'READY_FOR_EDITORIAL'
          ? `Seed portfolio audit passes: ${ready.length} candidate(s) READY for M6.5 editorial intake, ${hold.length} on HOLD, ${reject.length} REJECTed as generic filler.`
          : `Seed portfolio audit has ${unresolvedGaps.length} unresolved gap(s) requiring a human decision before editorial intake can proceed at full confidence.`,
    },
    categoryCoverage: { results: categoryResults, gatePasses: categoryGatePasses },
    geographicCoverage: { gaps: geographicGaps, gatePasses: geographicGatePasses },
    commercialMix,
    candidateDecisions: { ready, hold, reject, duplicateClusters, secretClaimsStripped },
    remainingGaps: { gapStatuses, exceptionsApplied, requiredHumanDecisions },
  }
}

// ---------------------------------------------------------------------------
// Validated parser — metroFinisherReport.ts's discipline: a malformed
// persisted/round-tripped report must never crash a reader, only report
// structured errors.
// ---------------------------------------------------------------------------

export interface SeedPortfolioAuditReportValidationResult {
  ok: boolean
  report: SeedPortfolioAuditReport | null
  errors: string[]
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Validates a raw (e.g. JSON round-tripped) object as a real
 * SeedPortfolioAuditReport shape. Deliberately conservative/shallow (checks
 * structural presence of every A-F section and its verdict enum, not a deep
 * re-validation of every nested candidate record) — this guards the report
 * PERSISTENCE boundary, not a second copy of runSeedPortfolioAudit's own
 * logic.
 */
export function validateSeedPortfolioAuditReport(v: unknown): SeedPortfolioAuditReportValidationResult {
  const errors: string[] = []
  if (typeof v !== 'object' || v === null) return { ok: false, report: null, errors: ['expected an object'] }
  const o = v as Record<string, unknown>

  if (!isNonEmptyString(o.metro)) errors.push('metro: required non-empty string')
  if (!isNonEmptyString(o.generatedAt)) errors.push('generatedAt: required non-empty string')

  const executiveVerdict = o.executiveVerdict as Record<string, unknown> | undefined
  if (typeof executiveVerdict !== 'object' || executiveVerdict === null) {
    errors.push('executiveVerdict: expected an object')
  } else if (executiveVerdict.verdict !== 'READY_FOR_EDITORIAL' && executiveVerdict.verdict !== 'NEEDS_JERRY' && executiveVerdict.verdict !== 'BLOCKED') {
    errors.push('executiveVerdict.verdict: must be READY_FOR_EDITORIAL|NEEDS_JERRY|BLOCKED')
  }

  for (const key of ['categoryCoverage', 'geographicCoverage', 'commercialMix', 'candidateDecisions', 'remainingGaps']) {
    if (typeof o[key] !== 'object' || o[key] === null) errors.push(`${key}: expected an object`)
  }

  if (errors.length > 0) return { ok: false, report: null, errors }
  return { ok: true, report: v as SeedPortfolioAuditReport, errors: [] }
}
