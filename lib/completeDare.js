import { supabase } from './supabase'

/**
 * completeDare(userId, itemId)
 *
 * Called after a user successfully checks off an item.
 * Finds any active (accepted) dare where this user is the recipient
 * for this item, marks it completed, and notifies the darer.
 * Fire-and-forget safe — check-in flow continues even if this fails.
 */
export async function completeDare(userId, itemId) {
  try {
    const { data: activeDares } = await supabase
      .from('dares')
      .select('id, from_user_id, item:items(body), from:users!dares_from_user_id_fkey(display_name)')
      .eq('to_user_id', userId)
      .eq('item_id', itemId)
      .eq('status', 'accepted')

    if (!activeDares?.length) return

    const dareIds = activeDares.map(d => d.id)
    await supabase
      .from('dares')
      .update({ status: 'completed' })
      .in('id', dareIds)

    // Get the completer's name for the notification
    const { data: completer } = await supabase
      .from('users')
      .select('display_name')
      .eq('id', userId)
      .single()
    const completerName = completer?.display_name ?? 'Someone'

    // Notify each darer — dedupe by from_user_id
    const uniqueFromIds = [...new Set(activeDares.map(d => d.from_user_id))]
    const itemBody = activeDares[0]?.item?.body ?? 'the challenge'

    for (const fromUserId of uniqueFromIds) {
      const { data: tokens } = await supabase
        .from('push_tokens')
        .select('token')
        .eq('user_id', fromUserId)
      if (!tokens?.length) continue

      const messages = tokens.map(({ token }) => ({
        to:    token,
        title: '🏆 Dare completed!',
        body:  `${completerName} completed your dare: "${itemBody.slice(0, 60)}${itemBody.length > 60 ? '…' : ''}"`,
        sound: 'default',
        data:  { screen: 'Dare' },
      }))

      await fetch('https://exp.host/--/api/v2/push/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(messages),
      })
    }
  } catch (e) {
    console.warn('completeDare error:', e.message)
  }
}
