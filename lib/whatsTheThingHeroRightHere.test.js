// Right Here experience redesign (2026-09-17) — source-level guards for
// components/home/WhatsTheThingHero.jsx, consistent with the established
// convention in lib/homeScreenLegacyBranchRemoved.test.js and
// lib/nearYouCompactModule.test.js: this repo has no RN
// component-rendering test harness (no jest/@testing-library), so these
// are structural/grep-based assertions on the source itself.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const heroSource = readFileSync(join(__dirname, '../components/home/WhatsTheThingHero.jsx'), 'utf8')
// Code-only view (strips `//` comment lines) so string-literal-in-a-comment
// mentions (e.g. explaining WHY something isn't duplicated) don't get
// counted as if they were a second live occurrence of the copy itself.
const codeOnlySource = heroSource
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')

test('shared hierarchy: title, points metadata, primary Check It Off action all present', () => {
  assert.ok(heroSource.includes("What's the Thing?"), 'title copy must still exist')
  assert.ok(heroSource.includes('Check it off'), 'primary Check It Off action copy must still exist')
  assert.ok(heroSource.includes('pointsLabel'), 'points/difficulty metadata must be derived and rendered, not hardcoded')
  assert.ok(!/['"`]5 ?pts['"`]/i.test(heroSource), 'points value must never be hardcoded to the mockup\'s "5 pts"')
})

test('no redundant inner "RIGHT HERE" label (design correction — redundant with the YOU\'RE HERE eyebrow)', () => {
  assert.ok(!/>\s*RIGHT HERE/i.test(heroSource), 'must not render a standalone "RIGHT HERE" text label')
  assert.ok(!heroSource.includes('RIGHT HERE •'), 'must not render the mockup\'s redundant "RIGHT HERE • 5 PTS" inner line')
})

test('"YOU\'RE HERE" eyebrow copy appears exactly once in live code (no duplicate eyebrow literal)', () => {
  const occurrences = codeOnlySource.split("YOU'RE HERE").length - 1
  assert.equal(occurrences, 1, 'the literal "YOU\'RE HERE" fallback eyebrow string must be defined in exactly one place')
})

// Item Detail Redesign (2026-09-18) — "Help the next person" copy was
// explicitly removed (scoped removal, requested alongside the Detail
// redesign). Add a Photo itself is untouched; only this support line is gone.
test('"Help the next person" support copy no longer renders anywhere in this component', () => {
  assert.ok(!codeOnlySource.includes('Help the next person'), 'the "Help the next person" copy must be fully removed from live code')
})

test('REGRESSION: Check It Off wiring unchanged — still navigates to ItemDetail with the current item', () => {
  assert.ok(heroSource.includes("navigation.navigate('ItemDetail', { item })"), 'card press handler must remain unchanged')
})

test('REGRESSION: Add a Photo still routed through the existing CoverCandidateCTA pill, not a new component', () => {
  assert.ok(heroSource.includes('<CoverCandidateCTA item={item} navigation={navigation} colors={colors} variant="pill" />'), 'Add a Photo must still be CoverCandidateCTA in its pill variant')
  assert.ok(heroSource.includes('showContributionCTA &&'), 'Add a Photo must still be conditionally rendered on existing eligibility, not unconditionally')
})

test('narrow-layout reflow: the action row declares flexWrap so actions stack instead of clipping', () => {
  assert.match(heroSource, /ctaRow:\s*\{[^}]*flexWrap:\s*['"]wrap['"]/, 'ctaRow style must include flexWrap: "wrap"')
})

test('archetype/generic layering preserved: dominant no-photo mode still uses ArchetypeArtwork with a generic fallback renderer', () => {
  assert.ok(heroSource.includes('<ArchetypeArtwork'), 'must still delegate archetype/generic rendering to the shared ArchetypeArtwork component')
  assert.ok(heroSource.includes('renderGenericFallback={() => <HeroNoImageBackground'), 'generic base layer must still be supplied as the fallback renderer')
})

test('approved photo still wins over archetype artwork (mutually exclusive branches, unchanged tier priority)', () => {
  assert.ok(heroSource.includes('const showImageMode = !compact && artwork.isPhoto'))
  assert.ok(heroSource.includes('const showArchetypeMode = !compact && artwork.isArchetype'))
})

test('accessibility: card press target declares an explicit button role and a description combining experience + venue', () => {
  assert.ok(heroSource.includes('accessibilityRole="button"'), 'card action must declare accessibilityRole="button"')
  assert.match(heroSource, /accessibilityLabel=\{venueName \? `\$\{item\.body\}, at \$\{venueName\}` : item\.body\}/, 'card accessible description must combine experience body + venue name when available')
})
