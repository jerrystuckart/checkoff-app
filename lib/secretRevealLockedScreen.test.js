import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../screens/SecretRevealScreen.jsx', import.meta.url), 'utf8')
const locked = src.slice(src.indexOf('function renderLocked'), src.indexOf('// ── Checking ──'))

test('locked photo comes ONLY from the business photo (no cover pool / active cover / archetype / legacy / blur)', () => {
  assert.ok(src.includes('fetchSecretBusinessPhotoUrl'))
  for (const banned of ['useCardArtwork', 'coverCandidates', 'fetchActiveCoverImageUrl', 'fetchDisplayEligibleImagePool', 'resolveSecretCoverPhoto', 'item_image_url', 'photo_url']) {
    assert.ok(!src.includes(banned), banned)
  }
  assert.ok(!src.includes('blurRadius'))
})

test('purple header never contains the photo; photo is behind the body only', () => {
  const header = locked.slice(locked.indexOf('styles.lockedHero'), locked.indexOf('styles.lockedBodyWrap'))
  assert.ok(!header.includes('<Image'), 'header must stay the designed purple treatment')
  assert.ok(header.includes('SECRET CHECKOFF'))
  const body = locked.slice(locked.indexOf('styles.lockedBodyWrap'))
  assert.ok(body.includes('resizeMode="cover"'))
  assert.ok(body.includes('LinearGradient'))
})

test('no approved photo -> image + scrim are not rendered (coverPhoto ? ... : null) and copy/utilities still are', () => {
  assert.match(locked, /\{coverPhoto \? \(/)
  assert.ok(locked.includes(') : null}'))
  assert.ok(locked.includes('renderUtilityRow()'))
  assert.ok(locked.includes('Back to list'))
})

test('locked layout never renders the secret body / challenge text', () => {
  assert.ok(!locked.includes('revealText'))
})

test('location-error state still shows the four utilities and a failed photo load falls back to no photo', () => {
  const err = src.slice(src.indexOf("if (phase === 'error')"), src.indexOf('// ── Revealed ──'))
  assert.ok(err.includes('renderUtilityRow()'))
  assert.ok(src.includes('onError={() => setCoverFailed(true)}'))
})

test('existing CoverCandidateCTA is rendered under the utility row (locked and unlocked), gated by the shared eligibility hook', () => {
  assert.ok(src.includes("import CoverCandidateCTA from '../components/CoverCandidateCTA'"))
  assert.ok(src.includes('useSecretPhotoContribution({ item'))
  assert.ok(src.includes('if (!showPhotoCTA) return null'))
  assert.ok(!/CoverCandidateCapture/.test(src), 'no duplicate capture screen: CTA navigates to the existing CoverCandidateCapture')
  const lockedBody = locked.slice(locked.indexOf('renderUtilityRow()'))
  assert.ok(lockedBody.indexOf('renderPhotoCTA()') > -1 && lockedBody.indexOf('renderPhotoCTA()') < lockedBody.indexOf('Back to list'))
  const reveal = src.slice(src.indexOf('// ── Revealed ──'))
  assert.ok(reveal.indexOf('renderUtilityRow()') < reveal.indexOf('renderPhotoCTA()'))
})

test('submission != display: the contribution hook never returns image URLs and the locked background is not fed by it', () => {
  const hook = readFileSync(new URL('./useSecretPhotoContribution.js', import.meta.url), 'utf8')
  assert.ok(hook.includes('\n  return useCoverCandidateCTA('), 'hook returns only the eligibility boolean')
  assert.ok(!/return \{/.test(hook))
  assert.ok(!hook.includes('secret_business_photo'))
  assert.ok(!src.includes('fetchDisplayEligibleImagePool') && !src.includes('fetchActiveCoverImageUrl'))
  assert.ok(src.includes('const coverPhoto = businessPhotoUrl && !coverFailed ? { url: businessPhotoUrl } : null'))
})
