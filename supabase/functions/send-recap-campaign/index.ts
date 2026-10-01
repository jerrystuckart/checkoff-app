// Monthly recap campaign endpoint. All logic lives in handler.ts so it can be tested with fakes.
// Deploy: supabase functions deploy send-recap-campaign --project-ref uggusbbswybyplypkbxz
// (verify_jwt stays ON. The handler additionally requires the service role key or CAMPAIGN_ADMIN_SECRET, so
// the public anon key is rejected for every mode.)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest } from './handler.ts';

Deno.serve((req) => handleRequest(req, {
  env: (name) => Deno.env.get(name),
  getSupabase: () => createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  ),
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => new Date(),
}));
