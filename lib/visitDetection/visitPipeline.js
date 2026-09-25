// Pure decision logic for the whole on-device visit pipeline, extracted from
// candidateVisitTracker.js (which imports React Native / expo native modules
// and therefore cannot run under `node --test`). Everything here is
// deterministic and I/O-free so realistic fixtures (a Florence restaurant, a
// gelato counter, dense overlapping venues) can be pushed through every stage
// and the links between stages verified. The tracker only does I/O around it.
import { scoreSignals, bandFromScore } from './confidenceMath.js'
import { haversineMeters } from '../distance.js'

// A visit is "time spent AT the venue", not time inside a check-off-sized
// circle. The check-off gate (lib/geoFence.js) uses a 500 m default, which in
// central Florence spans dozens of catalog venues at once: walking around the
// Duomo area for an hour would register an hour-long "visit" to every
// restaurant within 500 m. Visit geofences therefore use their own, much
// tighter radius (iOS's practical minimum is ~100 m).
export const VISIT_GEOFENCE_DEFAULT_RADIUS_M = 120
export const VISIT_GEOFENCE_MAX_RADIUS_M = 200

// Product requirement: a qualified visit can be checked off from elsewhere for
// seven days. Server enforces via candidate_visits.expires_at.
export const CANDIDATE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

// iOS re-delivers "enter" for regions the device is already inside whenever
// the monitored set is re-registered (every foreground refresh). An existing
// arrival record newer than this is the real arrival and must not be reset;
// older than this is a stale leftover from a missed exit (force-quit etc.).
export const MAX_ARRIVAL_AGE_MS = 8 * 60 * 60 * 1000
export const MAX_PLAUSIBLE_DWELL_MIN = 8 * 60

export const ACCURACY_GOOD_M = 20
export const ACCURACY_POOR_M = 65
export const STOPPED_SPEED_MPS = 1.5

export function visitGeofenceRadiusM(item) {
  const r = item?.geo_radius_m
  if (typeof r === 'number' && r > 0) return Math.min(r, VISIT_GEOFENCE_MAX_RADIUS_M)
  return VISIT_GEOFENCE_DEFAULT_RADIUS_M
}

function isVisitCapable(item, profiles) {
  if (!item || item.is_universal || item.is_active === false) return false
  if (item.maps_lat == null || item.maps_lng == null) return false
  const profile = item.visit_profile_key ? profiles?.[item.visit_profile_key] : null
  return !!profile && !profile.manual_only
}

// Two catalog items closer than this are the same physical place (a bar and
// a dish at the same address): visiting one is visiting both, so they never
// count against each other.
export const SAME_VENUE_TOLERANCE_M = 25
// A DIFFERENT venue whose center is within this distance can't be told apart
// from this one with phone GPS (typical urban error is 20-65 m; see
// ACCURACY_POOR_M) — the attribution is ambiguous, so no reminder is sent
// (the suggestion still lands in the inbox for the user to judge). Chosen from
// the actual Florence catalog: 53 of 90 visit-capable items stay unambiguous;
// at 120 m only 31 would, at "circles overlap" (240 m) only 3.
export const COMPETING_VENUE_DISTANCE_M = 80

/** Other visit-capable, DIFFERENT venues close enough that an entry can't be attributed to just this one. */
export function findCompetingVenues(item, others, profiles) {
  return (others ?? []).filter((o) => {
    if (!o || o.id === item.id || !isVisitCapable(o, profiles)) return false
    const d = haversineMeters(item.maps_lat, item.maps_lng, o.maps_lat, o.maps_lng)
    return d >= SAME_VENUE_TOLERANCE_M && d < COMPETING_VENUE_DISTANCE_M
  })
}

/** GPS-noise-tolerant "is this fix still at the venue": within the visit radius plus the fix's own reported accuracy (capped at 50 m). */
export function isFixInsideVenue(fix, item) {
  const d = haversineMeters(fix.latitude, fix.longitude, item.maps_lat, item.maps_lng)
  const slack = Math.min(Math.max(fix.accuracy ?? 0, 0), 50)
  return d <= visitGeofenceRadiusM(item) + slack
}

/** Decides what an "enter" event does to any stored arrival record. */
export function resolveEnterArrival(existingRaw, nowMs) {
  const existing = Number(existingRaw)
  if (existingRaw != null && Number.isFinite(existing) && existing > 0 && nowMs - existing >= 0 && nowMs - existing < MAX_ARRIVAL_AGE_MS) {
    return { arrivalMs: existing, kept: true }
  }
  return { arrivalMs: nowMs, kept: false }
}

export function signalsForDeparture({ dwellMinutes, profile, exitFix, competingCount }) {
  const accuracyM = exitFix?.accuracy ?? null
  const speedMps = exitFix?.speed ?? null
  return {
    insideVenueRadius: true,
    exceedsCandidateDwell: true,
    exceedsStrongDwell: dwellMinutes >= profile.strong_dwell_minutes,
    goodLocationAccuracy: accuracyM != null && accuracyM >= 0 && accuracyM <= ACCURACY_GOOD_M,
    poorLocationAccuracy: accuracyM != null && accuracyM > ACCURACY_POOR_M,
    stoppedNotDriving: speedMps != null && speedMps >= 0 && speedMps < STOPPED_SPEED_MPS,
    // Unknown (neighbor lookup failed) sets neither.
    noCompetingVenueNearby: competingCount === 0,
    overlappingVenues: competingCount != null && competingCount > 0,
  }
}

/**
 * The single departure -> candidate decision. Returns either a discard with a
 * reason, or the exact candidate_visits row the tracker inserts.
 */
export function evaluateDeparture({ userId, item, profile, arrivalMs, departureMs, exitFix, competingCount, weights, bands }) {
  if (!profile || profile.manual_only) return { outcome: 'discard', reason: 'manual_only_or_no_profile' }
  const dwellMinutes = (departureMs - arrivalMs) / 60000
  if (!(dwellMinutes >= 0)) return { outcome: 'discard', reason: 'negative_dwell' }
  if (dwellMinutes > MAX_PLAUSIBLE_DWELL_MIN) return { outcome: 'discard', reason: 'implausible_dwell', dwellMinutes }
  if (dwellMinutes < profile.candidate_dwell_minutes) return { outcome: 'discard', reason: 'below_candidate_dwell', dwellMinutes }

  const signals = signalsForDeparture({ dwellMinutes, profile, exitFix, competingCount })
  const score = scoreSignals(signals, weights)
  const band = bandFromScore(score, bands)
  if (band === 'ignore') return { outcome: 'discard', reason: 'below_ignore_band', score, dwellMinutes }

  const dwellRounded = Math.round(dwellMinutes * 10) / 10
  return {
    outcome: 'candidate',
    score,
    band,
    signals,
    row: {
      user_id: userId,
      item_id: item.id,
      visit_profile_key: item.visit_profile_key,
      arrival_at: new Date(arrivalMs).toISOString(),
      departure_at: new Date(departureMs).toISOString(),
      dwell_minutes: dwellRounded,
      detection_method: 'geofence_dwell',
      confidence_score: score,
      // Both the 70-84 and >=85 bands are stored as 'high_confidence'; the
      // notify trigger re-derives from confidence_score, not this column.
      status: band === 'notify_eligible' ? 'high_confidence' : band,
      expires_at: new Date(departureMs + CANDIDATE_EXPIRY_MS).toISOString(),
      metadata: { profileKey: item.visit_profile_key, competingVenueCount: competingCount ?? null },
    },
  }
}

/**
 * JS mirror of SQL max_plausible_candidate_visit_score() (the candidate_visits
 * INSERT plausibility ceiling, supabase/migrations/20260927). SQL and JS can't
 * share code, so visitPipeline.test.js asserts every candidate this module can
 * produce stays at or under this ceiling — the guard against the two drifting
 * apart (a drift silently drops legitimate visits at RLS).
 */
export function maxPlausibleCandidateScore({ profile, dwellMinutes, weights }) {
  if (!profile || profile.manual_only || dwellMinutes == null || dwellMinutes < profile.candidate_dwell_minutes) return 0
  const w = (k) => weights?.[k] ?? 0
  const total = w('inside_venue_radius') + w('exceeds_candidate_dwell')
    + (dwellMinutes >= profile.strong_dwell_minutes ? w('exceeds_strong_dwell') : 0)
    + w('good_location_accuracy') + w('stopped_not_driving') + w('no_competing_venue_nearby')
  return Math.min(100, total)
}
