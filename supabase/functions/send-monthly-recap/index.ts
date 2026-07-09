import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { renderCheckOffEmail, monthlyRecapSubject } from '../email-templates/render-helpers.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const templateHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Your CheckOff month</title>
  <style>
    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; }
      .px { padding-left: 22px !important; padding-right: 22px !important; }
      .stack { display: block !important; width: 100% !important; }
      .stat { display: block !important; width: 100% !important; margin-bottom: 10px !important; }
      .hero-title { font-size: 30px !important; line-height: 36px !important; }
      .item-title { font-size: 17px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#F4F1EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#171A21;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{{checkins_this_month}} new CheckOffs, {{lifetime_points}} lifetime points, and 3 things to try next.</div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F4F1EA;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-radius:28px;overflow:hidden;box-shadow:0 18px 55px rgba(15,17,23,.12);">
          <tr>
            <td style="background:#0F1117;padding:26px 30px 22px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="left" style="font-size:28px;font-weight:900;letter-spacing:-.8px;line-height:32px;">
                    <span style="color:#F5A623;">Check</span><span style="color:#FFFFFF;">Off</span>
                  </td>
                  <td align="right" style="font-size:12px;font-weight:800;color:#F5A623;text-transform:uppercase;letter-spacing:1.2px;">Monthly Recap</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:38px 34px 22px;background:#0F1117;background-image:linear-gradient(180deg,#0F1117 0%,#171A21 100%);">
              <div style="font-size:13px;font-weight:800;color:#F5A623;text-transform:uppercase;letter-spacing:1.4px;margin-bottom:12px;">{{metro_name}} · {{neighborhood_name}}</div>
              <div class="hero-title" style="font-size:36px;line-height:42px;font-weight:950;letter-spacing:-1.2px;color:#FFFFFF;margin:0 0 14px;">{{display_name}}, you checked off {{checkins_this_month}} this month.</div>
              <div style="font-size:17px;line-height:26px;color:#D7DAE1;margin:0 0 28px;">You're at <strong style="color:#FFFFFF;">{{lifetime_points}} lifetime points</strong>, with a <strong style="color:#FFFFFF;">{{current_streak}} week streak</strong>. Keep the local momentum going.</div>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td class="stat" width="33.3%" style="padding:0 6px 0 0;">
                    <div style="background:rgba(255,255,255,.08);border:1px solid rgba(245,166,35,.32);border-radius:18px;padding:16px;">
                      <div style="font-size:26px;font-weight:950;color:#FFFFFF;line-height:30px;">{{checkins_this_month}}</div>
                      <div style="font-size:12px;font-weight:800;color:#AEB4C0;text-transform:uppercase;letter-spacing:.8px;">This month</div>
                    </div>
                  </td>
                  <td class="stat" width="33.3%" style="padding:0 3px;">
                    <div style="background:rgba(255,255,255,.08);border:1px solid rgba(245,166,35,.32);border-radius:18px;padding:16px;">
                      <div style="font-size:26px;font-weight:950;color:#FFFFFF;line-height:30px;">{{lifetime_points}}</div>
                      <div style="font-size:12px;font-weight:800;color:#AEB4C0;text-transform:uppercase;letter-spacing:.8px;">Points</div>
                    </div>
                  </td>
                  <td class="stat" width="33.3%" style="padding:0 0 0 6px;">
                    <div style="background:rgba(255,255,255,.08);border:1px solid rgba(245,166,35,.32);border-radius:18px;padding:16px;">
                      <div style="font-size:26px;font-weight:950;color:#FFFFFF;line-height:30px;">{{current_streak}}</div>
                      <div style="font-size:12px;font-weight:800;color:#AEB4C0;text-transform:uppercase;letter-spacing:.8px;">Week streak</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:30px 34px 8px;background:#FFFFFF;">
              <div style="background:#FFF7E8;border:1px solid #F8D89D;border-radius:22px;padding:22px;">
                <div style="font-size:13px;font-weight:900;color:#A35F00;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:8px;">Season list status</div>
                <div style="font-size:22px;font-weight:950;letter-spacing:-.4px;color:#171A21;line-height:28px;margin-bottom:8px;">{{season_days_remaining}} days left to make it count.</div>
                <div style="font-size:15px;line-height:23px;color:#4B5260;">Your current seasonal list has {{season_total_items}} total spots. Hit one more this week and keep your CheckOff rhythm alive.</div>
              </div>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:28px 34px 8px;background:#FFFFFF;">
              <div style="font-size:25px;line-height:31px;font-weight:950;letter-spacing:-.6px;color:#171A21;margin-bottom:6px;">Three things to try next</div>
              <div style="font-size:15px;line-height:23px;color:#596170;margin-bottom:18px;">Popular in your metro, and still unchecked by you.</div>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #E8E3DA;border-radius:20px;overflow:hidden;margin-bottom:12px;">
                <tr>
                  <td style="padding:18px 18px 16px;background:#FFFFFF;">
                    <div class="item-title" style="font-size:18px;line-height:24px;font-weight:900;color:#171A21;margin-bottom:5px;">{{item_1_name}}</div>
                    <div style="font-size:14px;line-height:21px;color:#596170;margin-bottom:12px;">{{item_1_note}}</div>
                    <a href="{{item_1_url}}" style="display:inline-block;color:#0F1117;background:#F5A623;border-radius:999px;padding:10px 15px;font-size:13px;font-weight:900;text-decoration:none;">Open this idea</a>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #E8E3DA;border-radius:20px;overflow:hidden;margin-bottom:12px;">
                <tr><td style="padding:18px 18px 16px;background:#FFFFFF;"><div class="item-title" style="font-size:18px;line-height:24px;font-weight:900;color:#171A21;margin-bottom:5px;">{{item_2_name}}</div><div style="font-size:14px;line-height:21px;color:#596170;margin-bottom:12px;">{{item_2_note}}</div><a href="{{item_2_url}}" style="display:inline-block;color:#0F1117;background:#F5A623;border-radius:999px;padding:10px 15px;font-size:13px;font-weight:900;text-decoration:none;">Open this idea</a></td></tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #E8E3DA;border-radius:20px;overflow:hidden;margin-bottom:12px;">
                <tr><td style="padding:18px 18px 16px;background:#FFFFFF;"><div class="item-title" style="font-size:18px;line-height:24px;font-weight:900;color:#171A21;margin-bottom:5px;">{{item_3_name}}</div><div style="font-size:14px;line-height:21px;color:#596170;margin-bottom:12px;">{{item_3_note}}</div><a href="{{item_3_url}}" style="display:inline-block;color:#0F1117;background:#F5A623;border-radius:999px;padding:10px 15px;font-size:13px;font-weight:900;text-decoration:none;">Open this idea</a></td></tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" class="px" style="padding:24px 34px 36px;background:#FFFFFF;">
              <a href="checkoff://home" style="display:inline-block;background:#F5A623;color:#0F1117;text-decoration:none;font-size:16px;font-weight:950;border-radius:999px;padding:15px 24px;">Open CheckOff</a>
              <div style="font-size:13px;line-height:20px;color:#7A8290;margin-top:16px;">Forward this to the person who always says, "What should we do this weekend?"</div>
            </td>
          </tr>

          <tr>
            <td style="background:#0F1117;padding:28px 30px;text-align:center;">
              <div style="font-size:14px;line-height:22px;color:#D7DAE1;font-weight:700;">Built for discovery. Ready for visitors.</div>
              <div style="font-size:12px;line-height:20px;color:#8F97A6;margin-top:10px;">getcheckoff.com · <a href="{{unsubscribe_url}}" style="color:#F5A623;text-decoration:underline;">unsubscribe</a></div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

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

    const { data: users, error } = await supabase.rpc('get_monthly_recap_users')
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
          neighborhood_name: user.most_active_hood,
          current_streak:    user.current_streak_weeks,
          lifetime_points:   user.total_lifetime_points,
          recommended_items: user.recommended_items ?? [],
          unsubscribe_url:   unsubscribeUrl,
        })

        const subject = monthlyRecapSubject({
          display_name:        user.display_name,
          email:               user.email,
          checkins_this_month: user.checkins_this_month,
        })

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

        console.log(`sent monthly-recap to ${user.email}`)
        sent++
      } catch (e) {
        console.error(`failed monthly-recap for ${user.email}:`, e.message)
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
