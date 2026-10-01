// Run with: deno test supabase/functions/_shared/campaignContent.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  selectLiveCities, newCitiesForMonth, isLiveCity, MIN_ITEMS_FOR_LIVE_CITY, OFFICIAL_SOCIAL_LINKS, type CityRow,
} from './campaignContent.ts';

const row = (slug: string, name: string, over: Partial<CityRow> = {}): CityRow => ({
  metro_id: slug, name, slug, created_at: '2026-09-01T00:00:00Z', active_items: 100, public_official_lists: 3,
  season_list_id: null, season_name: null, destination_list_id: `list-${slug}`, destination_list_title: 'A list', ...over,
});

const TEN = [
  row('phoenix', 'Phoenix Metro'), row('milwaukee', 'Milwaukee Metro'), row('tucson', 'Tucson Metro'), row('denver', 'Denver Metro'),
  row('san-diego', 'San Diego Metro'), row('vienna_austria', 'Vienna Metro'), row('green-bay', 'Green Bay Metro'),
  row('florence', 'Florence Metro'), row('munich', 'Munich Metro'), row('amalfi-coast', 'Amalfi Coast', { active_items: 61, public_official_lists: 2 }),
];

Deno.test('ten live metros are counted as ten, from data', () => {
  assertEquals(selectLiveCities(TEN).length, 10);
});

Deno.test('a metro without meaningful approved content is not announced as live', () => {
  const rows = [...TEN, row('naples', 'Naples Metro', { active_items: 3 }), row('staged', 'Staged Metro', { public_official_lists: 0 }), row('nodest', 'No Dest Metro', { destination_list_id: null })];
  const live = selectLiveCities(rows);
  assertEquals(live.length, 10);
  assert(!live.some((c) => ['naples', 'staged', 'nodest'].includes(c.slug)));
  assert(!isLiveCity(row('x', 'X', { active_items: MIN_ITEMS_FOR_LIVE_CITY - 1 })));
  assert(isLiveCity(row('x', 'X', { active_items: MIN_ITEMS_FOR_LIVE_CITY })));
});

Deno.test('September additions are the six named metros, and only while they are still live', () => {
  const live = selectLiveCities(TEN);
  assertEquals(newCitiesForMonth('2026-09', live).map((c) => c.slug).sort(),
    ['amalfi-coast', 'florence', 'green-bay', 'munich', 'san-diego', 'vienna_austria']);
  const withoutMunich = selectLiveCities(TEN.filter((c) => c.slug !== 'munich'));
  assertEquals(newCitiesForMonth('2026-09', withoutMunich).length, 5);
});

Deno.test('destinations that are not metros never appear as cities; unknown months announce nothing', () => {
  const live = selectLiveCities(TEN);
  assert(!live.some((c) => /positano|willcox|boulder|longmont/i.test(c.name + c.slug)));
  assertEquals(newCitiesForMonth('2026-10', live), []);
  assertEquals(newCitiesForMonth('2026-08', live), []);
});

Deno.test('social links: only the verified Instagram profile, nothing invented', () => {
  assertEquals(OFFICIAL_SOCIAL_LINKS, [{ label: 'Instagram', url: 'https://www.instagram.com/checkoff.app/' }]);
  assert(!JSON.stringify(OFFICIAL_SOCIAL_LINKS).match(/tiktok|facebook/i));
});
