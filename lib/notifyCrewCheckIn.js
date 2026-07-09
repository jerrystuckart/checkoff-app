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

    // Get list metadata — seasonal lists (is_official=true) require a friendship check
    const { data: listMeta } = await supabase
      .from('lists')
      .select('is_official')
      .eq('id', listItem.list_id)
      .single()

    // Get all other members of this list
    const { data: members } = await supabase
      .from('list_members')
      .select('user_id')
      .eq('list_id', listItem.list_id)
      .neq('user_id', user.id)

    if (!members?.length) return

    let memberIds = members.map(m => m.user_id)

    // For seasonal/official lists: only notify people who share at least one
    // non-seasonal list with the checker. Being on the same open seasonal list
    // is not enough on its own to constitute a "friendship."
    if (listMeta?.is_official) {
      // Find every non-seasonal list the checker belongs to
      const { data: myPrivateLists } = await supabase
        .from('list_members')
        .select('list_id, lists!inner(is_official)')
        .eq('user_id', user.id)
        .eq('lists.is_official', false)

      const myPrivateListIds = (myPrivateLists ?? []).map(r => r.list_id)
      if (!myPrivateListIds.length) return   // checker has no private lists → no friends

      // Of the seasonal list members, keep only those who share a private list
      const { data: friends } = await supabase
        .from('list_members')
        .select('user_id')
        .in('list_id', myPrivateListIds)
        .in('user_id', memberIds)

      memberIds = [...new Set((friends ?? []).map(m => m.user_id))]
      if (!memberIds.length) return
    }

    // Get their push tokens
    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .in('user_id', memberIds)

    if (!tokens?.length) return

    // Fetch personal memory from the check-in row if we have a checkInId
    let personalPlace = null
    let personalNote  = null
    if (checkInId) {
      const { data: ciRow } = await supabase
        .from('check_ins')
        .select('personal_place, personal_note')
        .eq('id', checkInId)
        .maybeSingle()
      personalPlace = ciRow?.personal_place ?? null
      personalNote  = ciRow?.personal_note  ?? null
    }

    // Build notification body — append memory line if present
    const truncNote = personalNote && personalNote.length > 60
      ? personalNote.slice(0, 60) + '…'
      : personalNote

    const memoryLine = personalPlace && truncNote
      ? `\n📍 ${personalPlace} · ${truncNote}`
      : personalPlace
        ? `\n📍 ${personalPlace}`
        : truncNote
          ? `\n💬 ${truncNote}`
          : ''

    // Build notification payload
    const title = `${tierEmoji} ${tierLabel} check-in!`
    const body  = `${checkerName} just checked off "${itemBody.slice(0, 60)}${itemBody.length > 60 ? '…' : ''}"${memoryLine}`

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
