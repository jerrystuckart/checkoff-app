// agent-service/playbooks/metroTagCertification.ts
//
// Chief Phase 2U — permanent metro-catalog tag certification, converted
// from a real San Diego production incident: the metro launched with
// ZERO tags on every item, and Jerry had to catch it manually. That can
// never happen again — this gate is now a required, hard-failing part of
// METRO_LAUNCH_CERTIFICATION.
//
// Distinct from itemIntake.ts's validateTagSelection(), which enforces
// the STRICTER exactly-8 (5 tier-1 + 3 tier-2) rule for the individual
// phone/ChatGPT Item Intake flow — that methodology is retained as-is,
// unchanged, per explicit instruction. This module governs the metro
// CATALOG build instead, where the rule is a range: 6-8 tags per item,
// preferring 8 when 8 are genuinely relevant, never padded with filler
// to hit a number.
//
// Same never-invent-a-tag discipline as itemIntake.ts: this module has
// NO DB access of its own. The canonical tag vocabulary is always
// supplied by the caller (a live `SELECT name FROM public.tags` result,
// or — when live verification is unavailable — the current verified
// canonical tag snapshot). As of 2026-09-07, the agent_service DB role
// does NOT have SELECT on public.tags (confirmed via a live permission-
// denied error) — either grant it, or Jerry must supply a fresh export
// before each metro build. This module refuses to fabricate a
// vocabulary on its own; there is deliberately no hardcoded tag list
// anywhere in this file.

import type { StagingGateResult } from './metroCatalog'

export const MIN_TAGS_PER_ITEM = 6
export const MAX_TAGS_PER_ITEM = 8

export interface ItemTagProposal {
  candidateName: string
  tags: string[]
}

export interface ItemTagValidation {
  candidateName: string
  valid: boolean
  tagCount: number
  unknownNames: string[]
  issues: string[]
}

/**
 * Validates ONE item's proposed tags against the real, caller-supplied
 * canonical vocabulary. Never singularizes/pluralizes/normalizes a name
 * to try to make it match — an exact-string miss (the real San Diego
 * lesson: "cocktails" exists in production, "cocktail" did not) is a
 * hard failure, not something this module silently corrects.
 */
export function validateItemTags(proposal: ItemTagProposal, knownRealTagNames: ReadonlySet<string>): ItemTagValidation {
  const issues: string[] = []
  const unknownNames = proposal.tags.filter((t) => !knownRealTagNames.has(t))
  if (unknownNames.length > 0) {
    issues.push(`unknown tag name(s), not present in the canonical vocabulary (never auto-corrected/singularized/pluralized): ${unknownNames.join(', ')}`)
  }

  const uniqueTags = new Set(proposal.tags)
  if (uniqueTags.size !== proposal.tags.length) {
    issues.push('duplicate tag name(s) within the same item')
  }

  if (proposal.tags.length < MIN_TAGS_PER_ITEM) {
    issues.push(`only ${proposal.tags.length} tag(s) — minimum is ${MIN_TAGS_PER_ITEM}`)
  } else if (proposal.tags.length > MAX_TAGS_PER_ITEM) {
    issues.push(`${proposal.tags.length} tag(s) — maximum is ${MAX_TAGS_PER_ITEM}`)
  }

  return {
    candidateName: proposal.candidateName,
    valid: issues.length === 0,
    tagCount: proposal.tags.length,
    unknownNames,
    issues,
  }
}

export interface TagCertificationResult {
  gate: StagingGateResult
  perItem: ItemTagValidation[]
}

/**
 * The full-catalog certification gate. Fails closed on an empty set
 * (mirrors CATALOG_GATE's own convention) and on ANY single item outside
 * the 6-8 range or referencing an unknown tag name — a metro cannot
 * certify with even one under/over-tagged or invented-tag item.
 */
export function evaluateTagCertificationGate(proposals: readonly ItemTagProposal[], knownRealTagNames: ReadonlySet<string>): TagCertificationResult {
  if (proposals.length === 0) {
    return { gate: { key: 'TAG_CERTIFICATION_GATE', verdict: 'FAIL', reason: 'No items were evaluated — this gate cannot pass on an empty catalog.' }, perItem: [] }
  }
  const perItem = proposals.map((p) => validateItemTags(p, knownRealTagNames))
  const failures = perItem.filter((r) => !r.valid)
  if (failures.length > 0) {
    return {
      gate: {
        key: 'TAG_CERTIFICATION_GATE',
        verdict: 'FAIL',
        reason: `${failures.length}/${proposals.length} item(s) failed tag certification (every item must carry ${MIN_TAGS_PER_ITEM}-${MAX_TAGS_PER_ITEM} canonical tags, never fewer, never more, never invented/singularized/pluralized): ${failures.map((f) => `${f.candidateName} (${f.issues.join('; ')})`).join(' | ')}`,
      },
      perItem,
    }
  }
  const avgTags = perItem.reduce((sum, r) => sum + r.tagCount, 0) / perItem.length
  return {
    gate: {
      key: 'TAG_CERTIFICATION_GATE',
      verdict: 'PASS',
      reason: `All ${proposals.length} items carry ${MIN_TAGS_PER_ITEM}-${MAX_TAGS_PER_ITEM} valid canonical tags (avg ${avgTags.toFixed(1)}/item) — no unknown/invented tag names, no duplicates.`,
    },
    perItem,
  }
}
