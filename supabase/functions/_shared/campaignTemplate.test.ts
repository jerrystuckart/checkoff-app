// Run with: deno test supabase/functions/_shared/campaignTemplate.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { buildRecapEmailHtml, type RecapEmailData } from './campaignTemplate.ts';

function baseData(overrides: Partial<RecapEmailData> = {}): RecapEmailData {
  return {
    segment: 'NEVER_CHECKED_OFF',
    firstName: 'Jamie',
    metroName: null,
    metroSource: 'unknown',
    platform: null,
    currentStreakWeeks: 0,
    hasRecentActivity: false,
    recommendations: [],
    updates: [],
    themedLists: [],
    nextMetroVoteUrl: 'https://example.com/vote',
    suggestAnotherCityUrl: 'mailto:hello@getcheckoff.com',
    inviteUrl: 'https://example.com/join',
    unsubscribeUrl: 'https://example.com/unsub',
    ctaUrl: 'https://example.com/cta',
    ...overrides,
  };
}

Deno.test('unknown-metro NEVER_CHECKED_OFF: never mentions Phoenix or any single metro by name', () => {
  const html = buildRecapEmailHtml(baseData());
  // The only metro names allowed anywhere are the four-market discovery list.
  assert(!/Phoenix Fall/i.test(html));
  assert(!html.includes('picked for your area'));
});

Deno.test('unknown-metro NEVER_CHECKED_OFF: shows the general "got bigger" opening, not the metro-specific one', () => {
  const html = buildRecapEmailHtml(baseData());
  assert(html.includes('CheckOff got a lot bigger in August.'));
  assert(!html.includes("Let's find your first CheckOff."));
});

Deno.test('unknown-metro NEVER_CHECKED_OFF: lists all four live markets, main CTA is "Choose a city to explore"', () => {
  const html = buildRecapEmailHtml(baseData());
  for (const city of ['Phoenix', 'Milwaukee', 'Tucson', 'Denver']) {
    assert(html.includes(`>${city} →<`), `expected market list to include ${city}`);
  }
  assert(html.includes('Choose a city to explore'));
});

Deno.test('unknown-metro NEVER_CHECKED_OFF: no season block, no per-item recommendations, no themed lists', () => {
  const html = buildRecapEmailHtml(baseData({
    // even if season/recommendation data were somehow present, the unknown
    // path must not render it
    seasonName: 'Fall 2026 — Phoenix Metro', seasonTotal: 32, seasonCompleted: 3,
    recommendations: [{ id: 'x', body: 'Try a Phoenix spot', url: 'checkoff://item?id=x', role: 'easy_next' }],
  }));
  assert(!html.includes('Fall 2026'));
  assert(!html.includes('Try a Phoenix spot'));
  assert(!html.includes('Based on what you'));
});

Deno.test('unknown-metro NEVER_CHECKED_OFF: closing copy is neutral, not a specific region default', () => {
  const html = buildRecapEmailHtml(baseData());
  assert(!html.includes('patio weather'));
  assert(!html.includes('Leaves are changing'));
});

Deno.test('unknown-metro NEVER_CHECKED_OFF: never claims content is nearby', () => {
  const html = buildRecapEmailHtml(baseData());
  assert(!/near you|nearby/i.test(html));
});

Deno.test('unknown-metro NEVER_CHECKED_OFF: mentions Android availability', () => {
  const html = buildRecapEmailHtml(baseData());
  assert(html.includes('Android'));
});

Deno.test('known-metro NEVER_CHECKED_OFF: unaffected — still shows metro-specific opening', () => {
  const html = buildRecapEmailHtml(baseData({
    metroName: 'Phoenix Metro', metroSource: 'list_history',
    recommendations: [{ id: 'x', body: 'Try a Phoenix spot', url: 'checkoff://item?id=x', role: 'easy_next' }],
  }));
  assert(html.includes("Let's find your first CheckOff."));
  assert(html.includes('Try a Phoenix spot'));
  assert(!html.includes('CheckOff is live in 4 cities'));
});

Deno.test('ACTIVE_AUGUST with a real metro is never affected by the unknown-metro path', () => {
  const html = buildRecapEmailHtml(baseData({
    segment: 'ACTIVE_AUGUST', metroName: 'Denver Metro', metroSource: 'checkoff_history',
    checkinsThisMonth: 5, pointsThisMonth: 20,
  }));
  assert(html.includes('Denver Metro'));
  assert(!html.includes('CheckOff is live in 4 cities'));
});

Deno.test('missing first name renders cleanly with no stray punctuation in the opening', () => {
  const html = buildRecapEmailHtml(baseData({ firstName: null }));
  assert(!html.includes(', CheckOff got'));
  assert(html.includes('CheckOff got a lot bigger in August.'));
});

Deno.test('HTML escaping: a hostile display name / recommendation body cannot inject markup', () => {
  const html = buildRecapEmailHtml(baseData({
    segment: 'ACTIVE_AUGUST', metroName: 'Denver Metro', metroSource: 'checkoff_history',
    firstName: '<script>alert(1)</script>',
    completedNames: ['<img src=x onerror=alert(2)>'],
  }));
  assert(!html.includes('<script>alert(1)</script>'));
  assert(!html.includes('<img src=x onerror=alert(2)>'));
  assert(html.includes('&lt;script&gt;'));
});
