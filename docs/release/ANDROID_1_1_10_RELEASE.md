# Android 1.1.10 — consolidated release notes (2026-10-07)
> STATUS 2026-10-08: the installed and submittable build is versionCode 21 (local build, runtime 53ba13b5, source e7b8aa1; JavaScript since then ships by OTA, latest group 5c41dbeb). Sections below about building vc20, paid EAS cloud builds, a missing privacy policy update, a reviewer account with a seeded suggestion and the unverified background test are HISTORICAL and removed. Store work: `docs/release/STORE_RELEASE_1_1_10.md` is authoritative.

Release source: branch `release/android-1.1.10` = `production/1.1.10-canonical` (f237aaf, the line behind the iOS 1.1.10 OTAs) merged with
`feature/android-visit-recovery` (d584d17, which already contains `release/android-1.1.10-parity`). Nothing was merged into `main`.
Supersedes the two earlier, narrower Android lines: `release/android-1.1.10-parity` (versionCode 18, no recovery) and
`feature/android-visit-recovery` (versionCode 19, no Hub/Home/diagnostics work).

## Store state (EAS build list, 2026-10-07)
| versionCode | version | runtime | commit | note |
|---|---|---|---|---|
| 17 | 1.1.9 | f5bb087b… | c0dcc2c | last public Android build |
| 18 | 1.1.10 | 56c5f2cd… | bc45eb7 | parity only, no background location. Not uploaded. Superseded |
| 19 | 1.1.10 | 53ba13b5… | d584d17 | recovery build. Not uploaded. EAS artifact expires 2026-11-03 |
| 20 | 1.1.10 | bf330c5e… | fd1d26f (`feature/nearby-photo-categories`, dirty) | LOCAL build `eas build --local` made in the main checkout on 2026-10-07 and installed on Jerry's phone. WRONG SOURCE: no Android recovery code, no ACCESS_BACKGROUND_LOCATION, older Secret layout |
| next | 1.1.10 | 53ba13b5… (verified, see below) | `release/android-1.1.10` | versionCode 21 |

No Android 1.1.10 binary has been submitted to any Play track; EAS has no Google service-account key.

## What was consolidated
Native inputs (`app.json`, `package.json`, lockfile, `modules/`, `eas.json` build profiles) are identical to the vc19 build source, and
`expo-updates fingerprint:generate --platform android` over a clean `git archive` of both trees gives the same hash. So the runtime stays
`53ba13b5…` and `ANDROID_RECOVERY_RUNTIMES` (lib/visitDetection/recoveryPolicy.js) needs no change. Everything new relative to vc19 is JavaScript:
Hub at-location / closest-two, two-line description with More/Less, reactive Home Hub arrival card, render-loop and hook fixes, admin-only
collapsed Profile diagnostics, Nearby category rail, secret locked screen, photo-admin client changes.

Merge conflicts (8 files) were all the iOS and Android lines each adding the same recovery files; resolved to the Android superset, keeping the
canonical admin Diagnostics wiring (`showVisitDebug={deviceSupportsVisitRecovery() && ...}`). Two stale tests were repaired without weakening them
(the Profile debug-panel regex now matches the admin Diagnostics wiring; `countActionableCandidates` takes the same injected clock as the loader, the
test fixtures expired on 2026-10-07).

## Verification done
- `node --test lib/*.test.js lib/visitDetection/*.test.js`: 1303 / 1303 pass.
- `expo export --platform android` (Sentry upload disabled): OK, one Hermes bundle.
- `expo prebuild --platform android` manifest: ACCESS_FINE/COARSE_LOCATION, ACCESS_BACKGROUND_LOCATION, CAMERA, POST_NOTIFICATIONS, INTERNET, VIBRATE,
  RECORD_AUDIO, SYSTEM_ALERT_WINDOW, legacy storage (maxSdk 32). No FOREGROUND_SERVICE*. One autoVerify filter: https getcheckoff.com prefixes
  /join /reset-password /auth/confirm /open /item /list /metro, plus `checkoff://`.
- `https://getcheckoff.com/.well-known/assetlinks.json` live; package com.getcheckoff.app; EAS upload key 95:3C:…:C8:C9 and A6:0E:…:FD:18.
- Tracked tree and EAS archive rules (.easignore): no keys, keystores, .p8, .aab/.ipa or env files; no untracked files; no secret values in source.
- NOT done: emulator or device run (no AVD / system image on this Mac), real geofence delivery, Doze/OEM behaviour.

## Movement on Android (differs from iOS)
iOS uses the Apple-only `modules/checkoff-movement` (`"platforms": ["apple"]`, never linked on Android). Android uses expo-location
`startGeofencingAsync` (Google Play services GeofencingClient, 40 regions incl. one sentinel), no foreground service, no polling. Refresh is on
foreground (5 min cooldown), sentinel exit and geofence callbacks. Offered only when: runtime in `ANDROID_RECOVERY_RUNTIMES` AND master flag
`candidate_visit_detection` AND (`android_visit_recovery` flag OR tester OR admin) AND the user opted in AND background permission is granted.
See docs/visit-recovery/android/ANDROID_VISIT_RECOVERY.md.

## OTA or new binary
- Android 1.1.9 (vc17) and vc18 binaries: JS-only OTA reaches them only on THEIR runtimes; recovery stays hidden there (no background permission). They
  do not get App Links /open /item /list /metro (needs the new manifest).
- A vc19 (53ba13b5) binary would accept this branch as an OTA. No vc19 is public, so for Play, build a fresh AAB (vc20) with this JS embedded.
- Publish no OTA to runtime 53ba13b5 before the AAB is installed on testers, and never point `--runtime-version` at a mismatching native build.

## Open items before production
See `STORE_RELEASE_1_1_10.md` section 9 (Play declaration/video, Data safety, deletion URL entered, reviewer account, closed-testing gate). The privacy policy was updated 2026-10-08; the real background test passed on a physical Android phone.

## Correction 2026-10-07 (device findings)
- Missing Home/Profile recovery controls on the installed vc20: (1) it was built from the wrong checkout, so its runtime `bf330c5e…` is not in
  `ANDROID_RECOVERY_RUNTIMES` and it contains none of the Android recovery code; (2) even on the right build the Android audience required
  `android_visit_recovery`/tester/admin, and that flag row does not exist on the server (master `candidate_visit_detection` is ON globally).
  Fix: the audience is now the master flag only (kill switch); Home offers "Turn on" when recovery is off.
- Runtime check method that is trustworthy: `expo-updates fingerprint:generate --platform android` in a checkout with a REAL node_modules
  reproduces the installed AAB's runtime exactly (bf330c5e…). With a symlinked node_modules it does not. The release tree computes to `53ba13b5…`.
- `scripts/android-build-preflight.sh` enforces branch, clean tree, real node_modules, allowlisted runtime and tests before a build.
- An OTA cannot repair vc20: its native config has no background location and its runtime differs. Install a build from this branch.
- Accidentally tracked `node_modules` symlink (added in 703b139) removed.

## Reconciliation 2026-10-07 night
- Installed Android build: Play internal testing 1.1.10 versionCode 21, LOCAL build (`eas build --local`), source e7b8aa1, runtime 53ba13b5 (from the AAB asset `fingerprint`), channel production.
  No Android OTA exists for this runtime. Final branch tip is 47721c3; the only difference from e7b8aa1 is admin only Diagnostics rows, so NO rebuild is needed for ordinary users.
- Verified on the phone: Home and Profile recovery controls, disclosure, foreground then "Allow all the time". NOT verified: a real background visit, confirmation and points.
- Store answers, background declaration, reviewer notes, video script and blockers: docs/release/STORE_DISCLOSURES_1_1_10.md.
- Confirmed production gaps: Play deletion web link missing; Background Location declaration and video not done; Data safety not entered. Suspected: in app account deletion failing (unexercised), declaration rejection.
