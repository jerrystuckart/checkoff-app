// supabase/functions/admin-partner-link/index.ts
//
// Generates a one-time magic link for a partner's email so an admin
// can preview exactly what that partner sees on their portal dashboard.
//
// POST { partner_id: "uuid" }
// Returns { url: "https://..." }
//
// Protected by ADMIN_SECRET header — only the admin page can call it.
//
// Required secrets:
//   ADMIN_SECRET            — set any strong string, add to admin HTML config
//   SUPABASE_URL            — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected
//
// Deploy:
//   supabase functions deploy admin-partner-link --project-ref uggusbbswybyplypkbxz

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SVC    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ADMIN_SECRET    = Deno.env.get('ADMIN_SECRET') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-admin-secret',
  'Content-Type': 'application/json',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS, status: 204 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { headers: CORS, status: 405 })
  }

  // ── Verify admin secret ───────────────────────────────────────────────────
  const secret = req.headers.get('x-admin-secret') ?? ''
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { headers: CORS, status: 401 })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { partner_id?: string } = {}
  try { body = await req.json() } catch { /* empty */ }

  if (!body.partner_id) {
    return new Response(JSON.stringify({ error: 'partner_id required' }), { headers: CORS, status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SVC)

  // ── Look up partner email ─────────────────────────────────────────────────
  const { data: partner, error: pErr } = await supabase
    .from('partners')
    .select('id, business_name, contact_email')
    .eq('id', body.partner_id)
    .single()

  if (pErr || !partner) {
    return new Response(JSON.stringify({ error: 'Partner not found' }), { headers: CORS, status: 404 })
  }

  // ── Generate magic link ───────────────────────────────────────────────────
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type:       'magiclink',
    email:      partner.contact_email,
    options: {
      redirectTo: 'https://getcheckoff.com/partner-portal/dashboard',
    },
  })

  if (linkErr || !linkData?.properties?.action_link) {
    const reason = linkErr?.message ?? `no action_link in response (data: ${JSON.stringify(linkData)})`
    console.error('Magic link error:', reason)
    return new Response(JSON.stringify({ error: reason }), { headers: CORS, status: 500 })
  }

  console.log(`Admin preview link generated for: ${partner.business_name} (${partner.contact_email})`)

  return new Response(JSON.stringify({
    url:           linkData.properties.action_link,
    business_name: partner.business_name,
    email:         partner.contact_email,
  }), { headers: CORS })
})
