// Run with: deno test supabase/functions/_shared/campaignLogic.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  monthBounds, monthLabelFor, isMonthClosed, firstName, escapeHtml, publicText, cityDisplayName, seasonDisplayName,
  subjectFor, previewTextFor, daysRemaining, deviceCta, storeCta,
  streakMessage, almostThereMessage, seasonalClosingCopy, NEUTRAL_CLOSING_COPY,
  assignRecommendationRoles, metroSlug, isStaleSeasonTitle, selectThemedLists,
  testSendSubject,
  validateCityInput, MAX_CITY_LENGTH, isSafeDestination, safeDestination, CAMPAIGN_LINK_FALLBACK_DEST,
  classifyDestination, translateDeepLinkForBrowser, voteFormUrl, classifyVotePostEligibility,
} from './campaignLogic.ts';

// ── Calendar boundaries ──────────────────────────────────────────────────────

Deno.test('monthBounds: August 2026 is exactly 08-01 through 09-01', () => {
  const { start, end } = monthBounds('2026-08');
  assertEquals(start, '2026-08-01');
  assertEquals(end, '2026-09-01');
});

Deno.test('monthBounds: December rolls into next year', () => {
  const { start, end } = monthBounds('2026-12');
  assertEquals(start, '2026-12-01');
  assertEquals(end, '2027-01-01');
});

Deno.test('monthBounds: rejects malformed input', () => {
  let threw = false;
  try { monthBounds('2026-8'); } catch { threw = true; }
  assert(threw);
});

// ── Missing first name ───────────────────────────────────────────────────────

Deno.test('firstName: missing display_name returns null (no awkward punctuation)', () => {
  assertEquals(firstName(null), null);
  assertEquals(firstName(''), null);
  assertEquals(firstName('   '), null);
});

Deno.test('firstName: takes first token only', () => {
  assertEquals(firstName('Jerry Stuckart'), 'Jerry');
});

const SEPT = { monthLabel: 'September', metroKnown: true, liveCityCount: 10 };

Deno.test('subjectFor: ACTIVE_MONTH uses the explicit month and falls back cleanly with no name', () => {
  assertEquals(subjectFor('ACTIVE_MONTH', null, SEPT), 'Your September CheckOff recap 🍂');
  assertEquals(subjectFor('ACTIVE_MONTH', 'Jerry', SEPT), 'Jerry, your September CheckOff recap 🍂');
  assertEquals(subjectFor('ACTIVE_MONTH', 'Jerry', { monthLabel: 'October' }), 'Jerry, your October CheckOff recap 🍂');
});

Deno.test('subjectFor: FALL_CONTINUATION never needs a season title and has no month text', () => {
  assertEquals(subjectFor('FALL_CONTINUATION', 'Jerry', SEPT), 'Jerry, your Fall list is waiting 🍂');
  assertEquals(subjectFor('FALL_CONTINUATION', null, SEPT), 'Your Fall list is waiting 🍂');
});

Deno.test('subjectFor: RETURNING_INACTIVE and NEVER_CHECKED_OFF known metro are name independent', () => {
  assertEquals(subjectFor('RETURNING_INACTIVE', null, SEPT), 'A lot is new on CheckOff since you last visited');
  assertEquals(subjectFor('NEVER_CHECKED_OFF', 'Anyone', SEPT), 'Your first CheckOff is waiting');
});

Deno.test('subjectFor: NEVER_CHECKED_OFF unknown metro uses the live city count, never a stale number', () => {
  assertEquals(subjectFor('NEVER_CHECKED_OFF', 'Jamie', { ...SEPT, metroKnown: false }), 'CheckOff is now live in 10 metros');
  assertEquals(subjectFor('NEVER_CHECKED_OFF', 'Jamie', { monthLabel: 'September', metroKnown: false, liveCityCount: 12 }), 'CheckOff is now live in 12 metros');
  assertEquals(subjectFor('NEVER_CHECKED_OFF', 'Jamie', { monthLabel: 'September', metroKnown: false, liveCityCount: null }), 'See where CheckOff is live');
});

Deno.test('subjectFor and previewTextFor: no August, no hyphens, no dashes in any September variant', () => {
  const segs = ['ACTIVE_MONTH', 'FALL_CONTINUATION', 'RETURNING_INACTIVE', 'NEVER_CHECKED_OFF'] as const;
  for (const seg of segs) for (const known of [true, false]) {
    const ctx = { monthLabel: 'September', metroKnown: known, liveCityCount: 10 };
    for (const text of [subjectFor(seg, 'Jamie', ctx), previewTextFor(seg, ctx)]) {
      assert(!/August/i.test(text), text);
      assert(!/[-\u2010-\u2015]/.test(text), text);
    }
  }
});

Deno.test('monthLabelFor and isMonthClosed: strict, explicit month handling', () => {
  assertEquals(monthLabelFor('2026-09'), 'September');
  assertEquals(monthLabelFor('2027-01'), 'January');
  for (const bad of ['2026-9', '2026-13', '2026-00', 'September', '', '2026-09-01']) {
    let threw = false; try { monthLabelFor(bad); } catch { threw = true; }
    assert(threw, bad);
  }
  assertEquals(isMonthClosed('2026-09', new Date('2026-09-30T23:59:59Z')), false);
  assertEquals(isMonthClosed('2026-09', new Date('2026-10-01T00:00:00Z')), true);
  assertEquals(monthBounds('2026-09'), { start: '2026-09-01', end: '2026-10-01' });
  assertEquals(monthBounds('2026-08'), { start: '2026-08-01', end: '2026-09-01' });
});

Deno.test('publicText: removes hyphens and dashes from database text', () => {
  assertEquals(publicText('Fall 2026 \u2014 Munich Metro'), 'Fall 2026, Munich Metro');
  assertEquals(publicText('Full Steins - Amalfi Coast'), 'Full Steins, Amalfi Coast');
  assertEquals(publicText('the 99-meter towers'), 'the 99 meter towers');
  assertEquals(publicText('Re\u2013open'), 'Re, open');
  assert(!/[-\u2010-\u2015]/.test(publicText('A - B \u2013 C \u2014 D e-f')));
});

Deno.test('cityDisplayName and seasonDisplayName: friendly, hyphen free', () => {
  assertEquals(cityDisplayName('Phoenix Metro'), 'Phoenix');
  assertEquals(cityDisplayName('Amalfi Coast'), 'Amalfi Coast');
  assertEquals(seasonDisplayName('Fall 2026 \u2014 Munich Metro', 'Munich Metro'), 'Fall 2026 in Munich');
  assertEquals(seasonDisplayName('Denver Fall 2026', 'Denver Metro'), 'Fall 2026 in Denver');
  assertEquals(seasonDisplayName('FALL 2026 \u2014 San Diego Metro', null), 'Fall 2026');
});

// ── HTML escaping ────────────────────────────────────────────────────────────

Deno.test('escapeHtml: neutralizes markup in user-controlled display_name', () => {
  assertEquals(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assertEquals(escapeHtml(`O'Brien & "Sons"`), 'O&#039;Brien &amp; &quot;Sons&quot;');
});

// ── Countdown ─────────────────────────────────────────────────────────────────

Deno.test('daysRemaining: computes whole days, clamped at 0', () => {
  assertEquals(daysRemaining('2026-09-10', '2026-09-01T12:00:00Z'), 9);
  assertEquals(daysRemaining('2026-08-25', '2026-09-01T00:00:00Z'), 0); // already past
  assertEquals(daysRemaining(null, '2026-09-01'), null);
});

// ── Device CTA ────────────────────────────────────────────────────────────────

Deno.test('deviceCta: iOS/Android open the app, unknown falls back to universal download', () => {
  assertEquals(deviceCta('ios').url, 'checkoff://home');
  assertEquals(deviceCta('android').url, 'checkoff://home');
  assertEquals(deviceCta(null).url, 'https://getcheckoff.com/download');
});

Deno.test('storeCta: routes to the correct store per platform', () => {
  assert(storeCta('ios').url.includes('apps.apple.com'));
  assert(storeCta('android').url.includes('play.google.com'));
  assertEquals(storeCta(undefined).url, 'https://getcheckoff.com/download');
});

// ── Streak messaging ─────────────────────────────────────────────────────────

Deno.test('streakMessage: active streak, momentum, and never-checked-off cases', () => {
  assertEquals(streakMessage(3, true), 'Your streak is 3 weeks strong. Keep it going this weekend.');
  assertEquals(streakMessage(1, true), 'Your streak is 1 week strong. Keep it going this weekend.');
  assertEquals(streakMessage(0, true), "You're building momentum. Check off something this week to keep it going.");
  assertEquals(streakMessage(0, false), 'Your next streak starts with one CheckOff.');
  assertEquals(streakMessage(null, false), 'Your next streak starts with one CheckOff.');
});

Deno.test('streakMessage: never overstates a weekly streak as daily', () => {
  const msg = streakMessage(2, true);
  assert(!msg.toLowerCase().includes('day'));
});

// ── Almost-there / near-unlock ───────────────────────────────────────────────

Deno.test('almostThereMessage: near-unlock surfaces, not-near does not', () => {
  assertEquals(almostThereMessage(8, 10), 'Just 2 more CheckOffs to unlock your next bonus.');
  assertEquals(almostThereMessage(9, 10), 'Just 1 more CheckOff to unlock your next bonus.');
  assertEquals(almostThereMessage(2, 10), null); // 8 remaining, not "almost"
  assertEquals(almostThereMessage(10, 10), null); // already unlocked
  assertEquals(almostThereMessage(5, null), null); // no real threshold — never invented
});

// ── metroSlug — real metro_areas.name values are "<City> Metro" ────────────

Deno.test('metroSlug: strips the " Metro" suffix and lowercases', () => {
  assertEquals(metroSlug('Phoenix Metro'), 'phoenix');
  assertEquals(metroSlug('Denver Metro'), 'denver');
  assertEquals(metroSlug(null), '');
});

// ── Seasonal closing copy ────────────────────────────────────────────────────

Deno.test('seasonalClosingCopy: every metro gets neutral copy, never a weather or region claim', () => {
  for (const m of ['Phoenix Metro', 'Tucson Metro', 'Denver Metro', 'Munich Metro', 'Vienna Metro', 'Amalfi Coast', null, undefined]) {
    const copy = seasonalClosingCopy(m as string | null);
    assertEquals(copy, NEUTRAL_CLOSING_COPY);
    assert(!/patio|weather|football|leaves|cooler|desert|snow/i.test(copy));
  }
});

// ── Next-metro-vote city validation (campaign-link hotfix) ─────────────────

Deno.test('validateCityInput: accepts a normal city, trims and collapses whitespace', () => {
  const r = validateCityInput('  Austin,   TX  ');
  assert(r.ok);
  if (r.ok) assertEquals(r.city, 'Austin, TX');
});

Deno.test('validateCityInput: rejects empty/whitespace-only input', () => {
  assertEquals(validateCityInput('').ok, false);
  assertEquals(validateCityInput('   ').ok, false);
  assertEquals(validateCityInput(null).ok, false);
  const r = validateCityInput('');
  if (r.ok === false) assertEquals(r.reason, 'empty');
});

Deno.test('validateCityInput: rejects excessively long input', () => {
  const long = 'A'.repeat(MAX_CITY_LENGTH + 1);
  const r = validateCityInput(long);
  assertEquals(r.ok, false);
  if (r.ok === false) assertEquals(r.reason, 'too_long');
});

Deno.test('validateCityInput: accepts exactly the max length', () => {
  const exact = 'A'.repeat(MAX_CITY_LENGTH);
  assert(validateCityInput(exact).ok);
});

Deno.test('validateCityInput: rejects angle-bracket/HTML input as unsafe', () => {
  const r = validateCityInput('<script>alert(1)</script>');
  assertEquals(r.ok, false);
  if (r.ok === false) assertEquals(r.reason, 'unsafe_characters');
  const r2 = validateCityInput('Austin<img src=x>');
  assertEquals(r2.ok, false);
});

// ── Destination safety (open-redirect prevention) ───────────────────────────

Deno.test('isSafeDestination: allows checkoff:// deep links', () => {
  assert(isSafeDestination('checkoff://home'));
  assert(isSafeDestination('checkoff://item?id=abc'));
});

Deno.test('isSafeDestination: allows getcheckoff.com and subdomains over https', () => {
  assert(isSafeDestination('https://getcheckoff.com/download'));
  assert(isSafeDestination('https://getcheckoff.com'));
  assert(isSafeDestination('https://www.getcheckoff.com/join'));
});

Deno.test('isSafeDestination: rejects unrelated/attacker-controlled domains', () => {
  assert(!isSafeDestination('https://evil.com'));
  assert(!isSafeDestination('https://getcheckoff.com.evil.com'));
  assert(!isSafeDestination('http://getcheckoff.com')); // not https
  assert(!isSafeDestination('javascript:alert(1)'));
  assert(!isSafeDestination('not a url'));
});

Deno.test('safeDestination: falls back to the known-safe default for unsafe/missing input', () => {
  assertEquals(safeDestination('https://evil.com'), CAMPAIGN_LINK_FALLBACK_DEST);
  assertEquals(safeDestination(null), CAMPAIGN_LINK_FALLBACK_DEST);
  assertEquals(safeDestination(''), CAMPAIGN_LINK_FALLBACK_DEST);
  assertEquals(safeDestination('checkoff://home'), 'checkoff://home');
});

Deno.test('isSafeDestination: allows the App Store and Play Store URLs used by fallback-page buttons', () => {
  assert(isSafeDestination('https://apps.apple.com/us/app/checkoff/id6762678030'));
  assert(isSafeDestination('https://play.google.com/store/apps/details?id=com.getcheckoff.app'));
  assert(!isSafeDestination('https://apps.apple.com.evil.com'));
});

// ── Deep-link classification + browser-safe translation (Sept 2 hotfix) ────

Deno.test('classifyDestination: identifies checkoff:// list/item/home', () => {
  assertEquals(classifyDestination('checkoff://list?id=abc-123'), { type: 'list', id: 'abc-123' });
  assertEquals(classifyDestination('checkoff://item?id=xyz-789'), { type: 'item', id: 'xyz-789' });
  assertEquals(classifyDestination('checkoff://home'), { type: 'home', id: null });
});

Deno.test('classifyDestination: identifies already-https destinations', () => {
  assertEquals(classifyDestination('https://getcheckoff.com/list?id=abc'), { type: 'list', id: 'abc' });
  assertEquals(classifyDestination('https://getcheckoff.com/item?id=xyz'), { type: 'item', id: 'xyz' });
  assertEquals(classifyDestination('https://getcheckoff.com/join/code123'), { type: 'join', id: null });
  assertEquals(classifyDestination('https://getcheckoff.com/download'), { type: 'https_other', id: null });
});

Deno.test('classifyDestination: unparseable input is unknown, never throws', () => {
  assertEquals(classifyDestination('not a url'), { type: 'unknown', id: null });
});

Deno.test('translateDeepLinkForBrowser: an existing delivered checkoff://item URL becomes the canonical item URL (August compatible)', () => {
  const id = '832ab5b4-2b62-463e-a26c-0647751a0460';
  assertEquals(translateDeepLinkForBrowser(`checkoff://item?id=${id}`), `https://getcheckoff.com/item/${id}`);
  assertEquals(translateDeepLinkForBrowser(`checkoff://item/${id}`), `https://getcheckoff.com/item/${id}`);
});

Deno.test('translateDeepLinkForBrowser: metro and legacy slug list links', () => {
  assertEquals(translateDeepLinkForBrowser('checkoff://metro?slug=amalfi-coast'), 'https://getcheckoff.com/metro?slug=amalfi-coast');
  assertEquals(translateDeepLinkForBrowser('checkoff://metro?slug=../x'), 'https://getcheckoff.com/open'); // invalid slug never routed
  assertEquals(translateDeepLinkForBrowser('checkoff://item?id=not-a-uuid'), 'https://getcheckoff.com/open');
  assertEquals(translateDeepLinkForBrowser('checkoff://list?id=west-valley-best'), 'https://getcheckoff.com/list?id=west-valley-best');
  assertEquals(translateDeepLinkForBrowser('https://getcheckoff.com/metro?slug=florence'), 'https://getcheckoff.com/metro?slug=florence'); // already https: untouched
});

Deno.test('classifyDestination: canonical forms report their entity (item and list ids, metro slug) for attribution', () => {
  const id = '832ab5b4-2b62-463e-a26c-0647751a0460';
  assertEquals(classifyDestination(`https://getcheckoff.com/item/${id}`), { type: 'item', id });
  assertEquals(classifyDestination(`https://getcheckoff.com/list?id=${id}`), { type: 'list', id });
  assertEquals(classifyDestination('https://getcheckoff.com/metro?slug=amalfi-coast'), { type: 'metro', id: 'amalfi-coast' });
  assertEquals(classifyDestination('https://getcheckoff.com/open'), { type: 'home', id: null });
  assertEquals(classifyDestination('checkoff://metro?slug=florence'), { type: 'metro', id: 'florence' });
  assertEquals(classifyDestination(`checkoff://item/${id}`), { type: 'item', id });
});

Deno.test('translateDeepLinkForBrowser: an existing delivered checkoff://list URL becomes safe HTTPS', () => {
  assertEquals(translateDeepLinkForBrowser('checkoff://list?id=419ba1e2-c846-434f-b168-8829e8a90a73'),
    'https://getcheckoff.com/list?id=419ba1e2-c846-434f-b168-8829e8a90a73');
});

Deno.test('translateDeepLinkForBrowser: an existing delivered home/main-CTA URL becomes safe HTTPS', () => {
  assertEquals(translateDeepLinkForBrowser('checkoff://home'), 'https://getcheckoff.com/open');
});

Deno.test('translateDeepLinkForBrowser: never returns a raw checkoff:// URL for a browser redirect', () => {
  for (const dest of ['checkoff://home', 'checkoff://list?id=x', 'checkoff://item?id=x', 'checkoff://something-unknown']) {
    const translated = translateDeepLinkForBrowser(dest);
    assert(!translated.startsWith('checkoff://'), `expected ${dest} to translate away from checkoff://, got ${translated}`);
    assert(translated.startsWith('https://getcheckoff.com'));
  }
});

Deno.test('translateDeepLinkForBrowser: an already-https destination passes through untouched', () => {
  assertEquals(translateDeepLinkForBrowser('https://getcheckoff.com/join/abc'), 'https://getcheckoff.com/join/abc');
  assertEquals(translateDeepLinkForBrowser('https://getcheckoff.com/download'), 'https://getcheckoff.com/download');
});

Deno.test('translateDeepLinkForBrowser: unrecognized checkoff:// path falls back to the generic open page, not an error', () => {
  assertEquals(translateDeepLinkForBrowser('checkoff://something-unknown'), 'https://getcheckoff.com/open');
  assertEquals(translateDeepLinkForBrowser('checkoff://item'), 'https://getcheckoff.com/open'); // item with no id
});

// ── Test-send subject prefixing (inbox test package, section 5) ────────────

Deno.test('testSendSubject: every variant has a distinct, unmistakable [TEST ...] marker', () => {
  const keys = ['ACTIVE_MONTH', 'FALL_CONTINUATION', 'RETURNING_INACTIVE', 'NEVER_CHECKED_OFF', 'NEVER_CHECKED_OFF_UNKNOWN'];
  const prefixes = keys.map((k) => testSendSubject(k, 'x').split(' x')[0]);
  assertEquals(new Set(prefixes).size, 5);
  for (const p of prefixes) assert(p.startsWith('[TEST'), p);
  assertEquals(testSendSubject('ACTIVE_MONTH', 'Your September CheckOff recap 🍂'), '[TEST ACTIVE] Your September CheckOff recap 🍂');
});

// ── Recommendation roles ─────────────────────────────────────────────────────

Deno.test('assignRecommendationRoles: assigns 3 distinct roles by difficulty', () => {
  const items = [
    { id: '3', body: 'Hard thing', difficulty: 25, url: 'checkoff://item?id=3' },
    { id: '1', body: 'Easy thing', difficulty: 10, url: 'checkoff://item?id=1' },
    { id: '2', body: 'Medium thing', difficulty: 15, url: 'checkoff://item?id=2' },
  ];
  const roled = assignRecommendationRoles(items);
  assertEquals(roled[0].id, '1');
  assertEquals(roled[0].role, 'easy_next');
  assertEquals(roled[2].role, 'try_different');
});

// ── Stale-season themed-list filter ──────────────────────────────────────────

Deno.test('isStaleSeasonTitle: flags Summer/Winter/Spring-tagged titles, allows Fall', () => {
  assert(isStaleSeasonTitle('The Ungoogleable City · Summer 2026'));
  assert(isStaleSeasonTitle('Powder Day People · Winter 2026'));
  assert(!isStaleSeasonTitle('Hoptimists · Denver'));
  assert(!isStaleSeasonTitle('Fall 2026 — Phoenix Metro'));
});

// ── Themed-list selection (Phoenix regression) ──────────────────────────────

Deno.test('selectThemedLists: excludes summer-tagged rows even when they sort first (the Phoenix bug)', () => {
  const rows = [
    { id: '1', title: 'The Ungoogleable City · Summer 2026', season: 'summer' },
    { id: '2', title: 'The Brunch Bloc · Summer 2026', season: 'summer' },
    { id: '3', title: "West Valley's Best", season: 'anytime' },
    { id: '4', title: 'Phoenix Hidden Gems', season: 'anytime' },
    { id: '5', title: 'Rediscover Downtown Peoria', season: 'anytime' },
  ];
  const result = selectThemedLists(rows);
  assertEquals(result.length, 3);
  assert(result.every((r) => !r.title.includes('Summer')));
  assertEquals(result.map((r) => r.id).sort(), ['3', '4', '5']);
});

Deno.test('selectThemedLists: fall-season rows are allowed, caps at 3', () => {
  const rows = [
    { id: '1', title: 'Hoptimists · Denver', season: 'fall' },
    { id: '2', title: 'Trail Mix Crew · Denver', season: 'fall' },
    { id: '3', title: 'Pearl Street Regulars · Denver', season: 'fall' },
    { id: '4', title: 'A fourth list', season: 'fall' },
  ];
  assertEquals(selectThemedLists(rows).length, 3);
});

Deno.test('selectThemedLists: title regex is a safety net even if season column says fall/anytime incorrectly', () => {
  const rows = [{ id: '1', title: 'Oops Still Summer 2026', season: 'fall' }];
  assertEquals(selectThemedLists(rows).length, 0);
});

Deno.test('assignRecommendationRoles: sparse data (0-2 items) never throws', () => {
  assertEquals(assignRecommendationRoles([]), []);
  const one = assignRecommendationRoles([{ id: '1', body: 'x', url: 'u' }]);
  assertEquals(one.length, 1);
  assertEquals(one[0].role, 'easy_next');
});

// ── voteFormUrl / classifyVotePostEligibility (Sept 2 vote-submission hotfix) ──
// Regression coverage for the real production bug: voteFormUrl() used to
// omit `ev=next_metro_vote`, so the static page's form action (built from
// that URL) posted with no `ev` at all and was rejected before any city
// validation — a real submitted vote (Jerry's wife) was silently lost.

Deno.test('voteFormUrl: always includes ev=next_metro_vote — the exact regression', () => {
  const url = voteFormUrl('u1', 'recap_2026-08', 'tok123', 'ACTIVE_AUGUST', 'https://getcheckoff.com');
  const parsed = new URL(url);
  assertEquals(parsed.searchParams.get('ev'), 'next_metro_vote');
});

Deno.test('voteFormUrl: preserves u/c/t/seg/dest exactly, matching a real delivered link', () => {
  // The exact shape of Jerry's delivered production URL's params.
  const url = voteFormUrl(
    '11275026-65be-4421-80a4-46c57195408b', 'recap_2026-08', '342dc7e6b922fc1eaf7358a4',
    'ACTIVE_AUGUST', 'https://getcheckoff.com',
  );
  const p = new URL(url).searchParams;
  assertEquals(p.get('u'), '11275026-65be-4421-80a4-46c57195408b');
  assertEquals(p.get('c'), 'recap_2026-08');
  assertEquals(p.get('t'), '342dc7e6b922fc1eaf7358a4');
  assertEquals(p.get('seg'), 'ACTIVE_AUGUST');
  assertEquals(p.get('dest'), 'https://getcheckoff.com');
  assertEquals(p.get('ev'), 'next_metro_vote');
});

Deno.test('voteFormUrl: null segment becomes an empty string, never the literal "null"', () => {
  const url = voteFormUrl('u1', 'c1', 't1', null, 'https://getcheckoff.com');
  assertEquals(new URL(url).searchParams.get('seg'), '');
});

Deno.test('voteFormUrl: optional error param is included only when given', () => {
  const withError = voteFormUrl('u1', 'c1', 't1', null, 'https://getcheckoff.com', 'too_long');
  assertEquals(new URL(withError).searchParams.get('error'), 'too_long');
  const withoutError = voteFormUrl('u1', 'c1', 't1', null, 'https://getcheckoff.com');
  assertEquals(new URL(withoutError).searchParams.get('error'), null);
});

Deno.test('classifyVotePostEligibility: ev=next_metro_vote is explicit', () => {
  assertEquals(classifyVotePostEligibility('next_metro_vote'), 'explicit');
});

Deno.test('classifyVotePostEligibility: no ev at all is legacy_recovery, not rejected', () => {
  assertEquals(classifyVotePostEligibility(null), 'legacy_recovery');
  assertEquals(classifyVotePostEligibility(undefined), 'legacy_recovery');
});

Deno.test('classifyVotePostEligibility: an explicit but different event type is rejected, never silently accepted', () => {
  assertEquals(classifyVotePostEligibility('recommendation_click'), 'rejected');
  assertEquals(classifyVotePostEligibility('email_click'), 'rejected');
  assertEquals(classifyVotePostEligibility('unsubscribe'), 'rejected');
});

Deno.test('classifyVotePostEligibility: empty string ev is treated as absent (legacy_recovery), not rejected', () => {
  assertEquals(classifyVotePostEligibility(''), 'legacy_recovery');
});
