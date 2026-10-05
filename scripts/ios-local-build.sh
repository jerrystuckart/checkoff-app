#!/bin/sh
# Pre-flight + local production iOS build for CheckOff. Run from the repo root of the branch you intend to ship.
#   scripts/ios-local-build.sh            # checks only (default, safe)
#   scripts/ios-local-build.sh --build    # checks, then `eas build --platform ios --profile production --local`
# Fixes the recurring "pod install ... Unicode Normalization not appropriate for ASCII-8BIT" crash (CocoaPods' own error
# reporter dies under a non-UTF-8 locale and hides the real error) by forcing a UTF-8 locale for the whole build.
set -e
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
EXPECTED_RUNTIME="86ac0036db685dec7e1921f661d6b77ede23965e"   # TestFlight 1.1.10 runtime the production OTAs target

echo "branch : $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "ERROR: tracked files have uncommitted changes — commit or stash first"; git status --short --untracked-files=no; exit 1; fi
for f in .env .env.local; do [ -f "$f" ] && echo "note: $f exists locally (gitignored, not uploaded by EAS)"; done
FP=$(npx expo-updates fingerprint:generate --platform ios 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s.slice(s.indexOf('{'))).hash))")
echo "runtime fingerprint: $FP"
if [ "$FP" != "$EXPECTED_RUNTIME" ]; then echo "WARNING: fingerprint differs from $EXPECTED_RUNTIME — a binary built from this tree will NOT receive the existing 1.1.10 production OTAs (expected only if you changed native code on purpose)."; fi
node --test lib/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
[ "$1" = "--build" ] || { echo "checks done (pass --build to start the local production build)"; exit 0; }
if [ -z "$SENTRY_AUTH_TOKEN" ]; then echo "SENTRY_AUTH_TOKEN not set: Sentry source-map upload will be skipped (EAS keeps it as a cloud-only secret)."; export SENTRY_DISABLE_AUTO_UPLOAD=true; fi
exec eas build --platform ios --profile production --local
