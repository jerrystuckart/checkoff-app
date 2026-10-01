// Monthly CheckOff recap campaign: request handler.
//
// Operational modes (all require server side authorization, see _shared/campaignControls.ts):
//   preview    render HTML (one real audience row, all segments, or identity free synthetic variants)
//   dry_run    count the audience and log campaign_sends rows with status 'dry_run' (writes!)
//   test_send  deliver the five presentation variants to ONE approved address, from synthetic rows,
//              under the isolated campaign id `<campaignId>_test`. Never touches real recipients.
//   send       production delivery. Requires CAMPAIGN_ALLOW_PRODUCTION_SEND=true, a closed month,
//              a human confirmed eligible count, and a clean preflight. Each recipient is CLAIMED
//              (campaign_sends status 'sending', unique per campaign and user) before Resend is called,
//              so a retry can never email anyone twice.
//
// There are no defaults: month and mode are required, an empty body is rejected, and an unknown mode
// is rejected. Authorization happens before the body is read or any database client is created.

import { monthBounds, monthLabelFor, testSendSubject } from '../_shared/campaignLogic.ts';
import { buildRecapEmailHtml } from '../_shared/campaignTemplate.ts';
import { linkSecretFrom } from '../_shared/linkSigning.ts';
import {
  authorizeRequest, validateRequestBody, checkProductionSend, preflightEligible,
  isApprovedTestRecipient, TEST_VARIANTS, type TestVariant,
} from '../_shared/campaignControls.ts';
import { buildEmailData, buildSyntheticRow, type AudienceRow, type CampaignContext } from '../_shared/campaignEmail.ts';
import type { CityRow } from '../_shared/campaignContent.ts';

export const TEMPLATE_VERSION = 'v2';
const FROM_ADDRESS = 'CheckOff <hello@getcheckoff.com>';

export type Deps = {
  env: (name: string) => string | undefined;
  getSupabase: () => any;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret',
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function summarizeAudience(rows: AudienceRow[]) {
  const bySegment: Record<string, number> = {};
  const byExclusionReason: Record<string, number> = {};
  const byMetro: Record<string, number> = {};
  let knownMetro = 0, unknownMetro = 0, personalized = 0, discovery = 0, missing = 0;
  for (const r of rows) {
    bySegment[r.segment] = (bySegment[r.segment] || 0) + 1;
    if (r.segment === 'EXCLUDED') {
      const reason = r.exclusion_reason || 'unknown';
      byExclusionReason[reason] = (byExclusionReason[reason] || 0) + 1;
      continue;
    }
    if (r.metro_name) byMetro[r.metro_name] = (byMetro[r.metro_name] || 0) + 1;
    if (r.metro_source === 'unknown') unknownMetro++; else knownMetro++;
    if ((r.recommended_items || []).length > 0) personalized++;
    else if (r.segment === 'NEVER_CHECKED_OFF' && r.metro_source === 'unknown') discovery++;
    else missing++;
  }
  const eligible = rows.filter((r) => r.segment !== 'EXCLUDED');
  return {
    total: rows.length, eligible: eligible.length, excluded: rows.length - eligible.length,
    bySegment, byExclusionReason, byMetro, knownMetro, unknownMetro,
    personalizedRecommendations: personalized, genericDiscovery: discovery, missingRecommendations: missing,
    preflight: preflightEligible(eligible),
  };
}

function listUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

async function resendSend(
  deps: Deps, key: string, payload: Record<string, unknown>, idempotencyKey?: string,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await deps.fetch('https://api.resend.com/emails', { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: (err as any).message || res.statusText || `HTTP ${res.status}` };
  }
  const j = await res.json().catch(() => ({}));
  return { ok: true, id: (j as any).id || null };
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  // 1. Authorization first. Nothing below runs, reads or writes without it.
  const auth = authorizeRequest(req.headers, {
    serviceRoleKey: deps.env('SUPABASE_SERVICE_ROLE_KEY'),
    adminSecret: deps.env('ADMIN_SECRET'),
  });
  if (auth.ok === false) return json({ error: auth.error }, auth.status);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // 2. Strict validation, no defaults.
    const raw = await req.json().catch(() => null);
    const v = validateRequestBody(raw);
    if (v.ok === false) return json({ error: v.error }, v.status);
    const { month, mode, body } = v;

    // 3. Mode specific gates that must hold before any data is read.
    if (mode === 'send') {
      const gate = checkProductionSend(body, month, { productionGate: deps.env('CAMPAIGN_ALLOW_PRODUCTION_SEND') }, deps.now());
      if (gate.ok === false) return json({ error: gate.error }, gate.status);
    }
    if (mode === 'test_send' && !isApprovedTestRecipient(body.testEmailOverride, deps.env('CAMPAIGN_TEST_RECIPIENTS'))) {
      return json({ error: 'test_send requires testEmailOverride set to an approved test address.' }, 400);
    }

    const supabase = deps.getSupabase();
    const supabaseUrl = deps.env('SUPABASE_URL')!;
    const functionsBaseUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1`;
    const campaignId = `recap_${month}`;
    const { start, end } = monthBounds(month);
    const monthLabel = monthLabelFor(month);

    const { data: audience, error: audienceError } = await supabase.rpc('get_recap_campaign_audience', { p_month_start: start, p_month_end: end });
    if (audienceError) throw audienceError;
    const rows: AudienceRow[] = audience || [];
    const summary = summarizeAudience(rows);

    const { data: cityData, error: cityError } = await supabase.rpc('get_recap_campaign_cities', { p_as_of: end });
    if (cityError) throw cityError;
    const ctx: CampaignContext = { supabase, functionsBaseUrl, secret: linkSecretFrom(deps.env), campaignId, month, cities: (cityData || []) as CityRow[] };

    // ── dry_run ────────────────────────────────────────────────────────────
    if (mode === 'dry_run') {
      const eligible = rows.filter((r) => r.segment !== 'EXCLUDED');
      const logRows = eligible.map((r) => ({
        campaign_id: campaignId, campaign_month: start, user_id: r.user_id, segment: r.segment,
        template_version: TEMPLATE_VERSION, subject: null, status: 'dry_run', is_test_send: true,
      }));
      let logged = 0;
      if (logRows.length) {
        const { error } = await supabase.from('campaign_sends').insert(logRows);
        if (error) console.error('dry_run log insert failed:', error.message); else logged = logRows.length;
      }
      return json({ mode, month, campaignId, summary, logged });
    }

    // ── preview ────────────────────────────────────────────────────────────
    if (mode === 'preview') {
      let targets: AudienceRow[] = [];
      if (body.previewSynthetic === true) {
        const testUserId = String(body.testUserId || '00000000-0000-0000-0000-000000000000');
        targets = await Promise.all(TEST_VARIANTS.map((vv) => buildSyntheticRow(ctx, vv, testUserId)));
      } else if (typeof body.previewUserId === 'string') {
        targets = rows.filter((r) => r.user_id === body.previewUserId);
        if (!targets.length) return json({ error: 'user not in audience' }, 404);
      } else if (body.previewAllSegments === true) {
        for (const seg of ['ACTIVE_MONTH', 'FALL_CONTINUATION', 'RETURNING_INACTIVE'] as const) {
          const f = rows.find((r) => r.segment === seg); if (f) targets.push(f);
        }
        const nu = rows.find((r) => r.segment === 'NEVER_CHECKED_OFF' && r.metro_source === 'unknown'); if (nu) targets.push(nu);
        const nk = rows.find((r) => r.segment === 'NEVER_CHECKED_OFF' && r.metro_source !== 'unknown'); if (nk) targets.push(nk);
      } else {
        return json({ error: 'preview needs previewSynthetic, previewUserId or previewAllSegments' }, 400);
      }
      const previews = await Promise.all(targets.map(async (row) => {
        const built = await buildEmailData(ctx, row, campaignId);
        return {
          segment: row.segment, metroSource: row.metro_source, subject: built.subject,
          previewText: built.data.previewText, html: buildRecapEmailHtml(built.data),
        };
      }));
      return json({ mode, month, campaignId, previews });
    }

    // ── test_send ──────────────────────────────────────────────────────────
    if (mode === 'test_send') {
      const RESEND_KEY = deps.env('RESEND_API_KEY');
      if (!RESEND_KEY) throw new Error('RESEND_API_KEY secret not set');
      const to = String(body.testEmailOverride).trim();

      // The identity used in links must be an internal or suppressed test account, never a recipient.
      const testUserId = body.testUserId;
      if (typeof testUserId !== 'string' || !/^[0-9a-f-]{36}$/i.test(testUserId)) {
        return json({ error: 'test_send requires testUserId (an internal or suppressed test account).' }, 400);
      }
      const { data: acct, error: acctErr } = await supabase.from('users').select('id, email').eq('id', testUserId).maybeSingle();
      if (acctErr || !acct) return json({ error: 'testUserId not found.' }, 400);
      const domain = String(acct.email || '').split('@')[1]?.toLowerCase() || '';
      const internal = domain === 'getcheckoff.com' || domain.endsWith('.getcheckoff.com');
      const { data: sup } = await supabase.from('campaign_suppressions').select('user_id').eq('user_id', testUserId).maybeSingle();
      if (!internal && !sup) return json({ error: 'testUserId must be an internal or suppressed test account.' }, 400);

      const requested: TestVariant[] = Array.isArray(body.variants) && body.variants.length
        ? (body.variants as string[]).filter((x): x is TestVariant => (TEST_VARIANTS as readonly string[]).includes(x))
        : [...TEST_VARIANTS];
      if (!requested.length) return json({ error: 'No valid variants requested.' }, 400);

      const testCampaignId = `${campaignId}_test`;
      const results: Record<string, unknown>[] = [];
      let accepted = 0, failed = 0;
      for (const variant of requested) {
        try {
          const row = await buildSyntheticRow(ctx, variant, testUserId);
          const built = await buildEmailData(ctx, row, testCampaignId);
          const html = buildRecapEmailHtml(built.data);
          const subject = testSendSubject(variant, built.subject);
          const r = await resendSend(deps, RESEND_KEY, {
            from: FROM_ADDRESS, to: [to], subject, html, headers: listUnsubscribeHeaders(built.data.unsubscribeUrl),
          });
          if (r.ok === false) throw new Error(r.error);
          const { error: logErr } = await supabase.from('campaign_sends').insert({
            campaign_id: testCampaignId, campaign_month: start, user_id: testUserId, segment: row.segment,
            template_version: TEMPLATE_VERSION, subject, recommendation_ids: built.recommendationIds,
            rendered_snapshot: { variant, synthetic: true }, status: 'sent', resend_message_id: r.id,
            is_test_send: true, sent_at: deps.now().toISOString(),
          });
          accepted++;
          results.push({ variant, subject, acceptedByResend: true, resendMessageId: r.id, logged: !logErr });
        } catch (e) {
          failed++;
          results.push({ variant, acceptedByResend: false, error: (e as Error).message });
        }
        await deps.sleep(600);
      }
      return json({ mode, month, testCampaignId, accepted, failed, results });
    }

    // ── send (production) ──────────────────────────────────────────────────
    // mode is 'send' here. Gate checks already passed.
    if (!summary.preflight.ok) {
      return json({ error: 'Preflight failed', problems: summary.preflight.problems }, 409);
    }
    if (body.confirmEligibleCount !== summary.eligible) {
      return json({ error: `confirmEligibleCount ${String(body.confirmEligibleCount)} does not match the current eligible count ${summary.eligible}.` }, 409);
    }
    const RESEND_KEY = deps.env('RESEND_API_KEY');
    if (!RESEND_KEY) throw new Error('RESEND_API_KEY secret not set');

    let eligible = rows.filter((r) => r.segment !== 'EXCLUDED');
    if (body.limit !== undefined) {
      const n = Number(body.limit);
      if (!Number.isInteger(n) || n < 1) return json({ error: 'limit must be a positive integer.' }, 400);
      eligible = eligible.slice(0, n);
    }

    let sent = 0, failed = 0, skippedAlreadyClaimed = 0, recordingProblems = 0;
    for (const row of eligible) {
      // Build first: if rendering fails nothing has been claimed or sent.
      let built: Awaited<ReturnType<typeof buildEmailData>>;
      let html: string;
      try {
        built = await buildEmailData(ctx, row, campaignId);
        html = buildRecapEmailHtml(built.data);
      } catch (e) {
        failed++; console.error('render failed, not sending:', (e as Error).message); continue;
      }

      // CLAIM before Resend. The unique index campaign_sends_unique_live_claim allows one 'sending' or
      // 'sent' row per (campaign, user), so a second run cannot claim this recipient again.
      const { data: claim, error: claimErr } = await supabase.from('campaign_sends').insert({
        campaign_id: campaignId, campaign_month: start, user_id: row.user_id, segment: row.segment,
        template_version: TEMPLATE_VERSION, status: 'sending', is_test_send: false,
      }).select('id').single();
      if (claimErr) {
        if ((claimErr as any).code === '23505') { skippedAlreadyClaimed++; continue; }
        failed++; console.error('claim failed, not sending:', claimErr.message); continue;
      }

      try {
        const r = await resendSend(deps, RESEND_KEY, {
          from: FROM_ADDRESS, to: [row.email], subject: built.subject, html, headers: listUnsubscribeHeaders(built.data.unsubscribeUrl),
        }, `${campaignId}:${row.user_id}`);
        if (r.ok === false) {
          // Resend rejected it: nothing was sent. 'failed' frees the claim so a retry can try again.
          const { error } = await supabase.from('campaign_sends').update({ status: 'failed', failure_reason: r.error, updated_at: deps.now().toISOString() }).eq('id', claim.id);
          if (error) recordingProblems++; // row stays 'sending' and blocks a retry until reconciled
          failed++;
        } else {
          const { error } = await supabase.from('campaign_sends').update({
            status: 'sent', resend_message_id: r.id, subject: built.subject, recommendation_ids: built.recommendationIds,
            rendered_snapshot: { checkins_this_month: row.checkins_this_month, season_name: row.season_name, metro_name: row.metro_name },
            sent_at: deps.now().toISOString(), updated_at: deps.now().toISOString(),
          }).eq('id', claim.id);
          // If this update fails the row stays 'sending', which still blocks a duplicate on retry.
          if (error) { recordingProblems++; console.error('Resend accepted but recording failed; claim left as sending'); }
          sent++;
        }
      } catch (e) {
        // Outcome unknown (for example a network error after the request left): leave the claim as
        // 'sending' so a retry cannot duplicate. A human reconciles with Resend.
        recordingProblems++; failed++;
        console.error('send outcome unknown; claim left as sending:', (e as Error).message);
      }
      await deps.sleep(250);
    }
    return json({ mode, month, campaignId, attempted: eligible.length, sent, failed, skippedAlreadyClaimed, recordingProblems });
  } catch (e) {
    console.error('send-recap-campaign error:', (e as Error).message);
    return json({ error: 'Internal error' }, 500);
  }
}
