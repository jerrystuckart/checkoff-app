// Item Detail Corrective Pass (2026-09-19) — pure, deterministic view-model
// for the Detail hero's title. Replaces the prior "hero + below-hero
// continuation" scheme (lib/detailTitlePresentation.js, 2026-09-18 pass),
// which showed a portion of the item body inside the hero and rendered the
// REMAINING text as a separate text block BELOW the hero. Physical-device
// screenshots showed this producing an orphaned fragment underneath the
// artwork for real items — e.g. "Try Clara Aue's seasonal Kronländer
// cuisine with French influence, then browse the attached organic" in the
// hero, with "deli at 'Heu & Gabel'" incorrectly continuing below it. A
// title splitting across two disjoint blocks (one inside a photographic
// hero, one in plain page flow) reads as a layout bug regardless of how
// clean the word-boundary split is, so that entire below-hero rendering
// path is removed here — every tier now renders entirely inside the hero.
//
// Strategy: classify the title into a length tier (short/medium/long/
// extreme) by character count, give each tier its own font size, hero
// line allowance, and a documented, FIRM maximum hero height
// (HERO_MAX_HEIGHT_DP) — the long tier's larger line allowance reclaims
// previously-unused hero space (a taller text-safe overlay column) rather
// than spilling text outside the hero. Only the rare "extreme" tier (a
// body that still doesn't fit within the long tier's expanded budget even
// at the smallest acceptable readable font) truncates — with a deliberate,
// explicit ellipsis at a word boundary — and exposes a `fullText` +
// `showFullTextAction` flag so the caller can offer a "Read full thing"
// action opening a modal with the exact, complete original body.
//
// As with the prior pass, no RN render harness exists in this repo (see
// lib/itemDetailRedesign.test.js and its sibling grep-based test files), so
// "does this fit in N lines" can't be answered by actually laying out
// text. This module keeps the same documented, fixed character-budget
// heuristic (an average glyph width against a representative hero
// content-column width) rather than moving to onTextLayout-based
// measurement: a layout-measurement approach would need to converge without
// resize loops/flicker, reset correctly on item/theme/width/orientation/
// font-scale change, and never set state repeatedly with identical values —
// real risks with no render harness in this repo to catch a regression in
// any of them. A pure, deterministic, synchronously-testable heuristic —
// tuned against this pass's two real acceptance fixtures (see
// detailTitlePresentation.test.js) — is safer and sufficient here.
//
// When the extreme tier needs to truncate, the split is always made at a
// word boundary — never an arbitrary character slice that could cut a word
// in half — reusing the same splitAtWordBoundary helper the prior pass
// established, rather than reinventing it.

// Length-tier thresholds (character count) — deterministic and length-
// based, not per-item special-casing, per the explicit product
// requirement. Short/medium boundaries are unchanged from the prior pass.
export const SHORT_TITLE_MAX_CHARS = 50
export const MEDIUM_TITLE_MAX_CHARS = 90

// Reference sizing for the character-budget heuristic — matches the hero's
// own documented sizing comment in ItemDetailScreen.jsx (heroCard: "~350dp
// wide" at typical phone content width) and heroContent's own column width
// (68-74% of the hero).
const HERO_REFERENCE_CONTENT_WIDTH_DP = 350
const HERO_TEXT_COLUMN_WIDTH_RATIO = 0.7
// Average glyph width as a fraction of font size, for this app's bold
// display font (heroTitle is fontWeight: '800') — a standard, documented
// heuristic constant for estimating characters-per-line without an actual
// text-measurement API. Unchanged from the prior pass.
const AVG_GLYPH_WIDTH_FACTOR = 0.56

function estimateCharsPerLine(fontSize) {
  const columnWidthDp = HERO_REFERENCE_CONTENT_WIDTH_DP * HERO_TEXT_COLUMN_WIDTH_RATIO
  return Math.max(1, Math.floor(columnWidthDp / (fontSize * AVG_GLYPH_WIDTH_FACTOR)))
}

// Firm maximum hero height (Goal: "reclaim unused hero space, but stay
// bounded — never consume the whole screen"). The prior pass's long tier
// topped out at 300-320dp; this pass's long tier needs headroom for up to
// 7 readable lines (vs. the prior 4), so the cap grows to 420dp — roughly
// 1.75x the prior pass's short-tier baseline (240dp), and comfortably
// short of a typical phone's usable vertical space. Short/medium tiers
// never approach this cap; only long/extreme do, and never exceed it.
export const HERO_MAX_HEIGHT_DP = 420

// Per-tier font size, hero line allowance, and hero-height hint (dp).
// - short: unchanged from the prior pass — current strong/large
//   typography, no hero growth.
// - medium: a couple of lines of headroom added above the prior pass's
//   4-line baseline, with a modest height bump; font size unchanged (19px
//   already comfortably fits this tier's 90-char ceiling within the added
//   line budget).
// - long: the tier this pass is actually about — font size steps down one
//   notch from the prior pass (17px -> 15px) to fit meaningfully more
//   text per line, and the line allowance nearly doubles (4 -> 7),
//   reclaiming the hero's previously-unused upper-left/left text-safe
//   area (HERO_MAX_HEIGHT_DP) instead of spilling into a continuation.
// - extreme: only reached when a body still doesn't fit within the long
//   tier's own character budget (see classifyTitleTier below) — smallest
//   acceptable readable font, most lines, same firm height cap as long
//   (extreme never grows the hero bigger than long already does).
const TITLE_TIERS = {
  short:   { fontSize: 22, maxLines: 4, heroHeightHint: 240 },
  medium:  { fontSize: 19, maxLines: 5, heroHeightHint: 280 },
  long:    { fontSize: 15, maxLines: 7, heroHeightHint: HERO_MAX_HEIGHT_DP },
  extreme: { fontSize: 13, maxLines: 8, heroHeightHint: HERO_MAX_HEIGHT_DP },
}

// The long tier's character budget, computed (not hand-picked) from the
// same estimateCharsPerLine heuristic used throughout this module, at the
// long tier's own font size and line allowance. This is the threshold that
// decides long-vs-extreme, and it has been validated against this pass's
// two real acceptance fixtures (Heu & Gabel, ~121 chars; Forest Rope Park
// of Kahlenberg, ~148 chars — see detailTitlePresentation.test.js) — both
// land comfortably under this budget, with real margin to spare for
// similar real item bodies, so they render completely in the hero with no
// ellipsis and no "Read full thing" action.
export const LONG_TIER_MAX_CHARS_IN_HERO =
  estimateCharsPerLine(TITLE_TIERS.long.fontSize) * TITLE_TIERS.long.maxLines

// The extreme tier's own character budget — the most text an extreme-tier
// hero will ever show before truncating with an ellipsis.
const EXTREME_TIER_MAX_CHARS_IN_HERO =
  estimateCharsPerLine(TITLE_TIERS.extreme.fontSize) * TITLE_TIERS.extreme.maxLines

export function classifyTitleTier(body) {
  const len = (body ?? '').length
  if (len <= SHORT_TITLE_MAX_CHARS) return 'short'
  if (len <= MEDIUM_TITLE_MAX_CHARS) return 'medium'
  if (len <= LONG_TIER_MAX_CHARS_IN_HERO) return 'long'
  return 'extreme'
}

// Splits `text` at the last word boundary at or before `maxChars`, so the
// returned head never cuts a word in half. Returns the full text as `head`
// with an empty `tail` when it already fits. Reused, unchanged, from the
// prior pass — this is the module's one place that ever slices a string.
function splitAtWordBoundary(text, maxChars) {
  if (text.length <= maxChars) {
    return { head: text, tail: '' }
  }
  let cut = text.lastIndexOf(' ', maxChars)
  if (cut <= 0) {
    // No word boundary found within budget (a single very long word) —
    // fall back to the hard budget rather than showing nothing. This is
    // the only case that can ever slice within a word, and it's an
    // extreme edge case for this app's real content.
    cut = maxChars
  }
  return { head: text.slice(0, cut).trim(), tail: text.slice(cut).trim() }
}

/**
 * @param {string|null|undefined} body  the raw item body (the same string
 *   that renders as the hero title).
 * @returns {{
 *   tier: 'short'|'medium'|'long'|'extreme',
 *   heroLines: string,
 *   heroFontSize: number,
 *   heroLineHeight: number,
 *   heroNumberOfLines: number,
 *   heroHeightHint: number,
 *   showFullTextAction: boolean,
 *   fullText: string,
 *   accessibilityLabel: string,
 * }}
 */
export function deriveTitlePresentation(body) {
  const text = body ?? ''
  const tier = classifyTitleTier(text)
  const { fontSize, maxLines, heroHeightHint } = TITLE_TIERS[tier]

  let heroLines = text
  if (tier === 'extreme') {
    const { head, tail } = splitAtWordBoundary(text, EXTREME_TIER_MAX_CHARS_IN_HERO)
    heroLines = tail ? `${head}…` : head
  }

  return {
    tier,
    heroLines,
    heroFontSize: fontSize,
    heroLineHeight: Math.round(fontSize * 1.3),
    heroNumberOfLines: maxLines,
    heroHeightHint,
    // Only the extreme tier ever needs the "Read full thing" action — every
    // other tier already shows the complete body inside the hero.
    showFullTextAction: tier === 'extreme',
    // The complete, untruncated body — what a "Read full thing" modal must
    // render verbatim, and what heroContent's grouped accessibilityLabel
    // should use, exactly once, regardless of tier.
    fullText: text,
    accessibilityLabel: text,
  }
}
