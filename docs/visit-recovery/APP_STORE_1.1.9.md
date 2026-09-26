# CheckOff 1.1.9 — App Store submission (visit recovery)

Build to submit: **1.1.9 (154)** — the binary already in TestFlight, runtime fingerprint `81dbd1f1dac8165466982bb95e3625a76d9ea841`.
Do NOT change anything native (Info.plist strings, app.json plugins/permissions, dependencies) before submitting: that changes the
fingerprint and cuts this binary off from the OTAs that carry the feature. A rebuilt binary with only a new build number is fine
(build number is not part of the fingerprint) — verify with `unzip -p build.ipa 'Payload/*.app/EXUpdates.bundle/fingerprint'`.

## Steps
1. App Store Connect → Apps → CheckOff → TestFlight: confirm build 154 shows "Ready to Submit"; answer export compliance if prompted.
2. App Store tab → **+ Version** → `1.1.9`.
3. **Build** section → select build 154.
4. **What's New** (suggested): "New: Places you may have visited. Turn it on in Profile and CheckOff can remember when you spent time at a CheckOff place, so you can check it off later — even from home. It's optional, private, and you can turn it off and delete your saved visits any time. Plus fixes and improvements."
5. **App Privacy** → update as below, then Publish the privacy answers.
6. **App Review Information**: paste the notes below; add a demo account (see "Reviewer account"); attach the screen recording from the Monday field test if you have one.
7. **Version Release**: choose **Manually release** (you control timing relative to the global switch). Consider Phased Release.
8. Submit for Review.
9. After it is Ready for Sale and released: `curl -s "https://itunes.apple.com/lookup?bundleId=com.checkoff.app&country=us"` must show `"version":"1.1.9"`.
10. Wait for meaningful adoption (query below), then run `rollout_preflight.sql`, then the switch (see ROLLOUT.md).
```sql
SELECT app_version, build_number, count(*) FROM users WHERE last_app_open_at > now() - interval '14 days' GROUP BY 1,2 ORDER BY 3 DESC;
```

## Also update before release
- **Privacy Policy** (getcheckoff.com/privacy): state that, if the user turns on visit recovery and allows Location "Always", the app reports arrival/departure at
  CheckOff places with precise location; visit sessions are kept for about 2 days, suggestions for 7 days (deleted a day after), diagnostics 14 days; nothing is sold or
  used for tracking or advertising; "Turn off and delete" removes it. Keep the policy URL in App Store Connect current.
- **Location strings** already in the binary (unchanged, do not edit): `NSLocationAlwaysAndWhenInUseUsageDescription` — "CheckOff can recognize when you're spending time at a place in our catalog, so it can help recover a CheckOff you forgot or let you know about a nearby pick. Never miss the thing."

## Proposed App Privacy entries
| Data type | Collected | Linked to user | Used for tracking | Purposes |
|---|---|---|---|---|
| Location → **Precise Location** | Yes | Yes | **No** | **App Functionality** (find nearby places; recover forgotten check-offs) |
| Location → Coarse Location | Not separately (covered by Precise) | — | — | — |
Everything else in your existing labels is unchanged by this feature. (Precise location may already be declared for the foreground "nearby" features — then only the purpose wording needs to cover recovery.)

## App Review notes (paste)
> CheckOff is a checklist of local experiences. This version adds an OPT-IN feature, "Places you may have visited" (Profile → "Recover check-offs you forgot").
>
> How it works: the user taps Turn on, reads a plain-language explanation, and grants Location = Always. iOS region monitoring (CLLocationManager geofencing, at most 19 circular regions of ~120 m around CheckOff places near the user) then wakes the app when the device arrives at or leaves one of those places. The app reports only that event plus a location fix to our server, which records a private suggestion, visible only to that user for 7 days, that they may confirm (to check the item off) or dismiss. Nothing is checked off automatically. We do not collect a continuous location trail or route, do not track across apps or sites, do not use location for advertising, and do not sell or share it. "Turn off and delete" (same Profile card) opts out and deletes the user's stored visit data.
>
> The "location" background mode is used only for these region-monitoring wake-ups. The feature is enabled per account by a server-side switch; the demo account below has it enabled. Because region events require being physically near a catalog place, reviewers will see the permission flow, the On state and the empty "Places you may have visited" screen; a screen recording of a real visit is attached. Location is never requested until the user taps Turn on.

## Reviewer account
Create/choose a demo user, then (do not run until you decide):
```sql
INSERT INTO feature_flag_overrides (flag_key, user_id, enabled) VALUES ('candidate_visit_detection', '<demo user id>', true) ON CONFLICT (flag_key, user_id) DO UPDATE SET enabled = true;
```
(Detection needs no tester flag any more; pushes remain tester-only, so the demo account receives none.)
