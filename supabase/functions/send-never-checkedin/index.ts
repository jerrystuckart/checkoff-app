import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { renderCheckOffEmail, neverCheckedInSubject } from '../email-templates/render-helpers.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const templateHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Start your first CheckOff</title><style>@media only screen and (max-width:620px){.container{width:100%!important}.px{padding-left:22px!important;padding-right:22px!important}.hero{font-size:31px!important;line-height:37px!important}.img{width:100%!important;height:auto!important}.step{display:block!important;width:100%!important;margin-bottom:12px!important}}</style></head>
<body style="margin:0;padding:0;background:#F4F1EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#171A21;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your first CheckOff only takes one good local idea.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F4F1EA;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-radius:28px;overflow:hidden;box-shadow:0 18px 55px rgba(15,17,23,.12);">
<tr><td style="background:#0F1117;padding:26px 30px 22px;"><table role="presentation" width="100%"><tr><td style="font-size:28px;font-weight:900;letter-spacing:-.8px;"><span style="color:#F5A623;">Check</span><span style="color:#FFFFFF;">Off</span></td><td align="right" style="font-size:12px;font-weight:800;color:#F5A623;text-transform:uppercase;letter-spacing:1.2px;">Getting Started</td></tr></table></td></tr>
<tr><td class="px" style="padding:38px 34px 22px;background:#0F1117;background-image:linear-gradient(180deg,#0F1117 0%,#1B1F2A 100%);"><div style="font-size:13px;font-weight:900;color:#F5A623;text-transform:uppercase;letter-spacing:1.3px;margin-bottom:12px;">{{metro_name}}</div><div class="hero" style="font-size:38px;line-height:44px;font-weight:950;letter-spacing:-1.2px;color:#FFFFFF;margin-bottom:14px;">{{display_name}}, let's get your first CheckOff.</div><div style="font-size:17px;line-height:26px;color:#D7DAE1;margin-bottom:24px;">You made the account. Now comes the fun part: pick one local thing, bring your crew if you want, and mark it done.</div><a href="https://getcheckoff.com" style="display:inline-block;background:#F5A623;color:#0F1117;text-decoration:none;font-size:16px;font-weight:950;border-radius:999px;padding:15px 24px;">Open the app</a></td></tr>
<tr><td class="px" style="padding:30px 34px 8px;background:#FFFFFF;"><div style="font-size:25px;line-height:31px;font-weight:950;letter-spacing:-.6px;color:#171A21;margin-bottom:16px;">How to start in 60 seconds</div><table role="presentation" width="100%"><tr><td class="step" width="33.3%" valign="top" style="padding-right:8px;"><div style="background:#FFF7E8;border:1px solid #F8D89D;border-radius:18px;padding:16px;"><div style="font-size:24px;font-weight:950;color:#F5A623;">1</div><div style="font-size:14px;line-height:21px;color:#171A21;font-weight:800;">Pick a list or experience</div></div></td><td class="step" width="33.3%" valign="top" style="padding:0 4px;"><div style="background:#FFF7E8;border:1px solid #F8D89D;border-radius:18px;padding:16px;"><div style="font-size:24px;font-weight:950;color:#F5A623;">2</div><div style="font-size:14px;line-height:21px;color:#171A21;font-weight:800;">Go do the thing</div></div></td><td class="step" width="33.3%" valign="top" style="padding-left:8px;"><div style="background:#FFF7E8;border:1px solid #F8D89D;border-radius:18px;padding:16px;"><div style="font-size:24px;font-weight:950;color:#F5A623;">3</div><div style="font-size:14px;line-height:21px;color:#171A21;font-weight:800;">Check it off</div></div></td></tr></table></td></tr>
<tr><td class="px" style="padding:28px 34px 10px;background:#FFFFFF;"><div style="font-size:25px;line-height:31px;font-weight:950;letter-spacing:-.6px;margin-bottom:6px;">Good first picks</div><div style="font-size:15px;line-height:23px;color:#596170;margin-bottom:18px;">A few popular ideas in your metro to make the first one easy.</div>
<table role="presentation" width="100%" style="border:1px solid #E8E3DA;border-radius:20px;margin-bottom:12px;"><tr><td style="padding:18px;"><div style="font-size:18px;line-height:24px;font-weight:900;color:#171A21;">{{item_1_name}}</div><div style="font-size:14px;line-height:21px;color:#596170;margin-top:5px;">{{item_1_note}}</div></td></tr></table>
<table role="presentation" width="100%" style="border:1px solid #E8E3DA;border-radius:20px;margin-bottom:12px;"><tr><td style="padding:18px;"><div style="font-size:18px;line-height:24px;font-weight:900;color:#171A21;">{{item_2_name}}</div><div style="font-size:14px;line-height:21px;color:#596170;margin-top:5px;">{{item_2_note}}</div></td></tr></table>
<table role="presentation" width="100%" style="border:1px solid #E8E3DA;border-radius:20px;margin-bottom:12px;"><tr><td style="padding:18px;"><div style="font-size:18px;line-height:24px;font-weight:900;color:#171A21;">{{item_3_name}}</div><div style="font-size:14px;line-height:21px;color:#596170;margin-top:5px;">{{item_3_note}}</div></td></tr></table></td></tr>
<tr><td align="center" class="px" style="padding:14px 34px 36px;background:#FFFFFF;"><a href="https://getcheckoff.com" style="display:inline-block;background:#F5A623;color:#0F1117;text-decoration:none;font-size:16px;font-weight:950;border-radius:999px;padding:15px 24px;">Start checking things off</a></td></tr>
<tr><td style="background:#0F1117;padding:28px 30px;text-align:center;"><div style="font-size:14px;line-height:22px;color:#D7DAE1;font-weight:700;">Built for discovery. Ready for visitors.</div><div style="font-size:12px;line-height:20px;color:#8F97A6;margin-top:10px;">getcheckoff.com · <a href="{{unsubscribe_url}}" style="color:#F5A623;text-decoration:underline;">unsubscribe</a></div></td></tr>
</table></td></tr></table></body></html>`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_KEY) throw new Error('RESEND_API_KEY secret not set')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const { data: users, error } = await supabase.rpc('get_never_checkin_users')
    if (error) throw error
    if (!users?.length) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, message: 'No users returned' }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    let sent = 0
    let failed = 0

    for (const user of users) {
      try {
        const unsubscribeUrl =
          `mailto:jerry@getcheckoff.com?subject=Unsubscribe%20-%20${encodeURIComponent(user.email)}`

        const html = renderCheckOffEmail(templateHtml, {
          ...user,
          metro_name:        user.metro_name ?? null,
          recommended_items: user.suggested_items ?? [],
          unsubscribe_url:   unsubscribeUrl,
        })

        const subject = neverCheckedInSubject({ display_name: user.display_name, email: user.email })

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from:    'CheckOff <hello@getcheckoff.com>',
            to:      [user.email],
            subject,
            html,
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.message || res.statusText)
        }

        console.log(`sent never-checkedin to ${user.email}`)
        sent++
      } catch (e) {
        console.error(`failed never-checkedin for ${user.email}:`, e.message)
        failed++
      }
    }

    return new Response(JSON.stringify({ sent, failed }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
