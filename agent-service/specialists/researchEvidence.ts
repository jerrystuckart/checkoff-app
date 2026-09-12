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
