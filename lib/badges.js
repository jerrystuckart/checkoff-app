/**
 * pollForNewBadges
 *
 * After a check-in completes, call this to drain any undelivered badge
 * notifications from notification_queue for the current user.
 *
 * Returns an array of badge definition objects ready for BadgeCelebrationModal.
 * Never throws — always returns [] on any error so the check-in flow is unaffected.
 */
export async function pollForNewBadges(userId, supabase) {
  if (!userId) return []

  try {
    // 1. Grab up to 5 undelivered badge notifications for this user
    const { data: notifications, error: queueErr } = await supabase
      .from('notification_queue')
      .select('id, payload')
      .eq('type', 'badge')
      .eq('payload->>to_user_id', userId)
      .eq('delivered', false)
      .order('created_at', { ascending: true })
      .limit(5)

    if (queueErr || !notifications || notifications.length === 0) return []

    // 2. Mark them delivered immediately so a second poll won't re-show them
    const ids = notifications.map(n => n.id)
    await supabase
      .from('notification_queue')
      .update({ delivered: true })
      .in('id', ids)

    // 3. Fetch the badge definitions for display
    const badgeIds = notifications.map(n => n.payload.badge_id)
    const { data: badges } = await supabase
      .from('badge_definitions')
      .select('id, name, description, icon')
      .in('id', badgeIds)

    return badges || []
  } catch {
    return []
  }
}
