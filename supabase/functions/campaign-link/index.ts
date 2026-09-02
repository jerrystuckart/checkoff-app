// Single redirect+tracking endpoint reused for every link in a campaign
// email that needs post-send attribution: recommendation clicks, "Continue
// season list", "Vote for a city", and one-click unsubscribe. Logs a row to
// interaction_events (campaign_id + metadata columns added in
// 20260901_recap_campaign_phase1.sql) then 302s to the real destination.
//
// GET /campaign-link
//   ?u=<user_id>            required
//   &c=<campaign_id>        required, e.g. recap_2026-08
//   &t=<hmac token>         required, from linkSigning.signToken(secret, u, c)
//   &dest=<url>             required, URL-encoded destination
//   &ev=<event type>        optional, default 'email_click'; 'unsubscribe' is special-cased
//   &seg=<segment>          optional, echoed into metadata
//   &rec=<item id>          optional, recommendation id echoed into metadata
//   &meta=<url-encoded json> optional, merged into metadata
//
// Unsigned or mismatched tokens still redirect (never breaks a user's click)
// but skip both the attribution write and the unsubscribe action, and are
// logged server-side as invalid.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getLinkSecret, verifyToken } from '../_shared/linkSigning.ts';

const FALLBACK_DEST = 'https://getcheckoff.com/download';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams;
  const userId = q.get('u');
  const campaignId = q.get('c');
  const token = q.get('t');
  const dest = q.get('dest') || FALLBACK_DEST;
  const eventType = q.get('ev') || 'email_click';
  const segment = q.get('seg');
  const recommendationId = q.get('rec');
  let metaExtra: Record<string, unknown> = {};
  try { if (q.get('meta')) metaExtra = JSON.parse(q.get('meta')!); } catch { /* ignore malformed meta */ }

  const redirect = (target: string) => new Response(null, { status: 302, headers: { Location: target } });

  if (!userId || !campaignId || !token) {
    return redirect(dest); // malformed link — still send the person where they meant to go
  }

  let valid = false;
  try {
    valid = await verifyToken(getLinkSecret(), userId, campaignId, token);
  } catch (e) {
    console.error('campaign-link: signing secret unavailable', e.message);
  }

  if (!valid) {
    console.warn(`campaign-link: invalid token for u=${userId} c=${campaignId}`);
    return redirect(dest);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  if (eventType === 'unsubscribe') {
    const { error } = await supabase
      .from('users')
      .update({ email_opt_out: true, email_opt_out_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) console.error('campaign-link: unsubscribe update failed', error.message);
  }

  const { error: logError } = await supabase.from('interaction_events').insert({
    user_id: userId,
    event_type: eventType,
    campaign_id: campaignId,
    metadata: { segment, recommendation_id: recommendationId, dest, ...metaExtra },
  });
  if (logError) console.error('campaign-link: attribution insert failed', logError.message);

  if (eventType === 'unsubscribe') {
    return new Response(
      `<!doctype html><html><body style="font-family:sans-serif;padding:40px;text-align:center;color:#171A21;"><h2>You're unsubscribed</h2><p>You won't get CheckOff recap emails going forward. You'll still get essential account emails.</p></body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    );
  }

  // next_metro_vote has no real destination page to send someone to (no
  // /vote-next-city route exists on getcheckoff.com as of this campaign —
  // confirmed during the audit); the click itself, recorded above, is the
  // entire "vote." Show a plain thank-you instead of a broken redirect.
  if (eventType === 'next_metro_vote') {
    return new Response(
      `<!doctype html><html><body style="font-family:sans-serif;padding:40px;text-align:center;color:#171A21;"><h2>Got it — thanks!</h2><p>Your vote is recorded. We're using these to help decide where CheckOff goes next.</p></body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    );
  }

  return redirect(dest);
});
