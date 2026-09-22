// REGRESSION (Bug 1 — obsolete logged-out Home): guards against the legacy
// flag-gated Home branch (the pre-2026-redesign top-of-Home markup, which
// used to render for every logged-out user and most logged-in ones because
// `whats_good_v1` was flag-gated behind a required userId) ever coming
// back — whether by a revert, a merge conflict, or someone re-adding the
// `whatsGood.enabled` conditional around the modern Home render. This repo
// has no RN component-rendering test harness (no jest/@testing-library),
// so this is a source-level guard rather than a rendered-output assertion —
// still enough to fail loudly if the legacy branch or its gating reappears.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const homeScreenSource = readFileSync(join(__dirname, '../screens/HomeScreen.jsx'), 'utf8')
const whatsTheThingHeroSource = readFileSync(join(__dirname, '../components/home/WhatsTheThingHero.jsx'), 'utf8')

test('REGRESSION: HomeScreen.jsx no longer RENDERS the legacy Home strings (stale comments mentioning the old rail name are fine; actual <Text> content is not)', () => {
  assert.ok(!homeScreenSource.includes('>Near you right now<'), 'legacy "Near you right now" header must not be rendered')
  assert.ok(!homeScreenSource.includes('The 5 closest things to check off'), 'legacy tagline must be gone entirely, comments included')
  assert.ok(!homeScreenSource.includes('Stop saying'), 'legacy "Stop saying..." tagline must be gone entirely, comments included')
})

test('REGRESSION: modern Home sections are unconditional, not gated on an auth-dependent flag', () => {
  assert.ok(homeScreenSource.includes('WhatsTheThingHero'), 'modern What\'s the Thing hero component must still be rendered')
  // Right Here Hero redesign (Phase 2/5, 2026-09-22) replaced "What's the
  // Thing?" with "HERE'S THE THING" per the activation-project spec.
  assert.ok(whatsTheThingHeroSource.includes("HERE'S THE THING"), 'the hero\'s own title text must still exist')
  assert.ok(!homeScreenSource.includes('whatsGood.enabled'), 'no code should read whatsGood.enabled to decide what renders any more')
  assert.ok(!homeScreenSource.includes('!whatsGood.enabled'), 'the legacy-branch condition must be gone')
})

test('REGRESSION: only one Home render path — WhatsGoodDiscovery ("What\'s Good") is rendered exactly once, unconditionally', () => {
  const occurrences = homeScreenSource.split('<WhatsGoodDiscovery').length - 1
  assert.equal(occurrences, 1, 'WhatsGoodDiscovery must render from exactly one place, not duplicated behind a flag branch')
})
