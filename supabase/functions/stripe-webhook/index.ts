// supabase/functions/stripe-webhook/index.ts
//
// Handles Stripe webhook events using the official Stripe SDK with
// Supabase's recommended SubtleCrypto provider for Deno compatibility.
//
// Required Supabase secrets:
//   STRIPE_SECRET_KEY        — sk_live_...
//   STRIPE_WEBHOOK_SECRET    — whsec_...
//   SUPABASE_URL             — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected
//
// Deploy:
//   supabase functions deploy stripe-webhook --project-ref uggusbbswybyplypkbxz

import Stripe from 'https://esm.sh/stripe@14?target=denonext'
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const WEBHOOK_SECRET    = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

const stripe        = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' })
const cryptoProvider = Stripe.createSubtleCryptoProvider()

// ── Price ID → tier / interval ───────────────────────────────────────────────
const PRICE_ID_TO_TIER: Record<string, string> = {
  'price_1TS5sYD7LqjL9hj7A8IEjWGb': 'partner',      // partner monthly
  'price_1TS5sYD7LqjL9hj79RzbPMB4': 'partner',      // partner annual
  'price_1TS5sbD7LqjL9hj7ZLMIUSx2': 'rare',         // rare monthly
  'price_1TS5saD7LqjL9hj70xAiSRjX': 'rare',         // rare annual
  'price_1TS5sYD7LqjL9hj7yqHbTK4Z': 'legend',       // legend monthly
  'price_1TS5sYD7LqjL9hj7ZdNn63WF': 'legend',       // legend annual
  'price_1TktgeD7LqjL9hj7O4fAmQeQ': 'trailhead',    // city: trailhead annual
  'price_1TkthdD7LqjL9hj7PU71yRPS': 'landmark',     // city: landmark annual
  'price_1TktmQD7LqjL9hj70XIOyP2q': 'icon',         // city: icon annual
  'price_1TktoAD7LqjL9hj7M3XQNDQ9': 'district',     // neighborhood: district annual
  'price_1TktorD7LqjL9hj7OJUfJqjb': 'corridor',     // neighborhood: corridor annual
  'price_1TktpRD7LqjL9hj7fnksqs98': 'city',         // neighborhood: city annual
  'price_1TktqND7LqjL9hj7dzA6Ac3w': 'metro_anchor', // neighborhood: metro anchor annual
}

const PRICE_ID_TO_INTERVAL: Record<string, string> = {
  'price_1TS5sYD7LqjL9hj7A8IEjWGb': 'monthly',
  'price_1TS5sYD7LqjL9hj79RzbPMB4': 'annual',
  'price_1TS5sbD7LqjL9hj7ZLMIUSx2': 'monthly',
  'price_1TS5saD7LqjL9hj70xAiSRjX': 'annual',
  'price_1TS5sYD7LqjL9hj7yqHbTK4Z': 'monthly',
  'price_1TS5sYD7LqjL9hj7ZdNn63WF': 'annual',
  'price_1TktgeD7LqjL9hj7O4fAmQeQ': 'annual',
  'price_1TkthdD7LqjL9hj7PU71yRPS': 'annual',
  'price_1TktmQD7LqjL9hj70XIOyP2q': 'annual',
  'price_1TktoAD7LqjL9hj7M3XQNDQ9': 'annual',
  'price_1TktorD7LqjL9hj7OJUfJqjb': 'annual',
  'price_1TktpRD7LqjL9hj7fnksqs98': 'annual',
  'price_1TktqND7LqjL9hj7dzA6Ac3w': 'annual',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveFromSubscription(subscriptionId: string): Promise<{ tier: string; interval: string } | null> {
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
    })
    if (!res.ok) {
      console.error('Stripe subscription fetch failed:', res.status, await res.text())
      return null
    }
    const sub     = await res.json()
    const priceId = sub.items?.data?.[0]?.price?.id as string | undefined
    if (!priceId) return null
    const tier     = PRICE_ID_TO_TIER[priceId]
    const interval = PRICE_ID_TO_INTERVAL[priceId]
    if (!tier) {
      console.error(`Unknown Price ID: ${priceId} — add it to PRICE_ID_TO_TIER`)
      return null
    }
    return { tier, interval }
  } catch (e) {
    console.error('resolveFromSubscription error:', e)
    return null
  }
}

function generateSlug(name: string): string {
  const base   = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40)
  const suffix = Math.random().toString(36).substring(2, 6)
  return `${base}-${suffix}`
}

async function sendWelcomeEmail(payload: {
  to: string
  business_name: string
  partner_slug: string
  plan_tier: string
  has_secret: boolean
}): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-partner-welcome`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE}`,
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('send-partner-welcome failed:', err)
    } else {
      console.log(`Welcome email sent to ${payload.to} (slug: ${payload.partner_slug})`)
    }
  } catch (e) {
    console.error('send-partner-welcome threw:', e)
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const body      = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''

  let receivedEvent: Stripe.Event
  try {
    receivedEvent = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      WEBHOOK_SECRET,
      undefined,
      cryptoProvider
    )
  } catch (e) {
    console.error('Webhook signature verification failed:', e.message)
    return new Response(`Webhook error: ${e.message}`, { status: 400 })
  }

  console.log('Event verified:', receivedEvent.type)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE)

  // ── checkout.session.completed ───────────────────────────────────────────
  if (receivedEvent.type === 'checkout.session.completed') {
    try {
      const session = receivedEvent.data.object as Stripe.Checkout.Session

      let planTier        = (session.metadata?.plan_tier)        as string | undefined
      let billingInterval = (session.metadata?.billing_interval) as string | undefined

      if (!planTier && session.subscription) {
        const resolved = await resolveFromSubscription(session.subscription as string)
        if (resolved) {
          planTier        = resolved.tier
          billingInterval = resolved.interval
        }
      }

      planTier        = planTier        ?? 'partner'
      billingInterval = billingInterval ?? 'monthly'

      const isCityPartner = ['trailhead','landmark','icon','district','corridor','city','metro_anchor'].includes(planTier)
      console.log('Partner type:', isCityPartner ? 'city/destination' : 'business', '| Tier:', planTier)

      const existingId = session.metadata?.partner_id ?? null

      if (existingId) {
        // Founding partner converting to paid
        const { error } = await supabase
          .from('partners')
          .update({
            stripe_customer_id:     session.customer as string ?? null,
            stripe_subscription_id: session.subscription as string ?? null,
            billing_start:          new Date().toISOString().split('T')[0],
            plan_tier:              planTier,
            billing_interval:       billingInterval,
            is_active:              true,
          })
          .eq('id', existingId)

        if (error) console.error('Failed to convert founding partner:', error.message)
        else console.log(`Founding partner converted: ${existingId} → ${planTier} (${billingInterval})`)

      } else {
        // New partner signing up via Payment Link
        const fields: Record<string, string> = {}
        for (const f of session.custom_fields ?? []) {
          if (f.text?.value) fields[f.key] = f.text.value
        }

        const businessName = isCityPartner
          ? (fields['organizationname'] || session.customer_details?.name || 'New Partner')
          : (fields['businessname']     || session.customer_details?.name || 'New Partner')
        const partnerSlug  = generateSlug(businessName)
        const contactEmail = fields['email'] || session.customer_details?.email || ''

        const partnerPayload = {
          business_name:          businessName,
          contact_email:          contactEmail,
          phone:                  fields['phone'] || session.customer_details?.phone || null,
          website_url:            isCityPartner ? null : (fields['businesswebsite'] || null),
          plan_tier:              planTier,
          is_active:              true,
          billing_start:          new Date().toISOString().split('T')[0],
          stripe_customer_id:     session.customer as string ?? null,
          stripe_subscription_id: session.subscription as string ?? null,
          billing_interval:       billingInterval,
          partner_slug:           partnerSlug,
        }

        const { error } = await supabase.from('partners').insert(partnerPayload)
        if (error) {
          console.error('Failed to create partner:', error.message)
          return new Response(JSON.stringify({ received: true, dbError: error.message }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          })
        }

        console.log(`Partner created: ${businessName} (${planTier} / ${billingInterval}) slug=${partnerSlug}`)

        await sendWelcomeEmail({
          to:            contactEmail,
          business_name: businessName,
          partner_slug:  partnerSlug,
          plan_tier:     planTier,
          has_secret:    false,
        })

        // ── Internal notification to Jerry ───────────────────────────────────
        const promoCode   = (session as any).total_details?.breakdown?.discounts?.[0]?.discount?.coupon?.name ?? null
        const websiteUrl  = isCityPartner ? null : (fields['businesswebsite'] || null)
        const adminUrl    = `https://uggusbbswybyplypkbxz.supabase.co` // placeholder — replaced below
        const resendApiKey = Deno.env.get('RESEND_API_KEY')
        if (resendApiKey) {
          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${resendApiKey}`,
              },
              body: JSON.stringify({
                from:    'CheckOff <noreply@getcheckoff.com>',
                to:      ['jerry@getcheckoff.com'],
                subject: `New Partner Signed Up — ${businessName} (${planTier})`,
                html: `
<h2 style="margin:0 0 16px">🎉 New Partner: ${businessName}</h2>
<table style="border-collapse:collapse;width:100%;max-width:520px;font-family:sans-serif;font-size:14px">
  <tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap">Business</td><td style="padding:6px 0"><strong>${businessName}</strong></td></tr>
  <tr><td style="padding:6px 12px 6px 0;color:#666">Tier</td><td style="padding:6px 0"><strong>${planTier}</strong> / ${billingInterval}</td></tr>
  <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td style="padding:6px 0">${contactEmail || '—'}</td></tr>
  <tr><td style="padding:6px 12px 6px 0;color:#666">Website</td><td style="padding:6px 0">${websiteUrl ? `<a href="${websiteUrl}">${websiteUrl}</a>` : '—'}</td></tr>
  ${promoCode ? `<tr><td style="padding:6px 12px 6px 0;color:#666">Promo code</td><td style="padding:6px 0;color:#c0392b"><strong>${promoCode}</strong></td></tr>` : ''}
</table>

<h3 style="margin:24px 0 12px;font-family:sans-serif">✅ What to do now</h3>
<ul style="font-family:sans-serif;font-size:14px;line-height:2;padding-left:20px;margin:0">
  <li>✉️ Send handwritten welcome note</li>
  <li>📦 Package and mail Visitor Activation Kit</li>
  <li>🖊️ Write and publish their item in the app <em>(within 24 hrs)</em></li>
  <li>🔗 Assign their <code>neighborhood_id</code> in admin</li>
  <li>📸 Add their photo to their partner profile</li>
  <li>🔑 Send them their partner portal link</li>
</ul>

<p style="margin:24px 0 8px;font-family:sans-serif;font-size:14px">
  <a href="https://uggusbbswybyplypkbxz.supabase.co/dashboard/project/uggusbbswybyplypkbxz/editor" style="background:#F5A623;color:#1A1A2E;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">
    Open Admin → Partners tab
  </a>
</p>
<p style="font-family:sans-serif;font-size:12px;color:#999;margin-top:8px">Slug: ${partnerSlug}</p>
                `.trim(),
              }),
            })
            console.log(`Internal notification sent to jerry@getcheckoff.com for ${businessName}`)
          } catch (notifyErr) {
            console.error('Internal notification error (non-fatal):', notifyErr)
          }
        } else {
          console.warn('RESEND_API_KEY not set — internal notification skipped')
        }
        // ── End internal notification ─────────────────────────────────────────

        // ── Creator attribution ──────────────────────────────────────────────
        // Only fires when a business arrived via a creator referral link
        // (getcheckoff.com/partner?ref=[handle] → create-partner-checkout).
        // Existing Payment Link signups have no creator_handle — this block
        // is entirely skipped for them.
        const creatorHandle = session.metadata?.creator_handle ?? null
        if (creatorHandle && !isCityPartner) {
          try {
            // 1. Look up creator by handle
            const { data: creator } = await supabase
              .from('creators')
              .select('id, user_id, handle, display_name, is_active')
              .eq('handle', creatorHandle)
              .maybeSingle()

            if (!creator) {
              console.warn(`Creator attribution: handle "${creatorHandle}" not found — skipping`)
            } else {
              // 2. Tag the new partner with the referring creator
              const { data: newPartner } = await supabase
                .from('partners')
                .select('id')
                .eq('partner_slug', partnerSlug)
                .maybeSingle()

              if (newPartner?.id) {
                await supabase
                  .from('partners')
                  .update({ referred_by_creator_id: creator.id })
                  .eq('id', newPartner.id)
              }

              // 3. Commission amounts in cents by tier / interval
              const COMMISSIONS: Record<string, Record<string, number>> = {
                partner: { monthly: 2000, annual: 6000  },
                rare:    { monthly: 3500, annual: 10000 },
                legend:  { monthly: 6000, annual: 20000 },
              }
              const commissionCents = COMMISSIONS[planTier]?.[billingInterval] ?? null

              if (commissionCents) {
                await supabase.from('partner_rewards').insert({
                  creator_id:     creator.id,
                  partner_id:     newPartner?.id ?? null,
                  reward_type:    'base_commission',
                  amount_cents:   commissionCents,
                  status:         'pending',
                  milestone_date: new Date().toISOString(),
                })
                console.log(`Creator commission logged: ${creatorHandle} → ${commissionCents / 100} USD (${planTier}/${billingInterval})`)
              }

              // 4. Flip creator's list public if not already (or fetch if already public),
              //    and mark it featured-eligible since a real partner just attributed to it.
              //    A creator can now own multiple lists (admin-created via Part 1) — always
              //    target the oldest one (the original list) for deterministic attribution.
              let creatorList = await (async () => {
                const { data: privateList } = await supabase
                  .from('lists')
                  .select('id, title')
                  .eq('checkoff_creator_id', creator.id)
                  .eq('is_creator_list', true)
                  .eq('is_public', false)
                  .order('created_at', { ascending: true })
                  .limit(1)
                  .maybeSingle()
                if (privateList) {
                  const now = new Date().toISOString()
                  await supabase
                    .from('lists')
                    .update({ is_public: true, goes_public_at: now, is_featured_eligible: true })
                    .eq('id', privateList.id)
                  console.log(`Creator list flipped public + featured: ${privateList.id} ("${privateList.title}")`)
                  return privateList
                }
                // Already public — still need the id for item auto-add
                const { data: publicList } = await supabase
                  .from('lists')
                  .select('id, title')
                  .eq('checkoff_creator_id', creator.id)
                  .eq('is_creator_list', true)
                  .order('created_at', { ascending: true })
                  .limit(1)
                  .maybeSingle()
                if (publicList) {
                  await supabase
                    .from('lists')
                    .update({ is_featured_eligible: true })
                    .eq('id', publicList.id)
                  console.log(`Creator list marked featured-eligible: ${publicList.id} ("${publicList.title}")`)
                }
                return publicList ?? null
              })()

              // 4b. If partner has an item_id, auto-add it to creator's list
              if (creatorList && newPartner?.id) {
                const { data: partnerRow } = await supabase
                  .from('partners')
                  .select('item_id')
                  .eq('id', newPartner.id)
                  .maybeSingle()

                if (partnerRow?.item_id) {
                  const { data: existing } = await supabase
                    .from('list_items')
                    .select('id')
                    .eq('list_id', creatorList.id)
                    .eq('item_id', partnerRow.item_id)
                    .maybeSingle()

                  if (!existing) {
                    await supabase.from('list_items').insert({
                      list_id:         creatorList.id,
                      item_id:         partnerRow.item_id,
                      sort_order:      -1,
                      is_partner_item: true,
                    })
                    console.log(`Partner item auto-added to creator list: item ${partnerRow.item_id} → list ${creatorList.id}`)
                  }
                }
              }

              if (creatorList) {
                // 5. Email the creator — get their email from auth.users via user_id
                if (creator.user_id) {
                  const { data: creatorUser } = await supabase.auth.admin.getUserById(creator.user_id)
                  const creatorEmail = creatorUser?.user?.email ?? null

                  if (creatorEmail) {
                    await fetch(`${SUPABASE_URL}/functions/v1/send-creator-list-live`, {
                      method:  'POST',
                      headers: {
                        'Content-Type':  'application/json',
                        'Authorization': `Bearer ${SUPABASE_SERVICE}`,
                      },
                      body: JSON.stringify({
                        to:                   creatorEmail,
                        creator_handle:       creator.handle,
                        display_name:         creator.display_name ?? creator.handle,
                        partner_business_name: businessName,
                        list_title:           creatorList.title,
                        plan_tier:            planTier,
                        commission_cents:     commissionCents,
                      }),
                    })
                  }
                }
              } // end if (creatorList) email block
            }
          } catch (attrErr) {
            // Attribution is non-critical — partner signup already succeeded
            const msg = attrErr instanceof Error ? attrErr.message : String(attrErr)
            console.error('Creator attribution error (non-fatal):', msg)
          }
        }
        // ── End creator attribution ─────────────────────────────────────────
      }
    } catch (e) {
      console.error('checkout handler error:', e.message, e.stack)
    }
  }

  // ── customer.subscription.deleted ───────────────────────────────────────
  if (receivedEvent.type === 'customer.subscription.deleted') {
    const sub = receivedEvent.data.object as Stripe.Subscription

    const { error } = await supabase
      .from('partners')
      .update({ is_active: false })
      .eq('stripe_subscription_id', sub.id)

    if (error) console.error('Failed to deactivate partner:', error.message)
    else console.log(`Partner deactivated: sub ${sub.id}`)
  }

  // ── customer.subscription.updated ───────────────────────────────────────
  if (receivedEvent.type === 'customer.subscription.updated') {
    const sub     = receivedEvent.data.object as Stripe.Subscription
    const priceId = sub.items?.data?.[0]?.price?.id
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
    } else if (priceId) {
      console.error(`subscription.updated: unknown Price ID ${priceId}`)
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
