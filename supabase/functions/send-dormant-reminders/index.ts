// supabase/functions/send-dormant-reminders/index.ts
//
// Runs daily via pg_cron. For each user with an active list they haven't
// touched in ~3 or ~7 days, sends one push notification summarising all
// their dormant lists. Records the send so it never double-fires.
//
// Deploy: supabase functions deploy send-dormant-reminders

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_PUSH_URL     = 'https://exp.host/--/api/v2/push/send'

// How many days of inactivity trigger each nudge
const NUDGE_DAYS = [3, 7] as const
type NudgeDay = typeof NUDGE_DAYS[number]

Deno.serve(async () => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
      auth: { persistSession: false },
    })

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    // ── 1. Find all active lists first, then get their members ──────────────
    // Active = ends_at is null OR ends_at >= today
    const todayStr = today.toISOString().slice(0, 10)

    const { data: activeLists, error: listErr } = await supabase
      .from('lists')
      .select('id, title, created_at, ends_at')
      .or(`ends_at.is.null,ends_at.gte.${todayStr}`)

    if (listErr) throw listErr
    if (!activeLists?.length) {
      return new Response('No active lists', { status: 200 })
    }

    const activeListIds = activeLists.map(l => l.id)

    // Build a map of list_id → list details for later use
    const listMap: Record<string, { title: string; created_at: string }> = {}
    activeLists.forEach(l => { listMap[l.id] = { title: l.title, created_at: l.created_at } })

    // Get all members of these active lists
    const { data: activeListMembers, error: lmErr } = await supabase
      .from('list_members')
      .select('user_id, list_id')
      .in('list_id', activeListIds)

    if (lmErr) throw lmErr
    if (!activeListMembers?.length) {
      return new Response('No active list members', { status: 200 })
    }

    // ── 2. Get all check-ins for these lists ─────────────────────────────────
    const listIds = [...new Set(activeListMembers.map(lm => lm.list_id))]

    const { data: listItemRows } = await supabase
      .from('list_items')
      .select('id, list_id')
      .in('list_id', listIds)

    const listItemIds = (listItemRows ?? []).map(li => li.id)

    // Map list_item_id → list_id for joining check-ins back to lists
    const listItemToListId: Record<string, string> = {}
    ;(listItemRows ?? []).forEach(li => { listItemToListId[li.id] = li.list_id })

    // Get most recent check-in per user per list
    const { data: checkIns } = listItemIds.length
      ? await supabase
          .from('check_ins')
          .select('user_id, list_item_id, checked_at')
          .in('list_item_id', listItemIds)
          .order('checked_at', { ascending: false })
      : { data: [] }

    // Build map: user_id → list_id → most recent checked_at
    const lastActivity: Record<string, Record<string, string>> = {}
    ;(checkIns ?? []).forEach(ci => {
      const listId = listItemToListId[ci.list_item_id]
      if (!listId) return
      if (!lastActivity[ci.user_id]) lastActivity[ci.user_id] = {}
      const current = lastActivity[ci.user_id][listId]
      if (!current || ci.checked_at > current) {
        lastActivity[ci.user_id][listId] = ci.checked_at
      }
    })

    // ── 3. Get unchecked item counts per list per user ───────────────────────
    // We need: total list_items for each list, and how many each user checked
    const itemsPerList: Record<string, number> = {}
    ;(listItemRows ?? []).forEach(li => {
      itemsPerList[li.list_id] = (itemsPerList[li.list_id] ?? 0) + 1
    })

    const checkedPerUserList: Record<string, Record<string, number>> = {}
    ;(checkIns ?? []).forEach(ci => {
      const listId = listItemToListId[ci.list_item_id]
      if (!listId) return
      if (!checkedPerUserList[ci.user_id]) checkedPerUserList[ci.user_id] = {}
      checkedPerUserList[ci.user_id][listId] =
        (checkedPerUserList[ci.user_id][listId] ?? 0) + 1
    })

    // ── 4. Get already-sent nudges today to avoid double-firing ─────────────
    const { data: alreadySent } = await supabase
      .from('dormant_notifications')
      .select('user_id, nudge_day')
      .eq('sent_date', todayStr)

    const sentSet = new Set(
      (alreadySent ?? []).map(r => `${r.user_id}:${r.nudge_day}`)
    )

    // ── 5. Get push tokens for all relevant users ────────────────────────────
    const allUserIds = [...new Set(activeListMembers.map(lm => lm.user_id))]

    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('user_id, token')
      .in('user_id', allUserIds)

    const tokenMap: Record<string, string[]> = {}
    ;(tokens ?? []).forEach(t => {
      if (!tokenMap[t.user_id]) tokenMap[t.user_id] = []
      tokenMap[t.user_id].push(t.token)
    })

    // ── 6. Get display names ─────────────────────────────────────────────────
    const { data: profiles } = await supabase
      .from('users')
      .select('id, display_name')
      .in('id', allUserIds)

    const nameMap: Record<string, string> = {}
    ;(profiles ?? []).forEach(p => { nameMap[p.id] = p.display_name ?? 'there' })

    // ── 7. Build per-user nudge decisions ────────────────────────────────────
    // Group active lists by user
    const userLists: Record<string, Array<{ listId: string; title: string; createdAt: string }>> = {}
    activeListMembers.forEach(lm => {
      const list = listMap[lm.list_id]
      if (!list) return
      if (!userLists[lm.user_id]) userLists[lm.user_id] = []
      userLists[lm.user_id].push({
        listId:    lm.list_id,
        title:     list.title ?? 'your list',
        createdAt: list.created_at,
      })
    })

    const toSend: Array<{
      userId:   string
      nudgeDay: NudgeDay
      tokens:   string[]
      title:    string
      body:     string
    }> = []

    const notifLog: Array<{ user_id: string; nudge_day: number }> = []

    for (const userId of Object.keys(userLists)) {
      const userTokens = tokenMap[userId]
      if (!userTokens?.length) continue  // no push token, skip

      const firstName = (nameMap[userId] ?? 'there').split(' ')[0]
      const lists     = userLists[userId]

      // For each nudge threshold, check if this user qualifies
      for (const nudgeDay of NUDGE_DAYS) {
        if (sentSet.has(`${userId}:${nudgeDay}`)) continue  // already sent today

        // Find which of the user's lists are dormant at this threshold
        const dormant = lists.filter(l => {
          const baseline = lastActivity[userId]?.[l.listId] ?? l.createdAt
          const lastMs   = new Date(baseline).getTime()
          const daysAgo  = (Date.now() - lastMs) / (1000 * 60 * 60 * 24)
          // Match within a ±0.5 day window around the threshold
          return daysAgo >= nudgeDay - 0.5 && daysAgo < nudgeDay + 0.5
        })

        if (!dormant.length) continue

        // Count remaining items across all dormant lists for this user
        const totalItems = dormant.reduce((sum, l) => {
          const total   = itemsPerList[l.listId]             ?? 0
          const checked = checkedPerUserList[userId]?.[l.listId] ?? 0
          return sum + Math.max(0, total - checked)
        }, 0)

        if (totalItems === 0) continue  // all done, no nudge needed

        // Build notification copy
        let notifTitle: string
        let notifBody:  string

        if (dormant.length === 1) {
          const listTitle = dormant[0].title
          if (nudgeDay === 3) {
            notifTitle = '⏰ Don\'t lose your momentum'
            notifBody  = `${listTitle} has ${totalItems} item${totalItems !== 1 ? 's' : ''} left. Get back out there, ${firstName}.`
          } else {
            notifTitle = `👀 ${firstName}, your crew is still going`
            notifBody  = `${listTitle} has ${totalItems} item${totalItems !== 1 ? 's' : ''} left. Pick one and go.`
          }
        } else {
          if (nudgeDay === 3) {
            notifTitle = '⏰ Don\'t lose your momentum'
            notifBody  = `You've got ${totalItems} items left across ${dormant.length} lists. Pick one and go.`
          } else {
            notifTitle = `👀 ${firstName}, your crew is still going`
            notifBody  = `${totalItems} items across ${dormant.length} lists are waiting. Don't let your crew pull ahead.`
          }
        }

        toSend.push({ userId, nudgeDay, tokens: userTokens, title: notifTitle, body: notifBody })
        notifLog.push({ user_id: userId, nudge_day: nudgeDay, sent_date: todayStr })

        // Only send ONE nudge threshold per user per run
        // (prefer the lower threshold if both somehow match)
        break
      }
    }

    if (!toSend.length) {
      return new Response('No dormant users to nudge today', { status: 200 })
    }

    // ── 8. Send push notifications via Expo ──────────────────────────────────
    const messages = toSend.flatMap(({ tokens, title, body, nudgeDay }) =>
      tokens.map(token => ({
        to:       token,
        title,
        body,
        sound:    'default',
        priority: nudgeDay === 7 ? 'high' : 'normal',
        data:     { screen: 'Home' },
      }))
    )

    const CHUNK = 100
    for (let i = 0; i < messages.length; i += CHUNK) {
      await fetch(EXPO_PUSH_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(messages.slice(i, i + CHUNK)),
      })
    }

    // ── 9. Log sends to prevent double-firing ────────────────────────────────
    if (notifLog.length) {
      await supabase.from('dormant_notifications').insert(notifLog)
    }

    const summary = `Sent ${messages.length} push notification${messages.length !== 1 ? 's' : ''} to ${toSend.length} user${toSend.length !== 1 ? 's' : ''}`
    console.log(summary)
    return new Response(summary, { status: 200 })

  } catch (e) {
    console.error('send-dormant-reminders error:', e)
    return new Response(String(e), { status: 500 })
  }
})