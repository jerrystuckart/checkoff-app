// Run with: deno test supabase/functions/_shared/campaignLogic.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  monthBounds, firstName, escapeHtml, subjectFor, daysRemaining, deviceCta, storeCta,
  streakMessage, almostThereMessage, seasonalClosingCopy, selectSinceLastActivityUpdates,
  assignRecommendationRoles, metroSlug, isStaleSeasonTitle, selectThemedLists,
  AVAILABLE_MARKETS, UNKNOWN_METRO_OPENING, testSendSubject,
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

Deno.test('subjectFor: ACTIVE_AUGUST falls back cleanly with no name', () => {
  assertEquals(subjectFor('ACTIVE_AUGUST', null), 'Your August Monthly CheckOff Recap 🍂');
  assertEquals(subjectFor('ACTIVE_AUGUST', 'Jerry'), 'Jerry, your August Monthly CheckOff Recap 🍂');
});

Deno.test('subjectFor: FALL_CONTINUATION uses season name, falls back to Fall', () => {
  assertEquals(subjectFor('FALL_CONTINUATION', 'Jerry', 'Phoenix Fall 30'), 'Your August Recap: Phoenix Fall 30 is waiting 🍂');
  assertEquals(subjectFor('FALL_CONTINUATION', 'Jerry', null), 'Your August Recap: Fall is waiting 🍂');
});

Deno.test('subjectFor: RETURNING_INACTIVE and NEVER_CHECKED_OFF are name-independent', () => {
  assertEquals(subjectFor('RETURNING_INACTIVE', null), 'Your August CheckOff Update: A lot changed');
  assertEquals(subjectFor('NEVER_CHECKED_OFF', 'Anyone'), 'Your August CheckOff Update: Start exploring this Fall');
});

Deno.test('subjectFor: NEVER_CHECKED_OFF with unknown metro gets the neutral subject, never "Monthly Recap"', () => {
  const subject = subjectFor('NEVER_CHECKED_OFF', 'Jamie', null, false);
  assertEquals(subject, "Your August CheckOff Update: See what's new");
  assert(!subject.includes('Monthly Recap'));
});

Deno.test('subjectFor: NEVER_CHECKED_OFF with known metro keeps the Fall-exploring subject', () => {
  assertEquals(subjectFor('NEVER_CHECKED_OFF', 'Jamie', null, true), 'Your August CheckOff Update: Start exploring this Fall');
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
  assertEquals(streakMessage(3, true), 'Your 3-week streak is alive. Keep it going this weekend.');
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

Deno.test('seasonalClosingCopy: Denver/Milwaukee vs Phoenix/Tucson direction, real "<City> Metro" names', () => {
  assert(seasonalClosingCopy('Denver Metro').includes('Leaves are changing'));
  assert(seasonalClosingCopy('Milwaukee Metro').includes('Leaves are changing'));
  assert(seasonalClosingCopy('Phoenix Metro').includes('patio weather'));
  assert(seasonalClosingCopy('Tucson Metro').includes('patio weather'));
});

Deno.test('seasonalClosingCopy: unknown metro gets neutral copy, never a specific region default', () => {
  const copy = seasonalClosingCopy(null);
  assert(copy.length > 0); // safe default, never throws
  assert(!copy.includes('patio weather')); // must not silently default to desert_southwest
  assert(!copy.includes('Leaves are changing'));
});

// ── Since-last-activity updates ─────────────────────────────────────────────

Deno.test('selectSinceLastActivityUpdates: prioritizes metro-specific, caps at 4, only post-activity', () => {
  const picks = selectSinceLastActivityUpdates('Denver Metro', '2026-01-01');
  assert(picks.length <= 4);
  assertEquals(picks[0].id, 'denver_launch'); // metro-specific ranked first
});

Deno.test('selectSinceLastActivityUpdates: no history falls back to universal news only', () => {
  const picks = selectSinceLastActivityUpdates(null, null);
  assert(picks.every((p) => p.metros === '*'));
});

Deno.test('selectSinceLastActivityUpdates: excludes updates before the since date', () => {
  const picks = selectSinceLastActivityUpdates('Denver Metro', '2026-09-01');
  assert(!picks.some((p) => p.id === 'denver_launch')); // happened before the cutoff
});

// ── Test-send subject prefixing (inbox test package, section 5) ────────────

Deno.test('testSendSubject: prefixes each segment with its distinct [TEST ...] label', () => {
  assertEquals(testSendSubject('ACTIVE_AUGUST', 'Jerry, your August Monthly CheckOff Recap 🍂'),
    '[TEST ACTIVE] Jerry, your August Monthly CheckOff Recap 🍂');
  assertEquals(testSendSubject('FALL_CONTINUATION', 'Your August Recap: Fall 2026 — Denver Metro is waiting 🍂'),
    '[TEST FALL] Your August Recap: Fall 2026 — Denver Metro is waiting 🍂');
  assertEquals(testSendSubject('RETURNING_INACTIVE', 'Your August CheckOff Update: A lot changed'),
    '[TEST RETURNING] Your August CheckOff Update: A lot changed');
  assertEquals(testSendSubject('NEVER_CHECKED_OFF', "Your August CheckOff Update: See what's new"),
    "[TEST NEW USER] Your August CheckOff Update: See what's new");
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
