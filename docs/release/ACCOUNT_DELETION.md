# Account deletion (iOS and Android), status 2026-10-08

STATUS: client and migration are committed on both release lines; the migration is NOT YET APPLIED to production and nothing has been exercised
end to end. The auto mode safety classifier refused to apply the production schema change (even inside one transaction), so it waits for Jerry.
The website page /delete-account is built in ~/Downloads/getcheckoff-site (public/delete-account/index.html) but NOT published, because it describes
behavior that must first be proven by the disposable account test.

## Root causes (verified from live definitions, read only)
1. Four NO ACTION foreign keys into users block the old `delete_my_account()` (it deleted `auth.users` and relied on cascades): `interaction_events.user_id`
   (47 users have rows), `campaign_sends.user_id` (126 users), `partner_promotions.created_by`, `users.referred_by`; plus `creators.user_id` -> auth.users.
2. Stored files were never removed: deleting rows does not delete Storage objects (`checkin-photos/<uid>/...`, `submission-photos/cover-candidates/...`).
3. The function also only anonymized and did not revoke access in a way that survived partial failure, and nothing recorded progress.
4. No public deletion route existed (Play requires a web link), and the privacy page described the unreliable behavior.

## Design (migration supabase/migrations/20261008d_account_deletion_pipeline.sql)
`delete_my_account()` (same name, so every installed build works): identity is auth.uid(), no parameter; refuses is_admin accounts; inventories the user's
Storage objects BEFORE anything is removed (owner_id, own prefix in checkin-photos, own check-in photo URLs, own cover candidate files), bans the auth user,
revokes every session, removes push tokens, then runs `account_deletion_process()`. Returns `completed` (no stored files) or `accepted` (cleanup queued).
`account_deletion_process()` (postgres/service role only; pg_cron every minute; no HTTP endpoint): (1) Storage API bulk delete via pg_net, verified against
storage.objects on the next tick; (2) `account_deletion_delete_data()`: transfers lists other members still use (longest standing member), deletes solo lists,
deletes interaction_events, campaign_sends, notification_log, nulls users.referred_by / partner_promotions.created_by / creators.user_id, then deletes the
users row (cascades the rest, others' content set NULL by its own FK); (3) deletes the auth user, clears identifiers on the request row (kept 30 days).
Each step persists status, so any failure resumes automatically; completion is never reported while a step is unresolved.

Deleted: profile, check ins and their photos and notes, visits and recovery logs, interaction events, campaign send log, notification log, push tokens, badges,
saved items/crew, friendships, dares to or from the user, referrals, list memberships, solo lists, the user's cover photo candidates (rows and files), the auth account.
Anonymized: items.submitted_by, list_items.added_by, item_flags.user_id, user_suggestions.user_id; referred_by on other accounts; creators.user_id.
Transferred: lists with other members. Refused: staff (is_admin).
Not under our control: provider side records (Resend send logs, Sentry events, Expo push logs, provider server logs and backups).

## Clients (both lines)
lib/accountDeletion.js: one helper calls `delete_my_account` with no arguments; failure leaves the user signed in and nothing cleared; acceptance clears visit
recovery and geofence registrations, the flag cache and per account debounce keys, then signs out. Copy distinguishes "Account deleted" from "Deletion started".
A banned (deleted or deleting) account sees a clear sign in message. Commits: Android release/android-1.1.10 21c7dec; iOS production/1.1.10-canonical 8b95ab6 + 40eb372.
Compatibility: the RPC keeps its name and returns void or jsonb handling is tolerant, so installed iOS 86ac0036 and Android 53ba13b5 builds already gain the fixed backend
the moment the migration is applied, with no client update required. The client changes only improve local cleanup and messaging (JavaScript only, OTA eligible).

## Apply and verify (needs Jerry's approval for the production DDL)
    cd /Users/jerrystuckart/Downloads/checkoff
    (echo "begin;"; cat .claude/worktrees/android-1110/supabase/migrations/20261008d_account_deletion_pipeline.sql; echo; echo "commit;") > /tmp/apply_deletion.sql
    supabase db query -f /tmp/apply_deletion.sql --linked
Rollback: docs/security/rollback_delete_my_account_pre_20261008d.sql (restores the old function) plus `select cron.unschedule('process-account-deletions')`.
Then the disposable account test (never real accounts): two synthetic users A (deleted) and B (bystander); A has check ins with uploaded photos, interaction events, a
campaign_sends row, a visit recovery row, a cover candidate with an uploaded file, a solo list and a shared list with B; B has referred_by = A and a dare with A.
Expect: A's auth user, profile, rows and files gone; B's records, the shared list (now owned by B) and B's check ins intact; unauthenticated and anon calls rejected;
B cannot delete A (no id parameter exists; cross account helper functions are not executable by clients); a repeated request returns the same request; a forced step
failure (A made an admin after acceptance) leaves the account banned and data intact, then completes after the fault is removed.

## Open items and unverified concerns
- Not yet verified: everything under "Apply and verify". Nothing is claimed deleted until that test runs.
- Sign in with Apple token revocation is NOT implemented (needs the Apple private key on a server; the key is only local). Apple recommends it; the web page tells users to disconnect CheckOff in Apple ID settings.
- support@getcheckoff.com has an MX record (AWS SES inbound); delivery to a person was not tested (no test email was sent).
- Supabase CLI management token is invalid (`supabase login` needed), so Edge Functions cannot be deployed from this machine; the pipeline therefore lives in the database.
- Behavior change to confirm with Jerry: deleting a user also deletes their cover photo candidates, including photos currently selected as place covers (59 selected rows exist across users); items fall back to default art.
- iOS and Android OTAs are NOT published: they should follow the backend verification (JavaScript only, runtimes 86ac0036 and 53ba13b5; Sentry token not available locally).
