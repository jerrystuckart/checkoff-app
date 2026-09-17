// NOT RIGHT HERE REDESIGN PASS (2026-09-17) — source-level guards for the
// Near You grouped module (components/home/NearYouCompact.jsx). This repo
// has no RN component-rendering test harness (no jest/@testing-library),
// so — consistent with lib/homeScreenLegacyBranchRemoved.test.js's
// established convention — these are structural/grep-based assertions on
// the source itself, not rendered-output assertions.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const nearYouCompactSource = readFileSync(join(__dirname, '../components/home/NearYouCompact.jsx'), 'utf8')
const homeScreenSource = readFileSync(join(__dirname, '../screens/HomeScreen.jsx'), 'utf8')

test('featured (closest) result uses the shared EditorialCard "primary" hero treatment', () => {
  assert.ok(nearYouCompactSource.includes("variant=\"primary\""), 'featured slot must render EditorialCard variant="primary" (photo -> archetype -> generic, ~2x a row\'s height)')
})

test('second and third results reuse the shared EditorialCard "row" treatment, not a second bespoke row implementation', () => {
  assert.ok(nearYouCompactSource.includes("variant=\"row\""), 'secondary rows must render EditorialCard variant="row"')
})

test('featured item is always items[0] — proximity order is never reshuffled to chase a "better" card', () => {
  assert.ok(nearYouCompactSource.includes('const [featured, ...rest] = items'), 'featured must destructure the first (closest) item off the existing proximity-sorted array, not select by any other criterion')
})

test('secondary rows are capped at exactly 2 (items[1] and items[2]) — no padding/invention beyond what was passed in', () => {
  assert.ok(nearYouCompactSource.includes('rest.slice(0, 2)'), 'must slice at most 2 secondary items from the remainder')
})

test('REGRESSION: Not Right Here contains no check-in or photo-upload action', () => {
  assert.ok(!nearYouCompactSource.includes('Check It Off'), 'Near You module must never render a Check It Off action')
  assert.ok(!/add a photo/i.test(nearYouCompactSource), 'Near You module must never render an Add a Photo action')
})

test('empty items array renders nothing (no fabricated/placeholder items)', () => {
  assert.ok(nearYouCompactSource.includes('if (!items || items.length === 0) return null'))
})

test('HomeScreen wires NearYouCompact with the real userId (not hard-coded), enabling archetype-tier resolution', () => {
  assert.ok(/<NearYouCompact[\s\S]*?userId=\{user\?\.id \?\? null\}/.test(homeScreenSource), 'HomeScreen must pass the signed-in user id through to NearYouCompact')
})

test('"See all nearby" navigation affordance is preserved', () => {
  assert.ok(nearYouCompactSource.includes('See all nearby'))
  assert.ok(nearYouCompactSource.includes('onSeeAllPress'))
})
