# iOS 1.1.10 (build 155+) — consolidated release notes (2026-10-04)

Release source: branch `main` fast-forwarded to `feature/hub-location-section`. Runtime fingerprint `86ac0036db685dec7e1921f661d6b77ede23965e`
(same as the TestFlight 1.1.10 binary the production OTAs target). Verify with `scripts/ios-local-build.sh`.

Included (verified by commit ancestry, not summaries): native movement module + visit detection + recovery (native/movement-refresh, in main),
metro state contract (321fb12), recovery UI/trip eligibility (81c1dcb), "I'VE DONE THIS" restore (de399d5), Destination Hub location section (5b47e89),
stale-test repairs (8e64911), Hub no-prompt location + render-loop/conditional-hook fixes (8ef60ca, 0329d69), reactive Home Hub arrival card (12aedec),
two-line Hub description + compact Closest rows (9286f39).

Deliberately NOT included: Android-only release config (release/android-1.1.10-parity, ota/android-recovery-ui, feature/android-visit-recovery,
android App Links), the 1.1.9 runtime line (release/ios-1.1.9-*, feature/hub-location-section-119), any simulator `ios/` output.

Do not change (each alters the runtime fingerprint and would strand the existing 1.1.10 OTAs): `ios.buildNumber` removal from app.json, the
`expo-updates` patch bump 55.0.30 -> 55.0.33 flagged by `expo-doctor`, any native dependency or config plugin.

Server-side availability (not code): Willcox destination_zones row is is_active=false; Positano is active. Feature flags live in `feature_flags`.
