// September 1 "Your August Monthly CheckOff Recap" campaign.
//
// Extends (does not replace) the July 8 email-automation system: reuses
// get_recap_campaign_audience() (calendar-month, 4-segment version of
// get_monthly_recap_users/get_inactive_users/get_never_checkin_users),
// the same Resend integration pattern as send-monthly-recap, and the same
// campaign-link click-attribution endpoint for unsubscribe + clicks.
//
// SAFETY: mode:'send' without testEmailOverride is refused unless the
// CAMPAIGN_ALLOW_PRODUCTION_SEND env var is explicitly set to 'true' on the
// deployed function — it is intentionally NOT set as of this build. This
// keeps a production send a config change Jerry makes deliberately, not
// something reachable by calling this endpoint as deployed today.
//
// Modes:
//   dry_run  — build the full audience, return counts/segments/exclusions,
//              sends nothing, writes campaign_sends rows with status='dry_run'
//   preview  — render HTML for one user (previewUserId) or one representative
//              per segment (previewAllSegments:true); sends nothing
//   send     — batch-send. Idempotent: campaign_sends has a unique index on
//              (campaign_id, user_id) where status='sent' AND is_test_send=false,
//              so re-running after a partial failure only retries rows that
//              don't already have a successful send logged.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  monthBounds, firstName, subjectFor, PREVIEW_TEXT, daysRemaining, testSendSubject,
  assignRecommendationRoles, selectSinceLastActivityUpdates, metroSlug, selectThemedLists,
  type Segment, type RawRecommendation, type MetroSource,
} from '../_shared/campaignLogic.ts';
import { buildRecapEmailHtml, type RecapEmailData, type ThemedListLink } from '../_shared/campaignTemplate.ts';
import { getLinkSecret, signToken } from '../_shared/linkSigning.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TEMPLATE_VERSION = 'v1';

type AudienceRow = {
  user_id: string; email: string; display_name: string | null; platform: string | null;
  segment: Segment; exclusion_reason: string | null;
  metro_id: string | null; metro_name: string | null; metro_source: MetroSource;
  checkins_this_month: number; points_this_month: number; lifetime_points: number;
  completed_item_names: { id: string; body: string }[] | null;
  most_active_hood: string | null; current_streak_weeks: number | null;
  last_checkin_at: string | null; last_checkin_item_name: string | null;
  days_since_last_checkin: number | null; new_items_since_last_checkin: number;
  lifetime_checkins: number;
  season_list_id: string | null; season_name: string | null; season_ends_at: string | null;
  season_total_items: number; season_checked_count: number; season_days_remaining: number;
  recommended_items: RawRecommendation[] | null;
};

// Structural filter first (curated_lists.season), title regex second as a
// defense-in-depth safety net in case season itself is ever wrong. The
// first version of this query had neither an ORDER BY nor a season filter
// and just took the first 10 rows before filtering by title — for Phoenix,
// all 10 unordered rows happened to be season='summer', so its 3 genuinely
// evergreen lists (season='anytime': West Valley's Best, Phoenix Hidden
// Gems, Rediscover Downtown Peoria — real, active, non-stale content) never
// even reached the filter. Diagnosed against production data during the
// Sept 1 campaign audit — not a data bug, a query bug.
async function fetchThemedLists(supabase: any, metroName: string | null): Promise<ThemedListLink[]> {
  if (!metroName) return [];
  try {
    const slug = metroSlug(metroName);
    const { data, error } = await supabase
      .from('curated_lists')
      .select('id, title, slug, season')
      .eq('is_active', true)
      .eq('city_slug', slug)
      .in('season', ['fall', 'anytime'])
      .order('season', { ascending: true }) // 'anytime' before 'fall' — alphabetical, stable
      .limit(10);
    if (error || !data) return [];
    return selectThemedLists(data).map((l) => ({ title: l.title, url: `checkoff://list?id=${l.id}` }));
  } catch {
    return [];
  }
}

// Zero live users currently qualify for FALL_CONTINUATION (Denver/Tucson/
// Milwaukee are too new to have both season progress AND zero-August-
// activity yet). This synthetic row proves the template path renders
// correctly without waiting on real data — clearly marked, never sent to
// a real recipient, never written to campaign_sends as a real send.
function syntheticFallContinuationRow(): AudienceRow {
  return {
    user_id: 'SYNTHETIC-fall-continuation-preview', email: 'synthetic@example.invalid',
    display_name: 'Alex Rivera', platform: 'android',
    segment: 'FALL_CONTINUATION', exclusion_reason: null,
    metro_id: 'SYNTHETIC', metro_name: 'Milwaukee Metro', metro_source: 'checkoff_history',
    checkins_this_month: 0, points_this_month: 0, lifetime_points: 40,
    completed_item_names: [], most_active_hood: null, current_streak_weeks: 0,
    last_checkin_at: '2026-08-10T00:00:00Z',
    last_checkin_item_name: "Find the goats on the roof at Al Johnson's Swedish Restaurant",
    days_since_last_checkin: 22, new_items_since_last_checkin: 3, lifetime_checkins: 6,
    season_list_id: '21523c15-4bd0-4fc1-b8ec-c1d67ca2fa40', season_name: 'Fall 2026 — Milwaukee Metro',
    season_ends_at: '2026-11-30', season_total_items: 32, season_checked_count: 4, season_days_remaining: 90,
    recommended_items: [
      { id: 'x1', body: 'Sit in the taproom at Door County Brewing Co', difficulty: 1, url: 'checkoff://item?id=x1' },
      { id: 'x2', body: "Order a Bloody Mary at Sobelman's", difficulty: 1, url: 'checkoff://item?id=x2' },
      { id: 'x3', body: 'Catch a Brewers game at American Family Field', difficulty: 5, url: 'checkoff://item?id=x3' },
    ],
  };
}

async function buildTrackedUrl(
  functionsBaseUrl: string, secret: string, userId: string, campaignId: string, dest: string,
  ev: string, segment: string, recId?: string,
): Promise<string> {
  const token = await signToken(secret, userId, campaignId);
  const params = new URLSearchParams({ u: userId, c: campaignId, t: token, dest, ev, seg: segment });
  if (recId) params.set('rec', recId);
  // No custom domain/proxy for functions is configured on getcheckoff.com
  // (confirmed during the campaign audit — the marketing site has no such
  // route). Link straight to this Supabase project's own functions URL.
  return `${functionsBaseUrl}/campaign-link?${params.toString()}`;
}

async function buildEmailData(
  supabase: any, functionsBaseUrl: string, secret: string, row: AudienceRow, campaignId: string,
): Promise<{ data: RecapEmailData; recommendationIds: string[] }> {
  const rawRecs = (row.recommended_items || []).slice(0, 3);
  const roled = assignRecommendationRoles(rawRecs);
  const recommendations = await Promise.all(roled.map(async (r) => ({
    ...r,
    url: await buildTrackedUrl(functionsBaseUrl, secret, row.user_id, campaignId, r.url, 'recommendation_click', row.segment, r.id),
  })));

  const themedLists = await fetchThemedLists(supabase, row.metro_name);
  const themedListsTracked = await Promise.all(themedLists.map(async (l) => ({
    ...l,
    url: await buildTrackedUrl(functionsBaseUrl, secret, row.user_id, campaignId, l.url, 'themed_list_click', row.segment),
  })));

  const updates = selectSinceLastActivityUpdates(
    row.metro_name,
    row.last_checkin_at || undefined,
    4,
  );

  const seasonListDeepLink = row.season_list_id
    ? await buildTrackedUrl(functionsBaseUrl, secret, row.user_id, campaignId, `checkoff://list?id=${row.season_list_id}`, 'season_continue_click', row.segment)
    : null;

  const ctaUrl = await buildTrackedUrl(functionsBaseUrl, secret, row.user_id, campaignId, 'checkoff://home', 'main_cta_click', row.segment);
  // No /vote-next-city page exists on getcheckoff.com (confirmed during the
  // campaign audit) — the click through campaign-link IS the vote (recorded
  // to interaction_events), so its dest is unused beyond a thank-you page
  // campaign-link renders inline for this event type. "Suggest another
  // city" uses a plain mailto — smallest possible solution, no new hosted
  // form, matches the mailto pattern already used for legacy unsubscribe.
  const nextMetroVoteUrl = await buildTrackedUrl(functionsBaseUrl, secret, row.user_id, campaignId, 'https://getcheckoff.com', 'next_metro_vote', row.segment);
  const suggestAnotherCityUrl = 'mailto:hello@getcheckoff.com?subject=City%20Suggestion&body=I%27d%20love%20to%20see%20CheckOff%20in%3A%20';
  const inviteUrl = await buildTrackedUrl(functionsBaseUrl, secret, row.user_id, campaignId, 'https://getcheckoff.com/join', 'invite_click', row.segment);
  const unsubscribeUrl = await buildTrackedUrl(functionsBaseUrl, secret, row.user_id, campaignId, 'https://getcheckoff.com/download', 'unsubscribe', row.segment);

  const data: RecapEmailData = {
    segment: row.segment,
    firstName: firstName(row.display_name),
    metroName: row.metro_name,
    metroSource: row.metro_source,
    platform: row.platform,
    checkinsThisMonth: row.checkins_this_month,
    pointsThisMonth: row.points_this_month,
    completedNames: (row.completed_item_names || []).map((i) => i.body),
    mostActiveHood: row.most_active_hood,
    currentStreakWeeks: row.current_streak_weeks,
    hasRecentActivity: (row.days_since_last_checkin ?? 999) <= 14,
    seasonName: row.season_name,
    seasonCompleted: row.season_checked_count,
    seasonTotal: row.season_total_items || undefined,
    seasonDaysRemaining: row.season_days_remaining,
    seasonListDeepLink,
    unlockThreshold: null, // no per-list unlock_threshold surfaced by the audience RPC yet; see audit gap
    daysSinceLastCheckin: row.days_since_last_checkin,
    lastCheckinItemName: row.last_checkin_item_name,
    recommendations,
    updates,
    themedLists: themedListsTracked,
    nextMetroVoteUrl,
    suggestAnotherCityUrl,
    inviteUrl,
    unsubscribeUrl,
    ctaUrl,
  };

  return { data, recommendationIds: rawRecs.map((r) => r.id) };
}

function summarizeAudience(rows: AudienceRow[]) {
  const bySegment: Record<string, number> = {};
  const byExclusionReason: Record<string, number> = {};
  const byMetro: Record<string, number> = {};
  const byMetroSource: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  let knownMetro = 0, unknownMetro = 0;
  let personalizedRecommendationsAvailable = 0;
  let marketDiscoveryFallbackUsed = 0; // NEVER_CHECKED_OFF + metro_source='unknown' — the only case that gets the market-discovery template
  let missingRecommendations = 0;
  let missingImages = 0; // items table has no reliable image_url per audit — always "missing"

  for (const r of rows) {
    bySegment[r.segment] = (bySegment[r.segment] || 0) + 1;
    if (r.segment === 'EXCLUDED') {
      const reason = r.exclusion_reason || 'unknown';
      byExclusionReason[reason] = (byExclusionReason[reason] || 0) + 1;
    }
    if (r.metro_name) byMetro[r.metro_name] = (byMetro[r.metro_name] || 0) + 1;
    byMetroSource[r.metro_source] = (byMetroSource[r.metro_source] || 0) + 1;
    if (r.metro_source === 'unknown') unknownMetro++; else knownMetro++;
    const platform = r.platform || 'unknown';
    byPlatform[platform] = (byPlatform[platform] || 0) + 1;
    if (r.segment !== 'EXCLUDED') {
      const hasRecs = (r.recommended_items || []).length > 0;
      if (hasRecs) personalizedRecommendationsAvailable++;
      else if (r.segment === 'NEVER_CHECKED_OFF' && r.metro_source === 'unknown') marketDiscoveryFallbackUsed++;
      else missingRecommendations++;
    }
  }
  missingImages = rows.length; // documented known gap, not per-row variance

  return {
    total: rows.length, bySegment, byExclusionReason, byMetro, byMetroSource,
    knownMetro, unknownMetro, byPlatform,
    personalizedRecommendationsAvailable, marketDiscoveryFallbackUsed,
    missingRecommendations, missingImages,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const month: string = body.month || '2026-08';
    const mode: 'dry_run' | 'preview' | 'test_send' | 'send' = body.mode || 'dry_run';
    const campaignVersion: string = body.campaignVersion || TEMPLATE_VERSION;
    const campaignId = `recap_${month}`;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const functionsBaseUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1`;
    const supabase = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { start, end } = monthBounds(month);
    const { data: audience, error: audienceError } = await supabase.rpc('get_recap_campaign_audience', {
      p_month_start: start, p_month_end: end,
    });
    if (audienceError) throw audienceError;

    const rows: AudienceRow[] = audience || [];
    const summary = summarizeAudience(rows);
    const secret = getLinkSecret();

    // ── dry_run ────────────────────────────────────────────────────────────
    if (mode === 'dry_run') {
      const eligible = rows.filter((r) => r.segment !== 'EXCLUDED');
      const logRows = eligible.map((r) => ({
        campaign_id: campaignId, campaign_month: start, user_id: r.user_id,
        segment: r.segment, template_version: campaignVersion,
        subject: subjectFor(r.segment, r.display_name, r.season_name, r.metro_source !== 'unknown'),
        status: 'dry_run', is_test_send: true,
      }));
      if (logRows.length) {
        const { error: insertError } = await supabase.from('campaign_sends').insert(logRows);
        if (insertError) console.error('dry_run log insert failed:', insertError.message);
      }
      return new Response(JSON.stringify({ mode, month, campaignId, summary }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // ── preview ────────────────────────────────────────────────────────────
    if (mode === 'preview') {
      let targets: AudienceRow[] = [];
      if (body.previewUserId) {
        targets = rows.filter((r) => r.user_id === body.previewUserId);
        if (!targets.length) {
          return new Response(JSON.stringify({ error: `user ${body.previewUserId} not in ${month} audience` }), {
            status: 404, headers: { ...cors, 'Content-Type': 'application/json' },
          });
        }
      } else if (body.previewAllSegments) {
        const active = rows.find((r) => r.segment === 'ACTIVE_AUGUST');
        if (active) targets.push(active);

        const fallContinuation = rows.find((r) => r.segment === 'FALL_CONTINUATION');
        targets.push(fallContinuation || syntheticFallContinuationRow());

        const returning = rows.find((r) => r.segment === 'RETURNING_INACTIVE');
        if (returning) targets.push(returning);

        const neverUnknown = rows.find((r) => r.segment === 'NEVER_CHECKED_OFF' && r.metro_source === 'unknown');
        if (neverUnknown) targets.push(neverUnknown);

        // Only included if one genuinely exists — never fabricated.
        const neverKnown = rows.find((r) => r.segment === 'NEVER_CHECKED_OFF' && r.metro_source !== 'unknown');
        if (neverKnown) targets.push(neverKnown);
      } else {
        return new Response(JSON.stringify({ error: 'preview mode needs previewUserId or previewAllSegments:true' }), {
          status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      const previews = await Promise.all(targets.map(async (row) => {
        const { data: emailData, recommendationIds } = await buildEmailData(supabase, functionsBaseUrl, secret, row, campaignId);
        const html = buildRecapEmailHtml(emailData);
        const subject = subjectFor(row.segment, row.display_name, row.season_name, row.metro_source !== 'unknown');
        return {
          userId: row.user_id, segment: row.segment,
          metroName: row.metro_name, metroSource: row.metro_source,
          isSynthetic: row.user_id.startsWith('SYNTHETIC'),
          subject, previewText: PREVIEW_TEXT,
          mainCta: emailData.ctaUrl, recommendationIds,
          updates: emailData.updates.map((u) => u.id),
          themedLists: emailData.themedLists.map((l) => l.title),
          nextMetroVoteUrl: emailData.nextMetroVoteUrl,
          suggestAnotherCityUrl: emailData.suggestAnotherCityUrl,
          inviteUrl: emailData.inviteUrl,
          unsubscribeUrl: emailData.unsubscribeUrl,
          seasonListDeepLink: emailData.seasonListDeepLink,
          recommendationUrls: emailData.recommendations.map((r) => r.url),
          themedListUrls: emailData.themedLists.map((l) => l.url),
          html,
        };
      }));

      return new Response(JSON.stringify({ mode, month, campaignId, previews }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // ── test_send ──────────────────────────────────────────────────────────
    // Delivers all four principal variants (or a requested subset) to ONE
    // authorized address. Completely isolated from real sends:
    //   - testEmailOverride is REQUIRED (no CAMPAIGN_ALLOW_PRODUCTION_SEND
    //     bypass exists for this mode — there is nothing to bypass, it can
    //     never target a real recipient).
    //   - campaign_id is `${campaignId}_test`, never the real campaign_id —
    //     an explicit, unmistakable marker in campaign_sends and in any
    //     downstream analytics query, on top of is_test_send=true.
    //   - Never checks or writes to the real unique idempotency index
    //     (that index is scoped to is_test_send=false rows only), so it can
    //     never consume a production send slot for a real user.
    //   - Never touches users.email_opt_out/email_bounced.
    //   - Subjects are prefixed [TEST ACTIVE]/[TEST FALL]/[TEST RETURNING]/
    //     [TEST NEW USER] so they're unmistakable in an inbox.
    if (mode === 'test_send') {
      const testEmailOverride: string | undefined = body.testEmailOverride;
      if (!testEmailOverride) {
        return new Response(JSON.stringify({
          error: 'test_send requires testEmailOverride — this mode never sends to a real recipient.',
        }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
      if (!RESEND_KEY) throw new Error('RESEND_API_KEY secret not set');

      const requestedVariants: string[] = Array.isArray(body.variants) && body.variants.length
        ? body.variants
        : ['ACTIVE_AUGUST', 'FALL_CONTINUATION', 'RETURNING_INACTIVE', 'NEVER_CHECKED_OFF'];

      const testCampaignId = `${campaignId}_test`;
      const targets: AudienceRow[] = [];
      for (const seg of requestedVariants) {
        if (seg === 'FALL_CONTINUATION') {
          targets.push(rows.find((r) => r.segment === 'FALL_CONTINUATION') || syntheticFallContinuationRow());
        } else if (seg === 'NEVER_CHECKED_OFF') {
          const unknown = rows.find((r) => r.segment === 'NEVER_CHECKED_OFF' && r.metro_source === 'unknown');
          const known = rows.find((r) => r.segment === 'NEVER_CHECKED_OFF' && r.metro_source !== 'unknown');
          if (unknown) targets.push(unknown);
          else if (known) targets.push(known);
        } else {
          const found = rows.find((r) => r.segment === seg);
          if (found) targets.push(found);
        }
      }

      let sent = 0, failed = 0;
      const results: any[] = [];
      for (const row of targets) {
        try {
          const { data: emailData, recommendationIds } = await buildEmailData(supabase, functionsBaseUrl, secret, row, testCampaignId);
          const html = buildRecapEmailHtml(emailData);
          const baseSubject = subjectFor(row.segment, row.display_name, row.season_name, row.metro_source !== 'unknown');
          const subject = testSendSubject(row.segment, baseSubject);

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'CheckOff <hello@getcheckoff.com>', to: [testEmailOverride], subject, html }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || res.statusText);
          }
          const resJson = await res.json().catch(() => ({}));
          const isSynthetic = row.user_id.startsWith('SYNTHETIC');

          // campaign_sends.user_id is NOT NULL + FK'd to a real users row —
          // a synthetic preview row has no real user to log against, so
          // skip the DB log for it entirely rather than force a fake FK.
          // Its send result is still fully reported in the JSON response.
          if (!isSynthetic) {
            await supabase.from('campaign_sends').insert({
              campaign_id: testCampaignId, campaign_month: start, user_id: row.user_id,
              segment: row.segment, template_version: campaignVersion, subject,
              recommendation_ids: recommendationIds,
              rendered_snapshot: { metro_source: row.metro_source, test_recipient: testEmailOverride },
              status: 'sent', resend_message_id: resJson.id || null,
              is_test_send: true, sent_at: new Date().toISOString(),
            });
          }
          sent++;
          results.push({ segment: row.segment, subject, sent: true, isSynthetic });
        } catch (e) {
          failed++;
          results.push({ segment: row.segment, sent: false, error: e.message });
        }
      }

      return new Response(JSON.stringify({
        mode, month, testCampaignId, testEmailOverride, sent, failed, results,
      }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // ── send ───────────────────────────────────────────────────────────────
    if (mode === 'send') {
      const testEmailOverride: string | undefined = body.testEmailOverride;
      const productionSendAllowed = Deno.env.get('CAMPAIGN_ALLOW_PRODUCTION_SEND') === 'true';
      if (!testEmailOverride && !productionSendAllowed) {
        return new Response(JSON.stringify({
          error: 'Refused: mode "send" with no testEmailOverride requires CAMPAIGN_ALLOW_PRODUCTION_SEND=true on the deployed function. ' +
                 'This is a deliberate safety rail — set testEmailOverride to a specific address to test the send path safely.',
        }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
      if (!RESEND_KEY) throw new Error('RESEND_API_KEY secret not set');

      let eligible = rows.filter((r) => r.segment !== 'EXCLUDED');
      if (body.limit) eligible = eligible.slice(0, Number(body.limit));

      // Idempotency: skip anyone with an existing successful, non-test send for this campaign.
      const { data: already, error: alreadyError } = await supabase
        .from('campaign_sends')
        .select('user_id')
        .eq('campaign_id', campaignId)
        .eq('status', 'sent')
        .eq('is_test_send', false);
      if (alreadyError) throw alreadyError;
      const alreadySent = new Set((already || []).map((r: any) => r.user_id));

      let sent = 0, failed = 0, skippedAlreadySent = 0;
      const isTestSend = !!testEmailOverride;

      for (const row of eligible) {
        if (!isTestSend && alreadySent.has(row.user_id)) { skippedAlreadySent++; continue; }

        try {
          const { data: emailData, recommendationIds } = await buildEmailData(supabase, functionsBaseUrl, secret, row, campaignId);
          const html = buildRecapEmailHtml(emailData);
          const subject = subjectFor(row.segment, row.display_name, row.season_name, row.metro_source !== 'unknown');
          const toAddress = testEmailOverride || row.email;

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'CheckOff <hello@getcheckoff.com>', to: [toAddress], subject, html }),
          });

          let resendMessageId: string | null = null;
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || res.statusText);
          }
          const resJson = await res.json().catch(() => ({}));
          resendMessageId = resJson.id || null;

          await supabase.from('campaign_sends').insert({
            campaign_id: campaignId, campaign_month: start, user_id: row.user_id,
            segment: row.segment, template_version: campaignVersion, subject,
            recommendation_ids: recommendationIds, rendered_snapshot: {
              checkins_this_month: row.checkins_this_month, season_name: row.season_name,
              season_days_remaining: row.season_days_remaining, metro_name: row.metro_name,
              updates: emailData.updates.map((u) => u.id),
            },
            status: 'sent', resend_message_id: resendMessageId,
            is_test_send: isTestSend, sent_at: new Date().toISOString(),
          });
          sent++;
        } catch (e) {
          await supabase.from('campaign_sends').insert({
            campaign_id: campaignId, campaign_month: start, user_id: row.user_id,
            segment: row.segment, template_version: campaignVersion,
            status: 'failed', failure_reason: e.message, is_test_send: isTestSend,
          });
          console.error(`recap-campaign send failed for ${row.email}:`, e.message);
          failed++;
        }
      }

      return new Response(JSON.stringify({ mode, month, campaignId, sent, failed, skippedAlreadySent, isTestSend }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `unknown mode "${mode}"` }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('send-recap-campaign error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
