// supabase/functions/stripe-webhook/index.ts
//
// Listens for Stripe webhook events and creates/updates partner records.
//
// Handles:
//   checkout.session.completed  → create new partner row
//   customer.subscription.deleted → deactivate partner
//   customer.subscription.updated → update plan tier if they upgrade/downgrade
//
// Required Supabase secrets (set via Supabase Dashboard → Settings → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY        — sk_live_... from Stripe Dashboard → Developers → API Keys
//   STRIPE_WEBHOOK_SECRET    — whsec_... from Stripe Dashboard → Webhooks → your endpoint → Signing secret
//   SUPABASE_URL             — auto-injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase
//
// Deploy:
//   supabase functions deploy stripe-webhook --project-ref uggusbbswybyplypkbxz
//
// Stripe webhook endpoint URL (add this in Stripe Dashboard → Developers → Webhooks → Add endpoint):
//   https://uggusbbswybyplypkbxz.supabase.co/functions/v1/stripe-webhook
//
// Events to subscribe to in Stripe:
//   checkout.session.completed
//   customer.subscription.deleted
//   customer.subscription.updated

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET   = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

// Maps Stripe Price IDs → plan tier strings stored in your DB.
// Stripe Dashboard → Products → [product] → Pricing → copy the "API ID" (price_xxx)
const pm = Deno.env.get('STRIPE_PRICE_PARTNER_MONTHLY') ?? 'UNSET_PM'
const pa = Deno.env.get('STRIPE_PRICE_PARTNER_ANNUAL')  ?? 'UNSET_PA'
const rm = Deno.env.get('STRIPE_PRICE_RARE_MONTHLY')    ?? 'UNSET_RM'
const ra = Deno.env.get('STRIPE_PRICE_RARE_ANNUAL')     ?? 'UNSET_RA'
const lm = Deno.env.get('STRIPE_PRICE_LEGEND_MONTHLY')  ?? 'UNSET_LM'
const la = Deno.env.get('STRIPE_PRICE_LEGEND_ANNUAL')   ?? 'UNSET_LA'

const PRICE_ID_TO_TIER: Record<string, string> = {
  [pm]: 'partner', [pa]: 'partner',
  [rm]: 'rare',    [ra]: 'rare',
  [lm]: 'legend',  [la]: 'legend',
}

// Maps Stripe Price IDs → billing interval so subscription.updated can sync it too.
const PRICE_ID_TO_INTERVAL: Record<string, string> = {
  [pm]: 'monthly', [pa]: 'annual',
  [rm]: 'monthly', [ra]: 'annual',
  [lm]: 'monthly', [la]: 'annual',
}

// Verify Stripe webhook signature using the raw body + secret.
// We do this manually since there's no official Stripe Deno SDK.
async function verifyStripeSignature(body: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    const parts   = sigHeader.split(',').reduce((acc: Record<string, string>, p) => {
      const [k, v] = p.split('=')
      acc[k] = v
      return acc
    }, {})
    const ts      = parts['t']
    const sig     = parts['v1']
    const payload = `${ts}.${body}`
    const key     = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const mac     = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    const hex     = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
    return hex === sig
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const body      = await req.text()
  const sigHeader = req.headers.get('stripe-signature') ?? ''

  const valid = await verifyStripeSignature(body, sigHeader, WEBHOOK_SECRET)
  if (!valid) {
    console.error('Stripe webhook signature verification failed')
    return new Response('Invalid signature', { status: 400 })
  }

  let event: { type: string; data: { object: Record<string, unknown> } }
  try {
    event = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE)

  // ── checkout.session.completed ───────────────────────────────────────────
  // Fires when a business owner completes payment on a Payment Link.
  // We create the partner record here.
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as {
      id: string
      customer: string
      subscription: string
      customer_details: { email: string; name: string; phone: string | null }
      metadata: Record<string, string>
      custom_fields: Array<{ key: string; text?: { value: string } }>
    }

    // Custom fields you configured on the Payment Link in Stripe Dashboard.
    // We use: business_name (required), phone (optional)
    const fields: Record<string, string> = {}
    for (const f of session.custom_fields ?? []) {
      if (f.text?.value) fields[f.key] = f.text.value
    }

    // Plan tier comes from metadata on the Payment Link.
    // Set this in Stripe Dashboard when creating each Payment Link:
    //   Metadata key: plan_tier   Value: partner | rare | legend
    //   Metadata key: billing_interval  Value: monthly | annual
    const planTier        = session.metadata?.plan_tier ?? 'partner'
    const billingInterval = session.metadata?.billing_interval ?? 'monthly'

    const partnerPayload = {
      business_name:          fields['business_name'] || session.customer_details?.name || 'New Partner',
      contact_email:          session.customer_details?.email ?? '',
      phone:                  fields['phone'] || session.customer_details?.phone || null,
      plan_tier:              planTier,
      is_active:              true,
      billing_start:          new Date().toISOString().split('T')[0],
      stripe_customer_id:     session.customer ?? null,
      stripe_subscription_id: session.subscription ?? null,
      billing_interval:       billingInterval,
    }

    const { error } = await supabase.from('partners').insert(partnerPayload)

    if (error) {
      console.error('Failed to create partner:', error.message)
      // Return 200 anyway so Stripe doesn't keep retrying for a DB issue we need to fix manually
      return new Response(JSON.stringify({ received: true, dbError: error.message }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    console.log(`Partner created: ${partnerPayload.business_name} (${planTier})`)
  }

  // ── customer.subscription.deleted ───────────────────────────────────────
  // Fires when a subscription is cancelled (immediately or at period end).
  // Deactivate the partner record.
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as { id: string; customer: string }

    const { error } = await supabase
      .from('partners')
      .update({ is_active: false })
      .eq('stripe_subscription_id', sub.id)

    if (error) console.error('Failed to deactivate partner:', error.message)
    else console.log(`Partner deactivated: sub ${sub.id}`)
  }

  // ── customer.subscription.updated ───────────────────────────────────────
  // Fires when a customer upgrades or downgrades their plan.
  // Update the tier in the DB.
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as {
      id: string
      items: { data: Array<{ price: { id: string } }> }
      status: string
    }

    const priceId     = sub.items?.data?.[0]?.price?.id
    const newTier     = priceId ? PRICE_ID_TO_TIER[priceId]     : undefined
    const newInterval = priceId ? PRICE_ID_TO_INTERVAL[priceId] : undefined

    if (newTier) {
      const patch: Record<string, unknown> = {
        plan_tier: newTier,
        is_active: sub.status === 'active',
      }
      if (newInterval) patch.billing_interval = newInterval

      const { error } = await supabase
        .from('partners')
        .update(patch)
        .eq('stripe_subscription_id', sub.id)

      if (error) console.error('Failed to update partner tier:', error.message)
      else console.log(`Partner updated: sub ${sub.id} → ${newTier} (${newInterval ?? 'interval unchanged'})`)
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
