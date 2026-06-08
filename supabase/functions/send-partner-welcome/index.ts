import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { to, business_name, partner_slug, has_secret, plan_tier } = await req.json()

    if (!to || !partner_slug) {
      return new Response(JSON.stringify({ error: 'Missing to or partner_slug' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_KEY) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY secret not set' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const welcomeUrl = `https://getcheckoff.com/partner-welcome/${encodeURIComponent(partner_slug)}`

    const bullets = [
      `<li><strong>Logging in</strong> — magic link sent to this email, no password needed</li>`,
      `<li><strong>Your dashboard</strong> — check-in count, recent visits, customer photos, and your active item</li>`,
      has_secret
        ? `<li><strong>Your secret reveal</strong> — how it triggers automatically when customers check in at your location</li>`
        : null,
      plan_tier === 'rare'
        ? `<li><strong>Updating your item</strong> — you can edit it once per quarter</li>`
        : null,
      plan_tier === 'legend'
        ? `<li><strong>Updating your item</strong> — you can edit it once per month</li>`
        : null,
      `<li><strong>Sharing CheckOff with your customers</strong> — your QR sticker kit and App Store link</li>`,
    ].filter(Boolean).join('\n')

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 16px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:520px;width:100%">

        <tr>
          <td style="background:#1A1A2E;padding:24px 32px">
            <span style="font-size:22px;font-weight:800;color:#F5A623;letter-spacing:-0.5px">Check<span style="color:#ffffff">Off</span></span>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 32px 24px">
            <p style="margin:0 0 16px;font-size:16px;color:#1a1a1a;font-weight:600">Hi ${business_name} —</p>
            <p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.6">
              You're officially on CheckOff. Here's everything you need to know about your spot, all in one place:
            </p>

            <table cellpadding="0" cellspacing="0" style="margin-bottom:24px">
              <tr>
                <td style="background:#F5A623;border-radius:10px;padding:14px 24px">
                  <a href="${welcomeUrl}" style="color:#1A1A2E;font-size:15px;font-weight:800;text-decoration:none;white-space:nowrap">
                    View your partner guide →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 10px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#999">
              What's covered
            </p>
            <ul style="margin:0 0 24px;padding-left:20px;font-size:14px;color:#444;line-height:1.8">
              ${bullets}
            </ul>

            <p style="margin:0;font-size:14px;color:#666;line-height:1.6">
              Questions? Just reply to this email — we respond same day.
            </p>
          </td>
        </tr>

        <tr>
          <td style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #eee">
            <p style="margin:0;font-size:12px;color:#999">
              CheckOff · <a href="https://getcheckoff.com" style="color:#F5A623;text-decoration:none">getcheckoff.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'CheckOff <hello@getcheckoff.com>',
        to: [to],
        subject: `You're live on CheckOff — your partner guide`,
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || res.statusText)
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
