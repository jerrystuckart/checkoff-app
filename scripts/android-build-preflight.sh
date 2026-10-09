#!/bin/bash
# CheckOff Android release pre-flight. Run from the checkout you are about to build. Builds nothing unless --build is passed.
#
#   scripts/android-build-preflight.sh            checks only
#   scripts/android-build-preflight.sh --build    checks, then: eas build --platform android --profile production --local WITH Sentry source map upload for the
#                                                 EMBEDDED release bundle (the Sentry Gradle/Expo plugin uploads during the build). Refuses to start if the token is
#                                                 missing or rejected, and after the build scans the redacted build log for the upload report and FAILS if it is absent.
#   scripts/android-build-preflight.sh --build --no-sentry   the old behavior: SENTRY_DISABLE_AUTO_UPLOAD=true (NO source maps for the embedded bundle; production crashes stay unsymbolicated)
#
# Sentry token (never on a command line, never printed, never in the log): $SENTRY_AUTH_TOKEN, Keychain item checkoff-sentry-auth-token, or file
# ~/.config/checkoff/sentry-auth-token (chmod 600). It is validated against the organization releases endpoint, which accepts the CI scoped token.
# Note: the earlier `SENTRY_DISABLE_AUTO_UPLOAD=true` command never uploaded anything and nothing verified an upload; this script now does both.
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
[ "$1" = "--build" ] || exit 0
NO_SENTRY=0; for a in "$@"; do [ "$a" = "--no-sentry" ] && NO_SENTRY=1; done
LOGDIR="$HOME/Library/Logs/checkoff-builds"; mkdir -p "$LOGDIR"; chmod 700 "$LOGDIR"
LOG="$LOGDIR/android-$(date +%Y%m%d-%H%M%S).log"; : > "$LOG"; chmod 600 "$LOG"
if [ "$NO_SENTRY" = 1 ]; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true; echo "Sentry upload DISABLED by --no-sentry (embedded bundle will NOT have source maps)"
else
  unset SENTRY_DISABLE_AUTO_UPLOAD
  if [ -z "$SENTRY_AUTH_TOKEN" ]; then SENTRY_AUTH_TOKEN=$(security find-generic-password -s checkoff-sentry-auth-token -w 2>/dev/null); fi
  if [ -z "$SENTRY_AUTH_TOKEN" ] && [ -f "$HOME/.config/checkoff/sentry-auth-token" ]; then
    [ "$(stat -f %Lp "$HOME/.config/checkoff/sentry-auth-token")" = 600 ] || fail "~/.config/checkoff/sentry-auth-token must be chmod 600"
    SENTRY_AUTH_TOKEN=$(tr -d '[:space:]' < "$HOME/.config/checkoff/sentry-auth-token")
  fi
  [ -n "$SENTRY_AUTH_TOKEN" ] || fail "Sentry token not found (env, Keychain item checkoff-sentry-auth-token, or ~/.config/checkoff/sentry-auth-token). Add it, or rerun with --no-sentry."
  export SENTRY_AUTH_TOKEN
  ORG=$(node -p "require('./app.json').expo.plugins.find(p=>Array.isArray(p)&&p[0]==='@sentry/react-native/expo')[1].organization")
  PROJ=$(node -p "require('./app.json').expo.plugins.find(p=>Array.isArray(p)&&p[0]==='@sentry/react-native/expo')[1].project")
  CODE=$(printf 'header = "Authorization: Bearer %s"\n' "$SENTRY_AUTH_TOKEN" | curl -s -o /dev/null -w '%{http_code}' -m 20 -K - "https://sentry.io/api/0/organizations/$ORG/releases/")
  [ "$CODE" = 200 ] || fail "Sentry rejected the token for $ORG/$PROJ (HTTP $CODE): fix it or rerun with --no-sentry"
  echo "Sentry token OK for $ORG/$PROJ (embedded bundle source map upload ENABLED)"
fi
echo "full log: $LOG"
# Run EAS under a pseudo terminal (macOS `script`) so it sees an interactive stdin AND stdout: its prompts (Apple login, credentials, keystore) are visible and
# answerable. The previous `eas ... 2>&1 | awk` made stdout a pipe: prompts have no trailing newline, so awk held them back and the build looked stuck.
# The raw transcript is redacted (Sentry token, ANSI codes, carriage returns) into $LOG when the run ends, then deleted. The token is never in an argument.
RAW="$(mktemp -t eas-raw.XXXXXX)"; chmod 600 "$RAW"
finish_log() {
  [ -s "$RAW" ] && python3 - "$RAW" "$LOG" <<'PY'
import os, re, sys
t = open(sys.argv[1], 'rb').read().decode('utf-8', 'replace')
tok = os.environ.get('SENTRY_AUTH_TOKEN', '')
if tok: t = t.replace(tok, '<redacted>')
t = re.sub(r'\x1b\[[0-9;?]*[ -/]*[@-~]', '', t).replace('\r', '').replace('\x04', '').replace('\x08', '')
open(sys.argv[2], 'a').write(t)
PY
  rm -f "$RAW"
}
trap finish_log EXIT
if [ -t 0 ] && [ -t 1 ]; then
  script -q "$RAW" npx eas-cli build --platform android --profile production --local
  RC=$?
else
  # No terminal (CI, an automation session, output piped): a pty is impossible, so EAS runs non interactively (it fails fast instead of prompting) and its output is teed.
  npx eas-cli build --platform android --profile production --local --non-interactive 2>&1 | tee "$RAW"
  RC=${PIPESTATUS[0]}
fi
finish_log; trap - EXIT
echo "build exit code: $RC (log: $LOG)"
[ "$RC" = 0 ] || exit "$RC"
if [ "$NO_SENTRY" = 1 ]; then echo "Sentry: upload was disabled; nothing to verify."; exit 0; fi
# Verification: the Sentry upload step must have reported success in this build's log. Debug ids are not readable from the Hermes bytecode, and the CI scoped
# token cannot read artifact bundles, so the build log is the evidence available on this machine.
if grep -Eiq "Source Map Upload Report|Uploaded [0-9]+ (file|source|bundle|artifact)|sourcemaps upload|source map.*upload(ed)?|Successfully uploaded" "$LOG" && ! grep -Eiq "sentry.*(error:|failed to upload|authentication failed|401|403)" "$LOG"; then
  echo "Sentry: upload report found in the build log and no Sentry error lines: source maps for the embedded bundle were uploaded."
else
  echo "Sentry: NOT VERIFIED. No upload report (or a Sentry error) in $LOG. Check: grep -i sentry \"$LOG\" | tail -30" >&2
  echo "        and Sentry > Settings > Projects > react-native-rp > Source Maps. Do not ship this build as symbolicated until confirmed." >&2
  exit 4
fi
