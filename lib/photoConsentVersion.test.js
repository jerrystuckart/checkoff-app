import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  PHOTO_TERMS_VERSION, PHOTO_TERMS_EFFECTIVE_DATE, PHOTO_TERMS_NOTICE_ACCOUNTS_BEFORE, checkInPhotoTermsFields, mirrorPhotoTermsFields, coverConsentFields, shouldShowPhotoTermsNotice,
} from './photoConsentVersion.js'
import { buildTripModeCheckInPayload } from './tripModeCheckOffFlow.js'
import { buildVisitConfirmationPayload } from './visitDetection/candidateVisitConfirmation.js'

const src = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

test('version is written only with a photo AND a presented consent', () => {
  assert.deepEqual(checkInPhotoTermsFields({ photoUrl: 'https://x/p.jpg', consentPresented: true }), { photo_terms_version: PHOTO_TERMS_VERSION })
  assert.deepEqual(checkInPhotoTermsFields({ photoUrl: null, consentPresented: true }), {})
  assert.deepEqual(checkInPhotoTermsFields({ photoUrl: 'https://x/p.jpg', consentPresented: false }), {})
  assert.deepEqual(checkInPhotoTermsFields({ photoUrl: 'https://x/p.jpg' }), {})
})

test('mirror rows copy an existing version and never invent one', () => {
  assert.deepEqual(mirrorPhotoTermsFields({ photoUrl: 'u', sourceVersion: 'photo-terms-v1' }), { photo_terms_version: 'photo-terms-v1' })
  assert.deepEqual(mirrorPhotoTermsFields({ photoUrl: 'u', sourceVersion: null }), {})
  assert.deepEqual(mirrorPhotoTermsFields({ photoUrl: null, sourceVersion: 'photo-terms-v1' }), {})
})

test('cover submissions carry the cover consent version', () => {
  assert.deepEqual(coverConsentFields(), { consent_version: PHOTO_TERMS_VERSION })
})

test('older style payloads stay unversioned (compatible with a database that has no version)', () => {
  const trip = buildTripModeCheckInPayload({ userId: 'u', listItemId: 'l', pointsAwarded: 1, experiencedAt: '2026-10-01', photoUrl: 'https://x/p.jpg' })
  assert.equal('photo_terms_version' in trip, false)
  const visit = buildVisitConfirmationPayload({ userId: 'u', itemId: 'i', candidateVisitId: 'c', photoUrl: 'https://x/p.jpg' })
  assert.equal('photo_terms_version' in visit, false)
})

test('trip mode and visit confirmation carry the version only with a photo', () => {
  const t = buildTripModeCheckInPayload({ userId: 'u', listItemId: 'l', pointsAwarded: 1, experiencedAt: '2026-10-01', photoUrl: 'https://x/p.jpg', photoTermsVersion: PHOTO_TERMS_VERSION })
  assert.equal(t.photo_terms_version, PHOTO_TERMS_VERSION)
  const tn = buildTripModeCheckInPayload({ userId: 'u', listItemId: 'l', pointsAwarded: 1, experiencedAt: '2026-10-01', photoUrl: null, photoTermsVersion: PHOTO_TERMS_VERSION })
  assert.equal('photo_terms_version' in tn, false)
  const v = buildVisitConfirmationPayload({ userId: 'u', itemId: 'i', candidateVisitId: 'c', photoUrl: 'https://x/p.jpg', photoTermsVersion: PHOTO_TERMS_VERSION })
  assert.equal(v.photo_terms_version, PHOTO_TERMS_VERSION)
  const vn = buildVisitConfirmationPayload({ userId: 'u', itemId: 'i', candidateVisitId: 'c', photoUrl: null, photoTermsVersion: PHOTO_TERMS_VERSION })
  assert.equal('photo_terms_version' in vn, false)
})

test('every photo path presents the consent line and records the version (source level)', () => {
  const pci = src('../screens/PhotoCheckInScreen.jsx')
  assert.match(pci, /<PhotoLicenseNotice variant="checkin"/)
  assert.match(pci, /checkInPhotoTermsFields\(\{ photoUrl, consentPresented: true \}\)/)
  assert.match(pci, /photoTermsVersion: photoUrl \? PHOTO_TERMS_VERSION : null/)
  const trip = src('../components/TripModeCheckOffSheet.jsx')
  assert.match(trip, /photo\?\.uri \? <PhotoLicenseNotice/)
  assert.match(trip, /photoTermsVersion: photoUrl \? PHOTO_TERMS_VERSION : null/)
  const visit = src('../screens/VisitInboxScreen.jsx')
  assert.match(visit, /attachments\[row\.candidateVisitId\]\?\.photo \? <PhotoLicenseNotice/)
  assert.equal((visit.match(/photoTermsVersion: photoUrl \? PHOTO_TERMS_VERSION : null/g) ?? []).length, 2)
  const cover = src('../screens/CoverCandidateCaptureScreen.jsx')
  assert.match(cover, /PHOTO_CONSENT\.cover\.text/)
  assert.match(src('./coverCandidates.js'), /\.\.\.coverConsentFields\(\)/)
  assert.match(src('./checkInFanOut.js'), /mirrorPhotoTermsFields\(\{ photoUrl, sourceVersion: photoTermsVersion \}\)/)
  assert.match(src('./joinListCredit.js'), /mirrorPhotoTermsFields\(\{ photoUrl: src\.photo_url, sourceVersion: src\.photo_terms_version \}\)/)
})

test('notice: existing accounts only, until closed, never from server state', () => {
  const cut = '2026-10-09T01:30:00Z'
  assert.equal(shouldShowPhotoTermsNotice({ accountCreatedAt: '2026-09-01T00:00:00Z', accountsBefore: cut }), true)
  assert.equal(shouldShowPhotoTermsNotice({ accountCreatedAt: '2026-10-09T01:29:59Z', accountsBefore: cut }), true)
  assert.equal(shouldShowPhotoTermsNotice({ accountCreatedAt: '2026-10-09T01:30:00Z', accountsBefore: cut }), false)
  assert.equal(shouldShowPhotoTermsNotice({ accountCreatedAt: '2026-10-20T00:00:00Z', accountsBefore: cut }), false)
  assert.equal(shouldShowPhotoTermsNotice({ accountCreatedAt: '2026-09-01T00:00:00Z', accountsBefore: cut, dismissed: true }), false)
  assert.equal(shouldShowPhotoTermsNotice({ accountCreatedAt: null, accountsBefore: cut }), false)
  assert.equal(shouldShowPhotoTermsNotice({ accountCreatedAt: '2026-09-01T00:00:00Z', accountsBefore: 'not a date' }), false)
  assert.equal(PHOTO_TERMS_EFFECTIVE_DATE, '2026-10-08')
  assert.ok(!Number.isNaN(new Date(PHOTO_TERMS_NOTICE_ACCOUNTS_BEFORE).getTime()))
  const notice = src('../components/PhotoTermsNotice.jsx')
  assert.doesNotMatch(notice, /supabase|\.from\(|\.rpc\(/) // dismissal is device local; nothing is recorded as acceptance
})
