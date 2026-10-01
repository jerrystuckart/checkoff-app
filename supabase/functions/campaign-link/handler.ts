// Single redirect and tracking endpoint for every link in a campaign email. It verifies a signed
// token, records attribution to interaction_events, and 302s to a page on getcheckoff.com. It never
// renders a page body itself (Supabase downgrades text/html on GET), so every human page lives on the
// website.
//
// GET  ?u=&c=&t=&dest=&ev=&seg=&rec=&meta=   tracked redirect. Unsigned or mismatched tokens still
//                                              redirect but record nothing and take no action.
//   ev=next_metro_vote  logs 'next_metro_vote_opened', redirects to the static vote form
//   ev=unsubscribe      NEVER unsubscribes. Logs 'unsubscribe_page_opened' and redirects to the
//                       static confirmation page. This is what makes email scanners and link
//                       previewers harmless: they can only ever open a page.
// HEAD  identical redirect, with NO side effects at all (no event, no mutation).
// POST  ev=next_metro_vote (or no ev, legacy recovery)  record a vote (valid token + city required)
//       ev=unsubscribe     the ONLY mutation path. Requires a valid token plus an intentional
//                          signal: the confirmation form field confirm=1, or the RFC 8058 one click
//                          body List-Unsubscribe=One-Click. Idempotent. Campaign ids ending in
//                          _test never change a user.

import { linkSecretFrom, verifyToken } from '../_shared/linkSigning.ts';
import {
  safeDestination, validateCityInput, classifyDestination, translateDeepLinkForBrowser,
  FALLBACK_PAGE_ACTION_EVENTS, voteFormUrl, classifyVotePostEligibility,
} from '../_shared/campaignLogic.ts';

const SITE_URL = 'https://getcheckoff.com';
const VOTE_SUBMITTED_URL = `${SITE_URL}/vote-submitted`;
const UNSUBSCRIBED_URL = `${SITE_URL}/unsubscribed`;
const UNSUBSCRIBE_CONFIRM_URL = `${SITE_URL}/unsubscribe`;

export type Deps = {
  env: (name: string) => string | undefined;
  getSupabase: () => any;
};

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

export function unsubscribeConfirmUrl(userId: string, campaignId: string, token: string, segment: string | null, error?: string): string {
  const p = new URLSearchParams({ u: userId, c: campaignId, t: token, seg: segment || '', ev: 'unsubscribe' });
  if (error) p.set('error', error);
  return `${UNSUBSCRIBE_CONFIRM_URL}?${p.toString()}`;
}

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

// Newest submission per (user, campaign) UPDATES the existing row instead of inserting a second one.
async function recordVoteSubmission(
  supabase: any, userId: string, campaignId: string, city: string, segment: string | null,
  submissionFlow: 'explicit' | 'legacy_recovery',
): Promise<void> {
  const metadata = { segment, city, campaign_id: campaignId, stage: 'submitted', is_submitted_vote: true, submission_flow: submissionFlow };
  const { data: existing, error: findError } = await supabase
    .from('interaction_events').select('id')
    .eq('user_id', userId).eq('campaign_id', campaignId).eq('event_type', 'next_metro_vote_submitted')
    .limit(1).maybeSingle();
  if (findError) console.error('campaign-link: vote lookup failed', findError.message);

  if (existing?.id) {
    const { error } = await supabase.from('interaction_events')
      .update({ metadata, occurred_at: new Date().toISOString() }).eq('id', existing.id);
    if (error) console.error('campaign-link: vote update failed', error.message);
  } else {
    const { error } = await supabase.from('interaction_events')
      .insert({ user_id: userId, event_type: 'next_metro_vote_submitted', campaign_id: campaignId, metadata });
    if (error) console.error('campaign-link: vote insert failed', error.message);
  }
}

async function readForm(req: Request): Promise<URLSearchParams> {
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
    console.error('campaign-link: form parse failed', (e as Error).message);
  }
  return form;
}

async function handleVoteSubmission(
  req: Request, deps: Deps, submissionFlow: 'explicit' | 'legacy_recovery',
): Promise<Response> {
  const form = await readForm(req);
  const q = new URL(req.url).searchParams;
  const userId = form.get('u') || q.get('u');
  const campaignId = form.get('c') || q.get('c');
  const token = form.get('t') || q.get('t');
  const segment = form.get('seg') || q.get('seg');
  const dest = safeDestination(form.get('dest') || q.get('dest'));

  if (!userId || !campaignId || !token) return redirectResponse(SITE_URL);

  let valid = false;
  try { valid = await verifyToken(linkSecretFrom(deps.env), userId, campaignId, token); } catch (e) {
    console.error('campaign-link: signing secret unavailable', (e as Error).message);
  }
  if (!valid) return redirectResponse(voteFormUrl(userId, campaignId, token, segment, dest, 'invalid_token'));

  const cityResult = validateCityInput(form.get('city'));
  if (cityResult.ok === false) {
    return redirectResponse(voteFormUrl(userId, campaignId, token, segment, dest, cityResult.reason));
  }
  await recordVoteSubmission(deps.getSupabase(), userId, campaignId, cityResult.city, segment, submissionFlow);
  return redirectResponse(`${VOTE_SUBMITTED_URL}?city=${encodeURIComponent(cityResult.city)}`);
}

// The only code path that can opt a user out.
async function handleUnsubscribeConfirmation(req: Request, deps: Deps): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const rawBody = await req.text().catch(() => '');
  const form = new URLSearchParams(rawBody);
  const oneClick = form.get('List-Unsubscribe') === 'One-Click';
  const confirmed = form.get('confirm') === '1';

  const userId = q.get('u') || form.get('u');
  const campaignId = q.get('c') || form.get('c');
  const token = q.get('t') || form.get('t');
  const segment = q.get('seg') || form.get('seg');

  // An unattended POST without an intentional signal changes nothing.
  if (!oneClick && !confirmed) return jsonResponse({ error: 'Unsubscribe requires confirmation' }, 400);
  if (!userId || !campaignId || !token) return oneClick ? jsonResponse({ error: 'Invalid link' }, 400) : redirectResponse(SITE_URL, 303);

  let valid = false;
  try { valid = await verifyToken(linkSecretFrom(deps.env), userId, campaignId, token); } catch (e) {
    console.error('campaign-link: signing secret unavailable', (e as Error).message);
  }
  if (!valid) {
    return oneClick ? jsonResponse({ error: 'Invalid link' }, 400)
      : redirectResponse(unsubscribeConfirmUrl(userId, campaignId, token, segment, 'invalid_token'), 303);
  }

  const supabase = deps.getSupabase();
  const isTestCampaign = campaignId.endsWith('_test');
  if (!isTestCampaign) {
    const { error } = await supabase.from('users')
      .update({ email_opt_out: true, email_opt_out_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) {
      console.error('campaign-link: unsubscribe update failed', error.message);
      return oneClick ? jsonResponse({ error: 'Could not unsubscribe' }, 500)
        : redirectResponse(unsubscribeConfirmUrl(userId, campaignId, token, segment, 'try_again'), 303);
    }
  }
  await logEvent(supabase, userId, campaignId, 'unsubscribe', {
    segment, flow: oneClick ? 'one_click' : 'confirmed_page', mutated: !isTestCampaign,
  });
  return oneClick ? jsonResponse({ ok: true }) : redirectResponse(UNSUBSCRIBED_URL, 303);
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
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
  // A fallback page's own buttons carry a checkoff:// or store destination that must not be
  // translated again; everything else always gets the browser safe version, so no branch ever
  // redirects an email click to a raw checkoff:// URL.
  const browserDest = FALLBACK_PAGE_ACTION_EVENTS.has(q.get('ev') || '') ? dest : translateDeepLinkForBrowser(dest);
  let metaExtra: Record<string, unknown> = {};
  try { if (q.get('meta')) metaExtra = JSON.parse(q.get('meta')!); } catch { /* ignore malformed meta */ }

  // POST: unsubscribe confirmation and vote submission are the only meaningful POSTs.
  if (method === 'POST') {
    if (eventType === 'unsubscribe') return await handleUnsubscribeConfirmation(req, deps);
    if (!userId || !campaignId || !token) return redirectResponse(browserDest);
    let valid = false;
    try { valid = await verifyToken(linkSecretFrom(deps.env), userId, campaignId, token); } catch { /* handled below */ }
    if (!valid) return redirectResponse(browserDest);
    const eligibility = classifyVotePostEligibility(q.get('ev'));
    if (eligibility === 'rejected') return jsonResponse({ error: 'POST not supported for this event type' }, 400);
    return await handleVoteSubmission(req, deps, eligibility);
  }

  // GET and HEAD from here on.
  if (!userId || !campaignId || !token) return redirectResponse(browserDest);

  let valid = false;
  try { valid = await verifyToken(linkSecretFrom(deps.env), userId, campaignId, token); } catch (e) {
    console.error('campaign-link: signing secret unavailable', (e as Error).message);
  }
  if (!valid) {
    console.warn('campaign-link: invalid token');
    return redirectResponse(browserDest);
  }

  // Where this link goes. HEAD returns it without logging anything.
  let location = browserDest;
  let logAs: string | null = eventType;
  let logMeta: Record<string, unknown> = { segment, recommendation_id: recommendationId, dest, ...metaExtra };
  if (eventType === 'unsubscribe') {
    location = unsubscribeConfirmUrl(userId, campaignId, token, segment);
    logAs = 'unsubscribe_page_opened';
    logMeta = { segment, dest, ...metaExtra };
  } else if (eventType === 'next_metro_vote') {
    location = voteFormUrl(userId, campaignId, token, segment, dest);
    logAs = 'next_metro_vote_opened';
    logMeta = { segment, dest, stage: 'opened', city: null, is_submitted_vote: false, ...metaExtra };
  }

  if (method === 'GET' && logAs) {
    await logEvent(deps.getSupabase(), userId, campaignId, logAs, logMeta, dest);
  }
  return redirectResponse(location);
}
