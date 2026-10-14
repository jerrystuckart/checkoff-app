import { guardServerCaller } from './serverCaller.ts';

const env = (n: string) => ({ SUPABASE_SERVICE_ROLE_KEY: 'svc-key-for-test', CAMPAIGN_ADMIN_SECRET: 'campaign-secret-for-test-0123456789' } as Record<string, string>)[n];
const req = (headers: Record<string, string>, method = 'POST') => new Request('https://example.test/fn', { method, headers });
const status = (r: Response | null) => (r ? r.status : 200);

Deno.test('no credentials -> 401', () => { if (status(guardServerCaller(req({}), env)) !== 401) throw new Error('expected 401'); });
Deno.test('public anon key or a user JWT as Bearer -> 403', () => {
  for (const t of ['anon-key', 'eyJ.user.jwt']) if (status(guardServerCaller(req({ authorization: `Bearer ${t}`, apikey: t }), env)) !== 403) throw new Error('expected 403');
});
Deno.test('wrong or short campaign secret -> 403', () => {
  for (const s of ['wrong-wrong-wrong-wrong-wrong-wrong', 'short']) if (status(guardServerCaller(req({ authorization: 'Bearer anon', 'x-campaign-secret': s }), env)) !== 403) throw new Error('expected 403');
});
Deno.test('service role key as Bearer or apikey -> allowed', () => {
  if (guardServerCaller(req({ authorization: 'Bearer svc-key-for-test' }), env) !== null) throw new Error('bearer');
  if (guardServerCaller(req({ authorization: 'Bearer anon', apikey: 'svc-key-for-test' }), env) !== null) throw new Error('apikey');
});
Deno.test('campaign secret -> allowed (with the anon key the gateway needs)', () => {
  if (guardServerCaller(req({ authorization: 'Bearer anon', 'x-campaign-secret': 'campaign-secret-for-test-0123456789' }), env) !== null) throw new Error('secret');
});
Deno.test('missing server secrets never authorize', () => {
  const none = () => undefined;
  if (status(guardServerCaller(req({ authorization: 'Bearer anon', 'x-campaign-secret': 'campaign-secret-for-test-0123456789' }), none)) !== 403) throw new Error('expected 403');
});
Deno.test('CORS preflight passes without data', () => { if (guardServerCaller(req({}, 'OPTIONS'), env) !== null) throw new Error('options'); });
