# Android 1.1.10 parity (release/android-1.1.10-parity)

Base: origin/fix/metro-state-contract (321fb12), NOT origin/main. origin/main (f12cf40) is 38 commits behind the line that produced
iOS 1.1.9/1.1.10 and Android 1.1.9 (c0dcc2c); cherry-picking onto it would drop the Amalfi launch, the link routing JS and the
metro-state work. fix/metro-state-contract is a fast-forward superset of origin/main. Added: df36aad (cherry-picked clean, no conflicts) and
lib/androidParity.test.js. Nothing merged into main.

Shared JS (metro provenance, nearest metro, link intent expiry, 5 min / 2 km cache, Positano countdown) has no iOS-only import or storage
(asserted by test). Visit recovery stays iOS-only (lib/visitDetection/recoveryPolicy.js); the iOS native movement module is platform "apple".

Generated manifest (expo prebuild, production config): ACCESS_FINE/COARSE_LOCATION, CAMERA, POST_NOTIFICATIONS, INTERNET, VIBRATE, RECORD_AUDIO,
SYSTEM_ALERT_WINDOW (template/library defaults, unchanged from 1.1.9); no ACCESS_BACKGROUND_LOCATION, no FOREGROUND_SERVICE*, no service entries.
One autoVerify filter with https getcheckoff.com prefixes /join /reset-password /auth/confirm /open /item /list /metro, plus checkoff://.

assetlinks.json (live, HTTP 200, application/json, no redirect): package com.getcheckoff.app, fingerprints
95:3C:29:...:C8:C9 = EAS upload keystore (verified from the signed 1.1.9 AAB) and A6:0E:36:...:FD:18 (not verifiable without Play Console;
presumed Play App Signing). Not changed.

Later, for Android visit recovery: ACCESS_BACKGROUND_LOCATION (Play permissions declaration + prominent in-app disclosure + video),
foreground service type "location" if a service is used (declaration), expo-location background plugin flags, Android geofencing or
activity-recognition design (the iOS native movement module has no Android twin), battery/Doze testing on several OEMs, privacy policy and
Data safety updates, add 'android' to VISIT_RECOVERY_PLATFORMS, and a physical walk test like the iOS field tests.

## Build and submit
EAS build 9b58e190-5fca-4f19-8ac7-ef5a7d0af9be (production, commit bc45eb7): 1.1.10, versionCode 18, runtime 56c5f2cd23878dd4083475b052989216e4c3ae11,
signed with the EAS upload key 95:3C:...:C8:C9, Sentry release com.getcheckoff.app@1.1.10+18 (dist 18), source maps uploaded (debug id f2424f31-...).
Play upload NOT done: EAS has no Google Service Account Key (cannot be configured non-interactively). Internal-testing submit profile added to eas.json.
Later, interactively: npx eas-cli submit --platform android --profile android-internal --id 9b58e190-5fca-4f19-8ac7-ef5a7d0af9be
