// Run with: deno test supabase/functions/campaign-link/handler.test.ts   (no network, no env access)
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handleRequest, type Deps } from './handler.ts';
import { FakeDb, envOf } from '../_shared/testSupport.ts';
import { signToken } from '../_shared/linkSigning.ts';

const SECRET = 'service-role-secret-value';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CAMP = 'recap_2026-09';
const BASE = 'https://proj.supabase.co/functions/v1/campaign-link';

function setup() {
  const db = new FakeDb({
    users: [{ id: USER, email_opt_out: false, email_opt_out_at: null }, { id: OTHER, email_opt_out: false, email_opt_out_at: null }],
    interaction_events: [],
  });
  const deps: Deps = { env: envOf({ SUPABASE_SERVICE_ROLE_KEY: SECRET }), getSupabase: () => db };
  return { db, deps };
}

async function link(over: Record<string, string> = {}, user = USER, camp = CAMP): Promise<string> {
  const t = await signToken(SECRET, user, camp);
  const p = new URLSearchParams({ u: user, c: camp, t, dest: 'https://getcheckoff.com/download', ev: 'email_click', seg: 'ACTIVE_MONTH', ...over });
  return `${BASE}?${p}`;
}
const get = (u: string, method = 'GET') => new Request(u, { method });
const postForm = (u: string, fields: Record<string, string>) =>
  new Request(u, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
const loc = (r: Response) => r.headers.get('location') || '';
const optedOut = (db: FakeDb, id = USER) => db.rows('users').find((u) => u.id === id)!.email_opt_out;

// ── Unsubscribe: scanners and previews can never opt anyone out ─────────────

Deno.test('unsubscribe GET shows the confirmation page and does not mutate', async () => {
  const { db, deps } = setup();
  const r = await handleRequest(get(await link({ ev: 'unsubscribe' })), deps);
  assertEquals(r.status, 302);
  assert(loc(r).startsWith('https://getcheckoff.com/unsubscribe?'));
  assertEquals(optedOut(db), false);
  assertEquals(db.ops.filter((o) => o.table === 'users' && o.op !== 'select').length, 0);
  const ev = db.rows('interaction_events');
  assertEquals(ev.length, 1);
  assertEquals(ev[0].event_type, 'unsubscribe_page_opened'); // never logged as an unsubscribe
});

Deno.test('unsubscribe HEAD performs no mutation and writes no event at all', async () => {
  const { db, deps } = setup();
  const r = await handleRequest(get(await link({ ev: 'unsubscribe' }), 'HEAD'), deps);
  assertEquals(r.status, 302);
  assert(loc(r).startsWith('https://getcheckoff.com/unsubscribe?'));
  assertEquals(db.writes().length, 0);
  assertEquals(optedOut(db), false);
});

Deno.test('repeated scanner style GET and HEAD requests never unsubscribe anyone', async () => {
  const { db, deps } = setup();
  const u = await link({ ev: 'unsubscribe' });
  for (let i = 0; i < 5; i++) { await handleRequest(get(u), deps); await handleRequest(get(u, 'HEAD'), deps); }
  assertEquals(optedOut(db), false);
  assertEquals(db.ops.filter((o) => o.table === 'users' && o.op !== 'select').length, 0);
});

Deno.test('an old August link (checkoff dest era, ev=unsubscribe) opens the confirmation page and does not silently unsubscribe', async () => {
  const { db, deps } = setup();
  const aug = 'recap_2026-08';
  const r = await handleRequest(get(await link({ ev: 'unsubscribe', dest: 'https://getcheckoff.com/download' }, USER, aug)), deps);
  assert(loc(r).startsWith('https://getcheckoff.com/unsubscribe?'));
  assert(loc(r).includes(`c=${aug}`));
  assertEquals(optedOut(db), false);
});

Deno.test('unsubscribe confirmation POST opts the user out, is idempotent, and lands on the confirmation page', async () => {
  const { db, deps } = setup();
  const t = await signToken(SECRET, USER, CAMP);
  const u = `${BASE}?${new URLSearchParams({ u: USER, c: CAMP, t, ev: 'unsubscribe', seg: 'ACTIVE_MONTH' })}`;
  const r1 = await handleRequest(postForm(u, { confirm: '1' }), deps);
  assertEquals(r1.status, 303);
  assertEquals(loc(r1), 'https://getcheckoff.com/unsubscribed');
  assertEquals(optedOut(db), true);
  assert(db.rows('users').find((x) => x.id === USER)!.email_opt_out_at);
  const r2 = await handleRequest(postForm(u, { confirm: '1' }), deps);
  assertEquals(loc(r2), 'https://getcheckoff.com/unsubscribed');
  assertEquals(optedOut(db), true);
  assertEquals(optedOut(db, OTHER), false); // only that user
  const events = db.rows('interaction_events').filter((e) => e.event_type === 'unsubscribe');
  assertEquals(events.length, 2);
  assertEquals(events[0].metadata.flow, 'confirmed_page');
});

Deno.test('RFC 8058 one click POST works with the exact body, and is not a GET mutation', async () => {
  const { db, deps } = setup();
  const t = await signToken(SECRET, USER, CAMP);
  const u = `${BASE}?${new URLSearchParams({ u: USER, c: CAMP, t, ev: 'unsubscribe' })}`;
  const r = await handleRequest(postForm(u, { 'List-Unsubscribe': 'One-Click' }), deps);
  assertEquals(r.status, 200);
  assertEquals(optedOut(db), true);
});

Deno.test('a POST without an intentional signal changes nothing', async () => {
  const { db, deps } = setup();
  const t = await signToken(SECRET, USER, CAMP);
  const u = `${BASE}?${new URLSearchParams({ u: USER, c: CAMP, t, ev: 'unsubscribe' })}`;
  for (const fields of [{}, { confirm: '0' }, { 'List-Unsubscribe': 'something' }]) {
    const r = await handleRequest(postForm(u, fields), deps);
    assertEquals(r.status, 400);
  }
  assertEquals(optedOut(db), false);
  assertEquals(db.writes().length, 0);
});

Deno.test('invalid, mismatched and missing tokens never mutate, on GET or POST', async () => {
  const { db, deps } = setup();
  const good = await signToken(SECRET, USER, CAMP);
  const cases = [
    `${BASE}?${new URLSearchParams({ u: USER, c: CAMP, t: 'bad', ev: 'unsubscribe' })}`,
    `${BASE}?${new URLSearchParams({ u: OTHER, c: CAMP, t: good, ev: 'unsubscribe' })}`, // token for a different user
    `${BASE}?${new URLSearchParams({ u: USER, c: 'recap_2026-08', t: good, ev: 'unsubscribe' })}`, // token for a different campaign
    `${BASE}?${new URLSearchParams({ u: USER, c: CAMP, ev: 'unsubscribe' })}`,
  ];
  for (const u of cases) {
    const g = await handleRequest(get(u), deps);
    assertEquals(g.status, 302);
    const p = await handleRequest(postForm(u, { confirm: '1' }), deps);
    assert([303, 400].includes(p.status), String(p.status));
    const o = await handleRequest(postForm(u, { 'List-Unsubscribe': 'One-Click' }), deps);
    assertEquals(o.status, 400);
  }
  assertEquals(optedOut(db), false);
  assertEquals(optedOut(db, OTHER), false);
  assertEquals(db.writes().length, 0);
});

Deno.test('a test campaign unsubscribe never changes a user, but still renders the confirmation', async () => {
  const { db, deps } = setup();
  const camp = 'recap_2026-09_test';
  const t = await signToken(SECRET, USER, camp);
  const r = await handleRequest(postForm(`${BASE}?${new URLSearchParams({ u: USER, c: camp, t, ev: 'unsubscribe' })}`, { confirm: '1' }), deps);
  assertEquals(loc(r), 'https://getcheckoff.com/unsubscribed');
  assertEquals(optedOut(db), false);
  assertEquals(db.rows('interaction_events')[0].metadata.mutated, false);
  assertEquals(db.rows('interaction_events')[0].metadata.is_test_campaign, true);
});

// ── Redirect safety ─────────────────────────────────────────────────────────

Deno.test('unsafe external destinations fall back to the safe download page', async () => {
  const { deps } = setup();
  for (const dest of ['https://evil.example', 'http://getcheckoff.com.evil.example/x', 'javascript:alert(1)', '//evil.example', 'data:text/html,hi', 'https://getcheckoff.com.evil.example']) {
    const valid = await handleRequest(get(await link({ dest })), deps);
    assertEquals(loc(valid), 'https://getcheckoff.com/download', dest);
    const invalid = await handleRequest(get(`${BASE}?u=${USER}&c=${CAMP}&t=bad&dest=${encodeURIComponent(dest)}`), deps);
    assertEquals(loc(invalid), 'https://getcheckoff.com/download', dest);
  }
});

Deno.test('no email destination redirects to a raw custom scheme; everything lands on https', async () => {
  const { deps } = setup();
  for (const [ev, dest] of [
    ['main_cta_click', 'checkoff://home'], ['recommendation_click', `checkoff://item?id=${OTHER}`],
    ['themed_list_click', `checkoff://list?id=${OTHER}`], ['season_continue_click', `checkoff://list?id=${OTHER}`],
    ['city_click', `checkoff://list?id=${OTHER}`], ['invite_click', 'https://getcheckoff.com/join'],
    ['appstore_click', 'https://apps.apple.com/us/app/checkoff/id6762678030'], ['playstore_click', 'https://play.google.com/store/apps/details?id=com.getcheckoff.app'],
    ['social_click', 'https://www.instagram.com/checkoff.app/'],
  ]) {
    for (const tokenOk of [true, false]) {
      const u = tokenOk ? await link({ ev, dest }) : `${BASE}?u=${USER}&c=${CAMP}&t=bad&ev=${ev}&dest=${encodeURIComponent(dest)}`;
      const r = await handleRequest(get(u), deps);
      assert(loc(r).startsWith('https://'), `${ev}: ${loc(r)}`);
    }
  }
  const home = await handleRequest(get(await link({ ev: 'main_cta_click', dest: 'checkoff://home' })), deps);
  assertEquals(loc(home), 'https://getcheckoff.com/open');
  const item = await handleRequest(get(await link({ ev: 'recommendation_click', dest: `checkoff://item?id=${OTHER}` })), deps);
  assertEquals(loc(item), `https://getcheckoff.com/item/${OTHER}`); // canonical item URL (the old /item?id= form is still served by the site)
  const list = await handleRequest(get(await link({ ev: 'city_click', dest: `checkoff://list?id=${OTHER}` })), deps);
  assertEquals(loc(list), `https://getcheckoff.com/list?id=${OTHER}`);
});

Deno.test('canonical https destinations pass through untouched and are attributed to their entity (item, list, metro, home)', async () => {
  const { db, deps } = setup();
  const cases: [string, string, string, string | null][] = [
    [`https://getcheckoff.com/item/${OTHER}`, 'recommendation_click', 'item', OTHER],
    [`https://getcheckoff.com/list?id=${OTHER}`, 'themed_list_click', 'list', OTHER],
    ['https://getcheckoff.com/metro?slug=amalfi-coast', 'city_click', 'metro', 'amalfi-coast'],
    ['https://getcheckoff.com/metro?slug=florence', 'city_click', 'metro', 'florence'],
    ['https://getcheckoff.com/open', 'main_cta_click', 'home', null],
  ];
  for (const [dest, ev, type, id] of cases) {
    const r = await handleRequest(get(await link({ dest, ev })), deps);
    assertEquals(loc(r), dest);
  }
  const events = db.rows('interaction_events');
  assertEquals(events.length, cases.length);
  cases.forEach(([, ev, type, id], i) => {
    assertEquals(events[i].event_type, ev);
    assertEquals(events[i].metadata.destination_type, type);
    assertEquals(events[i].metadata.destination_id, id);
    assertEquals(events[i].campaign_id, CAMP);
  });
  // different cities keep different destinations: no collapse onto one generic route
  assert(events[2].metadata.destination_id !== events[3].metadata.destination_id);
});

Deno.test('a valid click logs one event, an invalid one logs nothing, and HEAD logs nothing', async () => {
  const { db, deps } = setup();
  await handleRequest(get(await link({ ev: 'main_cta_click', dest: 'checkoff://home' })), deps);
  assertEquals(db.rows('interaction_events').length, 1);
  assertEquals(db.rows('interaction_events')[0].event_type, 'main_cta_click');
  await handleRequest(get(`${BASE}?u=${USER}&c=${CAMP}&t=bad&ev=main_cta_click&dest=checkoff%3A%2F%2Fhome`), deps);
  await handleRequest(get(await link({ ev: 'main_cta_click' }), 'HEAD'), deps);
  assertEquals(db.rows('interaction_events').length, 1);
});

Deno.test('unsupported methods are rejected', async () => {
  const { deps } = setup();
  assertEquals((await handleRequest(new Request(BASE, { method: 'DELETE' }), deps)).status, 405);
});

// ── Vote flow ───────────────────────────────────────────────────────────────

Deno.test('vote GET logs an opened event and redirects to the form, preserving ev=next_metro_vote', async () => {
  const { db, deps } = setup();
  const r = await handleRequest(get(await link({ ev: 'next_metro_vote', dest: 'https://getcheckoff.com' })), deps);
  const to = new URL(loc(r));
  assertEquals(to.origin + to.pathname, 'https://getcheckoff.com/vote');
  assertEquals(to.searchParams.get('ev'), 'next_metro_vote');
  assertEquals(to.searchParams.get('u'), USER);
  assertEquals(db.rows('interaction_events')[0].event_type, 'next_metro_vote_opened');
  assertEquals(db.rows('interaction_events')[0].metadata.is_submitted_vote, false);
});

Deno.test('vote form submission records one vote and redirects to the confirmation page', async () => {
  const { db, deps } = setup();
  const t = await signToken(SECRET, USER, CAMP);
  const u = `${BASE}?${new URLSearchParams({ u: USER, c: CAMP, t, seg: 'ACTIVE_MONTH', dest: 'https://getcheckoff.com', ev: 'next_metro_vote' })}`;
  const r = await handleRequest(postForm(u, { u: USER, c: CAMP, t, seg: 'ACTIVE_MONTH', ev: 'next_metro_vote', city: 'Austin, TX' }), deps);
  assertEquals(loc(r), 'https://getcheckoff.com/vote-submitted?city=Austin%2C%20TX');
  const votes = db.rows('interaction_events').filter((e) => e.event_type === 'next_metro_vote_submitted');
  assertEquals(votes.length, 1);
  assertEquals(votes[0].metadata.submission_flow, 'explicit');
});

Deno.test('legacy recovery: a POST with no ev at all still records a vote, tagged legacy', async () => {
  const { db, deps } = setup();
  const t = await signToken(SECRET, USER, CAMP);
  const u = `${BASE}?${new URLSearchParams({ u: USER, c: CAMP, t })}`;
  const r = await handleRequest(postForm(u, { city: 'Boise' }), deps);
  assertEquals(loc(r), 'https://getcheckoff.com/vote-submitted?city=Boise');
  assertEquals(db.rows('interaction_events')[0].metadata.submission_flow, 'legacy_recovery');
});

Deno.test('vote deduplication: a second submission updates the same row', async () => {
  const { db, deps } = setup();
  const t = await signToken(SECRET, USER, CAMP);
  const u = `${BASE}?${new URLSearchParams({ u: USER, c: CAMP, t, ev: 'next_metro_vote' })}`;
  await handleRequest(postForm(u, { city: 'Austin' }), deps);
  await handleRequest(postForm(u, { city: 'Denver' }), deps);
  const votes = db.rows('interaction_events').filter((e) => e.event_type === 'next_metro_vote_submitted');
  assertEquals(votes.length, 1);
  assertEquals(votes[0].metadata.city, 'Denver');
});

Deno.test('vote validation: bad token, empty, unsafe or oversized city, and non vote POST events record nothing', async () => {
  const { db, deps } = setup();
  const t = await signToken(SECRET, USER, CAMP);
  const ok = `${BASE}?${new URLSearchParams({ u: USER, c: CAMP, t, ev: 'next_metro_vote' })}`;
  for (const city of ['', '   ', '<script>', 'x'.repeat(81)]) {
    const r = await handleRequest(postForm(ok, { city }), deps);
    assert(loc(r).includes('/vote?') && loc(r).includes('error='), city);
  }
  const badTok = await handleRequest(postForm(`${BASE}?${new URLSearchParams({ u: USER, c: CAMP, t: 'bad', ev: 'next_metro_vote' })}`, { city: 'Austin' }), deps);
  assert(loc(badTok).startsWith('https://getcheckoff.com'));
  const wrongEv = await handleRequest(postForm(`${BASE}?${new URLSearchParams({ u: USER, c: CAMP, t, ev: 'main_cta_click' })}`, { city: 'Austin' }), deps);
  assertEquals(wrongEv.status, 400);
  assertEquals(db.rows('interaction_events').filter((e) => e.event_type === 'next_metro_vote_submitted').length, 0);
});
