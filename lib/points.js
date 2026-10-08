import { supabase } from './supabase'
import { checkTierCrossing } from './tiers'

// Thresholds must be in ascending order for correct milestone detection.
const POINT_MILESTONES = [
  { threshold:   5, badgeId: 'points_5'   },
  { threshold:  25, badgeId: 'points_25'  },
  { threshold:  75, badgeId: 'points_75'  },
  { threshold: 150, badgeId: 'points_150' },
  { threshold: 300, badgeId: 'points_300' },
  { threshold: 500, badgeId: 'points_500' },
]

// Check whether newPoints crosses any milestone the user hasn't earned yet.
// Inserts into user_badges and notification_queue for each new milestone.
// Never throws — returns empty array on any error so check-in flow is unaffected.
export async function checkAndAwardPointMilestoneBadges(userId, newPoints) {
  if (!userId || newPoints < 5) return

  try {
    const crossed = POINT_MILESTONES.filter(m => newPoints >= m.threshold)
    if (!crossed.length) return

    const crossedIds = crossed.map(m => m.badgeId)

    const { data: alreadyEarned } = await supabase
      .from('user_badges')
      .select('badge_id')
      .eq('user_id', userId)
      .in('badge_id', crossedIds)

    const earnedSet = new Set((alreadyEarned ?? []).map(b => b.badge_id))
    const toAward = crossed.filter(m => !earnedSet.has(m.badgeId))
    if (!toAward.length) return

    const now = new Date().toISOString()

    // upsert + ignoreDuplicates (ON CONFLICT DO NOTHING): this runs from several places at once (check-in
    // flows, the celebration host), and a plain insert would fail the WHOLE batch on one already-earned row.
    await supabase.from('user_badges').upsert(
      toAward.map(m => ({ user_id: userId, badge_id: m.badgeId, earned_at: now })),
      { onConflict: 'user_id,badge_id', ignoreDuplicates: true },
    )
    // Best effort only: notification_queue INSERT is admin-only under RLS, so for ordinary users this is rejected.
    // The celebration therefore reads user_badges (lib/badgeCelebrations.js), not this queue row.
    await supabase.from('notification_queue').insert(
      toAward.map(m => ({
        type:      'badge',
        payload:   { to_user_id: userId, badge_id: m.badgeId },
        delivered: false,
      }))
    )
  } catch {
    // Badge awards are non-critical — never break the check-in flow
  }
}

export async function getUserLifetimePoints(userId) {
  if (!userId) return 0
  const { data, error } = await supabase
    .from('check_ins')
    .select('points_awarded')
    .eq('user_id', userId)
  if (error || !data) return 0
  return data.reduce((sum, row) => sum + (row.points_awarded ?? 0), 0)
}

export async function getWeeklyPoints(userId, weekStart, weekEnd) {
  if (!userId) return 0
  const start = weekStart instanceof Date ? weekStart.toISOString() : weekStart
  const end   = weekEnd   instanceof Date ? weekEnd.toISOString()   : weekEnd
  const { data, error } = await supabase
    .from('check_ins')
    .select('points_awarded')
    .eq('user_id', userId)
    .gte('checked_at', start)
    .lte('checked_at', end)
  if (error || !data) return 0
  return data.reduce((sum, row) => sum + (row.points_awarded ?? 0), 0)
}

// After a check-in (where updateUserLifetimePoints already ran), checks whether the
// user crossed a tier threshold. Returns { crossedTier, newPoints } — crossedTier
// is the DB row from checkoff_status_tiers, or null if no crossing occurred.
export async function checkTierCrossingForUser(userId, pointsBefore) {
  if (!userId) return { crossedTier: null, newPoints: pointsBefore }
  try {
    const [newPoints, tiersResult] = await Promise.all([
      getUserLifetimePoints(userId),
      supabase.from('checkoff_status_tiers').select('*').order('min_points'),
    ])
    const allTiers = tiersResult.data ?? []
    const crossedTier = checkTierCrossing(pointsBefore, newPoints, allTiers)
    return { crossedTier, newPoints }
  } catch {
    return { crossedTier: null, newPoints: pointsBefore }
  }
}

export async function updateUserLifetimePoints(userId) {
  if (!userId) return
  const pts = await getUserLifetimePoints(userId)
  await supabase.from('users').update({ lifetime_points: pts }).eq('id', userId)
  await checkAndAwardPointMilestoneBadges(userId, pts)
}
