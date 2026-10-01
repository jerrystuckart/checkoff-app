// Run with: deno test supabase/functions/send-recap-campaign/handler.test.ts   (no network, no env access)
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handleRequest, type Deps } from './handler.ts';
import { FakeDb, fakeResend, envOf } from '../_shared/testSupport.ts';
import { verifyToken } from '../_shared/linkSigning.ts';

const SERVICE = 'service-role-secret-value';
const ADMIN = 'campaign-admin-secret-0123456789abcdef';
const ANON = 'public-anon-key-value';
const TEST_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROD_USERS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const BASE_ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, CAMPAIGN_ADMIN_SECRET: ADMIN, RESEND_API_KEY: 're_test' };

const city = (slug: string, name: string, over: any = {}) => ({
  metro_id: `m-${slug}`, name, slug, created_at: '2026-09-01T00:00:00Z', active_items: 100, public_official_lists: 2,
  season_list_id: slug === 'phoenix' ? 'season-phoenix' : null, season_name: slug === 'phoenix' ? 'Fall 2026 — Phoenix Metro' : null,
  destination_list_id: `list-${slug}`, destination_list_title: 'List', ...over,
});
const CITIES = [city('phoenix', 'Phoenix Metro'), city('munich', 'Munich Metro'), city('vienna_austria', 'Vienna Metro')];

function audRow(i: number, over: any = {}) {
  return {
    user_id: PROD_USERS[i], email: `person${i}@example.com`, display_name: `Person${i} Real`, platform: null,
    segment: 'ACTIVE_MONTH', exclusion_reason: null, metro_id: 'm-phoenix', metro_name: 'Phoenix Metro', metro_source: 'checkoff_history',
    checkins_this_month: 2, points_this_month: 5, lifetime_points: 10, completed_item_names: [{ id: 'i1', body: 'Do a thing' }],
    most_active_hood: null, current_streak_weeks: 1, last_checkin_at: '2026-09-20T00:00:00Z', last_checkin_item_name: 'Do a thing',
    days_since_last_checkin: 11, new_items_since_last_checkin: 0, lifetime_checkins: 4,
    season_list_id: 'season-phoenix', season_name: 'Fall 2026 — Phoenix Metro', season_ends_at: null, season_total_items: 32,
    season_checked_count: 1, season_days_remaining: null,
    recommended_items: [{ id: 'r1', body: 'Rec one', difficulty: 1, url: 'checkoff://item?id=r1' }],
    ...over,
  };
}

function setup(opts: { env?: Record<string, string | undefined>; audience?: any[]; resend?: Parameters<typeof fakeResend>[0]; now?: string } = {}) {
  const db = new FakeDb({
    users: [{ id: TEST_USER, email: 'tester@getcheckoff.com' }, { id: PROD_USERS[0], email: 'person0@example.com' }],
    campaign_suppressions: [], campaign_sends: [], interaction_events: [], curated_lists: [],
    items: Array.from({ length: 6 }, (_, i) => ({ id: `it${i}`, body: `Sample place ${i}`, difficulty: i + 1, is_active: true, is_approved: true, is_universal: false })),
    list_items: Array.from({ length: 32 }, (_, i) => ({ id: `li${i}`, list_id: 'season-phoenix' })),
  });
  db.rpcs.get_recap_campaign_audience = opts.audience ?? [audRow(0), audRow(1), audRow(2)];
  db.rpcs.get_recap_campaign_cities = CITIES;
  const resend = fakeResend(opts.resend);
  let supabaseCreated = 0;
  const deps: Deps = {
    env: envOf({ ...BASE_ENV, ...(opts.env || {}) }),
    getSupabase: () => { supabaseCreated++; return db; },
    fetch: resend.fetch, sleep: () => Promise.resolve(), now: () => new Date(opts.now ?? '2026-10-02T12:00:00Z'),
  };
  return { db, resend, deps, created: () => supabaseCreated };
}

const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${SERVICE}` }) =>
  new Request('https://x/functions/v1/send-recap-campaign', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const json = async (r: Response) => await r.json();

// ── Authorization (nothing may happen before it) ────────────────────────────

Deno.test('the public anon key is rejected for every mode, before any data, write or Resend call', async () => {
  for (const mode of ['preview', 'dry_run', 'test_send', 'send']) {
    const s = setup({ env: { CAMPAIGN_ALLOW_PRODUCTION_SEND: 'true' } });
    const r = await handleRequest(post({ month: '2026-09', mode, previewAllSegments: true, testEmailOverride: 'jerrystuckart@gmail.com', confirmEligibleCount: 3 },
      { authorization: `Bearer ${ANON}`, apikey: ANON }), s.deps);
    assert(r.status === 401 || r.status === 403, `${mode}: ${r.status}`);
    assertEquals(r.status, 403);
    assertEquals(s.created(), 0, `${mode}: a database client was created`);
    assertEquals(s.db.ops.length, 0, `${mode}: database touched`);
    assertEquals(s.resend.calls.length, 0, `${mode}: Resend called`);
    const text = JSON.stringify(await json(r));
    assert(!/@|html|token|user_id/i.test(text), `${mode}: leaked data`);
  }
});

Deno.test('missing authorization is 401, invalid is 403, with no side effects', async () => {
  const s = setup();
  const none = await handleRequest(post({ month: '2026-09', mode: 'preview', previewAllSegments: true }, {}), s.deps);
  assertEquals(none.status, 401);
  const bad = await handleRequest(post({ month: '2026-09', mode: 'preview', previewAllSegments: true }, { authorization: 'Bearer nope' }), s.deps);
  assertEquals(bad.status, 403);
  const badAdmin = await handleRequest(post({ month: '2026-09', mode: 'preview', previewAllSegments: true }, { 'x-campaign-secret': 'nope', authorization: `Bearer ${ANON}` }), s.deps);
  assertEquals(badAdmin.status, 403);
  assertEquals(s.created(), 0); assertEquals(s.db.ops.length, 0); assertEquals(s.resend.calls.length, 0);
});

Deno.test('the dedicated campaign secret authorizes, alongside the gateway token', async () => {
  const s = setup();
  const r = await handleRequest(post({ month: '2026-09', mode: 'preview', previewAllSegments: true }, { authorization: `Bearer ${ANON}`, 'x-campaign-secret': ADMIN }), s.deps);
  assertEquals(r.status, 200);
});

Deno.test('OPTIONS preflight returns nothing sensitive and needs no auth', async () => {
  const s = setup();
  const r = await handleRequest(new Request('https://x', { method: 'OPTIONS' }), s.deps);
  assertEquals(r.status, 204);
  assertEquals(s.db.ops.length, 0);
});

// ── Validation: no defaults ─────────────────────────────────────────────────

Deno.test('empty body, missing month, missing mode, invalid month and invalid mode are validation errors that do nothing', async () => {
  for (const body of ['', '{}', '[]', 'not json', { mode: 'dry_run' }, { month: '2026-09' }, { month: '2026-9', mode: 'preview' }, { month: '2026-09', mode: 'bogus' }]) {
    const s = setup();
    const r = await handleRequest(post(body as any), s.deps);
    assertEquals(r.status, 400, JSON.stringify(body));
    assertEquals(s.created(), 0); assertEquals(s.db.ops.length, 0); assertEquals(s.resend.calls.length, 0);
  }
});

Deno.test('non POST methods are rejected after authorization', async () => {
  const s = setup();
  const r = await handleRequest(new Request('https://x', { method: 'GET', headers: { authorization: `Bearer ${SERVICE}` } }), s.deps);
  assertEquals(r.status, 405);
});

// ── preview and dry_run ─────────────────────────────────────────────────────

Deno.test('preview with auth renders September, never August, and writes nothing', async () => {
  const s = setup();
  const r = await handleRequest(post({ month: '2026-09', mode: 'preview', previewAllSegments: true }), s.deps);
  assertEquals(r.status, 200);
  const j = await json(r);
  assertEquals(j.campaignId, 'recap_2026-09');
  assert(j.previews.length >= 1);
  assert(j.previews[0].subject.includes('September'));
  assert(!/August/.test(j.previews[0].html));
  assertEquals(s.db.writes().length, 0);
  assertEquals(s.resend.calls.length, 0);
});

Deno.test('preview with synthetic variants returns all five without any production identity', async () => {
  const s = setup();
  const r = await handleRequest(post({ month: '2026-09', mode: 'preview', previewSynthetic: true }), s.deps);
  assertEquals(r.status, 200);
  const j = await json(r);
  assertEquals(j.previews.length, 5);
  assertEquals(j.campaignId, 'recap_2026-09_test');
  for (const pv of j.previews) {
    for (const m of pv.html.matchAll(/campaign-link\?([^"]+)"/g)) {
      assertEquals(new URLSearchParams(m[1].replaceAll('&amp;', '&')).get('c'), 'recap_2026-09_test');
    }
  }
  const all = JSON.stringify(j);
  for (const id of PROD_USERS) assert(!all.includes(id));
  assert(!all.includes('person0@example.com') && !all.includes('Person0'));
});

Deno.test('dry_run is explicit, uses the month neutral segment, and only logs dry_run rows', async () => {
  const s = setup();
  const r = await handleRequest(post({ month: '2026-09', mode: 'dry_run' }), s.deps);
  assertEquals(r.status, 200);
  const j = await json(r);
  assertEquals(j.summary.eligible, 3);
  const rows = s.db.rows('campaign_sends');
  assertEquals(rows.length, 3);
  assert(rows.every((x) => x.status === 'dry_run' && x.is_test_send === true && x.campaign_id === 'recap_2026-09' && x.segment === 'ACTIVE_MONTH'));
  assertEquals(s.resend.calls.length, 0);
});

// ── Production send controls ────────────────────────────────────────────────

Deno.test('send without the production gate is refused before any data is read', async () => {
  for (const gate of [undefined, 'false']) {
    const s = setup({ env: { CAMPAIGN_ALLOW_PRODUCTION_SEND: gate } });
    const r = await handleRequest(post({ month: '2026-09', mode: 'send', confirmEligibleCount: 3 }), s.deps);
    assertEquals(r.status, 403);
    assertEquals(s.created(), 0); assertEquals(s.resend.calls.length, 0);
  }
});

Deno.test('testEmailOverride can never bypass the production controls in send mode', async () => {
  for (const gate of [undefined, 'true']) {
    const s = setup({ env: { CAMPAIGN_ALLOW_PRODUCTION_SEND: gate } });
    const r = await handleRequest(post({ month: '2026-09', mode: 'send', testEmailOverride: 'jerrystuckart@gmail.com', confirmEligibleCount: 3 }), s.deps);
    assertEquals(r.status, 400);
    assertEquals(s.resend.calls.length, 0); assertEquals(s.db.writes().length, 0);
  }
});

Deno.test('send refuses an open month, a wrong confirmed count, and a failed preflight', async () => {
  const open = setup({ env: { CAMPAIGN_ALLOW_PRODUCTION_SEND: 'true' }, now: '2026-09-30T12:00:00Z' });
  assertEquals((await handleRequest(post({ month: '2026-09', mode: 'send', confirmEligibleCount: 3 }), open.deps)).status, 409);

  const wrong = setup({ env: { CAMPAIGN_ALLOW_PRODUCTION_SEND: 'true' } });
  assertEquals((await handleRequest(post({ month: '2026-09', mode: 'send', confirmEligibleCount: 99 }), wrong.deps)).status, 409);
  assertEquals(wrong.resend.calls.length, 0);

  const dup = setup({ env: { CAMPAIGN_ALLOW_PRODUCTION_SEND: 'true' }, audience: [audRow(0), audRow(1, { email: 'PERSON0@example.com' })] });
  const r = await handleRequest(post({ month: '2026-09', mode: 'send', confirmEligibleCount: 2 }), dup.deps);
  assertEquals(r.status, 409);
  assert(JSON.stringify(await json(r)).includes('duplicate'));
  assertEquals(dup.resend.calls.length, 0); assertEquals(dup.db.writes().length, 0);
});

Deno.test('send: claims each recipient, sends once, headers carry one click unsubscribe, rerun sends nothing', async () => {
  const s = setup({ env: { CAMPAIGN_ALLOW_PRODUCTION_SEND: 'true' } });
  const body = { month: '2026-09', mode: 'send', confirmEligibleCount: 3 };
  const r1 = await json(await handleRequest(post(body), s.deps));
  assertEquals([r1.sent, r1.failed, r1.skippedAlreadyClaimed], [3, 0, 0]);
  assertEquals(s.resend.calls.length, 3);
  const c0 = s.resend.calls[0];
  assertEquals(c0.headers['Idempotency-Key'], `recap_2026-09:${PROD_USERS[0]}`);
  assert(c0.body.headers['List-Unsubscribe'].startsWith('<https://proj.supabase.co/functions/v1/campaign-link?'));
  assertEquals(c0.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert(c0.body.subject.includes('September'));
  const sent = s.db.rows('campaign_sends');
  assert(sent.every((x) => x.status === 'sent' && x.is_test_send === false && x.resend_message_id && x.campaign_id === 'recap_2026-09'));

  const r2 = await json(await handleRequest(post(body), s.deps));
  assertEquals([r2.sent, r2.skippedAlreadyClaimed], [0, 3]);
  assertEquals(s.resend.calls.length, 3); // no second email to anyone
});

Deno.test('send: Resend accepted but recording failed leaves a claim that blocks any duplicate on retry', async () => {
  const s = setup({ env: { CAMPAIGN_ALLOW_PRODUCTION_SEND: 'true' } });
  s.db.failUpdate = (table, payload) => table === 'campaign_sends' && payload.status === 'sent';
  const body = { month: '2026-09', mode: 'send', confirmEligibleCount: 3 };
  const r1 = await json(await handleRequest(post(body), s.deps));
  assertEquals(r1.recordingProblems, 3);
  assertEquals(s.resend.calls.length, 3);
  assert(s.db.rows('campaign_sends').every((x) => x.status === 'sending'));
  s.db.failUpdate = null;
  const r2 = await json(await handleRequest(post(body), s.deps));
  assertEquals(r2.skippedAlreadyClaimed, 3);
  assertEquals(s.resend.calls.length, 3); // still only three emails ever
});

Deno.test('send: a network error after the request left leaves the claim, so a retry cannot double send', async () => {
  const s = setup({ env: { CAMPAIGN_ALLOW_PRODUCTION_SEND: 'true' }, resend: { throwFor: (to) => to === 'person1@example.com' } });
  const body = { month: '2026-09', mode: 'send', confirmEligibleCount: 3 };
  const r1 = await json(await handleRequest(post(body), s.deps));
  assertEquals([r1.sent, r1.failed, r1.recordingProblems], [2, 1, 1]);
  const stuck = s.db.rows('campaign_sends').find((x) => x.user_id === PROD_USERS[1])!;
  assertEquals(stuck.status, 'sending');
  const r2 = await json(await handleRequest(post(body), s.deps));
  assertEquals(r2.sent, 0);
  assertEquals(s.resend.calls.length, 3); // the 3 first attempts only; the retry sent nothing
});

Deno.test('send: an explicit Resend rejection frees the claim and a retry may send', async () => {
  const s = setup({ env: { CAMPAIGN_ALLOW_PRODUCTION_SEND: 'true' }, resend: { reject: (to) => to === 'person2@example.com' } });
  const body = { month: '2026-09', mode: 'send', confirmEligibleCount: 3 };
  const r1 = await json(await handleRequest(post(body), s.deps));
  assertEquals([r1.sent, r1.failed], [2, 1]);
  assertEquals(s.db.rows('campaign_sends').find((x) => x.user_id === PROD_USERS[2])!.status, 'failed');
  const deps2 = { ...s.deps, fetch: fakeResend().fetch };
  const r2 = await json(await handleRequest(post(body), deps2));
  assertEquals([r2.sent, r2.skippedAlreadyClaimed], [1, 2]);
});

Deno.test('send: limit is validated and applied, and an existing August send is never touched', async () => {
  const s = setup({ env: { CAMPAIGN_ALLOW_PRODUCTION_SEND: 'true' } });
  s.db.rows('campaign_sends').push({ id: 'old', campaign_id: 'recap_2026-08', user_id: PROD_USERS[0], status: 'sent', is_test_send: false });
  const bad = await handleRequest(post({ month: '2026-09', mode: 'send', confirmEligibleCount: 3, limit: 0 }), s.deps);
  assertEquals(bad.status, 400);
  const r = await json(await handleRequest(post({ month: '2026-09', mode: 'send', confirmEligibleCount: 3, limit: 2 }), s.deps));
  assertEquals(r.attempted, 2);
  assertEquals(s.db.rows('campaign_sends').find((x) => x.id === 'old')!.campaign_id, 'recap_2026-08');
  assertEquals(s.db.rows('campaign_sends').filter((x) => x.campaign_id === 'recap_2026-09').length, 2);
});

// ── test_send isolation ─────────────────────────────────────────────────────

Deno.test('test_send refuses an unapproved address, a missing test user, and a production user identity', async () => {
  const s = setup();
  const base = { month: '2026-09', mode: 'test_send', testUserId: TEST_USER };
  assertEquals((await handleRequest(post({ ...base, testEmailOverride: 'attacker@evil.example' }), s.deps)).status, 400);
  assertEquals((await handleRequest(post({ month: '2026-09', mode: 'test_send', testEmailOverride: 'jerrystuckart@gmail.com' }), s.deps)).status, 400);
  assertEquals((await handleRequest(post({ ...base, testUserId: PROD_USERS[0], testEmailOverride: 'jerrystuckart@gmail.com' }), s.deps)).status, 400);
  assertEquals((await handleRequest(post({ ...base, testUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', testEmailOverride: 'jerrystuckart@gmail.com' }), s.deps)).status, 400);
  assertEquals(s.resend.calls.length, 0);
});

Deno.test('test_send: five variants, one approved address, test campaign id, test markers, no production identity, no user changes', async () => {
  const s = setup();
  const r = await json(await handleRequest(post({ month: '2026-09', mode: 'test_send', testUserId: TEST_USER, testEmailOverride: 'jerrystuckart@gmail.com' }), s.deps));
  assertEquals([r.accepted, r.failed, r.testCampaignId], [5, 0, 'recap_2026-09_test']);
  assertEquals(s.resend.calls.length, 5);
  for (const c of s.resend.calls) {
    assertEquals(c.body.to, ['jerrystuckart@gmail.com']);
    assert(c.body.subject.startsWith('[TEST'), c.body.subject);
    assert(c.body.headers['List-Unsubscribe-Post']);
    for (const id of PROD_USERS) assert(!c.body.html.includes(id) && !JSON.stringify(c.body).includes(id));
    assert(!c.body.html.includes('person0@example.com') && !/Person\d Real/.test(c.body.html));
    assert(!/August/.test(c.body.html));
    // every tracked link carries only the test identity and the test campaign id
    for (const m of c.body.html.matchAll(/campaign-link\?([^"]+)"/g)) {
      const p = new URLSearchParams(m[1].replaceAll('&amp;', '&'));
      assertEquals(p.get('u'), TEST_USER);
      assertEquals(p.get('c'), 'recap_2026-09_test');
      assert(await verifyToken(SERVICE, TEST_USER, 'recap_2026-09_test', p.get('t')!));
    }
  }
  assertEquals(new Set(s.resend.calls.map((c) => c.body.subject)).size, 5);
  // writes: only campaign_sends rows for the test campaign, flagged as test sends; users untouched
  const writes = s.db.writes();
  assert(writes.every((w) => w.table === 'campaign_sends'));
  const rows = s.db.rows('campaign_sends');
  assertEquals(rows.length, 5);
  assert(rows.every((x) => x.campaign_id === 'recap_2026-09_test' && x.is_test_send === true && x.user_id === TEST_USER));
  assertEquals(s.db.ops.filter((o) => o.table === 'users' && o.op !== 'select').length, 0);
  // production idempotency rows are not created or consumed
  assertEquals(rows.filter((x) => x.campaign_id === 'recap_2026-09').length, 0);
});

Deno.test('test_send reports Resend acceptance, never delivery', async () => {
  const s = setup();
  const r = await json(await handleRequest(post({ month: '2026-09', mode: 'test_send', testUserId: TEST_USER, testEmailOverride: 'jerrystuckart@gmail.com', variants: ['ACTIVE_MONTH'] }), s.deps));
  assertEquals(r.results.length, 1);
  assertEquals(r.results[0].acceptedByResend, true);
  assert(!JSON.stringify(r).toLowerCase().includes('delivered'));
});
