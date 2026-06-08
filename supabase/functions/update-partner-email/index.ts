// supabase/functions/update-partner-email/index.ts
//
// Updates a partner's login email in BOTH places:
//   1. partners.contact_email  (your app table)
//   2. auth.users.email        (Supabase Auth — what the magic link is sent to)
//
// Without updating auth.users the partner cannot log into the portal
// with their new email — the magic link would never arrive.
//
// POST { partner_id: "uuid", new_email: "new@example.com" }
// Requires: valid JWT from a user with profiles.is_admin = true
// Returns:  { success: true, auth_updated: bool }
//
// Deploy:
//   supabase functions deploy update-partner-email --project-ref uggusbbswybyplypkbxz --workdir /Users/jerrystuckart/Downloads/checkoff --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SVC  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Content-Type': 'application/json',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS, status: 204 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { headers: CORS, status: 405 })
  }

  // ── Verify the caller is a signed-in admin ────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), { headers: CORS, status: 401 })
  }

  // Use anon client with the caller's JWT to check their profile
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), { headers: CORS, status: 401 })
  }

  const { data: profile } = await callerClient
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return new Response(JSON.stringify({ error: 'Admin only' }), { headers: CORS, status: 403 })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { partner_id?: string; new_email?: string } = {}
  try { body = await req.json() } catch { /* empty */ }

  const { partner_id, new_email } = body
  const cleanEmail = new_email?.toLowerCase().trim() ?? ''
  if (!partner_id || !cleanEmail.includes('@')) {
    return new Response(JSON.stringify({ error: 'partner_id and valid new_email required' }), { headers: CORS, status: 400 })
  }

  // ── Service-role client for auth.admin operations ─────────────────────────
  const supabase = createClient(SUPABASE_URL, SUPABASE_SVC)

  // ── Look up partner's current email ───────────────────────────────────────
  const { data: partner, error: pErr } = await supabase
    .from('partners')
    .select('id, business_name, contact_email')
    .eq('id', partner_id)
    .single()

  if (pErr || !partner) {
    return new Response(JSON.stringify({ error: 'Partner not found' }), { headers: CORS, status: 404 })
  }

  const oldEmail = partner.contact_email?.toLowerCase().trim()

  // ── Update partners table first ───────────────────────────────────────────
  const { error: dbErr } = await supabase
    .from('partners')
    .update({ contact_email: cleanEmail })
    .eq('id', partner_id)

  if (dbErr) {
    return new Response(JSON.stringify({ error: `DB update failed: ${dbErr.message}` }), { headers: CORS, status: 500 })
  }

  // ── Find the auth.users record by old email and update it ─────────────────
  // If the partner hasn't logged in yet there's no auth record — that's fine,
  // they'll create one with the new email when they first sign in.
  let authUpdated = false
  if (oldEmail && oldEmail !== cleanEmail) {
    const { data: userList, error: listErr } = await supabase.auth.admin.listUsers()
    if (!listErr) {
      const authUser = userList.users.find(u => u.email?.toLowerCase() === oldEmail)
      if (authUser) {
        const { error: authErr } = await supabase.auth.admin.updateUserById(authUser.id, {
          email: cleanEmail,
        })
        if (authErr) {
          // DB already updated — return partial success so caller knows
          console.error(`Auth update failed for ${oldEmail}:`, authErr.message)
          return new Response(JSON.stringify({
            success:      true,
            auth_updated: false,
            warning:      `partners table updated but auth email update failed: ${authErr.message}`,
          }), { headers: CORS })
        }
        authUpdated = true
        console.log(`Auth email updated: ${oldEmail} → ${cleanEmail} (uid: ${authUser.id})`)
      } else {
        console.log(`No auth account yet for ${oldEmail} — partners table updated only`)
      }
    }
  }

  return new Response(JSON.stringify({
    success:       true,
    business_name: partner.business_name,
    old_email:     oldEmail,
    new_email:     cleanEmail,
    auth_updated:  authUpdated,
  }), { headers: CORS })
})
