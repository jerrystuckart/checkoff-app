import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeRailCardWidth, railAccentForIndex, RAIL_CARD_WIDTH_RATIO, RAIL_ACCENT_KEYS } from './whatsGoodRailLayout.js'

const COLORS = { AMBER: '#F5A623', GREEN: '#1D9E75', ENDED_TEXT: '#7A4DB3', TEXT: '#243045' }

// ── computeRailCardWidth ─────────────────────────────────────────────────
test('card width is ~80% of the content width, leaving an obvious peek of the next card', () => {
  const windowWidth = 390 // iPhone 14/15 width
  const width = computeRailCardWidth(windowWidth, 16)
  const contentWidth = windowWidth - 32
  assert.equal(width, Math.round(contentWidth * RAIL_CARD_WIDTH_RATIO))
  // The peek: content width minus one card width must leave a visible sliver.
  const peek = contentWidth - width
  assert.ok(peek > 40, `peek of ${peek}px is too subtle to read as "swipeable"`)
  assert.ok(width < contentWidth, 'card must be narrower than the full content width')
})

test('card width respects a custom ratio when given one', () => {
  const width = computeRailCardWidth(400, 16, 0.5)
  assert.equal(width, Math.round((400 - 32) * 0.5))
})

test('card width scales sensibly across common device widths', () => {
  for (const windowWidth of [360, 390, 428, 768]) { // small/typical/large phone, tablet
    const width = computeRailCardWidth(windowWidth, 16)
    assert.ok(width > 0 && width < windowWidth, `width ${width} must be positive and smaller than the window at ${windowWidth}`)
  }
})

// ── railAccentForIndex ───────────────────────────────────────────────────
test('accent cycles deterministically through the three palette keys by index', () => {
  assert.equal(railAccentForIndex(0, COLORS, false), COLORS.AMBER)
  assert.equal(railAccentForIndex(1, COLORS, false), COLORS.GREEN)
  assert.equal(railAccentForIndex(2, COLORS, false), COLORS.ENDED_TEXT)
})

test('accent wraps around for an index beyond the 3 known slots', () => {
  assert.equal(railAccentForIndex(3, COLORS, false), COLORS.AMBER)
  assert.equal(railAccentForIndex(4, COLORS, false), COLORS.GREEN)
})

test('a secret item always gets the purple special accent, regardless of index', () => {
  assert.equal(railAccentForIndex(0, COLORS, true), COLORS.ENDED_TEXT)
  assert.equal(railAccentForIndex(1, COLORS, true), COLORS.ENDED_TEXT)
  assert.equal(railAccentForIndex(2, COLORS, true), COLORS.ENDED_TEXT)
})

test('accent is stable across repeated calls with the same inputs — no randomness, no rerender flicker', () => {
  const first = railAccentForIndex(1, COLORS, false)
  const second = railAccentForIndex(1, COLORS, false)
  assert.equal(first, second)
})

test('three cards in the same rail (indices 0, 1, 2) never share an accent when none is secret', () => {
  const accents = [0, 1, 2].map(i => railAccentForIndex(i, COLORS, false))
  assert.equal(new Set(accents).size, 3, 'all three no-photo cards must look distinct')
})

test('RAIL_ACCENT_KEYS names exactly three existing-palette tokens, not a new color system', () => {
  assert.deepEqual(RAIL_ACCENT_KEYS, ['AMBER', 'GREEN', 'ENDED_TEXT'])
})
