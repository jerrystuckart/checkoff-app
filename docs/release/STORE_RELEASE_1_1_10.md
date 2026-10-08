# CheckOff 1.1.10: store release readiness (AUTHORITATIVE, 2026-10-08)

This is the single current source of truth for submitting 1.1.10 to the App Store and Google Play. Where another file disagrees, this one wins.
Superseded and reduced to pointers: `STORE_DISCLOSURES_1_1_10.md`, `docs/visit-recovery/APP_STORE_1.1.9.md`, `docs/visit-recovery/android/PLAY_SUBMISSION_DRAFTS.md`.
Nothing here has been entered in App Store Connect or Play Console. No private identifiers, credentials or paths are in this file.

Basis: the code at `production/1.1.10-canonical` and `release/android-1.1.10`, the deployed backend (read-only checks on 2026-10-08), the live pages
https://getcheckoff.com/privacy (updated 2026-10-08) and https://getcheckoff.com/delete-account, and official guidance fetched 2026-10-08:
Google Play background location policy (support.google.com/googleplay/android-developer/answer/9799150), Data safety (answer/10787469), account deletion (answer/13327111),
Play target API level (developer.android.com/google/play/requirements/target-sdk); Apple App Review Guidelines (developer.apple.com/app-store/review/guidelines),
App Privacy Details (developer.apple.com/app-store/app-privacy-details), Offering account deletion (developer.apple.com/support/offering-account-deletion-in-your-app).

## 1. Verdict

| | iOS | Android |
|---|---|---|
| Existing binary | TestFlight 1.1.10 (shows build 157), runtime `86ac0036db685dec7e1921f661d6b77ede23965e` = `docs/release/EXPECTED_RUNTIME` | Play internal testing 1.1.10 versionCode 21, runtime `53ba13b59fec2f2667b5ce1f9568e19f8f5076b3` (equals the AAB's embedded fingerprint) |
| Submittable as is? | **Yes**, with one accepted imperfection: the "Always" location string overstates notifications (section 6) | **Yes** for closed testing/production once the Play Console items in section 9 are done. Technically eligible; approval of Background Location is the open risk (section 4) |
| Needs a new binary for correctness? | No | No |
| OTAs (JavaScript only) | account deletion client published to production on 86ac0036 (group 4a0064b9) | account deletion client published to production on 53ba13b5 (group 5c41dbeb) |

Native limitation: anything in `app.json` (Info.plist strings, permissions), `package.json`, plugins or `modules/` changes the runtime fingerprint. A binary built after such a change is
cut off from OTAs published for the current runtimes, and the current binaries cannot receive the change by OTA. Therefore none of the native items below is fixable without a new
binary: iOS location purpose strings, Android unused permissions (`RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`), `ACCESS_BACKGROUND_LOCATION`.

What the binary contains versus what reviewers will run: the review build embeds JavaScript from build time; the app downloads the newest OTA on launch and applies it on the NEXT launch.
Tell reviewers to launch the app twice (section 8) so they see the account deletion screens and the final behavior.

## 2. Evidence summary (what is verified and what is not)

Verified:
- Visit recovery on both phones, real background visits: Android detected qualifying stops while the app was backgrounded (suggestions recorded server side, arrival/departure and dwell stored,
  confirmed and points awarded per the owner's report); iPhone detected a stop through its own opt-in. Server-side candidate and registration records agree. Known quality issue (not a blocker): an
  Android exit can be delivered late and inflate the dwell figure.
- Account deletion, email account, iPhone: request accepted and completed within about 35 seconds; auth account and all personal rows removed; submitted photos retained at neutral paths with
  identical size and checksum, no owner; visibility unchanged; anonymous completion counts added once; no notification-queue trace; other users and the Android test account unaffected.
  Details: `ACCOUNT_DELETION.md` and `DELETION_PHONE_TEST.md`.
- Live pages: privacy (updated 2026-10-08), delete-account, support, terms all return 200.
- Android manifest of the 53ba13b5 build (inspected from a built AAB with the same runtime): ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, ACCESS_BACKGROUND_LOCATION, CAMERA, POST_NOTIFICATIONS,
  INTERNET, ACCESS_NETWORK_STATE, VIBRATE, WAKE_LOCK, RECEIVE_BOOT_COMPLETED, READ/WRITE_EXTERNAL_STORAGE (legacy, API 32 and below), RECORD_AUDIO and SYSTEM_ALERT_WINDOW (unused library defaults),
  badge and install-referrer library permissions, Google Sign-In revocation. No foreground service permissions. Target SDK comes from the React Native default (36); confirm in Play Console after upload.

Not verified (do not claim):
- Apple token revocation: deployed and configured, never exercised with a real Apple account (section 7). Fake authorization codes only prove that Apple accepts the signed client secret.
- Badge celebration and the latest Secret Reveal on a phone (owner checks pending).
- Optional reveal image/crop migration: not applied; the feature degrades gracefully without it (see `SECRET_REVEAL_IMAGES.md`).
- Whether Play approves background location; whether Apple accepts the purpose strings.
- Android Doze/OEM behavior beyond the two test phones.

## 3. Facts that drive every answer (implementation evidence)

- Foreground location (Nearby, Hubs, nearest city, Secret unlock, the check-off presence gate in `lib/geoFence.js`) is processed on the device. No coordinate or map area is sent. Check-ins store no location.
  The gate DOES use location to confirm the user is within the item's radius before a located item can be checked off (universal and coordinate-less items are never fenced), which makes the
  iOS "verify GPS check-ins" wording accurate. (An earlier version of these notes said otherwise; that was wrong.)
- Visit recovery is opt-in per account (off by default), needs "Always"/"Allow all the time", and sends arrival and departure with latitude, longitude and accuracy to the server
  (`visit_presence_*` RPCs), plus a request for catalog places inside a roughly 120 km window around the position (the window is not stored; hosting logs may contain it).
  Server retention (cleanup job runs daily; verified current): presence sessions 2 days, suggestions 7 days + 1 day (confirmed: 30 days), technical registration/debug logs 14 days, registration position rounded to about 100 m.
- Nothing is checked off automatically. A qualifying visit is a private suggestion; the user confirms. Server master flag `candidate_visit_detection` is the kill switch (currently ON for everyone;
  one user-level override exists for testing). Real-time "nearby" push notifications (`realtime_nearby_checkoff_notifications`) and "still here" reminders (`at_place_checkoff_reminders`, no row) are NOT enabled for ordinary users.
- Third parties (all processors acting for CheckOff, none advertising): Supabase (database, auth, storage, edge functions), Sentry (crash reports; default `Sentry.init`, no `setUser`, no tracing, no replay, no PII flag),
  Expo (push delivery service, EAS Update checks which send runtime/platform/channel, no account data) with Apple APNs and Google FCM, Resend (email), Sign in with Apple, Google Sign-In.
  No ad SDK, no App Tracking Transparency, no advertising ID, no analytics SDK (usage events go to our own `interaction_events` table, tied to the account id, no coordinates).
- Account deletion: in app (Profile > Delete Account) and on the web (email request, no app needed). Retained after deletion and disclosed on the page and policy: submitted photo files (anonymized, neutral
  paths, attribution removed, visibility unchanged) and anonymous per-experience monthly completion counts.
- Catalog: 2,020 active items; 290 universal (checkable anywhere with a tap); 313 involve alcohol (users can hide them); no ads; no in-app purchases (partner billing is on the web through Stripe).

## 4. Google Play

### 4a. Background Location declaration (App content > Sensitive app permissions > Location permissions)
Google's rules (fetched): declare ONE feature; background access must be needed for the app's CORE functionality (main purpose; without it the app would be broken); convenience and personalization are
"minimal" benefit; a prominent in-app disclosure must appear before the runtime prompt and contain the word "location" and a background phrase such as "when the app is closed or not in use";
the video must show the feature activating while the app is not in use, the disclosure and the runtime prompt, on Android; credentials must be valid; closed and open tracks are also subject to review.

HONEST RISK: visit recovery is optional and convenience-grade. Google may decide it is not core functionality. Do not describe it as more than it is. If declined, the fallback is a new Android binary without
`ACCESS_BACKGROUND_LOCATION` and the recovery code path (new runtime; recovery hidden). iOS is unaffected.

Feature to declare: "Visit recovery (Recover checkoffs you forgot)".

Copy-ready answers:
- What does the feature do and why does it need background location? "CheckOff is a checklist of local experiences. Its core purpose is recording the things you actually did. People often forget to record an experience
  after they leave. Visit recovery notices, while the app is closed or not in use, when the phone arrives at and leaves a CheckOff place (Android geofences through Google Play services, up to 40 regions, no continuous
  GPS, no foreground service). If the time spent qualifies, the app stores a private suggestion that the user can confirm later. Foreground location cannot do this because the arrival and departure happen while the
  phone is in a pocket and the app is closed."
- User control: "Off by default. The user taps Turn On, reads a full-screen disclosure, grants precise location, then chooses Allow all the time on the system settings page. Turning it off in Profile stops monitoring and
  deletes saved visits. Nothing is checked off automatically; the user confirms every suggestion. Location is not used for ads or analytics and is never sold."
- Is the feature in the app's core functionality? Answer truthfully that it is an optional feature supporting the app's core purpose (recording experiences); do not claim the app is unusable without it.

Prominent disclosure as shipped (`lib/visitDetection/androidDisclosure.js`): "CheckOff uses your location in the background to recognize when you spend enough time at places in our catalog, even when the app is closed.
Your location creates private visit suggestions. Nothing is checked off until you confirm it. You can turn this off anytime and delete your saved visits." It contains "location" and "even when the app is closed", appears on an
explicit tap before the runtime request, and names the single feature. Optional JavaScript-only improvement (OTA, not a store blocker): add "and sent to our servers" and Google's wording "when the app is closed or not in use".

### 4b. Reviewer instructions for the declaration (paste; do not put credentials in the repo)
"Sign in with the reviewer account in App access. Home shows 'Recover checkoffs you forgot' with a Turn On button (Profile has the same card). Tap Turn On, read the disclosure, tap Continue, allow precise location while using the
app, then choose 'Allow all the time' on the system page. The card shows On. A suggestion appears under 'Places you may have visited' only after the phone spends the place's required time at a catalog place and leaves, which cannot
be reproduced at a desk, so the video shows a real recorded visit. Nothing is checked off until the user taps confirm. Profile > 'Turn off and delete visits' stops monitoring and deletes saved visits."
Do not seed a fabricated visit into production for the reviewer.

### 4c. Review video: shot list (distinguish setup footage from proof)
Google recommends 30 seconds or less; host on YouTube (unlisted) or an accessible Drive link. Two parts, with on-screen captions and a visible clock:
SETUP footage (about 14 s, shows policy compliance, NOT proof that background recovery works):
1. 0:00-0:03 Home, tap Turn On on 'Recover checkoffs you forgot'. 2. 0:03-0:07 Full-screen disclosure, tap Continue. 3. 0:07-0:10 Runtime prompt: Precise, While using the app. 4. 0:10-0:14 System page: Allow all the time; back in app, card shows On.
PROOF footage (about 16 s, shows the feature running while the app is not in use):
5. 0:14-0:18 Press Home; show another app in the foreground (e.g. Maps) so CheckOff is visibly not in use; caption "App closed, phone in pocket". 6. 0:18-0:21 Cut with caption "Visited a coffee shop for 12 minutes, then left" (screen
recording timestamp or system clock visible). 7. 0:21-0:27 Open CheckOff: 'Places you may have visited' shows the suggestion with arrival and departure times. 8. 0:27-0:30 Tap confirm; normal check-in and points; caption "Nothing is checked off until the user confirms".
If 30 s is too tight for readable captions, use up to about 60 s; keep the order. Film on the Android release build. The real Android background visits already exist, so footage 5-8 can be re-recorded from a new short outing. Use the reviewer account or the test account, never an admin screen.

### 4d. Data safety (App content > Data safety). The form is global per package and covers all tracks.
General: collects data: Yes. Shares data: No (processors acting for us are not "sharing"; nothing is sold or used for advertising). Encrypted in transit: Yes. Users can request deletion: Yes. Account creation: Yes. Deletion URL: https://getcheckoff.com/delete-account .
Independent security review: No. Privacy policy URL: https://getcheckoff.com/privacy .

| Category / type | Collected | Shared | Required / optional | Purposes | Basis |
|---|---|---|---|---|---|
| Personal info: Name | Yes | No | Required | App functionality, Account management | display name; name from Apple/Google sign-in |
| Personal info: Email address | Yes | No | Required | App functionality, Account management, Developer communications | account email; reminder and recap emails |
| Personal info: User IDs | Yes | No | Required | App functionality, Analytics, Account management | account id on every record and on usage events |
| Location: Precise location | Yes | No | Optional | App functionality | only visit recovery after opt-in; foreground location stays on device |
| Location: Approximate location | Yes (conservative) | No | Optional | App functionality | the 120 km place-window request; declare because hosting logs may keep it |
| Photos and videos: Photos | Yes | No | Optional | App functionality | photo check-ins and cover submissions |
| Messages: Other in-app messages | Yes | No | Optional | App functionality | dare text sent between users |
| App activity: App interactions | Yes | No | Required | Analytics, App functionality | `interaction_events` |
| App activity: Other user-generated content | Yes | No | Optional | App functionality | notes, place names, list titles |
| App info and performance: Crash logs | Yes | No | Required | App functionality, Analytics | Sentry |
| App info and performance: Diagnostics | Yes | No | Required | App functionality, Analytics | device model, OS, app version in Sentry events |
| Device or other IDs | Yes | No | Optional | App functionality | push token (only if notifications allowed); Sentry install identifier |
Not collected: contacts, calendar, audio (the `RECORD_AUDIO` permission is an unused library default), health, financial, advertising ID, web history, SMS. "Advertising or marketing" purpose: not selected;
the only marketing-like use is our own emails to account holders, covered by Developer communications. Uncertain: whether Google wants Advertising or marketing for re-engagement emails (U7).

### 4e. Account deletion answers
- In-app path: Profile > Delete Account (two confirmations). Web resource: https://getcheckoff.com/delete-account (names CheckOff and the package com.getcheckoff.app; deletion request by email without opening the app; states what is deleted and what is retained).
- Data retained after deletion (disclosed on that page and in the policy): submitted photo files, anonymized (no account, no attribution, visibility unchanged); anonymous monthly completion counts per experience; provider logs short term.
- Timing stated: the app starts deletion immediately and cleanup usually completes within minutes (verified: 35 s); web requests are answered within 30 days.
- Play's partial-deletion option: not offered (full account deletion only).

### 4f. Other Play Console items
- App access: login required. Provide a dedicated reviewer account (section 8), instructions and a note that email confirmation is required for new sign-ups, so the account must be pre-confirmed.
- Target API: must be 36 for updates from 2026-08-31. The build inherits 36 from React Native defaults; confirm in the Play Console app bundle explorer after upload (not verified from a console).
- Closed-testing gate: if the developer account is a personal account created after 2023-11-13, production access requires a closed test with 12 opted-in testers for 14 consecutive days (third-party sources; verify the wording in Play Console). Organization accounts are exempt. Account type is not recorded in the repo.
- Content rating questionnaire and target audience: not child-directed; 13+ per the policy; 313 of 2,020 items reference alcohol (users can hide them). Answer the alcohol reference question honestly (U8).
- Ads: none. Government/finance/health/news declarations: none. Foreground service declaration: not needed (no FGS permission). 
- Store listing must describe the background location feature (Google expects the listing and website to match). Suggested sentence: "Optional visit recovery uses your location in the background, only if you turn it on, to help you recover checkoffs you forgot."
- Upload: promote the existing internal-testing AAB (vc21) to closed testing/production rather than rebuilding. Never rebuild for a documentation change.

## 5. Apple App Store

### 5a. App Privacy (App Store Connect > App Privacy). Tracking: NO (no ATT, no advertising SDK, no data broker).
Apple has no service-provider exemption; Supabase, Sentry and Expo data counts as ours.
| Data type | Collected | Linked to user | Purposes | Note |
|---|---|---|---|---|
| Contact info: Name | Yes | Yes | App Functionality | display name, Apple-provided name |
| Contact info: Email address | Yes | Yes | App Functionality; Developer's Advertising or Marketing | account and reminder/recap email |
| Identifiers: User ID | Yes | Yes | App Functionality; Analytics | account id; interaction events |
| Identifiers: Device ID | Yes (conservative) | Yes | App Functionality | push token; Sentry install identifier (U4, U6) |
| Location: Precise location | Yes | Yes | App Functionality | visit recovery only, after opt-in (ongoing after permission, so the optional-disclosure exemption does not apply); readings kept up to 2 days with 3+ decimals |
| Location: Coarse location | Yes (conservative) | Yes | App Functionality | 120 km place-window request (U3) |
| User content: Photos or videos | Yes | Yes | App Functionality | photo check-ins and cover submissions |
| User content: Other user content | Yes | Yes | App Functionality | notes, place names, lists, dare text |
| Usage data: Product interaction | Yes | Yes | Analytics; App Functionality | `interaction_events` |
| Diagnostics: Crash data | Yes | No (see U6) | App Functionality | Sentry |
| Diagnostics: Performance data | Yes | No | App Functionality | Sentry session/app-start basics |
| Diagnostics: Other diagnostic data | Yes | No | App Functionality | device model, OS, app version |
Foreground location is on-device only and is not declared. If you prefer the conservative reading of U6, mark the three Diagnostics rows Linked = Yes; do not mark Tracking.

### 5b. Required App Store Connect fields
- Privacy Policy URL: https://getcheckoff.com/privacy . Support URL: https://getcheckoff.com/support . (Marketing URL optional.)
- Sign-in required: Yes, supply the reviewer account (section 8). Contact info for review: owner's phone and email.
- Age rating questionnaire (re-answer in App Information; Apple requires the updated questions): alcohol references because 15 percent of items involve bars or alcohol; no gambling, no user-generated public content except photos visible to list members; see U8.
- Export compliance: `ITSAppUsesNonExemptEncryption` is false in the build (standard HTTPS only).
- Build: select the existing TestFlight 1.1.10 build. Xcode 26 / iOS 26 SDK is required for uploads since 2026-04-28; the TestFlight upload already passed that check.
- Release control: Manually release; consider phased release.

### 5c. Review notes (paste into App Review Information > Notes)
"CheckOff is a checklist of local experiences. Sign in with the demo account below (email confirmation is required for new accounts, so the demo account is pre-confirmed). Please launch the app twice on first install so it applies its latest update.
Most items are checked off with one tap; items tied to a place require being physically near it (the app compares the phone's location with the place on the device and does not send it to our servers), so reviewers should pick an item that is not tied to a place (about 290 such items exist; the item detail has no place or distance). OPTIONAL BACKGROUND LOCATION: Profile > 'Recover checkoffs you forgot' > Turn On shows a plain-language explanation, then asks for Location 'Always'. It is off by default and never turned on for the user. When on, iOS region
monitoring and significant-location-change wake the app to note arrival at and departure from CheckOff places, so the user can recover a CheckOff they forgot. Qualifying visits appear as private suggestions in 'Places you may have visited'; NOTHING is checked off or awarded points until the user taps confirm.
The location background mode is used only for this. Arrival at a place cannot be reproduced at a desk, so a screen recording of a real visit is attached. ACCOUNT DELETION: Profile > Delete Account (two confirmations) closes the account immediately and removes the
data in minutes; a web option is at https://getcheckoff.com/delete-account. Sign in with Apple accounts: CheckOff also revokes the Sign in with Apple token at deletion." (Say the last sentence ONLY after section 7 passes.)
Attach a short screen recording of the Always-location explanation, the system prompt, and a real recorded visit becoming a suggestion and being confirmed.

## 6. iOS location purpose strings (audit)
Current strings in the binary (`app.json`, unchanged):
- `NSLocationWhenInUseUsageDescription`: "CheckOff uses your location to show items near you and verify GPS check-ins." Accurate (distance sorting on device and the presence check before a located item is checked off). Could be clearer, not wrong.
- `NSLocationAlwaysAndWhenInUseUsageDescription`: "CheckOff can recognize when you're spending time at a place in our catalog, so it can help recover a CheckOff you forgot or let you know about a nearby pick. Never miss the thing."
  INACCURATE in one clause: "let you know about a nearby pick". Ordinary users get no nearby notifications (`realtime_nearby_checkoff_notifications` is on for one test user only; the at-place reminder flag does not exist). Apple 5.1.1(ii) requires purpose strings that "clearly and completely describe your use of the data".
Recommended replacement copy (for the next native build):
- When in use: "CheckOff uses your location while you use the app to show places near you and to confirm you're at a place when you check it off. For these features your location stays on your phone."
- Always: "If you turn on visit recovery, CheckOff can notice when you arrive at and leave places in our catalog, even when the app is closed, so you can recover a CheckOff you forgot. Arrivals and departures are sent to our servers to make private suggestions. Nothing is checked off until you confirm it."
Needs a new iOS binary? YES (Info.plist is native; an OTA cannot change it). It changes the runtime fingerprint, so a new binary would sit on a NEW runtime and the existing 86ac0036 OTA lineage would not reach it.
Recommendation: submit the existing binary now (the string describes the real feature; the wrong clause is a small overstatement, low rejection risk, not harmful), and put the corrected strings in the next native release.
If you would rather not take that risk, the cost is one local iOS build plus recording the new runtime in `docs/release/EXPECTED_RUNTIME`. This task did not change native config or build anything.

## 7. Apple token revocation: simplest real-device test
Flow in the shipped client: Profile > Delete Account > two confirmations > for accounts with an Apple identity, the app asks the `revoke-apple-token` function whether it can revoke (preflight), shows the Apple sheet once, exchanges the authorization code at
Apple's token endpoint and revokes the token with the bundle id as client id; failure never blocks deletion. Deployed 2026-10-08 with the key and team configured. Apple says apps "should use the Sign in with Apple REST API to revoke user tokens"; 27 existing accounts use Apple.
Constraint: Sign in with Apple yields the same Apple user for the same Apple ID, so testing with your own Apple ID would sign in to (and delete) your Apple-linked admin account. DO NOT. You need a different Apple ID.
Simplest safe test:
1. Use a second Apple ID (a free one created for this, or a family member's) on a second iPhone or iPad. Add that person as a TestFlight internal tester, install the same TestFlight build, open it twice so the OTA applies.
2. On that device: Settings > [name] > Sign-In & Security > Sign in with Apple. Confirm CheckOff is NOT listed. Open CheckOff, Sign in with Apple (share or hide email, either works).
3. Back in Settings > Sign in with Apple: CheckOff now appears. Open CheckOff > Profile > Delete Account > Continue > Delete my account. Complete the Apple sheet when it appears.
4. Expect "Account deleted" or "Deletion started". Re-open Settings > Sign in with Apple: CheckOff must be GONE. That disappearance is the proof; a fake-code test proves nothing about the user's grant.
5. Tell Claude the time; Claude confirms server-side that the deletion completed with the same read-only comparison used for the email test.
Do not mark revocation verified until step 4 passes. If CheckOff stays listed, capture the time and a screenshot; the function replies with a generic reason that the app discards, so check the Supabase Edge Function logs for `revoke-apple-token` around that time.

## 8. Reviewer access (do not commit credentials)
Create two dedicated accounts, one per store, on a real mailbox you control; confirm them; keep the passwords in your password manager. Never use the admin or testing accounts.
1. Supabase dashboard > Authentication > Users > Add user, auto confirm, an address such as a role mailbox on getcheckoff.com. Do not grant admin, photo-admin or tester flags.
2. Sign in once yourself on each platform to verify it works and that Home shows the catalog (reviewers are outside launched cities and will see the city picker; the `BROWSING` state is expected).
3. Enter the email and password only in App Store Connect (Sign-in required) and Play Console (App access). Rotate them after review.
4. Reviewers cannot reach a catalog place, so the located check-off gate will say they are too far; universal 'anywhere' items work. State this in the notes (done above).
Optional: pre-enable nothing else; the recovery flag is global.

## 9. Production blockers versus optional follow-ups

Confirmed blockers before PRODUCTION on the named store:
1. Play: Background Location declaration + video submitted and approved (declaration review also applies to closed testing). Data safety entered. App access credentials. Store listing text. [Google]
2. Play: closed-testing gate if the account is a personal one created after 2023-11-13. [Google, verify in console]
3. Both: enter the privacy/Data safety answers above; reviewer accounts exist and work. [Both]
4. Security (found 2026-10-08, outside the store forms but should be fixed before launch publicity): several Edge Functions have NO caller authorization beyond the gateway JWT, and the gateway accepts the public anon key. By reading
   their handlers: `send-partner-welcome` sends an email to any address supplied in the request; `send-monthly-recap`, `send-inactive-reengagement`, `send-never-checkedin` and `send-creator-list-live` have no auth check in the handler
   (they would email users on an anonymous POST); `send-notifications`, `send-dormant-reminders` and `update-streak` need review. `send-partner-recap` was fixed today. Not exercised (sending would be abuse). Fix with the same
   service-role or campaign-secret pattern and cron headers. Treat as a blocker for a public launch, not for store review.
Not blockers but must be decided/known before submitting:
5. Apple: run the revocation test (section 7) before saying CheckOff revokes Sign in with Apple tokens; Apple "should" revoke. [Apple, strongly recommended]
6. Terms (last updated 2026-04-17) do not mention that submitted photos are retained anonymously after deletion or the cover-photo license; the policy and delete page do. Update Terms wording before or with the release (website only).
7. Store forms: Apple age rating (alcohol), export compliance (done in build), Google content rating.
Optional follow-ups (documented in `DELETION_PHONE_TEST.md`): badge celebration visibility, Secret Reveal design, Android delayed exits inflating dwell and noisy sentinel retries, Barley & Smoke has no visit profile, EXIF stripping on retained photos,
removing unused Android permissions, iOS string fix, Android disclosure wording update (OTA), applying the optional reveal-image migration.

## 10. Next actions in order
1. Owner: run the phone checks for the badge celebration and Secret Reveal; tell Claude the outcome (they are JavaScript, shipped by OTA).
2. Owner: second-Apple-ID revocation test (section 7). If it fails, keep "disconnect it yourself" wording and the Apple review note without the revocation sentence.
3. Claude (when asked): fix caller authorization on the email/notification functions (blocker 4), then re-run the no-email rejection tests.
4. Owner: create the two reviewer accounts (section 8).
5. Owner: record the Play video (4c) and the Apple screen recording; upload the Play video unlisted.
6. Owner: Play Console: Data safety (4d), deletion URL (4e), Background Location declaration (4a/4b), content rating, App access, listing text; upload vc21 to closed testing (and start the 12-tester clock if required).
7. Owner: App Store Connect: App Privacy (5a), age rating, review notes (5c), demo account, attach the recording, select the existing build, manual release; submit.
8. After approval: monitor `account_deletion_requests` and the recovery kill switch; keep the iOS string fix and the unused-permission cleanup for 1.1.11.

## Uncertainty register (resolve, do not assume)
U1 provider request-log retention (Supabase, hosting, Sentry); U2 database backup retention of deleted rows; U3 whether the 120 km window request counts as collected approximate location (declared conservatively);
U4 Apple classification of push tokens as Device ID (declared conservatively); U6 whether Sentry's per-install identifier makes crash/diagnostic data "linked" (Apple defines linked broadly; declared Not linked with a documented conservative alternative);
U7 Google "Advertising or marketing" purpose for our own re-engagement emails; U8 alcohol content rating answers; U9 Play account type and testing requirement; U10 Play's decision on Background Location core-functionality.
