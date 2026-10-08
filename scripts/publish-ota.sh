#!/bin/bash
# Publishes a JavaScript only EAS Update (OTA) for ONE platform, with Sentry source maps, after proving the update is compatible with the binary people actually have.
#
#   scripts/publish-ota.sh ios            CHECK ONLY: every verification, a real bundle export, and the credential check. Publishes nothing.
#   scripts/publish-ota.sh android
#   scripts/publish-ota.sh ios --publish  the same checks, then: upload source maps (verified) -> publish THAT SAME export. Refuses to publish without the maps.
#
# Run each platform from its own release checkout:  iOS from production/1.1.10-canonical,  Android from release/android-1.1.10.
#
# Compatibility proof (all must hold): right branch and tip == origin, clean tree, no generated native folder, real node_modules, descends from the previous published source,
# NO native input changed since that source (package.json, lockfile, app.json, modules/, eas.json), the platform's runtime fingerprint EQUALS the installed binary's runtime,
# unit tests pass, and the export contains Sentry debug ids. The channel is `production` for both platforms (branch `production`).
#
# Sentry token, read in this order and NEVER printed or put on a command line: $SENTRY_AUTH_TOKEN, Keychain item `checkoff-sentry-auth-token`,
# file ~/.config/checkoff/sentry-auth-token (chmod 600). One time setup:  security add-generic-password -a "$USER" -s checkoff-sentry-auth-token -w   (it prompts)
set -uo pipefail
PLATFORM="${1:-}"; PUBLISH=0; [ "${2:-}" = "--publish" ] && PUBLISH=1
fail() { echo "STOPPED: $*" >&2; exit 1; }
ok()   { echo "  ok  $*"; }
cd "$(git rev-parse --show-toplevel)" || fail "not inside the repository"
case "$PLATFORM" in
  ios)     BRANCH="production/1.1.10-canonical"; EXPECTED_RUNTIME="$(head -1 docs/release/EXPECTED_RUNTIME 2>/dev/null | tr -d '[:space:]')"
           ANCHOR="f237aaf"; INSTALLED="TestFlight 1.1.10 (runtime from docs/release/EXPECTED_RUNTIME)";;
  android) BRANCH="release/android-1.1.10"; EXPECTED_RUNTIME="53ba13b59fec2f2667b5ce1f9568e19f8f5076b3"
           ANCHOR="e7b8aa1"; INSTALLED="Play internal testing 1.1.10 (21), runtime read from the AAB asset 'fingerprint'";;
  *) fail "usage: scripts/publish-ota.sh ios|android [--publish]";;
esac
[ -n "$EXPECTED_RUNTIME" ] || fail "no expected runtime on record"
echo "== 1. Source and compatibility ($PLATFORM)"
[ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || fail "run this from branch $BRANCH (this is $(git rev-parse --abbrev-ref HEAD))"
git fetch -q origin 2>/dev/null; [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ] || fail "local tip differs from origin/$BRANCH (push or pull first)"
[ -z "$(git status --porcelain --untracked-files=no)" ] || fail "tracked files have uncommitted changes"
[ ! -d ios ] && [ ! -d android ] || fail "a generated ios/ or android/ folder exists: an OTA published from here would not be reproducible"
[ -d node_modules ] && [ ! -L node_modules ] || fail "node_modules must be a real directory (npm ci); a symlink gives wrong fingerprints"
git merge-base --is-ancestor "$ANCHOR" HEAD || fail "HEAD does not descend from $ANCHOR (every OTA is a full snapshot: never publish from a branch missing the previous update's commits)"
CHANGED="$(git diff --stat "$ANCHOR" HEAD -- package.json package-lock.json app.json modules eas.json | tail -1)"
[ -z "$CHANGED" ] || fail "native inputs changed since $ANCHOR ($CHANGED): this needs a new binary, not an OTA"
FP="$(npx --no-install expo-updates fingerprint:generate --platform "$PLATFORM" 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["hash"])')" || fail "could not compute the fingerprint"
[ "$FP" = "$EXPECTED_RUNTIME" ] || fail "runtime mismatch: this tree is $FP, the installed binary is $EXPECTED_RUNTIME. Never force a match."
ok "branch $BRANCH @ $(git rev-parse --short HEAD) == origin, clean, descends from $ANCHOR, no native input changed, runtime $FP == installed $INSTALLED"
echo "== 2. Tests"
node --test lib/*.test.js lib/visitDetection/*.test.js >/tmp/ota_tests.$$ 2>&1 || { grep -E "^not ok" /tmp/ota_tests.$$ | head -5; fail "unit tests failing"; }
ok "$(grep -E '^# pass' /tmp/ota_tests.$$) tests passed"; rm -f /tmp/ota_tests.$$
echo "== 3. Export and Sentry debug ids"
DIST="$(mktemp -d -t ota_dist.XXXXXX)"; trap 'rm -rf "$DIST"; unset SENTRY_AUTH_TOKEN' EXIT
SENTRY_DISABLE_AUTO_UPLOAD=true npx --no-install expo export --platform "$PLATFORM" --output-dir "$DIST" >/tmp/ota_export.$$ 2>&1 || { tail -5 /tmp/ota_export.$$; fail "expo export failed"; }
rm -f /tmp/ota_export.$$
MAPS="$(find "$DIST" -name '*.map' | head -3)"; [ -n "$MAPS" ] || fail "the export produced no source map"
for m in $MAPS; do node node_modules/@sentry/react-native/scripts/has-sourcemap-debugid.js "$m" >/dev/null 2>&1 || fail "source map $(basename "$m") has no Sentry debug id"; done
ok "bundle exported; every source map carries a Sentry debug id"
echo "== 4. Sentry credential"
if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then SENTRY_AUTH_TOKEN="$(security find-generic-password -s checkoff-sentry-auth-token -w 2>/dev/null || true)"; fi
if [ -z "${SENTRY_AUTH_TOKEN:-}" ] && [ -f "$HOME/.config/checkoff/sentry-auth-token" ]; then
  [ "$(stat -f %Lp "$HOME/.config/checkoff/sentry-auth-token")" = 600 ] || fail "~/.config/checkoff/sentry-auth-token must be chmod 600"
  SENTRY_AUTH_TOKEN="$(tr -d '[:space:]' < "$HOME/.config/checkoff/sentry-auth-token")"
fi
if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  echo "  --  NO SENTRY TOKEN FOUND (environment, Keychain item checkoff-sentry-auth-token, file ~/.config/checkoff/sentry-auth-token)."
  echo "      Everything above passed. To enable publishing, add the token once (it prompts; nothing is echoed):"
  echo "          security add-generic-password -a \"\$USER\" -s checkoff-sentry-auth-token -w"
  echo "      then rerun:  scripts/publish-ota.sh $PLATFORM --publish"
  [ "$PUBLISH" -eq 1 ] && fail "refusing to publish without source maps"
  echo; echo "CHECK COMPLETE: compatible and ready; NOT published (no Sentry token)."; exit 2
fi
export SENTRY_AUTH_TOKEN
ORG="$(node -p "require('./app.json').expo.plugins.find(p=>Array.isArray(p)&&p[0]==='@sentry/react-native/expo')[1].organization")"
PROJ="$(node -p "require('./app.json').expo.plugins.find(p=>Array.isArray(p)&&p[0]==='@sentry/react-native/expo')[1].project")"
CODE="$(printf 'header = "Authorization: Bearer %s"\n' "$SENTRY_AUTH_TOKEN" | curl -s -o /dev/null -w '%{http_code}' -m 20 -K - "https://sentry.io/api/0/projects/$ORG/$PROJ/")"
[ "$CODE" = 200 ] || fail "Sentry rejected the token for $ORG/$PROJ (HTTP $CODE)"
ok "Sentry token accepted for $ORG/$PROJ"
if [ "$PUBLISH" -ne 1 ]; then echo; echo "CHECK COMPLETE: compatible and ready, credential valid. To publish:  scripts/publish-ota.sh $PLATFORM --publish"; exit 0; fi
echo "== 5. Upload source maps (before publishing), then publish the SAME export"
npx --no-install eas-cli whoami >/dev/null 2>&1 || fail "not logged in to EAS (eas login)"
SENTRY_ORG="$ORG" SENTRY_PROJECT="$PROJ" npx --no-install sentry-expo-upload-sourcemaps "$DIST" >/tmp/ota_sentry.$$ 2>&1 || { tail -5 /tmp/ota_sentry.$$ | sed -E 's/(token|Bearer)[^ ]*/\1 <redacted>/Ig'; rm -f /tmp/ota_sentry.$$; fail "source map upload failed: NOT publishing"; }
rm -f /tmp/ota_sentry.$$; ok "source maps uploaded to Sentry"
MSG="Account deletion client (delete_my_account_v2): accepted vs completed copy, local cleanup, banned sign in message, best effort Apple revocation (dormant). JS only, runtime ${FP:0:8}"
npx --no-install eas-cli update --branch production --platform "$PLATFORM" --environment production --message "$MSG" --input-dir "$DIST" --skip-bundler --non-interactive || fail "eas update failed (source maps are uploaded; nothing was published)"
echo "== 6. Verify"
npx --no-install eas-cli update:list --branch production --limit 3 --non-interactive --json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin); g=(d.get('currentPage') or d)[0]
print('  latest group:', g.get('group','')[:8], g.get('platforms'), 'runtime', (g.get('runtimeVersion') or '')[:8], '|', (g.get('message') or '')[:70])"
echo "PUBLISHED $PLATFORM."
