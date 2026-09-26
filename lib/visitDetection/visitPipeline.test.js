// End-to-end (pure) walk of the visit pipeline. evaluateDeparture here is the REFERENCE implementation of the
// server's public.visit_evaluate (parity is checked by scripts/verify-visit-evaluate-parity.mjs); the phone no
// longer decides or writes candidates — see presenceServer.test.js.
// with real Florence catalog
// coordinates and the LIVE production profiles / weights / bands, so a broken
// link between stages (radius, arrival, dwell, scoring, RLS ceiling, push
// eligibility, inbox, confirm) fails here instead of on a field trip.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  visitGeofenceRadiusM, findCompetingVenues, resolveEnterArrival, isFixInsideVenue, evaluateDeparture,
  maxPlausibleCandidateScore, CANDIDATE_EXPIRY_MS, MAX_ARRIVAL_AGE_MS, VISIT_GEOFENCE_DEFAULT_RADIUS_M,
  VISIT_GEOFENCE_MAX_RADIUS_M, COMPETING_VENUE_DISTANCE_M, SAME_VENUE_TOLERANCE_M,
} from './visitPipeline.js'
import { classifyVisitEligibility, MAX_MONITORED_REGIONS } from './visitEligibility.js'
import { isNotifyEligibleCandidateVisit } from './notifyEligibility.js'
import { selectInboxRows, buildVisitConfirmationPayload } from './candidateVisitConfirmation.js'
import { haversineMeters } from '../distance.js'

// Live production values (visit_detection_profiles / visit_confidence_weights / visit_confidence_bands, 2026-09-25).
const PROFILES = {
  quick_stop: { candidate_dwell_minutes: 5, strong_dwell_minutes: 12, manual_only: false },
  fast_casual: { candidate_dwell_minutes: 10, strong_dwell_minutes: 25, manual_only: false },
  restaurant: { candidate_dwell_minutes: 15, strong_dwell_minutes: 60, manual_only: false },
  landmark: { candidate_dwell_minutes: 4, strong_dwell_minutes: 10, manual_only: false },
  manual_only: { candidate_dwell_minutes: null, strong_dwell_minutes: null, manual_only: true },
}
const WEIGHTS = {
  inside_venue_radius: 30, exceeds_candidate_dwell: 25, exceeds_strong_dwell: 15, stopped_not_driving: 15,
  good_location_accuracy: 10, no_competing_venue_nearby: 10, likely_drive_by: -30, overlapping_venues: -25, poor_location_accuracy: -20,
}
const BANDS = { ignore_below: 50, medium_confidence_below: 70, strong_candidate_below: 85 }
const USER = 'user-1'

// Real Florence catalog rows (coordinates from production).
const it = (id, prof, lat, lng, extra = {}) => ({ id, visit_profile_key: prof, maps_lat: lat, maps_lng: lng, geo_radius_m: null, is_universal: false, is_active: true, ...extra })
const EDOARDO = it('fee2f65f', 'quick_stop', 43.7725344, 11.2576676)       // gelato, Duomo
const GROM = it('0bffe75c', 'quick_stop', 43.7722809, 11.2558382)
const VIVOLI = it('6602f653', 'quick_stop', 43.7699351, 11.2600892)
const SANTO_BEVITORE = it('0c8d81ed', 'restaurant', 43.7690, 11.2468)
const DITTA = it('2d93929f', 'restaurant', 43.7670, 11.2509)
const VOLPI = it('8d00f06f', 'bar', 43.7670, 11.2528)
const BRUSCHETTA = it('1b0f0e92', 'bar', 43.7670, 11.2528)                 // same address as Volpi
const CANTINA_WINE_WINDOW = it('ebf3045d', null, 43.7744, 11.2573)         // real item with no profile
PROFILES.bar = { candidate_dwell_minutes: 15, strong_dwell_minutes: 90, manual_only: false }
const ALL = [EDOARDO, GROM, VIVOLI, SANTO_BEVITORE, DITTA, VOLPI, BRUSCHETTA, CANTINA_WINE_WINDOW]

const GOOD_FIX = { accuracy: 8, speed: 1.0, latitude: 0, longitude: 0 }
const T0 = Date.parse('2026-09-28T09:30:00Z')
const min = (n) => n * 60000

function depart(item, dwellMin, over = {}) {
  return evaluateDeparture({
    userId: USER, item, profile: PROFILES[item.visit_profile_key], arrivalMs: T0, departureMs: T0 + min(dwellMin),
    exitFix: GOOD_FIX, competingCount: 0, weights: WEIGHTS, bands: BANDS, ...over,
  })
}

test('visit geofence radius is venue-scale, never the 500 m check-off default', () => {
  assert.equal(visitGeofenceRadiusM({}), VISIT_GEOFENCE_DEFAULT_RADIUS_M)
  assert.equal(visitGeofenceRadiusM({ geo_radius_m: null }), 120)
  assert.equal(visitGeofenceRadiusM({ geo_radius_m: 185 }), 185) // real Florence retail rows carry 185
  assert.equal(visitGeofenceRadiusM({ geo_radius_m: 500 }), VISIT_GEOFENCE_MAX_RADIUS_M)
})

test('walking straight through a venue circle never reaches any profile\'s candidate threshold', () => {
  const crossingMin = (2 * VISIT_GEOFENCE_DEFAULT_RADIUS_M / 1.3) / 60 // ~3.1 min at walking pace
  const shortest = Math.min(...Object.values(PROFILES).filter(p => !p.manual_only).map(p => p.candidate_dwell_minutes))
  assert.ok(crossingMin < shortest, `${crossingMin} >= ${shortest}`)
  // whereas the old 500 m default would have taken ~13 min: enough for coffee/gelato AND fast-casual
  assert.ok((2 * 500 / 1.3) / 60 > PROFILES.fast_casual.candidate_dwell_minutes)
})

test('Florence eligibility: the profile-less wine window is excluded with a reason; profiled items are monitored; cap holds', () => {
  const profiles = PROFILES
  assert.deepEqual(classifyVisitEligibility(CANTINA_WINE_WINDOW, profiles, 0), { eligible: false, reason: 'no_visit_profile_assigned' })
  assert.deepEqual(classifyVisitEligibility(EDOARDO, profiles, 0), { eligible: true })
  assert.equal(classifyVisitEligibility(EDOARDO, profiles, MAX_MONITORED_REGIONS).reason, 'exceeds_region_cap')
})

test('competing venues: same address is one venue; a different venue within 80 m is ambiguous; far venues are not', () => {
  assert.equal(findCompetingVenues(VOLPI, [BRUSCHETTA], PROFILES).length, 0, 'same address -> same venue')
  assert.equal(findCompetingVenues(EDOARDO, ALL, PROFILES).length, 0, 'Edoardo is unambiguous in the real Florence set')
  assert.equal(findCompetingVenues(VIVOLI, ALL, PROFILES).length, 0)
  const neighbor = it('n1', 'restaurant', EDOARDO.maps_lat + 0.0004, EDOARDO.maps_lng) // ~44 m north
  assert.ok(haversineMeters(EDOARDO.maps_lat, EDOARDO.maps_lng, neighbor.maps_lat, neighbor.maps_lng) > SAME_VENUE_TOLERANCE_M)
  assert.equal(findCompetingVenues(EDOARDO, [neighbor], PROFILES).length, 1)
  const far = it('n2', 'restaurant', EDOARDO.maps_lat + 0.0012, EDOARDO.maps_lng) // ~133 m
  assert.ok(haversineMeters(EDOARDO.maps_lat, EDOARDO.maps_lng, far.maps_lat, far.maps_lng) > COMPETING_VENUE_DISTANCE_M)
  assert.equal(findCompetingVenues(EDOARDO, [far], PROFILES).length, 0)
  // venues that can never produce a visit don't create ambiguity
  assert.equal(findCompetingVenues(EDOARDO, [{ ...neighbor, visit_profile_key: 'manual_only' }, { ...neighbor, is_active: false }, { ...neighbor, is_universal: true }, { ...neighbor, visit_profile_key: null }], PROFILES).length, 0)
})

test('enter events: a re-delivered enter (iOS does this on every geofence re-registration) keeps the real arrival; stale/garbage resets', () => {
  assert.deepEqual(resolveEnterArrival(String(T0), T0 + min(7)), { arrivalMs: T0, kept: true })
  assert.deepEqual(resolveEnterArrival(null, T0), { arrivalMs: T0, kept: false })
  assert.equal(resolveEnterArrival(String(T0), T0 + MAX_ARRIVAL_AGE_MS + 1).kept, false)
  assert.equal(resolveEnterArrival('abc', T0).kept, false)
  assert.equal(resolveEnterArrival(String(T0 + min(5)), T0).kept, false, 'arrival in the future is corrupt')
})

test('exit verification tolerates GPS noise but not a real departure', () => {
  const at = (dLat) => ({ latitude: EDOARDO.maps_lat + dLat, longitude: EDOARDO.maps_lng, accuracy: 30 })
  assert.equal(isFixInsideVenue(at(0.0012), EDOARDO), true)  // ~133 m out, 30 m accuracy slack -> still inside 120+30
  assert.equal(isFixInsideVenue(at(0.0025), EDOARDO), false) // ~278 m out
})

test('brief stop / manual-only / stale arrival are discarded with a reason', () => {
  assert.deepEqual([depart(EDOARDO, 3).outcome, depart(EDOARDO, 3).reason], ['discard', 'below_candidate_dwell'])
  assert.equal(depart(SANTO_BEVITORE, 14.9).reason, 'below_candidate_dwell')
  assert.equal(evaluateDeparture({ userId: USER, item: CANTINA_WINE_WINDOW, profile: null, arrivalMs: T0, departureMs: T0 + min(30), exitFix: GOOD_FIX, competingCount: 0, weights: WEIGHTS, bands: BANDS }).reason, 'manual_only_or_no_profile')
  assert.equal(depart(EDOARDO, 11 * 60).reason, 'implausible_dwell')
  assert.equal(depart(EDOARDO, -1).reason, 'negative_dwell')
})

test('driving past / poor GPS scores below the ignore band and is discarded', () => {
  const r = depart(EDOARDO, 6, { exitFix: { accuracy: 90, speed: 12 }, competingCount: 3 })
  assert.equal(r.outcome, 'discard'); assert.equal(r.reason, 'below_ignore_band')
})

test('Florence gelato, 14 min, clean fix: candidate row is exactly what the server expects; 7-day expiry; push-eligible', () => {
  const r = depart(EDOARDO, 14)
  assert.equal(r.outcome, 'candidate')
  assert.equal(r.score, 100)
  assert.equal(r.band, 'notify_eligible')
  assert.equal(r.row.status, 'high_confidence')
  assert.equal(r.row.detection_method, 'geofence_dwell')
  assert.equal(r.row.item_id, 'fee2f65f')
  assert.equal(r.row.dwell_minutes, 14)
  assert.equal(new Date(r.row.expires_at).getTime() - new Date(r.row.departure_at).getTime(), CANDIDATE_EXPIRY_MS)
  assert.equal(CANDIDATE_EXPIRY_MS, 7 * 24 * 3600 * 1000)
  // the SQL RLS check: |dwell - (departure - arrival)| < 2 min, departure after arrival, score <= ceiling
  const spanMin = (Date.parse(r.row.departure_at) - Date.parse(r.row.arrival_at)) / 60000
  assert.ok(Math.abs(r.row.dwell_minutes - spanMin) < 2)
  assert.ok(r.row.confidence_score <= maxPlausibleCandidateScore({ profile: PROFILES.quick_stop, dwellMinutes: r.row.dwell_minutes, weights: WEIGHTS }))
  const notify = isNotifyEligibleCandidateVisit({ confidenceScore: r.score, strongCandidateBelow: BANDS.strong_candidate_below, isTester: true, realtimeNotificationsEnabled: true, silentModeEnabled: false, alreadyCheckedOffDuringVisit: false })
  assert.equal(notify.eligible, true)
})

test('Florence restaurant: 14 min misses, 20 min with a clean fix qualifies, ambiguity keeps it inbox-only', () => {
  assert.equal(depart(SANTO_BEVITORE, 14).outcome, 'discard')
  const clean = depart(SANTO_BEVITORE, 20)
  assert.equal(clean.outcome, 'candidate')
  assert.equal(clean.score, 90) // 30+25+10+15+10, no strong-dwell bonus below 60 min
  const ambiguous = depart(SANTO_BEVITORE, 70, { competingCount: 2 })
  assert.equal(ambiguous.outcome, 'candidate')
  assert.equal(ambiguous.score, 70) // 30+25+15+10+15-25
  assert.equal(ambiguous.row.status, 'high_confidence')
  assert.equal(isNotifyEligibleCandidateVisit({ confidenceScore: ambiguous.score, strongCandidateBelow: BANDS.strong_candidate_below, isTester: true, realtimeNotificationsEnabled: true, silentModeEnabled: false, alreadyCheckedOffDuringVisit: false }).eligible, false)
})

test('no exit fix / unknown neighbors: still a suggestion, but never a push', () => {
  const r = depart(EDOARDO, 14, { exitFix: null, competingCount: null })
  assert.equal(r.outcome, 'candidate')
  assert.equal(r.score, 70) // 30+25+15 only
  assert.ok(r.score < BANDS.strong_candidate_below)
})

test('contract: every candidate the client can produce stays under the SQL insert ceiling (guards JS/SQL drift that would silently drop visits at RLS)', () => {
  const fixes = [null, GOOD_FIX, { accuracy: 90, speed: 12 }, { accuracy: 30, speed: 0.4 }, { accuracy: 5, speed: -1 }]
  for (const [key, profile] of Object.entries(PROFILES)) {
    if (profile.manual_only) continue
    const item = it('x', key, 43.77, 11.25)
    for (const dwell of [profile.candidate_dwell_minutes, profile.candidate_dwell_minutes + 1, profile.strong_dwell_minutes, profile.strong_dwell_minutes + 30]) {
      for (const exitFix of fixes) for (const competingCount of [null, 0, 1, 4]) {
        const r = depart(item, dwell, { exitFix, competingCount })
        if (r.outcome !== 'candidate') continue
        assert.ok(r.row.confidence_score <= maxPlausibleCandidateScore({ profile, dwellMinutes: r.row.dwell_minutes, weights: WEIGHTS }), `${key} dwell=${dwell} fix=${JSON.stringify(exitFix)} n=${competingCount}`)
      }
    }
  }
})

test('full chain: refresh -> enter -> refresh re-delivers enter -> exit -> candidate -> push -> inbox -> confirm payload', () => {
  // 1. nearby selection: Edoardo is eligible and is registered with a venue-scale radius
  const decision = classifyVisitEligibility(EDOARDO, PROFILES, 0)
  assert.equal(decision.eligible, true)
  const region = { identifier: EDOARDO.id, radius: visitGeofenceRadiusM(EDOARDO) }
  assert.equal(region.radius, 120)
  // 2. enter (device storage simulated), then a foreground refresh re-delivers "enter" 7 minutes later
  const store = new Map()
  const onEnter = (nowMs) => { const { arrivalMs, kept } = resolveEnterArrival(store.get(region.identifier), nowMs); if (!kept) store.set(region.identifier, String(arrivalMs)) }
  onEnter(T0); onEnter(T0 + min(7))
  assert.equal(Number(store.get(EDOARDO.id)), T0, 'dwell must not restart on re-registration')
  // 3. exit 16 minutes after arrival
  const result = evaluateDeparture({ userId: USER, item: EDOARDO, profile: PROFILES.quick_stop, arrivalMs: Number(store.get(EDOARDO.id)), departureMs: T0 + min(16), exitFix: GOOD_FIX, competingCount: 0, weights: WEIGHTS, bands: BANDS })
  assert.equal(result.outcome, 'candidate')
  const row = { ...result.row, id: 'cv-1', confirmed_at: null, rejected_at: null }
  // 4. push payload keys the sender and the tap handler agree on
  const sender = fs.readFileSync(new URL('../../supabase/functions/process-notification-queue/index.ts', import.meta.url), 'utf8')
  const caseBlock = sender.slice(sender.indexOf("row.type === 'candidate_visit_high_confidence'"), sender.indexOf("row.type === 'candidate_visit_high_confidence'") + 700)
  for (const k of ["kind: 'candidate_visit_high_confidence'", 'candidate_visit_id', 'item_id']) assert.ok(caseBlock.includes(k), `sender missing ${k}`)
  const handler = fs.readFileSync(new URL('../useNotifications.js', import.meta.url), 'utf8')
  assert.ok(handler.includes("data?.kind === 'candidate_visit_high_confidence'") && handler.includes('data.candidate_visit_id'))
  const trigger = fs.readFileSync(new URL('../../supabase/migrations/20260923_visit_detection_stage2_confirm.sql', import.meta.url), 'utf8')
  assert.ok(trigger.includes("'candidate_visit_id', NEW.id") && trigger.includes("'to_user_id', NEW.user_id") && trigger.includes("'item_id', NEW.item_id"))
  // 5. inbox: shown; hidden once the same item was checked off elsewhere; ordered with the pushed suggestion first
  const inboxRow = { candidateVisitId: 'cv-1', itemId: EDOARDO.id, status: row.status, expiresAt: row.expires_at, confirmedAt: null, rejectedAt: null }
  const now = new Date(T0 + min(60))
  assert.equal(selectInboxRows({ rows: [inboxRow], checkedOffItemIds: new Set(), now }).length, 1)
  assert.equal(selectInboxRows({ rows: [inboxRow], checkedOffItemIds: new Set([EDOARDO.id]), now }).length, 0)
  const other = { ...inboxRow, candidateVisitId: 'cv-0', itemId: 'other' }
  assert.equal(selectInboxRows({ rows: [other, inboxRow], checkedOffItemIds: new Set(), highlightId: 'cv-1', now })[0].candidateVisitId, 'cv-1')
  // 6. seven-day boundary in the inbox
  assert.equal(selectInboxRows({ rows: [inboxRow], checkedOffItemIds: new Set(), now: new Date(T0 + min(16) + CANDIDATE_EXPIRY_MS - 1000) }).length, 1)
  assert.equal(selectInboxRows({ rows: [inboxRow], checkedOffItemIds: new Set(), now: new Date(T0 + min(16) + CANDIDATE_EXPIRY_MS) }).length, 0)
  // 7. confirm payload: standalone, exact visit link, no client-side points authority
  const payload = buildVisitConfirmationPayload({ userId: USER, itemId: EDOARDO.id, candidateVisitId: 'cv-1' })
  assert.equal(payload.list_item_id, null); assert.equal(payload.matched_candidate_visit_id, 'cv-1'); assert.equal(payload.verification_method, 'historical_visit_confirmed')
})

test('tracker registers the venue-scale radius and never falls back to the 500 m check-off radius', () => {
  const t = fs.readFileSync(new URL('./candidateVisitTracker.js', import.meta.url), 'utf8')
  assert.ok(t.includes('radius: visitGeofenceRadiusM(item)'))
  assert.ok(!/DEFAULT_GEOFENCE_RADIUS_M/.test(t), 'tracker must not fall back to the 500 m check-off radius')
})
