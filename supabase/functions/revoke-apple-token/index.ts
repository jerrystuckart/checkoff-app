// supabase/functions/revoke-apple-token/index.ts
//
// Sign in with Apple token revocation for account deletion (App Review Guideline 5.1.1(v) / Apple "Offering account deletion in your app").
//
// The app signs in natively (signInWithIdToken), so Supabase never receives Apple's authorization code or refresh token and there is nothing stored to
// revoke. At deletion time the app obtains a FRESH authorization code from Apple and sends it here; this function exchanges it for a refresh token and
// revokes it. The ES256 client secret is signed here from Edge Function secrets and never leaves the server.
//
// BEST EFFORT BY DESIGN: deletion never depends on this function. If it is not deployed, a secret is missing, Apple is unreachable or the code is
// rejected, the app deletes the CheckOff account anyway and the user can disconnect CheckOff in Apple ID settings.
//
// Requires a signed in CheckOff user (verify_jwt) who actually has an Apple identity. Secrets (set with `supabase secrets set`, NEVER in source or logs):
//   APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8 PEM contents), APPLE_BUNDLE_ID (the app's bundle id, com.checkoff.app)
//
// Deploy: supabase functions deploy revoke-apple-token --workdir <repo> --project-ref uggusbbswybyplypkbxz   (needs `supabase login`)

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON         = Deno.env.get('SUPABASE_ANON_KEY')!
const TEAM_ID      = Deno.env.get('APPLE_TEAM_ID')
const KEY_ID       = Deno.env.get('APPLE_KEY_ID')
const PRIVATE_KEY  = Deno.env.get('APPLE_PRIVATE_KEY')
const BUNDLE_ID    = Deno.env.get('APPLE_BUNDLE_ID') ?? 'com.checkoff.app'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let s = ''; for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function clientSecret(): Promise<string> {
  const pem = PRIVATE_KEY!.replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }))
  const body = b64url(JSON.stringify({ iss: TEAM_ID, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: BUNDLE_ID }))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${b64url(sig)}`   // WebCrypto returns r||s, exactly what JWS ES256 expects
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString()
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'method' }, 405)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
  if (!jwt) return reply({ error: 'unauthorized' }, 401)
  const { data: { user }, error: userErr } = await createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } }).auth.getUser(jwt)
  if (userErr || !user) return reply({ error: 'unauthorized' }, 401)

  const isApple = (user.app_metadata?.providers ?? []).includes('apple') || (user.identities ?? []).some((i) => i.provider === 'apple')
  const configured = Boolean(TEAM_ID && KEY_ID && PRIVATE_KEY)
  let body: { preflight?: boolean; authorization_code?: string } = {}
  try { body = await req.json() } catch { /* empty body */ }

  if (body.preflight) return reply({ available: configured, apple: isApple })
  if (!isApple) return reply({ revoked: false, reason: 'not_apple' })
  if (!configured) return reply({ revoked: false, reason: 'not_configured' })
  if (!body.authorization_code) return reply({ revoked: false, reason: 'no_code' }, 400)

  try {
    const secret = await clientSecret()
    const tok = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST', headers: FORM,
      body: form({ client_id: BUNDLE_ID, client_secret: secret, code: body.authorization_code, grant_type: 'authorization_code' }),
    })
    if (!tok.ok) return reply({ revoked: false, reason: 'code_rejected' })
    const t = await tok.json() as { refresh_token?: string; access_token?: string }
    const token = t.refresh_token ?? t.access_token
    if (!token) return reply({ revoked: false, reason: 'no_token' })
    const rev = await fetch('https://appleid.apple.com/auth/revoke', {
      method: 'POST', headers: FORM,
      body: form({ client_id: BUNDLE_ID, client_secret: secret, token, token_type_hint: t.refresh_token ? 'refresh_token' : 'access_token' }),
    })
    return reply({ revoked: rev.ok, reason: rev.ok ? 'ok' : 'apple_error' })
  } catch {
    return reply({ revoked: false, reason: 'error' })   // generic on purpose: nothing sensitive is ever echoed or logged
  }
})
