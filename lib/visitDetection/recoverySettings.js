import { supabase } from '../supabase'
import { requestBackgroundLocationPermission } from './permissions'
import { countActionableCandidates } from './actionableCandidates'

// Tiny change bus so the tracker (mounted once in App.jsx) reacts immediately
// when the user turns the feature on or off in Profile.
const listeners = new Set()
export function subscribeRecoveryChange(cb) { listeners.add(cb); return () => listeners.delete(cb) }
function emit(event) { listeners.forEach((cb) => { try { cb(event) } catch {} }) }

// Separate bus for "the set of actionable suggestions may have changed" (confirmed, dismissed, or the place was checked off
// by hand). Deliberately NOT the recovery-change bus: the tracker listens to that one and would re-register geofences.
const candidateListeners = new Set()
export function subscribeCandidatesChange(cb) { candidateListeners.add(cb); return () => candidateListeners.delete(cb) }
export function emitCandidatesChanged() { candidateListeners.forEach((cb) => { try { cb({ type: 'candidates_changed' }) } catch {} }) }

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

// Badge count = exactly the cards the inbox would show (see actionableCandidates.js). A failure returns 0 rather than a wrong number.
export async function countPendingSuggestions(userId) {
  if (!userId) return 0
  try { return await countActionableCandidates(supabase, userId) } catch { return 0 }
}
