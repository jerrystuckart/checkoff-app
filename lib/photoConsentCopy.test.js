import test from 'node:test'
import assert from 'node:assert/strict'
import { PHOTO_CONSENT, CHECKIN_PHOTO_SUBTITLES, TERMS_URL, PHOTO_TERMS_NOTICE } from './photoConsentCopy.js'

const all = () => [
  PHOTO_CONSENT.checkin.text, PHOTO_CONSENT.checkin.linkLabel,
  PHOTO_CONSENT.cover.title, PHOTO_CONSENT.cover.subtitle, PHOTO_CONSENT.cover.text, PHOTO_CONSENT.cover.button, PHOTO_CONSENT.cover.linkLabel,
  CHECKIN_PHOTO_SUBTITLES.required, CHECKIN_PHOTO_SUBTITLES.optional,
  ...Object.values(PHOTO_TERMS_NOTICE),
]

test('public consent copy has no hyphens or dashes', () => {
  for (const t of all()) assert.doesNotMatch(t, /[-‐-―−]/, t)
})

test('check in and cover consents are separate and say different things', () => {
  assert.match(PHOTO_CONSENT.cover.text, /separate from the photo on your check in/)
  assert.match(PHOTO_CONSENT.cover.text, /Photo administrators review it first/)
  assert.doesNotMatch(PHOTO_CONSENT.checkin.text, /cover/i)
})

test('both consents keep ownership with the user, state the license, retention after deletion and the rights duty', () => {
  for (const t of [PHOTO_CONSENT.checkin.text, PHOTO_CONSENT.cover.text]) {
    assert.match(t, /license/)
    assert.match(t, /delete your account/)
    assert.match(t, /without your name/)
    assert.match(t, /not use it in advertising without your separate permission/)
    assert.match(t, /right to share/)
  }
  assert.match(PHOTO_CONSENT.checkin.text, /stays yours/)
  assert.match(PHOTO_CONSENT.cover.text, /You keep ownership/)
})

test('copy never claims ownership, sale, third party licensing, AI training or a removal promise', () => {
  for (const t of all()) {
    assert.doesNotMatch(t, /\b(we own|owned by CheckOff|sell|sold|third part|artificial|AI|train)/i, t)
    assert.doesNotMatch(t, /we will (remove|delete) (the|your) photo/i, t)
  }
})

test('cover consent does not promise approval and does not say the photo is public', () => {
  assert.match(PHOTO_CONSENT.cover.text, /if we approve it/)
  assert.doesNotMatch(PHOTO_CONSENT.cover.text, /will be (shown|public)/i)
})

test('check in subtitles do not promise other members will see the photo', () => {
  for (const t of [CHECKIN_PHOTO_SUBTITLES.required, CHECKIN_PHOTO_SUBTITLES.optional]) assert.doesNotMatch(t, /crew|feed|everyone|friends/i)
})

test('terms link points at the Content section of the Terms', () => {
  assert.equal(TERMS_URL, 'https://getcheckoff.com/terms#content')
})

test('copy never calls photos private or confidential and never promises continued display', () => {
  for (const t of all()) {
    assert.doesNotMatch(t, /\b(private|privately|confidential)\b/i, t)
    assert.doesNotMatch(t, /will (continue to )?be (shown|displayed)/i, t)
  }
})

test('the notice for existing accounts is prospective, offers the removal route and does not treat closing as acceptance', () => {
  assert.match(PHOTO_TERMS_NOTICE.body, /before the date stay under the Terms that applied when you submitted them/)
  assert.match(PHOTO_TERMS_NOTICE.body, /Closing this notice does not accept anything/)
  assert.match(PHOTO_TERMS_NOTICE.body, /not use a photo in advertising without your separate permission/)
  assert.match(PHOTO_TERMS_NOTICE.removal, /support@getcheckoff\.com/)
  assert.doesNotMatch(PHOTO_TERMS_NOTICE.body, /continued use|by using|you agree|accepted/i)
})
