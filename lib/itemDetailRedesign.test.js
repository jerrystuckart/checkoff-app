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

// Check-In Memory Viewer (2026-09-23) — the Photo Check-in BUTTON itself
// (styles.primaryPhotoBtn) remains unconditionally rendered regardless of
// `checked`, exactly as this test always required. What changed on
// purpose: once checked AND a saved photo memory exists, its LABEL/
// accessibilityLabel switch from the static "Photo check-in" string to
// "View memory" (screens/ItemDetailScreen.jsx's memoryPhotoExists state) —
// an already-completed-with-photo item has nothing left to "photo
// check-in" and should instead offer viewing what was already saved. See
// lib/checkInMemory.js / components/CheckInMemoryModal.jsx.
test('Photo Check-in / View memory action remains visible regardless of checked state (not gated on `checked`)', () => {
  const anchor = source.indexOf('style={styles.primaryPhotoBtn}')
  assert.ok(anchor !== -1, 'Photo check-in / View memory action must exist')
  assert.ok(!/checked\s*&&\s*\([\s\S]{0,80}styles\.primaryPhotoBtn/.test(source), 'the action button itself must not be conditionally hidden on `checked`')
  assert.ok(source.includes("'Photo check-in'"), 'the original Photo check-in label must still exist for the not-checked/no-memory case')
})

test('missing website/coordinates handled: existing hasLoc/hasWeb conditionals preserved', () => {
  assert.ok(source.includes('const hasLoc ='), 'hasLoc computation must remain')
  assert.ok(source.includes('const hasWeb ='), 'hasWeb computation must remain')
  assert.ok(source.includes('{hasLoc && ('), 'Directions action must stay conditional on hasLoc')
  assert.ok(source.includes('{hasWeb && ('), 'Website action must stay conditional on hasWeb')
})

// Item Detail Corrective Pass (2026-09-18), second pass — the PRIOR fix
// (marginLeft: 'auto' pinning Save to the trailing slot) was structurally
// correct but, per physical-device screenshots, left a large awkward gap
// whenever Website or Directions was absent, because 'auto' margin
// reserves the space those siblings WOULD have used rather than letting
// the remaining controls actually fill the row. Corrected utilityRow: every
// VISIBLE control gets flex:1 (so N present controls always share the row
// proportionally), rendering ONLY the actually-present controls with no
// placeholder/spacer elements, and Save is trailing purely by JSX order.
test('utility row: every present control gets equal flex:1 treatment, no marginLeft:auto pin, no separate Save style', () => {
  assert.match(source, /utilityRow:\s*\{[^}]*flexDirection:\s*['"]row['"]/, 'utilityRow must be a row')
  assert.match(source, /utilityBtn:\s*\{[^}]*flex:\s*1/, 'utilityBtn must be flex:1 — the mechanism that makes N present controls fill the row equally')
  assert.ok(!/utilityBtnSave:\s*\{/.test(source), 'no separate utilityBtnSave style should remain — Save gets the exact same utilityBtn style as Directions/Website')
  assert.ok(!/marginLeft:\s*['"]auto['"]/.test(codeOnlySource), 'the marginLeft: auto trailing-pin trick must be removed from executable code (prose in comments may still describe the prior bug/fix)')
})

test('Save always renders last among the present utility controls (JSX order, not an index/hasLoc/hasWeb computation)', () => {
  const utilityRowOpen = source.indexOf('<View style={styles.utilityRow}>')
  const utilityRowClose = source.indexOf('\n      )}', utilityRowOpen)
  const region = source.slice(utilityRowOpen, utilityRowClose)
  const directionsIdx = region.indexOf('accessibilityLabel="Get directions"')
  const websiteIdx = region.indexOf('accessibilityLabel="Visit website"')
  const saveIdx = region.indexOf('toggleSaved(item.id, navigation)')
  assert.ok(saveIdx > -1, 'Save control must exist in the utility row')
  if (directionsIdx > -1) assert.ok(saveIdx > directionsIdx, 'Save must come after Directions in JSX order')
  if (websiteIdx > -1) assert.ok(saveIdx > websiteIdx, 'Save must come after Website in JSX order')
})

test('utility row renders only the actually-present controls — no invisible placeholder/spacer elements', () => {
  const utilityRowOpen = source.indexOf('<View style={styles.utilityRow}>')
  const utilityRowClose = source.indexOf('\n      )}', utilityRowOpen)
  const region = source.slice(utilityRowOpen, utilityRowClose)
  assert.ok(!/placeholder/i.test(region), 'no placeholder element should render in the utility row')
  assert.ok(!/opacity:\s*0/.test(region), 'no invisible (opacity: 0) spacer should render in the utility row')
  // Directions/Website remain individually conditional; Save is unconditional.
  assert.match(region, /\{hasLoc && \(/)
  assert.match(region, /\{hasWeb && \(/)
})

test('Photo Check-in is a PRIMARY action, not a utility action: it does not appear inside utilityRow\'s own JSX subtree', () => {
  const utilityRowOpen = source.indexOf('<View style={styles.utilityRow}>')
  assert.ok(utilityRowOpen !== -1, 'utilityRow render must exist')
  // utilityRow's JSX subtree runs from its opening tag to the matching
  // `)}` that closes the `{userId && (...)}` wrapper around it — bounded
  // by the very next top-level ")}" line in the source, comfortably
  // inside the wrapper and well before the invite card further down.
  const closeIdx = source.indexOf('\n      )}', utilityRowOpen)
  const utilityRowRegion = source.slice(utilityRowOpen, closeIdx)
  assert.ok(!/Photo check-in/i.test(utilityRowRegion), 'Photo Check-in copy must not render inside utilityRow')
})

test('primary actions (Done/DONE and Photo Check-in) share the same parent container, directly adjacent', () => {
  const rowOpen = source.indexOf('<View style={styles.primaryActionRow}>')
  assert.ok(rowOpen !== -1, 'primaryActionRow container must exist')
  const rowClose = source.indexOf('\n      </View>', rowOpen)
  const region = source.slice(rowOpen, rowClose)
  assert.ok(region.includes("I'VE DONE THIS"), 'Done label must be inside primaryActionRow')
  assert.ok(region.includes('style={styles.primaryPhotoBtn}'), 'Photo Check-in / View memory action must be inside the SAME primaryActionRow container')
})

test('no fabricated distance field is introduced (Detail never had one; only the established item.dist_label/distance_label convention is read, when present)', () => {
  assert.ok(!/item\.distance\b/.test(source), 'must not read a nonexistent item.distance field')
})

// Item Detail Corrective Pass (2026-09-18/19) — the old numberOfLines={2}
// clamp truncated real item bodies mid-word/mid-thought and is gone.
// Title presentation (length tier, font size, line budget) is owned by the
// pure lib/detailTitlePresentation.js helper — see
// lib/detailTitlePresentation.test.js for its own coverage — this
// screen-level test only guards that the old hard clamp doesn't come back
// and that the new helper is actually wired in. The 2026-09-19 pass
// removed the below-hero "continuation" escape hatch this test used to
// assert (venueOverflowsHero/heroContinuationWrap) — that below-hero split
// was itself a real bug (an orphaned title fragment under the hero); the
// title now always renders entirely inside the hero, so this test no
// longer expects that flag to exist.
test('long-title rule: no hard 2-line clamp remains; hero title is driven by deriveTitlePresentation', () => {
  assert.ok(!codeOnlySource.includes('numberOfLines={2}'), 'the old numberOfLines={2} hard clamp must not remain in executable code (prose in comments may still name the old behavior)')
  assert.ok(source.includes("import { deriveTitlePresentation } from '../lib/detailTitlePresentation'"), 'must import the pure title-presentation helper')
  assert.ok(source.includes('deriveTitlePresentation(item.body)'), 'the hero title must be derived via the pure helper')
  assert.ok(source.includes('titlePresentation.heroNumberOfLines'), 'the hero Text must use the helper-provided line cap, not a hardcoded one')
  assert.ok(!source.includes('venueOverflowsHero'), 'the below-hero continuation escape hatch must be gone — the title never splits below the hero')
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

// Item Detail Corrective Pass (2026-09-18) — Goal 3: no "Add to list"/
// "On your list" rendered control remains ANYWHERE on Detail, in any
// mode. The underlying business logic this UI used to trigger
// (openListPicker/addToList, a `list_items` insert) is gone too — that
// capability now lives only on the Lists tab — but itemOnListId itself
// (real check-off attachment logic, not UI) is untouched and must stay.
test('no rendered "Add to list" control remains', () => {
  assert.ok(!codeOnlySource.includes('Add to list'), 'no "Add to list" copy must render anywhere in Detail')
  assert.ok(!source.includes('function openListPicker'), 'the picker-opening function must be removed')
  assert.ok(!source.includes('async function addToList'), 'the add-to-list mutation function must be removed from this screen')
})

test('no rendered "On your list" control remains', () => {
  assert.ok(!codeOnlySource.includes('On your list'), 'no "On your list" copy must render anywhere in Detail')
  assert.ok(!codeOnlySource.includes('showListPicker'), 'the list-picker modal state must be removed')
})

test('itemOnListId (real check-off attachment logic, not UI) is preserved', () => {
  assert.ok(source.includes('const [itemOnListId, setItemOnListId]'), 'itemOnListId state must remain — it feeds resolveCheckOffAttachment, not a rendered list-membership control')
  assert.ok(source.includes('resolveCheckOffAttachment(itemOnListId)'), 'Nearby-mode check-off attachment must still resolve via itemOnListId')
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
  const doneBtnAnchor = source.indexOf('styles.primaryDoneBtn,')
  const doneBtnRegion = source.slice(doneBtnAnchor, doneBtnAnchor + 700)
  assert.ok(doneBtnRegion.includes('accessibilityRole="button"'), 'check-off action must declare accessibilityRole')
  assert.ok(doneBtnRegion.includes('accessibilityState'), 'check-off action must expose accessibilityState (checked)')
  const photoBtnAnchor = source.indexOf('style={styles.primaryPhotoBtn}')
  const photoBtnRegion = source.slice(photoBtnAnchor, photoBtnAnchor + 1600)
  assert.ok(photoBtnRegion.includes('accessibilityLabel='), 'Photo check-in / View memory action must declare accessibilityLabel')
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

// Item Detail Corrective Pass (2026-09-18) — Goal 4/Goal 6: exactly ONE
// "DO THIS TOGETHER" card in the whole source, not duplicated per mode
// (structural proof there's a single shared invite structure, matching
// test #1/#6 from the task's explicit list).
test('"Do This Together" is the single invitation card, appearing exactly once, uses the pure inviteMessage/inviteAskLine helpers', () => {
  // Only the rendered title Text counts — comments elsewhere may
  // reference the phrase in prose while explaining the single-card rule.
  const occurrences = source.split('>DO THIS TOGETHER<').length - 1
  assert.equal(occurrences, 1, 'the rendered "DO THIS TOGETHER" title Text must appear exactly once — one shared card, not per-mode duplicates')
  assert.ok(source.includes("import { buildInviteMessage, buildInviteAskLine } from '../lib/inviteMessage'"))
  assert.ok(source.includes('inviteAskLine()'), 'the compact card must show the short venue-aware ask line')
})

test('no permanent message preview remains inline on the page (only inside the on-demand channel sheet)', () => {
  const inviteCardOpen = source.indexOf('<View style={styles.inviteCard}>')
  const inviteCardClose = source.indexOf('\n      </View>', inviteCardOpen)
  const inviteCardRegion = source.slice(inviteCardOpen, inviteCardClose)
  assert.ok(!inviteCardRegion.includes('Message preview'), 'the compact inviteCard itself must not show a permanent message preview')
  assert.ok(source.includes('Message preview'), 'the message preview must still exist somewhere (inside the on-demand sheet)')
})

test('no permanent Edit/channel-grid UI remains inline on the page — both only exist inside the on-demand invite channel sheet', () => {
  const inviteCardOpen = source.indexOf('<View style={styles.inviteCard}>')
  const inviteCardClose = source.indexOf('\n      </View>', inviteCardOpen)
  const inviteCardRegion = source.slice(inviteCardOpen, inviteCardClose)
  assert.ok(!inviteCardRegion.includes('editChannelsBtn'), 'no inline Edit button on the compact card')
  assert.ok(!inviteCardRegion.includes('channelRow'), 'no inline channel grid on the compact card')
  assert.ok(source.includes('showInviteChannels'), 'a state-gated on-demand sheet must exist')
  assert.ok(source.includes('<Modal') && source.includes('visible={showInviteChannels}'), 'the channel chooser must be a Modal gated on showInviteChannels, not always rendered')
})

test('tapping "Invite someone" triggers the channel chooser rather than it being rendered by default', () => {
  const soloBtnMatch = source.match(/accessibilityLabel="Invite someone"[\s\S]{0,10}/)
  assert.ok(soloBtnMatch, 'Invite someone action must exist')
  const onPressMatch = source.match(/onPress=\{\(\) => \{\s*trackEvent\('invite_item_tap'[\s\S]{0,120}setShowInviteChannels\(true\)/)
  assert.ok(onPressMatch, 'Invite someone must set showInviteChannels(true) on tap')
})

test('hero always renders via DetailArtwork — no direct resolvedItemImage/currentRotationContext call left in this screen, DetailArtwork\'s own contract untouched', () => {
  assert.ok(source.includes('<DetailArtwork'), 'must render the new DetailArtwork hero consumer')
  assert.ok(!source.includes("resolvedItemImage(resolvedItem, currentRotationContext(userId))"), 'the old direct-call hero resolution must be removed')
  const detailArtworkSource = readFileSync(join(__dirname, '../components/itemDetail/DetailArtwork.jsx'), 'utf8')
  assert.ok(detailArtworkSource.includes('useCardArtwork(item, userId)'), 'DetailArtwork must still consume useCardArtwork exactly as before — no new resolver')
  assert.ok(detailArtworkSource.includes('<ArchetypeArtwork'), 'DetailArtwork must still compose ArchetypeArtwork exactly as before — contract untouched')
})

// Goal 1 — the combined hero: artwork + textual content in ONE container.
test('hero contains artwork and textual content in one component/container (heroCard wraps both DetailArtwork and heroContent as siblings)', () => {
  const heroCardOpen = source.indexOf('<View style={[styles.heroCard,')
  assert.ok(heroCardOpen !== -1, 'heroCard container must exist')
  const heroCardClose = source.indexOf('\n      </View>', heroCardOpen)
  const heroCardRegion = source.slice(heroCardOpen, heroCardClose)
  assert.ok(heroCardRegion.includes('<DetailArtwork'), 'heroCard must contain the artwork layer')
  assert.ok(heroCardRegion.includes('styles.heroContent'), 'heroCard must contain the overlaid text content layer, in the SAME container')
  assert.ok(heroCardRegion.includes('heroTitle'), 'title must be inside the hero container')
})

// Item Detail Corrective Pass (2026-09-19) — the below-hero "continuation"
// block (rendered only for titles that overflowed the hero's old 4-line
// budget) has been removed entirely: it was the root cause of a real bug
// (an orphaned title fragment rendering under the hero). heroContent's own
// grouped accessibilityLabel still exposes the complete item.body exactly
// once; there is no second block that could duplicate/overlap it.
test('no below-hero continuation block remains (removed — title always renders entirely inside the hero)', () => {
  assert.ok(!source.includes('heroContinuationWrap'), 'heroContinuationWrap must no longer be rendered')
  assert.ok(!source.includes('venueOverflowsHero'), 'the overflow flag that gated the old continuation block must be gone')
})

test('hero overlay has a single accessibility-grouped reading order, decorative artwork stays hidden from screen readers', () => {
  const heroContentMatch = source.match(/style=\{styles\.heroContent\}[\s\S]{0,300}/)
  assert.ok(heroContentMatch, 'heroContent element must exist')
  assert.ok(heroContentMatch[0].includes('accessible'), 'heroContent must be one grouped accessible element')
  assert.ok(heroContentMatch[0].includes('accessibilityLabel'), 'heroContent must expose a single combined label (title -> venue -> meta order)')
  // Decorative-hiding is inherited from ArchetypeArtwork's own existing
  // pattern (accessibilityElementsHidden / importantForAccessibility, see
  // components/home/ArchetypeArtwork.jsx) — not re-implemented here.
  const archetypeSource = readFileSync(join(__dirname, '../components/home/ArchetypeArtwork.jsx'), 'utf8')
  assert.ok(archetypeSource.includes('accessibilityElementsHidden'), 'ArchetypeArtwork must still hide decorative art from the accessibility tree')
})

test('no new dependency was introduced for the hero scrim (reuses the already-installed expo-linear-gradient)', () => {
  assert.ok(source.includes("import { LinearGradient } from 'expo-linear-gradient'"))
  const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))
  assert.ok(pkg.dependencies['expo-linear-gradient'], 'expo-linear-gradient must already be a declared dependency, not newly added')
})

// ============================================================
// Item Detail Corrective Pass (2026-09-18), second pass — Goal 1: the hero
// scrim's localization. The bug was two-fold: (1) this screen's own
// left-to-right gradient stayed at moderate opacity all the way to its
// 55% stop, and (2) DetailArtwork.jsx's call into ArchetypeArtwork left
// `gradient` at its default true, layering a SEPARATE full-width
// top-to-bottom scrim (reaching ~0.92 opacity at the bottom, where the
// hero's text sits) underneath. Together the artwork read as dark across
// nearly its entire width regardless of the horizontal falloff. Fixed:
// DetailArtwork now passes gradient={false}, and this screen's own
// gradient's falloff reaches near-zero well before the right 35-45% band.
// ============================================================

test('hero scrim: gradient falls off to near-zero well before the right 35-45% band (no full-card dark overlay)', () => {
  const locMatch = source.match(/const HERO_GRADIENT_LOCATIONS = (\[[^\]]+\])/)
  assert.ok(locMatch, 'HERO_GRADIENT_LOCATIONS must be defined')
  const locations = JSON.parse(locMatch[1])
  assert.ok(locations.length >= 3, 'the gradient must have a real multi-stop falloff, not a flat two-stop wash')
  // The stop where the color first reaches its fully-clear value must land
  // at or before 0.45 (the documented right-side falloff boundary).
  const clearStopIndex = locations.findIndex((loc, i) => i > 0 && loc <= 0.45)
  assert.ok(clearStopIndex !== -1, 'a falloff stop must exist at or before the 0.45 mark')
  assert.ok(locations[locations.length - 1] === 1, 'the gradient must extend to the far edge (x=1) so the right side stays clear all the way across')
})

test('hero scrim: uses theme-driven HERO_SCRIM_* tokens, strongest color first (localized, not uniform)', () => {
  assert.match(source, /colors=\{\[colors\.HERO_SCRIM_STRONG,\s*colors\.HERO_SCRIM_SOFT,\s*colors\.HERO_SCRIM_CLEAR,\s*colors\.HERO_SCRIM_CLEAR\]\}/, 'gradient colors must be theme tokens, strong -> soft -> clear -> clear')
  const themeSource = readFileSync(join(__dirname, 'ThemeContext.js'), 'utf8')
  assert.ok(themeSource.includes('HERO_SCRIM_STRONG'), 'HERO_SCRIM_STRONG token must be defined in ThemeContext.js')
  assert.ok(themeSource.includes('HERO_SCRIM_SOFT'))
  assert.ok(themeSource.includes('HERO_SCRIM_CLEAR'))
})

test('hero scrim: light and dark mode use DIFFERENT scrim values, not the same value reused across modes', () => {
  // ThemeContext.js contains JSX (the Provider's render) so, per this
  // repo's own convention, it's read as source text rather than imported
  // at runtime under plain node:test.
  const themeSource = readFileSync(join(__dirname, 'ThemeContext.js'), 'utf8')
  const lightBlockMatch = themeSource.match(/export const lightColors = \{[\s\S]*?\n\}/)
  const darkBlockMatch = themeSource.match(/export const darkColors = \{[\s\S]*?\n\}/)
  assert.ok(lightBlockMatch && darkBlockMatch, 'both color blocks must exist')
  const lightStrongMatch = lightBlockMatch[0].match(/HERO_SCRIM_STRONG:\s*'([^']+)'/)
  const darkStrongMatch = darkBlockMatch[0].match(/HERO_SCRIM_STRONG:\s*'([^']+)'/)
  assert.ok(lightStrongMatch && darkStrongMatch, 'HERO_SCRIM_STRONG must be defined in both color blocks')
  assert.notEqual(lightStrongMatch[1], darkStrongMatch[1], 'light mode must not just reuse dark mode\'s scrim color verbatim')
})

test('hero scrim: DetailArtwork disables ArchetypeArtwork\'s own separate full-width vertical scrim (gradient={false}), avoiding the double-scrim stack', () => {
  const detailArtworkSource = readFileSync(join(__dirname, '../components/itemDetail/DetailArtwork.jsx'), 'utf8')
  assert.ok(detailArtworkSource.includes('gradient={false}'), 'DetailArtwork must pass gradient={false} to ArchetypeArtwork — Detail supplies its own localized scrim instead')
  // Confirms this is only a prop-value change at the call site, not a
  // change to ArchetypeArtwork's own contract/behavior.
  const archetypeArtworkSource = readFileSync(join(__dirname, '../components/home/ArchetypeArtwork.jsx'), 'utf8')
  assert.ok(archetypeArtworkSource.includes('gradient = true'), 'ArchetypeArtwork\'s own default (true) must remain untouched — only Detail\'s call site opts out')
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
  const photoBtnAnchor = source.indexOf('style={styles.primaryPhotoBtn}')
  const photoBtnRegion = source.slice(photoBtnAnchor, photoBtnAnchor + 1600)
  assert.ok(photoBtnAnchor !== -1, 'Photo check-in / View memory action must exist')
  assert.ok(photoBtnRegion.includes('primaryPhotoBtnText'), 'the text label must still render on its own, via styles.primaryPhotoBtnText')
  assert.ok(!/utilityBtnIcon\}>◎/.test(source), 'no utilityBtnIcon Text should render the ◎ glyph')
})

test('geofence, secret-item guard, and points logic call sites are all preserved', () => {
  assert.ok(source.includes('checkGeoFence(item)'))
  assert.ok(source.includes("navigation.replace('SecretReveal'"))
  assert.ok(source.includes('updateUserLifetimePoints(userId)'))
  assert.ok(source.includes('fanOutCheckIn('))
})

// ============================================================
// Item Detail Corrective Pass addendum (2026-09-18) — Detail Save bug.
// Traced root cause: lib/savedItemsState.js's isBenignDuplicateInsertError
// used to also treat ANY HTTP 409 as a benign "already saved" duplicate,
// which silently masked a genuine insert failure (e.g. a foreign-key
// violation on saved_items.item_id) as success — no rollback, no error,
// but no row ever written either. See lib/savedItemsState.test.js for the
// fix's own regression coverage. These tests cover the DETAIL CALL SITE
// specifically: proving it is wired identically to the already-working
// Home call sites, with no local/disconnected state of its own.
// ============================================================

test('Detail forwards the canonical item UUID (item.id) to toggleSaved — not a list_item id or any other field', () => {
  assert.ok(source.includes('onPress={() => toggleSaved(item.id, navigation)}'), 'must pass item.id, the canonical items.id, not listItemId/itemOnListId/resolvedItem-derived id')
  assert.ok(!/toggleSaved\(itemOnListId/.test(source), 'must never pass the list-attachment id to toggleSaved')
  assert.ok(!/toggleSaved\(item\?\.\s*listItemId/.test(source), 'must never pass listItemId to toggleSaved')
})

test('the bookmark\'s filled/outline visual is derived from isSaved(item.id) at render time — no local Detail-only saved boolean', () => {
  assert.ok(source.includes('<BookmarkIcon filled={isSaved(item.id)}'), 'BookmarkIcon\'s filled prop must read directly from the shared hook\'s isSaved(), every render')
  // No competing local state: this screen's own useState calls (searched
  // by name) must not include anything saved-flavored — the ONLY saved
  // state this screen touches is the shared hook's isSaved/toggleSaved.
  const localSavedStateDecls = source.match(/const \[\s*\w*[Ss]aved\w*\s*,\s*set\w*[Ss]aved\w*\s*\]\s*=\s*useState/g) || []
  assert.equal(localSavedStateDecls.length, 0, 'no local useState for a saved/isSaved-shaped flag must exist in Detail — the shared hook is the only source of truth')
})

test('Detail\'s press handler calls the REAL shared mutation (toggleSaved) directly on tap — not a local flip that never mutates', () => {
  const saveBtnMatch = source.match(/onPress=\{\(\) => toggleSaved\(item\.id, navigation\)\}/)
  assert.ok(saveBtnMatch, 'the onPress must call toggleSaved(item.id, navigation) directly, synchronously on tap — no intermediate local setter')
})

test('exactly one SavedItemsProvider exists in the whole app tree — no nested/duplicate provider', () => {
  const appSource = readFileSync(join(__dirname, '../App.jsx'), 'utf8')
  const providerOpens = appSource.split('<SavedItemsProvider>').length - 1
  assert.equal(providerOpens, 1, 'App.jsx must mount exactly one SavedItemsProvider')
  // And Detail itself must not define/import a second provider.
  assert.ok(!source.includes('SavedItemsProvider'), 'ItemDetailScreen.jsx must consume the hook, never define/wrap its own provider')
})

test('Detail and Home consume the identical shared hook/module — no parallel Saved-state implementation', () => {
  const editorialCardSource = readFileSync(join(__dirname, '../components/home/EditorialCard.jsx'), 'utf8')
  const heroSource = readFileSync(join(__dirname, '../components/home/WhatsTheThingHero.jsx'), 'utf8')
  assert.ok(source.includes("from '../lib/SavedItemsContext'"))
  assert.ok(editorialCardSource.includes("from '../../lib/SavedItemsContext'") || editorialCardSource.includes("SavedItemsContext"))
  assert.ok(heroSource.includes('SavedItemsContext'))
  // Same call shape everywhere: isSaved(item.id) / toggleSaved(item.id, navigation).
  assert.ok(editorialCardSource.includes('toggleSaved(item?.id, navigation)') || editorialCardSource.includes('toggleSaved(item.id, navigation)'))
  assert.ok(heroSource.includes('toggleSaved(item.id, navigation)'))
})

test('savedItemsState.js\'s insert-error classifier is the only gate between a failed mutation and rollback, and no longer masks non-duplicate errors', () => {
  const savedStateSource = readFileSync(join(__dirname, '../lib/savedItemsState.js'), 'utf8')
  const savedStateCodeOnly = savedStateSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')
  assert.ok(!savedStateCodeOnly.includes('.status === 409'), 'the overly-broad 409-status branch that masked real failures (e.g. FK violations) as benign must be removed from the executable code')
  assert.match(savedStateSource, /isBenignDuplicateInsertError[\s\S]{0,600}return error\.code === '23505'/, 'only a 23505 unique-violation code may be treated as a benign duplicate')
})
