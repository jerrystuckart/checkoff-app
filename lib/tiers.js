// Tier thresholds align with checkpoint badge awards (points_25 → Explorer, etc.)
export const TIERS = [
  { name: 'Starter',  minPoints: 0,   nextAt: 25,  bg: '#F0F0F0', text: '#6F7785' },
  { name: 'Explorer', minPoints: 25,  nextAt: 75,  bg: '#E8F4FD', text: '#185FA5' },
  { name: 'Local',    minPoints: 75,  nextAt: 300, bg: '#E8F8F2', text: '#0F6E56' },
  { name: 'Insider',  minPoints: 300, nextAt: 500, bg: '#F3E8FF', text: '#7C3AED' },
  { name: 'Legend',   minPoints: 500, nextAt: null, bg: '#FFF8E1', text: '#F5A623' },
]

export function getTierByName(name) {
  return TIERS.find(t => t.name === (name ?? 'Starter')) ?? TIERS[0]
}

export function getNextTier(tierName) {
  const idx = TIERS.findIndex(t => t.name === (tierName ?? 'Starter'))
  return idx >= 0 && idx < TIERS.length - 1 ? TIERS[idx + 1] : null
}

// Returns the DB tier object the user just crossed into, or null if no crossing.
// Expects tiers from checkoff_status_tiers: { tier_name, min_points, ... }
export function checkTierCrossing(pointsBefore, pointsAfter, tiers) {
  if (!tiers?.length || pointsAfter <= pointsBefore) return null
  const sorted = [...tiers].sort((a, b) => Number(a.min_points) - Number(b.min_points))
  const findTier = pts => [...sorted].reverse().find(t => Number(t.min_points) <= pts) ?? sorted[0]
  const before = findTier(pointsBefore)
  const after  = findTier(pointsAfter)
  if (!after || before?.tier_name === after.tier_name) return null
  return after
}

// Returns 0.0–1.0 progress within current tier toward next tier
export function getTierProgress(tierName, lifetimePoints) {
  const pts = lifetimePoints ?? 0
  const tier = getTierByName(tierName)
  const next = getNextTier(tierName)
  if (!next) return 1
  const range = next.minPoints - tier.minPoints
  return Math.min(1, Math.max(0, (pts - tier.minPoints) / range))
}
