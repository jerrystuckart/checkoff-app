// Chief Phase 3B — partnerPotential (Vienna post-mortem, item 2).
//
// Food & drink and Bar & drinks businesses are strategically valuable
// beyond their editorial merit: they are the businesses most likely to
// care about CheckOff-attributed traffic, display a "What's Good Here?"
// QR, promote a specific order, and become future Featured/paid
// partners. This module gives Winston a deterministic, code-side way to
// notice that likelihood — it is an ADVISORY signal only.
//
// EXPLICIT NON-GOAL: partnerPotential must never determine whether an
// item is good enough to BE in CheckOff. Editorial quality (the
// distinctive-experience gate, venue quoting, factual fidelity) remains
// the only thing that decides inclusion. This score exists solely so
// that when two otherwise-strong candidates compete for a limited
// coverage slot (e.g. a CATEGORY_OVERREPRESENTED cap, or a flagship-list
// seat), Winston can give a small nod to the one more likely to become a
// real business relationship. Never surfaced to Jerry as "this replaces
// editorial judgment," and never used to relax any certification gate.

import type { RealDbCategory } from './metroCatalog'

export interface PartnerPotentialSignal {
  key: string
  detail: string
}

export interface PartnerPotentialEvaluation {
  /** 0 (no signal) to 3 (strong, multi-signal partner candidate) — never used as a pass/fail gate. */
  score: number
  signals: PartnerPotentialSignal[]
  /** Deliberately explicit, so no caller can mistake this for an editorial verdict. */
  isAdvisoryOnly: true
}

/**
 * Categories where partner potential is even worth evaluating — matches
 * the Vienna post-mortem's own framing (Food & drink, Bar & drinks are
 * the named strategic categories; Shopping's independent/maker retail
 * can carry the same dynamic). Every other category always scores 0 —
 * this is intentionally narrow, not a general "is this a good business"
 * heuristic.
 */
const ELIGIBLE_CATEGORIES: ReadonlySet<RealDbCategory> = new Set(['Food & drink', 'Bar & drinks', 'Shopping'])

interface BodySignalPattern {
  key: string
  regex: RegExp
  detail: string
}

// Each pattern is a genuine, checkable textual signal from the item's
// own certified body — never inferred from category/tags alone, so a
// generic "restaurant" item with no distinctive purchasable hook scores
// 0 even though its category is eligible.
const BODY_SIGNAL_PATTERNS: readonly BodySignalPattern[] = [
  { key: 'SIGNATURE_ITEM', regex: /\bsignature\b/i, detail: 'body names a signature dish/drink' },
  { key: 'TASTING_OR_FLIGHT', regex: /\b(tasting|flight)\b/i, detail: 'body describes a tasting or flight' },
  { key: 'STAFF_GUIDED', regex: /\b(bartender|staff|barista|sommelier|chef)[\s-]*(built|guided|chosen|picks?|recommend|curat)/i, detail: 'body describes a staff-guided choice' },
  { key: 'ORDERING_RITUAL', regex: /\b(ask for|order the|off-menu|secret menu|hidden menu|by asking)\b/i, detail: 'body describes an unusual ordering ritual or off-menu ask' },
  { key: 'SPECIFIC_PURCHASABLE', regex: /\b(order|try|get)\s+(the|a|an)\s+['"]?[A-Z]/, detail: 'body names one specific purchasable item' },
]

/**
 * Pure, deterministic. Never called during editorial certification
 * itself — this is a post-certification enrichment, computed once a
 * dbCategory and finalBody already exist (see
 * stepM8BatchCertification's dbCategory resolution, which this reuses).
 */
export function evaluatePartnerPotential(input: { dbCategory: RealDbCategory | null; body: string | null; tags: readonly string[] }): PartnerPotentialEvaluation {
  const signals: PartnerPotentialSignal[] = []

  if (!input.dbCategory || !ELIGIBLE_CATEGORIES.has(input.dbCategory)) {
    return { score: 0, signals, isAdvisoryOnly: true }
  }

  const body = input.body ?? ''
  for (const pattern of BODY_SIGNAL_PATTERNS) {
    if (pattern.regex.test(body)) signals.push({ key: pattern.key, detail: pattern.detail })
  }

  const tagLower = new Set(input.tags.map((t) => t.toLowerCase()))
  const partnerFriendlyTags = ['independent', 'local-favorite', 'hidden-gem', 'family-owned', 'owner-operated']
  const matchedTag = partnerFriendlyTags.find((t) => tagLower.has(t))
  if (matchedTag) signals.push({ key: 'PARTNER_FRIENDLY_TAG', detail: `carries the "${matchedTag}" tag (independent/owner-driven business)` })

  // Score bands: 0 = not eligible or no signal, 1 = one signal, 2 = two
  // signals, 3 = three or more — a coarse, honest count, never a
  // manufactured "advertising directory" ranking.
  const score = Math.min(3, signals.length)
  return { score, signals, isAdvisoryOnly: true }
}

/**
 * Advisory tie-break helper — used ONLY when a caller has already
 * decided two candidates are editorially comparable (e.g. both cleared
 * every quality gate, and the choice is which one fills a capped
 * coverage slot). Never call this to decide whether either candidate is
 * good enough on its own.
 */
export function preferHigherPartnerPotential(a: { score: number }, b: { score: number }): -1 | 0 | 1 {
  if (a.score === b.score) return 0
  return a.score > b.score ? -1 : 1
}
