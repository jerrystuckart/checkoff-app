// Pure confidence math (no I/O) — shared by confidenceScore.js (DB-backed) and visitPipeline.js (tests).
export const SIGNAL_TO_WEIGHT_KEY = {
  insideVenueRadius: 'inside_venue_radius',
  exceedsCandidateDwell: 'exceeds_candidate_dwell',
  exceedsStrongDwell: 'exceeds_strong_dwell',
  stoppedNotDriving: 'stopped_not_driving',
  goodLocationAccuracy: 'good_location_accuracy',
  noCompetingVenueNearby: 'no_competing_venue_nearby',
  likelyDriveBy: 'likely_drive_by',
  overlappingVenues: 'overlapping_venues',
  poorLocationAccuracy: 'poor_location_accuracy',
}

export function scoreSignals(signals, weights) {
  let score = 0
  for (const [signalKey, weightKey] of Object.entries(SIGNAL_TO_WEIGHT_KEY)) {
    if (signals[signalKey]) score += weights?.[weightKey] ?? 0
  }
  return Math.max(0, Math.min(100, score))
}

export function bandFromScore(score, bands) {
  if (score < bands.ignore_below) return 'ignore'
  if (score < bands.medium_confidence_below) return 'medium_confidence'
  if (score < bands.strong_candidate_below) return 'high_confidence'
  return 'notify_eligible'
}
