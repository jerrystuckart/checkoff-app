// Item Detail Redesign (2026-09-18) — structural/source-text guards for
// screens/ItemDetailScreen.jsx, following this repo's established
// convention (see lib/whatsTheThingHeroRightHere.test.js,
// lib/homeScreenLegacyBranchRemoved.test.js): no RN render harness exists,
// so these are grep-based assertions on the live source.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(__dirname, '../screens/ItemDetailScreen.jsx'), 'utf8')
const codeOnlySource = source
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')

test('incomplete vs completed action labels use the approved copy', () => {
  assert.ok(source.includes("I'VE DONE THIS"), 'incomplete-state label must be present')
  assert.ok(source.includes('DONE ✓'), 'completed-state label must be present')
  assert.ok(!codeOnlySource.includes('Check this off'), 'old incomplete-state copy must not remain')
  assert.ok(!codeOnlySource.includes('Checked off!'), 'old completed-state copy must not remain')
})

test('Photo Check-in remains visible regardless of checked state (not gated on `checked`)', () => {
  const photoBtnMatch = source.match(/accessibilityLabel="Photo check-in"[\s\S]{0,600}/)
  assert.ok(photoBtnMatch, 'Photo check-in action must exist')
  assert.ok(!/checked\s*&&[\s\S]{0,80}Photo check-in/.test(source), 'Photo check-in must not be conditionally hidden on `checked`')
})

test('missing website/coordinates handled: existing hasLoc/hasWeb conditionals preserved', () => {
  assert.ok(source.includes('const hasLoc ='), 'hasLoc computation must remain')
  assert.ok(source.includes('const hasWeb ='), 'hasWeb computation must remain')
  assert.ok(source.includes('{hasLoc && ('), 'Directions action must stay conditional on hasLoc')
  assert.ok(source.includes('{hasWeb && ('), 'Website action must stay conditional on hasWeb')
})

test('no fabricated distance field is introduced (Detail never had one; none invented here)', () => {
  assert.ok(!/item\.distance\b/.test(source), 'must not read a nonexistent item.distance field')
})

test('long text structure does not clip: itemBody has no numberOfLines/fixed-height clipping', () => {
  const itemBodyRenderMatch = source.match(/<Text style=\{styles\.itemBody\}>[\s\S]{0,40}/)
  assert.ok(itemBodyRenderMatch, 'itemBody text render must exist')
  assert.ok(!itemBodyRenderMatch[0].includes('numberOfLines'), 'itemBody must not truncate via numberOfLines')
})

test('no Dare-a-Friend tile markup remains as a default Detail entry point', () => {
  assert.ok(!codeOnlySource.includes('Dare a friend'), 'old Dare-a-Friend tile copy must not render')
  assert.ok(!source.includes('quickBtn:'), 'old oversized quickRow/quickBtn tile styles must be removed')
  assert.ok(!/[^a-zA-Z]\u{1F608}/u.test(codeOnlySource), 'the 😈 emoji icon must not remain in live code')
})

test('no giant "On Your List" button markup remains', () => {
  assert.ok(!source.includes('nearbyAddBtn:'), 'the old dedicated On-Your-List button style must be removed')
  assert.ok(!codeOnlySource.includes('+ Add to a list'), 'the old giant On-Your-List button copy must not remain in its old form')
})

test('no "Help the next person" text remains anywhere in Detail', () => {
  assert.ok(!codeOnlySource.includes('Help the next person'))
})

test('light and dark theme tokens are used, not hardcoded to one theme', () => {
  assert.ok(source.includes('useTheme()'), 'must consume the shared theme hook')
  assert.ok(source.includes('createItemStyles('), 'styles must be theme-token driven, not static')
  assert.ok(source.includes('AMBER') && source.includes('GREEN') && source.includes('NAVY'), 'approved accent tokens must be threaded through from theme colors')
})

test('accessibility props are present on primary actions', () => {
  const checkBtnAnchor = source.indexOf('styles.checkBtn,')
  const checkBtnRegion = source.slice(checkBtnAnchor, checkBtnAnchor + 700)
  assert.ok(checkBtnRegion.includes('accessibilityRole="button"'), 'check-off action must declare accessibilityRole')
  assert.ok(checkBtnRegion.includes('accessibilityState'), 'check-off action must expose accessibilityState (checked)')
  assert.ok(source.includes('accessibilityLabel="Photo check-in"'))
  assert.ok(source.includes('accessibilityLabel="Invite someone"'))
})

test('un-check requires a confirmation step before the destructive delete runs', () => {
  assert.ok(source.includes("Un-check this item?"), 'a confirmation Alert must gate unchecking')
  assert.ok(source.includes('async function performCheckOff()'), 'the actual check-in mutation must be extracted behind the confirmation gate')
  assert.ok(source.includes('async function performNearbyDone()'), 'the Nearby-mode mutation must also be gated')
})

test('analytics: checkoff tap, photo check-in tap, and invite tap are tracked via the existing trackEvent convention', () => {
  assert.ok(source.includes("trackEvent('item_checkoff_tap'"))
  assert.ok(source.includes("trackEvent('photo_checkin_tap'"))
  assert.ok(source.includes("trackEvent('invite_item_tap'"))
})

test('existing analytics calls preserved: item_view, directions_click, url_click', () => {
  assert.ok(source.includes("trackEvent('item_view'"))
  assert.ok(source.includes("trackEvent('directions_click'"))
  assert.ok(source.includes("trackEvent('url_click'"))
})

test('"Do This Together" is the single invitation card (title copy present, uses the pure inviteMessage helper)', () => {
  assert.ok(source.includes('DO THIS TOGETHER'))
  assert.ok(source.includes("import { buildInviteMessage } from '../lib/inviteMessage'"))
})

test('hero always renders via DetailArtwork — no direct resolvedItemImage/currentRotationContext call left in this screen', () => {
  assert.ok(source.includes('<DetailArtwork'), 'must render the new DetailArtwork hero consumer')
  assert.ok(!source.includes("resolvedItemImage(resolvedItem, currentRotationContext(userId))"), 'the old direct-call hero resolution must be removed')
})

test('Save/Saved control is intentionally omitted on Detail (Case C — no safe existing storage mechanism)', () => {
  assert.ok(!/Saved\b.*item|Save this item/i.test(codeOnlySource) || !source.includes('useSavedItem'), 'must not reference a nonexistent Saved hook')
  assert.ok(!source.includes("from '../lib/useSavedItem'"), 'must not import a Saved hook that was never safely implemented')
})

test('geofence, secret-item guard, and points logic call sites are all preserved', () => {
  assert.ok(source.includes('checkGeoFence(item)'))
  assert.ok(source.includes("navigation.replace('SecretReveal'"))
  assert.ok(source.includes('updateUserLifetimePoints(userId)'))
  assert.ok(source.includes('fanOutCheckIn('))
})
