// supabase/functions/process-notification-queue/index.ts
//
// Reads pending rows from notification_queue, fetches push tokens
// for each recipient, sends pushes via Expo Push API, and marks
// rows as processed (or logs error).
//
// Triggered by pg_cron every minute:
//   select cron.schedule(
//     'process-notification-queue',
//     '* * * * *',
//     $$select net.http_post(
//       url := 'https://uggusbbswybyplypkbxz.supabase.co/functions/v1/process-notification-queue',
//       headers := '{"Authorization":"Bearer <SUPABASE_ANON_KEY>","Content-Type":"application/json"}'::jsonb,
//       body := '{}'::jsonb
//     ) as request_id$$
//   );
//
// Deploy:
//   supabase functions deploy process-notification-queue \
//     --project-ref uggusbbswybyplypkbxz \
//     --workdir /Users/jerrystuckart/Downloads/checkoff

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_PUSH_URL    = 'https://exp.host/--/api/v2/push/send'

// Max notifications to process per invocation — keeps execution time short
const BATCH_SIZE = 50

interface NotificationRow {
  id:         string
  type:       string
  payload:    Record<string, unknown>
  created_at: string
}

interface PushMessage {
  to:    string
  title: string
  body:  string
  sound: string
  data:  Record<string, unknown>
}

// Build the push message content based on notification type
function buildMessage(row: NotificationRow, token: string): PushMessage | null {
  const p = row.payload

  if (row.type === 'check_in') {
    const fromUser  = String(p.from_user  ?? 'Your crew')
    const itemBody  = String(p.item_body  ?? 'an item')
    return {
      to:    token,
      title: `${fromUser} checked something off 🎉`,
      body:  `"${itemBody.slice(0, 80)}${itemBody.length > 80 ? '…' : ''}"`,
      sound: 'default',
      data:  {
        screen:  'List',
        list_id: p.list_id ?? null,
      },
    }
  }

  if (row.type === 'leaderboard_nudge') {
    const message   = String(p.message ?? 'Check the leaderboard!')
    const nudgeType = String(p.nudge_type ?? '')
    return {
      to:    token,
      title: nudgeType === 'being_chased' ? '👀 Someone\'s gaining on you!' : '⚡ You\'re falling behind!',
      body:  message,
      sound: 'default',
      data:  {
        screen:  'Leaderboard',
        list_id: p.list_id ?? null,
      },
    }
  }

  if (row.type === 'dare') {
    const fromName  = String(p.from_name  ?? 'Someone')
    const itemBody  = String(p.item_body  ?? 'a challenge')
    return {
      to:    token,
      title: `😈 You've been dared!`,
      body:  `${fromName} dared you: "${itemBody.slice(0, 80)}${itemBody.length > 80 ? '…' : ''}"`,
      sound: 'default',
      data:  { screen: 'Dare' },
    }
  }

  if (row.type === 'list_invite') {
    const fromName  = String(p.from_name  ?? 'Someone')
    const listTitle = String(p.list_title ?? 'a list')
    return {
      to:    token,
      title: `📋 You've been invited!`,
      body:  `${fromName} invited you to "${listTitle}"`,
      sound: 'default',
      data:  {
        screen:     'JoinList',
        invite_code: p.invite_code ?? null,
      },
    }
  }

  // Unknown type — skip
  return null
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
    auth: { persistSession: false },
  })

  // Fetch a batch of unprocessed notifications, oldest first
  const { data: rows, error: fetchErr } = await supabase
    .from('notification_queue')
    .select('id, type, payload, created_at')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchErr) {
    console.error('Failed to fetch notification queue:', fetchErr.message)
    return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 })
  }

  if (!rows?.length) {
    return new Response(JSON.stringify({ processed: 0, message: 'Queue empty' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  console.log(`Processing ${rows.length} notifications`)

  let sent    = 0
  let skipped = 0
  let errors  = 0

  for (const row of rows as NotificationRow[]) {
    const toUserId = row.payload?.to_user_id as string | undefined

    if (!toUserId) {
      // Mark as processed with a note — no recipient to send to
      await supabase
        .from('notification_queue')
        .update({ processed_at: new Date().toISOString(), error: 'No to_user_id in payload' })
        .eq('id', row.id)
      skipped++
      continue
    }

    // Fetch push tokens for the recipient
    const { data: tokenRows } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', toUserId)

    if (!tokenRows?.length) {
      // No tokens registered — user hasn't opened app since install or has revoked permission
      await supabase
        .from('notification_queue')
        .update({ processed_at: new Date().toISOString(), error: 'No push tokens for user' })
        .eq('id', row.id)
      skipped++
      continue
    }

    // Build messages for each token (user may have multiple devices)
    const messages: PushMessage[] = []
    for (const { token } of tokenRows) {
      const msg = buildMessage(row, token)
      if (msg) messages.push(msg)
    }

    if (!messages.length) {
      await supabase
        .from('notification_queue')
        .update({ processed_at: new Date().toISOString(), error: `Unknown notification type: ${row.type}` })
        .eq('id', row.id)
      skipped++
      continue
    }

    // Send to Expo Push API
    try {
      const res  = await fetch(EXPO_PUSH_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(messages.length === 1 ? messages[0] : messages),
      })

      const result = await res.json()

      // Check for Expo-level errors (invalid tokens, etc.)
      const expoErrors: string[] = []
      const resultData = Array.isArray(result.data) ? result.data : [result.data]
      for (const ticket of resultData) {
        if (ticket?.status === 'error') {
          expoErrors.push(`${ticket.message} (${ticket.details?.error ?? 'unknown'})`)

          // If token is invalid or not registered, clean it up
          if (ticket.details?.error === 'DeviceNotRegistered') {
            const badToken = messages.find(m => m.to)?.to
            if (badToken) {
              await supabase
                .from('push_tokens')
                .delete()
                .eq('token', badToken)
              console.log(`Removed invalid push token: ${badToken}`)
            }
          }
        }
      }

      await supabase
        .from('notification_queue')
        .update({
          processed_at: new Date().toISOString(),
          error: expoErrors.length > 0 ? expoErrors.join('; ') : null,
        })
        .eq('id', row.id)

      if (expoErrors.length === 0) sent++
      else errors++

    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      console.error(`Failed to send notification ${row.id}:`, errMsg)
      await supabase
        .from('notification_queue')
        .update({ processed_at: new Date().toISOString(), error: errMsg })
        .eq('id', row.id)
      errors++
    }
  }

  const summary = { processed: rows.length, sent, skipped, errors }
  console.log('Notification queue summary:', summary)

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  })
})
