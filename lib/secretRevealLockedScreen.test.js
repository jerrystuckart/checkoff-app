import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
const fileExists = (rel) => existsSync(new URL(rel, import.meta.url))

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const screen = read('../screens/SecretRevealScreen.jsx')
const view = read('../components/secret/SecretRevealView.jsx')
const photos = read('./useSecretPhotos.js')
const lockedHook = photos.slice(photos.indexOf('export function useLockedSecretPhoto'), photos.indexOf('export function useUnlockedSecretPhoto'))
const unlockedHook = photos.slice(photos.indexOf('export function useUnlockedSecretPhoto'))

test('locked photo comes ONLY from the business photo (no cover pool / active cover / archetype / legacy / blur)', () => {
  assert.ok(lockedHook.includes('fetchSecretBusinessPhotoUrl'))
  for (const banned of ['useCardArtwork', 'coverCandidates', 'fetchActiveCoverImageUrl', 'fetchDisplayEligibleImagePool', 'item_image_url', 'photo_url', 'venue_image_url']) {
    assert.ok(!lockedHook.includes(banned), `locked hook: ${banned}`)
    assert.ok(!screen.includes(banned), `screen: ${banned}`)
    assert.ok(!view.includes(banned), `view: ${banned}`)
  }
  assert.ok(!screen.includes('blurRadius') && !view.includes('blurRadius'))
})

test('the approved-photo fetch is gated on the unlock (never prefetched while locked)', () => {
  assert.ok(unlockedHook.includes('enabled: !!itemId && !!enabled'))
  assert.ok(screen.includes('useUnlockedSecretPhoto({ itemId: item?.id, enabled: isRevealed'))
  assert.ok(screen.includes("const unlockedPhoto = isRevealed ? selectHeroPhoto"))
})

test('the secret text never reaches the view while locked', () => {
  assert.ok(screen.includes('paragraphs={isRevealed ? descriptionParagraphs(revealText) : []}'))
  assert.equal((screen.match(/revealText/g) ?? []).filter(Boolean).length > 0, true)
  const lockedProps = screen.slice(screen.indexOf('<SecretRevealView'))
  assert.equal((lockedProps.match(/revealText/g) ?? []).length, 1, 'revealText appears once in the view props, behind the isRevealed guard')
})

test('unlocked and locked share one layout, with the four utilities and photo CTA preserved', () => {
  assert.ok(screen.includes('<SecretRevealView'))
  assert.equal((screen.match(/<SecretRevealView/g) ?? []).length, 1, 'one layout for every state, including location errors')
  for (const id of ["'directions'", "'website'", "'save'", "'share'"]) assert.ok(screen.includes(`id === ${id}`), id)
  assert.ok(screen.includes('useSecretPhotoContribution({ item'))
  assert.ok(screen.includes('<CoverCandidateCTA'))
  assert.ok(!/CoverCandidateCapture/.test(screen), 'no duplicate capture screen')
})

test('unlocking is not completing: the only navigation to check-in is the primary action, and nothing writes a check-in here', () => {
  assert.equal((screen.match(/navigation\.replace\('PhotoCheckIn'/g) ?? []).length, 1)
  assert.ok(screen.includes("if (id === 'checkoff') proceedToCheckIn()"))
  assert.ok(!/check_ins|insert\(|upsert\(/.test(screen))
})

test('location, permission, distance-watch and settings behavior is unchanged', () => {
  for (const kept of ['requestForegroundPermissionsAsync', 'watchPositionAsync', "distanceInterval: 10, timeInterval: 3000", "Linking.openURL('app-settings:')", 'Linking.openSettings()', 'haversineMeters']) {
    assert.ok(screen.includes(kept), kept)
  }
})

test('signed URLs are refreshed and a failing image falls back once, then to the branded hero', () => {
  const hook = read('./useRefreshingPhoto.js')
  assert.ok(hook.includes('REFRESH_MS = 50 * 60 * 1000'))
  assert.ok(hook.includes("s === 'active'"))
  assert.ok(hook.includes('retried.current'))
  assert.ok(view.includes('function BrandedHero'))
  assert.ok(view.includes('onError='))
})

test('reveal is per screen visit: no durable marker, one gate per visit, reduced motion settles immediately', () => {
  assert.ok(screen.includes("AccessibilityInfo.addEventListener('reduceMotionChanged'"))
  assert.ok(screen.includes('useRef(createProximityGate())'))
  assert.ok(view.includes('shouldAnimateReveal({ arrival, alreadyPlayed: played.current, reduceMotion })'))
  assert.ok(view.includes('const arrival = mounted.current && prevPhase.current !== phase && revealed'))
  assert.ok(view.includes('settle()'))
  assert.ok(screen.includes('if (!reduceMotionRef.current) Haptics.notificationAsync'))
  for (const src of [screen, view, read('./secretRevealModel.js'), photos]) {
    assert.ok(!/secret_reveal_seen|secretRevealSeen|hasSeenReveal|markRevealSeen|revealMode|AsyncStorage/.test(src), 'no durable reveal marker anywhere')
  }
})

test('reveal: discovery card, shorter unlocked hero, photo stays visible, contribution control last', () => {
  assert.ok(view.includes('revealHeadline(venueName)'))
  assert.ok(view.includes('unlockedHeroHeight(heroHeight)'))
  assert.ok(!/blurRadius|blur\(/.test(view), 'photo is never blurred')
  const body = view.slice(view.indexOf('{/* ── 2 + 3'))
  assert.ok(body.indexOf('styles.discoveryCard') < body.indexOf('styles.secondaryRow'))
  assert.ok(body.indexOf('styles.secondaryRow') < body.indexOf('{photoCTA ?'))
  assert.ok(view.includes('numberOfLines={1}') && view.includes('flexShrink: 1, maxWidth'), 'status pill cannot clip')
  assert.ok(!view.includes('Your secret CheckOff') && !view.includes('You found it.'))
})

test('bottom action respects the tab bar / safe area and the back control respects the top inset', () => {
  assert.ok(screen.includes('BottomTabBarHeightContext'))
  assert.ok(screen.includes('footerBottomPad={tabBarHeight ? 14 : insets.bottom + 14}'))
  assert.ok(view.includes('top: insets.top + 6'))
})

test('the unlock radius shown is the SAME value the unlock gate compares against (never hardcoded copy)', () => {
  assert.ok(screen.includes('const requiredRadius = item?.geo_radius_m ?? item?.geoRadiusM ?? DEFAULT_RADIUS_M'))
  assert.ok(screen.includes('gateRef.current.update(dist, requiredRadius)'))
  assert.ok(screen.includes('radius: requiredRadius'))
  assert.ok(screen.includes('Math.round(requiredRadius)'))
  assert.ok(!/\b150 ?m\b/.test(view) && !/\b150 ?m\b/.test(read('./secretRevealModel.js').replace(/\/\/.*$/gm, '')), 'no hardcoded radius in copy')
})

test('the unlock gate is the radius comparison, independent of motion/animation state', () => {
  const gate = screen.slice(screen.indexOf('function handlePosition'), screen.indexOf('function checkProximity'))
  assert.ok(gate.includes('gateRef.current.update(dist, requiredRadius)'))
  assert.ok(!/reduceMotion|Haptics|played/.test(gate))
  const start = screen.slice(screen.indexOf('async function startWatching'), screen.indexOf('function handlePosition'))
  assert.ok(!/reduceMotion/.test(start), 'permission/location flow is independent of the motion setting')
  assert.ok(!fileExists('./secretRevealSeen.js'))
})

test('reveal background: stationary full-screen layer behind the scroll, hero photo fades out, no blur, translucent card', () => {
  const bgAt = view.indexOf('Stationary full-screen reveal background')
  assert.ok(bgAt > -1 && bgAt < view.indexOf('<ScrollView'), 'background is a sibling BEFORE (behind) the ScrollView, so it never scrolls')
  assert.ok(view.includes('StyleSheet.absoluteFill, { opacity: mix, transform: [{ scale: bgScale }] }'))
  assert.ok(view.includes('heroPhotoOpacity') && view.includes('1.14'))
  assert.ok(view.includes('Readability gradient'))
  assert.match(view, /discoveryCard: \{[^}]*rgba\(12,12,24,0\.56\)/)
  assert.ok(!/blurRadius|blur\(/.test(view))
  assert.ok(view.includes('shouldAnimateReveal({ arrival, alreadyPlayed: played.current, reduceMotion })'), 'once-per-visit replay preserved')
  assert.ok(screen.includes("unlockedPhoto?.source === 'reveal'") && screen.includes('setRevealBroken(true)'), 'a broken reveal image falls back to the approved photo')
})
