#!/bin/bash
# Stores the project's LEGACY service_role JWT in Supabase Vault as `service_role_jwt`, for the account deletion pipeline's Storage API calls (rev 5).
#
# WHY: the existing vault secret `service_role_key` is a new style `sb_...` key. The Storage API rejects it ("Invalid Compact JWS") however it is sent, so file moves and deletes
# cannot run with it. The pipeline needs the legacy JWT service_role key.
# WHERE TO GET IT: Supabase dashboard > Project Settings > API Keys > "Legacy API keys" tab > service_role (copy). Keep it out of chat, files and history.
#
#   scripts/store-service-role-jwt.sh            prompts (input hidden), validates it, stores it; refuses to overwrite an existing secret
#   scripts/store-service-role-jwt.sh --replace  replaces an existing `service_role_jwt` (key rotation)
#
# RECOMMENDED ALTERNATIVE: add the secret in the dashboard instead (Integrations > Vault > Add new secret, name exactly `service_role_jwt`). That avoids sending the value inside a SQL
# statement, which the Management API and Postgres query logs could record. This script exists for people who prefer the terminal; either way the rev 5 preflight verifies the secret.
#
# The value is read with `read -s`, validated locally (a JWT, role service_role, THIS project, not expired) and written to a mode 600 temp file that is deleted on exit; it is
# never echoed, never put on a command line, and never logged. Only the validation result (role, project ref, expiry date) is printed.
set -uo pipefail
EXPECTED_REF="uggusbbswybyplypkbxz"
fail() { echo "STOPPED: $*" >&2; exit 1; }
REPLACE=0; [ "${1:-}" = "--replace" ] && REPLACE=1
cd "$(git rev-parse --show-toplevel)" || fail "not inside the repository"
command -v supabase >/dev/null || fail "supabase CLI not found"
MAIN_CHECKOUT="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
LINK_DIR="$PWD"; [ -f "$LINK_DIR/supabase/.temp/project-ref" ] || LINK_DIR="$MAIN_CHECKOUT"
[ "$(cat "$LINK_DIR/supabase/.temp/project-ref" 2>/dev/null)" = "$EXPECTED_REF" ] || fail "the linked project is not $EXPECTED_REF"
sdb() { supabase --workdir "$LINK_DIR" db query "$@"; }

EXISTS="$(sdb --agent=no -o json "select count(*) as n from vault.secrets where name = 'service_role_jwt'" --linked 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["n"])' 2>/dev/null)" || fail "could not query the vault (CLI/authentication/network problem)"
if [ "$EXISTS" != "0" ] && [ "$REPLACE" -ne 1 ]; then fail "service_role_jwt already exists in the vault. Use --replace to rotate it."; fi

printf "Paste the legacy service_role JWT (input is hidden), then press Return: "
IFS= read -rs JWT; echo
JWT="$(printf '%s' "$JWT" | tr -d '[:space:]')"
[ -n "$JWT" ] || fail "nothing entered"

# validate locally; the value goes to python on stdin, never on a command line
printf '%s' "$JWT" | EXPECTED_REF="$EXPECTED_REF" python3 -c '
import sys, os, re, json, base64, time
t = sys.stdin.read()
def fail(m): print("STOPPED: " + m, file=sys.stderr); sys.exit(1)
if not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", t): fail("that is not a JWT (three dot separated parts). New style sb_ keys do not work for Storage.")
def part(p): return json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
try:
    h, c = part(t.split(".")[0]), part(t.split(".")[1])
except Exception: fail("could not decode the JWT")
if c.get("role") != "service_role": fail("the JWT role is %r, not service_role (do not use the anon key)" % c.get("role"))
if c.get("ref") != os.environ["EXPECTED_REF"]: fail("the JWT belongs to project %r, not %s" % (c.get("ref"), os.environ["EXPECTED_REF"]))
exp = c.get("exp")
if exp and exp < time.time(): fail("the JWT has expired")
print("  validated: role=service_role, project=%s, alg=%s, expires=%s" % (c["ref"], h.get("alg"), time.strftime("%Y-%m-%d", time.gmtime(exp)) if exp else "never"))
' || exit 1

TMP="$(mktemp -t svcjwt.XXXXXX)"; chmod 600 "$TMP"; trap 'rm -f "$TMP"' EXIT
if [ "$EXISTS" = "0" ]; then
  printf "select vault.create_secret('%s', 'service_role_jwt', 'legacy service_role JWT for the account deletion pipeline Storage calls (rev 5)') as id;\n" "$JWT" > "$TMP"
else
  printf "select vault.update_secret((select id from vault.secrets where name = 'service_role_jwt'), '%s') as updated;\n" "$JWT" > "$TMP"
fi
unset JWT
sdb --agent=no -o json -f "$TMP" --linked >/dev/null 2>&1 || fail "the vault write failed (the value was NOT stored)"
rm -f "$TMP"
echo "  stored as vault secret 'service_role_jwt'. Next: scripts/apply-account-deletion-rev5.sh (preflight verifies it against the Storage API)."
