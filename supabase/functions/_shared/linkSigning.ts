// HMAC-signed campaign links — smallest auditable mechanism for one-click
// unsubscribe and click attribution without a database round-trip to verify.
// No new secret is required: falls back to SUPABASE_SERVICE_ROLE_KEY, which
// every edge function already has as a secret and which is never exposed to
// clients. Set CAMPAIGN_LINK_SECRET explicitly if you want a dedicated key.

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function getLinkSecret(): string {
  const secret = Deno.env.get('CAMPAIGN_LINK_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw new Error('No CAMPAIGN_LINK_SECRET or SUPABASE_SERVICE_ROLE_KEY available for link signing');
  return secret;
}

export async function signToken(secret: string, userId: string, campaignId: string): Promise<string> {
  const full = await hmacHex(secret, `${userId}:${campaignId}`);
  return full.slice(0, 24);
}

export async function verifyToken(secret: string, userId: string, campaignId: string, token: string): Promise<boolean> {
  const expected = await signToken(secret, userId, campaignId);
  if (expected.length !== token.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
