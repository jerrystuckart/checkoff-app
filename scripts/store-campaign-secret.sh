#!/bin/bash
# Copies CAMPAIGN_ADMIN_SECRET from its established local source (~/.config/checkoff/campaign-admin-secret, chmod 600) into Supabase Vault as
# `campaign_admin_secret`, so the monthly send-partner-recap cron job can send it as x-campaign-secret (migration 20261008f).
# Before writing, it checks the local value has the same SHA-256 as the DEPLOYED edge function secret (`supabase secrets list` shows digests), so the vault copy is
# guaranteed to be accepted by the handler. The value is never printed, never on a command line, never logged; it goes through a mode 600 temp file deleted on exit.
#   scripts/store-campaign-secret.sh            refuses to overwrite an existing vault entry
#   scripts/store-campaign-secret.sh --replace  rotates it
set -uo pipefail
EXPECTED_REF="uggusbbswybyplypkbxz"
SRC="$HOME/.config/checkoff/campaign-admin-secret"
fail() { echo "STOPPED: $*" >&2; exit 1; }
REPLACE=0; [ "${1:-}" = "--replace" ] && REPLACE=1
cd "$(git rev-parse --show-toplevel)" || fail "not inside the repository"
MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
LINK="$PWD"; [ -f "$LINK/supabase/.temp/project-ref" ] || LINK="$MAIN"
[ "$(cat "$LINK/supabase/.temp/project-ref" 2>/dev/null)" = "$EXPECTED_REF" ] || fail "the linked project is not $EXPECTED_REF"
[ -r "$SRC" ] || fail "$SRC not found"
[ "$(stat -f %Lp "$SRC" 2>/dev/null || stat -c %a "$SRC")" = "600" ] || fail "$SRC must be mode 600"
sdb() { supabase --workdir "$LINK" db query --linked --agent=no -o json "$@"; }
LOCAL_SHA="$(python3 -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1]).read().strip().encode()).hexdigest())' "$SRC")"
DEPLOYED_SHA="$(supabase secrets list --project-ref "$EXPECTED_REF" 2>/dev/null | awk '$1=="CAMPAIGN_ADMIN_SECRET"{print $3}')"
[ -n "$DEPLOYED_SHA" ] || fail "CAMPAIGN_ADMIN_SECRET is not set on the project (or not logged in)"
[ "$LOCAL_SHA" = "$DEPLOYED_SHA" ] || fail "the local secret does not match the deployed CAMPAIGN_ADMIN_SECRET: not copying"
EXISTS="$(sdb "select count(*) as n from vault.secrets where name='campaign_admin_secret'" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["n"])' 2>/dev/null)" || fail "could not query the vault"
if [ "$EXISTS" != "0" ] && [ "$REPLACE" -ne 1 ]; then fail "campaign_admin_secret already exists in the vault (use --replace)"; fi
TMP="$(mktemp -t campsec.XXXXXX)"; chmod 600 "$TMP"; trap 'rm -f "$TMP"' EXIT
SRC="$SRC" EXISTS="$EXISTS" python3 - "$TMP" <<'PY'
import os,sys
v=open(os.environ["SRC"]).read().strip()
assert "'" not in v and len(v)>=24
if os.environ["EXISTS"]=="0":
    q="select vault.create_secret('%s','campaign_admin_secret','x-campaign-secret for the monthly send-partner-recap cron job') as id;\n"%v
else:
    q="select vault.update_secret((select id from vault.secrets where name='campaign_admin_secret'),'%s') as updated;\n"%v
open(sys.argv[1],"w").write(q)
PY
sdb -f "$TMP" >/dev/null 2>&1 || fail "the vault write failed (the value was NOT stored)"
rm -f "$TMP"
VSHA="$(sdb "select encode(sha256(convert_to(decrypted_secret,'utf8')),'hex') as h from vault.decrypted_secrets where name='campaign_admin_secret'" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["h"])')"
[ "$VSHA" = "$DEPLOYED_SHA" ] && echo "OK: vault campaign_admin_secret stored; its SHA-256 equals the deployed CAMPAIGN_ADMIN_SECRET digest" || fail "stored, but the vault digest does not match the deployed secret"
