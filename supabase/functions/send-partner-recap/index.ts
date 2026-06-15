// supabase/functions/send-partner-recap/index.ts
//
// Sends each active partner a monthly performance recap for the calendar month
// that just ended. Designed to fire on the 1st of every month at 7am UTC.
//
// Two call modes:
//   1. Cron (no body):          processes all active partners
//   2. Manual test:  POST { partner_id: "uuid" }  → sends to one partner only
//
// pg_cron schedule (run once in Supabase SQL editor):
//   select cron.schedule(
//     'send-partner-recap',
//     '0 7 1 * *',
//     $$select net.http_post(
//       url    := 'https://uggusbbswybyplypkbxz.supabase.co/functions/v1/send-partner-recap',
//       headers := '{"Authorization":"Bearer <SUPABASE_ANON_KEY>","Content-Type":"application/json"}'::jsonb,
//       body   := '{}'::jsonb
//     ) as request_id$$
//   );
//
// Required secrets (all already set):
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL   (defaults to hello@getcheckoff.com)
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// Deploy:
//   supabase functions deploy send-partner-recap --project-ref uggusbbswybyplypkbxz

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL   = Deno.env.get('RESEND_FROM_EMAIL') ?? 'hello@getcheckoff.com'

const TIER_COLOR: Record<string, string> = {
  legend:  '#8B5CF6',
  rare:    '#F5A623',
  partner: '#378ADD',
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Returns ISO date string for the first moment of the given month (UTC). */
function monthStart(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 1)).toISOString()
}

/** Returns { lastMonth, prevMonth } windows for the month-over-month comparison.
 *  Both windows are exclusive-end (start of next month). */
function getMonthWindows(now: Date): {
  lastMonthStart: string
  lastMonthEnd:   string  // exclusive — equals start of current month
  prevMonthStart: string
  prevMonthEnd:   string  // exclusive — equals start of last month
  lastMonthLabel: string  // e.g. "May 2026"
} {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() // 0-based current month

  // Last month (the one we're recapping)
  const lmY = m === 0 ? y - 1 : y
  const lmM = m === 0 ? 11 : m - 1

  // Two months ago (for comparison)
  const pmY = lmM === 0 ? lmY - 1 : lmY
  const pmM = lmM === 0 ? 11 : lmM - 1

  return {
    lastMonthStart: monthStart(lmY, lmM),
    lastMonthEnd:   monthStart(y, m),
    prevMonthStart: monthStart(pmY, pmM),
    prevMonthEnd:   monthStart(lmY, lmM),
    lastMonthLabel: new Date(Date.UTC(lmY, lmM, 1))
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  }
}

// ── Per-partner stats ─────────────────────────────────────────────────────────

interface PartnerStats {
  checkInsLastMonth: number
  checkInsPrevMonth: number
  photosLastMonth:   number
  topItem:           { body: string; count: number } | null
}

async function getPartnerStats(
  supabase: ReturnType<typeof createClient>,
  partnerId: string,
  windows: ReturnType<typeof getMonthWindows>
): Promise<PartnerStats> {
  // Step 1 — item IDs for this partner
  const { data: items } = await supabase
    .from('items')
    .select('id,body')
    .eq('partner_id', partnerId)
    .eq('is_active', true)

  if (!items?.length) {
    return { checkInsLastMonth: 0, checkInsPrevMonth: 0, photosLastMonth: 0, topItem: null }
  }

  const itemIds = items.map((i: { id: string }) => i.id)

  // Step 2 — list_item IDs for those items
  const { data: listItems } = await supabase
    .from('list_items')
    .select('id,item_id')
    .in('item_id', itemIds)
    .limit(5000)

  if (!listItems?.length) {
    return { checkInsLastMonth: 0, checkInsPrevMonth: 0, photosLastMonth: 0, topItem: null }
  }

  const listItemIds = listItems.map((li: { id: string }) => li.id)

  // Step 3 — check-ins in last month window (fetch all for grouping + photo count)
  const { data: lastMonthCIs } = await supabase
    .from('check_ins')
    .select('id,list_item_id,photo_url')
    .in('list_item_id', listItemIds)
    .gte('checked_at', windows.lastMonthStart)
    .lt('checked_at', windows.lastMonthEnd)
    .limit(10000)

  // Step 4 — check-in count for the prior month (for MoM comparison)
  const { count: prevMonthCount } = await supabase
    .from('check_ins')
    .select('id', { count: 'exact', head: true })
    .in('list_item_id', listItemIds)
    .gte('checked_at', windows.prevMonthStart)
    .lt('checked_at', windows.prevMonthEnd)

  const cis = lastMonthCIs ?? []

  // Count by list_item_id to find the top item
  const countByListItem: Record<string, number> = {}
  for (const ci of cis) {
    countByListItem[ci.list_item_id] = (countByListItem[ci.list_item_id] ?? 0) + 1
  }

  let topItem: PartnerStats['topItem'] = null
  if (Object.keys(countByListItem).length > 0) {
    const topListItemId = Object.entries(countByListItem)
      .sort(([, a], [, b]) => b - a)[0][0]
    const topLI   = (listItems as Array<{ id: string; item_id: string }>)
      .find(li => li.id === topListItemId)
    const topBody = topLI
      ? (items as Array<{ id: string; body: string }>).find(i => i.id === topLI.item_id)?.body ?? ''
      : ''
    if (topBody) {
      topItem = { body: topBody, count: countByListItem[topListItemId] }
    }
  }

  return {
    checkInsLastMonth: cis.length,
    checkInsPrevMonth: prevMonthCount ?? 0,
    photosLastMonth:   cis.filter((ci: { photo_url: string | null }) => ci.photo_url !== null).length,
    topItem,
  }
}

// ── Email HTML ────────────────────────────────────────────────────────────────

function buildEmail(partner: {
  business_name: string
  plan_tier:     string
}, stats: PartnerStats, monthLabel: string): string {
  const tierColor = TIER_COLOR[partner.plan_tier] ?? TIER_COLOR.partner

  // Month-over-month line — only shown if there were check-ins last month
  let momLine = ''
  if (stats.checkInsPrevMonth > 0) {
    const diff = stats.checkInsLastMonth - stats.checkInsPrevMonth
    if (diff > 0) {
      momLine = `Up ${diff} from last month`
    } else if (diff < 0) {
      momLine = `Down ${Math.abs(diff)} from last month`
    } else {
      momLine = `Same as last month`
    }
  }

  // Top item block — only shown if there were check-ins
  const topItemBlock = stats.topItem ? `
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:18px 20px;margin-bottom:24px">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:8px">
        Top item in ${monthLabel}
      </div>
      <div style="font-size:15px;font-weight:700;color:#fff;line-height:1.5;margin-bottom:6px">
        "${escapeHtml(stats.topItem.body)}"
      </div>
      <div style="font-size:13px;color:${tierColor};font-weight:700">
        ${stats.topItem.count} check-in${stats.topItem.count !== 1 ? 's' : ''} this item alone
      </div>
    </div>` : ''

  // Stats row
  const photoBlock = stats.photosLastMonth > 0 ? `
      <div style="flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:32px;font-weight:900;color:${tierColor};line-height:1;margin-bottom:4px">
          ${stats.photosLastMonth}
        </div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.4)">
          Photos
        </div>
      </div>` : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0F0F1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px">

    <!-- Logo -->
    <div style="margin-bottom:32px">
      <span style="font-size:28px;font-weight:900;color:#F5A623;letter-spacing:-1px">Check</span><span style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-1px">Off</span>
    </div>

    <!-- Tier badge -->
    <div style="display:inline-block;background:rgba(255,255,255,0.06);border:1px solid ${tierColor}40;border-radius:999px;padding:6px 14px;margin-bottom:24px">
      <span style="font-size:13px;font-weight:700;color:${tierColor}">${escapeHtml(partner.plan_tier.charAt(0).toUpperCase() + partner.plan_tier.slice(1))} Partner · ${escapeHtml(monthLabel)} recap</span>
    </div>

    <h1 style="font-size:26px;font-weight:800;color:#fff;margin:0 0 8px;line-height:1.2">
      Here's how ${escapeHtml(partner.business_name)} did in ${escapeHtml(monthLabel)}.
    </h1>
    <p style="font-size:15px;color:rgba(255,255,255,0.5);margin:0 0 32px;line-height:1.6">
      Your monthly CheckOff summary — check-ins, photos, and your top item.
    </p>

    <!-- Stats row -->
    <div style="display:flex;gap:12px;margin-bottom:24px">
      <div style="flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:32px;font-weight:900;color:${tierColor};line-height:1;margin-bottom:4px">
          ${stats.checkInsLastMonth}
        </div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.4)">
          Check-ins
        </div>
        ${momLine ? `<div style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:4px">${escapeHtml(momLine)}</div>` : ''}
      </div>
      ${photoBlock}
    </div>

    ${topItemBlock}

    <!-- CTA -->
    <a href="https://getcheckoff.com/partner-portal/dashboard" style="display:block;background:#F5A623;color:#1A1A2E;text-decoration:none;text-align:center;font-size:16px;font-weight:800;padding:18px;border-radius:14px;margin-bottom:32px">
      View your full dashboard →
    </a>

    <!-- Footer -->
    <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:24px">
      <p style="font-size:13px;color:rgba(255,255,255,0.3);margin:0;line-height:1.6">
        Questions? Reply to this email or reach us at
        <a href="mailto:support@getcheckoff.com" style="color:#F5A623;text-decoration:none">support@getcheckoff.com</a><br>
        — Jerry @ CheckOff · <a href="https://getcheckoff.com" style="color:rgba(255,255,255,0.3);text-decoration:none">getcheckoff.com</a>
      </p>
    </div>

  </div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;')
}

// ── Send via Resend ────────────────────────────────────────────────────────────

async function sendRecapEmail(partner: {
  business_name: string
  contact_email: string
  plan_tier:     string
}, stats: PartnerStats, monthLabel: string): Promise<boolean> {
  const subject = `Your CheckOff recap for ${monthLabel}`
  const html    = buildEmail(partner, stats, monthLabel)

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    FROM_EMAIL,
      to:      partner.contact_email,
      subject,
      html,
    }),
  })

  const result = await res.json() as { id?: string; error?: string }
  if (result.error) {
    console.error(`Resend error for ${partner.business_name}:`, result.error)
    return false
  }
  console.log(`Recap sent to ${partner.contact_email} (Resend ID: ${result.id})`)
  return true
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  if (!RESEND_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY secret not set' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } })

  let body: { partner_id?: string } = {}
  try { body = await req.json() } catch { /* empty body = cron trigger */ }

  // ── Resolve partner list ───────────────────────────────────────────────────
  type PartnerRow = {
    id: string
    business_name: string
    contact_email: string
    plan_tier: string
  }

  let partners: PartnerRow[] = []

  if (body.partner_id) {
    // Manual: single partner (for testing; no is_active guard so you can test inactive ones)
    const { data, error } = await supabase
      .from('partners')
      .select('id,business_name,contact_email,plan_tier')
      .eq('id', body.partner_id)
      .single()
    if (error || !data) {
      return new Response(JSON.stringify({ error: 'Partner not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      })
    }
    partners = [data]
  } else {
    // Cron: all active partners with a valid email
    const { data, error } = await supabase
      .from('partners')
      .select('id,business_name,contact_email,plan_tier')
      .eq('is_active', true)
      .not('contact_email', 'is', null)
    if (error) {
      console.error('Failed to fetch partners:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }
    partners = data ?? []
  }

  if (!partners.length) {
    console.log('No active partners to email.')
    return new Response(JSON.stringify({ sent: 0, skipped: 0, message: 'No active partners' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Compute month windows once (same for all partners) ────────────────────
  const windows   = getMonthWindows(new Date())
  const monthLabel = windows.lastMonthLabel

  console.log(`Sending ${monthLabel} recap to ${partners.length} active partner(s)…`)

  // ── Process each partner ──────────────────────────────────────────────────
  const results: Array<{ partner: string; success: boolean; checkIns: number; error?: string }> = []
  let sent    = 0
  let skipped = 0

  for (const partner of partners) {
    try {
      const stats = await getPartnerStats(supabase, partner.id, windows)

      // Skip partners with zero check-ins this month AND last month — nothing to recap
      if (stats.checkInsLastMonth === 0 && stats.checkInsPrevMonth === 0) {
        console.log(`Skipping ${partner.business_name} — no check-ins in either month`)
        skipped++
        results.push({ partner: partner.business_name, success: true, checkIns: 0 })
        continue
      }

      const ok = await sendRecapEmail(partner, stats, monthLabel)
      if (!ok) throw new Error('Resend returned an error')

      sent++
      results.push({ partner: partner.business_name, success: true, checkIns: stats.checkInsLastMonth })
    } catch (e) {
      console.error(`Failed for ${partner.business_name}:`, e)
      results.push({ partner: partner.business_name, success: false, checkIns: 0, error: String(e) })
    }
  }

  const failed = results.filter(r => !r.success).length
  console.log(`Partner recap summary — sent: ${sent}, skipped (no activity): ${skipped}, failed: ${failed}`)

  return new Response(JSON.stringify({ sent, skipped, failed, results }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
