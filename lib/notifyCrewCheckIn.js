import { supabase } from './supabase'

const DIFFICULTY_LABELS = { 5: 'Partner', 10: 'Rare', 25: 'Legend' }
const DIFFICULTY_EMOJI  = { 5: '📍',      10: '⭐',    25: '🏆' }

/**
 * notifyCrewCheckIn
 *
 * Called after a successful Partner (5pt), Rare (10pt), or Legend (25pt) check-in.
 * Looks up all other crew members on the same list, fetches their
 * push tokens, and sends an Expo push notification to each.
 *
 * @param {object} params
 * @param {string} params.listItemId  - The list_item row id that was checked off
 * @param {string} params.itemBody    - Display text of the item
 * @param {number} params.difficulty  - 5, 10, or 25
 * @param {string|null} params.checkInId - check_ins row id (for future deep link)
 */
export async function notifyCrewCheckIn({ listItemId, itemBody, difficulty, checkInId }) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const tierLabel = DIFFICULTY_LABELS[difficulty] ?? 'Partner'
    const tierEmoji = DIFFICULTY_EMOJI[difficulty]  ?? '📍'

    // Get the checker's display name
    const { data: profile } = await supabase
      .from('users')
      .select('display_name')
      .eq('id', user.id)
      .single()

    const checkerName = profile?.display_name ?? 'Someone'

    // Find the list this list_item belongs to
    const { data: listItem } = await supabase
      .from('list_items')
      .select('list_id')
      .eq('id', listItemId)
      .single()

    if (!listItem?.list_id) return

    // Get all other members of this list
    const { data: members } = await supabase
      .from('list_members')
      .select('user_id')
      .eq('list_id', listItem.list_id)
      .neq('user_id', user.id)

    if (!members?.length) return

    const memberIds = members.map(m => m.user_id)

    // Get their push tokens
    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .in('user_id', memberIds)

    if (!tokens?.length) return

    // Build notification payload
    const title = `${tierEmoji} ${tierLabel} check-in!`
    const body  = `${checkerName} just checked off "${itemBody.slice(0, 60)}${itemBody.length > 60 ? '…' : ''}"`

    // Send via Expo push service
    const messages = tokens.map(({ token }) => ({
      to: token,
      title,
      body,
      sound: 'default',
      data: {
        screen: 'Leaderboard',
        listId: listItem.list_id,
        checkInId: checkInId ?? null,
      },
      // High priority for Legend, normal for Partner/Rare
      priority: difficulty === 25 ? 'high' : 'normal',
    }))

    // Batch in chunks of 100 (Expo push limit)
    const CHUNK = 100
    for (let i = 0; i < messages.length; i += CHUNK) {
      const chunk = messages.slice(i, i + CHUNK)
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      })
    }
  } catch (e) {
    // Non-critical — app works fine if notification fails
    console.warn('notifyCrewCheckIn failed:', e.message)
  }
}
