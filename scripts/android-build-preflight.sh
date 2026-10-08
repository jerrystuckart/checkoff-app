#!/bin/bash
# CheckOff Android release pre-flight. Run from the checkout you are about to build. Builds nothing unless --build is passed.
#
#   scripts/android-build-preflight.sh            checks only
#   scripts/android-build-preflight.sh --build    checks, then: SENTRY_DISABLE_AUTO_UPLOAD=true eas build --platform android --profile production --local
#                                                 (drop the SENTRY_DISABLE_AUTO_UPLOAD part by hand for a cloud build that uploads source maps)
#
# It refuses to continue when: the branch is not release/android-1.1.10, tracked files are modified, node_modules is tracked,
# the Android fingerprint is not in ANDROID_RECOVERY_RUNTIMES (that binary would hide visit recovery), or the tests fail.
# The fingerprint is computed in THIS checkout with its real node_modules (same method that reproduced an installed AAB's runtime).
set -o pipefail
fail() { echo "ERROR: $*" >&2; exit 1; }
cd "$(git rev-parse --show-toplevel)" || exit 1
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "branch: $BRANCH @ $(git rev-parse --short HEAD)"
[ "$BRANCH" = "release/android-1.1.10" ] || fail "build Android from release/android-1.1.10 (this is $BRANCH)"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { git status --short --untracked-files=no; fail "tracked files have uncommitted changes"; }
[ -z "$(git ls-files node_modules)" ] || fail "node_modules is tracked in git"
[ -d node_modules ] && [ ! -L node_modules ] || fail "node_modules must be a real directory here (npm ci)"
FP=$(npx --no-install expo-updates fingerprint:generate --platform android 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['hash'])") || fail "fingerprint failed"
echo "android runtime of this tree: $FP"
grep -q "$FP" lib/visitDetection/recoveryPolicy.js || fail "runtime $FP is not in ANDROID_RECOVERY_RUNTIMES: the app would hide visit recovery. Find the native change, do not just add the hash."
node --test lib/*.test.js lib/visitDetection/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
node --test lib/*.test.js lib/visitDetection/*.test.js >/dev/null 2>&1 || fail "unit tests failing"
echo "pre-flight OK"
if [ "$1" = "--build" ]; then SENTRY_DISABLE_AUTO_UPLOAD=true npx eas-cli build --platform android --profile production --local; fi
