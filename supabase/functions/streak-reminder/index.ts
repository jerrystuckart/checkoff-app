// supabase/functions/streak-reminder/index.ts
//
// Runs every Saturday at 18:00 UTC via pg_cron.
// Finds all users who have an active streak but have not checked
// anything off during the current week (Monday–now). Sends each
// qualifying user one push notification warning their streak is at risk.
//
// pg_cron schedule (run once in Supabase SQL editor):
//   select cron.schedule(
//     'streak-reminder-saturday',
//     '0 18 * * 6',
//     $$select net.http_post(
//       url     := 'https://uggusbbswybyplypkbxz.supabase.co/functions/v1/streak-reminder',
//       headers := '{"Authorization":"Bearer <SUPABASE_ANON_KEY>","Content-Type":"application/json"}'::jsonb,
//       body    := '{}'::jsonb
//     ) as request_id$$
//   );
//
// Deploy:
//   supabase functions deploy streak-reminder --project-ref uggusbbswybyplypkbxz

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_PUSH_URL    = 'https://exp.host/--/api/v2/push/send'

const CHUNK = 100

Deno.serve(async () => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
      auth: { persistSession: false },
    })

    // ── 1. Current week: most recent Monday 00:00 UTC → now ─────────────────
    const now = new Date()
    const dayOfWeek = now.getUTCDay() // 0 = Sun, 1 = Mon … 6 = Sat
    const daysBackToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    const weekStart = new Date(now)
    weekStart.setUTCDate(now.getUTCDate() - daysBackToMonday)
    weekStart.setUTCHours(0, 0, 0, 0)

    console.log(`streak-reminder: week_start=${weekStart.toISOString()}, now=${now.toISOString()}`)

    // ── 2. Fetch all users with an active streak + their push tokens ─────────
    // Join users → push_tokens. For users with multiple tokens, take the most
    // recently inserted one by ordering and deduplicating in JS below.
    const { data: candidates, error: candidateErr } = await supabase
      .from('users')
      .select('id, current_streak')
      .gt('current_streak', 0)

    if (candidateErr) {
      console.error('streak-reminder: users query failed:', candidateErr.message)
      return new Response(`users query failed: ${candidateErr.message}`, { status: 500 })
    }

    if (!candidates?.length) {
      console.log('streak-reminder: no users with active streak')
      return new Response('No users with active streak', { status: 200 })
    }

    const candidateIds = candidates.map(u => u.id)
    console.log(`streak-reminder: ${candidateIds.length} users with active streak`)

    // ── 3. Find which of those users checked something off this week ─────────
    const { data: activeThisWeek, error: ciErr } = await supabase
      .from('check_ins')
      .select('user_id')
      .in('user_id', candidateIds)
      .gte('checked_at', weekStart.toISOString())

    if (ciErr) {
      console.error('streak-reminder: check_ins query failed:', ciErr.message)
      return new Response(`check_ins query failed: ${ciErr.message}`, { status: 500 })
    }

    const activeUserIds = new Set((activeThisWeek ?? []).map(ci => ci.user_id))

    // Users who have a streak but haven't checked in this week
    const qualifying = candidates.filter(u => !activeUserIds.has(u.id))

    console.log(`streak-reminder: ${qualifying.length} users qualify (no check-in this week)`)

    if (!qualifying.length) {
      return new Response('All streak holders checked in this week — no reminders needed', { status: 200 })
    }

    const qualifyingIds = qualifying.map(u => u.id)

    // ── 4. Fetch push tokens ─────────────────────────────────────────────────
    // Order by created_at desc so we can take the most recently registered
    // token per user when deduplicating below.
    const { data: tokenRows, error: tokenErr } = await supabase
      .from('push_tokens')
      .select('user_id, token')
      .in('user_id', qualifyingIds)
      .order('created_at', { ascending: false })

    if (tokenErr) {
      console.error('streak-reminder: push_tokens query failed:', tokenErr.message)
      return new Response(`push_tokens query failed: ${tokenErr.message}`, { status: 500 })
    }

    // Deduplicate: one token per user (first row = most recent, due to order above)
    const tokenMap: Record<string, string> = {}
    for (const row of (tokenRows ?? [])) {
      if (!tokenMap[row.user_id]) {
        tokenMap[row.user_id] = row.token
      }
    }

    // ── 5. Build push messages ───────────────────────────────────────────────
    const messages: Array<{
      to:       string
      title:    string
      body:     string
      sound:    string
      priority: string
      data:     Record<string, string>
    }> = []

    for (const user of qualifying) {
      const token = tokenMap[user.id]
      if (!token) continue  // no push token — skip silently

      messages.push({
        to:       token,
        title:    '🔥 Your streak is on the line',
        body:     "You haven't checked anything off this week. One check-in keeps it alive.",
        sound:    'default',
        priority: 'high',
        data:     { screen: 'Home' },
      })
    }

    if (!messages.length) {
      console.log('streak-reminder: qualifying users have no push tokens — done')
      return new Response('No push tokens for qualifying users', { status: 200 })
    }

    // ── 6. Send in batches of 100 (Expo limit) ───────────────────────────────
    let succeeded = 0
    let failed    = 0

    for (let i = 0; i < messages.length; i += CHUNK) {
      const batch = messages.slice(i, i + CHUNK)
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(batch),
        })

        if (!res.ok) {
          console.error(`streak-reminder: Expo batch ${i}–${i + batch.length} HTTP ${res.status}`)
          failed += batch.length
          continue
        }

        const result = await res.json()
        const batchErrors = (result?.data ?? []).filter((d: { status: string }) => d.status === 'error')
        succeeded += batch.length - batchErrors.length
        failed    += batchErrors.length

        if (batchErrors.length) {
          console.warn(`streak-reminder: ${batchErrors.length} push error(s) in batch ${i}:`, JSON.stringify(batchErrors))
        }
      } catch (batchErr) {
        console.error(`streak-reminder: batch ${i} threw:`, batchErr)
        failed += batch.length
      }
    }

    // ── 7. Summary log ───────────────────────────────────────────────────────
    const summary = [
      `streak-reminder complete:`,
      `  evaluated=${candidateIds.length}`,
      `  qualified=${qualifying.length}`,
      `  pushes_sent=${messages.length}`,
      `  succeeded=${succeeded}`,
      `  failed=${failed}`,
    ].join('\n')

    console.log(summary)
    return new Response(summary, { status: 200 })

  } catch (e) {
    console.error('streak-reminder: unhandled error:', e)
    return new Response(String(e), { status: 500 })
  }
})
