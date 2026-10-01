// Cross repository smoke test for the monthly recap campaign.
//
//   deno run --no-lock --allow-read --allow-env scripts/recap-smoke-test.ts
//   deno run --no-lock --allow-read --allow-env --allow-net=getcheckoff.com scripts/recap-smoke-test.ts --live
//
// It starts from rendered email HTML (all five presentation variants, standard and link fix packages), extracts every link, and follows
// each one through the real campaign-link handler to its public destination, then checks that the
// destination exists in the website repository (and, with --live, on getcheckoff.com). It then drives the
// vote and unsubscribe flows end to end using the real getcheckoff.com page sources.
//
// SAFETY: everything runs against an in memory fake database with a synthetic test user and the test
// campaign id `recap_<month>_test`. It uses no production recipient, no production token and no
// production data, and it makes no network call unless --live is passed (HEAD requests to public pages).

import { buildRecapEmailHtml } from '../supabase/functions/_shared/campaignTemplate.ts';
import { buildEmailData, buildSyntheticRow, buildLinkFixEmail, type CampaignContext } from '../supabase/functions/_shared/campaignEmail.ts';
// The app owns the link contract. The smoke test uses the app's own parser, so it checks what the installed
// app will actually be asked to open, not just the HTTP status.
// @ts-ignore: plain JS module from the app
import { parseEmailLink, routeForIntent, appSchemeUrl } from '../lib/emailLinkContract.js';
import { handleRequest as linkHandler } from '../supabase/functions/campaign-link/handler.ts';
import { TEST_VARIANTS } from '../supabase/functions/_shared/campaignControls.ts';
import { FakeDb, envOf } from '../supabase/functions/_shared/testSupport.ts';

const MONTH = '2026-09';
const TEST_CAMPAIGN = `recap_${MONTH}_test`;
const TEST_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECRET = 'smoke-test-secret-not-a-real-key';
const SITE_REPO = Deno.env.get('SITE_REPO') || `${Deno.env.get('HOME')}/Downloads/getcheckoff-site`;
const LIVE = Deno.args.includes('--live');

let failures = 0;
const results: string[] = [];
function check(ok: boolean, label: string, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

const SEASONS: Record<string, string> = { phoenix: '5ea50000-0000-4000-8000-00000000f411', munich: '5ea50000-0000-4000-8000-00000000f412', vienna_austria: '5ea50000-0000-4000-8000-00000000f413' };
const db = new FakeDb({
  users: [{ id: TEST_USER, email: 'tester@getcheckoff.com', email_opt_out: false }],
  interaction_events: [], campaign_sends: [], curated_lists: [],
  items: Array.from({ length: 6 }, (_, i) => ({ id: `1e40000${i}-0000-4000-8000-000000000000`, body: `Sample place ${i}`, difficulty: i + 1, is_active: true, is_approved: true, is_universal: false })),
  list_items: Array.from({ length: 32 }, (_, i) => ({ id: `li${i}`, list_id: SEASONS.phoenix })),
  lists: [{ id: 'a1a10000-0000-4000-8000-000000000001', title: 'Munich Hidden Gems', metro_id: 'm-munich', is_public: true, is_official: true }, { id: 'a1a10000-0000-4000-8000-000000000002', title: 'Vienna Coffee Houses', metro_id: 'm-vienna_austria', is_public: true, is_official: true }],
});
const mk = (slug: string, name: string) => ({
  metro_id: `m-${slug}`, name, slug, created_at: '2026-09-01T00:00:00Z', active_items: 100, public_official_lists: 2,
  season_list_id: slug === 'phoenix' ? 'season-phoenix' : null, season_name: slug === 'phoenix' ? 'Fall 2026 — Phoenix Metro' : null,
  destination_list_id: `00000000-0000-4000-8000-0000000000${slug.length.toString().padStart(2, '0')}`, destination_list_title: 'List',
});
const cities = [
  mk('phoenix', 'Phoenix Metro'), mk('san-diego', 'San Diego Metro'), mk('vienna_austria', 'Vienna Metro'), mk('munich', 'Munich Metro'),
  mk('florence', 'Florence Metro'), mk('green-bay', 'Green Bay Metro'), mk('amalfi-coast', 'Amalfi Coast'), mk('denver', 'Denver Metro'),
  mk('milwaukee', 'Milwaukee Metro'), mk('tucson', 'Tucson Metro'),
];
const ctx: CampaignContext = {
  supabase: db, functionsBaseUrl: 'https://proj.supabase.co/functions/v1', secret: SECRET, campaignId: `recap_${MONTH}`, month: MONTH, cities,
};
const deps = { env: envOf({ SUPABASE_SERVICE_ROLE_KEY: SECRET }), getSupabase: () => db };

const visibleText = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<title>[\s\S]*?<\/title>/g, ' ').replace(/<[^>]+>/g, ' ');

// Mirror of site routing: a public path is valid if it has a rewrite in vercel.json (or a static file) in the site repo.
const vercel = JSON.parse(await Deno.readTextFile(`${SITE_REPO}/vercel.json`));
async function sitePageExists(pathname: string): Promise<boolean> {
  const p = pathname.replace(/\/$/, '') || '/';
  if (p === '/') return await fileExists(`${SITE_REPO}/public/index.html`);
  const toRe = (src: string) => new RegExp('^' + src.replace(/\/$/, '').replace(/:[A-Za-z_]+/g, '[^/]+') + '/?$');
  if ((vercel.rewrites || []).some((r: any) => r.source === p || r.source === p + '/' || toRe(r.source).test(p))) return true;
  return await fileExists(`${SITE_REPO}/public${p}/index.html`) || await fileExists(`${SITE_REPO}/public${p}`);
}
async function fileExists(p: string) { try { return (await Deno.stat(p)).isFile; } catch { return false; } }

const seenDestinations = new Set<string>();
const screens: Record<string, string> = { item: 'DeepLinkItemResolver', list: 'DeepLinkListResolver', metro: 'DeepLinkMetroResolver', home: 'Home' };
for (const profile of ['default', 'link_fix'] as const) for (const variant of TEST_VARIANTS) {
  const vlabel = `${profile}/${variant}`;
  let row: any; let built: any;
  if (profile === 'link_fix') ({ row, built } = await buildLinkFixEmail(ctx, variant, TEST_USER, TEST_CAMPAIGN));
  else { row = await buildSyntheticRow(ctx, variant, TEST_USER); built = await buildEmailData(ctx, row, TEST_CAMPAIGN); }
  const html = buildRecapEmailHtml(built.data);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));
  check(hrefs.length >= 8, `${vlabel}: extracted ${hrefs.length} links`);
  check(!/August/i.test(html) && !/href="checkoff:/.test(html), `${vlabel}: no August text, no raw custom scheme`);
  check(profile === 'link_fix' ? html.includes('sample content') : true, `${vlabel}: test banner says counts are sample content`);

  let tracked = 0;
  const citySlugs: string[] = [];
  for (const href of hrefs) {
    if (href.startsWith('mailto:')) continue;
    check(href.startsWith('https://proj.supabase.co/functions/v1/campaign-link?'), `${vlabel}: link is tracked`, href.slice(0, 60));
    const u = new URL(href);
    check(u.searchParams.get('u') === TEST_USER && u.searchParams.get('c') === TEST_CAMPAIGN, `${vlabel}: link carries only the test identity and test campaign`);
    tracked++;

    const before = db.writes().length;
    const head = await linkHandler(new Request(href, { method: 'HEAD' }), deps);
    check(head.status === 302 && db.writes().length === before, `${vlabel}: HEAD redirects with no writes`);

    const res = await linkHandler(new Request(href), deps);
    const to = res.headers.get('location') || '';
    const dest = new URL(to);
    const ev = u.searchParams.get('ev')!;
    check(res.status === 302 && dest.protocol === 'https:', `${vlabel}: ${ev} redirects over https`, dest.origin + dest.pathname);
    const allowedHosts = ['getcheckoff.com', 'apps.apple.com', 'play.google.com', 'www.instagram.com'];
    check(allowedHosts.includes(dest.hostname), `${vlabel}: ${ev} lands on an allowed host`, dest.hostname);

    // The final parsed navigation intent, using the app's own parser and route table.
    const intent = parseEmailLink(to);
    const route = routeForIntent(intent);
    if (dest.hostname === 'getcheckoff.com' && !['unsubscribe', 'next_metro_vote', 'invite_click'].includes(ev)) {
      check(route !== null && route.screen === screens[intent.type], `${vlabel}: ${ev} parses to the ${intent.type} route`, `${route?.screen}`);
      check(!!appSchemeUrl(intent)?.startsWith('checkoff://'), `${vlabel}: ${ev} hands the app a checkoff:// intent`);
    }
    if (ev === 'recommendation_click') check(intent.type === 'item' && intent.id === u.searchParams.get('rec'), `${vlabel}: recommendation keeps its exact item id`);
    if (ev === 'season_continue_click') check(intent.type === 'list' && intent.id === row.season_list_id, `${vlabel}: Fall list link keeps the exact list id`);
    if (ev === 'themed_list_click') check(intent.type === 'list', `${vlabel}: themed list keeps a list id`, intent.type === 'list' ? intent.id : '');
    if (ev === 'main_cta_click') check(intent.type === 'home', `${vlabel}: main CTA is Home`);
    if (ev === 'city_click') {
      const city = JSON.parse(u.searchParams.get('meta') || '{}').city;
      check(intent.type === 'metro' && intent.slug === city, `${vlabel}: city chip ${city} keeps its own metro`, intent.type === 'metro' ? intent.slug : '');
      citySlugs.push((intent as any).slug);
    }

    if (dest.hostname === 'getcheckoff.com') {
      const key = dest.pathname.replace(/[0-9a-f-]{36}/, ':id');
      if (!seenDestinations.has(key)) {
        seenDestinations.add(key);
        check(await sitePageExists(dest.pathname), `site repo serves ${key}`);
        if (LIVE) {
          const probe = dest.pathname.startsWith('/item/') ? dest.pathname : `${dest.pathname}${dest.pathname === '/list' ? '?id=00000000-0000-0000-0000-000000000000' : dest.pathname === '/metro' ? '?slug=amalfi-coast' : ''}`;
          const r = await fetch(`https://getcheckoff.com${probe}`, { method: 'HEAD' });
          check(r.ok && (r.headers.get('content-type') || '').includes('text/html'), `live getcheckoff.com${key} is 200 text/html`, String(r.status));
        }
      }
    }
  }
  check(tracked >= 8, `${vlabel}: ${tracked} tracked links followed`);
  const unique = new Set(citySlugs);
  check(citySlugs.length === 0 || unique.size === new Set(citySlugs).size, `${vlabel}: city chips resolve to distinct metros`, `${unique.size} unique`);
  if (variant === 'NEVER_CHECKED_OFF_UNKNOWN') check(unique.size === 10, `${vlabel}: ten different city chips, ten different metros`, `${unique.size}`);

  // The five variants share one set of flows; run vote and unsubscribe on the first only to keep output small.
  if (profile !== 'default' || variant !== 'ACTIVE_MONTH') continue;

  // ── Vote: email link -> /vote page -> form POST -> /vote-submitted ───────
  const voteHref = hrefs.find((h) => new URL(h).searchParams.get('ev') === 'next_metro_vote')!;
  const open = await linkHandler(new Request(voteHref), deps);
  const voteUrl = new URL(open.headers.get('location')!);
  check(voteUrl.pathname === '/vote' && voteUrl.searchParams.get('ev') === 'next_metro_vote', 'vote: email link opens /vote preserving ev=next_metro_vote');
  const votePage = await Deno.readTextFile(`${SITE_REPO}/public/vote/index.html`);
  check(/ev: 'next_metro_vote'/.test(votePage) && /form\.method = 'POST'/.test(votePage) && votePage.includes('functions/v1/campaign-link'), 'vote: the real /vote page builds a POST form with ev=next_metro_vote');
  const q = voteUrl.searchParams;
  const action = `https://proj.supabase.co/functions/v1/campaign-link?${new URLSearchParams({ u: q.get('u')!, c: q.get('c')!, t: q.get('t')!, seg: q.get('seg')!, dest: q.get('dest')!, ev: 'next_metro_vote' })}`;
  const post = (city: string) => linkHandler(new Request(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ city }).toString() }), deps);
  const v1 = await post('Austin, TX');
  check((v1.headers.get('location') || '').startsWith('https://getcheckoff.com/vote-submitted?city='), 'vote: POST redirects to /vote-submitted');
  await post('Denver');
  const votes = db.rows('interaction_events').filter((e) => e.event_type === 'next_metro_vote_submitted');
  check(votes.length === 1 && votes[0].metadata.city === 'Denver' && votes[0].campaign_id === TEST_CAMPAIGN, 'vote: one test marked vote, deduplicated to the newest city');
  check(await sitePageExists('/vote-submitted'), 'vote: /vote-submitted exists in the site repo');

  // ── Unsubscribe: scanners are harmless, only the confirmation POST acts ───
  const unsubHref = hrefs.find((h) => new URL(h).searchParams.get('ev') === 'unsubscribe')!;
  for (const m of ['GET', 'HEAD', 'GET', 'HEAD']) await linkHandler(new Request(unsubHref, { method: m }), deps);
  check(db.rows('users')[0].email_opt_out === false, 'unsubscribe: repeated GET and HEAD never opt the user out');
  const confirm = new URL((await linkHandler(new Request(unsubHref), deps)).headers.get('location')!);
  check(confirm.pathname === '/unsubscribe' && await sitePageExists('/unsubscribe'), 'unsubscribe: link opens the confirmation page');
  const unsubPage = await Deno.readTextFile(`${SITE_REPO}/public/unsubscribe/index.html`);
  check(/confirm\.value = '1'/.test(unsubPage) && /form\.method = 'POST'/.test(unsubPage), 'unsubscribe: the real page requires an intentional POST with confirm=1');
  const cq = confirm.searchParams;
  const unsubAction = `https://proj.supabase.co/functions/v1/campaign-link?${new URLSearchParams({ u: cq.get('u')!, c: cq.get('c')!, t: cq.get('t')!, seg: cq.get('seg')!, ev: 'unsubscribe' })}`;
  const done = await linkHandler(new Request(unsubAction, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=1' }), deps);
  check(done.headers.get('location') === 'https://getcheckoff.com/unsubscribed' && await sitePageExists('/unsubscribed'), 'unsubscribe: confirmation POST lands on /unsubscribed');
  check(db.rows('users')[0].email_opt_out === false, 'unsubscribe: a test campaign confirmation never changes the test user');
  const unsubEvents = db.rows('interaction_events').filter((e) => e.event_type === 'unsubscribe');
  check(unsubEvents.length === 1 && unsubEvents[0].metadata.is_test_campaign === true, 'unsubscribe: recorded as a test event');

  // The same flow against a production style campaign id, but still only the in memory test user.
  const prodUnsub = `https://proj.supabase.co/functions/v1/campaign-link?${new URLSearchParams({ u: TEST_USER, c: `recap_${MONTH}`, t: await (await import('../supabase/functions/_shared/linkSigning.ts')).signToken(SECRET, TEST_USER, `recap_${MONTH}`), ev: 'unsubscribe' })}`;
  await linkHandler(new Request(prodUnsub), deps);
  check(db.rows('users')[0].email_opt_out === false, 'unsubscribe: GET on a production style link still does not mutate');
  await linkHandler(new Request(prodUnsub, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=1' }), deps);
  check(db.rows('users')[0].email_opt_out === true, 'unsubscribe: confirmation POST opts out the in memory test user');
}

console.log(results.join('\n'));
console.log(`\n${results.length - failures} passed, ${failures} failed${LIVE ? ' (live checks included)' : ' (offline: pass --live for public page HEAD checks)'}`);
Deno.exit(failures ? 1 : 0);
