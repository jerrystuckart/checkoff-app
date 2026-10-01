// Caller authorization and request validation for send-recap-campaign. Pure functions, no network.
//
// Threat being closed: the public anon key (shipped inside the app) used to pass the Supabase gateway
// and reach every mode of this function. Every operational mode now requires one of two server side
// credentials that never appear in the app, the website, or the repository:
//   1. SUPABASE_SERVICE_ROLE_KEY, sent as Authorization: Bearer or as the apikey header
//      (server to server; with the newer key system the function's key can be an sb_secret_ value,
//      which cannot be a gateway bearer, so the apikey header is accepted too)
//   2. x-campaign-secret: <CAMPAIGN_ADMIN_SECRET>              (dedicated to this campaign; must be at
//                                                               least 24 characters, shorter values are
//                                                               treated as unset. The shared ADMIN_SECRET
//                                                               is deliberately NOT accepted here.)
// Authorization is decided BEFORE the body is read, before any database client is created, and
// before any audience data, HTML, signed token, database write or Resend call can happen.

import { MONTH_FORMAT, isMonthClosed } from './campaignLogic.ts';

export const MIN_CAMPAIGN_SECRET_LENGTH = 24;

export type AuthResult = { ok: true; via: 'service_role' | 'campaign_secret' } | { ok: false; status: 401 | 403; error: string };

// Constant time comparison that does not leak length through early exit on the common prefix.
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function authorizeRequest(
  headers: Headers,
  env: { serviceRoleKey?: string; campaignSecret?: string },
): AuthResult {
  const authHeader = headers.get('authorization') ?? '';
  const adminHeader = headers.get('x-campaign-secret') ?? '';
  const apikeyHeader = (headers.get('apikey') ?? '').trim();
  if (!authHeader && !adminHeader) {
    return { ok: false, status: 401, error: 'Missing authorization' };
  }

  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim() ?? '';
  if (env.serviceRoleKey) {
    if (bearer && timingSafeEqual(bearer, env.serviceRoleKey)) return { ok: true, via: 'service_role' };
    if (apikeyHeader && timingSafeEqual(apikeyHeader, env.serviceRoleKey)) return { ok: true, via: 'service_role' };
  }
  if (adminHeader && env.campaignSecret && env.campaignSecret.length >= MIN_CAMPAIGN_SECRET_LENGTH
      && timingSafeEqual(adminHeader, env.campaignSecret)) {
    return { ok: true, via: 'campaign_secret' };
  }
  // Present but wrong: this includes the public anon key.
  return { ok: false, status: 403, error: 'Forbidden' };
}

export const MODES = ['preview', 'dry_run', 'test_send', 'send'] as const;
export type Mode = typeof MODES[number];

export const TEST_VARIANTS = [
  'ACTIVE_MONTH', 'FALL_CONTINUATION', 'RETURNING_INACTIVE', 'NEVER_CHECKED_OFF', 'NEVER_CHECKED_OFF_UNKNOWN',
] as const;
export type TestVariant = typeof TEST_VARIANTS[number];

// Test mail may only go to explicitly approved addresses. CAMPAIGN_TEST_RECIPIENTS (comma separated)
// can add more without a code change; it can never remove these.
export const APPROVED_TEST_RECIPIENTS = ['jerrystuckart@gmail.com'];

export function approvedTestRecipients(extraEnv?: string): string[] {
  const extra = (extraEnv || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...APPROVED_TEST_RECIPIENTS, ...extra])];
}

export function isApprovedTestRecipient(address: unknown, extraEnv?: string): boolean {
  if (typeof address !== 'string') return false;
  return approvedTestRecipients(extraEnv).includes(address.trim().toLowerCase());
}

export type ValidatedBody =
  | { ok: true; month: string; mode: Mode; body: Record<string, unknown> }
  | { ok: false; status: 400; error: string };

// No defaults: an empty body, a missing month, a malformed month or an unknown mode is a validation
// error and does nothing.
export function validateRequestBody(raw: unknown): ValidatedBody {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'Request body must be a JSON object with month and mode.' };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.month !== 'string' || !body.month) {
    return { ok: false, status: 400, error: 'month is required (YYYY-MM).' };
  }
  if (!MONTH_FORMAT.test(body.month)) {
    return { ok: false, status: 400, error: 'month must be formatted YYYY-MM.' };
  }
  if (typeof body.mode !== 'string' || !body.mode) {
    return { ok: false, status: 400, error: `mode is required (${MODES.join(', ')}).` };
  }
  if (!(MODES as readonly string[]).includes(body.mode)) {
    return { ok: false, status: 400, error: `Unknown mode. Use one of: ${MODES.join(', ')}.` };
  }
  return { ok: true, month: body.month, mode: body.mode as Mode, body };
}

export type GateResult = { ok: true } | { ok: false; status: 400 | 403 | 409; error: string };

// Everything mode "send" requires before it may touch a single recipient.
export function checkProductionSend(
  body: Record<string, unknown>,
  month: string,
  env: { productionGate?: string },
  now: Date = new Date(),
): GateResult {
  if (body.testEmailOverride !== undefined) {
    return { ok: false, status: 400, error: 'testEmailOverride is not accepted in send mode. Use mode "test_send".' };
  }
  if (env.productionGate !== 'true') {
    return { ok: false, status: 403, error: 'Production send is disabled (CAMPAIGN_ALLOW_PRODUCTION_SEND is not "true").' };
  }
  if (!isMonthClosed(month, now)) {
    return { ok: false, status: 409, error: `Month ${month} has not closed yet.` };
  }
  const expected = body.confirmEligibleCount;
  if (!Number.isInteger(expected)) {
    return { ok: false, status: 400, error: 'confirmEligibleCount (the exact eligible recipient count a human approved) is required.' };
  }
  return { ok: true };
}

// Preflight over the eligible rows. Any duplicate or malformed address is a blocker, not a warning.
export function preflightEligible(rows: { user_id: string; email: string }[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const seenEmail = new Set<string>();
  const seenUser = new Set<string>();
  let dupEmails = 0, dupUsers = 0, invalid = 0;
  for (const r of rows) {
    const e = (r.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) invalid++;
    if (seenEmail.has(e)) dupEmails++; else seenEmail.add(e);
    if (seenUser.has(r.user_id)) dupUsers++; else seenUser.add(r.user_id);
  }
  if (dupEmails) problems.push(`${dupEmails} duplicate recipient email address(es)`);
  if (dupUsers) problems.push(`${dupUsers} duplicate user row(s)`);
  if (invalid) problems.push(`${invalid} invalid email address(es)`);
  return { ok: problems.length === 0, problems };
}
