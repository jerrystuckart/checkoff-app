// supabase/functions/admin-creator-link/index.ts
//
// Creates (or finds) the auth.users account for a creator by email, and
// links it to creators.user_id — the field the app's list-authorship
// system actually keys off (distinct from checkoff_creator_id, the
// marketing-profile FK). Without a linked account, admin's "Add List"
// button for a creator has nothing to set lists.creator_id to.
//
// auth.admin.generateLink() creates the auth.users row as a side effect
// if the email doesn't have one yet — no password, no app install
// required. Same pattern as admin-partner-link, adapted for creators.
//
// POST { creator_id: "uuid" }
// Returns { url, email, user_id, handle }
//
// Protected by ADMIN_SECRET header — only the admin page can call it.
//
// Required secrets:
//   ADMIN_SECRET              — same value as admin-partner-link
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected
//
// Deploy:
//   supabase functions deploy admin-creator-link --project-ref uggusbbswybyplypkbxz

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ADMIN_SECRET = Deno.env.get('ADMIN_SECRET') ?? ''

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
  let body: { creator_id?: string } = {}
  try { body = await req.json() } catch { /* empty */ }

  if (!body.creator_id) {
    return new Response(JSON.stringify({ error: 'creator_id required' }), { headers: CORS, status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SVC)

  // ── Look up creator + contact email ───────────────────────────────────────
  const { data: creator, error: cErr } = await supabase
    .from('creators')
    .select('id, handle, contact_email, user_id')
    .eq('id', body.creator_id)
    .single()

  if (cErr || !creator) {
    return new Response(JSON.stringify({ error: 'Creator not found' }), { headers: CORS, status: 404 })
  }

  if (!creator.contact_email) {
    return new Response(
      JSON.stringify({ error: 'No contact email set for this creator — add one in the edit drawer first' }),
      { headers: CORS, status: 400 }
    )
  }

  // ── Create (or find) their auth account, get a real user id ──────────────
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type:  'magiclink',
    email: creator.contact_email,
    options: {
      redirectTo: 'https://getcheckoff.com/download',
    },
  })

  if (linkErr || !linkData?.user?.id) {
    const reason = linkErr?.message ?? `no user id in response (data: ${JSON.stringify(linkData)})`
    console.error('generateLink error:', reason)
    return new Response(JSON.stringify({ error: reason }), { headers: CORS, status: 500 })
  }

  // ── Link it to the creator row ────────────────────────────────────────────
  const { error: updErr } = await supabase
    .from('creators')
    .update({ user_id: linkData.user.id })
    .eq('id', creator.id)

  if (updErr) {
    console.error('Failed to write creators.user_id:', updErr.message)
    return new Response(JSON.stringify({ error: `Account created but failed to link: ${updErr.message}` }), { headers: CORS, status: 500 })
  }

  console.log(`Account linked for creator @${creator.handle} (${creator.contact_email}) → ${linkData.user.id}`)

  return new Response(JSON.stringify({
    url:     linkData.properties?.action_link ?? null,
    email:   creator.contact_email,
    user_id: linkData.user.id,
    handle:  creator.handle,
  }), { headers: CORS })
})
