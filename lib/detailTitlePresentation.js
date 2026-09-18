// Item Detail Corrective Pass (2026-09-18) — pure, deterministic view-model
// for the Detail hero's title. Replaces the prior `numberOfLines={2}` /
// HERO_VENUE_OVERFLOW_THRESHOLD scheme (screens/ItemDetailScreen.jsx,
// pre-2026-09-18), which truncated real item bodies mid-word/mid-thought
// (e.g. "Find the door disguised as a painti…") — the item body IS the
// product, so losing its point was a real, serious UX bug, not a cosmetic
// one.
//
// Strategy: classify the title into a length tier (short/medium/long) by
// character count, give each tier its own font size and hero-height hint
// (consistent with this app's existing type scale — see heroTitle's prior
// 21px and primaryDoneBtnText's 16px in screens/ItemDetailScreen.jsx), and
// allow up to 4 lines inside the hero at that tier's font size. Because no
// RN render harness exists in this repo (see lib/itemDetailRedesign.test.js
// and its sibling grep-based test files), the "does this fit in N lines"
// question can't be answered by actually laying out text — instead this
// module uses a documented, fixed character-budget heuristic (an average
// glyph width against a representative hero content-column width) to
// decide, deterministically, whether the full body fits inside the hero's
// 4-line budget or needs to spill into a below-hero continuation. The
// heuristic's constants are deliberately conservative (biased toward
// wrapping to a continuation rather than risking a real ellipsis-truncated
// render), because a slightly-early continuation split is a fully visible,
// harmless cosmetic choice, while text actually clipped by RN's
// numberOfLines+ellipsizeMode is exactly the bug this module exists to
// prevent.
//
// When a body doesn't fit, the split is always made at a word boundary —
// never an arbitrary character slice that could cut a word (and never a
// venue name) in half — so the hero's shown text and the continuation's
// remaining text are two disjoint, word-clean halves of the exact same
// original string, and neither ellipsis nor duplicated words ever appear.

// Length-tier thresholds (character count) — deterministic and
// length-based, not per-item special-casing, per the explicit product
// requirement. Chosen so the large majority of real item bodies (which run
// well under 50 characters) get the strongest, most legible display size,
// while unusually long bodies degrade gracefully rather than clipping.
export const SHORT_TITLE_MAX_CHARS = 50
export const MEDIUM_TITLE_MAX_CHARS = 90

// Per-tier font size (matches/extends this app's existing type scale —
// heroTitle was 21px pre-pass; primaryDoneBtnText/primaryPhotoBtnText sit
// at 15-16px, inviteTitle at 18px) and hero-height hint (dp). "Typical"
// heights stay within the ~230-260dp band the task specifies; the "long"
// tier's own normal-case height (no continuation needed) tops out at
// 300dp, and only a title that still doesn't fit even at that tier's font
// size within 4 lines (i.e. needs a continuation) grows to the 320dp max.
const TITLE_TIERS = {
  short:  { fontSize: 22, heroHeightHint: 240 },
  medium: { fontSize: 19, heroHeightHint: 260 },
  long:   { fontSize: 17, heroHeightHint: 300 },
}

export const HERO_TITLE_MAX_LINES = 4
export const HERO_CONTINUATION_HEIGHT_HINT = 320

// Reference sizing for the character-budget heuristic below — matches the
// hero's own documented sizing comment in ItemDetailScreen.jsx (heroCard:
// "~350dp wide" at typical phone content width) and heroContent's own
// column width (68-74% of the hero, per Goal 2's explicit band).
const HERO_REFERENCE_CONTENT_WIDTH_DP = 350
const HERO_TEXT_COLUMN_WIDTH_RATIO = 0.7
// Average glyph width as a fraction of font size, for this app's bold
// display font (heroTitle is fontWeight: '800') — a standard, documented
// heuristic constant for estimating characters-per-line without an actual
// text-measurement API.
const AVG_GLYPH_WIDTH_FACTOR = 0.56

function estimateCharsPerLine(fontSize) {
  const columnWidthDp = HERO_REFERENCE_CONTENT_WIDTH_DP * HERO_TEXT_COLUMN_WIDTH_RATIO
  return Math.max(1, Math.floor(columnWidthDp / (fontSize * AVG_GLYPH_WIDTH_FACTOR)))
}

export function classifyTitleTier(body) {
  const len = (body ?? '').length
  if (len <= SHORT_TITLE_MAX_CHARS) return 'short'
  if (len <= MEDIUM_TITLE_MAX_CHARS) return 'medium'
  return 'long'
}

// Splits `text` at the last word boundary at or before `maxChars`, so
// neither half ever cuts a word in half. Returns the full text as `head`
// with an empty `tail` when it already fits.
function splitAtWordBoundary(text, maxChars) {
  if (text.length <= maxChars) {
    return { head: text, tail: '' }
  }
  let cut = text.lastIndexOf(' ', maxChars)
  if (cut <= 0) {
    // No word boundary found within budget (a single very long word) —
    // fall back to the hard budget rather than showing nothing, but this
    // is the only case that can ever slice within a word, and it's an
    // extreme edge case for this app's real content.
    cut = maxChars
  }
  return { head: text.slice(0, cut).trim(), tail: text.slice(cut).trim() }
}

/**
 * @param {string|null|undefined} body  the raw item body (the same string
 *   that used to render, clipped, as the hero title).
 * @returns {{
 *   tier: 'short'|'medium'|'long',
 *   heroLines: string,
 *   continuationText: string,
 *   hasContinuation: boolean,
 *   heroFontSize: number,
 *   heroLineHeight: number,
 *   heroNumberOfLines: number,
 *   heroHeightHint: number,
 *   accessibilityLabel: string,
 * }}
 */
export function deriveTitlePresentation(body) {
  const text = body ?? ''
  const tier = classifyTitleTier(text)
  const { fontSize, heroHeightHint } = TITLE_TIERS[tier]
  const maxCharsInHero = estimateCharsPerLine(fontSize) * HERO_TITLE_MAX_LINES

  const { head, tail } = splitAtWordBoundary(text, maxCharsInHero)
  const hasContinuation = tail.length > 0

  return {
    tier,
    heroLines: head,
    continuationText: tail,
    hasContinuation,
    heroFontSize: fontSize,
    heroLineHeight: Math.round(fontSize * 1.25),
    heroNumberOfLines: HERO_TITLE_MAX_LINES,
    heroHeightHint: hasContinuation ? HERO_CONTINUATION_HEIGHT_HINT : heroHeightHint,
    // The complete, untruncated body — this is what heroContent's grouped
    // accessibilityLabel should use, exactly once, regardless of how the
    // visible text is split between the hero and its continuation.
    accessibilityLabel: text,
  }
}
