// agent-service/playbooks/difficultyEvidence.ts
//
// Difficulty-evidence rubric — Munich calibration Phase 2 (evidence-contract
// extension work following the Munich calibration analysis, see
// docs/metro-launch-audit/munich/calibration-analysis/14-difficulty-and-secret-remediation-plan.md).
// Pure function, no I/O.
//
// Grounded directly in that doc's Part A worked Munich examples (Dallmayr,
// Café Frischhut, Therme Erding, Weihenstephan, Andechs Bräustüberl,
// Maisinger Schlucht, KartPalast Funpark, Juristische Bibliothek, Steinheil
// 16, Barroom — all marked "Deterministic" in that doc) plus its three
// explicitly-flagged "Requires review" boundary cases (SAP Garden, DAV
// Kletter- und Boulderzentrum, Surftown MUC), which this module deliberately
// does NOT force into one confident number — it surfaces them as
// REQUIRES_REVIEW instead, matching the doc's own conservative judgment that
// a low-intensity physical activity or a travel-distance boundary case is a
// human call, not something a pure function should assert.
//
// Guardrail, not quota (same discipline as categoryPolicy.ts's
// FLAG_OVERCONCENTRATION and packetExecutionBudget.ts's zero-defect-on-READY
// rules): difficulty is never distributed for variety's sake, never assigned
// from venue fame or obscurity, and 1 is always the default — every
// escalation requires a concrete, named, sourced factor.

export type DifficultyBand = 1 | 5 | 10 | 25

export interface DifficultyFactor {
  present: boolean
  /** Concrete, specific evidence for why this factor is present — never a bare assertion. Ignored when present is false. */
  detail: string
}

export type DifficultyTravelLevel = 'NONE' | 'CLOSE_IN_OUTER_NEIGHBORHOOD' | 'SURROUNDING_MUNICIPALITY'

export interface DifficultyEvidence {
  /** A meaningful paid admission/ticket beyond an ordinary meal/drink/day-pass price (an ordinary climbing-gym day pass or a coffee does NOT count — see DAV Kletter- worked example). */
  cost: DifficultyFactor
  /** A genuine advance reservation, guided-tour slot, or scheduled event — never a same-day walk-up wait. */
  advanceBooking: DifficultyFactor
  /** A narrow, non-any-normal-hours timing window (e.g. "at dawn", "when the bell announces a fresh barrel"). */
  timingRestriction: DifficultyFactor
  /** Real physical exertion or a trained skill — not merely "some activity happens here." */
  physicalEffort: DifficultyFactor
  /** Capacity-constrained, seasonal, or a one-off scheduled event rather than a standing, reliably repeatable experience. */
  limitedAvailability: DifficultyFactor
  /** A multi-step or special-access completion process (e.g. a browse-and-choose mechanic, not a simple order-and-done). */
  specialOrderingComplexity: DifficultyFactor
  travel: { level: DifficultyTravelLevel; detail: string }
  /** Required — every difficulty evidence record must trace to a real source, same discipline as ResearchCandidateEvidence.source. */
  source: string
  /**
   * Set ONLY for a genuinely ambiguous case the rubric itself cannot resolve
   * deterministically (e.g. a low-intensity physical activity that could
   * reasonably be weighted either way, or a travel distance sitting right at
   * a tier boundary) — per the remediation plan's own three "Requires
   * review" examples. Forces REQUIRES_REVIEW confidence regardless of the
   * computed band; never used to hide a real gap in evidence (an entirely
   * missing factor is just `present: false`, not a boundary note).
   */
  boundaryCaseNote?: string
}

export interface DifficultyEvaluation {
  proposedDifficulty: DifficultyBand
  confidence: 'DETERMINISTIC' | 'REQUIRES_REVIEW'
  reasons: string[]
}

function level5EligibleFlags(e: DifficultyEvidence): boolean[] {
  return [
    e.cost.present,
    e.advanceBooking.present,
    e.timingRestriction.present,
    e.physicalEffort.present,
    e.travel.level === 'CLOSE_IN_OUTER_NEIGHBORHOOD',
    e.limitedAvailability.present,
    e.specialOrderingComplexity.present,
  ]
}

/**
 * Evaluates a candidate's DifficultyEvidence into a proposed 1/5/10/25 band.
 * NEVER escalates without a concrete, named factor — the default is 1
 * (walk-in, no friction), matching every real Munich item with no evidenced
 * factor at all (Dallmayr, Steinheil 16, Barroom).
 *
 * Bands, evidence-based (never venue fame/obscurity):
 *  - 1: no factor present at all.
 *  - 5: exactly one planning-step factor (a modest cost, a booking, a narrow
 *    timing window, physical effort, a close-in-outer-neighborhood trip,
 *    limited availability, or ordering complexity).
 *  - 10: two or more planning-step factors, OR travel to a surrounding metro
 *    municipality by itself (Andechs Bräustüberl: travel alone -> 10).
 *  - 25: travel to a surrounding metro municipality COMBINED with a real
 *    physical/skill challenge (Maisinger Schlucht's hike) — a planned trip,
 *    not a stop. Travel combined with only cost/booking stays at 10 (Therme
 *    Erding, Weihenstephan, KartPalast Funpark) — physical effort is what
 *    escalates a day trip past "real advance commitment" into "its own
 *    outing."
 */
export function evaluateDifficultyEvidence(evidence: DifficultyEvidence): DifficultyEvaluation {
  const reasons: string[] = []
  const factorNames: string[] = []
  if (evidence.cost.present) factorNames.push(`cost (${evidence.cost.detail})`)
  if (evidence.advanceBooking.present) factorNames.push(`advance booking (${evidence.advanceBooking.detail})`)
  if (evidence.timingRestriction.present) factorNames.push(`timing restriction (${evidence.timingRestriction.detail})`)
  if (evidence.physicalEffort.present) factorNames.push(`physical effort (${evidence.physicalEffort.detail})`)
  if (evidence.limitedAvailability.present) factorNames.push(`limited availability (${evidence.limitedAvailability.detail})`)
  if (evidence.specialOrderingComplexity.present) factorNames.push(`special ordering complexity (${evidence.specialOrderingComplexity.detail})`)
  if (evidence.travel.level !== 'NONE') factorNames.push(`travel: ${evidence.travel.level} (${evidence.travel.detail})`)

  let band: DifficultyBand
  if (evidence.travel.level === 'SURROUNDING_MUNICIPALITY') {
    if (evidence.physicalEffort.present) {
      band = 25
      reasons.push('Surrounding-metro-municipality travel combined with a real physical/skill challenge — a planned trip, not a stop.')
    } else {
      band = 10
      reasons.push('Travel to a surrounding metro municipality is, by itself, a real advance commitment.')
    }
  } else {
    const count = level5EligibleFlags(evidence).filter(Boolean).length
    if (count >= 2) {
      band = 10
      reasons.push(`${count} independent planning-step factors present — real advance commitment.`)
    } else if (count === 1) {
      band = 5
      reasons.push('Exactly one planning-step factor present.')
    } else {
      band = 1
      reasons.push('No cost, booking, timing, physical-effort, travel, availability, or ordering-complexity factor present — walk-in, no friction.')
    }
  }

  reasons.push(factorNames.length > 0 ? `Factors: ${factorNames.join('; ')}.` : 'No factors evidenced.')

  if (evidence.boundaryCaseNote) {
    reasons.push(`Flagged for human review: ${evidence.boundaryCaseNote}`)
    return { proposedDifficulty: band, confidence: 'REQUIRES_REVIEW', reasons }
  }

  return { proposedDifficulty: band, confidence: 'DETERMINISTIC', reasons }
}

/** Convenience builder for the common "no factor at all" (difficulty-1, walk-in) evidence shape. */
export function noFrictionDifficultyEvidence(source: string): DifficultyEvidence {
  const absent = (): DifficultyFactor => ({ present: false, detail: '' })
  return {
    cost: absent(),
    advanceBooking: absent(),
    timingRestriction: absent(),
    physicalEffort: absent(),
    limitedAvailability: absent(),
    specialOrderingComplexity: absent(),
    travel: { level: 'NONE', detail: '' },
    source,
  }
}
