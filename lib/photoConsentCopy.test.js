import test from 'node:test'
import assert from 'node:assert/strict'
import { PHOTO_CONSENT, CHECKIN_PHOTO_SUBTITLES, TERMS_URL } from './photoConsentCopy.js'

const all = () => [
  PHOTO_CONSENT.checkin.text, PHOTO_CONSENT.checkin.linkLabel,
  PHOTO_CONSENT.cover.title, PHOTO_CONSENT.cover.subtitle, PHOTO_CONSENT.cover.text, PHOTO_CONSENT.cover.button, PHOTO_CONSENT.cover.linkLabel,
  CHECKIN_PHOTO_SUBTITLES.required, CHECKIN_PHOTO_SUBTITLES.optional,
]

test('public consent copy has no hyphens or dashes', () => {
  for (const t of all()) assert.doesNotMatch(t, /[-‐-―−]/, t)
})

test('check in and cover consents are separate and say different things', () => {
  assert.match(PHOTO_CONSENT.cover.text, /separate from the photo on your check in/)
  assert.match(PHOTO_CONSENT.cover.text, /private and is reviewed first/)
  assert.doesNotMatch(PHOTO_CONSENT.checkin.text, /cover/i)
})

test('both consents keep ownership with the user, state the license, retention after deletion and the rights duty', () => {
  for (const t of [PHOTO_CONSENT.checkin.text, PHOTO_CONSENT.cover.text]) {
    assert.match(t, /license/)
    assert.match(t, /delete your account/)
    assert.match(t, /without your name/)
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
