// Item Detail Corrective Pass (2026-09-18) — coverage for
// lib/detailTitlePresentation.js, the pure view-model that replaced the
// hero title's old `numberOfLines={2}` clamp (screens/ItemDetailScreen.jsx,
// pre-2026-09-18), which truncated real item bodies mid-word/mid-thought.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  deriveTitlePresentation,
  classifyTitleTier,
  SHORT_TITLE_MAX_CHARS,
  MEDIUM_TITLE_MAX_CHARS,
  HERO_TITLE_MAX_LINES,
  HERO_CONTINUATION_HEIGHT_HINT,
} from './detailTitlePresentation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const screenSource = readFileSync(join(__dirname, '../screens/ItemDetailScreen.jsx'), 'utf8')

// ── Tier classification ──────────────────────────────────────────────────

test('short/medium/long tier thresholds are exactly as documented', () => {
  assert.equal(classifyTitleTier('a'.repeat(SHORT_TITLE_MAX_CHARS)), 'short')
  assert.equal(classifyTitleTier('a'.repeat(SHORT_TITLE_MAX_CHARS + 1)), 'medium')
  assert.equal(classifyTitleTier('a'.repeat(MEDIUM_TITLE_MAX_CHARS)), 'medium')
  assert.equal(classifyTitleTier('a'.repeat(MEDIUM_TITLE_MAX_CHARS + 1)), 'long')
})

test('deterministic responsive font/hero sizing per tier', () => {
  const short = deriveTitlePresentation('a'.repeat(30))
  const medium = deriveTitlePresentation('a'.repeat(70))
  const long = deriveTitlePresentation('a'.repeat(200))

  assert.equal(short.tier, 'short')
  assert.equal(short.heroFontSize, 22)
  assert.equal(short.heroHeightHint, 240)

  assert.equal(medium.tier, 'medium')
  assert.equal(medium.heroFontSize, 19)
  assert.equal(medium.heroHeightHint, 260)

  assert.equal(long.tier, 'long')
  assert.equal(long.heroFontSize, 17)
  // 200 chars of unbroken 'a' (no word boundary) forces a continuation —
  // the exceptional-continuation height hint applies.
  assert.equal(long.hasContinuation, true)
  assert.equal(long.heroHeightHint, HERO_CONTINUATION_HEIGHT_HINT)
})

test('four-line allowance: heroNumberOfLines is 4, not the old 2-line clamp', () => {
  const p = deriveTitlePresentation('Find the door disguised as a painting')
  assert.equal(p.heroNumberOfLines, HERO_TITLE_MAX_LINES)
  assert.equal(HERO_TITLE_MAX_LINES, 4)
})

test('short/ordinary titles display completely, with no continuation', () => {
  const body = "Find the original tombstone of composer Joseph Haydn in 'Haydnpark'."
  const p = deriveTitlePresentation(body)
  assert.equal(p.heroLines, body)
  assert.equal(p.continuationText, '')
  assert.equal(p.hasContinuation, false)
})

// ── Accessibility: complete body recoverable exactly once ───────────────

test('accessibilityLabel exposes the complete, untruncated body exactly once', () => {
  const body = "Trace Meidling's crafts, everyday life, and notable residents at 'Bezirksmuseum Meidling', Vienna's oldest district museum."
  const p = deriveTitlePresentation(body)
  assert.equal(p.accessibilityLabel, body)
  // The label itself is the whole body verbatim — not a concatenation of
  // heroLines + continuationText that could duplicate or diverge from it.
  assert.equal(p.accessibilityLabel.split(body).length - 1, 1)
})

// ── Exceptional continuation: no overlap, no ellipsis, word-clean split ─

test('exceptional continuation contains only text NOT already shown in the hero — no word overlap at the boundary', () => {
  const body = 'word '.repeat(60).trim() // forces a continuation at medium/long tier
  const p = deriveTitlePresentation(body)
  assert.ok(p.hasContinuation, 'a body this long must produce a continuation')

  const heroWords = p.heroLines.split(/\s+/).filter(Boolean)
  const continuationWords = p.continuationText.split(/\s+/).filter(Boolean)
  // Reassembling heroLines + ' ' + continuationText must reproduce the
  // original body exactly (word-clean split — no duplicated or dropped
  // words at the boundary).
  const reassembled = [p.heroLines, p.continuationText].filter(Boolean).join(' ')
  assert.equal(reassembled, body)
  assert.equal(heroWords.length + continuationWords.length, body.split(/\s+/).filter(Boolean).length)
})

test('no ellipsis is ever introduced for titles handled by the hero+continuation split', () => {
  const bodies = [
    'Short title.',
    'a'.repeat(85),
    'a'.repeat(140),
    'word '.repeat(40).trim(),
  ]
  for (const body of bodies) {
    const p = deriveTitlePresentation(body)
    assert.ok(!p.heroLines.includes('…'), `heroLines must not contain an ellipsis for: ${body.slice(0, 20)}...`)
    assert.ok(!p.continuationText.includes('…'), `continuationText must not contain an ellipsis for: ${body.slice(0, 20)}...`)
  }
})

// ── The four real-world acceptance examples from the corrective-pass spec ─

test('acceptance example 1: door/painting/venue/hidden/chapel all survive in hero+continuation', () => {
  const body = "Find the door disguised as a painting inside 'Let's Be Frank' to enter the hidden 'The Chapel'"
  const p = deriveTitlePresentation(body)
  const combined = [p.heroLines, p.continuationText].filter(Boolean).join(' ')
  for (const phrase of ['door', 'painting', "Let's Be Frank", 'hidden', 'The Chapel']) {
    assert.ok(combined.includes(phrase), `combined text must retain "${phrase}"`)
  }
})

test('acceptance example 2: museum name and "Vienna\'s oldest district museum" survive, not stopped after "everyday life"', () => {
  const body = "Trace Meidling's crafts, everyday life, and notable residents at 'Bezirksmuseum Meidling', Vienna's oldest district museum."
  const p = deriveTitlePresentation(body)
  const combined = [p.heroLines, p.continuationText].filter(Boolean).join(' ')
  assert.ok(combined.includes('Bezirksmuseum Meidling'), 'combined text must retain the museum name')
  assert.ok(combined.includes("Vienna's oldest district museum"), 'combined text must retain the closing descriptor')
  assert.notEqual(p.heroLines.trim().endsWith('everyday life,'), true, 'must not stop right after "everyday life"')
})

test('acceptance example 3: "Joseph Haydn" and "Haydnpark" are not lost, and the title fits completely or nearly completely', () => {
  const body = "Find the original tombstone of composer Joseph Haydn in 'Haydnpark'."
  const p = deriveTitlePresentation(body)
  const combined = [p.heroLines, p.continuationText].filter(Boolean).join(' ')
  assert.ok(combined.includes('Joseph Haydn'))
  assert.ok(combined.includes('Haydnpark'))
  assert.equal(p.hasContinuation, false, 'this body should fit completely within the hero budget')
})

test('acceptance example 4: venue and distinguishing conclusion are retained, not cut before the venue name', () => {
  const body = "Order a Viennese breakfast and Melange at 'Café Sperl', one of Vienna's last classic coffeehouses."
  const p = deriveTitlePresentation(body)
  const combined = [p.heroLines, p.continuationText].filter(Boolean).join(' ')
  assert.ok(combined.includes('Café Sperl'), 'venue name must be retained')
  assert.ok(combined.includes("one of Vienna's last classic coffeehouses"), 'distinguishing conclusion must be retained')
  // The venue must not be cut off BEFORE it appears — i.e. it must be
  // fully present in whichever of heroLines/continuationText contains it,
  // not split mid-word across the boundary.
  assert.ok(p.heroLines.includes('Café Sperl') || p.continuationText.includes('Café Sperl'))
})

// ── Structural guard on the live screen source ───────────────────────────

test('no hard two-line clamp remains on the hero title in ItemDetailScreen.jsx', () => {
  const heroTitleMatch = screenSource.match(/<Text[^>]*styles\.heroTitle[\s\S]{0,200}/)
  assert.ok(heroTitleMatch, 'heroTitle text render must exist')
  assert.ok(!heroTitleMatch[0].includes('numberOfLines={2}'), 'hero title must no longer clamp via numberOfLines={2}')
  assert.ok(screenSource.includes('deriveTitlePresentation'), 'the screen must consume the new pure title-presentation helper')
})
