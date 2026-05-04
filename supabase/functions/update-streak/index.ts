// supabase/functions/update-streak/index.ts
//
// Called after every successful check-in from useItems.checkOff()
// and PhotoCheckInScreen.submitCheckIn().
//
// Reads the user's last_checkin_week, determines if this is a new week,
// and increments or resets current_streak accordingly.
// Updates longest_streak if the new streak beats the record.
//
// ISO week format: "2026-W17"
//
// Deploy: supabase functions deploy update-streak --workdir /Users/jerrystuckart/Downloads/checkoff --project-ref uggusbbswybyplypkbxz

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function getISOWeek(date: Date): string {
  // Returns "YYYY-WNN" for the ISO week containing date
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7  // treat Sunday as 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function getPrevISOWeek(weekStr: string): string {
  // Returns the ISO week string for the week before weekStr
  const [yearStr, wStr] = weekStr.split('-W')
  let year = parseInt(yearStr)
  let week = parseInt(wStr)
  week -= 1
  if (week < 1) {
    year -= 1
    // Last week of previous year — compute it
    const dec28 = new Date(Date.UTC(year, 11, 28))
    const prevYearStart = new Date(Date.UTC(year, 0, 1))
    week = Math.ceil((((dec28.getTime() - prevYearStart.getTime()) / 86400000) + 1) / 7)
  }
  return `${year}-W${String(week).padStart(2, '0')}`
}

Deno.serve(async (req) => {
  try {
    const { user_id } = await req.json()
    if (!user_id) {
      return new Response('Missing user_id', { status: 400 })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
      auth: { persistSession: false },
    })

    // Fetch current streak data
    const { data: profile, error: profileErr } = await supabase
      .from('users')
      .select('current_streak, longest_streak, last_checkin_week')
      .eq('id', user_id)
      .single()

    if (profileErr) throw profileErr

    const thisWeek     = getISOWeek(new Date())
    const lastWeek     = profile.last_checkin_week ?? null
    const curStreak    = profile.current_streak    ?? 0
    const longestStreak = profile.longest_streak   ?? 0

    // Already recorded this week — nothing to update
    if (lastWeek === thisWeek) {
      return new Response(
        JSON.stringify({ streak: curStreak, updated: false }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Determine new streak value
    let newStreak: number
    const prevWeek = getPrevISOWeek(thisWeek)

    if (lastWeek === prevWeek) {
      // Consecutive week — extend streak
      newStreak = curStreak + 1
    } else {
      // Gap of more than one week — reset to 1
      newStreak = 1
    }

    const newLongest = Math.max(newStreak, longestStreak)

    const { error: updateErr } = await supabase
      .from('users')
      .update({
        current_streak:    newStreak,
        longest_streak:    newLongest,
        last_checkin_week: thisWeek,
      })
      .eq('id', user_id)

    if (updateErr) throw updateErr

    return new Response(
      JSON.stringify({ streak: newStreak, longest: newLongest, updated: true, week: thisWeek }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    console.error('update-streak error:', e)
    return new Response(String(e), { status: 500 })
  }
})
