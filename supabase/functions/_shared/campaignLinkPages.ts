// HTML page builders for campaign-link's non-redirect responses (the
// next-metro voting form/confirmation, unsubscribe confirmation, and a
// generic safe-error page). Kept separate from campaignTemplate.ts, which
// is specifically the recap *email* template — these are browser pages a
// click lands on, a different rendering context (no email-client quirks to
// work around, real <form> support, etc).
//
// Pure string builders, no Deno/network here, so they're unit-testable in
// isolation the same way campaignTemplate.ts is.

import { escapeHtml } from './campaignLogic.ts';

const BRAND_HEAD = `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin:0; padding:0; background:#F4F1EA; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#171A21; }
  .wrap { max-width:480px; margin:0 auto; padding:48px 24px; text-align:center; }
  .logo { font-size:26px; font-weight:900; letter-spacing:-.8px; margin-bottom:28px; }
  .logo .check { color:#F5A623; } .logo .off { color:#171A21; }
  h1 { font-size:24px; font-weight:950; letter-spacing:-.5px; margin:0 0 12px; }
  p { font-size:15px; line-height:23px; color:#4B5260; margin:0 0 20px; }
  input[type=text] { width:100%; box-sizing:border-box; font-size:16px; padding:14px 16px; border-radius:14px; border:1px solid #E8E3DA; margin-bottom:16px; }
  .btn { display:inline-block; background:#F5A623; color:#0F1117; text-decoration:none; font-size:15px; font-weight:900; border:none; border-radius:999px; padding:14px 26px; cursor:pointer; }
  .btn-secondary { display:inline-block; margin-top:16px; font-size:13px; color:#7A8290; text-decoration:underline; }
  .error { background:#FDECEC; border:1px solid #F3B8B8; color:#A32424; border-radius:12px; padding:12px 16px; font-size:14px; margin-bottom:16px; }
</style>`;

function page(bodyInner: string): string {
  return `<!doctype html>
<html lang="en">
<head>${BRAND_HEAD}<title>CheckOff</title></head>
<body>
  <div class="wrap">
    <div class="logo"><span class="check">Check</span><span class="off">Off</span></div>
    ${bodyInner}
  </div>
</body>
</html>`;
}

export type VotingFormFields = {
  u: string;
  c: string;
  t: string;
  seg: string | null;
  dest: string; // already validated safe by the caller
  errorMessage?: string | null;
};

// action="" (relative, same URL — preserves the query string, which already
// carries u/c/t/seg/dest) PLUS the same values duplicated as hidden fields,
// per the fix requirement to preserve them through hidden form fields
// explicitly rather than relying on the query string alone.
export function buildVotingFormHtml(f: VotingFormFields): string {
  const errorBlock = f.errorMessage
    ? `<div class="error">${escapeHtml(f.errorMessage)}</div>`
    : '';
  return page(`
    <h1>What city should CheckOff explore next?</h1>
    <p>Tell us where you'd love to see CheckOff show up.</p>
    ${errorBlock}
    <form method="POST" action="">
      <input type="hidden" name="u" value="${escapeHtml(f.u)}">
      <input type="hidden" name="c" value="${escapeHtml(f.c)}">
      <input type="hidden" name="t" value="${escapeHtml(f.t)}">
      <input type="hidden" name="seg" value="${escapeHtml(f.seg ?? '')}">
      <input type="hidden" name="dest" value="${escapeHtml(f.dest)}">
      <input type="text" name="city" placeholder="e.g. Austin, TX" maxlength="80" autofocus>
      <button type="submit" class="btn">Submit my city</button>
    </form>
  `);
}

export function buildVoteConfirmationHtml(city: string, homeUrl: string): string {
  return page(`
    <h1>Got it — thanks!</h1>
    <p>Your vote for <strong>${escapeHtml(city)}</strong> has been recorded. We're using these suggestions to help decide where CheckOff goes next.</p>
    <a class="btn" href="${escapeHtml(homeUrl)}">Back to CheckOff</a>
  `);
}

export function buildSimpleMessageHtml(title: string, body: string, homeUrl?: string): string {
  const cta = homeUrl ? `<a class="btn" href="${escapeHtml(homeUrl)}">Back to CheckOff</a>` : '';
  return page(`
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
    ${cta}
  `);
}
