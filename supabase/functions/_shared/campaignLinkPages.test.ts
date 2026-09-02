// Run with: deno test supabase/functions/_shared/campaignLinkPages.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { buildVotingFormHtml, buildVoteConfirmationHtml, buildSimpleMessageHtml } from './campaignLinkPages.ts';

Deno.test('buildVotingFormHtml: renders the form, does not claim a vote was completed', () => {
  const html = buildVotingFormHtml({ u: 'u1', c: 'recap_2026-08', t: 'tok', seg: 'ACTIVE_AUGUST', dest: 'checkoff://home' });
  assert(html.includes('What city should CheckOff explore next?'));
  assert(html.includes('<input type="text" name="city"'));
  assert(html.includes('Submit my city'));
  assert(!html.includes('Your vote is recorded'));
  assert(!/vote.*recorded/i.test(html));
});

Deno.test('buildVotingFormHtml: preserves u/c/t/seg/dest as hidden fields', () => {
  const html = buildVotingFormHtml({ u: 'user-123', c: 'recap_2026-08', t: 'abc123token', seg: 'RETURNING_INACTIVE', dest: 'https://getcheckoff.com/download' });
  assert(html.includes('name="u" value="user-123"'));
  assert(html.includes('name="c" value="recap_2026-08"'));
  assert(html.includes('name="t" value="abc123token"'));
  assert(html.includes('name="seg" value="RETURNING_INACTIVE"'));
  assert(html.includes('name="dest" value="https://getcheckoff.com/download"'));
});

Deno.test('buildVotingFormHtml: null segment renders an empty hidden field, never "null"', () => {
  const html = buildVotingFormHtml({ u: 'u1', c: 'c1', t: 't1', seg: null, dest: 'checkoff://home' });
  assert(html.includes('name="seg" value=""'));
  assert(!html.includes('>null<'));
});

Deno.test('buildVotingFormHtml: shows the error message when provided', () => {
  const html = buildVotingFormHtml({ u: 'u1', c: 'c1', t: 't1', seg: null, dest: 'checkoff://home', errorMessage: 'Please enter a city.' });
  assert(html.includes('Please enter a city.'));
});

Deno.test('buildVotingFormHtml: escapes a hostile token/segment value', () => {
  const html = buildVotingFormHtml({ u: 'u1', c: 'c1', t: '"><script>alert(1)</script>', seg: '<b>x</b>', dest: 'checkoff://home' });
  assert(!html.includes('<script>alert(1)</script>'));
  assert(!html.includes('<b>x</b>'));
  assert(html.includes('&lt;script&gt;'));
});

Deno.test('buildVoteConfirmationHtml: shows the submitted city safely, includes a safe CTA', () => {
  const html = buildVoteConfirmationHtml('Austin, TX', 'https://getcheckoff.com');
  assert(html.includes('Got it — thanks!'));
  assert(html.includes('Your vote for <strong>Austin, TX</strong> has been recorded'));
  assert(html.includes('href="https://getcheckoff.com"'));
});

Deno.test('buildVoteConfirmationHtml: escapes a hostile city value (defense in depth beyond input validation)', () => {
  const html = buildVoteConfirmationHtml('<script>alert(1)</script>', 'https://getcheckoff.com');
  assert(!html.includes('<script>alert(1)</script>'));
  assert(html.includes('&lt;script&gt;'));
});

Deno.test('buildSimpleMessageHtml: used for unsubscribe — renders title/body, escapes content', () => {
  const html = buildSimpleMessageHtml('Unsubscribed', 'You will not get CheckOff recap emails going forward.', 'https://getcheckoff.com');
  assert(html.includes('Unsubscribed'));
  assert(html.includes('You will not get CheckOff recap emails going forward.'));
  assert(html.includes('href="https://getcheckoff.com"'));
});

Deno.test('buildSimpleMessageHtml: omits the CTA when no homeUrl is given', () => {
  const html = buildSimpleMessageHtml('Something went wrong', 'Try again.');
  assert(!html.includes('class="btn"'));
});
