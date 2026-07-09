// supabase/functions/send-creator-list-live/index.ts
//
// Sends a "Your list is live" email to a creator when their first referred
// partner pays and their creator list flips public.
//
// Called internally by stripe-webhook — not a public endpoint.
//
// Required secrets:
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL  (default: hello@getcheckoff.com)
//
// Deploy:
//   supabase functions deploy send-creator-list-live --project-ref uggusbbswybyplypkbxz

const RESEND_KEY  = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL  = Deno.env.get('RESEND_FROM_EMAIL') ?? 'hello@getcheckoff.com'

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405 })

  try {
    const {
      to,
      creator_handle,
      display_name,
      partner_business_name,
      list_title,
      plan_tier,
      commission_cents,
    } = await req.json()

    if (!to || !creator_handle) {
      return new Response(JSON.stringify({ error: 'Missing to or creator_handle' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const firstName       = display_name?.split(' ')[0] ?? creator_handle
    const profileUrl      = `https://getcheckoff.com/c/${encodeURIComponent(creator_handle)}`
    const commissionDollars = commission_cents ? `$${(commission_cents / 100).toFixed(0)}` : null
    const tierLabel       = plan_tier === 'legend' ? 'Legend' : plan_tier === 'rare' ? 'Rare' : 'Partner'
    const tierColor       = plan_tier === 'legend' ? '#8B5CF6' : plan_tier === 'rare' ? '#F5A623' : '#378ADD'

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0F0F1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px">

    <div style="margin-bottom:32px">
      <span style="font-size:28px;font-weight:900;color:#F5A623;letter-spacing:-1px">Check</span><span style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-1px">Off</span>
    </div>

    <div style="display:inline-block;background:rgba(245,166,35,0.12);border:1px solid rgba(245,166,35,0.3);border-radius:999px;padding:6px 14px;margin-bottom:24px">
      <span style="font-size:13px;font-weight:700;color:#F5A623">🎉 Your list just went live</span>
    </div>

    <h1 style="font-size:26px;font-weight:800;color:#fff;margin:0 0 12px;line-height:1.2">
      ${firstName}, your CheckOff list is public.
    </h1>
    <p style="font-size:16px;color:rgba(255,255,255,0.6);margin:0 0 32px;line-height:1.6">
      <strong style="color:rgba(255,255,255,0.85)">${partner_business_name}</strong> just signed up as a
      <span style="color:${tierColor};font-weight:700">${tierLabel}</span> partner through your link.
      Your list <strong style="color:rgba(255,255,255,0.85)">"${list_title ?? 'Your List'}"</strong> is now visible to everyone on CheckOff.
    </p>

    ${commissionDollars ? `
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(245,166,35,0.25);border-radius:16px;padding:20px;margin-bottom:32px">
      <p style="margin:0 0 4px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.4)">Your commission</p>
      <p style="margin:0;font-size:32px;font-weight:900;color:#F5A623">${commissionDollars}</p>
      <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.4)">Pending · will be paid on the next payout cycle</p>
    </div>` : ''}

    <a href="${profileUrl}" style="display:block;background:#F5A623;color:#1A1A2E;text-decoration:none;text-align:center;font-size:16px;font-weight:800;padding:18px;border-radius:14px;margin-bottom:32px">
      View your creator profile →
    </a>

    <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:24px">
      <p style="font-size:13px;color:rgba(255,255,255,0.35);margin:0;line-height:1.6">
        Keep sharing your link to earn commissions on every partner you refer.<br>
        — Jerry @ CheckOff
      </p>
    </div>

  </div>
</body>
</html>`

    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    `CheckOff <${FROM_EMAIL}>`,
        to:      [to],
        subject: `Your CheckOff list just went live 🎉`,
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? res.statusText)
    }

    const result = await res.json() as { id?: string }
    console.log(`Creator list-live email sent to ${to} (Resend ID: ${result.id})`)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('send-creator-list-live error:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
