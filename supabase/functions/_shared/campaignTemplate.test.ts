// Run with: deno test supabase/functions/_shared/campaignTemplate.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { buildRecapEmailHtml, type RecapEmailData } from './campaignTemplate.ts';
import { subjectFor, previewTextFor, type Segment } from './campaignLogic.ts';

const CITIES = ['Amalfi Coast', 'Denver', 'Florence', 'Green Bay', 'Milwaukee', 'Munich', 'Phoenix', 'San Diego', 'Tucson', 'Vienna'];
const NEW_CITIES = ['San Diego', 'Vienna', 'Green Bay', 'Florence', 'Munich', 'Amalfi Coast'];
const link = (name: string) => `https://example.com/campaign-link?city=${encodeURIComponent(name)}`;

function baseData(overrides: Partial<RecapEmailData> = {}): RecapEmailData {
  const segment: Segment = overrides.segment ?? 'ACTIVE_MONTH';
  const metroSource = overrides.metroSource ?? 'checkoff_history';
  const ctx = { monthLabel: 'September', metroKnown: metroSource !== 'unknown', liveCityCount: CITIES.length };
  return {
    segment,
    monthLabel: 'September',
    previewText: previewTextFor(segment, ctx),
    firstName: 'Jamie',
    metroName: 'Phoenix Metro',
    metroSource,
    platform: null,
    checkinsThisMonth: 3,
    pointsThisMonth: 9,
    completedNames: ['Order the green chile burger at a diner', 'Watch the sunset from a trailhead', 'Try a 99-meter tower view'],
    currentStreakWeeks: 2,
    hasRecentActivity: true,
    seasonName: 'Fall 2026 — Phoenix Metro',
    seasonCompleted: 4,
    seasonTotal: 32,
    seasonDaysRemaining: 61,
    seasonListDeepLink: 'https://example.com/season',
    daysSinceLastCheckin: 22,
    lastCheckinItemName: 'Find the hidden mural downtown',
    newItemsSinceLastCheckin: 12,
    recommendations: [
      { id: 'a', body: 'Sit in a taproom', difficulty: 1, url: 'https://example.com/r1', role: 'easy_next' },
      { id: 'b', body: 'Catch a game', difficulty: 3, url: 'https://example.com/r2', role: 'made_for_you' },
      { id: 'c', body: 'Hike at dawn', difficulty: 5, url: 'https://example.com/r3', role: 'try_different' },
    ],
    themedLists: [{ title: 'Hoptimists · Denver', url: 'https://example.com/t1' }],
    liveCityCount: CITIES.length,
    liveCities: CITIES.map((n) => ({ name: n, url: link(n) })),
    newCities: NEW_CITIES.map((n) => ({ name: n, url: link(n) })),
    socialLinks: [{ label: 'Instagram', url: 'https://example.com/ig' }],
    appStoreUrl: 'https://example.com/appstore',
    playStoreUrl: 'https://example.com/play',
    nextMetroVoteUrl: 'https://example.com/vote',
    suggestAnotherCityUrl: 'mailto:hello@getcheckoff.com',
    inviteUrl: 'https://example.com/join',
    unsubscribeUrl: 'https://example.com/unsub',
    ctaUrl: 'https://example.com/cta',
    ...overrides,
  };
}

// Visible text only: tags, style blocks and attributes removed, so hyphens in CSS or URLs do not count.
function visibleText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<title>[\s\S]*?<\/title>/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/ ([.,:;!?])/g, '$1');
}

const VARIANTS: [string, RecapEmailData][] = [
  ['ACTIVE_MONTH', baseData({ segment: 'ACTIVE_MONTH' })],
  ['FALL_CONTINUATION', baseData({ segment: 'FALL_CONTINUATION', checkinsThisMonth: 0 })],
  ['RETURNING_INACTIVE', baseData({ segment: 'RETURNING_INACTIVE', checkinsThisMonth: 0 })],
  ['NEVER_CHECKED_OFF known', baseData({ segment: 'NEVER_CHECKED_OFF', metroSource: 'list_history', seasonCompleted: 0, checkinsThisMonth: 0 })],
  ['NEVER_CHECKED_OFF unknown', baseData({
    segment: 'NEVER_CHECKED_OFF', metroSource: 'unknown', metroName: null, recommendations: [], themedLists: [],
    seasonName: null, seasonTotal: undefined, checkinsThisMonth: 0,
  })],
];

Deno.test('all five variants render with no stale or banned language', () => {
  for (const [name, d] of VARIANTS) {
    const html = buildRecapEmailHtml(d);
    const text = visibleText(html);
    const title = /<title>([\s\S]*?)<\/title>/.exec(html)![1];
    assert(!/August/i.test(html), `${name}: August`);
    assert(!/Trip Mode|Visitor Mode|missed check|visit recovery|background location|visit inbox|places you may have visited|seven day|7 day|recover/i.test(text), `${name}: banned feature language`);
    assert(!/patio|weather|football|desert/i.test(text), `${name}: weather claim`);
    assert(!/0 days left|0 days to go/i.test(text), `${name}: zero days`);
    assert(!/Based on what you/i.test(text), `${name}: false personalization`);
    assert(!/We don't know where you are/i.test(text), `${name}: invasive wording`);
    assert(!/widget|home screen|Ready for visitors/i.test(text), `${name}: stale teaser`);
    assert(!/[-‐-―]/.test(text), `${name}: hyphen or dash in visible copy: ${(/.{15}[-‐-―].{15}/.exec(text) || [''])[0]}`);
    assert(!/[-‐-―]/.test(title), `${name}: title`);
    assert(!/href="checkoff:/.test(html), `${name}: raw custom scheme`);
    assert(html.includes('September'), `${name}: month`);
  }
});

Deno.test('month neutral: October renders October, never September', () => {
  const html = buildRecapEmailHtml(baseData({ monthLabel: 'October', segment: 'ACTIVE_MONTH', previewText: previewTextFor('ACTIVE_MONTH', { monthLabel: 'October' }) }));
  assert(html.includes('in October.'));
  assert(html.includes('<title>Your October CheckOff Recap</title>'));
  assert(!/September/.test(html));
});

Deno.test('ACTIVE_MONTH: count, up to three names, stats, no residence assumption', () => {
  const html = buildRecapEmailHtml(baseData({ segment: 'ACTIVE_MONTH', metroName: 'Munich Metro' }));
  const text = visibleText(html);
  assert(text.includes('Jamie, look what you checked off in September.'));
  assert(text.includes('You checked off 3 things in September'));
  assert(text.includes('Try a 99 meter tower view')); // hyphen cleaned from database text
  assert(text.includes('September CheckOffs') && text.includes('Points earned') && text.includes('Week streak'));
  assert(!/Munich Metro ·|Metro ·/.test(text)); // no "metro eyebrow" implying where the user lives
});

Deno.test('ACTIVE_MONTH: singular, and untrustworthy zero points or streak cards are hidden', () => {
  const html = buildRecapEmailHtml(baseData({ checkinsThisMonth: 1, pointsThisMonth: 0, currentStreakWeeks: 0, completedNames: ['One thing'] }));
  const text = visibleText(html);
  assert(text.includes('You checked off 1 thing in September: One thing.'));
  assert(!text.includes('Points earned'));
  assert(!text.includes('Week streak'));
});

Deno.test('NULL season end date: no countdown anywhere, evergreen copy instead', () => {
  const html = buildRecapEmailHtml(baseData({ segment: 'FALL_CONTINUATION', seasonDaysRemaining: null }));
  const text = visibleText(html);
  assert(!/days left|days to go|0 day/.test(text));
  assert(text.includes('Keep going whenever you are ready.'));
  assert(text.includes('4 of 32 complete (13%)'));
  const withEnd = visibleText(buildRecapEmailHtml(baseData({ segment: 'FALL_CONTINUATION', seasonDaysRemaining: 61 })));
  assert(withEnd.includes('28 left, 61 days to go'));
  const zero = visibleText(buildRecapEmailHtml(baseData({ segment: 'FALL_CONTINUATION', seasonDaysRemaining: 0 })));
  assert(!/0 days/.test(zero));
});

Deno.test('FALL_CONTINUATION: friendly season name, progress, continue button', () => {
  const text = visibleText(buildRecapEmailHtml(baseData({ segment: 'FALL_CONTINUATION' })));
  assert(text.includes('Jamie, your Fall list is waiting.'));
  assert(text.includes('You have checked off 4 of 32 on Fall 2026 in Phoenix.'));
  assert(text.includes('Continue your Fall list'));
});

Deno.test('RETURNING_INACTIVE: never claims a checkoff in the recap month, shows new cities and update links', () => {
  const html = buildRecapEmailHtml(baseData({ segment: 'RETURNING_INACTIVE', checkinsThisMonth: 0 }));
  const text = visibleText(html);
  assert(text.includes('A lot is new since your last visit.'));
  assert(text.includes('Last time you checked off Find the hidden mural downtown, 22 days ago.'));
  assert(text.includes('12 new places were added in Phoenix.'));
  assert(!/checked off \d+ things? in September/.test(text));
  assert(text.includes('6 new metros opened in September, and CheckOff is now live in 10 metros.'));
  for (const c of NEW_CITIES) assert(html.includes(`href="${link(c)}"`), c);
  assert(html.includes('href="https://example.com/appstore"') && html.includes('href="https://example.com/play"'));
});

Deno.test('NEVER_CHECKED_OFF known metro: truthful heading, never "Based on what you checked off"', () => {
  const text = visibleText(buildRecapEmailHtml(baseData({ segment: 'NEVER_CHECKED_OFF', metroSource: 'list_history', seasonCompleted: 0 })));
  assert(text.includes('Great places to start in Phoenix'));
  assert(text.includes('Jamie, your first CheckOff is waiting.'));
  assert(!/Based on what you/i.test(text));
  assert(text.includes('32 places to check off')); // zero progress shows the size of the list, not 0 percent
  assert(text.includes('See the Fall list'));
});

Deno.test('NEVER_CHECKED_OFF unknown metro: live city count, every city has its own distinct link', () => {
  const [, d] = VARIANTS[4];
  const html = buildRecapEmailHtml(d);
  const text = visibleText(html);
  assert(text.includes('CheckOff is now live in 10 metros.'));
  assert(text.includes('Choose a city and make your first CheckOff.'));
  assert(!/4 cities|four cities/i.test(text));
  assert(text.includes('Choose a city to explore'));
  const cityHrefs = CITIES.map((c) => `href="${link(c)}"`);
  for (const h of cityHrefs) assert(html.includes(h), h);
  assertEquals(new Set(cityHrefs).size, 10); // no shared generic destination
  assert(!text.includes('Based on what you'));
  assert(!/Fall 2026 in/.test(text)); // no season block for an unknown metro
});

Deno.test('live data drives the count: 12 live cities says 12, a short list says its own length', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ name: `City ${i}`, url: `https://example.com/c${i}` }));
  const html12 = visibleText(buildRecapEmailHtml({ ...VARIANTS[4][1], liveCityCount: 12, liveCities: twelve }));
  assert(html12.includes('live in 12 metros'));
  const three = twelve.slice(0, 3);
  const html3 = visibleText(buildRecapEmailHtml({ ...VARIANTS[4][1], liveCityCount: 3, liveCities: three }));
  assert(html3.includes('live in 3 metros') && !html3.includes('live in 10'));
});

Deno.test('compact new city line for active, fall and known metro variants; no per city button wall', () => {
  for (const seg of ['ACTIVE_MONTH', 'FALL_CONTINUATION'] as const) {
    const html = buildRecapEmailHtml(baseData({ segment: seg }));
    const text = visibleText(html);
    assert(text.includes('CheckOff grew in September'));
    assert(text.includes('New in September: San Diego, Vienna, Green Bay, Florence, Munich and Amalfi Coast.'));
    assert(!text.includes('Pick a city to begin'));
  }
});

Deno.test('no new cities for the month: the section is omitted rather than invented', () => {
  const text = visibleText(buildRecapEmailHtml(baseData({ newCities: [] })));
  assert(!text.includes('CheckOff grew'));
});

Deno.test('neutral regional copy: Arizona, Europe and unknown all close the same way', () => {
  for (const metro of ['Phoenix Metro', 'Munich Metro', 'Vienna Metro', 'Amalfi Coast', null]) {
    const text = visibleText(buildRecapEmailHtml(baseData({ metroName: metro })));
    assert(text.includes('Fall is a great time to get out and check something off.'));
  }
});

Deno.test('social: only supplied official links render, empty means no social section', () => {
  const withIg = buildRecapEmailHtml(baseData());
  assert(withIg.includes('Follow CheckOff') && withIg.includes('href="https://example.com/ig"'));
  assert(!/TikTok|Facebook/i.test(withIg));
  assert(!buildRecapEmailHtml(baseData({ socialLinks: [] })).includes('Follow CheckOff'));
});

Deno.test('app update block: general copy, platform aware, no feature promise', () => {
  const both = visibleText(buildRecapEmailHtml(baseData({ platform: null })));
  assert(both.includes('Update CheckOff') && both.includes('App Store') && both.includes('Google Play'));
  assert(!/Android|iPhone/i.test(both));
  const ios = buildRecapEmailHtml(baseData({ platform: 'ios' }));
  assert(ios.includes('appstore') && !ios.includes('example.com/play'));
});

Deno.test('unsubscribe link is present and goes to the supplied tracked URL', () => {
  const html = buildRecapEmailHtml(baseData());
  assert(html.includes('href="https://example.com/unsub"'));
  assert(visibleText(html).includes('Unsubscribe'));
});

Deno.test('HTML escaping: hostile display name, item and list text cannot inject markup', () => {
  const html = buildRecapEmailHtml(baseData({
    firstName: '<script>alert(1)</script>',
    completedNames: ['<img src=x onerror=alert(1)>'],
    recommendations: [{ id: 'a', body: '<b>bold</b>', difficulty: 1, url: 'https://example.com/r1', role: 'easy_next' }],
  }));
  assert(!html.includes('<script>alert'));
  assert(!html.includes('<img src=x'));
  assert(html.includes('&lt;script&gt;'));
});

Deno.test('missing first name renders cleanly with no stray punctuation', () => {
  const text = visibleText(buildRecapEmailHtml(baseData({ firstName: null })));
  assert(text.includes('Look what you checked off in September.'));
  assert(!/, look|^,/.test(text.slice(0, 200)));
});

Deno.test('preview text is hidden, per variant, and matches the subject month', () => {
  for (const [, d] of VARIANTS) {
    const html = buildRecapEmailHtml(d);
    assert(html.includes(d.previewText));
  }
  assert(subjectFor('ACTIVE_MONTH', 'Jamie', { monthLabel: 'September' }).includes('September'));
});
