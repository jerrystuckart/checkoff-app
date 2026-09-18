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

test('utility row reflows safely with 1-3 visible actions (Directions/Website conditional, Save always present when signed in)', () => {
  assert.match(source, /utilityRow:\s*\{[^}]*flexWrap:\s*['"]wrap['"]/, 'utilityRow must keep flexWrap so 1-3 items reflow instead of clipping')
  assert.match(source, /utilityBtn:\s*\{[^}]*flex:\s*1[^}]*minWidth:\s*100/, 'utilityBtn must keep its existing flex:1/minWidth responsive sizing (now shared by Save too)')
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

// Saved Items V1 (2026-09-18) — the table now exists in production
// (supabase/migrations/20260918_saved_items.sql) and the shared
// lib/SavedItemsContext.js hook backs it, so the Save/Saved control that
// was previously and deliberately omitted (Case C) is now added as a
// third compact utility action alongside Directions/Website.
test('Save/Saved control is present in the utility row, wired to the shared useSavedItems() hook', () => {
  assert.ok(source.includes("import { useSavedItems } from '../lib/SavedItemsContext'"), 'must consume the shared Saved-items hook')
  assert.ok(source.includes('<BookmarkIcon'), 'must render the shared code-native bookmark icon, not a Unicode glyph')
  assert.ok(source.includes('toggleSaved(item.id, navigation)'), 'tapping must call the shared optimistic toggle')
})

test('Save control accessibility reflects saved status via accessibilityState.selected', () => {
  const saveBtnMatch = source.match(/onPress=\{\(\) => toggleSaved\(item\.id, navigation\)\}[\s\S]{0,400}/)
  assert.ok(saveBtnMatch, 'Save action must exist')
  assert.ok(saveBtnMatch[0].includes('accessibilityRole="button"'))
  assert.ok(saveBtnMatch[0].includes('accessibilityState={{ selected: isSaved(item.id) }}'))
  assert.ok(saveBtnMatch[0].includes('`Remove ${item.body} from Saved`'))
  assert.ok(saveBtnMatch[0].includes('`Save ${item.body}`'))
})

test('Photo Check-in button has no glyph/icon element, label text stands alone', () => {
  assert.ok(!source.includes('◎'), 'the ◎ glyph must not remain anywhere in ItemDetailScreen.jsx')
  const photoBtnMatch = source.match(/accessibilityLabel="Photo check-in"[\s\S]{0,600}/)
  assert.ok(photoBtnMatch, 'Photo check-in action must exist')
  assert.ok(photoBtnMatch[0].includes('Photo check-in'), 'the text label must still render on its own')
  assert.ok(!/utilityBtnIcon\}>◎/.test(source), 'no utilityBtnIcon Text should render the ◎ glyph')
})

test('geofence, secret-item guard, and points logic call sites are all preserved', () => {
  assert.ok(source.includes('checkGeoFence(item)'))
  assert.ok(source.includes("navigation.replace('SecretReveal'"))
  assert.ok(source.includes('updateUserLifetimePoints(userId)'))
  assert.ok(source.includes('fanOutCheckIn('))
})
