# Monthly recap campaign runbook

Last updated 2026-10-01 for the September 2026 recap (`month = 2026-09`, campaign `recap_2026-09`).

## What it is
- `send-recap-campaign` (edge function) builds and sends the recap. `campaign-link` (public) records clicks, votes and unsubscribes.
- Audience: RPC `get_recap_campaign_audience(month_start, month_end)`. Cities: RPC `get_recap_campaign_cities(as_of)`. Both are service role only.
- Segments: `ACTIVE_MONTH`, `FALL_CONTINUATION`, `RETURNING_INACTIVE`, `NEVER_CHECKED_OFF` (rendered two ways: known metro, unknown metro).
- Everything is month driven by the explicit `month` argument. Per month editorial content (which metros were new) lives in `MONTHLY_NEW_METRO_SLUGS` in `_shared/campaignContent.ts`.

## Who can call it
Every mode needs `Authorization: Bearer <service role key>` (or the key as `apikey`), or `x-campaign-secret: <CAMPAIGN_ADMIN_SECRET>` (24+ characters). The public anon key is always refused (403). The shared `ADMIN_SECRET` is deliberately not accepted.
Set or rotate the dedicated secret (value never goes in the repo):
`supabase secrets set CAMPAIGN_ADMIN_SECRET=<random 48 hex> --project-ref uggusbbswybyplypkbxz`

## Modes (month and mode are required; there are no defaults)
| mode | effect |
|---|---|
| `preview` | renders HTML. `previewSynthetic:true` (with `testUserId`) is identity free and writes nothing. `previewUserId` and `previewAllSegments` render real recipients (privileged data). |
| `dry_run` | WRITES `campaign_sends` rows with status `dry_run`. Prefer the read only SQL below. |
| `test_send` | five variants to ONE approved address (`APPROVED_TEST_RECIPIENTS` plus `CAMPAIGN_TEST_RECIPIENTS`), synthetic rows, campaign id `recap_<month>_test`, `testUserId` must be an internal or suppressed test account. Never modifies users. |
| `send` | production. Needs all of: `CAMPAIGN_ALLOW_PRODUCTION_SEND=true`, a closed month, `confirmEligibleCount` equal to the live eligible count, no duplicate or invalid recipient emails, and NO `testEmailOverride`. |

## Production send safety
- Each recipient is claimed first (`campaign_sends.status='sending'`, unique per campaign and user), then Resend is called with an `Idempotency-Key`, then the row becomes `sent`. A row left in `sending` means the outcome is unknown; reconcile in Resend before touching it. A `failed` row frees the claim.
- Use `limit` for a first small batch. Turn the gate off again afterwards: `supabase secrets unset CAMPAIGN_ALLOW_PRODUCTION_SEND`.
- Unsubscribe is scanner safe: GET and HEAD never opt anyone out. Only the confirmation page POST (`confirm=1`) or an RFC 8058 one click POST does.

## Read only audience calculation (no rows written)
```sql
SET TRANSACTION READ ONLY;
WITH a AS (SELECT * FROM get_recap_campaign_audience('2026-09-01'::date, '2026-10-01'::date))
SELECT segment, coalesce(exclusion_reason,'-') reason, count(*) FROM a GROUP BY 1,2 ORDER BY 1,2;
```
Run with `supabase db query --linked -f file.sql`. `SET TRANSACTION READ ONLY;` must be the first statement (the `SET SESSION CHARACTERISTICS` form does not take effect through this CLI).
Reconcile: users = rpc rows = eligible + excluded; segment sums = eligible; metro sums = total; RPC visible checkoffs = `count(*)` of `check_ins` in the month.

## Suppression
Internal accounts: email domain `getcheckoff.com`. Known test accounts: rows in `campaign_suppressions` (by user id). Opt out, bounced, deleted, missing or invalid email, accounts under 14 days old with no checkoffs, and users with no resolvable active metro are excluded.

## Tests
`deno test --no-lock supabase/functions/` and `deno run --no-lock --allow-read --allow-env scripts/recap-smoke-test.ts` (add `--allow-net=getcheckoff.com --live` for public page checks). Site: `node --test public/unsubscribe/unsubscribe-page.test.js` in getcheckoff-site.

## Known follow-ups
- Resend bounce and complaint webhook is not wired (`email_bounced` is never set automatically).
- `docs/email-campaigns/august-2026-recap/` is tracked and contains recipient data; clean up separately (do not rewrite history without a decision).
- `users.platform` is empty for every user, so the update block shows both stores.

## September 2026 send record (2026-10-01)
Sent once, to the reconciled eligible audience, after Jerry approved all five variants and every button on a real iPhone (TestFlight 1.1.10, build 155).
- Campaign `recap_2026-09`; deployed `send-recap-campaign` v15 and `campaign-link` v13, source preserved on the remote branch `recap/september-2026-link-routing`.
- Audience: 130 users, 123 eligible, 7 excluded (2 internal, 2 test, 2 no resolvable metro, 1 opted out). Segments: 11 active, 2 Fall continuation, 18 returning inactive, 92 never checked off (49 known metro, 43 unknown). September checkoffs visible to the RPC equal the canonical count (152).
- Delivery: sent in three guarded batches (10, then 50 new, then 63 new; the earlier recipients were skipped by idempotency). 123 accepted by Resend, 0 failed, 0 duplicates. "Accepted" is not "delivered": review delivery in the Resend dashboard (search by message id), and clicks, votes and unsubscribes in `interaction_events` where `campaign_id = 'recap_2026-09'` (event types `*_click`, `next_metro_vote_submitted`, `unsubscribe`).
- The production gate was open for about three minutes and then removed; `CAMPAIGN_ALLOW_PRODUCTION_SEND` is absent. `CAMPAIGN_ADMIN_SECRET` was rotated before the send.

### Link routing and apps
- Canonical links: `/open`, `/item/<uuid>`, `/list?id=<uuid>`, `/metro?slug=<slug>` (see `lib/emailLinkContract.js`). An explicit link outranks live location, the persisted metro and the nearest metro for the session; it is never persisted.
- iOS: OTA on runtime `86ac0036` (TestFlight 1.1.10) and on runtime `81dbd1f1` (public 1.1.9). The public 1.1.9 update was published from `release/ios-1.1.9-runtime-81dbd1f1-link-routing` (the release tip plus exactly the routing files); reproduce that runtime with `app.json` set to version 1.1.9, ios.buildNumber 155 (uncommitted), then `eas update --branch production --platform ios --environment production --non-interactive`.
- A link in an email reaches the app in two steps on iOS: the tracked redirect opens the web page, and its Open in CheckOff button hands the id to the app. Server redirects cannot trigger Universal Links.
- Android: no OTA was published. Android build 1.1.9 (versionCode 17) was not accepted on Google Play (undeclared location permissions in the Play Console declaration), so the live Android binary is older and no EAS build reports the runtime the earlier Android OTAs target. Android users get the web fallback pages. Native App Links for `/open`, `/item`, `/list`, `/metro` are prepared on the local branch `android/app-links-open-item-list-metro` and need a new native build (app.json is part of the runtime fingerprint, so never ship it as an OTA).
- Social: September used Instagram only (`https://www.instagram.com/checkoff.app/`). CheckOff also has Facebook and TikTok accounts, but their exact URLs are not yet supplied or verified. Follow-up for the October recap: obtain the exact URLs, verify them from an authoritative production source, add them to `OFFICIAL_SOCIAL_LINKS` in `_shared/campaignContent.ts`, and test before sending.
