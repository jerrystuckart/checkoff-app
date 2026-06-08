// supabase/functions/get-partner-data/index.ts
//
// Returns all data needed for the partner self-service portal dashboard.
// Called by the dashboard page with the partner's Supabase JWT.
//
// Returns:
//   { partner, items, photos, totalCheckins, monthCheckins, billingPortalUrl }
//
// Deploy:
//   supabase functions deploy get-partner-data --project-ref uggusbbswybyplypkbxz

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SVC    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRIPE_SECRET   = Deno.env.get('STRIPE_SECRET_KEY')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Content-Type': 'application/json',
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS, status: 204 })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { headers: CORS, status: 405 })
  }

  // ── Extract JWT from Authorization header ─────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Missing auth token' }), { headers: CORS, status: 401 })
  }

  // ── Validate JWT and get user email ───────────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SUPABASE_SVC)
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user?.email) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { headers: CORS, status: 401 })
  }

  const email = user.email.toLowerCase()

  // ── Fetch partner record ──────────────────────────────────────────────────
  const { data: partner, error: partnerError } = await supabase
    .from('partners')
    .select('id,business_name,partner_slug,plan_tier,is_active,is_founding,billing_start,billing_interval,stripe_customer_id,stripe_subscription_id,contact_email,phone,neighborhood_id,renewal_sent_at')
    .eq('contact_email', email)
    .single()

  if (partnerError || !partner) {
    return new Response(JSON.stringify({ error: 'No partner account found for this email' }), { headers: CORS, status: 404 })
  }

  // ── Fetch items belonging to this partner ─────────────────────────────────
  const { data: items } = await supabase
    .from('items')
    .select('id,body,is_active,checkin_type,difficulty,photo_required,is_secret,neighborhood_id,website_url,partner_edited_at')
    .eq('partner_id', partner.id)
    .order('body')

  const partnerItems = items ?? []
  const itemIds = partnerItems.map((i: { id: string }) => i.id)

  // ── Fetch list_items for those items ─────────────────────────────────────
  let listItems: Array<{ id: string; item_id: string }> = []
  if (itemIds.length > 0) {
    const { data: li } = await supabase
      .from('list_items')
      .select('id,item_id')
      .in('item_id', itemIds)
      .limit(5000)
    listItems = li ?? []
  }

  const listItemIds = listItems.map((li) => li.id)

  // ── Check-in stats ─────────────────────────────────────────────────────────
  let totalCheckins = 0
  let monthCheckins = 0

  if (listItemIds.length > 0) {
    const { count: total } = await supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .in('list_item_id', listItemIds)
    totalCheckins = total ?? 0

    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const { count: month } = await supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .in('list_item_id', listItemIds)
      .gte('created_at', monthStart.toISOString())
    monthCheckins = month ?? 0
  }

  // ── Recent photos (last 30 days) ──────────────────────────────────────────
  let photos: Array<Record<string, unknown>> = []
  if (listItemIds.length > 0) {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: checkIns } = await supabase
      .from('check_ins')
      .select('id,photo_url,photo_width,photo_height,created_at,list_item_id')
      .in('list_item_id', listItemIds)
      .not('photo_url', 'is', null)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(100)

    photos = (checkIns ?? []).map((ci) => {
      const li   = listItems.find((l) => l.id === ci.list_item_id)
      const item = li ? partnerItems.find((i: { id: string }) => i.id === li.item_id) : null
      return { ...ci, itemBody: (item as { body?: string } | null)?.body ?? '' }
    })
  }

  // ── Stripe billing portal URL ─────────────────────────────────────────────
  let billingPortalUrl: string | null = null
  if (partner.stripe_customer_id && STRIPE_SECRET) {
    try {
      const params = new URLSearchParams({
        customer:     partner.stripe_customer_id,
        return_url:   'https://getcheckoff.com/partner-portal/dashboard',
      })
      const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${STRIPE_SECRET}`,
          'Content-Type':  'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      })
      const session = await res.json() as { url?: string; error?: { message: string } }
      if (session.url) billingPortalUrl = session.url
      else console.error('Stripe billing portal error:', session.error?.message)
    } catch (e) {
      console.error('Stripe billing portal failed:', e)
    }
  }

  return new Response(JSON.stringify({
    partner,
    items:          partnerItems,
    photos,
    totalCheckins,
    monthCheckins,
    billingPortalUrl,
  }), { headers: CORS })
})
