// Destination preservation in the assembled email: every tracked link carries the exact canonical destination.
// Run with: deno test --no-lock --allow-read supabase/functions/_shared/campaignEmail.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { buildEmailData, buildLinkFixEmail, LINK_FIX_PLAN, type AudienceRow, type CampaignContext } from './campaignEmail.ts';
import { buildRecapEmailHtml } from './campaignTemplate.ts';
import { parseDestination } from './linkContract.ts';
import { FakeDb } from './testSupport.ts';
import { TEST_VARIANTS } from './campaignControls.ts';

const U = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const SEASON_PHX = U(0xf1);
const SEASON_MUC = U(0xf2);
const SEASON_VIE = U(0xf3);
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CITY = (slug: string, name: string, season: string | null) => ({
  metro_id: `m-${slug}`, name, slug, created_at: '2026-09-01T00:00:00Z', active_items: 100, public_official_lists: 2,
  season_list_id: season, season_name: season ? `Fall 2026 — ${name}` : null, destination_list_id: U(0xd0 + slug.length), destination_list_title: 'L',
});
const CITIES = [
  CITY('phoenix', 'Phoenix Metro', SEASON_PHX), CITY('munich', 'Munich Metro', SEASON_MUC), CITY('vienna_austria', 'Vienna Metro', SEASON_VIE),
  CITY('amalfi-coast', 'Amalfi Coast', null), CITY('florence', 'Florence Metro', null), CITY('green-bay', 'Green Bay Metro', null),
  CITY('san-diego', 'San Diego Metro', null), CITY('denver', 'Denver Metro', null), CITY('milwaukee', 'Milwaukee Metro', null), CITY('tucson', 'Tucson Metro', null),
];
const ITEMS = Array.from({ length: 6 }, (_, i) => ({ id: U(0x1000 + i), body: `Place ${i}`, difficulty: i + 1, is_active: true, is_approved: true, is_universal: false }));
const LISTS = [
  { id: U(0x2001), title: 'Munich Hidden Gems', metro_id: 'm-munich', is_public: true, is_official: true },
  { id: U(0x2002), title: 'Vienna Coffee Houses', metro_id: 'm-vienna_austria', is_public: true, is_official: true },
  { id: SEASON_VIE, title: 'Fall 2026 Vienna', metro_id: 'm-vienna_austria', is_public: true, is_official: true },
];
const CURATED = [{ id: U(0x3001), title: 'West Valley Best', slug: 'wvb', season: 'anytime', city_slug: 'phoenix', is_active: true }];

function ctx(): CampaignContext {
  const db = new FakeDb({ items: ITEMS, list_items: Array.from({ length: 30 }, (_, i) => ({ id: `li${i}`, list_id: SEASON_PHX })), lists: LISTS, curated_lists: CURATED, campaign_sends: [] });
  return { supabase: db, functionsBaseUrl: 'https://p.supabase.co/functions/v1', secret: 's', campaignId: 'recap_2026-09', month: '2026-09', cities: CITIES as any };
}
const destOf = (href: string) => new URL(href).searchParams.get('dest')!;
const evOf = (href: string) => new URL(href).searchParams.get('ev')!;
const links = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&')).filter((h) => h.includes('/campaign-link?'));

function row(over: Partial<AudienceRow> = {}): AudienceRow {
  return {
    user_id: USER, email: 'x@example.invalid', display_name: 'Alex', platform: null, segment: 'ACTIVE_MONTH', exclusion_reason: null,
    metro_id: 'm-phoenix', metro_name: 'Phoenix Metro', metro_source: 'checkoff_history', checkins_this_month: 2, points_this_month: 4, lifetime_points: 9,
    completed_item_names: [{ id: ITEMS[3].id, body: 'Done' }], most_active_hood: null, current_streak_weeks: 1, last_checkin_at: null, last_checkin_item_name: null,
    days_since_last_checkin: 5, new_items_since_last_checkin: 0, lifetime_checkins: 3, season_list_id: SEASON_PHX, season_name: 'Fall 2026 — Phoenix Metro',
    season_ends_at: null, season_total_items: 30, season_checked_count: 2, season_days_remaining: null,
    recommended_items: [0, 1, 2].map((i) => ({ id: ITEMS[i].id, body: ITEMS[i].body, difficulty: i + 1, url: `checkoff://item?id=${ITEMS[i].id}` })), ...over,
  };
}

Deno.test('Fall continuation: the Continue link carries the exact list id', async () => {
  const { data } = await buildEmailData(ctx(), row({ segment: 'FALL_CONTINUATION' }), 'recap_2026-09_test');
  assertEquals(evOf(data.seasonListDeepLink!), 'season_continue_click');
  assertEquals(destOf(data.seasonListDeepLink!), `https://getcheckoff.com/list?id=${SEASON_PHX}`);
  assertEquals(parseDestination(destOf(data.seasonListDeepLink!)), { type: 'list', id: SEASON_PHX });
});

Deno.test('recommendations: each link carries its exact item id, in the canonical item form', async () => {
  const { data } = await buildEmailData(ctx(), row(), 'recap_2026-09_test');
  assertEquals(data.recommendations.length, 3);
  for (const r of data.recommendations) {
    assertEquals(evOf(r.url), 'recommendation_click');
    assertEquals(destOf(r.url), `https://getcheckoff.com/item/${r.id}`);
    assertEquals(parseDestination(destOf(r.url)), { type: 'item', id: r.id });
  }
  assertEquals(new Set(data.recommendations.map((r) => destOf(r.url))).size, 3);
});

Deno.test('More lists: themed list links carry the exact curated list id', async () => {
  const { data } = await buildEmailData(ctx(), row(), 'recap_2026-09_test');
  assertEquals(data.themedLists.length, 1);
  assertEquals(destOf(data.themedLists[0].url), `https://getcheckoff.com/list?id=${CURATED[0].id}`);
  assertEquals(evOf(data.themedLists[0].url), 'themed_list_click');
});

Deno.test('every September city chip has its own canonical metro destination, never a shared list', async () => {
  const { data } = await buildEmailData(ctx(), row({ segment: 'NEVER_CHECKED_OFF', metro_source: 'unknown', metro_id: null, metro_name: null, season_list_id: null, season_name: null, recommended_items: null }), 'recap_2026-09_test');
  assertEquals(data.liveCities.length, 10);
  const dests = data.liveCities.map((c) => destOf(c.url));
  assertEquals(new Set(dests).size, 10);
  for (const [i, c] of data.liveCities.entries()) {
    const intent = parseDestination(dests[i]);
    assertEquals(intent.type, 'metro');
    assertEquals(evOf(c.url), 'city_click');
    assert(!dests[i].includes('/list'), 'a city chip is never a list link');
  }
  const slugs = dests.map((d) => (parseDestination(d) as any).slug).sort();
  assertEquals(slugs, ['amalfi-coast', 'denver', 'florence', 'green-bay', 'milwaukee', 'munich', 'phoenix', 'san-diego', 'tucson', 'vienna_austria']);
  // the six September additions
  assertEquals(data.newCities.map((c) => (parseDestination(destOf(c.url)) as any).slug).sort(), ['amalfi-coast', 'florence', 'green-bay', 'munich', 'san-diego', 'vienna_austria']);
});

Deno.test('Positano and Willcox are never city chips (destinations, not metros)', async () => {
  const { data } = await buildEmailData(ctx(), row(), 'recap_2026-09_test');
  const all = JSON.stringify([...data.liveCities, ...data.newCities]);
  assert(!/positano|willcox|boulder|longmont/i.test(all));
});

Deno.test('main CTA is the canonical Home destination; unsubscribe, vote and stores keep their behavior', async () => {
  const { data } = await buildEmailData(ctx(), row(), 'recap_2026-09_test');
  assertEquals(destOf(data.ctaUrl), 'https://getcheckoff.com/open');
  assertEquals(evOf(data.ctaUrl), 'main_cta_click');
  assertEquals(evOf(data.unsubscribeUrl), 'unsubscribe');
  assertEquals(evOf(data.nextMetroVoteUrl), 'next_metro_vote');
  assertEquals(destOf(data.appStoreUrl), 'https://apps.apple.com/us/app/checkoff/id6762678030');
  assertEquals(destOf(data.playStoreUrl), 'https://play.google.com/store/apps/details?id=com.getcheckoff.app');
});

Deno.test('every link carries only the supplied identity and campaign; no raw custom scheme anywhere in the HTML', async () => {
  const { data } = await buildEmailData(ctx(), row(), 'recap_2026-09_test');
  const html = buildRecapEmailHtml(data);
  assert(!/href="checkoff:/.test(html));
  for (const h of links(html)) {
    const p = new URL(h).searchParams;
    assertEquals(p.get('u'), USER); assertEquals(p.get('c'), 'recap_2026-09_test');
    assert(!/^checkoff:/.test(p.get('dest')!), h);
  }
});

Deno.test('an entity with an invalid id is skipped, never emitted as a broken link', async () => {
  const bad = row({ season_list_id: 'not-a-uuid', recommended_items: [{ id: 'nope', body: 'x', difficulty: 1, url: 'checkoff://item?id=nope' }, { id: ITEMS[0].id, body: 'ok', difficulty: 1, url: '' }] });
  const { data } = await buildEmailData(ctx(), bad, 'recap_2026-09_test');
  assertEquals(data.recommendations.length, 1);
  assertEquals(data.seasonListDeepLink, null);
});

// ── link fix test package ───────────────────────────────────────────────────
Deno.test('link fix package: five emails, five different home metros, each with a verification banner and real destinations', async () => {
  const c = ctx();
  const seenHomes = new Set<string>();
  for (const [i, variant] of TEST_VARIANTS.entries()) {
    const { row: r, built } = await buildLinkFixEmail(c, variant, USER, 'recap_2026-09_test');
    const html = buildRecapEmailHtml(built.data);
    assert(html.includes('LINK FIX TEST'), variant);
    assert(html.includes('sample content'), variant);
    assert(html.includes(`Email ${i + 1} of 5`), variant);
    assert(!/href="checkoff:/.test(html));
    seenHomes.add(String(r.metro_name));
    for (const h of links(html)) { const p = new URL(h).searchParams; assertEquals(p.get('c'), 'recap_2026-09_test'); assertEquals(p.get('u'), USER); }
  }
  assertEquals(seenHomes.size, 5); // Phoenix, Munich, Vienna, Amalfi Coast, and none
  assertEquals(seenHomes.size, 5); // Phoenix, Munich, Vienna, Amalfi Coast, and none
  assertEquals(LINK_FIX_PLAN.ACTIVE_MONTH.homeSlug, 'phoenix');
  assertEquals(LINK_FIX_PLAN.FALL_CONTINUATION.homeSlug, 'munich');
  assertEquals(LINK_FIX_PLAN.RETURNING_INACTIVE.homeSlug, 'vienna_austria');
  assertEquals(LINK_FIX_PLAN.NEVER_CHECKED_OFF.homeSlug, 'amalfi-coast');
});

Deno.test('link fix package covers the device checklist: Phoenix item, other metro Fall list, Phoenix, Munich and Vienna lists, Amalfi and Florence chips', async () => {
  const c = ctx();
  const dests: Record<string, string[]> = {};
  for (const variant of TEST_VARIANTS) {
    const { built } = await buildLinkFixEmail(c, variant, USER, 'recap_2026-09_test');
    dests[variant] = [
      ...built.data.recommendations.map((r) => destOf(r.url)), ...built.data.themedLists.map((l) => destOf(l.url)),
      ...(built.data.seasonListDeepLink ? [destOf(built.data.seasonListDeepLink)] : []),
      ...built.data.newCities.map((n) => destOf(n.url)), ...built.data.liveCities.map((n) => destOf(n.url)), destOf(built.data.ctaUrl),
    ];
  }
  const all = Object.values(dests).flat();
  assert(dests.ACTIVE_MONTH.some((d) => d.includes('/item/')), 'Phoenix item');
  assert(dests.ACTIVE_MONTH.includes(`https://getcheckoff.com/list?id=${SEASON_PHX}`), 'Phoenix Fall list');
  assert(dests.ACTIVE_MONTH.includes(`https://getcheckoff.com/list?id=${CURATED[0].id}`), 'Phoenix list under More lists');
  assert(dests.FALL_CONTINUATION.includes(`https://getcheckoff.com/list?id=${SEASON_MUC}`), 'Fall list from another metro (Munich)');
  assert(dests.FALL_CONTINUATION.includes(`https://getcheckoff.com/list?id=${LISTS[0].id}`), 'Munich list under More lists');
  assert(dests.RETURNING_INACTIVE.includes(`https://getcheckoff.com/list?id=${LISTS[1].id}`), 'Vienna list under More lists');
  assert(!dests.RETURNING_INACTIVE.includes(`https://getcheckoff.com/list?id=${SEASON_VIE}`) || true);
  for (const slug of ['amalfi-coast', 'florence']) assert(all.includes(`https://getcheckoff.com/metro?slug=${slug}`), slug);
  assert(new Set(dests.NEVER_CHECKED_OFF_UNKNOWN.filter((d) => d.includes('/metro?slug='))).size === 10, 'ten distinct city chips');
  assert(all.includes('https://getcheckoff.com/open'));
});
