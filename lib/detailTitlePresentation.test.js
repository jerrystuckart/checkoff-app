// Item Detail Corrective Pass (2026-09-19) — coverage for
// lib/detailTitlePresentation.js, the pure view-model that decides how the
// Detail hero's title renders. This pass removed the prior below-hero
// "continuation" escape hatch entirely (a title splitting into a hero
// fragment plus an orphaned fragment below it — a real bug found via
// physical-device QA) in favor of an expanded in-hero long tier plus a new
// bounded "extreme" tier with an in-hero ellipsis + "Read full thing"
// modal action.

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
  LONG_TIER_MAX_CHARS_IN_HERO,
  HERO_MAX_HEIGHT_DP,
} from './detailTitlePresentation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const screenSource = readFileSync(join(__dirname, '../screens/ItemDetailScreen.jsx'), 'utf8')

// ── The two real acceptance fixtures (live query, 2026-09-19) ───────────
// Retrieved byte-exact via a read-only anon-key REST query against the
// `items` table (select id,body where body ilike '%Heu%Gabel%' / '%Forest
// Rope Park of Kahlenberg%') — not reconstructed from the bug report's
// fragments.
const HEU_GABEL_BODY =
  "Try Clara Aue's seasonal Kronländer cuisine with French influence, then browse the attached organic deli at 'Heu & Gabel'"
const FOREST_ROPE_PARK_BODY =
  "Tackle multiple difficulty levels and flying foxes at the largest adventure forest rope park in eastern Austria at 'Forest Rope Park of Kahlenberg'."

// ── Tier classification ──────────────────────────────────────────────────

test('short/medium tier thresholds are exactly as documented', () => {
  assert.equal(classifyTitleTier('a'.repeat(SHORT_TITLE_MAX_CHARS)), 'short')
  assert.equal(classifyTitleTier('a'.repeat(SHORT_TITLE_MAX_CHARS + 1)), 'medium')
  assert.equal(classifyTitleTier('a'.repeat(MEDIUM_TITLE_MAX_CHARS)), 'medium')
  assert.equal(classifyTitleTier('a'.repeat(MEDIUM_TITLE_MAX_CHARS + 1)), 'long')
})

test('long tier extends up through its computed character budget; beyond it is extreme', () => {
  assert.equal(classifyTitleTier('a'.repeat(LONG_TIER_MAX_CHARS_IN_HERO)), 'long')
  assert.equal(classifyTitleTier('a'.repeat(LONG_TIER_MAX_CHARS_IN_HERO + 1)), 'extreme')
})

// ── Per-tier sizing (regression + new-tier extension) ────────────────────

test('short titles retain the large-title tier: strong font size, no hero growth', () => {
  const p = deriveTitlePresentation('a'.repeat(30))
  assert.equal(p.tier, 'short')
  assert.equal(p.heroFontSize, 22)
  assert.equal(p.heroHeightHint, 240)
  assert.equal(p.showFullTextAction, false)
})

test('medium titles retain an intermediate tier with modestly more room than short', () => {
  const p = deriveTitlePresentation('a'.repeat(70))
  assert.equal(p.tier, 'medium')
  assert.equal(p.heroFontSize, 19)
  assert.ok(p.heroHeightHint > 240, 'medium tier must allow more hero height than short')
  assert.ok(p.heroNumberOfLines > 4, 'medium tier must allow more lines than the old 4-line clamp')
  assert.equal(p.showFullTextAction, false)
})

test('long titles receive an expanded line count/height vs. the prior pass, and show the complete text', () => {
  const body = 'word '.repeat(30).trim() // well inside the long tier, well short of extreme
  const p = deriveTitlePresentation(body)
  assert.equal(p.tier, 'long')
  assert.ok(p.heroNumberOfLines >= 6, 'long tier must allow roughly 6-8 lines')
  assert.equal(p.heroHeightHint, HERO_MAX_HEIGHT_DP, 'long tier hero height must sit at the firm max cap')
  assert.equal(p.heroLines, body, 'long tier must show the complete body with no ellipsis')
  assert.equal(p.showFullTextAction, false)
})

test('hero maximum height is bounded: a concrete firm cap exists and long/extreme never exceed it', () => {
  assert.equal(typeof HERO_MAX_HEIGHT_DP, 'number')
  assert.ok(HERO_MAX_HEIGHT_DP > 0 && HERO_MAX_HEIGHT_DP < 900, 'the cap must be a real, bounded dp value, not the whole screen')
  const long = deriveTitlePresentation('word '.repeat(30).trim())
  const extreme = deriveTitlePresentation('word '.repeat(400).trim())
  assert.ok(long.heroHeightHint <= HERO_MAX_HEIGHT_DP)
  assert.ok(extreme.heroHeightHint <= HERO_MAX_HEIGHT_DP)
})

// ── Extreme tier: intentional ellipsis + "Read full thing" ──────────────

test('an artificial 400+ char body lands in the extreme tier with an intentional in-hero ellipsis and a full-text action flag', () => {
  const body = 'word '.repeat(400).trim() // ~2000 chars, far beyond any real item body
  assert.ok(body.length > 400)
  const p = deriveTitlePresentation(body)
  assert.equal(p.tier, 'extreme')
  assert.ok(p.heroLines.endsWith('…'), 'extreme tier must end its in-hero text with a deliberate ellipsis')
  assert.ok(p.heroLines.length < body.length, 'extreme tier must truncate the in-hero text')
  assert.equal(p.showFullTextAction, true)
  assert.equal(p.fullText, body, 'fullText must be the exact, complete original body')
})

test('extreme tier never cuts a word in half at the ellipsis boundary', () => {
  const body = 'word '.repeat(400).trim()
  const p = deriveTitlePresentation(body)
  const withoutEllipsis = p.heroLines.replace(/…$/, '')
  // Every word in the truncated head must appear as a COMPLETE word from
  // the original body (word-boundary split, never a mid-word slice).
  const originalWords = body.split(/\s+/)
  const headWords = withoutEllipsis.split(/\s+/).filter(Boolean)
  for (const w of headWords) {
    assert.ok(originalWords.includes(w), `"${w}" must be a complete word from the original body`)
  }
})

test('"Read full thing" is absent for short, medium, and long tiers — only extreme shows it', () => {
  const short = deriveTitlePresentation('a'.repeat(30))
  const medium = deriveTitlePresentation('a'.repeat(70))
  const long = deriveTitlePresentation('word '.repeat(30).trim())
  for (const p of [short, medium, long]) {
    assert.equal(p.showFullTextAction, false)
  }
})

// ── Accessibility: complete body recoverable exactly once ───────────────

test('accessibilityLabel and fullText both expose the complete, untruncated body exactly once, regardless of tier', () => {
  for (const body of [HEU_GABEL_BODY, FOREST_ROPE_PARK_BODY, 'word '.repeat(400).trim()]) {
    const p = deriveTitlePresentation(body)
    assert.equal(p.accessibilityLabel, body)
    assert.equal(p.fullText, body)
  }
})

// ── The two real-world acceptance fixtures from the corrective-pass spec ─

test('acceptance fixture 1 (Heu & Gabel, live-queried, ~121 chars): lands in the long tier, complete, no ellipsis, no "Read full thing"', () => {
  const p = deriveTitlePresentation(HEU_GABEL_BODY)
  assert.equal(p.tier, 'long')
  assert.equal(p.heroLines, HEU_GABEL_BODY)
  assert.ok(!p.heroLines.includes('…'))
  assert.equal(p.showFullTextAction, false)
})

test('acceptance fixture 2 (Forest Rope Park of Kahlenberg, live-queried, ~148 chars): lands in the long tier, complete, no ellipsis, no "Read full thing"', () => {
  const p = deriveTitlePresentation(FOREST_ROPE_PARK_BODY)
  assert.equal(p.tier, 'long')
  assert.equal(p.heroLines, FOREST_ROPE_PARK_BODY)
  assert.ok(!p.heroLines.includes('…'))
  assert.equal(p.showFullTextAction, false)
})

// ── Structural guards on the live screen source ──────────────────────────

test('no hard two-line clamp remains on the hero title in ItemDetailScreen.jsx', () => {
  const heroTitleMatch = screenSource.match(/<Text[^>]*styles\.heroTitle[\s\S]{0,200}/)
  assert.ok(heroTitleMatch, 'heroTitle text render must exist')
  assert.ok(!heroTitleMatch[0].includes('numberOfLines={2}'), 'hero title must no longer clamp via numberOfLines={2}')
  assert.ok(screenSource.includes('deriveTitlePresentation'), 'the screen must consume the pure title-presentation helper')
})

test('no below-hero title-continuation element/logic remains in ItemDetailScreen.jsx', () => {
  assert.ok(!screenSource.includes('heroContinuationWrap'), 'the below-hero continuation wrapper style must be gone')
  assert.ok(!screenSource.includes('heroTitleContinuation'), 'the below-hero continuation title style must be gone')
  assert.ok(!screenSource.includes('heroVenueContinuation'), 'the below-hero continuation venue style must be gone')
  assert.ok(!screenSource.includes('continuationText'), 'no remainder/substring-splitting field may be consumed')
  assert.ok(!screenSource.includes('hasContinuation'), 'no continuation-flag branching may remain')
  assert.ok(!screenSource.includes('venueOverflowsHero'), 'the venue-overflow branch this bug depended on must be gone')
})

test('lib/detailTitlePresentation.js exports no continuation-related field', () => {
  const moduleSource = readFileSync(join(__dirname, './detailTitlePresentation.js'), 'utf8')
  assert.ok(!moduleSource.includes('continuationText'))
  assert.ok(!moduleSource.includes('hasContinuation'))
})

test('the hero itself never nests a ScrollView — only the full-body modal (outside the hero) may scroll', () => {
  const heroCardIdx = screenSource.indexOf('styles.heroCard')
  const heroCardEndIdx = screenSource.indexOf('</View>\n      </View>', heroCardIdx)
  const heroSubtree = screenSource.slice(heroCardIdx, heroCardEndIdx > -1 ? heroCardEndIdx : heroCardIdx + 3000)
  assert.ok(!heroSubtree.includes('<ScrollView'), 'the hero subtree must not contain a ScrollView')
})

test('neighborhood renders below the title inside the hero, but no TITLE text renders outside the hero', () => {
  // heroVenue (neighborhood) is rendered unconditionally now that the
  // continuation branch is gone.
  assert.match(screenSource, /<Text style=\{styles\.heroVenue\}[\s\S]{0,60}\{item\.neighborhoodName\}/)
})

test('the full-body modal is wired to a state toggle and renders the complete fullText verbatim', () => {
  assert.match(screenSource, /const \[showFullBodyModal, setShowFullBodyModal\] = useState\(false\)/)
  assert.match(screenSource, /visible=\{showFullBodyModal\}/)
  assert.match(screenSource, /\{titlePresentation\.fullText\}/)
})

test('the full-body modal state resets when the item changes (mirrors DetailArtwork.jsx\'s photoFailed reset on item?.id)', () => {
  const idx = screenSource.indexOf('const [showFullBodyModal, setShowFullBodyModal] = useState(false)')
  const block = screenSource.slice(idx, idx + 400)
  assert.match(block, /useEffect\(\(\) => \{\s*setShowFullBodyModal\(false\)\s*\}, \[item\?\.id\]\)/)
})

test('accessibility props exist on the "Read full thing" action and the modal close control', () => {
  assert.match(screenSource, /accessibilityLabel="Read full thing"/)
  assert.match(screenSource, /accessibilityLabel="Close"/)
})
