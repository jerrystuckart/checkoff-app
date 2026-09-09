// Chief Phase 2Z — canonical venue identity, separate from the raw M3
// discovery label. Root cause of the Vienna run certifying 1/450 items:
// VENUE_QUOTING_GATE was validating against candidate.name (the raw
// discovery label — often a long, compound, parenthetical research
// artifact like "Hofburg Palace Complex (incl. Sisi Museum, Spanish
// Riding School)") instead of the actual clean venue name a natural
// CheckOff sentence would ever quote. The gate itself (checkVenueQuoted
// in editorialDistinctiveness.ts) was never wrong — it's a correct,
// deliberately strict exact-literal-substring check, and stays that way
// (never fuzzy). What was wrong is WHICH string got passed to it.
//
// This module resolves the correct string, pure and deterministic. It
// does not itself call any AI or network — the tiers it prefers (Google
// Places name, a research-verified official name) are supplied by the
// caller, which already has that data; this module's own job is (a) the
// tier-3 fallback (deterministic cleanup of the discovery label — the
// ONLY tier that's a bare transformation of the label, so the only one
// this module can compute standalone) and (b) validating the editor's
// eventual choice against a real, bounded, deterministic option set,
// never a semantic/fuzzy guess.

export interface CanonicalVenueOptions {
  /** The default canonical name — discovery text with parenthetical/bundling annotations stripped. */
  primary: string
  /** Additional distinct venues explicitly bundled into the discovery label (e.g. "(incl. X, Y)") — the editor may use one of these instead of `primary` when the item is really about that specific bundled venue. Empty when the discovery label isn't a bundle. */
  alternatives: string[]
}

const BUNDLE_MARKER_RE = /\((?:incl\.?|including|featuring)\s+([^)]+)\)/i
const ANY_PARENTHETICAL_RE = /\s*\([^)]*\)\s*/g

/**
 * Deterministic cleanup only — never a semantic guess at the "true"
 * minimal official name (that would be exactly the fuzzy matching this
 * fix explicitly must not introduce). Strips parenthetical annotations
 * (bundle markers or otherwise — "Foo Bar (est. 1890)" -> "Foo Bar" too,
 * since research-scaffolding parentheticals aren't limited to bundles)
 * and, when the parenthetical was an explicit "(incl./including/
 * featuring ...)" bundle, extracts each named sub-venue as an
 * alternative. Nothing here infers an official name shorter than what's
 * actually in the label (e.g. it will NOT turn "Hofburg Palace Complex"
 * into "Hofburg" on its own — that requires a verified name from a
 * higher tier; see resolveDefaultCanonicalVenueName).
 */
export function extractCanonicalVenueOptions(discoveryName: string): CanonicalVenueOptions {
  const trimmed = discoveryName.trim()
  const bundleMatch = trimmed.match(BUNDLE_MARKER_RE)
  const primary = trimmed.replace(ANY_PARENTHETICAL_RE, ' ').replace(/\s+/g, ' ').trim()
  const alternatives = bundleMatch
    ? bundleMatch[1]
        .split(/,| and | & /i)
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  return { primary, alternatives }
}

export interface ResolveCanonicalVenueNameInput {
  discoveryName: string
  /** Tier 1 — a verified Google Places canonical business/place name for this exact candidate, when already available (e.g. reused from a prior/cached lookup). */
  placesName?: string | null
  /** Tier 2 — a verified official venue/site name surfaced during research (M3/M5/M6 evidence), when research explicitly identified one distinct from the raw discovery label. */
  researchVenueName?: string | null
}

/**
 * The pre-editorial DEFAULT canonical name: Places name > research-
 * verified name > deterministic cleanup of the discovery label (tier 3).
 * This is a default/hint the editor is given, never a final, unappealable
 * answer for a bundled label — see resolveConfirmedCanonicalVenueName
 * for how the editor's actual choice (which may legitimately be one of
 * the bundle's alternatives instead) gets validated.
 */
export function resolveDefaultCanonicalVenueName(input: ResolveCanonicalVenueNameInput): string {
  if (input.placesName && input.placesName.trim()) return input.placesName.trim()
  if (input.researchVenueName && input.researchVenueName.trim()) return input.researchVenueName.trim()
  return extractCanonicalVenueOptions(input.discoveryName).primary
}

/**
 * Validates the editor's chosen canonical venue name against the real,
 * bounded option set for this candidate (`defaultName` + `alternatives`)
 * — NEVER fuzzy: the choice must equal one of those options exactly
 * (after trim). Returns the confirmed name to certify against, or null
 * when the editor's choice isn't one of the allowed options (a genuine
 * content problem — e.g. the editor invented a name not actually
 * present in the discovery label/bundle — which the caller should treat
 * as a failed editorial attempt, not silently accepted).
 *
 * A MISSING choice (the editor didn't echo one — e.g. an older/other
 * prompt path) falls back to `defaultName` rather than failing, so this
 * stays backward compatible with any caller that doesn't yet collect
 * canonicalVenueUsed.
 */
export function resolveConfirmedCanonicalVenueName(editorChoice: string | undefined | null, defaultName: string, alternatives: readonly string[]): string | null {
  const choice = (editorChoice ?? '').trim()
  if (!choice) return defaultName
  const allowed = [defaultName, ...alternatives].map((n) => n.trim())
  return allowed.includes(choice) ? choice : null
}
