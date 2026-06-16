import { supabase } from './supabase'

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

export async function updateUserLifetimePoints(userId) {
  if (!userId) return
  const pts = await getUserLifetimePoints(userId)
  await supabase.from('users').update({ lifetime_points: pts }).eq('id', userId)
}
