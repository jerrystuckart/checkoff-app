# Account deletion: disposable account phone test (iOS and Android)

NEVER use your admin account, `testingcheckoff@gmail.com` or any real account for this: deletion is permanent. Use a brand new throwaway account made for the test.
Throwaway address: one you control that receives mail, for example a Gmail plus alias (`yourname+deltest1@gmail.com`). Use a different alias per run.

## What you will see depends on the build on the phone
- TODAY (installed builds: iOS TestFlight 1.1.10, Android Play internal 1.1.10 (21)): the old screen calls the old RPC. You confirm twice and are SIGNED OUT with no message about completion. The deletion itself runs on the server and is the new, verified pipeline.
- AFTER the client OTA is published (needs the Sentry token, see ACCOUNT_DELETION.md): the same screen shows either "Account deleted" or "Deletion started" (access is closed, cleanup finishes in a few minutes), and signing in again says the account "has been deleted or is being deleted".
Both are correct for their build. The server result is what matters, and I verify it.

## iOS (TestFlight 1.1.10, an iPhone)
1. Open CheckOff while signed out. Tap Sign up. Name `Delete Test`, your plus alias, a throwaway password. Confirm the email, sign in.
2. Check off two things on the list. For one of them use the photo check in and take a photo (this puts a file in storage). If you are offered "share this photo with CheckOff", accept once (this creates a retained cover photo to test).
3. Profile tab > scroll down > Delete Account. Read the first alert, tap Continue. Read the second alert, tap Delete my account.
4. Expect: you land on Home signed out. (After the OTA: an alert, "Account deleted" or "Deletion started".)
5. Try to sign in again with the same email and password. Expect a refusal (today the server says "User is banned" or "Invalid login credentials"; after the OTA a clear "has been deleted or is being deleted").
6. Wait 3 minutes. Message me the alias. I check on the server: the account, profile, check ins and photo are gone, the request completed, the retained photo is anonymous, the anonymous counts were added once.
7. Optional failure test: put the phone in airplane mode, repeat step 3. Expect an error alert and that you are STILL signed in (nothing deleted). Turn airplane mode off and retry.
Do not test Sign in with Apple deletion yet: Apple token revocation is not deployed, see ACCOUNT_DELETION.md.

## Android (Play internal testing 1.1.10 (21), a Pixel or similar)
1. Open CheckOff signed out. Sign up with a fresh plus alias, confirm the email, sign in.
2. Same as iOS step 2 (two check offs, one with a photo, accept the cover photo share once).
3. Profile > Delete Account > Continue > Delete my account.
4. Expect: signed out on Home. (After the OTA: "Account deleted" or "Deletion started".)
5. Try to sign in again: expect a refusal.
6. Wait 3 minutes, message me the alias; I verify the server the same way.
7. Optional failure test: airplane mode, repeat step 3, expect an error and still signed in; retry online.
Android only: do NOT turn on visit recovery for this account (it would register geofences); if you do, deletion still clears them on the phone, but it is not part of this test.

## What I check after you send the alias (read only)
Auth user and profile gone; check ins, events, settings gone; request row completed with no identifier; the photo file moved to a neutral path and the old URL dead; the cover candidate unattributed with unchanged visibility; one anonymous count per experience per month; no trace of the id or email in any table.

## Result log
### iPhone (TestFlight 1.1.10 build 157, iOS OTA 01a11ca4), 2026-10-08, email signup account
- Deleted via Profile at about 13:42 America/Phoenix. The app showed "Deletion started" (access closed, signed out, automatic cleanup).
- Server verification (read-only comparison against a private pre-deletion baseline kept outside the repo): request accepted 13:42:26, COMPLETED 13:43:00, 1 attempt, no error, request row holds no user id. ALL checks passed: auth account/sessions/identities and every account linked row gone (check ins, badges, saved items, interaction and geofence rows, recovery settings, candidate and presence rows, the pending Doaky suggestion, notification queue trace); the two check in photos and the cover submission retained at neutral paths with identical size and content checksum, no owner, old paths dead, visibility unchanged (check in photos public as before; cover private, still needs_review, not display eligible, not selected, no submitter); anonymous October counts +1 each for the two completed experiences, nothing for the suggestion; other users' totals unchanged; the separate Android test account untouched.
- Not tested: Sign in with Apple deletion/revocation (this account used email signup). Apple revocation function is deployed but has no real-device test yet.
- Short lived technical trace: none found in the pg_net response table at check time.

### Open follow-ups (documented, not started)
1. Earned badges were stored but neither new account showed the badge celebration or notification.
2. Secret Reveal needs a more rewarding visual design.
3. Android delayed exits inflated Wild Pine dwell (exit delivered with the next venue's entry); sentinel retries are noisy (many gated_min_gap registration rows within seconds).
4. Barley & Smoke has no visit profile assigned (excluded from monitoring: no_visit_profile_assigned).
