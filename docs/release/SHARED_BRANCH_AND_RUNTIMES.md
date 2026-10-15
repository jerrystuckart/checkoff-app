# Shared development branch vs. the shipped lines (2026-10-14)

`feature/nearby-photo-categories` (the shared development branch) now CONTAINS every commit shipped on the three OTA lines,
including the published Search Metro / "You Are Here" OTA commits. Merge commits, in order:

| Merge | Line merged | Installed runtime | Tip at merge |
|---|---|---|---|
| fc7eef5 | `origin/production/1.1.10-canonical` (iOS) | `86ac0036` | `d33a838` |
| 0831d19 | `origin/release/android-1.1.10` (Android) | `53ba13b5` | `fd1a1bb` |
| 769aff8 | `origin/release/ios-1.1.10-strings` (iOS TestFlight build 159) | `d4a37d58` | `0fb2d31` |

Conflicts were resolved by keeping BOTH behaviors: the Android line's platform-aware `useVisitRecovery` (Play disclosure on Android,
the same iOS alert as before on iOS) replaced the iOS-only `runVisitRecoverySetup` flow (it had no other callers), Profile uses
`deviceSupportsVisitRecovery()`, and the iOS line's EAS build-log credential redaction was kept.

## RULE: never build or publish an OTA from the shared branch
Its native inputs are a union of all three lines, so its runtime fingerprints (iOS `5cfa0ae5`, Android `849a13e3` when measured)
equal NONE of the installed runtimes. A build from it creates orphan runtimes; `scripts/publish-ota.sh` would refuse it.
Ship JavaScript by cherry-picking onto each release line's REMOTE tip and publishing with `scripts/publish-ota.sh ios | ios-strings | android`
(local release branches lag origin; always `git fetch` first). Never put `app.json`, `package*.json`, `.gitignore`, `eas.json` or `modules/` changes in an OTA.

## Android App Links are already native in the shipped binary
The versionCode 23 AAB (runtime `53ba13b5`, same native config as vc21) declares an `autoVerify` VIEW/BROWSABLE filter for
`/join`, `/reset-password`, `/auth/confirm`, `/open`, `/item`, `/list`, `/metro` on `https://getcheckoff.com`. No new native build is needed
for links, and building one would change the runtime and strand the current Android OTA line.
`https://getcheckoff.com/.well-known/assetlinks.json` lists `com.getcheckoff.app` with two certificate fingerprints; Google's Digital Asset Links
service reports both `linked: true`. The first (`95:3C:29:…`) is the upload key that signed the AAB; the second is expected to be the Play App Signing key
(confirm in Play Console > App integrity; Play re-signs internal/production installs with it).
