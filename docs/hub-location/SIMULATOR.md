# Running the Hub build in the iOS Simulator

Source: branch `feature/hub-location-section` (this worktree). Dev-client **Debug** build, runtime fingerprint
`86ac0036…` (same native layer as TestFlight 1.1.10 incl. the CheckoffMovement module). It loads JavaScript
from **Metro** (live local source), never from an OTA — dev clients ignore EAS Updates unless you open one from the
launcher's "Updates" tab, so production OTAs cannot mask the code under test. Sentry config is unchanged; only the
symbol-upload step is skipped for the simulator build (`SENTRY_DISABLE_AUTO_UPLOAD=true`).

Prebuilt app: `ios/build-sim/CheckOff.app` (gitignored). To rebuild from scratch:
```
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 SENTRY_DISABLE_AUTO_UPLOAD=true
npx expo prebuild --platform ios --no-install          # generates ios/ (gitignored)
(cd ios && pod install)
xcodebuild -workspace ios/CheckOff.xcworkspace -scheme CheckOff -configuration Debug \
  -sdk iphonesimulator -destination 'id=<SIMULATOR_UDID>' -derivedDataPath /tmp/checkoff-dd build
```
Run:
```
xcrun simctl boot "iPhone 17 Pro"; open -a Simulator
xcrun simctl install booted ios/build-sim/CheckOff.app
xcrun simctl privacy booted grant location-always com.checkoff.app
scripts/hub-sim-location.sh positano-02            # set a starting location
npx expo start --dev-client                        # keep running
xcrun simctl openurl booted "checkoff://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```
The first launch shows onboarding then guest Home. Sign in as Jerry's account for Willcox (see GPS_TEST_SHEET.md).
Reach a Hub by setting the location inside its zone and tapping "Explore …" on Home's destination card
(Positano), or Home → Destinations.

Do not run `eas update` or a production build from this folder with `ios/` present: a generated `ios/` directory
changes the fingerprint. Move it aside first.
Known dev-only noise: a red "Internal React error: Expected static flag was missing" banner on Home, and with
location permission revoked a "Maximum update depth exceeded" banner on Home/Destinations. Neither involves the Hub code
(the Hub screen was not mounted); they were not investigated further or compared against a clean baseline.
Reloading the dev client from a terminated app occasionally aborts in expo-image-picker's permissions registration
(dev-client quirk); relaunch and reopen the URL.
