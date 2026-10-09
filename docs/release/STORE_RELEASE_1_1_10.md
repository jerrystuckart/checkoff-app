# CheckOff 1.1.10: store release readiness (AUTHORITATIVE, updated 2026-10-08 night, Phoenix)

This is the single current source of truth for submitting 1.1.10 to the App Store and Google Play. Where another file disagrees, this one wins.
Superseded and reduced to pointers: `STORE_DISCLOSURES_1_1_10.md`, `docs/visit-recovery/APP_STORE_1.1.9.md`, `docs/visit-recovery/android/PLAY_SUBMISSION_DRAFTS.md`.
Nothing here has been entered in App Store Connect or Play Console, submitted for review, uploaded to Play or released. No credentials or passwords are in this file (reviewer account passwords never go in git).

Basis: the code at `production/1.1.10-canonical` and `release/android-1.1.10`, the deployed backend (read-only checks on 2026-10-08), the live pages
https://getcheckoff.com/privacy (updated 2026-10-08) and https://getcheckoff.com/delete-account, and official guidance fetched 2026-10-08:
Google Play background location policy (support.google.com/googleplay/android-developer/answer/9799150), Data safety (answer/10787469), account deletion (answer/13327111),
Play target API level (developer.android.com/google/play/requirements/target-sdk); Apple App Review Guidelines (developer.apple.com/app-store/review/guidelines),
App Privacy Details (developer.apple.com/app-store/app-privacy-details), Offering account deletion (developer.apple.com/support/offering-account-deletion-in-your-app).

## 0. Final state at a glance (2026-10-08 night)
| | iOS | Android |
|---|---|---|
| Final binary | TestFlight build **159**, version 1.1.10, bundle `com.checkoff.app`, runtime `d4a37d580c7ee48833857ee7c12fb4af24169068`, built from `release/ios-1.1.10-strings` @ `fde0891`; contains the corrected location strings (verified inside the .ipa) | AAB `/Users/jerrystuckart/Downloads/checkoff-build/android/build-1791526016296.aab`; versionName 1.1.10, versionCode **23**, runtime `53ba13b59fec2f2667b5ce1f9568e19f8f5076b3` (matches the recovery allowlist), built from `release/android-1.1.10` @ `452c345`; SHA-256 `da813487e41e5da8291a1c8472056fbb43f03b75fce3893b3b6c171687ab5401` |
| Proof it is the binary in use | A phone reports build 159 and loaded the strings OTA (server records, 21:03 Phoenix); App Store Connect state not queried | Local build only; NOT uploaded anywhere (owner uploads to Play) |
| Latest production OTA for that runtime | strings runtime `d4a37d58…`: group `9a24635c-68fe-4c5d-9ed5-85e67fa3f8fa`, update `01a11ecc-bb07-7853-8ef4-d8d1657932a6` (photo notice on Profile, not Home). Installed older iOS runtime `86ac0036…`: group `ca353d71-6a0f-426b-a559-05b515371b2f`, update `01a11ec9-783b-7d5f-97d2-d24b0284c576` | runtime `53ba13b5…`: group `60caf7fe-aaa6-44d2-b1df-c77045a80b00`, update `01a11ecb-38c4-782c-bb3e-582c1213bb5c` (older vc21 users) |
| JavaScript embedded in the binary | build-time tip `fde0891` (still has the first, large Home notice; the OTA above replaces it on the second launch; accounts created after the 2026-10-09 01:30Z cutoff never see it) | latest tip including the Profile notice placement |
| Branch tips (pushed) | strings `e7b7acb` (canonical `9dd381d` merged); canonical `9dd381d` | `60ce0ae (the AAB's source) plus later documentation commits` |
Sentry source maps for the Android embedded bundle: VERIFIED in the build log: Sentry Source Map Upload Report for release com.getcheckoff.app@1.1.10+23, dist 23, bundle index.android.bundle with debug id 339400db-f961-4add-a55e-dd4cddbe45e2 (artifact bundle upload), no Sentry error lines. Optional eyeball check: Sentry > Settings > Projects > react-native-rp > Source Maps lists that debug id.
Backend deployed and verified earlier (unchanged tonight): account deletion pipeline (rev5), consent version columns, edge function caller guards, cron headers; dormant reminders, renewal emails and the candidate visit / badge push types remain OFF.

## 1. Verdict
| | iOS | Android |
|---|---|---|
| Submittable as is? | **Yes**: build 159. Select it in App Store Connect once its TestFlight processing shows complete (not verified from here). | **Yes** for Play closed testing / production after the Play Console items in section 9. The new AAB replaces vc21 (same runtime, same native config; fresh JavaScript so first launch already has the consent screens and the Profile notice). |
| Native change pending | none | none (no native config touched; 16 KB page alignment check: verified: all 46 arm64-v8a and x86_64 native libraries have every PT_LOAD segment aligned to at least 16 KB) |
| Platform requirements checked 2026-10-08 | Xcode 26 / iOS 26 SDK rule (since 2026-04-28; the TestFlight upload passed it), iOS 13 minimum (2026-09-09), age rating questions (must be answered), privacy manifest reasons (Expo/Sentry ship manifests; confirm the upload processed without warnings) | target API 36 (required since 2026-08-31, React Native default; confirm in Play Console), 16 KB page size (deadline 2027-02-01, native libraries only), background location declaration (section 4), Data safety, account deletion URL |

Native limitation (unchanged): anything in `app.json` (including `.gitignore`, which is hashed), `package.json`, plugins or `modules/` changes the runtime and cuts a binary off from the OTAs published for its runtime. The iOS strings change is why there are two iOS runtimes (86ac0036 older TestFlight builds, d4a37d58 build 159); JavaScript fixes must be published twice until the older one is retired.

## 2. Evidence: verified facts, owner accepted results, and what is not verified
Verified by tests, server records or inspection (2026-10-08):
- Unit tests: iOS lines 1,338 pass, Android line 1,397 pass, 122 edge function tests pass. Runtimes recomputed from clean trees: canonical iOS 86ac0036, strings iOS d4a37d58, Android 53ba13b5.
- Account deletion pipeline and consent version evidence: tested end to end with disposable accounts (deletion completes in minutes; retained photos at neutral paths with checksums unchanged; anonymous counts once; consent version preserved without identity).
- Live pages (terms, privacy, delete-account, support) carry the October 8, 2026 wording; the inbound email route answers 400 to an unsigned request.
- Android manifest of the 53ba13b5 line (inspected from a built AAB): ACCESS_FINE/COARSE/BACKGROUND_LOCATION, CAMERA, POST_NOTIFICATIONS, INTERNET, ACCESS_NETWORK_STATE, VIBRATE, WAKE_LOCK, RECEIVE_BOOT_COMPLETED, READ/WRITE_EXTERNAL_STORAGE (API 32 and below), RECORD_AUDIO and SYSTEM_ALERT_WINDOW (unused library defaults), badge and install-referrer library permissions. No foreground service permissions.
Accepted by the owner (their device results, not re-verified by me): Secret Reveal, badge celebrations, background visit recovery on both phones including confirmation and points, the iPhone email-account deletion test. Server records for the recovery and deletion runs agree. Known quality issue (not a blocker): an Android exit can be delivered late and inflate the dwell figure.
NOT verified (do not claim): Apple token revocation with a real Apple ID (section 7); an inbound email through the new Vercel Resend key; Google's decision on background location; Apple's acceptance of the purpose strings; App Store Connect processing state of build 159; Android behavior on other OEMs.

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
- Upload: use the new AAB (versionCode 23, section 0) in Internal testing, then promote that same artifact to closed testing/production. Never rebuild for a documentation change.

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
Decision (owner, 2026-10-09): build a corrected iOS binary. The strings above are applied ONLY on branch `release/ios-1.1.10-strings` (commit 9a3b1a5, based on canonical 3da4434, which contains the current JavaScript). That branch has its own runtime `d4a37d580c7ee48833857ee7c12fb4af24169068` (computed from a clean tree with a real node_modules; the committed tree reproduces it).
HARD RULE: never merge this branch into `production/1.1.10-canonical` or `release/android-1.1.10`. Measured: the same two string edits applied to the Android line change the ANDROID runtime from `53ba13b5…` to `4ee0a09d…` (app.json is hashed for every platform), which would cut the installed Android build off from OTAs and break the recovery allowlist. The canonical line keeps producing OTAs for the existing iOS runtime `86ac0036…`.
Runtime facts (all measured 2026-10-09): canonical iOS `86ac0036…` (unchanged by today's work, equals EXPECTED_RUNTIME); strings branch iOS `d4a37d58…`; Android line Android `53ba13b5…` (unchanged, equals the installed AAB). Android needs no new binary and ANDROID_RECOVERY_RUNTIMES needs no change. iOS has no runtime allowlist for recovery (gated by platform only), so the new iOS runtime needs no code change. Consequence for OTAs: while both iOS runtimes are in the field (86ac0036 until users update, d4a37d58 after), JavaScript updates must be published TWICE, once from canonical and once from the strings branch (after merging canonical into it). `scripts/publish-ota.sh ios` only knows the canonical line; add a strings profile (branch, its EXPECTED_RUNTIME, anchor = the build source commit) before the first OTA to d4a37d58.

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

## 8. Reviewer accounts (setup is five minutes; passwords never go in git, chat or this file)
Create TWO plain accounts, one per store, so a review cannot disturb the other. Suggested addresses (they do not need a mailbox because you confirm them yourself): `appreview@getcheckoff.com` and `playreview@getcheckoff.com`.
1. Supabase dashboard > Authentication > Users > Add user > Create new user. Email as above, a long random password from your password manager, TICK "Auto Confirm User". Do not touch any admin, photo admin or tester setting.
2. Sign in once with each account on a phone (Apple account on the iPhone, Play account on the Android phone). This creates the profile row. Check Home shows the catalog (reviewers are outside launched cities: the city picker and the BROWSING state are expected) and Profile shows the recovery card and Delete Account.
3. Verify without a password: `cd /Users/jerrystuckart/Downloads/checkoff && scripts/verify-reviewer-account.sh appreview@getcheckoff.com` (same for the Play address). It must print PASS (confirmed, not admin, not photo admin, not a tester, not banned, no deletion request, recovery flag on).
4. Enter the email and password ONLY in App Store Connect (App Review Information > Sign in required) and Play Console (App content > App access). Rotate both passwords after review.
5. Tell reviewers (notes in 5c and 4b already do): located items cannot be checked off from a desk (the app compares the phone to the place on the device), so use any of the roughly 290 items that are not tied to a place; background visit recovery is shown in the attached video.
The deletion test for review must use a THIRD throwaway account, never these two and never your admin or testing accounts.

## 9. Outstanding approvals and blockers (genuine only)
Production blockers (nothing ships without these):
1. Google Play: the Background Location declaration, review video and Google's approval (declaration review also applies to closed testing). Risk: Google may judge optional visit recovery as not core functionality; fallback is a new Android build without ACCESS_BACKGROUND_LOCATION.
2. Google Play: Data safety, App access credentials, content rating, store listing text mentioning background location; and the 12 tester / 14 day closed test gate IF the developer account is a personal account created after 2023-11-13 (account type is not in the repo; check Play Console).
3. Apple: App Privacy answers, updated age rating questions, a demo account in App Review Information, review notes, and selecting build 159.
4. Reviewer accounts (section 8) must exist and work on both stores. New sign ups need email confirmation, so create them pre-confirmed.
NOT blockers, but decisions or follow-ups: Apple Sign in revocation real-device test (Apple says apps "should" revoke; use a second Apple ID, section 7); one real inbound email to prove the new Vercel Resend key; Sentry symbolication check in the Sentry UI; rotate the admin tool service key later (separate task, `docs/security/ADMIN_TOOL_SERVICE_KEY_DEPENDENCY.md`); decide dormant reminders and renewal emails (both OFF).

Disclosure choices that need your judgment (conservative defaults are pre-filled in sections 4d and 5a; change only if you disagree):
- Declaring Approximate location (the 120 km place-window request) and Device ID (push token, Sentry install id) as collected.
- Diagnostics (Sentry) as not linked to the user on Apple; the conservative alternative is Linked.
- "Other in-app messages" for dare text; "Developer communications" only for our own emails (not Advertising or marketing).
- Alcohol content rating answers (313 of 2,020 items involve alcohol; users can hide them; no age gate).
- Whether to describe optional visit recovery as core to the app's purpose in the Play declaration (section 4a says "optional feature supporting the core purpose").

## 10. Next actions in order (tomorrow)
Required, in order:
1. Reviewer accounts (section 8): create two pre-confirmed accounts, test sign in on a phone each, store the passwords in your password manager only.
2. Play Console: upload `/Users/jerrystuckart/Downloads/checkoff-build/android/build-1791526016296.aab` to Internal testing (versionCode 23); check the pre-launch / bundle explorer for target API 36 and 16 KB alignment; then Data safety (4d), deletion URL `https://getcheckoff.com/delete-account` (4e), content rating, App access, listing sentence, Background Location declaration (4a, 4b) with the video (4c); closed test if required.
3. App Store Connect: confirm build 159 finished processing and select it; App Privacy (5a); updated age rating questions; review notes (5c) and demo account; manual release; submit when you are satisfied.
Required phone checks: the Profile notice on the strings build at a large text size (card compact, details sheet scrolls and closes); one Android phone with the NEW AAB: sign in, Profile notice position, Settings recovery card still reachable.
Optional follow-ups: second Apple ID revocation test; one inbound email; Sentry UI check; rotate keys later; badge/visit push types remain off.

## 11. Build record and upload steps
Build notes (2026-10-08 night): the first attempt failed before compiling because an automation shell has no ANDROID_HOME (it consumed versionCode 22; Play accepts gaps); the script now defaults ANDROID_HOME to ~/Library/Android/sdk. On failure EAS prints its whole job as a base64 blob that contains the upload keystore and passwords; the scripts now redact it from output and logs, and the two logs that contained it were scrubbed (the keystore is unchanged; no part of it beyond a short truncated prefix appeared in the session). If you run builds in your own terminal this does not apply, the same redaction protects your log file.
Android (built 2026-10-08 night in `/Users/jerrystuckart/Downloads/checkoff-build/android`, clean clone of `release/android-1.1.10` @ `452c345`, `npm ci`, preflight passed: runtime 53ba13b5 in ANDROID_RECOVERY_RUNTIMES, 1,397 tests):
- Artifact: `/Users/jerrystuckart/Downloads/checkoff-build/android/build-1791526016296.aab`; size 69,586,914 bytes; SHA-256 `da813487e41e5da8291a1c8472056fbb43f03b75fce3893b3b6c171687ab5401`; versionName 1.1.10; versionCode 23; embedded runtime asset `53ba13b59fec2f2667b5ce1f9568e19f8f5076b3`.
- Sentry: VERIFIED in the build log: Sentry Source Map Upload Report for release com.getcheckoff.app@1.1.10+23, dist 23, bundle index.android.bundle with debug id 339400db-f961-4add-a55e-dd4cddbe45e2 (artifact bundle upload), no Sentry error lines. Optional eyeball check: Sentry > Settings > Projects > react-native-rp > Source Maps lists that debug id.
- Upload (you): Play Console > CheckOff > Testing > Internal testing > Create new release > upload the AAB above > release name `1.1.10 (23)` > Save > Review > Start rollout; add testers. Promote the same artifact to closed testing / production later. Do not rebuild for documentation changes.
iOS: no rebuild. Build 159 is the binary. If ever rebuilt: `cd /Users/jerrystuckart/Downloads/checkoff-build/ios-strings && git pull --ff-only && npm ci && scripts/ios-local-build.sh --require-runtime-match && scripts/ios-local-build.sh --build` (runtime must print d4a37d58…; do not edit `.gitignore`/`.easignore`).
JavaScript updates: `OTA_MESSAGE="..." scripts/publish-ota.sh ios|ios-strings|android --publish` from a clean clone at the pushed tip with a real `node_modules`; publish to BOTH iOS runtimes.

## Uncertainty register (resolve, do not assume)
U1 provider request-log retention (Supabase, hosting, Sentry); U2 database backup retention of deleted rows; U3 whether the 120 km window request counts as collected approximate location (declared conservatively);
U4 Apple classification of push tokens as Device ID (declared conservatively); U6 whether Sentry's per-install identifier makes crash/diagnostic data "linked" (Apple defines linked broadly; declared Not linked with a documented conservative alternative);
U7 Google "Advertising or marketing" purpose for our own re-engagement emails; U8 alcohol content rating answers; U9 Play account type and testing requirement; U10 Play's decision on Background Location core-functionality.
