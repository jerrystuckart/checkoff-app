#!/bin/bash
# CheckOff local production iOS build: pre-flight checks, Sentry credential gate, full redacted build log.
#
#   scripts/ios-local-build.sh                    pre-flight checks only (nothing is built)
#   scripts/ios-local-build.sh --build            checks, then: eas build --platform ios --profile production --local
#                                                 WITH Sentry source-map upload; refuses to start if the Sentry token is missing/invalid
#   scripts/ios-local-build.sh --build --no-sentry   same build with Sentry upload explicitly disabled (SENTRY_DISABLE_AUTO_UPLOAD=true)
#   scripts/ios-local-build.sh --record-runtime   write the current runtime fingerprint to docs/release/EXPECTED_RUNTIME (do this
#                                                 deliberately after an intended native change, then commit the file)
#
# Sentry token (never passed on a command line, never printed, never written to the log) is read, in order, from:
#   1. $SENTRY_AUTH_TOKEN already in the environment
#   2. macOS Keychain item  checkoff-sentry-auth-token   (one-time setup:  security add-generic-password -a "$USER" -s checkoff-sentry-auth-token -w
#                                                          — it prompts for the value, so it never appears in history or ps)
#   3. file ~/.config/checkoff/sentry-auth-token  (must be chmod 600)
#
# Runtime fingerprint: this script only REPORTS it and warns when it differs from docs/release/EXPECTED_RUNTIME (the runtime of the
# currently shipped TestFlight binary). A difference is legitimate after a deliberate native change; it just means OTAs published from
# this tree reach only binaries built from this tree. It never blocks the build unless you pass --require-runtime-match.
#
# Full build log: ~/Library/Logs/checkoff-builds/ios-<timestamp>.log (chmod 600). The Sentry token value is replaced with <redacted>
# before anything is written. Send that file (or its last 80 lines) to diagnose build errors.
set -o pipefail
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8   # CocoaPods crashes with "Unicode Normalization … ASCII-8BIT" (hiding the real error) under other locales

BUILD=0; NO_SENTRY=0; REQUIRE_MATCH=0; RECORD=0
for a in "$@"; do case "$a" in
  --build) BUILD=1;; --no-sentry) NO_SENTRY=1;; --require-runtime-match) REQUIRE_MATCH=1;; --record-runtime) RECORD=1;;
  *) echo "unknown option: $a"; exit 2;; esac; done

fail() { echo "ERROR: $*" >&2; exit 1; }
cd "$(git rev-parse --show-toplevel)" || exit 1

echo "branch : $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { git status --short --untracked-files=no; fail "tracked files have uncommitted changes — commit them or move them aside first"; }
UNTRACKED=$(git ls-files --others --exclude-standard | wc -l | tr -d ' ')
if [ "$UNTRACKED" != 0 ]; then
  echo "note: $UNTRACKED untracked, non-ignored file(s) exist; they are uploaded in the EAS archive unless .easignore excludes them (first 5):"
  git ls-files --others --exclude-standard | head -5
fi

FP=$(npx expo-updates fingerprint:generate --platform ios 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s.slice(s.indexOf('{'))).hash))") || fail "could not compute the runtime fingerprint"
echo "runtime fingerprint: $FP"
if [ "$RECORD" = 1 ]; then printf '%s\n' "$FP" > docs/release/EXPECTED_RUNTIME; echo "recorded in docs/release/EXPECTED_RUNTIME — commit it"; exit 0; fi
EXPECTED=$(cat docs/release/EXPECTED_RUNTIME 2>/dev/null | tr -d '[:space:]')
if [ -n "$EXPECTED" ] && [ "$FP" != "$EXPECTED" ]; then
  echo "WARNING: runtime differs from docs/release/EXPECTED_RUNTIME ($EXPECTED). Expected after a deliberate native change; otherwise investigate."
  echo "         A binary built from this tree will receive only OTAs published from a tree with this same fingerprint."
  [ "$REQUIRE_MATCH" = 0 ] || fail "--require-runtime-match set and the runtime changed"
else echo "runtime matches docs/release/EXPECTED_RUNTIME"; fi

node --test lib/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)|^not ok"
node --test lib/*.test.js >/dev/null 2>&1 || fail "unit tests failing"
[ "$BUILD" = 1 ] || { echo "pre-flight OK (add --build to build)"; exit 0; }

eas whoami >/dev/null 2>&1 || fail "not logged in to EAS (run: eas login)"

if [ "$NO_SENTRY" = 1 ]; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true; echo "Sentry upload DISABLED by --no-sentry"
else
  if [ -z "$SENTRY_AUTH_TOKEN" ]; then SENTRY_AUTH_TOKEN=$(security find-generic-password -s checkoff-sentry-auth-token -w 2>/dev/null); fi
  if [ -z "$SENTRY_AUTH_TOKEN" ] && [ -f "$HOME/.config/checkoff/sentry-auth-token" ]; then
    [ "$(stat -f %Lp "$HOME/.config/checkoff/sentry-auth-token")" = 600 ] || fail "~/.config/checkoff/sentry-auth-token must be chmod 600"
    SENTRY_AUTH_TOKEN=$(tr -d '[:space:]' < "$HOME/.config/checkoff/sentry-auth-token")
  fi
  [ -n "$SENTRY_AUTH_TOKEN" ] || fail "Sentry token not found. Add it once with:  security add-generic-password -a \"\$USER\" -s checkoff-sentry-auth-token -w   (or use --no-sentry to build without uploads)"
  export SENTRY_AUTH_TOKEN
  # Validate before spending an hour: org/project from app.json. Token goes to curl on stdin (-K -), not argv.
  ORG=$(node -p "require('./app.json').expo.plugins.find(p=>Array.isArray(p)&&p[0]==='@sentry/react-native/expo')[1].organization")
  PROJ=$(node -p "require('./app.json').expo.plugins.find(p=>Array.isArray(p)&&p[0]==='@sentry/react-native/expo')[1].project")
  CODE=$(printf 'header = "Authorization: Bearer %s"\n' "$SENTRY_AUTH_TOKEN" | curl -s -o /dev/null -w '%{http_code}' -m 20 -K - "https://sentry.io/api/0/organizations/$ORG/releases/")
  [ "$CODE" = 200 ] || fail "Sentry rejected the token for $ORG/$PROJ (HTTP $CODE) — fix the credential or use --no-sentry"
  echo "Sentry token OK for $ORG/$PROJ (upload ENABLED)"
fi

LOGDIR="$HOME/Library/Logs/checkoff-builds"; mkdir -p "$LOGDIR"; chmod 700 "$LOGDIR"
LOG="$LOGDIR/ios-$(date +%Y%m%d-%H%M%S).log"; : > "$LOG"; chmod 600 "$LOG"
echo "full log: $LOG"
# Redact the token (plain substring replace, no regex, token not in any argv) while teeing.
eas build --platform ios --profile production --local 2>&1 | awk -v logf="$LOG" '
  { line=$0; t=ENVIRON["SENTRY_AUTH_TOKEN"];
    if (t != "") { while ((i=index(line,t))>0) line=substr(line,1,i-1) "<redacted>" substr(line,i+length(t)) }
    print line; print line >> logf; fflush(); fflush(logf) }'
RC=${PIPESTATUS[0]}
echo "build exit code: $RC (log: $LOG)"
exit "$RC"
