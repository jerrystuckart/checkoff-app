#!/bin/bash
# Preflight and apply for account deletion rev 5 (migration 20261008e): the Storage credential fix and the notification_queue cleanup.
#
#   scripts/apply-account-deletion-rev5.sh            PREFLIGHT ONLY (read only; changes nothing)
#   scripts/apply-account-deletion-rev5.sh --apply    the same checks, then (after a typed phrase) applies the migration in ONE transaction
#
# Requires rev 4 applied and the vault secret service_role_jwt stored (dashboard Vault UI, or scripts/store-service-role-jwt.sh). The preflight verifies the credential without printing it:
# a JWT, role service_role, this project, not expired, AND accepted by the Storage API (HTTP 200 on a read only bucket listing).
set -uo pipefail
EXPECTED_REF="uggusbbswybyplypkbxz"
MIGRATION="supabase/migrations/20261008e_account_deletion_rev5.sql"
EXPECTED_SHA256="cbb4a9e9d56110578f2da7926a3b5d614663eb853a68cdff35442444474a043d"
EXPECTED_MARKER="STATUS 2026-10-08 (rev 5)"
CONFIRM_PHRASE="APPLY ACCOUNT DELETION REV5"
fail() { echo "PREFLIGHT FAILED: $*" >&2; exit 1; }
ok()   { echo "  ok  $*"; }
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
cd "$(git rev-parse --show-toplevel)" || fail "not inside the repository"
command -v supabase >/dev/null || fail "supabase CLI not found"
MAIN_CHECKOUT="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
LINK_DIR="$PWD"; [ -f "$LINK_DIR/supabase/.temp/project-ref" ] || LINK_DIR="$MAIN_CHECKOUT"
sdb() { supabase --workdir "$LINK_DIR" db query "$@"; }
OUT_F="$(mktemp -t acct_del5_out.XXXXXX)"; ERR_F="$(mktemp -t acct_del5_err.XXXXXX)"; trap 'rm -f "$OUT_F" "$ERR_F" "${TMP:-}"' EXIT
redact() { sed -E 's/eyJ[A-Za-z0-9_.-]{10,}/<jwt>/g; s/(sbp_|sb_secret_|sb_publishable_)[A-Za-z0-9_]+/\1<redacted>/g; s#(postgres(ql)?://)[^[:space:]]+#\1<redacted>#g; s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<email>/g; s/[0-9a-fA-F]{24,}/<hex>/g' | cut -c1-200; }

# run_json "<sql>": prints nothing, leaves the validated JSON in $OUT_F; classifies failures as CLASS A (CLI), CLASS B (unexpected output)
run_json() {
  sdb --agent=no -o json "$1" --linked >"$OUT_F" 2>"$ERR_F"; local ec=$?
  if [ "$ec" -ne 0 ]; then
    echo "  CLASS A: the Supabase CLI itself failed (authentication, network or query error). Nothing was checked." >&2
    echo "  exit status: $ec | stdout bytes: $(wc -c <"$OUT_F" | tr -d ' ') | stderr (redacted, first 6 lines):" >&2; head -6 "$ERR_F" | redact | sed 's/^/    /' >&2
    fail "CLI/authentication/network/query failure (not a database mismatch). Try: supabase login ; supabase link --project-ref $EXPECTED_REF"
  fi
  python3 - "$OUT_F" <<'PY' || fail "unexpected CLI output (CLASS B); nothing was checked"
import sys, json
raw = open(sys.argv[1], 'rb').read()
try: doc = json.loads(raw.decode())
except Exception as e:
    print("  CLASS B: exit 0 but the output is not JSON (%s); %d bytes; first byte %r" % (type(e).__name__, len(raw), raw[:1])); sys.exit(3)
rows = doc.get('rows') if isinstance(doc, dict) else doc
if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
    print("  CLASS B: expected exactly one row object"); sys.exit(3)
json.dump(rows[0], open(sys.argv[1], 'w'))
PY
}

echo "== 1. Migration file revision"
git ls-files --error-unmatch "$MIGRATION" >/dev/null 2>&1 || fail "$MIGRATION is not tracked by git"
git diff --quiet HEAD -- "$MIGRATION" || fail "$MIGRATION differs from the committed version (uncommitted edits)"
ACTUAL_SHA256="$(shasum -a 256 "$MIGRATION" | cut -d' ' -f1)"
[ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ] || fail "sha256 is $ACTUAL_SHA256, expected $EXPECTED_SHA256 (not the reviewed final file)"
head -1 "$MIGRATION" | grep -q "$EXPECTED_MARKER" || fail "first line is not the rev 5 marker"
ok "branch $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD), file sha256 $ACTUAL_SHA256, marker rev 5"

echo "== 2. Linked Supabase project"
LINKED_REF="$(cat "$LINK_DIR/supabase/.temp/project-ref" 2>/dev/null || true)"
[ "$LINKED_REF" = "$EXPECTED_REF" ] || fail "linked project is '$LINKED_REF', expected '$EXPECTED_REF'"
ok "linked project = $LINKED_REF"

echo "== 3. Live state (read only): rev 4 applied, rev 5 not yet, credential present and valid"
run_json "select
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('delete_my_account','delete_my_account_v2','account_deletion_process','account_deletion_delete_data','account_deletion_retain_inventory','account_deletion_inventory')) as rev4_functions,
  coalesce((select pg_get_function_result(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='delete_my_account' and p.pronargs=0), 'missing') as legacy_result,
  coalesce((select pg_get_function_result(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='delete_my_account_v2'), 'missing') as v2_result,
  (select count(*) from cron.job where jobname='process-account-deletions' and active) as cron_job,
  (select pg_get_functiondef(p.oid) ilike '%service_role_jwt%' from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='account_deletion_process') as rev5_already,
  (select count(*) from vault.decrypted_secrets where name='service_role_jwt') as jwt_secret_rows,
  coalesce((select decrypted_secret ~ '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' from vault.decrypted_secrets where name='service_role_jwt'), false) as jwt_shaped,
  (select (convert_from(decode(translate(split_part(decrypted_secret,'.',2),'-_','+/') || repeat('=', (4 - length(split_part(decrypted_secret,'.',2)) % 4) % 4), 'base64'),'utf8'))::jsonb->>'role' from vault.decrypted_secrets where name='service_role_jwt' and decrypted_secret like 'eyJ%') as jwt_role,
  (select (convert_from(decode(translate(split_part(decrypted_secret,'.',2),'-_','+/') || repeat('=', (4 - length(split_part(decrypted_secret,'.',2)) % 4) % 4), 'base64'),'utf8'))::jsonb->>'ref' from vault.decrypted_secrets where name='service_role_jwt' and decrypted_secret like 'eyJ%') as jwt_ref,
  (select ((convert_from(decode(translate(split_part(decrypted_secret,'.',2),'-_','+/') || repeat('=', (4 - length(split_part(decrypted_secret,'.',2)) % 4) % 4), 'base64'),'utf8'))::jsonb->>'exp')::bigint > extract(epoch from now()) from vault.decrypted_secrets where name='service_role_jwt' and decrypted_secret like 'eyJ%') as jwt_unexpired,
  (select count(*) from public.account_deletion_requests where completed_at is null) as open_requests"
python3 - "$OUT_F" "$EXPECTED_REF" <<'PY' || exit 1
import sys, json
r = json.load(open(sys.argv[1])); ref = sys.argv[2]
print("  live:", {k: v for k, v in r.items()})
bad = []
if r["rev4_functions"] != 6 or r["legacy_result"] != "void" or r["v2_result"] != "jsonb" or r["cron_job"] != 1: bad.append("rev 4 is not fully applied (6 functions, legacy void, v2 jsonb, active cron job expected)")
if r["rev5_already"]: bad.append("rev 5 is already applied")
if r["jwt_secret_rows"] != 1: bad.append("vault secret service_role_jwt is missing: add it first (dashboard Vault UI, or scripts/store-service-role-jwt.sh)")
elif not r["jwt_shaped"]: bad.append("service_role_jwt is not a JWT (a new style sb_ key will not work for Storage)")
elif r["jwt_role"] != "service_role": bad.append("service_role_jwt has role %r, not service_role" % r["jwt_role"])
elif r["jwt_ref"] != ref: bad.append("service_role_jwt belongs to project %r" % r["jwt_ref"])
elif not r["jwt_unexpired"]: bad.append("service_role_jwt has expired")
if bad:
    print("  CLASS C: the query ran, but:"); [print("    - " + b) for b in bad]; sys.exit(4)
PY
ok "rev 4 applied, rev 5 not yet, service_role_jwt is a valid JWT for this project (role service_role, unexpired)"

echo "== 3b. The credential is accepted by the Storage API (read only: list buckets)"
run_json "select net.http_get(url := 'https://${EXPECTED_REF}.supabase.co/storage/v1/bucket', headers := jsonb_build_object('apikey', (select decrypted_secret from vault.decrypted_secrets where name='service_role_jwt'), 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_jwt')), timeout_milliseconds := 20000) as request_id"
RID="$(python3 -c 'import json,sys;print(int(json.load(open(sys.argv[1]))["request_id"]))' "$OUT_F")" || fail "could not read the probe request id"
STATUS=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  sdb --agent=no -o json "select status_code from net._http_response where id = $RID" --linked >"$OUT_F" 2>"$ERR_F" || continue
  STATUS="$(python3 -c 'import json,sys
try:
    d = json.load(open(sys.argv[1])); d = d.get("rows") if isinstance(d, dict) else d
    print(d[0]["status_code"] if d else "")
except Exception: print("")' "$OUT_F")"
  [ -n "$STATUS" ] && break
done
[ "$STATUS" = "200" ] || fail "the Storage API did not accept service_role_jwt (HTTP ${STATUS:-no response}); nothing was changed. Check you copied the LEGACY service_role key."
ok "Storage API accepted the credential (HTTP 200 on a bucket listing)"

if [ "$APPLY" -ne 1 ]; then
  echo; echo "PREFLIGHT PASSED. Nothing was changed. To apply, run:  $0 --apply"; exit 0
fi
echo; echo "About to apply $MIGRATION (sha256 ${ACTUAL_SHA256:0:12}...) to PRODUCTION project $LINKED_REF in one transaction."
read -r -p "Type exactly '$CONFIRM_PHRASE' to continue: " ANSWER
[ "$ANSWER" = "$CONFIRM_PHRASE" ] || fail "confirmation phrase did not match; nothing was applied"
TMP="$(mktemp -t account_deletion_rev5.XXXXXX)"
{ echo "begin;"; cat "$MIGRATION"; echo; echo "commit;"; } > "$TMP"
sdb -f "$TMP" --linked || fail "the migration failed; the transaction was not committed"
echo "== Post apply check (read only)"
sdb --agent=no -o json "select (select pg_get_functiondef(p.oid) ilike '%service_role_jwt%' from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='account_deletion_process') as process_uses_jwt,
  (select pg_get_functiondef(p.oid) ilike '%notification_queue%' from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='account_deletion_delete_data') as delete_data_cleans_queue,
  (select pg_get_function_result(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='account_deletion_process') as process_result,
  (select pg_get_function_result(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='account_deletion_delete_data') as delete_data_result,
  has_function_privilege('anon','public.account_deletion_process()','EXECUTE') as anon_can_run_processor, has_function_privilege('authenticated','public.account_deletion_delete_data(uuid)','EXECUTE') as client_can_run_delete_data" --linked
echo "Applied. Expect: both true, both results jsonb, both privileges false. Any request stuck in 'accepted' resumes within about 2 minutes. Tell me and I will finish the end to end verification."
