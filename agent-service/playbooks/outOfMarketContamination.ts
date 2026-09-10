// agent-service/playbooks/outOfMarketContamination.ts
//
// Chief Phase 2AH — OUT_OF_MARKET_CONTAMINATION_GATE. Direct response to
// a real incident (2026-09-10): a Green Bay, WI metro build's targeted
// gap-research stage (M5) was handed SAN_DIEGO_GEOGRAPHIC_DEPTH_TARGETS
// as its silent CLI default (no --geo-depth-plan supplied for the actual
// metro being built), which literally instructed the real, live OpenAI
// web-research call to "find candidates in Carlsbad" / "Oceanside" /
// "Chula Vista" / "Coronado" for a project named green_bay_wisconsin. The
// model dutifully complied and returned real San Diego-area venues
// (Agua Hedionda Lagoon & Discovery Center, Batiquitos Lagoon, Chula
// Vista Bayfront & Harbor District, Downtown Chula Vista), which then
// passed every existing gate (CATALOG_GATE, LOCATION_GATE, editorial,
// distinctiveness, tags, metadata, even GEO_ENRICHMENT_GATE) because none
// of them ever asked "does this venue's own geography actually belong to
// the metro being built?" — every existing gate checks internal
// consistency (is this candidate well-formed, distinctive, quoted,
// tagged, geocoded) but never cross-checks the candidate's real-world
// location against the metro's intended market. This module is that
// missing check.
//
// Root-cause fix (see agent-service/cli.ts and
// agent-service/playbooks/defaultMetroManifest.ts) removes San Diego as
// an implicit default so this exact mechanism can never recur. This gate
// is the required SECOND, independent line of defense — Jerry's explicit
// instruction: "A catalog containing venues from an unrelated metro must
// fail closed," evaluated twice (once before catalog certification —
// M8_BATCH_CERTIFICATION — and once again immediately before production
// SQL generation — M9_HOME_LIST_MIRROR — see metroLaunchDriver.ts).
//
// Pure logic only — no DB access, no AI calls, no network calls.

/**
 * Known anchor place names for metros already built or in progress in
 * this codebase, keyed by the metro's own `metro_areas.slug` (or the CLI
 * project-key convention where the two differ, e.g. `san_diego`/
 * `san-diego`). This is a REGISTRY, not a geocoding service: it exists so
 * a candidate whose body/address mentions a place name that is a KNOWN
 * anchor of a DIFFERENT metro can be caught deterministically, without
 * requiring a live geocoding call for every candidate on every run. It
 * grows as more real metros are built — it is never meant to be
 * exhaustive of the whole country, only of the metros this codebase has
 * actually touched (where a real contamination incident is possible: a
 * stale default, a copy-pasted plan file, a targeted-research prompt
 * that leaked another metro's project key/geography into its objective
 * text).
 *
 * IMPORTANT: entries here are never used to positively confirm a
 * candidate belongs to ITS OWN metro (a real Vienna item mentioning
 * "Vienna" is expected and fine) — `evaluateOutOfMarketContaminationGate`
 * skips the target metro's own key entirely. They are only ever used to
 * flag a candidate as belonging to a DIFFERENT, already-known metro.
 */
/**
 * Deliberately EXCLUDES each metro's own bare city name (no "San Diego",
 * no "Vienna", no "Milwaukee", no "Denver", no "Phoenix") — those are too
 * collision-prone to use as anchors at all: a raw mapsQuery/formatted-
 * address echo, a passing reference, or a real-project-key naming
 * convention that doesn't literally embed the registry key as a prefix
 * (found the hard way: a test project key "vienna-m85-geo-selective-drop"
 * building real Vienna content has NO reliable string relationship to
 * the registry key "vienna-austria") can all trip a same-name false
 * positive that has nothing to do with real contamination. Every entry
 * below is instead a genuinely DISTINCTIVE neighborhood/suburb name for
 * that metro — one that legitimately appearing in a DIFFERENT metro's
 * catalog is real evidence of contamination, not a naming coincidence.
 */
export const KNOWN_METRO_ANCHOR_PLACE_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'san-diego': [
    'Carlsbad',
    'Oceanside',
    'Chula Vista',
    'Coronado',
    'La Jolla',
    'Encinitas',
    'National City',
    'Escondido',
    'Poway',
    'Imperial Beach',
    'Solana Beach',
    'Batiquitos',
    'Agua Hedionda',
    'Balboa Park',
    'Point Loma',
    'Pacific Beach',
    'Gaslamp Quarter',
    'Barrio Logan',
    'Hillcrest',
    'Mission Beach',
  ],
  milwaukee: ['Wauwatosa', 'Shorewood', 'Bay View', "Walker's Point", 'Brady Street'],
  denver: ['Boulder', 'Longmont', 'Nederland', 'Eldora'],
  phoenix: ['Scottsdale', 'Tempe', 'Chandler', 'Gilbert', 'Mesa', 'Ahwatukee', 'Willcox'],
  // Vienna deliberately has NO entry here yet: this codebase's own test
  // suite legitimately builds many different Vienna project-key variants
  // (vienna-austria-dry-run, vienna-m85-..., vienna-m9-..., etc.) that
  // reference real Vienna landmarks under project keys with no reliable
  // string relationship to a single "vienna-austria" registry key —
  // adding one produced exactly the kind of same-metro false positive
  // this registry exists to avoid (found via a real test failure,
  // 2026-09-10). Add a real entry once Vienna has a single, stable,
  // reliably-matchable production slug used consistently everywhere this
  // registry would need to recognize it as "home."
})

export interface OutOfMarketCandidate {
  /** The candidate's identity for reporting — usually the venue/candidate name, never re-derived from body text here. */
  candidateName: string
  body: string
  formattedAddress?: string | null
}

export interface OutOfMarketTargetMetro {
  /** The metro actually being built — its own key is always exempt from the anchor-name check (a real Vienna item may legitimately say "Vienna"). Matched case-insensitively against KNOWN_METRO_ANCHOR_PLACE_NAMES' keys. */
  slug: string
  /** Two-letter US state code (or equivalent region code) this metro's real production items should resolve to, when a formatted_address with a parseable state/region is available. Optional — omit for a metro where this check doesn't apply (e.g. no US state, like Vienna). */
  state?: string
}

export interface OutOfMarketViolation {
  candidateName: string
  reason: string
  matchedAnchor: string
  matchedMetro: string
}

export interface OutOfMarketContaminationResult {
  verdict: 'PASS' | 'FAIL'
  violations: OutOfMarketViolation[]
  reason: string
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-word/phrase match, case-insensitive — "Denver" must not match inside a longer unrelated word, and multi-word anchors ("Chula Vista") match as a phrase, not per-word. */
function containsAnchor(haystack: string, anchor: string): boolean {
  if (!haystack) return false
  const pattern = new RegExp(`\\b${escapeForRegex(anchor)}\\b`, 'i')
  return pattern.test(haystack)
}

/** Extracts a trailing US-style state code from a formatted address like "1265 Lombardi Ave, Green Bay, WI 54304, USA" — returns null when no such pattern is present (non-US address, or a formatted_address shape this heuristic doesn't recognize; never treated as a violation on its own). */
function extractUsStateCode(formattedAddress: string): string | null {
  const match = formattedAddress.match(/,\s*([A-Z]{2})\s+\d{5}(-\d{4})?(,|$)/)
  return match ? match[1] : null
}

/**
 * The gate itself. Checks every candidate against:
 *   1. KNOWN_METRO_ANCHOR_PLACE_NAMES — does the body or formatted
 *      address mention a place name that is a known anchor of a
 *      DIFFERENT, already-registered metro?
 *   2. State/region mismatch — when a formatted_address is available and
 *      carries a parseable US state code, does it match the target
 *      metro's expected state?
 *
 * Fails CLOSED: any violation is a FAIL, no partial credit, no
 * auto-repair path (see metroLaunchDriver.ts's stepM8_5CatalogPruning —
 * a contaminated candidate is always dropped, never rewritten "in
 * market," since there's no legitimate way to relocate a real venue).
 */
/** Normalizes a slug/project-key to bare lowercase alphanumeric for loose comparison — "vienna-austria-dry-run", "vienna_austria", and "vienna-austria" must all be recognized as the same metro identity, since real project keys often carry a task-specific suffix (a test run, a "-dry-run"/"-repair" cycle) beyond the metro's own slug. */
function normalizeMetroKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** True when `targetKey` is genuinely the same metro identity as `registryKey` — exact match, or one is a prefix of the other (covers "<slug>-dry-run", "<slug>_test", "<slug>-category-normalized-pass-test", etc.) after normalization. Deliberately loose in the "IS this metro" direction only — it only ever widens which candidates are EXEMPTED from a check, never widens which OTHER metro's anchors get flagged. */
function isSameMetroIdentity(targetKey: string, registryKey: string): boolean {
  const a = normalizeMetroKey(targetKey)
  const b = normalizeMetroKey(registryKey)
  if (!a || !b) return false
  return a === b || a.startsWith(b) || b.startsWith(a)
}

export function evaluateOutOfMarketContaminationGate(input: { targetMetro: OutOfMarketTargetMetro; candidates: readonly OutOfMarketCandidate[] }): OutOfMarketContaminationResult {
  const targetKey = input.targetMetro.slug.trim().toLowerCase()
  const violations: OutOfMarketViolation[] = []

  for (const candidate of input.candidates) {
    const haystacks = [candidate.body, candidate.formattedAddress ?? ''].filter(Boolean)

    for (const [metroKey, anchors] of Object.entries(KNOWN_METRO_ANCHOR_PLACE_NAMES)) {
      if (isSameMetroIdentity(targetKey, metroKey)) continue // never flag a metro's own legitimate anchor names, including test/dry-run project-key variants of it
      for (const anchor of anchors) {
        if (haystacks.some((h) => containsAnchor(h, anchor))) {
          violations.push({
            candidateName: candidate.candidateName,
            matchedAnchor: anchor,
            matchedMetro: metroKey,
            reason: `mentions "${anchor}", a known ${metroKey} place name, but the target metro is "${input.targetMetro.slug}"`,
          })
          break // one violation per (candidate, metroKey) is enough to report; don't spam every matching anchor in the same other-metro's list
        }
      }
    }

    if (input.targetMetro.state && candidate.formattedAddress) {
      const foundState = extractUsStateCode(candidate.formattedAddress)
      if (foundState && foundState !== input.targetMetro.state) {
        violations.push({
          candidateName: candidate.candidateName,
          matchedAnchor: foundState,
          matchedMetro: 'unknown',
          reason: `formatted_address resolves to state "${foundState}", which does not match the target metro's expected state "${input.targetMetro.state}"`,
        })
      }
    }
  }

  const verdict: 'PASS' | 'FAIL' = violations.length === 0 ? 'PASS' : 'FAIL'
  return {
    verdict,
    violations,
    reason:
      verdict === 'PASS'
        ? `0/${input.candidates.length} candidate(s) show any known-other-metro or state-mismatch signal.`
        : `${violations.length} candidate(s) show a real out-of-market signal: ${violations.map((v) => `${v.candidateName} (${v.reason})`).join('; ')}`,
  }
}

/** Adapts evaluateOutOfMarketContaminationGate's result to the shared StagingGateResult shape (metroCatalog.ts) so it plugs directly into the same gates[] array every other M8/M10 gate uses. */
export function evaluateOutOfMarketContaminationStagingGate(input: { targetMetro: OutOfMarketTargetMetro; candidates: readonly OutOfMarketCandidate[] }): { key: 'OUT_OF_MARKET_CONTAMINATION_GATE'; verdict: 'PASS' | 'FAIL'; reason: string } {
  const result = evaluateOutOfMarketContaminationGate(input)
  return { key: 'OUT_OF_MARKET_CONTAMINATION_GATE', verdict: result.verdict, reason: result.reason }
}
