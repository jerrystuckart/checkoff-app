// Chief Phase 2I — progressive sales-asset generation (methodology
// 6E/destination_commercial/v1.md). Deterministic, template-based —
// DVA-1/DVA-2/DAP already contain nearly everything a one-pager or deck
// outline needs (destination identity, pain points, value proposition,
// opportunities), so this is assembly, not open-ended writing. No AI call
// is required to produce these — consistent with this codebase's
// "deterministic where code can do it, no AI unless genuinely needed"
// model-routing philosophy (see modelRouting.ts). LEVEL_0 (personalized
// first-outreach copy) is the one asset that benefits from AI
// personalization against a specific reply/relationship history — that
// path is the destination_relationship_manager specialist prompt
// (promptBuilders.ts), not this file.

import type { DVA1Artifact, DVA2Artifact, DAPArtifact } from './destinationHubLifecycle'
import type { SalesAssetLevel } from './destinationRelationship'

/**
 * Defense-in-depth mirror of destinationRelationship.ts's
 * requiredAssetLevel() gate — never build a full pitch deck without a
 * qualified DAP on file, even if a caller invokes this builder directly
 * out of the normal stage sequence.
 */
export function assetLevelReadyToGenerate(level: SalesAssetLevel, hasQualifiedDap: boolean): boolean {
  if (level === 'LEVEL_3_PITCH_DECK') return hasQualifiedDap
  return true
}

// ---------------------------------------------------------------------------
// LEVEL_1 — destination-specific one-pager
// ---------------------------------------------------------------------------

export interface OnePagerInput {
  dva1: DVA1Artifact | null
  dap: DAPArtifact
  /** Never include pricing unless the relationship stage explicitly calls for it — false by default at every caller of this function. */
  includePricing: boolean
}

export function buildOnePagerMarkdown(input: OnePagerInput): string {
  const { dap, dva1 } = input
  const lines: string[] = []
  lines.push(`# CheckOff for ${dap.destinationName}`)
  lines.push('')
  if (dva1?.recommendationText) lines.push(`_${dva1.recommendationText}_`)
  lines.push('')
  lines.push('## The Opportunity')
  lines.push(dap.extracted.checkoffValueProposition ?? '(value proposition not yet available)')
  lines.push('')
  if (dap.extracted.destinationPainPoints.length > 0) {
    lines.push('## What Visitors Are Missing Today')
    for (const p of dap.extracted.destinationPainPoints) lines.push(`- ${p}`)
    lines.push('')
  }
  lines.push('## How CheckOff Helps')
  lines.push(dap.extracted.recommendedEntryStrategy ?? '(entry strategy not yet available)')
  lines.push('')
  if (dap.extracted.timingConsiderations.length > 0) {
    lines.push('## Why Now')
    for (const t of dap.extracted.timingConsiderations) lines.push(`- ${t}`)
    lines.push('')
  }
  if (input.includePricing && dap.extracted.recommendedOfferDirection) {
    lines.push('## Investment')
    lines.push(dap.extracted.recommendedOfferDirection)
    lines.push('')
  }
  lines.push('## Next Step')
  lines.push(`A short conversation with ${dap.extracted.recommendedChampion ?? 'the right local partner'} to see if this is a fit.`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// LEVEL_3 — pitch deck outline (content, not rendered visuals — this
// codebase has no image-generation capability; "visuals/mockups" in
// LEVEL_2 means selecting from EXISTING product screenshots, never
// generating new ones)
// ---------------------------------------------------------------------------

export interface PitchDeckSection {
  title: string
  content: string
}

export interface ApprovedOffer {
  championPriceUsd: number
  founderPriceUsd?: number
}

export interface PitchDeckInput {
  dva1: DVA1Artifact | null
  dva2: DVA2Artifact | null
  dap: DAPArtifact
  relationshipHistorySummary: string
  /** Pricing/commercial terms are APPROVAL_REQUIRED — this is null until Jerry has explicitly approved an offer; the deck never invents pricing on its own. */
  approvedOffer: ApprovedOffer | null
}

/**
 * Deterministic assembly, one section per the spec's own required
 * outline: their destination, visitor challenges, CheckOff's role, their
 * hub vision, business participation/activation, measurable opportunity,
 * next step — plus an Investment section ONLY when Jerry has approved
 * specific pricing.
 */
export function buildPitchDeckOutline(input: PitchDeckInput): PitchDeckSection[] {
  const { dap, dva2 } = input
  const sections: PitchDeckSection[] = [
    { title: `${dap.destinationName}: Why This Destination`, content: input.dva1?.recommendationText ?? '(DVA-1 summary unavailable)' },
    { title: 'What Visitors Are Missing Today', content: dap.extracted.destinationPainPoints.join('\n') || '(no pain points on file)' },
    { title: "CheckOff's Role", content: dap.extracted.checkoffValueProposition ?? '(value proposition unavailable)' },
    { title: `The ${dap.destinationName} Hub`, content: dva2?.rationale ?? '(DVA-2 rationale unavailable)' },
    { title: 'Business Participation & Activation', content: dap.extracted.recommendedEntryStrategy ?? '(entry strategy unavailable)' },
    { title: 'Measurable Opportunity', content: dap.extracted.fundingBudgetClues.join('\n') || '(no budget/funding intelligence on file)' },
    { title: 'Relationship So Far', content: input.relationshipHistorySummary },
    { title: 'Next Step', content: `Move forward with ${dap.extracted.recommendedChampion ?? 'the right local partner'}.` },
  ]
  if (input.approvedOffer) {
    const { championPriceUsd, founderPriceUsd } = input.approvedOffer
    sections.splice(sections.length - 1, 0, {
      title: 'Investment',
      content: founderPriceUsd ? `Standard: $${championPriceUsd.toLocaleString()}/yr — Founder: $${founderPriceUsd.toLocaleString()}/yr` : `$${championPriceUsd.toLocaleString()}/yr`,
    })
  }
  return sections
}
