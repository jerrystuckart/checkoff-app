// agent-service/playbooks/lateAddItemCertification.ts
//
// Chief Phase 2AK (2026-09-10, methodology hardening postmortem, "Dive
// Bars" case) — a themed list created AFTER the main catalog build (or any
// single-venue addition after the fact) must go through the SAME minimum
// certification pipeline as an original-discovery item: duplicate/
// reconciliation check, neighborhood assignment, Google Places enrichment,
// category, canonical tags, metadata, CheckOff editorial quality, and list
// linkage. This module is the single, required composition point — a
// future "add this venue to a themed list" code path calls
// certifyLateAddItem() and gets back one PASS/FAIL verdict built from the
// SAME real gate functions the main build uses, never a lower-standard
// shortcut that only checks some of them.
//
// Pure — no I/O. The caller is responsible for having already produced
// each of these pieces of real evidence (a real reconciliation query, a
// real Places lookup, a real OpenAI editorial call) exactly the way the
// main build does; this module's job is to refuse certification if ANY
// required piece is missing or fails its own real gate, never to silently
// treat "not provided" as "not applicable."

import { reconcileAgainstExistingInventory, type ExistingProductionItem, type ReconciliationCandidate } from './existingInventoryReconciliation'
import { evaluatePlacesCompletenessGate, type PlacesCompletenessItemInput } from './placesCompletenessGate'
import { checkDistinctiveExperience, checkVenueQuoted } from './editorialDistinctiveness'
import { evaluateItemMetadata, type MetadataEnrichmentInput } from './metroMetadataEnrichment'
import type { RealDbCategory } from './metroCatalog'

export interface LateAddItemInput {
  candidateName: string
  venueName: string
  body: string
  dbCategory: RealDbCategory | null
  tags: string[]
  neighborhoodName: string | null
  places: PlacesCompletenessItemInput
  /** Existing production inventory in the target region — even a single late add must be checked against it, exactly like the main build (see existingInventoryReconciliation.ts). Pass an empty array only when a real query genuinely found none — never omit the check itself. */
  existingProductionItems: readonly ExistingProductionItem[]
}

export interface LateAddCertificationResult {
  candidateName: string
  verdict: 'CERTIFIED' | 'REJECTED'
  reasons: string[]
  /** Set when reconciliation found this is a same-venue/same-experience match against an existing production item — the late add must REUSE that item, never create a duplicate row. */
  reuseExistingItemId?: string
}

const REQUIRED_TAG_COUNT_MIN = 6
const REQUIRED_TAG_COUNT_MAX = 8

/**
 * Runs the full minimum late-add pipeline against one candidate. Returns
 * CERTIFIED only when every required check passes; otherwise REJECTED with
 * every specific failure reason listed (never a vague "needs work").
 */
export function certifyLateAddItem(input: LateAddItemInput): LateAddCertificationResult {
  const reasons: string[] = []

  // 1. Duplicate/reconciliation check — same discipline as the main build.
  const reconciliationCandidate: ReconciliationCandidate = {
    candidateName: input.candidateName,
    body: input.body,
    googlePlaceId: input.places.googlePlaceId,
    formattedAddress: input.places.formattedAddress,
    lat: input.places.lat,
    lng: input.places.lng,
  }
  const reconciliation = reconcileAgainstExistingInventory([reconciliationCandidate], input.existingProductionItems)
  if (reconciliation.reused.length > 0) {
    // A genuine same-venue/same-experience match — this is not a rejection,
    // it's a REUSE instruction: the caller must link the existing item,
    // never insert a new row for it.
    return { candidateName: input.candidateName, verdict: 'REJECTED', reasons: [`Matches existing production item ${reconciliation.reused[0].existingItemId} (same venue, same experience) — reuse it, do not create a duplicate row.`], reuseExistingItemId: reconciliation.reused[0].existingItemId }
  }

  // 2. Neighborhood assignment — must be resolved, never left null for a real venue.
  if (!input.neighborhoodName) reasons.push('No neighborhood assignment resolved from verified address/coordinates.')

  // 3. Google Places enrichment — the full 5-field completeness gate, same as the main build.
  const placesResult = evaluatePlacesCompletenessGate([input.places])
  if (placesResult.verdict === 'FAIL') reasons.push(placesResult.reason)

  // 4. Category — must be a real canonical category, never null/unmapped.
  if (!input.dbCategory) reasons.push('No canonical production category resolved.')

  // 5. Canonical tags — 6-8, same range the main build's TAG_CERTIFICATION_GATE requires.
  if (input.tags.length < REQUIRED_TAG_COUNT_MIN || input.tags.length > REQUIRED_TAG_COUNT_MAX) {
    reasons.push(`Expected ${REQUIRED_TAG_COUNT_MIN}-${REQUIRED_TAG_COUNT_MAX} canonical tags, got ${input.tags.length}.`)
  }

  // 6. Metadata — the same deterministic evaluateItemMetadata() pass every original-discovery item gets.
  if (input.dbCategory) {
    const metadataInput: MetadataEnrichmentInput = { candidateName: input.candidateName, body: input.body, dbCategory: input.dbCategory }
    const metadata = evaluateItemMetadata(metadataInput)
    const unevaluated = (['hasAlcohol', 'photoRequired', 'checkinType', 'isSecret', 'difficulty', 'visitProfileKey'] as const).filter((k) => !metadata[k].evaluated)
    if (unevaluated.length > 0) reasons.push(`Metadata not fully evaluated: ${unevaluated.join(', ')}.`)
  }

  // 7. CheckOff editorial quality — the same deterministic distinctiveness/quoting checks every item must pass, never skipped for a "quick add."
  const distinctiveness = checkDistinctiveExperience(input.body, input.venueName)
  if (!distinctiveness.pass) reasons.push(`Editorial quality: ${distinctiveness.reason}`)
  const quoting = checkVenueQuoted(input.body, input.venueName)
  if (!quoting.pass) reasons.push(`Venue quoting: ${quoting.reason}`)

  // 8. List linkage is the CALLER's responsibility (it needs the real target list id) —
  // this function only certifies the item is ready to be linked; it never links it itself.

  return { candidateName: input.candidateName, verdict: reasons.length === 0 ? 'CERTIFIED' : 'REJECTED', reasons: reasons.length === 0 ? ['All required late-add checks passed.'] : reasons }
}
