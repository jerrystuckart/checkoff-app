# CheckOff 1.1.10: store disclosure answers, release reconciliation and blockers (prepared 2026-10-07 night)

Status: PROPOSED. Nothing here has been entered into Play Console or App Store Connect. Basis for every answer is the implementation
audited 2026-10-07 plus the published policy (https://getcheckoff.com/privacy, site commit 1038955, "Last updated October 7, 2026").
Official guidance applied (fetched 2026-10-07): Google Play Data safety help (support.google.com/googleplay/android-developer/answer/10787469),
Play account deletion requirements (answer/13327111), Play background location policy (answer/9799150), Apple App Privacy Details
(developer.apple.com/app-store/app-privacy-details/), Apple "Offering account deletion in your app".

## 0. Definitions that drive the answers
- Google "collect" = data transmitted off the device. "Share" = transfer to a third party, EXCLUDING a service provider processing on your behalf and under
  your instructions, legal transfers, user initiated transfers the user expects, and fully anonymized data. Data processed only on the device is not collected.
  Ephemeral processing (held only in memory for the real time request) still goes in the form but is not shown on the listing.
  Optional is allowed only if every user can opt in or out of providing it.
- Apple "collect" = transmitted off the device and accessible for longer than needed to service the request in real time. On device only = not collected.
  Apple has NO service provider exemption: data collected by third party partners (Sentry, Supabase, Expo) is declared as ours. The optional disclosure
  exemption needs four conditions (including "user affirmatively chooses each time"), so ongoing location collection after a permission grant is always disclosed.
  Tracking = linking with third party data for advertising/measurement or sharing with a data broker.
- Service providers used (verified in code and functions): Supabase (database, auth, storage, functions), Sentry (crash reports), Expo push service plus Apple
  APNs and Google FCM (notification delivery), Resend (email), Sign in with Apple and Google. No advertising SDK, no ATT prompt (no NSUserTrackingUsageDescription),
  no analytics SDK: usage analytics are our own `interaction_events` table.

## 1. What is collected off device (implementation basis)
| Data | Off device? | Evidence |
|---|---|---|
| Email, display name, account id (Supabase auth; Apple/Google sign in) | Yes | Supabase Auth, `users` table |
| Foreground location (Nearby, hubs, nearest city, Secret unlock) | NO, on device only | no coordinate or area parameter in any foreground request (audit 2026-10-07); distances computed on device |
| Check in location | NO | 8 app write paths include none; `check_ins.location_at_checkin` exists, unused, no function/trigger/view touches it |
| Visit recovery location (opt in only) | Yes | `visit_presence_enter/exit/reconcile` RPCs carry lat, lng, accuracy; `visit_presence_sessions` stores enter/exit lat, lng, accuracy (deleted after 2 days); registration log stores position rounded to 3 decimals (14 days) |
| Visit recovery bounding box | Yes, as a request | tracker `loadCoverageRows` asks for items inside a window of +/-60 km around the position. Not stored as a row; hosting provider request logs may contain it (retention unknown) |
| Photos (photo check in, optional) | Yes | Supabase storage, `check_ins.photo_url` |
| Place name and note on a check in (optional) | Yes | `check_ins.personal_place`, `personal_note` |
| Lists, dares, check ins, badges, streaks | Yes | core tables |
| Interaction events (item/list views, directions, URL taps, Nearby use; no coordinates, no search text) | Yes, tied to user id | `interaction_events` (2,354 rows, 47 users on 2026-10-07) |
| Push token (only if notifications allowed) | Yes | `push_tokens` |
| Crash and error reports | Yes (Sentry) | default `Sentry.init`, no `setUser`; includes device model, OS, app version, Sentry generated identifier |
| Marketing/recap email address use | Yes (Resend) | send-monthly-recap, send-inactive-reengagement, send-creator-list-live (all call api.resend.com) |
Not collected: contacts (no READ_CONTACTS), advertising id, financial info, health, audio (RECORD_AUDIO is an unused library default permission), calendar.

## 2. Google Play Data safety (proposed answers)
Does the app collect or share required user data types: Yes collect; Share: No (see rationale below).
Is all data encrypted in transit: Yes (HTTPS to Supabase, Sentry, Expo).
Account creation: Yes. Provide data deletion: see section 6 (cannot be answered cleanly yet).

| Category / type | Collected | Shared | Required or optional | Purposes | Basis / note |
|---|---|---|---|---|---|
| Personal info: Name | Yes | No | Required (needed for any account feature) | App functionality, Account management | display name; Apple/Google sign in may supply a name |
| Personal info: Email address | Yes | No | Required | App functionality, Account management, Developer communications, Advertising or marketing | recap and reminder emails count as developer communications; re-engagement emails are arguably marketing, declare both (conservative) |
| Personal info: User IDs | Yes | No | Required | App functionality, Analytics, Account management | Supabase user id keys all records including interaction events |
| Location: Precise location | Yes | No | Optional (visit recovery is opt in, every user can decline) | App functionality | collected only after opt in plus background permission; foreground use is on device only, so it is NOT the reason for this answer |
| Location: Approximate location | Yes (conservative) | No | Optional | App functionality | the +/-60 km window request; see unresolved item U3 |
| Photos and videos: Photos | Yes | No | Optional | App functionality | photo check ins; visible to members of the same list in database terms (user to user, not a third party) |
| App activity: App interactions | Yes | No | Required | Analytics, App functionality | `interaction_events` |
| App activity: Other user generated content | Yes | No | Optional | App functionality | notes, place names, lists, dare text (see U5 for dare messages) |
| App info and performance: Crash logs | Yes | No | Required | Analytics, App functionality | Sentry, a service provider processing on our behalf |
| App info and performance: Diagnostics | Yes | No | Required | Analytics, App functionality | device model, OS, app version in Sentry events |
| Device or other IDs | Yes | No | Optional (only if notifications allowed) | App functionality | Expo push token in `push_tokens` |

Why "Shared: No" everywhere: Supabase, Sentry, Expo/Apple/Google push and Resend process data on our behalf under our instructions (Google excludes this).
Nothing is sold, used for advertising targeting, or sent to a data broker. Partner businesses receive only aggregate counts, never visit or location data
(send-partner-recap counts check ins; `partner_visits` is empty).

## 3. Google Play Background Location declaration (proposed text)
Declare ONE feature: visit recovery ("Recover checkoffs you forgot").
- Feature and why background access is needed: CheckOff is a checklist of local experiences. Users often forget to check something off after they leave.
  Visit recovery uses geofences (Google Play services GeofencingClient, up to 40 regions in total including one coverage region; no foreground service, no continuous GPS)
  to notice arrival at and departure from catalog places while the app is closed, so the user can confirm a missed checkoff later. The moments that
  matter happen while the phone is in a pocket and the app is closed, so foreground location cannot deliver the feature.
- User control and consent: off by default; user taps Turn On; full screen prominent disclosure before any permission request; foreground precise location
  first, then "Allow all the time" on the system settings page; can turn off in Profile, which also deletes saved visits; can revoke in system settings.
- Nothing is automatic: a qualifying visit becomes a private suggestion; the user confirms or dismisses it.
- Not used for advertising or analytics. Never requested solely for ads.
RISK (potential blocker, see section 7): Play defines core functionality as the main purpose without which the app is broken. Visit recovery is an optional
feature; Play may decline. Fallback if declined: remove ACCESS_BACKGROUND_LOCATION and the Android recovery code from every track (requires a new binary),
iOS unaffected.

In app prominent disclosure (shipped, androidDisclosure.js): "CheckOff uses your location in the background to recognize when you spend enough time at
places in our catalog, even when the app is closed. Your location creates private visit suggestions. Nothing is checked off until you confirm it. You can turn
this off anytime and delete your saved visits." Contains "location" and "even when the app is closed", names the feature, appears on an explicit tap from Home or
Profile before the runtime prompt. Possible improvement (JavaScript only, optional): say the readings are sent to our servers. Play also expects the background use
to be described in the store listing and on the website (policy section 2 covers the website; listing text draft is in PLAY_SUBMISSION_DRAFTS.md section F).

### Reviewer instructions (Play App access / review notes)
1. Sign in with the supplied reviewer account (Jerry must create a dedicated one; do not reuse a personal account).
2. Home shows "Recover checkoffs you forgot" with a Turn On button; Profile shows the same card. Tap Turn On.
3. Read the disclosure, tap Continue, allow precise location while using the app, then choose "Allow all the time" on the system page and return to the app.
4. The card shows "On". The feature creates suggestions only after the device spends the place's dwell time at a catalog place and leaves; a reviewer cannot
   reproduce that at a desk, so the review video shows a real recorded visit. Suggestions appear under "Places you may have visited" and nothing is checked off
   until the user taps confirm.
5. Profile, "Turn off and delete visits" stops monitoring and deletes the saved visits.
Open decision: a seeded suggestion for the reviewer account would be a fabricated production visit; do not create one. Use the video and these notes instead.

### Review video script (about 30 seconds, Pixel screen recording; Play recommends 30 seconds or less)
1. Home, tap Turn On on "Recover checkoffs you forgot" (0:00 to 0:05). 2. Full screen disclosure, tap Continue (0:05 to 0:09). 3. Runtime prompt: Precise, While using the
app (0:09 to 0:13). 4. Explanation, then the system page, choose "Allow all the time" (0:13 to 0:20). 5. Back in the app, card shows On (0:20 to 0:22). 6. Cut to a
screen recording of the real test (app closed, phone locked) showing the suggestion that appeared after leaving a place, then confirming it (0:22 to 0:30).
Must show the Android app and the feature working while the app is not in use. The real background test is NOT yet done (section 5), so this video cannot be recorded yet.

## 4. Apple App Privacy (proposed answers)
Data used to track you: NONE (no ATT, no ad SDK, no third party data linking, no data broker).
| Data type | Collected | Linked to user | Purposes | Basis / note |
|---|---|---|---|---|
| Contact Info: Name | Yes | Yes | App Functionality | display name, name from Sign in with Apple if shared |
| Contact Info: Email Address | Yes | Yes | App Functionality; Developer's Advertising or Marketing | Apple counts "marketing communications directly to your users" as marketing: recap/reminder emails |
| Identifiers: User ID | Yes | Yes | App Functionality; Analytics | Supabase user id, interaction events |
| Identifiers: Device ID | Yes (see U4) | Yes | App Functionality | Expo push token; Apple does not say tokens are Device ID, it is an inference from "other device level ID" |
| Location: Precise Location | Yes | Yes | App Functionality | visit recovery readings (opt in, ongoing after permission so the optional disclosure exemption does not apply) |
| Location: Coarse Location | Conservative yes (see U3) | Yes | App Functionality | +/-60 km window request |
| User Content: Photos or Videos | Yes | Yes | App Functionality | photo check ins |
| User Content: Other User Content | Yes | Yes | App Functionality | notes, place names, lists, dares |
| Usage Data: Product Interaction | Yes | Yes | Analytics; App Functionality | `interaction_events` tied to user id |
| Diagnostics: Crash Data | Yes | No (see U6) | App Functionality (Analytics acceptable) | Sentry; no user identity attached by our code |
| Diagnostics: Other Diagnostic Data | Yes | No (see U6) | App Functionality | device model, OS, app version |
Foreground location is processed on the device only and is not declared as collected. Permission strings: see section 7 (they currently misdescribe behavior).

## 5. Release artifact reconciliation
| Item | Android | iOS |
|---|---|---|
| Installed/test binary | Play internal testing, 1.1.10 versionCode 21, built LOCALLY (`eas build --local`, from the release worktree) from source e7b8aa1 (verified: bundle contains e7b8aa1 strings, not 47721c3) | TestFlight 1.1.10 (app.json buildNumber 155), built locally (the release notes name scripts/ios-local-build.sh); not on the EAS build list (newest EAS iOS record is 1.1.7 / 152). Source and runtime per docs/release/IOS_1_1_10_RELEASE.md |
| Runtime | 53ba13b5 (resolved from the AAB asset `fingerprint`; equals the allowlisted runtime) | 86ac0036 (docs/release/EXPECTED_RUNTIME; production OTAs target it) |
| Update channel | production | production |
| JavaScript updates published | none for runtime 53ba13b5 (Android OTAs exist only for older runtimes 56c5f2cd, 55c8a332) | latest production OTA group 9c3d0ef1 (photo admin, hub artwork) on 86ac0036, from the production/1.1.10-canonical lineage |
| Final source | release/android-1.1.10 @47721c3 | production/1.1.10-canonical @f237aaf (main is docs only ahead) |
Differences that affect ORDINARY users:
- Android installed (e7b8aa1) vs Android final (47721c3): NONE. 47721c3 only adds admin only rows to Diagnostics. Do not rebuild for it.
- iOS TestFlight/OTA vs iOS final (canonical f237aaf): NONE affecting users (093baa6 to f237aaf changes only docs and migrations).
- Android vs iOS (intended or platform specific): (a) Android Home has a "Turn On" button when recovery is off; iOS Home has the entry row only and opts in from Profile.
  A JavaScript only OTA could add the Home button to iOS; optional, needs approval. (b) iOS also uses the OS significant location change service (movement flag ON);
  Android has no equivalent. (c) Android has App Links for /open, /item, /list, /metro; iOS uses its own associated domains. (d) Android recovery is hidden on any binary whose runtime is not allowlisted.
Admin only: gate rows in Profile Diagnostics (47721c3), Android debug rows (tester or admin).
Rollout (verified server side 2026-10-07): master flag `candidate_visit_detection` ON globally = the operational kill switch on both platforms; `candidate_visit_sentinel_refresh`
and `candidate_visit_movement_refresh` ON; `candidate_visit_silent_mode` ON but its notification behavior stays tester gated in code; `android_visit_recovery` row does not exist and gates nothing.
User consent chain unchanged: user taps Turn On, disclosure, foreground then background permission, server rejects presence reports from users who have not opted in.
Needs a new binary? Android: NO (vc21 == final ordinary behavior). iOS: NO for behavior. Optional reasons only: iOS permission strings (section 7), Android RECORD_AUDIO and
SYSTEM_ALERT_WINDOW removal (changes runtime and the allowlist), Sentry source maps if vc21 was built with SENTRY_DISABLE_AUTO_UPLOAD (production stack traces unsymbolicated).

## 6. Account deletion (deferred by Jerry, not changed, not exercised)
Confirmed store requirements: Apple requires in app initiation, deletion of the account record and associated personal data, and says apps outside regulated industries
"should not require" an email or support flow to complete it. Google requires an in app path AND a web link where users can request deletion without the app; the Data safety
form asks for that link.
Status: in app path exists (Profile, Delete Account, `delete_my_account`). Completion is UNVERIFIED. Static analysis only: deleting `auth.users` cascades to `public.users`, whose
foreign keys from `interaction_events`, `campaign_sends`, `partner_promotions` and `users.referred_by` have no cascade, and no trigger clears them, so Postgres should reject the
delete for users with such rows (47 users have interaction events). Photo file removal is also unverified. No web deletion page exists (getcheckoff.com/delete-account, /account-deletion,
/delete all 404; the only route is the email in policy section 7). The privacy policy wording was corrected to avoid promising this behavior; it does not fix it.

## 7. Blockers: confirmed vs potential
Confirmed gaps (must be resolved before PRODUCTION, none block internal testing):
1. Play Data safety needs a deletion web link; none exists. (Confirmed requirement, confirmed missing.)
2. Play Background Location declaration and review video must be submitted and approved before production; the real background test must exist first to film it.
3. Play Data safety and Apple App Privacy answers must be entered (answers above).
Potential blockers (suspected, not proven):
4. In app account deletion probably fails for users with interaction events (static evidence strong, never run). Both stores require a working path; Apple also rejects email only completion.
5. Play may reject the background declaration as not core functionality. Fallback: ship Android without ACCESS_BACKGROUND_LOCATION (new binary).
6. Apple purpose strings: NSLocationWhenInUse says "verify GPS check-ins" (the app does not verify check ins by GPS) and NSLocationAlwaysAndWhenInUse mentions "let you know about a nearby pick"
   (nearby notifications are tester only). Inaccurate purpose strings are a review risk. Changing them is a native change (new iOS binary, new runtime).
Unanswered questions (U): U1 retention of provider request logs; U2 whether backups hold deleted rows; U3 whether the 120 km window request must be declared as collected approximate
location (ephemeral vs retained in provider logs); U4 Apple classification of push tokens; U5 whether dare text is "in app messages"; U6 whether Sentry's generated identifier makes crash data "linked" under Apple's test;
U7 whether Play wants "Advertising or marketing" for re-engagement emails.

## 8. Remaining Android phone test (NOT done, do not mark complete)
Setup and "Allow all the time" are verified on the phone (2026-10-07). Still unverified: a real background visit, the suggestion appearing, confirmation, and points.
Checklist: use testingcheckoff@gmail.com on the vc21 build; confirm Home/Profile show On; set battery to Unrestricted for CheckOff; go to a catalog place with coordinates (a coffee shop is
easiest, about 10 to 15 minutes of dwell); lock the phone, do not force stop the app; leave and wait up to about 10 minutes; open the app, expect "Places you may have visited" with a suggestion
and nothing checked off; confirm it, expect a normal check in and points; repeat a 2 minute stop elsewhere and expect no suggestion. Record the screen for the Play video.
