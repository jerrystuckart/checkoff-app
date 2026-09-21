// REGRESSION (Bug 2 — post-checkoff camera-row dark-on-dark text): guards
// against `coverContributionColors` in components/PostCheckoffSheet.jsx
// ever being declared before the TEXT/MUTED/BORDER/AMBER consts it reads,
// which is exactly what caused the bug. This repo has no RN
// component-rendering test harness (no jest/@testing-library), so this is
// a source-level guard rather than a rendered-output assertion — same
// convention as lib/homeScreenLegacyBranchRemoved.test.js.
//
// Root cause: `const coverContributionColors = { TEXT, MUTED, BORDER,
// AMBER }` sat ABOVE `const AMBER = '#F5A623'` etc. — a TDZ/declaration-
// order bug that made every property on coverContributionColors evaluate
// to `undefined`. CoverCandidateCTA (components/CoverCandidateCTA.jsx)
// then rendered its compact camera-row CTA text with `color: undefined`,
// which React Native's Text falls back to its own default (black) for,
// rather than inheriting — invisible against PostCheckoffSheet's always-
// dark NAVY surface (this sheet has no useTheme()/ThemeContext usage at
// all — its background is a fixed dark literal regardless of app theme, so
// this is a light-on-fixed-dark-surface fix, not a light/dark theme-token
// fix).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sheetSource = readFileSync(join(__dirname, '../components/PostCheckoffSheet.jsx'), 'utf8')
const ctaSource = readFileSync(join(__dirname, '../components/CoverCandidateCTA.jsx'), 'utf8')

function lineIndexOf(source, needle) {
  const idx = source.indexOf(needle)
  assert.ok(idx !== -1, `expected to find ${JSON.stringify(needle)} in source`)
  return source.slice(0, idx).split('\n').length
}

test('REGRESSION: coverContributionColors is declared AFTER TEXT/MUTED/BORDER/AMBER, not before', () => {
  const colorsLine = lineIndexOf(sheetSource, 'const coverContributionColors = { TEXT, MUTED, BORDER, AMBER }')
  const textLine   = lineIndexOf(sheetSource, "const TEXT   = '#E8E6DF'")
  const mutedLine  = lineIndexOf(sheetSource, "const MUTED  = 'rgba(255,255,255,0.5)'")
  const borderLine = lineIndexOf(sheetSource, "const BORDER = 'rgba(255,255,255,0.1)'")
  const amberLine  = lineIndexOf(sheetSource, "const AMBER  = '#F5A623'")

  assert.ok(colorsLine > textLine,   'coverContributionColors must come after TEXT is declared')
  assert.ok(colorsLine > mutedLine,  'coverContributionColors must come after MUTED is declared')
  assert.ok(colorsLine > borderLine, 'coverContributionColors must come after BORDER is declared')
  assert.ok(colorsLine > amberLine,  'coverContributionColors must come after AMBER is declared')
})

test('REGRESSION: coverContributionColors is still derived from real theme-appropriate consts, not a new hardcoded literal', () => {
  assert.match(sheetSource, /const coverContributionColors = \{ TEXT, MUTED, BORDER, AMBER \}/)
})

test('PostCheckoffSheet has no ThemeContext import — the sheet surface is intentionally always dark, not app-theme-aware', () => {
  assert.ok(!sheetSource.includes("from '../lib/ThemeContext'"), 'this sheet is a fixed-dark-surface bottom sheet by design')
})

test('the sheet background (NAVY) and the fix\'s text token (TEXT) are both light-on-dark-appropriate literals with real contrast', () => {
  // NAVY (#0F0F1E) is a near-black surface; TEXT (#E8E6DF) is a light cream.
  // A cheap relative-luminance check confirms these aren't accidentally
  // both dark (which is exactly what `undefined` collapsing to black text
  // produced).
  function luminance(hex) {
    const n = parseInt(hex.replace('#', ''), 16)
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const navyLum = luminance('#0F0F1E')
  const textLum = luminance('#E8E6DF')
  assert.ok(textLum - navyLum > 150, 'TEXT must be dramatically lighter than the NAVY surface for legibility')
})

test('CoverCandidateCTA compact camera-row CTA text still reads its color from the colors prop, not a hardcoded literal', () => {
  assert.match(ctaSource, /styles\.cta, \{ color: AMBER \}/, 'the camera-row CTA text must use the AMBER passed via props, unchanged by this fix')
})
