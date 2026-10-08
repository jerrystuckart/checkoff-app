# iOS 1.1.10 (build 155+) — consolidated release notes (2026-10-04)

Release source: branch `main` fast-forwarded to `feature/hub-location-section`. Runtime fingerprint `86ac0036db685dec7e1921f661d6b77ede23965e`
(same as the TestFlight 1.1.10 binary the production OTAs target). Verify with `scripts/ios-local-build.sh`.

Included (verified by commit ancestry, not summaries): native movement module + visit detection + recovery (native/movement-refresh, in main),
metro state contract (321fb12), recovery UI/trip eligibility (81c1dcb), "I'VE DONE THIS" restore (de399d5), Destination Hub location section (5b47e89),
stale-test repairs (8e64911), Hub no-prompt location + render-loop/conditional-hook fixes (8ef60ca, 0329d69), reactive Home Hub arrival card (12aedec),
two-line Hub description + compact Closest rows (9286f39).

Deliberately NOT included: Android-only release config (release/android-1.1.10-parity, ota/android-recovery-ui, feature/android-visit-recovery,
android App Links), the 1.1.9 runtime line (release/ios-1.1.9-*, feature/hub-location-section-119), any simulator `ios/` output.

Runtime-fingerprint changes (each alters the runtime of any binary built afterwards, and of OTAs published from that tree):
`ios.buildNumber` removal from app.json, the `expo-updates` bump 55.0.30 -> 55.0.33 flagged by `expo-doctor`, any native dependency/config plugin.
Those are legitimate if intended: OTAs published from a changed tree reach only binaries built from that tree, and are refused by the existing
86ac0036 TestFlight binary. After such a change run `scripts/ios-local-build.sh --record-runtime` and commit docs/release/EXPECTED_RUNTIME.

## Build archive rules
`.easignore` exists, so EAS uses IT instead of `.gitignore` (it repeats every .gitignore rule, then adds docs/metro-launch-audit/, scripts/tmp-*/, *.ipa/*.aab/*.apk).
It only filters untracked files: files already tracked by git (e.g. the committed docs/metro-launch-audit/amalfi/*) are still archived.
Adding `.easignore` makes @expo/fingerprint hash that file as a source, which would change the runtime; `.fingerprintignore` (lists `.easignore`)
removes it from the hash, so the runtime stays 86ac0036 (confirmed with expo-updates AND eas-cli). Re-check with
`eas build:inspect --platform ios --stage archive --output /tmp/inspect --profile production --force`.

## Preserved unfinished work
Moved out of the release checkout (nothing deleted): local-only branch `wip/preserved-local-work-2026-10-04` (not pushed) and
`~/Downloads/checkoff-preserved-2026-10-04/` (work.tgz, files.txt, tracked-modifications.patch, README.md with restore commands).

## Build errors — status
No saved build log exists (local builds leave none). Four outputs were reproduced from the checks a build runs; they are NOT confirmed to be the
recurring four. Capture the next build with `scripts/ios-local-build.sh --build` (full redacted log in ~/Library/Logs/checkoff-builds/).

Server-side availability (not code): Willcox destination_zones row is is_active=false; Positano is active.


## Reconciliation 2026-10-07 night
- TestFlight 1.1.10 (buildNumber 155) is a local build; it is not in `eas build:list` (newest EAS iOS record: 1.1.7 / 152). Runtime 86ac0036, channel production; latest production OTA group 9c3d0ef1.
- Final iOS source production/1.1.10-canonical @f237aaf differs from the latest OTA only in docs and migrations: no ordinary user difference, no new binary needed for behavior.
- Apple App Privacy answers and blockers: docs/release/STORE_DISCLOSURES_1_1_10.md section 4 and 7. Potential binary reason (optional): the location permission strings in app.json say
  "verify GPS check-ins" and "let you know about a nearby pick", which the app does not do for ordinary users; fixing them is a native change (new runtime).
- Optional JavaScript only parity: the Home "Turn On" button exists only on the Android release branch.
