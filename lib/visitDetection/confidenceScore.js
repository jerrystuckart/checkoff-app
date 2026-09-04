import { supabase } from '../supabase'

// Mirrors visit_confidence_weights / visit_confidence_bands. Cached the same
// way as profiles.js — DB is the tunable source of truth.
let weightsCache = null
let bandsCache = null

async function getWeights() {
  if (weightsCache) return weightsCache
  const { data, error } = await supabase.from('visit_confidence_weights').select('key, weight')
  if (error || !data) return {}
  weightsCache = {}
  for (const row of data) weightsCache[row.key] = row.weight
  return weightsCache
}

async function getBands() {
  if (bandsCache) return bandsCache
  const { data, error } = await supabase
    .from('visit_confidence_bands')
    .select('ignore_below, medium_confidence_below, strong_candidate_below')
    .eq('id', 1)
    .maybeSingle()
  bandsCache = error || !data
    ? { ignore_below: 50, medium_confidence_below: 70, strong_candidate_below: 85 }
    : data
  return bandsCache
}

export function resetConfidenceCache() {
  weightsCache = null
  bandsCache = null
}

// signals: a subset of the visit_confidence_weights keys that fired for this
// candidate visit, e.g. { insideVenueRadius: true, exceedsCandidateDwell: true }.
// Only pass signals you actually evaluated — omitted keys contribute 0.
const SIGNAL_TO_WEIGHT_KEY = {
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

export async function computeConfidenceScore(signals) {
  const weights = await getWeights()
  let score = 0
  for (const [signalKey, weightKey] of Object.entries(SIGNAL_TO_WEIGHT_KEY)) {
    if (signals[signalKey]) score += weights[weightKey] ?? 0
  }
  return Math.max(0, Math.min(100, score))
}

// Returns one of: 'ignore' | 'medium_confidence' | 'high_confidence' | 'notify_eligible'
export async function bandForScore(score) {
  const bands = await getBands()
  if (score < bands.ignore_below) return 'ignore'
  if (score < bands.medium_confidence_below) return 'medium_confidence'
  if (score < bands.strong_candidate_below) return 'high_confidence'
  return 'notify_eligible'
}
