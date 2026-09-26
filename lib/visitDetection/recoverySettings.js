import { supabase } from '../supabase'
import { requestBackgroundLocationPermission } from './permissions'

// Tiny change bus so the tracker (mounted once in App.jsx) reacts immediately
// when the user turns the feature on or off in Profile.
const listeners = new Set()
export function subscribeRecoveryChange(cb) { listeners.add(cb); return () => listeners.delete(cb) }
function emit(event) { listeners.forEach((cb) => { try { cb(event) } catch {} }) }

export async function fetchOptIn(userId) {
  if (!userId) return false
  const { data } = await supabase.from('visit_recovery_settings').select('opted_in').eq('user_id', userId).maybeSingle()
  return data?.opted_in === true
}

/** Records consent, then asks for background location (foreground first). Returns { optedIn, permission }. */
export async function enableVisitRecovery(userId) {
  const { error } = await supabase
    .from('visit_recovery_settings')
    .upsert({ user_id: userId, opted_in: true, opted_in_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw error
  const permission = await requestBackgroundLocationPermission()
  emit({ type: 'changed' })
  return { optedIn: true, permission }
}

/** Opts out AND deletes the user's retained visit data (server RPC); confirmed check-offs are untouched. */
export async function turnOffVisitRecovery() {
  const { data, error } = await supabase.rpc('turn_off_visit_recovery')
  if (error) throw error
  emit({ type: 'turned_off' })
  return data
}

export async function countPendingSuggestions(userId) {
  if (!userId) return 0
  const { count } = await supabase
    .from('candidate_visits')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['candidate', 'medium_confidence', 'high_confidence'])
    .gt('expires_at', new Date().toISOString())
  return count ?? 0
}
