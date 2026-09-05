// Chief — deterministic geographic scope filtering (structural fix, found
// during the first real Tijuana cross-border extension run: the M0
// geographicScope decision explicitly restricted candidates to Tijuana,
// but 28 of 66 raw candidates (42%) were San Diego-side content or
// outright off-topic noise — the model's own scope adherence was weak.
// Isolating Tijuana into its own project (a separate driver run/project
// key) already prevented that leakage from ever reaching the San Diego
// project's own coverage audit; THIS filter is the second, narrower
// layer: reject a candidate from a project's own pool when its verified
// geography doesn't match that project's configured scope, before
// coverage counting/verification ever sees it.
//
// Deliberately simple and deterministic (never a second AI call) — a
// candidate's neighborhood/name text is checked against an allow-list of
// keywords the project's own scope is actually about. A candidate that
// matches none of them is out of scope; ambiguous cases are still
// rejected (never guessed into scope) since being over-strict here just
// means the M5 gap loop researches a genuine replacement, while being
// under-strict re-admits exactly the contamination this exists to catch.

export interface ScopeFilterResult<T> {
  inScope: T[]
  outOfScope: Array<{ candidate: T; reason: string }>
}

/**
 * `scopeKeywords` should name the actual place(s) the project covers
 * (e.g. ["Tijuana", "Zona Centro", "Zona Río", "Zona Norte", "Playas de
 * Tijuana", "Revolución", "Otay"]) — deliberately specific rather than a
 * single country/city name, since "San Diego" itself sometimes appears
 * inside an otherwise-relevant Tijuana candidate's text (e.g. "near the
 * San Diego border") without that candidate actually being San Diego-side.
 * `exclusionKeywords` are an extra denylist checked FIRST — for phrases
 * that are unambiguous tells of contamination regardless of scope-keyword
 * overlap (e.g. a candidate literally named after a San Diego
 * neighborhood with no Tijuana keyword at all still needs a way to be
 * caught even if it mentions "border").
 */
export function filterCandidatesByGeographicScope<T extends { name: string; neighborhood?: string | null }>(
  candidates: readonly T[],
  scopeKeywords: readonly string[],
  exclusionKeywords: readonly string[] = []
): ScopeFilterResult<T> {
  const scopeLower = scopeKeywords.map((k) => k.toLowerCase())
  const exclusionLower = exclusionKeywords.map((k) => k.toLowerCase())

  const inScope: T[] = []
  const outOfScope: Array<{ candidate: T; reason: string }> = []

  for (const candidate of candidates) {
    const haystack = `${candidate.name} ${candidate.neighborhood ?? ''}`.toLowerCase()

    const excludedHit = exclusionLower.find((k) => haystack.includes(k))
    if (excludedHit) {
      outOfScope.push({ candidate, reason: `matched exclusion keyword "${excludedHit}"` })
      continue
    }

    const inScopeHit = scopeLower.some((k) => haystack.includes(k))
    if (!inScopeHit) {
      outOfScope.push({ candidate, reason: 'no configured scope keyword found in name/neighborhood — ambiguous cases are rejected, never guessed into scope' })
      continue
    }

    inScope.push(candidate)
  }

  return { inScope, outOfScope }
}
