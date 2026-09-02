// Single redirect+tracking endpoint reused for every link in a campaign
// email that needs post-send attribution: recommendation clicks, "Continue
// season list", "Vote for a city", and one-click unsubscribe. Logs a row to
// interaction_events (campaign_id + metadata columns added in
// 20260901_recap_campaign_phase1.sql) then 302s — either to the real
// destination, or to a static branded page on getcheckoff.com.
//
// GET /campaign-link
//   ?u=<user_id>            required
//   &c=<campaign_id>        required, e.g. recap_2026-08
//   &t=<hmac token>         required, from linkSigning.signToken(secret, u, c)
//   &dest=<url>             required, URL-encoded destination — validated,
//                           falls back to CAMPAIGN_LINK_FALLBACK_DEST if unsafe
//   &ev=<event type>        optional, default 'email_click'.
//                           'unsubscribe' and 'next_metro_vote' are special-cased.
//   &seg=<segment>          optional, echoed into metadata
//   &rec=<item id>          optional, recommendation id echoed into metadata
//   &meta=<url-encoded json> optional, merged into metadata
//
// POST /campaign-link (only meaningful with ev=next_metro_vote — the
// getcheckoff.com/vote form's own submit target) — form-encoded body:
// u, c, t, seg, dest, city.
//
// Unsigned or mismatched tokens still redirect (never breaks a user's click)
// but skip both the attribution write and the unsubscribe/vote action, and
// are logged server-side as invalid.
//
// HOTFIX 2026-09-02, part 1: two production bugs fixed.
//   1. HTML responses (unsubscribe, next_metro_vote) rendered inline here
//      showed as raw text/plain source to a real recipient. Root cause:
//      Supabase's Edge Functions relay downgrades Content-Type: text/html
//      to text/plain for GET responses (an anti-XSS measure), unless the
//      project has a Pro-plan custom domain for functions — confirmed
//      absent for this project. POST responses are unaffected.
//   2. next_metro_vote unconditionally claimed "Your vote is recorded" on a
//      bare GET click, with no city ever collected.
//
// HOTFIX 2026-09-02, part 2: since this function genuinely cannot serve
// real HTML on GET, every human-facing page (the vote form, its
// confirmation, and unsubscribe) now lives as a static page on
// getcheckoff.com (a separate Vercel-hosted site, not subject to the
// restriction above) and this function only ever 302-redirects to it —
// redirects have no content-type/body to downgrade, so they always work.
// campaign-link itself now does exactly two things: verify + log, then
// either redirect (GET) or validate + record + redirect (POST). It never
// renders a page body again.
//   - GET  ev=next_metro_vote  -> log 'next_metro_vote_opened', redirect to
//     https://getcheckoff.com/vote?u=..&c=..&t=..&seg=..&dest=..
//   - POST ev=next_metro_vote  -> validate token + city, record
//     'next_metro_vote_submitted' (newest submission per user+campaign
//     wins — see recordVoteSubmission), redirect to
//     https://getcheckoff.com/vote-submitted?city=<city>, or back to
//     /vote?...&error=<reason> on validation failure (the static page
//     re-renders the form with that error).
//   - GET  ev=unsubscribe -> perform the opt-out, log, redirect to
//     https://getcheckoff.com/unsubscribed
// Also closed a pre-existing open-redirect gap: `dest` was followed
// unconditionally; it's now validated against isSafeDestination() and
// falls back to a known-safe URL otherwise.
//
// HOTFIX 2026-09-02, part 3: recommendation/season/themed-list/main-CTA
// links all carry checkoff://... as their dest — redirecting an email
// click straight there does nothing visible in a browser, embedded email
// webview, or on a device without CheckOff installed/scheme-registered
// (desktop, most testing contexts, a fresh install). Every checkoff:// dest
// is now translated server-side to a real getcheckoff.com page
// (translateDeepLinkForBrowser, in campaignLogic.ts) before it is ever used
// as a redirect Location — no branch returns a raw checkoff:// URL to an
// email click again. /list?id=<uuid> reuses the app's own already-wired
// React Navigation route (App.jsx linking.config) over https, which is a
// real iOS Universal Link once /list/* is added to the live
// apple-app-site-association file (done, see getcheckoff-site). Android has
// no equivalent App Link intentFilter for /list yet — that requires a new
// native build (out of scope for this hotfix) — so /list?id=... still
// serves as a correct, useful browser fallback there today; the id-derived
// URL will simply start deep-linking on Android too once wired app-side,
// with zero further changes needed here. /item?id=<uuid> has no in-app
// route at all yet on either platform (checkoff://item?id=... has never
// actually opened anything in the app — a separate, pre-existing gap, not
// introduced by this campaign) — it is a browser-fallback-only,
// forward-compatible placeholder for the same reason.
//
// The two secondary buttons a fallback page itself offers ("Open in
// CheckOff", App Store, Play Store) route back through this same function
// with ev=app_open_click/appstore_click/playstore_click specifically so
// they still get logged — but these are NOT translated (would just loop
// back to the same fallback page) and store URLs are allowed by
// isSafeDestination's extended host allowlist.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getLinkSecret, verifyToken } from '../_shared/linkSigning.ts';
import {
  safeDestination, validateCityInput, MAX_CITY_LENGTH,
  classifyDestination, translateDeepLinkForBrowser, FALLBACK_PAGE_ACTION_EVENTS,
  voteFormUrl, classifyVotePostEligibility,
} from '../_shared/campaignLogic.ts';

const SITE_URL = 'https://getcheckoff.com';
const VOTE_SUBMITTED_URL = `${SITE_URL}/vote-submitted`;
const UNSUBSCRIBED_URL = `${SITE_URL}/unsubscribed`;

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
}

// destinationOriginal is the RAW dest as received (before any browser-safe
// translation) — classification must run on the original checkoff:// value
// so old delivered links still report an accurate destination_type/id.
async function logEvent(
  supabase: any, userId: string, campaignId: string, eventType: string,
  metadata: Record<string, unknown>, destinationOriginal?: string,
): Promise<void> {
  const classified = destinationOriginal ? classifyDestination(destinationOriginal) : null;
  const fullMetadata = {
    ...metadata,
    ...(classified ? { destination_type: classified.type, destination_id: classified.id } : {}),
    is_test_campaign: campaignId.endsWith('_test'),
  };
  const { error } = await supabase.from('interaction_events').insert({
    user_id: userId, event_type: eventType, campaign_id: campaignId, metadata: fullMetadata,
  });
  if (error) console.error('campaign-link: attribution insert failed', error.message);
}

// Newest submission per (user, campaign) UPDATES the existing
// 'next_metro_vote_submitted' row rather than inserting a second one — a
// second insert would double-count in any naive count(*) vote tally.
// Documented product choice: a repeat submission means "I changed my mind,"
// not "count me twice."
async function recordVoteSubmission(
  supabase: any, userId: string, campaignId: string, city: string, segment: string | null,
  submissionFlow: 'explicit' | 'legacy_recovery',
): Promise<void> {
  const metadata = { segment, city, campaign_id: campaignId, stage: 'submitted', is_submitted_vote: true, submission_flow: submissionFlow };
  const { data: existing, error: findError } = await supabase
    .from('interaction_events')
    .select('id')
    .eq('user_id', userId).eq('campaign_id', campaignId).eq('event_type', 'next_metro_vote_submitted')
    .limit(1).maybeSingle();
  if (findError) console.error('campaign-link: vote lookup failed', findError.message);

  if (existing?.id) {
    const { error } = await supabase
      .from('interaction_events')
      .update({ metadata, occurred_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) console.error('campaign-link: vote update failed', error.message);
  } else {
    const { error } = await supabase
      .from('interaction_events')
      .insert({ user_id: userId, event_type: 'next_metro_vote_submitted', campaign_id: campaignId, metadata });
    if (error) console.error('campaign-link: vote insert failed', error.message);
  }
}

async function handleVoteSubmission(req: Request, supabase: any, submissionFlow: 'explicit' | 'legacy_recovery'): Promise<Response> {
  let form = new URLSearchParams();
  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      form = new URLSearchParams(await req.text());
    } else {
      const fd = await req.formData();
      for (const [k, v] of fd.entries()) if (typeof v === 'string') form.set(k, v);
    }
  } catch (e) {
    console.error('campaign-link: vote form parse failed', e.message);
  }

  // Hidden form fields are authoritative (explicit requirement); the same
  // URL's query string is a fallback since the form posts back to itself.
  const q = new URL(req.url).searchParams;
  const userId = form.get('u') || q.get('u');
  const campaignId = form.get('c') || q.get('c');
  const token = form.get('t') || q.get('t');
  const segment = form.get('seg') || q.get('seg');
  const dest = safeDestination(form.get('dest') || q.get('dest'));

  if (!userId || !campaignId || !token) {
    return redirectResponse(SITE_URL); // nothing usable to redirect back to the form with
  }

  let valid = false;
  try {
    valid = await verifyToken(getLinkSecret(), userId, campaignId, token);
  } catch (e) {
    console.error('campaign-link: signing secret unavailable', e.message);
  }
  if (!valid) {
    return redirectResponse(voteFormUrl(userId, campaignId, token, segment, dest, 'invalid_token'));
  }

  const cityResult = validateCityInput(form.get('city'));
  if (cityResult.ok === false) {
    const reason: string = cityResult.reason;
    return redirectResponse(voteFormUrl(userId, campaignId, token, segment, dest, reason));
  }

  const city: string = cityResult.city;
  await recordVoteSubmission(supabase, userId, campaignId, city, segment, submissionFlow);
  return redirectResponse(`${VOTE_SUBMITTED_URL}?city=${encodeURIComponent(city)}`);
}

Deno.serve(async (req) => {
  const method = req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    return jsonResponse({ error: `method "${method}" not allowed` }, 405);
  }

  const url = new URL(req.url);
  const q = url.searchParams;
  const userId = q.get('u');
  const campaignId = q.get('c');
  const token = q.get('t');
  const eventType = q.get('ev') || 'email_click';
  const segment = q.get('seg');
  const recommendationId = q.get('rec');
  const dest = safeDestination(q.get('dest'));
  // FALLBACK_PAGE_ACTION_EVENTS (a fallback page's own "Open in CheckOff" /
  // store buttons) intentionally carry a checkoff:// or store dest that
  // must NOT be translated again — everything else always gets the
  // browser-safe version so no branch ever redirects an email click
  // straight to a raw checkoff:// URL.
  const browserDest = FALLBACK_PAGE_ACTION_EVENTS.has(q.get('ev') || '') ? dest : translateDeepLinkForBrowser(dest);
  let metaExtra: Record<string, unknown> = {};
  try { if (q.get('meta')) metaExtra = JSON.parse(q.get('meta')!); } catch { /* ignore malformed meta */ }

  if (!userId || !campaignId || !token) {
    return redirectResponse(browserDest); // malformed link — still send the person where they meant to go
  }

  let valid = false;
  try {
    valid = await verifyToken(getLinkSecret(), userId, campaignId, token);
  } catch (e) {
    console.error('campaign-link: signing secret unavailable', e.message);
  }

  if (!valid) {
    console.warn(`campaign-link: invalid token for u=${userId} c=${campaignId}`);
    return redirectResponse(browserDest);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // ── POST: vote submission (only meaningful path for POST) ────────────────
  // Legacy-recovery: a POST with NO `ev` at all (as opposed to an explicit,
  // different event type) is tolerated as a *candidate* next_metro_vote
  // submission — covers anyone whose browser already had the broken
  // pre-fix /vote page open (built before voteFormUrl() carried ev) when
  // this deployed. This does NOT broaden acceptance of arbitrary eventless
  // POSTs: handleVoteSubmission still requires a valid signed token and a
  // non-empty, validated city exactly as the explicit path does — a
  // malformed or unsigned eventless POST is rejected the same way an
  // explicit one would be. Only the flow actually recorded differs
  // (submission_flow: 'explicit' | 'legacy_recovery'), for audit clarity.
  if (method === 'POST') {
    const eligibility = classifyVotePostEligibility(q.get('ev'));
    if (eligibility === 'rejected') {
      return jsonResponse({ error: 'POST not supported for this event type' }, 400);
    }
    return await handleVoteSubmission(req, supabase, eligibility);
  }

  // ── unsubscribe ────────────────────────────────────────────────────────
  if (eventType === 'unsubscribe') {
    const { error } = await supabase
      .from('users')
      .update({ email_opt_out: true, email_opt_out_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) console.error('campaign-link: unsubscribe update failed', error.message);

    await logEvent(supabase, userId, campaignId, eventType, { segment, recommendation_id: recommendationId, dest, ...metaExtra }, dest);

    return redirectResponse(UNSUBSCRIBED_URL);
  }

  // ── next_metro_vote (GET): redirect to the static form, log intent only —
  // never a claimed vote. See file header for the bug this replaces. ──────
  if (eventType === 'next_metro_vote') {
    // Preserves the original event_type ('next_metro_vote') for the
    // production-analytics-safe path is NOT used here — no external
    // analytics consumer depends on that string yet (interaction_events'
    // campaign_id/metadata columns are new as of this campaign), so this
    // uses the clearer, unambiguous 'next_metro_vote_opened' name going
    // forward. The pre-existing city-less 'next_metro_vote' rows from
    // before this fix were annotated in place, not renamed (see Open Brain).
    await logEvent(supabase, userId, campaignId, 'next_metro_vote_opened', {
      segment, dest, stage: 'opened', city: null, is_submitted_vote: false, ...metaExtra,
    }, dest);
    return redirectResponse(voteFormUrl(userId, campaignId, token, segment, dest));
  }

  // ── standard tracked redirect (recommendation click, themed list,
  // season continue, main CTA, invite click, fallback-page secondary
  // actions, etc.) — browserDest is dest verbatim for
  // FALLBACK_PAGE_ACTION_EVENTS, translated away from checkoff:// for
  // everything else. ────────────────────────────────────────────────────
  await logEvent(supabase, userId, campaignId, eventType, { segment, recommendation_id: recommendationId, dest, ...metaExtra }, dest);
  return redirectResponse(browserDest);
});
