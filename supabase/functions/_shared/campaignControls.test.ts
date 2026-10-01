// Run with: deno test supabase/functions/_shared/campaignControls.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  authorizeRequest, validateRequestBody, checkProductionSend, preflightEligible, isApprovedTestRecipient,
  approvedTestRecipients, timingSafeEqual, TEST_VARIANTS,
} from './campaignControls.ts';

const ENV = { serviceRoleKey: 'service-role-secret-value', campaignSecret: 'campaign-admin-secret-0123456789abcdef' };
const ANON = 'public-anon-key-value';
const h = (o: Record<string, string>) => new Headers(o);

Deno.test('authorize: missing authorization is 401', () => {
  const r = authorizeRequest(h({}), ENV);
  assertEquals(r.ok, false);
  assertEquals((r as any).status, 401);
});

Deno.test('authorize: the public anon key is 403, with or without an apikey header', () => {
  for (const headers of [{ authorization: `Bearer ${ANON}` }, { authorization: `Bearer ${ANON}`, apikey: ANON }, { apikey: ANON, authorization: `bearer ${ANON}` }]) {
    const r = authorizeRequest(h(headers), ENV);
    assertEquals(r.ok, false);
    assertEquals((r as any).status, 403);
  }
});

Deno.test('authorize: invalid or malformed credentials are 403', () => {
  for (const headers of [
    { authorization: 'Bearer wrong' }, { authorization: 'Basic abc' }, { authorization: 'Bearer ' },
    { 'x-campaign-secret': 'wrong' }, { authorization: `Bearer ${ANON}`, 'x-campaign-secret': 'nope' },
  ]) {
    const r = authorizeRequest(h(headers), ENV);
    assertEquals(r.ok, false, JSON.stringify(headers));
  }
});

Deno.test('authorize: service role bearer and the admin secret are accepted', () => {
  assertEquals(authorizeRequest(h({ authorization: `Bearer ${ENV.serviceRoleKey}` }), ENV), { ok: true, via: 'service_role' });
  assertEquals(authorizeRequest(h({ authorization: `Bearer ${ANON}`, 'x-campaign-secret': ENV.campaignSecret }), ENV), { ok: true, via: 'campaign_secret' });
});

Deno.test('authorize: the service key is also accepted as the apikey header; the anon key as apikey is not', () => {
  assertEquals(authorizeRequest(h({ authorization: `Bearer ${ANON}`, apikey: ENV.serviceRoleKey }), ENV), { ok: true, via: 'service_role' });
  assertEquals(authorizeRequest(h({ authorization: `Bearer ${ANON}`, apikey: ANON }), ENV).ok, false);
  assertEquals(authorizeRequest(h({ apikey: ENV.serviceRoleKey }), ENV).ok, false); // an apikey alone, with no authorization header, is still missing authorization
});

Deno.test('authorize: the shared ADMIN_SECRET header and short campaign secrets are never accepted', () => {
  assertEquals(authorizeRequest(h({ authorization: `Bearer ${ANON}`, 'x-admin-secret': 'checkoff-admin-2026' }), { ...ENV }).ok, false);
  const weak = { serviceRoleKey: ENV.serviceRoleKey, campaignSecret: 'short-secret' };
  assertEquals(authorizeRequest(h({ authorization: `Bearer ${ANON}`, 'x-campaign-secret': 'short-secret' }), weak).ok, false);
});

Deno.test('authorize: unset server secrets can never be matched by an empty header', () => {
  assertEquals(authorizeRequest(h({ authorization: 'Bearer ' }), { serviceRoleKey: '', campaignSecret: '' }).ok, false);
  assertEquals(authorizeRequest(h({ 'x-campaign-secret': '' , authorization: 'Bearer x' }), { serviceRoleKey: undefined, campaignSecret: undefined }).ok, false);
});

Deno.test('timingSafeEqual: equal, unequal and different lengths', () => {
  assert(timingSafeEqual('abc', 'abc'));
  assert(!timingSafeEqual('abc', 'abd'));
  assert(!timingSafeEqual('abc', 'abcd'));
  assert(!timingSafeEqual('', 'a'));
});

Deno.test('validate: empty body, missing month, bad month, missing mode, bad mode are all rejected', () => {
  for (const bad of [undefined, null, {}, [], 'x', { mode: 'preview' }, { month: '2026-09' }, { month: '2026-9', mode: 'preview' },
    { month: '2026-13', mode: 'preview' }, { month: 'September', mode: 'preview' }, { month: '2026-09', mode: 'nuke' },
    { month: '2026-09', mode: '' }, { month: 202609, mode: 'preview' }]) {
    const r = validateRequestBody(bad);
    assertEquals(r.ok, false, JSON.stringify(bad));
    assertEquals((r as any).status, 400);
  }
});

Deno.test('validate: dry_run is never implicit and all four modes validate', () => {
  assertEquals(validateRequestBody({ month: '2026-09' }).ok, false);
  for (const mode of ['preview', 'dry_run', 'test_send', 'send']) {
    const r = validateRequestBody({ month: '2026-09', mode });
    assertEquals(r.ok, true);
  }
});

Deno.test('production send: testEmailOverride is refused outright, even with the gate on', () => {
  const r = checkProductionSend({ testEmailOverride: 'a@b.co', confirmEligibleCount: 1 }, '2026-09', { productionGate: 'true' }, new Date('2026-10-02T00:00:00Z'));
  assertEquals(r.ok, false);
  assertEquals((r as any).status, 400);
});

Deno.test('production send: gate absent, false, or anything but exactly "true" is refused', () => {
  for (const gate of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
    const r = checkProductionSend({ confirmEligibleCount: 1 }, '2026-09', { productionGate: gate }, new Date('2026-10-02T00:00:00Z'));
    assertEquals(r.ok, false, String(gate));
    assertEquals((r as any).status, 403);
  }
});

Deno.test('production send: an open month is refused, and a human confirmed count is required', () => {
  const open = checkProductionSend({ confirmEligibleCount: 1 }, '2026-09', { productionGate: 'true' }, new Date('2026-09-30T12:00:00Z'));
  assertEquals((open as any).status, 409);
  const noCount = checkProductionSend({}, '2026-09', { productionGate: 'true' }, new Date('2026-10-02T00:00:00Z'));
  assertEquals((noCount as any).status, 400);
  assertEquals(checkProductionSend({ confirmEligibleCount: 123 }, '2026-09', { productionGate: 'true' }, new Date('2026-10-02T00:00:00Z')).ok, true);
});

Deno.test('preflight: duplicate emails, duplicate users and invalid emails are blockers', () => {
  assertEquals(preflightEligible([{ user_id: '1', email: 'a@x.co' }, { user_id: '2', email: 'b@x.co' }]).ok, true);
  const dup = preflightEligible([{ user_id: '1', email: 'a@x.co' }, { user_id: '2', email: 'A@X.co ' }]);
  assertEquals(dup.ok, false);
  assert(dup.problems[0].includes('duplicate recipient email'));
  assertEquals(preflightEligible([{ user_id: '1', email: 'a@x.co' }, { user_id: '1', email: 'c@x.co' }]).ok, false);
  assertEquals(preflightEligible([{ user_id: '1', email: 'not an email' }]).ok, false);
});

Deno.test('test recipients: only the approved address, case insensitive, extras only add', () => {
  assert(isApprovedTestRecipient('jerrystuckart@gmail.com'));
  assert(isApprovedTestRecipient(' JerryStuckart@Gmail.com '));
  assert(!isApprovedTestRecipient('someone@else.com'));
  assert(!isApprovedTestRecipient(undefined));
  assert(!isApprovedTestRecipient(['jerrystuckart@gmail.com']));
  assert(isApprovedTestRecipient('x@y.co', 'x@y.co, z@y.co'));
  assert(approvedTestRecipients('x@y.co').includes('jerrystuckart@gmail.com'));
});

Deno.test('five presentation variants are all test sendable', () => {
  assertEquals([...TEST_VARIANTS], ['ACTIVE_MONTH', 'FALL_CONTINUATION', 'RETURNING_INACTIVE', 'NEVER_CHECKED_OFF', 'NEVER_CHECKED_OFF_UNKNOWN']);
});
