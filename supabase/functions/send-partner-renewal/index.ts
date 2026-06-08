// supabase/functions/send-partner-renewal/index.ts
//
// Sends a personalized renewal email to founding partners whose free period
// is ending. Creates a Stripe Checkout Session pre-filled with their email
// so payment converts their existing partner record (not create a duplicate).
//
// Two call modes:
//   1. Manual from admin:  POST { partner_id: "uuid" }
//   2. Daily cron trigger: POST { trigger: "cron" }  → finds all 30-day expiring partners
//
// Required Supabase secrets (already set from stripe-webhook setup):
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_PARTNER_MONTHLY / _ANNUAL
//   STRIPE_PRICE_RARE_MONTHLY    / _ANNUAL
//   STRIPE_PRICE_LEGEND_MONTHLY  / _ANNUAL
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL   ← add this: e.g. hello@getcheckoff.com
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// Deploy:
//   supabase functions deploy send-partner-renewal --project-ref uggusbbswybyplypkbxz

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SVC    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRIPE_SECRET   = Deno.env.get('STRIPE_SECRET_KEY')!
const RESEND_KEY      = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL      = Deno.env.get('RESEND_FROM_EMAIL') ?? 'hello@getcheckoff.com'

// Reuse the same Price IDs already set for the stripe-webhook function
const PRICE_IDS: Record<string, Record<string, string>> = {
  partner: {
    monthly: Deno.env.get('STRIPE_PRICE_PARTNER_MONTHLY') ?? '',
    annual:  Deno.env.get('STRIPE_PRICE_PARTNER_ANNUAL')  ?? '',
  },
  rare: {
    monthly: Deno.env.get('STRIPE_PRICE_RARE_MONTHLY') ?? '',
    annual:  Deno.env.get('STRIPE_PRICE_RARE_ANNUAL')  ?? '',
  },
  legend: {
    monthly: Deno.env.get('STRIPE_PRICE_LEGEND_MONTHLY') ?? '',
    annual:  Deno.env.get('STRIPE_PRICE_LEGEND_ANNUAL')  ?? '',
  },
}

const TIER_CONFIG: Record<string, { label: string; monthly: number; annual: number; pts: number; features: string[] }> = {
  partner: {
    label: 'Partner', monthly: 29, annual: 290, pts: 5,
    features: ['Listed in city discovery', 'Photo check-in', '5 pts per visit'],
  },
  rare: {
    label: 'Rare', monthly: 49, annual: 490, pts: 10,
    features: ['Everything in Partner', 'Rare badge — higher in lists', '10 pts per visit'],
  },
  legend: {
    label: 'Legend', monthly: 99, annual: 990, pts: 25,
    features: ['Everything in Rare', 'Secret reveal with GPS unlock', '25 pts per visit — top of every list'],
  },
}

// ── Create a Stripe Checkout Session for the partner ─────────────────────────
async function createCheckoutSession(partner: {
  id: string
  contact_email: string
  plan_tier: string
  billing_interval: string
  business_name: string
}): Promise<string | null> {
  const interval = partner.billing_interval ?? 'monthly'
  const priceId  = PRICE_IDS[partner.plan_tier]?.[interval]

  if (!priceId) {
    console.error(`No price ID found for ${partner.plan_tier} ${interval}`)
    return null
  }

  const params = new URLSearchParams({
    'mode':                      'subscription',
    'success_url':               'https://getcheckoff.com/partner-success?session_id={CHECKOUT_SESSION_ID}',
    'cancel_url':                'https://getcheckoff.com/partner',
    'customer_email':            partner.contact_email,
    'line_items[0][price]':      priceId,
    'line_items[0][quantity]':   '1',
    // Pass partner_id so the webhook can UPDATE this record instead of INSERT a new one
    'metadata[partner_id]':      partner.id,
    'metadata[plan_tier]':       partner.plan_tier,
    'metadata[billing_interval]': interval,
  })

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method:  'POST',
    headers: {
      'Authorization':  `Bearer ${STRIPE_SECRET}`,
      'Content-Type':   'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  const session = await res.json() as { url?: string; error?: { message: string } }
  if (session.error) {
    console.error('Stripe session error:', session.error.message)
    return null
  }
  return session.url ?? null
}

// ── Send renewal email via Resend ─────────────────────────────────────────────
async function sendRenewalEmail(partner: {
  id: string
  business_name: string
  contact_email: string
  plan_tier: string
  billing_interval: string
  billing_start: string
}, checkoutUrl: string): Promise<boolean> {
  const tier      = TIER_CONFIG[partner.plan_tier] ?? TIER_CONFIG.partner
  const interval  = partner.billing_interval ?? 'monthly'
  const price     = interval === 'annual' ? `$${tier.annual}/year` : `$${tier.monthly}/month`
  const endDate   = new Date(partner.billing_start)
  const dateStr   = endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const daysLeft  = Math.ceil((endDate.getTime() - Date.now()) / 86400000)
  const tierColor = partner.plan_tier === 'legend' ? '#8B5CF6' : partner.plan_tier === 'rare' ? '#F5A623' : '#378ADD'

  const subject = `Your CheckOff founding access ends ${dateStr} — keep your spot`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0F0F1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px">

    <!-- Logo -->
    <div style="margin-bottom:32px">
      <span style="font-size:28px;font-weight:900;color:#F5A623;letter-spacing:-1px">Check</span><span style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-1px">Off</span>
    </div>

    <!-- Countdown badge -->
    <div style="display:inline-block;background:rgba(245,166,35,0.12);border:1px solid rgba(245,166,35,0.3);border-radius:999px;padding:6px 14px;margin-bottom:24px">
      <span style="font-size:13px;font-weight:700;color:#F5A623">⭐ Founding Partner · ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left</span>
    </div>

    <h1 style="font-size:26px;font-weight:800;color:#fff;margin:0 0 12px;line-height:1.2">
      Your free period ends ${dateStr}.
    </h1>
    <p style="font-size:16px;color:rgba(255,255,255,0.6);margin:0 0 32px;line-height:1.6">
      Hey ${partner.business_name} — thanks for being one of our founding partners. To keep your item live and your customers coming in, set up billing below.
    </p>

    <!-- Tier card -->
    <div style="background:rgba(255,255,255,0.04);border:1px solid ${tierColor}40;border-radius:16px;padding:20px;margin-bottom:32px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${tierColor}"></span>
        <span style="font-size:16px;font-weight:800;color:${tierColor}">${tier.label}</span>
        <span style="font-size:20px;font-weight:800;color:#fff;margin-left:auto">${price}</span>
      </div>
      ${tier.features.map(f => `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="color:${tierColor};font-weight:700">✓</span>
          <span style="font-size:14px;color:rgba(255,255,255,0.65)">${f}</span>
        </div>`).join('')}
    </div>

    <!-- CTA -->
    <a href="${checkoutUrl}" style="display:block;background:#F5A623;color:#1A1A2E;text-decoration:none;text-align:center;font-size:16px;font-weight:800;padding:18px;border-radius:14px;margin-bottom:16px">
      Set up billing — takes 2 minutes →
    </a>
    <p style="font-size:12px;color:rgba(255,255,255,0.3);text-align:center;margin:0 0 32px">
      Secure payment via Stripe · Cancel anytime · No setup fees
    </p>

    <!-- What stays the same -->
    <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:24px;margin-bottom:32px">
      <p style="font-size:13px;color:rgba(255,255,255,0.4);margin:0 0 8px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Nothing changes once you're set up</p>
      <p style="font-size:14px;color:rgba(255,255,255,0.55);margin:0;line-height:1.6">
        Your item stays exactly where it is. Check-ins keep rolling in. You keep the ⭐ Founding Partner badge — permanently.
      </p>
    </div>

    <p style="font-size:13px;color:rgba(255,255,255,0.35);margin:0;line-height:1.6">
      Questions? Reply to this email or reach out any time.<br>
      — Jerry @ CheckOff
    </p>
  </div>
</body>
</html>`

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: partner.contact_email, subject, html }),
  })

  const result = await res.json() as { id?: string; error?: string }
  if (result.error) {
    console.error('Resend error:', result.error)
    return false
  }
  console.log(`Renewal email sent to ${partner.contact_email} (Resend ID: ${result.id})`)
  return true
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } })

  let body: { partner_id?: string; trigger?: string } = {}
  try { body = await req.json() } catch { /* empty body = cron */ }

  let partners: Array<{
    id: string; business_name: string; contact_email: string
    plan_tier: string; billing_interval: string; billing_start: string
  }> = []

  if (body.partner_id) {
    // Manual: single partner
    const { data, error } = await supabase
      .from('partners')
      .select('id,business_name,contact_email,plan_tier,billing_interval,billing_start')
      .eq('id', body.partner_id)
      .single()
    if (error || !data) return new Response(JSON.stringify({ error: 'Partner not found' }), { status: 404 })
    partners = [data]
  } else {
    // Cron: all founding partners expiring within 30 days that haven't been emailed yet
    const today     = new Date(); today.setUTCHours(0, 0, 0, 0)
    const in30Days  = new Date(today); in30Days.setDate(in30Days.getDate() + 30)
    const { data } = await supabase
      .from('partners')
      .select('id,business_name,contact_email,plan_tier,billing_interval,billing_start')
      .eq('is_founding', true)
      .eq('is_active', true)
      .not('billing_start', 'is', null)
      .lte('billing_start', in30Days.toISOString().slice(0, 10))
      .gte('billing_start', today.toISOString().slice(0, 10))
      .is('renewal_sent_at', null)
    partners = data ?? []
  }

  if (!partners.length) {
    return new Response(JSON.stringify({ sent: 0, message: 'No partners to email' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const results: Array<{ partner: string; success: boolean; error?: string }> = []

  for (const partner of partners) {
    try {
      const checkoutUrl = await createCheckoutSession(partner)
      if (!checkoutUrl) throw new Error('Failed to create Stripe checkout session')

      const sent = await sendRenewalEmail(partner, checkoutUrl)
      if (!sent) throw new Error('Resend API error')

      // Record send timestamp so cron never double-fires
      await supabase
        .from('partners')
        .update({ renewal_sent_at: new Date().toISOString() })
        .eq('id', partner.id)

      results.push({ partner: partner.business_name, success: true })
    } catch (e) {
      console.error(`Failed for ${partner.business_name}:`, e)
      results.push({ partner: partner.business_name, success: false, error: String(e) })
    }
  }

  const sent   = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  console.log(`Renewal emails: ${sent} sent, ${failed} failed`)

  return new Response(JSON.stringify({ sent, failed, results }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
