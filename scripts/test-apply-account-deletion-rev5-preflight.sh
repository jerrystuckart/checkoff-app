#!/bin/bash
# Drives scripts/apply-account-deletion-rev5.sh (PREFLIGHT only) with a FAKE `supabase` CLI to prove every credential and state failure is reported as what it is. Never applies anything.
cd "$(git rev-parse --show-toplevel)" || exit 1
SCRIPT=scripts/apply-account-deletion-rev5.sh
FAKE="$(mktemp -d)"; trap 'rm -rf "$FAKE"' EXIT
GOOD='{"rev4_functions":6,"legacy_result":"void","v2_result":"jsonb","cron_job":1,"rev5_already":false,"jwt_secret_rows":1,"jwt_shaped":true,"jwt_role":"service_role","jwt_ref":"uggusbbswybyplypkbxz","jwt_unexpired":true,"open_requests":1}'
FAILS=0
cat > "$FAKE/supabase" <<'FAKECLI'
#!/bin/bash
all="$*"
if [ -n "${FAKE_CLI_EXIT:-}" ]; then printf '%s' "${FAKE_CLI_STDERR:-}" >&2; exit "$FAKE_CLI_EXIT"; fi
case "$all" in
  *rev4_functions*)       printf '%s' "${FAKE_OUT_TABLE:-[$FAKE_IDENTITY]}" ;;
  *"net.http_get"*)       printf '[{"request_id": 4242}]' ;;
  *"net._http_response"*) printf '[{"status_code": %s}]' "${FAKE_STATUS:-200}" ;;
  *)                      printf '[]' ;;
esac
FAKECLI
chmod +x "$FAKE/supabase"
run_case() {  # name, env assignments..., -- expected exit, expected text
  local name="$1"; shift; local envs=(); while [ "$1" != "--" ]; do envs+=("$1"); shift; done; shift
  local want_exit="$1" want_text="$2"
  local got; got="$(env "${envs[@]}" FAKE_IDENTITY="${FAKE_IDENTITY_OVERRIDE:-$GOOD}" PATH="$FAKE:$PATH" bash "$SCRIPT" 2>&1)"; local rc=$?
  local pass=1; [ "$rc" -eq "$want_exit" ] || pass=0; echo "$got" | grep -qF -- "$want_text" || pass=0
  if echo "$got" | grep -q "SECRETVALUE"; then pass=0; echo "   LEAKED a secret"; fi
  if [ "$pass" -eq 1 ]; then echo "PASS  $name"; else echo "FAIL  $name (exit $rc, wanted $want_exit and text: $want_text)"; echo "$got" | tail -6 | sed 's/^/        /'; FAILS=$((FAILS+1)); fi
}
mod() { python3 -c "import json,sys;d=json.loads(sys.argv[1]);d.update(json.loads(sys.argv[2]));print(json.dumps(d))" "$GOOD" "$1"; }
run_case "valid credential and state"            FAKE_STATUS=200 -- 0 "PREFLIGHT PASSED"
FAKE_IDENTITY_OVERRIDE="$(mod '{"jwt_secret_rows":0,"jwt_shaped":false,"jwt_role":null,"jwt_ref":null,"jwt_unexpired":null}')" run_case "C: credential missing" -- 1 "service_role_jwt is missing"
FAKE_IDENTITY_OVERRIDE="$(mod '{"jwt_shaped":false,"jwt_role":null,"jwt_ref":null,"jwt_unexpired":null}')" run_case "C: new style sb_ key (not a JWT)" -- 1 "not a JWT"
FAKE_IDENTITY_OVERRIDE="$(mod '{"jwt_role":"anon"}')" run_case "C: the anon key by mistake" -- 1 "not service_role"
FAKE_IDENTITY_OVERRIDE="$(mod '{"jwt_ref":"someotherproject"}')" run_case "C: a JWT for another project" -- 1 "belongs to project"
FAKE_IDENTITY_OVERRIDE="$(mod '{"jwt_unexpired":false}')" run_case "C: expired credential" -- 1 "has expired"
FAKE_IDENTITY_OVERRIDE="$(mod '{"rev5_already":true}')" run_case "C: rev 5 already applied" -- 1 "already applied"
FAKE_IDENTITY_OVERRIDE="$(mod '{"rev4_functions":5}')" run_case "C: rev 4 not fully applied" -- 1 "rev 4 is not fully applied"
FAKE_IDENTITY_OVERRIDE="$(mod '{"legacy_result":"jsonb"}')" run_case "C: legacy function no longer void" -- 1 "rev 4 is not fully applied"
run_case "C: Storage rejects the credential (403)" FAKE_STATUS=403 -- 1 "did not accept service_role_jwt"
run_case "A: CLI failure (token redacted)"        FAKE_CLI_EXIT=1 "FAKE_CLI_STDERR=Invalid access token eyJhbGciOiJIUzI1NiJ9.SECRETVALUE.sig" -- 1 "CLASS A"
run_case "B: human table output"                  "FAKE_OUT_TABLE=┌───┐" -- 1 "CLASS B"
[ "$FAILS" -eq 0 ] && echo "ALL CASES PASSED" || { echo "$FAILS FAILURE(S)"; exit 1; }
