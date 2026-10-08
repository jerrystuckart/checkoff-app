#!/bin/bash
# Drives scripts/apply-account-deletion-migration.sh (preflight only) with a FAKE `supabase` CLI to prove that each kind of failure is reported as what it is:
#   A  CLI/authentication/network/query failure   B  unexpected output (table, csv, empty, wrong shape)   C  valid output that fails identity checks   OK  passes
# The fake CLI never touches the network. Real project and file-revision checks (1 and 2) still run for real. Never applies anything.
cd "$(git rev-parse --show-toplevel)" || exit 1
SCRIPT=scripts/apply-account-deletion-migration.sh
FAKE_DIR="$(mktemp -d)"; trap 'rm -rf "$FAKE_DIR"' EXIT
GOOD='[{"buckets":3,"extensions":3,"service_key_in_vault":1,"old_function":1,"already_applied":false,"items":2230,"users":136}]'
FAILS=0

run_case() {  # name, fake stdout, fake stderr, fake exit, expected exit (0 or 1), expected text in output
  local name="$1" out="$2" err="$3" ec="$4" want_exit="$5" want_text="$6"
  cat > "$FAKE_DIR/supabase" <<FAKE
#!/bin/bash
printf '%s' '$out'
printf '%s' '$err' >&2
exit $ec
FAKE
  chmod +x "$FAKE_DIR/supabase"
  local got; got="$(PATH="$FAKE_DIR:$PATH" bash "$SCRIPT" 2>&1)"; local rc=$?
  local pass=1
  [ "$rc" -eq "$want_exit" ] || pass=0
  echo "$got" | grep -qF -- "$want_text" || pass=0
  if [ "$pass" -eq 1 ]; then echo "PASS  $name"; else echo "FAIL  $name (exit $rc, wanted $want_exit and text: $want_text)"; echo "$got" | sed 's/^/        /' | tail -8; FAILS=$((FAILS+1)); fi
  # secrets in the fake stderr must never be echoed
  if echo "$got" | grep -q "SECRETVALUE"; then echo "FAIL  $name leaked a secret"; FAILS=$((FAILS+1)); fi
}

run_case "valid identity passes"                 "$GOOD" "Initialising login role..." 0 0 "PREFLIGHT PASSED"
run_case "agent envelope shape is accepted"      '{"boundary":"x","rows":'"$GOOD"',"warning":"w"}' "" 0 0 "PREFLIGHT PASSED"
run_case "A: CLI auth failure is not a mismatch" "" "Invalid access token eyJhbGciOiJIUzI1NiJ9.SECRETVALUE.sig sbp_SECRETVALUE" 1 1 "CLASS A"
run_case "B: human table output"                 $'┌────┐\n│ buckets │\n└────┘' "" 0 1 "CLASS B"
run_case "B: csv output"                         $'buckets,items\n3,2230' "" 0 1 "CLASS B"
run_case "B: empty output"                       "" "" 0 1 "CLASS B"
run_case "B: wrong row count"                    '[]' "" 0 1 "CLASS B"
run_case "B: wrong key or type"                  '[{"buckets":"3"}]' "" 0 1 "CLASS B"
run_case "C: wrong database (2 buckets)"         '[{"buckets":2,"extensions":3,"service_key_in_vault":1,"old_function":1,"already_applied":false,"items":2230,"users":136}]' "" 0 1 "CLASS C"
run_case "C: already applied"                    '[{"buckets":3,"extensions":3,"service_key_in_vault":1,"old_function":1,"already_applied":true,"items":2230,"users":136}]' "" 0 1 "already applied"
run_case "C: not production sized"               '[{"buckets":3,"extensions":3,"service_key_in_vault":1,"old_function":1,"already_applied":false,"items":5,"users":2}]' "" 0 1 "do not look like production"
[ "$FAILS" -eq 0 ] && echo "ALL CASES PASSED" || { echo "$FAILS FAILURE(S)"; exit 1; }
