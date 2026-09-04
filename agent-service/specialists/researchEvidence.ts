// Chief Phase 2E — the live-research evidence model (spec section 7).
// Pure types + validators, no I/O. Every candidate a research_verifier
// execution returns must carry enough structure for LATER verification/
// audit — an unsupported AI assertion is never itself accepted as
// verification evidence, and a broad-discovery candidate may carry lower
// certainty but must say so explicitly rather than implying it's already
// verified.

export type ResearchExecutionType = 'BROAD_DISCOVERY' | 'CATEGORY_GAP' | 'GEOGRAPHIC_GAP' | 'VERIFICATION' | 'REPLACEMENT'

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
