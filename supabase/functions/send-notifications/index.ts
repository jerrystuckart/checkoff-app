// Supabase Edge Function: send-notification
// Deploy: supabase functions deploy send-notification
//
// Drains notification_queue and sends via Expo Push API.
// Handles: check_in, badge, dare, leaderboard_nudge,
//          weekly_summary, promotion

import { createClient } from 'npm:@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

const BADGE_NAMES = {
  first_checkin:      { name: 'On the Board',     icon: '🥇' },
  checkins_10:        { name: 'Getting Serious',   icon: '🔟' },
  checkins_25:        { name: 'Local Legend',      icon: '💯' },
  checkins_50:        { name: 'CheckOff Royalty',  icon: '🏆' },
  checkins_100:       { name: 'Centurion',         icon: '👑' },
  neighborhood_sweep: { name: 'Hood Hero',         icon: '📍' },
  seasonal_sweep:     { name: 'Season Complete',   icon: '☀'  },
  on_fire:            { name: 'On Fire',           icon: '🔥' },
  crew_builder:       { name: 'Crew Builder',      icon: '👥' },
  speed_run:          { name: 'Speed Run',         icon: '⚡' },
  night_owl:          { name: 'Night Owl',         icon: '🌙' },
  streak_3:           { name: '3-Week Streak',     icon: '📅' },
  streak_8:           { name: '2-Month Streak',    icon: '🗓' },
  dare_accepted:      { name: 'Dare Accepted',     icon: '💪' },
  dare_issued:        { name: 'Dare Master',       icon: '😈' },
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  )

  const { data: queue, error } = await supabase
    .from('notification_queue')
    .select('*')
    .is('processed_at', null)
    .order('created_at')
    .limit(100)

  if (error || !queue?.length) {
    return new Response(JSON.stringify({ processed: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let sent = 0, failed = 0

  for (const item of queue) {
    try {
      const p        = item.payload
      const toUserId = p.to_user_id

      const { data: tokens } = await supabase
        .from('push_tokens')
        .select('token')
        .eq('user_id', toUserId)

      if (!tokens?.length) {
        await markProcessed(supabase, item.id, 'no_token')
        continue
      }

      let title = 'CheckOff'
      let body  = ''
      let data  = {}

      if (item.type === 'check_in') {
        const short = (p.item_body || '').length > 50 ? p.item_body.slice(0, 47) + '…' : p.item_body
        title = `${p.from_user} checked something off`
        body  = `"${short}"`
        data  = { screen: 'List', listId: p.list_id }

      } else if (item.type === 'badge') {
        const b = BADGE_NAMES[p.badge_id] || { name: 'New badge', icon: '🏅' }
        title = `${b.icon} Badge unlocked!`
        body  = b.name
        data  = { screen: 'Badges' }

      } else if (item.type === 'dare') {
        const shortItem = (p.item_body || '').length > 40 ? p.item_body.slice(0, 37) + '…' : p.item_body
        title = `${p.from_user} dared you 😈`
        body  = p.message ? `"${p.message}" — ${shortItem}` : `Can you check off: "${shortItem}"?`
        data  = { screen: 'Dare', dareId: p.dare_id }

      } else if (item.type === 'leaderboard_nudge') {
        title = 'Leaderboard update 🔥'
        body  = p.message || 'Someone is making a move on the leaderboard'
        data  = { screen: 'List', listId: p.list_id }

      } else if (item.type === 'weekly_summary') {
        const diff = (p.this_week || 0) - (p.last_week || 0)
        if (diff > 0) {
          title = `🔥 ${p.this_week} check-offs this week!`
          body  = `Up ${diff} from last week. Keep the streak going.`
        } else {
          title = `${p.this_week} check-offs this week`
          body  = diff < 0 ? 'Slower than last week — get out there!' : 'Same pace as last week. Push for more!'
        }
        data = { screen: 'Home' }

      } else if (item.type === 'promotion') {
        title = p.title || 'Special offer near you'
        body  = p.body  || 'Tap to see details'
        data  = { screen: 'Promotion', promotionId: p.promotion_id }

      } else {
        await markProcessed(supabase, item.id, 'unknown_type')
        continue
      }

      const messages = tokens.map(t => ({
        to: t.token, sound: 'default', title, body, data, badge: 1,
      }))

      const res    = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Accept':        'application/json',
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}`,
        },
        body: JSON.stringify(messages),
      })

      const result = await res.json()
      const hasErr = (result?.data || []).some(d => d.status === 'error')

      await supabase.from('notification_log').insert({
        user_id: toUserId, type: item.type, title, body, data,
        status: hasErr ? 'failed' : 'sent',
      })

      await markProcessed(supabase, item.id, hasErr ? JSON.stringify(result) : null)
      hasErr ? failed++ : sent++

    } catch (e) {
      await markProcessed(supabase, item.id, String(e))
      failed++
    }
  }

  return new Response(
    JSON.stringify({ processed: queue.length, sent, failed }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})

async function markProcessed(supabase, id, error) {
  await supabase
    .from('notification_queue')
    .update({ processed_at: new Date().toISOString(), error })
    .eq('id', id)
}
