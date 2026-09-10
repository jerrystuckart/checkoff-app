// agent-service/playbooks/geographicConsistencyAudit.ts
//
// Chief Phase 2AI (2026-09-10, Green Bay neighborhood-collapse incident) —
// a REUSABLE, metro-agnostic audit that compares each item's assigned
// production neighborhood against its own VERIFIED address, and flags any
// case where the assigned neighborhood's registered real municipality
// doesn't appear anywhere in that address.
//
// Root cause this fixes: the Green Bay v2/master package's neighborhood
// assignment was derived from M3/M5's raw, messy, often-wrong free-text
// "neighborhood" label (e.g. "Green Bay, WI" for a candidate whose real,
// geocoded address was actually in Suamico) via a catch-all normalization
// table that defaulted anything unrecognized to "Downtown Green Bay" —
// meaning several venues were silently assigned to the wrong real
// production neighborhood despite their own verified coordinates/address
// clearly placing them elsewhere (Chives Restaurant labeled "Green Bay, WI"
// but geocoded to Suamico; Hinterland/Homefield/National Railroad Museum/
// Odyssey Climbing labeled generically but geocoded to Ashwaubenon).
//
// This module does not itself decide the RIGHT neighborhood — that is
// necessarily metro-specific real-world knowledge (see e.g.
// greenBayNeighborhoodModel.ts's classifyGreenBayNeighborhood). What this
// module DOES, generically, for any future metro: given the final
// candidateName -> assignedNeighborhood -> verified formattedAddress
// triples, and a registry telling it which real municipality name(s) each
// canonical neighborhood belongs to, it flags every item whose assigned
// neighborhood's registered municipality never appears in its own address —
// exactly the class of bug this incident was. A future metro build should
// run this BEFORE packaging, every time, as a required gate — never trust
// that "the last normalization step produced a real production neighborhood
// name" is the same claim as "that name is actually where this venue is."

export interface NeighborhoodMunicipalityRegistry {
  /** Keyed by canonical production neighborhood name. */
  [neighborhoodName: string]: {
    /** Real municipality/city name(s) this neighborhood belongs to — at least one must appear in a verified address for an assignment to that neighborhood to be considered consistent. Multiple aliases cover the case where a rural/reservation address's postal city legitimately differs from its true community (see Oneida in greenBayNeighborhoodModel.ts). */
    municipalityAliases: readonly string[]
  }
}

export interface GeoAuditItemInput {
  candidateName: string
  assignedNeighborhood: string
  /** The item's own real, Google-verified formatted address — never the raw free-text discovery-stage "neighborhood" label. Null/missing is itself flagged (can't verify without one). */
  formattedAddress: string | null
}

export interface GeoAuditFinding {
  candidateName: string
  assignedNeighborhood: string
  formattedAddress: string | null
  reason: string
}

export interface GeographicConsistencyAuditResult {
  verdict: 'PASS' | 'FAIL'
  findings: GeoAuditFinding[]
  reason: string
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function addressMentionsMunicipality(address: string, municipality: string): boolean {
  const pattern = new RegExp(`\\b${escapeForRegex(municipality)}\\b`, 'i')
  return pattern.test(address)
}

/**
 * Fails CLOSED on two distinct problems, both reported as findings:
 *   1. `assignedNeighborhood` isn't in the registry at all — an unknown/
 *      invented neighborhood name reaching packaging, never silently
 *      accepted.
 *   2. `assignedNeighborhood` IS in the registry, but the item's own
 *      verified formattedAddress never mentions any of that neighborhood's
 *      registered real municipality names — the exact Green Bay
 *      incident's signature (assigned to a Green Bay neighborhood, address
 *      says Suamico/Ashwaubenon/etc.).
 * A missing/null formattedAddress is flagged as its own (lower-severity,
 * but still reported) finding — "cannot verify" is never treated as
 * "verified clean."
 */
export function evaluateGeographicConsistencyAudit(items: readonly GeoAuditItemInput[], registry: NeighborhoodMunicipalityRegistry): GeographicConsistencyAuditResult {
  const findings: GeoAuditFinding[] = []

  for (const item of items) {
    const entry = registry[item.assignedNeighborhood]
    if (!entry) {
      findings.push({ candidateName: item.candidateName, assignedNeighborhood: item.assignedNeighborhood, formattedAddress: item.formattedAddress, reason: `"${item.assignedNeighborhood}" is not a recognized canonical neighborhood for this metro.` })
      continue
    }
    if (!item.formattedAddress) {
      findings.push({ candidateName: item.candidateName, assignedNeighborhood: item.assignedNeighborhood, formattedAddress: null, reason: 'No verified formatted address available to confirm this assignment — cannot verify, not treated as clean.' })
      continue
    }
    const matches = entry.municipalityAliases.some((alias) => addressMentionsMunicipality(item.formattedAddress as string, alias))
    if (!matches) {
      findings.push({
        candidateName: item.candidateName,
        assignedNeighborhood: item.assignedNeighborhood,
        formattedAddress: item.formattedAddress,
        reason: `Assigned to "${item.assignedNeighborhood}" (registered municipality: ${entry.municipalityAliases.join(' or ')}), but the verified address "${item.formattedAddress}" does not mention it — real municipality/community mismatch.`,
      })
    }
  }

  return {
    verdict: findings.length === 0 ? 'PASS' : 'FAIL',
    findings,
    reason: findings.length === 0 ? `All ${items.length} item(s) have an assigned neighborhood consistent with their own verified address.` : `${findings.length}/${items.length} item(s) show a neighborhood/address mismatch: ${findings.map((f) => f.candidateName).join(', ')}`,
  }
}
