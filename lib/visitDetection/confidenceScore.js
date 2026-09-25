import { supabase } from '../supabase'
import { scoreSignals, bandFromScore } from './confidenceMath'
export { scoreSignals, bandFromScore }

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

export async function loadConfidenceConfig() {
  return { weights: await getWeights(), bands: await getBands() }
}

export async function computeConfidenceScore(signals) {
  return scoreSignals(signals, await getWeights())
}

// Returns one of: 'ignore' | 'medium_confidence' | 'high_confidence' | 'notify_eligible'
export async function bandForScore(score) {
  return bandFromScore(score, await getBands())
}
