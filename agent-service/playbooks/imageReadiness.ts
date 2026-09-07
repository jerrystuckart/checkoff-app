// agent-service/playbooks/imageReadiness.ts
//
// Chief Phase 2W — image readiness as a real, named launch-certification
// gate. Winston cannot autonomously select/upload images (a real,
// standing product boundary — image curation is a human/business
// judgment call, not something to fabricate a plausible-looking pick
// for). That is fine. What is NOT fine is letting missing images either
// (a) silently pass certification, or (b) stop the whole metro pipeline
// EARLY the moment an image is missing, before every other automatable
// gate has even run. This module makes image readiness its own gate,
// evaluated LAST alongside every other gate — a metro can (and should)
// finish every other phase of work while images are still outstanding,
// and the final report names EXACTLY which Home cards still need one.

import type { StagingGateResult } from './metroCatalog'

export interface ImageReadinessCard {
  /** A human-readable label identifying the Home-visible card/list/item that needs an image — e.g. "Primary seasonal list: FALL 2026 — Vienna Metro" or "Themed list: Hidden Vienna". */
  cardLabel: string
  required: boolean
  hasImage: boolean
}

export interface ImageReadinessResult {
  gate: StagingGateResult
  missingCards: string[]
}

export const IMAGE_READINESS_GATE_KEY = 'IMAGE_READINESS_GATE'

/**
 * PASSes only when every REQUIRED card already has an image. A card
 * marked `required: false` is never penalized for lacking one (mirrors
 * homeListCertification.ts's own requiresImage/hasImage discipline).
 * Fails closed on an empty card list — a metro with zero known Home
 * cards has not actually had this checked, not vacuously passed it.
 */
export function evaluateImageReadinessGate(cards: readonly ImageReadinessCard[]): ImageReadinessResult {
  if (cards.length === 0) {
    return { gate: { key: IMAGE_READINESS_GATE_KEY, verdict: 'FAIL', reason: 'No Home cards were evaluated for image readiness — this gate cannot pass on an empty set.' }, missingCards: [] }
  }
  const missingCards = cards.filter((c) => c.required && !c.hasImage).map((c) => c.cardLabel)
  if (missingCards.length > 0) {
    return {
      gate: {
        key: IMAGE_READINESS_GATE_KEY,
        verdict: 'FAIL',
        reason: `${missingCards.length} required Home card(s) still need an image: ${missingCards.join(', ')}. Image selection is a human/business judgment call Winston does not make autonomously — this is a genuine BLOCKED reason, never worked around with a placeholder image.`,
      },
      missingCards,
    }
  }
  return { gate: { key: IMAGE_READINESS_GATE_KEY, verdict: 'PASS', reason: `All ${cards.filter((c) => c.required).length} required Home card(s) have an image.` }, missingCards: [] }
}
