// supabase/functions/update-partner-item/index.ts
//
// Allows partners to edit their item description from the partner portal.
// Rate-limited by tier:
//   legend  → once per calendar month
//   rare    → once per calendar quarter
//   partner → read-only (403)
//
// POST { item_id, body, website_url? }
// Authorization: Bearer <partner JWT>
//
// Deploy:
//   supabase functions deploy update-partner-item --project-ref uggusbbswybyplypkbxz --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Content-Type': 'application/json',
}

function getQuarter(d: Date) { return Math.floor(d.getMonth() / 3) }

// Returns null if edit is allowed, or an object with next allowed date if blocked
function checkRateLimit(tier: string, lastEditAt: string | null): { blocked: boolean; nextDate: string | null } {
  if (tier === 'partner') return { blocked: true, nextDate: null }
  if (!lastEditAt)        return { blocked: false, nextDate: null }

  const now  = new Date()
  const last = new Date(lastEditAt)

  if (tier === 'legend') {
    // once per calendar month — blocked if last edit was this same month
    const sameMonth = last.getFullYear() === now.getFullYear() && last.getMonth() === now.getMonth()
    if (!sameMonth) return { blocked: false, nextDate: null }
    // Next allowed: first day of next month
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return { blocked: true, nextDate: next.toISOString().slice(0, 10) }
  }

  if (tier === 'rare') {
    // once per calendar quarter — blocked if last edit was this same quarter/year
    const sameQ = last.getFullYear() === now.getFullYear() && getQuarter(last) === getQuarter(now)
    if (!sameQ) return { blocked: false, nextDate: null }
    // Next allowed: first day of next quarter
    const nextQMonth = (getQuarter(now) + 1) * 3
    const next = nextQMonth >= 12
      ? new Date(now.getFullYear() + 1, 0, 1)
      : new Date(now.getFullYear(), nextQMonth, 1)
    return { blocked: true, nextDate: next.toISOString().slice(0, 10) }
  }

  return { blocked: false, nextDate: null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS, status: 204 })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { headers: CORS, status: 405 })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return new Response(JSON.stringify({ error: 'Missing auth token' }), { headers: CORS, status: 401 })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SVC)
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt)
  if (authErr || !user?.email) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { headers: CORS, status: 401 })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { item_id?: string; body?: string; website_url?: string } = {}
  try { body = await req.json() } catch { /* empty */ }

  const { item_id, body: newBody, website_url } = body
  if (!item_id) return new Response(JSON.stringify({ error: 'item_id required' }), { headers: CORS, status: 400 })
  if (!newBody?.trim()) return new Response(JSON.stringify({ error: 'body text required' }), { headers: CORS, status: 400 })

  // ── Look up partner ───────────────────────────────────────────────────────
  const { data: partner, error: pErr } = await supabase
    .from('partners')
    .select('id,plan_tier,is_active')
    .eq('contact_email', user.email.toLowerCase())
    .single()

  if (pErr || !partner) {
    return new Response(JSON.stringify({ error: 'No partner account found' }), { headers: CORS, status: 404 })
  }
  if (!partner.is_active) {
    return new Response(JSON.stringify({ error: 'Partner account is not active' }), { headers: CORS, status: 403 })
  }

  // ── Verify item belongs to this partner ───────────────────────────────────
  const { data: item, error: iErr } = await supabase
    .from('items')
    .select('id,body,website_url,partner_edited_at')
    .eq('id', item_id)
    .eq('partner_id', partner.id)
    .single()

  if (iErr || !item) {
    return new Response(JSON.stringify({ error: 'Item not found on your account' }), { headers: CORS, status: 404 })
  }

  // ── Rate limit check ──────────────────────────────────────────────────────
  const { blocked, nextDate } = checkRateLimit(partner.plan_tier, item.partner_edited_at)
  if (blocked) {
    const msg = partner.plan_tier === 'partner'
      ? 'Partner tier is read-only. Upgrade to Rare or Legend to edit your item.'
      : `You already edited this item ${partner.plan_tier === 'rare' ? 'this quarter' : 'this month'}. Next edit available: ${nextDate}`
    return new Response(JSON.stringify({ error: msg, nextDate }), { headers: CORS, status: 429 })
  }

  // ── Apply update ──────────────────────────────────────────────────────────
  const patch: Record<string, unknown> = {
    body:              newBody.trim(),
    partner_edited_at: new Date().toISOString(),
  }
  if (website_url !== undefined) patch.website_url = website_url?.trim() || null

  const { error: upErr } = await supabase
    .from('items')
    .update(patch)
    .eq('id', item_id)

  if (upErr) {
    console.error('Item update failed:', upErr.message)
    return new Response(JSON.stringify({ error: 'Update failed' }), { headers: CORS, status: 500 })
  }

  console.log(`Partner ${partner.id} updated item ${item_id}`)
  return new Response(JSON.stringify({ success: true }), { headers: CORS })
})
