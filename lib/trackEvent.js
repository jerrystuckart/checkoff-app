import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

const DEBOUNCE_MS = 30 * 60 * 1000
const DEBOUNCED_TYPES = new Set(['list_view', 'item_view'])

/**
 * trackEvent(eventType, { listId, itemId })
 *
 * Fire-and-forget interaction logging for partner engagement reporting.
 * Never throws, never blocks — call without awaiting.
 *
 * 'list_view' and 'item_view' are debounced per subject (listId or
 * itemId) to 1 insert per 30 minutes via AsyncStorage; clicks
 * ('url_click', 'directions_click', 'dare_click') always log.
 */
export async function trackEvent(eventType, { listId, itemId } = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return

    const debounced = DEBOUNCED_TYPES.has(eventType)
    let debounceKey = null

    if (debounced) {
      debounceKey = `evt:${eventType}:${listId ?? itemId ?? ''}`
      const last = await AsyncStorage.getItem(debounceKey)
      if (last && Date.now() - Number(last) < DEBOUNCE_MS) return
    }

    const { error } = await supabase.from('interaction_events').insert({
      user_id:    user.id,
      event_type: eventType,
      list_id:    listId ?? null,
      item_id:    itemId ?? null,
    })
    if (error) throw error

    if (debounced) await AsyncStorage.setItem(debounceKey, String(Date.now()))
  } catch (e) {
    console.warn('trackEvent:', eventType, e?.message ?? e)
  }
}
