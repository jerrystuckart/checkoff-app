# Account deletion (iOS and Android), revision 2, 2026-10-08

STATUS: written and unit tested, NOT applied to production, NOT exercised end to end. Production is unchanged. The website pages and client OTAs are NOT published.
The migration `supabase/migrations/20261008d_account_deletion_pipeline.sql` is the REVISED file and supersedes revision 1 (commit 21c7dec). Reviewable diff against revision 1:
`docs/release/ACCOUNT_DELETION_migration_rev1_to_rev2.diff`.

## Root causes (verified from live definitions, read only)
1. Four NO ACTION foreign keys into users block the old `delete_my_account()`: `interaction_events.user_id` (47 users have rows), `campaign_sends.user_id` (126 users),
   `partner_promotions.created_by`, `users.referred_by`; plus `creators.user_id` -> auth.users. The old function deleted `auth.users` and relied on cascades.
2. Stored files were never removed (deleting rows does not delete Storage objects).
3. No public deletion route existed (Play requires a web link).

## Product decisions (Jerry) and what they mean in the migration
- Photos submitted as CheckOff content are RETAINED, including catalog covers: `item_cover_candidates` rows (selected, approved, pending, business) keep their file. Attribution is removed:
  `submitted_by_user_id` -> NULL; the file is MOVED (Storage API) from `cover-candidates/<uid>/...` to `cover-candidates/retained/<candidate id>.<ext>` because the old path embeds the uploader id;
  `storage.objects.owner/owner_id` cleared; any occurrence of the user id in `moderation_metadata` / `rejection_reason` scrubbed. `storage_path` is updated in the same step the move is verified,
  and the storage policy "anyone can view selected cover photos" is keyed on that path, so signed URLs for retained covers keep working (to be proven in the disposable test).
  REJECTED candidates were never accepted as content and are deleted with the account (judgment call, one condition in `account_deletion_retain_inventory`; flip to retain them too).
- Private account files are DELETED: `checkin-photos/<uid>/...` and anything else the user owns (`owner_id`). Check in photos are treated as account activity, not catalog content (judgment call: confirm).
  Avatars: `users.avatar_url` is NULL for all users and there is no avatar bucket, so there is nothing to retain or delete; any object a user owned is caught by the `owner_id` rule. `creators.avatar_url` belongs to
  public creator pages, which are detached from the login (`creators.user_id` -> NULL), not deleted.
- Admins: deletion is supported unless the account is the ONLY administrator or the ONLY photo administrator (`photo_admins` has one row today, the owner); the error tells the user what to do first
  (make another account an administrator / add another photo administrator). Lists the deleted admin owned that are official or destination lists go to another admin.
- Completed CheckOff history is kept as ANONYMOUS COUNTS (next section).
- `support@getcheckoff.com` delivery is confirmed by Jerry.

## Anonymous completion counts (new table `anonymous_completion_counts`)
Inspected first: reporting that counts check ins is `get-partner-data` (partner portal: total and this month per business) and `send-partner-recap` (monthly emails, last and previous calendar month),
both via `items.partner_id`. `get_whats_good_momentum_contributions` (recency ranking) and the `leaderboard` view are per user activity and simply lose the deleted user. So the granularity needed is
per experience (item), per calendar month.
Table: `(item_id, period_month, method, completions)`, primary key on the first three. NO user id, profile link, list or list item, check in id, candidate or presence session id, coordinates, note, photo, or day.
`method` is a coarse bucket (`tap`, `photo`, `confirmed_suggestion` = the user confirmed a recovery suggestion, `retroactive`). Only rows from `check_ins` (confirmed CheckOffs) are read; detected visits,
presence sessions, candidate visits and pending or dismissed suggestions are never counted, and nothing labels a completion a "verified business visit".
One completion = one confirmed check in per experience per day (fan out mirror rows on other lists are the same real action), so a deleted user's counts can be lower than the raw row counts the old reports showed.
Exactly once: counts are written inside `account_deletion_delete_data()`, the same transaction that deletes the rows they came from, and guarded by `account_deletion_requests.counts_recorded` under a row lock.
Reporting: `anonymous_completions_for_items(item_ids, month)` (service role). `get-partner-data` and `send-partner-recap` add it (additive, fail safe); THOSE EDGE FUNCTION CHANGES ARE NOT DEPLOYED (CLI login invalid), so until
they are deployed deleted users' completions are missing from partner totals.
Residual risk, stated honestly: these are small counts about public places; someone who independently knows what a person did could recognize it in a cell, and a retained photo's `item_id`/timestamps sit in the same
catalog. The counts do not identify anyone and nothing joins them to an account, but they are not claimed to be mathematically anonymous. Retained candidates keep `created_at`/`submitted_at` (not coarsened).

## Licensing: unresolved, flagged for Jerry (no rights language was invented)
- Terms of Service (updated April 17, 2026), section 3: "You retain ownership of content you post. By posting content, you grant CheckOff a non-exclusive, royalty-free license to store, display, and distribute that content within the Service."
  Section 10: "We will delete your personal data within 30 days per our Privacy Policy." Nothing says the license survives account deletion or is perpetual or irrevocable.
- The in app cover photo consent (`CoverCandidateCaptureScreen`): "By sharing, you're giving CheckOff permission to display this photo in the app if it's approved. It won't be public until then." Nothing about duration or deletion.
- Reading: continued display inside CheckOff after the account is deleted is within the scope of what was granted (non-exclusive, within the Service, no termination clause), but neither document says it SURVIVES deletion, and users were not told their name would be
  removed while the photo stays. The privacy page and deletion page now say exactly what happens and quote the Terms; they make no ownership claim. Recommended (not done): counsel reviewed Terms/consent wording that states survival and attribution removal, applied going forward.
- EXIF in retained image files was not inspected; whether capture strips location metadata is unverified.

## Sign in with Apple
Inspected: the app signs in natively (`signInWithIdToken`), so Supabase never receives or stores Apple's authorization code or refresh token (nothing stored to revoke). Revocation therefore needs a FRESH authorization code from the device plus an ES256 client secret signed with
the Sign in with Apple key. The key (`AuthKey_82ZW59TB9L.p8`, Team 8955P69JB8, Key 82ZW59TB9L) exists only on this machine (gitignored, 0 tracked). Postgres cannot sign ES256, so this must be an Edge Function, and the Supabase CLI management token is invalid (`supabase login`
required), so it cannot be deployed or given secrets from here.
Implemented, DORMANT until deployed: `supabase/functions/revoke-apple-token` (verifies the caller, requires an Apple identity, signs the client secret from `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_BUNDLE_ID` secrets, exchanges the code, revokes; no logging, generic errors) and
`lib/appleRevocation.js` (iOS only; a preflight asks the function whether it can revoke, and only then shows one Apple sheet; it never throws, times out at 8 s, and deletion never waits on it). Until the function exists the user sees no extra prompt and the deletion page tells
users to disconnect CheckOff in Apple Account settings. To activate: `supabase login`; `supabase secrets set APPLE_TEAM_ID=... APPLE_KEY_ID=... APPLE_BUNDLE_ID=com.checkoff.app APPLE_PRIVATE_KEY="$(cat AuthKey_82ZW59TB9L.p8)"`; `supabase functions deploy revoke-apple-token`.
Also unverified: whether the Apple client id for native sign in is the bundle id (`com.checkoff.app`, the identity token audience) rather than the Services ID `com.checkoff.services` used by the web flow; test with a real Apple account before relying on it.

## Pipeline (one backend contract for iOS and Android; the RPC keeps its name so installed builds benefit immediately)
`delete_my_account()`: identity is `auth.uid()`; no user id parameter; refuses only the sole administrator / sole photo administrator; inventories retained and private files BEFORE removing anything; bans the auth user and revokes sessions and push tokens; runs the processor; returns `completed` or
`accepted` (access blocked, cleanup queued; not the same as completed). `account_deletion_process()` (no HTTP endpoint; once inside the RPC and every minute from pg_cron): move retained photos (verify, then anonymize rows) -> delete private files (verify none remain) ->
`account_deletion_delete_data()` (one transaction: anonymous counts exactly once, list transfer or deletion, the NO ACTION foreign keys, the users row and its cascades) -> delete the auth user and clear identifiers. Every step persists and resumes.
Anonymized by their own foreign keys: `items.submitted_by`, `list_items.added_by`, `item_flags.user_id`, `user_suggestions.user_id`; `users.referred_by` on other accounts; `creators.user_id`.

## Verification status
- Done: 1316 unit and structural tests pass (client contract, migration structure, anonymous count shape, retention ordering, admin rule, Apple helper never blocks, reporting hooks).
- NOT done: any run against the database. There is no local Postgres or Docker, and the production schema change was denied by the automatic approval review. Nothing is claimed deleted, retained, counted or signed until the disposable account test runs.
- Test plan (synthetic accounts only, never real users; signup needs email confirmation so confirm via SQL on the synthetic address):
  A (deleted): check ins with uploaded photos, interaction events, campaign_sends row, visit recovery rows incl. a confirmed candidate, a selected cover candidate with an uploaded file and an ordinary one, a rejected one, a solo list, a shared list with B, B.referred_by = A, a dare with B.
  B (bystander): own check ins, the shared list, a check in on A's list. C (forced failure): made the last-but-one administrator after acceptance to force a data-step failure, then resumed. Expect: A auth user and profile gone; private files gone; retained cover file at the neutral path with
  NULL submitter and no uid in path or metadata and a signed URL for B still returning the image; anonymous cells equal the expected counts exactly once even after calling the processor repeatedly; no table or join reachable by a client can map the cells or the photo back to A; B's data and the shared list (now owned by B) intact;
  unauthenticated and anon calls rejected; a client cannot call any helper; sole administrator refusal message; a repeated request returns the same request.

## Open items
1. Production schema change awaiting an approval the automatic reviewer will accept (see handoff for the exact command). 2. Deploy `get-partner-data`, `send-partner-recap`, `revoke-apple-token` (needs `supabase login`). 3. Website pages (`/delete-account`, privacy sections 5 and 7) prepared in ~/Downloads/getcheckoff-site, unpublished.
4. Partner portal (`get-partner-data`) returns recent check in photos of check ins on a partner's items (no names), which the published privacy policy did not say; the prepared privacy edit corrects section 5. Decide whether partners should see member photos at all.
5. Licensing wording (above). 6. Sentry source maps for any OTA: no Sentry token is available locally; an OTA would ship without maps unless the token is provided.
