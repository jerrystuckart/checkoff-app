// supabase/functions/create-partner-checkout/index.ts
//
// Creates a dynamic Stripe Checkout Session for creator referral links.
// Used only when a business arrives via getcheckoff.com/partner?ref=[handle].
// Existing static Payment Links are untouched and continue to work independently.
//
// POST { plan_tier, billing_interval, creator_handle }
// Returns { checkout_url }
//
// Required secrets (already set from stripe-webhook):
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_PARTNER_MONTHLY / _ANNUAL
//   STRIPE_PRICE_RARE_MONTHLY    / _ANNUAL
//   STRIPE_PRICE_LEGEND_MONTHLY  / _ANNUAL
//
// Deploy:
//   supabase functions deploy create-partner-checkout --project-ref uggusbbswybyplypkbxz

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY')!

// Same Price IDs used by send-partner-renewal
// Price IDs must match exactly what's in the Stripe dashboard and stripe-webhook.
// These are hardcoded — do not swap for env vars which may contain dollar amounts.
const PRICE_IDS: Record<string, Record<string, string>> = {
  partner: {
    monthly: 'price_1TS5sYD7LqjL9hj7A8IEjWGb',
    annual:  'price_1TS5sYD7LqjL9hj79RzbPMB4',
  },
  rare: {
    monthly: 'price_1TS5sbD7LqjL9hj7ZLMIUSx2',
    annual:  'price_1TS5saD7LqjL9hj70xAiSRjX',
  },
  legend: {
    monthly: 'price_1TS5sYD7LqjL9hj7yqHbTK4Z',
    annual:  'price_1TS5sYD7LqjL9hj7ZdNn63WF',
  },
}

const VALID_TIERS     = ['partner', 'rare', 'legend'] as const
const VALID_INTERVALS = ['monthly', 'annual'] as const

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405 })

  try {
    const body = await req.json() as {
      plan_tier?:        string
      billing_interval?: string
      creator_handle?:   string
    }

    const plan_tier        = body.plan_tier        ?? 'partner'
    const billing_interval = body.billing_interval ?? 'monthly'
    const creator_handle   = body.creator_handle   ?? null

    if (!VALID_TIERS.includes(plan_tier as typeof VALID_TIERS[number])) {
      return new Response(JSON.stringify({ error: `Invalid plan_tier: ${plan_tier}` }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    if (!VALID_INTERVALS.includes(billing_interval as typeof VALID_INTERVALS[number])) {
      return new Response(JSON.stringify({ error: `Invalid billing_interval: ${billing_interval}` }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const priceId = PRICE_IDS[plan_tier][billing_interval]
    if (!priceId) {
      return new Response(JSON.stringify({ error: `No price ID configured for ${plan_tier} ${billing_interval}` }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const params = new URLSearchParams({
      'mode':                       'subscription',
      'success_url':                'https://getcheckoff.com/partner-success?session_id={CHECKOUT_SESSION_ID}',
      'cancel_url':                 'https://getcheckoff.com/partner',
      'line_items[0][price]':       priceId,
      'line_items[0][quantity]':    '1',
      'metadata[plan_tier]':        plan_tier,
      'metadata[billing_interval]': billing_interval,
      // Custom fields mirror the existing Payment Link configuration so the
      // webhook can read businessname, phone, etc. identically
      'custom_fields[0][key]':      'businessname',
      'custom_fields[0][label][type]':    'custom',
      'custom_fields[0][label][custom]':  'Business name',
      'custom_fields[0][type]':     'text',
      'custom_fields[1][key]':      'phone',
      'custom_fields[1][label][type]':    'custom',
      'custom_fields[1][label][custom]':  'Phone number',
      'custom_fields[1][type]':     'text',
      'custom_fields[1][optional]': 'true',
      'custom_fields[2][key]':      'businesswebsite',
      'custom_fields[2][label][type]':    'custom',
      'custom_fields[2][label][custom]':  'Business website',
      'custom_fields[2][type]':     'text',
      'custom_fields[2][optional]': 'true',
    })

    // creator_handle in metadata is the key that triggers attribution in the webhook
    if (creator_handle) {
      params.set('metadata[creator_handle]', creator_handle)
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const session = await res.json() as { url?: string; error?: { message: string } }

    if (session.error) {
      console.error('Stripe session error:', session.error.message)
      return new Response(JSON.stringify({ error: session.error.message }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    console.log(`Checkout session created: ${plan_tier}/${billing_interval} creator=${creator_handle ?? 'none'}`)

    return new Response(JSON.stringify({ checkout_url: session.url }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('create-partner-checkout error:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
