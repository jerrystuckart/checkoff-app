// Supabase Edge Function: join-list
// Deploy with: supabase functions deploy join-list
//
// Handles two things:
//   1. GET  /join-list?code=abc123
//      → Redirects to app deeplink OR serves web landing page if app not installed
//
//   2. POST /join-list  { invite_code, user_id }
//      → Adds user as list member, returns list details
//
// Deploy this function, then set your Supabase project URL in app.json
// as the deep link target.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const url = new URL(req.url)

  // ── GET: deep link redirect ──────────────────────────────────────────────
  if (req.method === 'GET') {
    const code = url.searchParams.get('code')

    if (!code) {
      return new Response(landingPage(null, 'Invalid invite link'), {
        headers: { ...corsHeaders, 'Content-Type': 'text/html' },
        status: 400,
      })
    }

    // Look up the list
    const { data: list } = await supabase
      .from('lists')
      .select('id, title, invite_code, is_public')
      .eq('invite_code', code)
      .single()

    if (!list) {
      return new Response(landingPage(null, 'This invite link has expired or is invalid.'), {
        headers: { ...corsHeaders, 'Content-Type': 'text/html' },
        status: 404,
      })
    }

    // Serve a web landing page that tries to open the app,
    // falls back to App Store if not installed
    return new Response(landingPage(list), {
      headers: { ...corsHeaders, 'Content-Type': 'text/html' },
    })
  }

  // ── POST: join the list ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { invite_code, user_id } = await req.json()

    if (!invite_code || !user_id) {
      return new Response(JSON.stringify({ error: 'invite_code and user_id required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // Find the list
    const { data: list, error: listErr } = await supabase
      .from('lists')
      .select('id, title, invite_code, is_public, creator_id')
      .eq('invite_code', invite_code)
      .single()

    if (listErr || !list) {
      return new Response(JSON.stringify({ error: 'List not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      })
    }

    if (!list.is_public) {
      return new Response(JSON.stringify({ error: 'This list is private' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      })
    }

    // Add as member (ignore if already a member)
    const { error: joinErr } = await supabase
      .from('list_members')
      .upsert(
        { list_id: list.id, user_id, invite_source: 'link' },
        { onConflict: 'list_id,user_id', ignoreDuplicates: true }
      )

    if (joinErr) {
      return new Response(JSON.stringify({ error: joinErr.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    // Return list details so the app can navigate directly to it
    return new Response(JSON.stringify({ list_id: list.id, title: list.title }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response('Method not allowed', { status: 405, headers: corsHeaders })
})

// ── Web landing page ─────────────────────────────────────────────────────────
// Shown when someone taps an invite link on a device without the app.
// Tries to open the app via deeplink, falls back to showing a download prompt.
function landingPage(list: any, errorMsg?: string) {
  const title    = list?.title ?? 'CheckOff'
  const code     = list?.invite_code ?? ''
  const deeplink = `checkoff://join/${code}`
  // Update this URL when app is live on App Store
  const appStoreUrl = 'https://apps.apple.com/app/checkoff'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${errorMsg ? 'Invalid Link' : `Join "${title}" on CheckOff`}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0e0e18; color: #e8e6df;
      min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 24px;
    }
    .logo { font-size: 36px; font-weight: 800; color: #F5A623; margin-bottom: 8px; }
    .logo span { color: #fff; }
    .card {
      background: #161622; border-radius: 20px; padding: 32px 24px;
      max-width: 360px; width: 100%; text-align: center;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .invite-label { font-size: 12px; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
    .list-title { font-size: 22px; font-weight: 700; color: #fff; margin-bottom: 8px; line-height: 1.3; }
    .list-sub { font-size: 14px; color: rgba(255,255,255,0.45); margin-bottom: 28px; line-height: 1.5; }
    .open-btn {
      display: block; background: #F5A623; color: #1A1A2E;
      font-size: 16px; font-weight: 700; padding: 16px;
      border-radius: 14px; text-decoration: none; margin-bottom: 12px;
    }
    .store-btn {
      display: block; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6);
      font-size: 14px; padding: 14px; border-radius: 14px; text-decoration: none;
      border: 1px solid rgba(255,255,255,0.12);
    }
    .error { color: #D85A30; font-size: 15px; margin-bottom: 16px; }
    .bullets { text-align: left; margin: 20px 0; }
    .bullet { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 12px; font-size: 13px; color: rgba(255,255,255,0.55); }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: #F5A623; flex-shrink: 0; margin-top: 4px; }
  </style>
  ${list ? `<script>
    // Try to open the app immediately
    window.location.href = '${deeplink}';
    // If still here after 2s, show the landing page content
    setTimeout(() => {
      document.getElementById('content').style.display = 'block';
    }, 2000);
  </script>` : ''}
</head>
<body>
  <div class="logo">Check<span>Off</span></div>
  <div class="card" id="content" ${list ? 'style="display:none"' : ''}>
    ${errorMsg ? `
      <p class="error">${errorMsg}</p>
      <p style="font-size:14px;color:rgba(255,255,255,0.4)">Ask the list creator to send you a fresh invite link.</p>
    ` : `
      <p class="invite-label">You're invited to join</p>
      <p class="list-title">${title}</p>
      <p class="list-sub">Check off experiences together, challenge your crew, discover local spots.</p>
      <div class="bullets">
        <div class="bullet"><div class="dot"></div><span>Browse 500+ things to do nearby</span></div>
        <div class="bullet"><div class="dot"></div><span>Check off items and track your score</span></div>
        <div class="bullet"><div class="dot"></div><span>See your crew's progress live</span></div>
      </div>
      <a href="${deeplink}" class="open-btn">Open in CheckOff</a>
      <a href="${appStoreUrl}" class="store-btn">Download CheckOff — Free</a>
    `}
  </div>
</body>
</html>`
}
