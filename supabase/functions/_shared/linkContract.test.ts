// Parity between the app's contract (lib/emailLinkContract.js, the source of truth) and the server mirror
// (linkContract.ts). Run with: deno test --allow-read supabase/functions/_shared/linkContract.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
// @ts-ignore: plain JS module from the app
import * as app from '../../../lib/emailLinkContract.js';
import * as srv from './linkContract.ts';

const ID = '2f6c0f6e-8a4b-4c8e-9a53-0b4a1d9e7c11';

Deno.test('builders are identical in the app and on the server', () => {
  assertEquals(srv.homeUrl(), app.homeUrl());
  assertEquals(srv.itemUrl(ID), app.itemUrl(ID));
  assertEquals(srv.listUrl(ID), app.listUrl(ID));
  for (const slug of ['phoenix', 'amalfi-coast', 'vienna_austria', 'green-bay', 'san-diego']) assertEquals(srv.metroUrl(slug), app.metroUrl(slug));
});

Deno.test('parsing is identical for every accepted and rejected form', () => {
  const inputs = [
    srv.homeUrl(), srv.itemUrl(ID), srv.listUrl(ID), srv.metroUrl('amalfi-coast'),
    `https://getcheckoff.com/item?id=${ID}`, `https://getcheckoff.com/list/${ID}`, 'https://getcheckoff.com/metro/florence',
    `checkoff://item/${ID}`, `checkoff://item?id=${ID}`, `checkoff://list?id=${ID}`, 'checkoff://metro?slug=munich', 'checkoff://home',
    'https://getcheckoff.com/item/nope', 'https://getcheckoff.com/list?id=1', 'https://getcheckoff.com/metro?slug=../x',
    'https://evil.example/item/' + ID, 'http://getcheckoff.com/open', 'javascript:alert(1)', '', 'https://getcheckoff.com/unknown',
  ];
  for (const input of inputs) {
    const a = app.parseEmailLink(input);
    const s = srv.parseDestination(input);
    assertEquals(s.type, a.type, input);
    if (a.type === 'item' || a.type === 'list') assertEquals((s as any).id, a.id, input);
    if (a.type === 'metro') assertEquals((s as any).slug, a.slug, input);
  }
});

Deno.test('validators agree and builders refuse bad input', () => {
  for (const v of [ID, ID.toUpperCase(), 'x', '', null, undefined, '2f6c0f6e8a4b4c8e9a530b4a1d9e7c11']) assertEquals(srv.isUuid(v), app.isUuid(v));
  for (const v of ['phoenix', 'a', 'a b', 'vienna_austria', '../x', 'AMALFI-COAST']) assertEquals(srv.isMetroSlug(v), app.isMetroSlug(v));
  for (const bad of ['nope', '', 'x']) { let t = false; try { srv.itemUrl(bad); } catch { t = true; } assert(t); }
});
