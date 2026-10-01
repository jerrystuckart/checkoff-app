// Public redirect and tracking endpoint (verify_jwt = false in supabase/config.toml). Recipients click
// it from email, so it never carries a Supabase Authorization header; its HMAC token is the check.
// All logic lives in handler.ts. See that file for the GET, HEAD and POST contract, including the
// scanner safe unsubscribe flow (GET and HEAD can never unsubscribe anyone).
// Deploy: supabase functions deploy campaign-link --project-ref uggusbbswybyplypkbxz --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest } from './handler.ts';

Deno.serve((req) => handleRequest(req, {
  env: (name) => Deno.env.get(name),
  getSupabase: () => createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  ),
}));
