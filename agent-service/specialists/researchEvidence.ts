// Chief Phase 2E — the live-research evidence model (spec section 7).
// Pure types + validators, no I/O. Every candidate a research_verifier
// execution returns must carry enough structure for LATER verification/
// audit — an unsupported AI assertion is never itself accepted as
// verification evidence, and a broad-discovery candidate may carry lower
// certainty but must say so explicitly rather than implying it's already
// verified.

import type { CommercialOwnershipType, SecretEvidenceRecord } from '../playbooks/categoryPolicy'
import { evaluateSecretEvidence } from '../playbooks/categoryPolicy'
import type { DifficultyEvidence, DifficultyBand } from '../playbooks/difficultyEvidence'
import { evaluateDifficultyEvidence } from '../playbooks/difficultyEvidence'
import { normalizedVenueKey } from '../playbooks/seedDuplicateNormalization'

export type ResearchExecutionType = 'BROAD_DISCOVERY' | 'CATEGORY_GAP' | 'GEOGRAPHIC_GAP' | 'VERIFICATION' | 'REPLACEMENT' | 'TARGETED_DEEP_DIVE'

export type VerificationConfidence = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ResearchCandidateEvidence {
  name: string
  category: string | null
  neighborhood: string | null
  /** What claim this source actually supports (e.g. "confirms current address and open status") — never left implicit. */
  claimSupported: string
  /** URL or named source (e.g. a specific web page, a business's own site) — required, never a bare model assertion. */
  source: string
  /** ISO date the source's information reflects, when the source states one. Null is honest ("source doesn't date itself"), never fabricated. */
  freshnessDate: string | null
  verificationConfidence: VerificationConfidence
  /** True for BROAD_DISCOVERY candidates and anything not yet run through VERIFICATION — the M6/D-stage verification pass is what may clear this. */
  needsVerification: boolean
}

export interface ResearchEvidenceValidationResult {
  valid: boolean
  reasons: string[]
}

/**
 * The hard rule from spec section 7: no candidate may claim to be
 * verified evidence without a real source. A BROAD_DISCOVERY candidate
 * is explicitly allowed lower certainty, but `needsVerification` must be
 * true for it — an unsupported assertion masquerading as confirmed fact
 * is exactly what this rejects.
 */
export function validateResearchCandidate(candidate: ResearchCandidateEvidence, executionType: ResearchExecutionType): ResearchEvidenceValidationResult {
  const reasons: string[] = []
  if (!candidate.name || candidate.name.trim() === '') reasons.push('candidate.name is required')
  if (!candidate.source || candidate.source.trim() === '') reasons.push('candidate.source is required — an unsupported AI assertion is never accepted as evidence')
  if (!candidate.claimSupported || candidate.claimSupported.trim() === '') reasons.push('candidate.claimSupported is required — state what the source actually supports')
  if (executionType === 'BROAD_DISCOVERY' && !candidate.needsVerification) {
    reasons.push('BROAD_DISCOVERY candidates must be explicitly marked needsVerification=true — discovery is not verification')
  }
  if (executionType === 'VERIFICATION' && candidate.needsVerification) {
    reasons.push('a VERIFICATION-pass candidate marked needsVerification=true means verification did not actually happen for it')
  }
  return { valid: reasons.length === 0, reasons }
}

export function validateResearchCandidates(candidates: ResearchCandidateEvidence[], executionType: ResearchExecutionType): ResearchEvidenceValidationResult {
  const allReasons = candidates.flatMap((c, i) => validateResearchCandidate(c, executionType).reasons.map((r) => `candidate[${i}] (${c.name || 'unnamed'}): ${r}`))
  return { valid: allReasons.length === 0, reasons: allReasons }
}

// ---------------------------------------------------------------------------
// evidence.claimSupported normalization — a research_verifier envelope's
// evidence is an untyped Record<string, unknown> (SpecialistResultEnvelope),
// and a TARGETED_DEEP_DIVE request that declares requiredEvidenceKeys:
// ['claimSupported'] has been observed (Munich, "Schmalznudeln at Café
// Frischhut", 2026-09-12) to come back with evidence.claimSupported as an
// ARRAY of full source objects (each carrying its own nested name/source/
// neighborhood/claimSupported/needsVerification/verificationConfidence),
// not the plain string the legacy contract elsewhere in this codebase
// expects (e.g. ResearchCandidateEvidence.claimSupported per-candidate,
// which genuinely is always a plain string). Both shapes are real. This
// normalizes either into one stable internal type so callers never touch
// the raw envelope value directly.
// ---------------------------------------------------------------------------

export interface NormalizedClaimSupportSource {
  /** Best-effort human label for this source (its name, or its URL if unnamed). */
  label?: string
  /** Whether this individual source actually carries usable supporting text. */
  supported: boolean
  /** The supporting text itself, when present. */
  note?: string
}

export interface NormalizedClaimSupport {
  /** False when the raw value was missing, empty, or an unrecognized shape — callers must treat this as "no usable evidence," never guess a fallback. */
  valid: boolean
  /** Combined supporting text usable anywhere the legacy plain-string contract is consumed (e.g. as a factual source for editorial writing, or a body for geo-matching). Empty when invalid. */
  text: string
  /** Per-source detail, preserved rather than collapsed — empty for the legacy plain-string shape (represented as a single implicit source). */
  sources: NormalizedClaimSupportSource[]
}

const INVALID_CLAIM_SUPPORT: NormalizedClaimSupport = { valid: false, text: '', sources: [] }

/**
 * Normalizes a research_verifier envelope's raw `evidence.claimSupported`
 * value. Accepts the legacy plain-string shape and the real array-of-
 * source-objects shape observed in live output; anything else is reported
 * as invalid (never thrown) so the caller can cleanly reject that one
 * candidate the same way it would reject any other certification failure.
 */
export function normalizeClaimSupported(raw: unknown): NormalizedClaimSupport {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return INVALID_CLAIM_SUPPORT
    return { valid: true, text: trimmed, sources: [{ supported: true, note: trimmed }] }
  }

  if (Array.isArray(raw)) {
    if (raw.length === 0) return INVALID_CLAIM_SUPPORT
    const sources: NormalizedClaimSupportSource[] = raw.map((entry) => {
      if (!entry || typeof entry !== 'object') return { supported: false }
      const e = entry as Record<string, unknown>
      const note = typeof e.claimSupported === 'string' ? e.claimSupported.trim() : ''
      const hasSource = typeof e.source === 'string' && e.source.trim().length > 0
      const label = typeof e.name === 'string' && e.name.trim() ? e.name : typeof e.source === 'string' ? e.source : undefined
      return { label, supported: note.length > 0 && hasSource, note: note || undefined }
    })
    const supportedNotes = sources.filter((s) => s.supported && s.note).map((s) => s.note as string)
    if (supportedNotes.length === 0) return { valid: false, text: '', sources }
    return { valid: true, text: supportedNotes.join(' '), sources }
  }

  return INVALID_CLAIM_SUPPORT
}

// ---------------------------------------------------------------------------
// Evidence-contract extension (Munich calibration Phase 2) — the fields
// research_verifier can populate that seedPortfolioAudit.ts's
// SeedCandidateInput already duck-types but that, per that module's own code
// comment and the Munich calibration analysis
// (docs/metro-launch-audit/munich/calibration-analysis/00-executive-summary.md),
// the live evidence contract has never actually populated for any real
// candidate — every real Munich candidate resolves to
// ownershipType='UNKNOWN_REQUIRES_VERIFICATION' and isSecretClaimed=undefined
// not because the fields don't exist downstream, but because nothing upstream
// ever fills them in. This section makes the fields real and gives the
// research/discovery execution path a validated shape to populate them with.
//
// No consumer behavior changes here — seedPortfolioAudit.ts, categoryPolicy.ts,
// and difficultyEvidence.ts are all reused as-is (never re-derived), and this
// module composes them into one per-candidate evidence record plus a
// validator. Wiring a real research_verifier prompt/response to actually
// populate this shape end-to-end is a separate, later concern; this is the
// contract itself.
// ---------------------------------------------------------------------------

/**
 * The four geography "kind" values already required of
 * evidence.neighborhoods[] entries by promptBuilders.ts's
 * buildResearchVerifierPrompt — reused verbatim here (never re-invented) so a
 * candidate's own geographic role can be evaluated with the same vocabulary
 * the metro's own neighborhood map already uses. See
 * docs/metro-launch-audit/munich/calibration-analysis/03-category-geography-comparison.md's
 * central/outer/surrounding-municipality distinction for why this matters —
 * Munich's own m0.json never recorded which tier a later-added neighborhood
 * (e.g. Dachau, Starnberg) actually belonged to.
 */
export type CandidateGeographicRole = 'core_urban' | 'important_neighborhood' | 'suburb' | 'destination_worthy_outer'

export const VALID_CANDIDATE_GEOGRAPHIC_ROLES: readonly CandidateGeographicRole[] = ['core_urban', 'important_neighborhood', 'suburb', 'destination_worthy_outer']

/**
 * Per-candidate evidence-contract extension. Every field is optional — a
 * research pass that cannot yet populate a field must omit it (or, for
 * ownership, explicitly state UNKNOWN_REQUIRES_VERIFICATION) rather than
 * guess. Extends the base ResearchCandidateEvidence shape (name/category/
 * neighborhood/claimSupported/source/freshnessDate/verificationConfidence/
 * needsVerification) — this is additive, not a replacement contract.
 */
export interface ExtendedResearchCandidateEvidence extends ResearchCandidateEvidence {
  /** Reuses categoryPolicy.ts's CommercialOwnershipType taxonomy verbatim — never a locally-invented ownership label. */
  ownershipType?: CommercialOwnershipType
  /** Concrete evidence for the ownership claim (e.g. "fourth-generation family butcher, per venue's own About page") — required whenever ownershipType is anything other than UNKNOWN_REQUIRES_VERIFICATION (see validateExtendedResearchCandidate). */
  ownershipEvidence?: string
  ownershipConfidence?: VerificationConfidence
  isSecretClaimed?: boolean
  /** Reuses categoryPolicy.ts's SecretEvidenceRecord shape verbatim — evaluated downstream by the existing evaluateSecretEvidence, never a second secret-evidence rubric. */
  secretEvidence?: SecretEvidenceRecord | null
  /** A verified Google Place ID, when research actually confirmed one — never guessed/fabricated from a name+address alone. */
  verifiedPlaceId?: string | null
  /** Reuses difficultyEvidence.ts's rubric verbatim — required whenever proposedDifficulty is asserted (see validateExtendedResearchCandidate). */
  difficultyEvidence?: DifficultyEvidence
  /** Must equal evaluateDifficultyEvidence(difficultyEvidence).proposedDifficulty when both are present — never an independently-asserted number a human/model could drift from the evidence backing it. */
  proposedDifficulty?: DifficultyBand
  geographicRole?: CandidateGeographicRole
}

/**
 * Business/venue identity normalization for evidence-contract candidates —
 * reuses seedDuplicateNormalization.ts's exact normalizedVenueKey helper
 * (Unicode/case/punctuation-insensitive) rather than re-deriving a second
 * normalization routine. Two candidates whose names normalize to the same
 * key plausibly resolve to the same real-world venue — the same signal
 * seedDuplicateNormalization.ts's detectSeedDuplicateClusters already uses
 * downstream at the seed-audit stage.
 */
export function normalizedBusinessIdentity(name: string): string {
  return normalizedVenueKey(name)
}

export interface ExtendedResearchEvidenceValidationResult {
  valid: boolean
  reasons: string[]
}

/**
 * Validates the evidence-contract extension fields on ONE candidate. Runs
 * validateResearchCandidate first (the base contract still applies in full),
 * then adds the extension-specific rules:
 *   - ownershipType asserted as anything other than UNKNOWN_REQUIRES_VERIFICATION
 *     requires non-empty ownershipEvidence — never silently treated as
 *     verified from a bare label (mirrors categoryPolicy.ts's adjustment 3
 *     discipline: "never silently treated as INDEPENDENT_LOCAL").
 *   - isSecretClaimed=true requires a secretEvidence record to be present
 *     (its own sufficiency is evaluateSecretEvidence's job downstream, not
 *     this validator's — this only guards the contract shape: a claim with
 *     literally no evidence record attached is a malformed candidate, not
 *     merely a weak one).
 *   - proposedDifficulty requires difficultyEvidence to be present, and when
 *     both are present they must agree with evaluateDifficultyEvidence's own
 *     output — a hand-asserted difficulty number that disagrees with its own
 *     stated evidence is rejected outright, never silently trusted.
 *   - geographicRole, when present, must be one of the 4 recognized values.
 */
export function validateExtendedResearchCandidate(candidate: ExtendedResearchCandidateEvidence, executionType: ResearchExecutionType): ExtendedResearchEvidenceValidationResult {
  const base = validateResearchCandidate(candidate, executionType)
  const reasons: string[] = [...base.reasons]

  if (candidate.ownershipType && candidate.ownershipType !== 'UNKNOWN_REQUIRES_VERIFICATION') {
    if (!candidate.ownershipEvidence || candidate.ownershipEvidence.trim() === '') {
      reasons.push(`ownershipType "${candidate.ownershipType}" asserted without ownershipEvidence — never silently treated as verified without concrete supporting evidence.`)
    }
  }

  if (candidate.isSecretClaimed && !candidate.secretEvidence) {
    reasons.push('isSecretClaimed is true but no secretEvidence record was provided — a secret claim requires an evidence record (its sufficiency is evaluated separately by evaluateSecretEvidence).')
  }

  if (candidate.proposedDifficulty !== undefined && !candidate.difficultyEvidence) {
    reasons.push('proposedDifficulty is asserted without difficultyEvidence — difficulty must never be assigned without the concrete factors backing it.')
  }

  if (candidate.difficultyEvidence) {
    const computed = evaluateDifficultyEvidence(candidate.difficultyEvidence)
    if (candidate.proposedDifficulty !== undefined && candidate.proposedDifficulty !== computed.proposedDifficulty) {
      reasons.push(`proposedDifficulty (${candidate.proposedDifficulty}) disagrees with evaluateDifficultyEvidence's own computed band (${computed.proposedDifficulty}) for the same difficultyEvidence — never trust a hand-asserted number over its own stated evidence.`)
    }
  }

  if (candidate.geographicRole && !VALID_CANDIDATE_GEOGRAPHIC_ROLES.includes(candidate.geographicRole)) {
    reasons.push(`geographicRole "${candidate.geographicRole}" is not one of the 4 recognized values: ${VALID_CANDIDATE_GEOGRAPHIC_ROLES.join(', ')}.`)
  }

  return { valid: reasons.length === 0, reasons }
}

export function validateExtendedResearchCandidates(candidates: ExtendedResearchCandidateEvidence[], executionType: ResearchExecutionType): ExtendedResearchEvidenceValidationResult {
  const allReasons = candidates.flatMap((c, i) => validateExtendedResearchCandidate(c, executionType).reasons.map((r) => `candidate[${i}] (${c.name || 'unnamed'}): ${r}`))
  return { valid: allReasons.length === 0, reasons: allReasons }
}

/**
 * Resolves the secret-evidence verdict for an extended candidate, reusing
 * categoryPolicy.ts's evaluateSecretEvidence verbatim (never a second secret
 * rubric). Returns { supported: false } with an explanatory reason whenever
 * isSecretClaimed is falsy, exactly like seedPortfolioAudit.ts's own
 * evaluateSeedCandidate does for the plain SeedCandidateInput shape.
 */
export function resolveSecretEvidenceForCandidate(candidate: ExtendedResearchCandidateEvidence): { supported: boolean; reason: string } {
  if (!candidate.isSecretClaimed) return { supported: false, reason: 'No isSecret claim made.' }
  return evaluateSecretEvidence(candidate.secretEvidence ?? null)
}
