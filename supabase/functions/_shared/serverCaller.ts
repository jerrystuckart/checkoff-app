// Caller authorization for Edge Functions that send email or push notifications, or process everyone's data, and are meant to be called only by the
// scheduler, other Edge Functions or an operator. The Supabase gateway (verify_jwt) accepts any valid JWT, including the PUBLIC anon key and every signed in
// user's token, so it is not authorization. This guard runs first and accepts only:
//   * the function's own SUPABASE_SERVICE_ROLE_KEY as Bearer (server to server calls such as stripe-webhook), or
//   * the CAMPAIGN_ADMIN_SECRET in the x-campaign-secret header (the scheduled jobs and operators; stored in Vault for cron).
// Same rules as send-recap-campaign (authorizeRequest is reused unchanged). Nothing is decoded from a JWT.
import { authorizeRequest } from './campaignControls.ts';

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Returns a rejection Response, or null when the caller is authorized (or the request is a CORS preflight, which carries no data). */
export function guardServerCaller(req: Request, env: (name: string) => string | undefined = (n) => Deno.env.get(n)): Response | null {
  if (req.method === 'OPTIONS') return null;
  const auth = authorizeRequest(req.headers, {
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    campaignSecret: env('CAMPAIGN_ADMIN_SECRET'),
  });
  if (auth.ok === false) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: JSON_HEADERS });
  return null;
}
