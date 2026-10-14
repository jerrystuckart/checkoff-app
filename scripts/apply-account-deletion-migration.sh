#!/bin/bash
# Preflight and apply for the FINAL account deletion migration (rev 4). Rollback: docs/security/rollback_account_deletion_20261008d.sql
#
#   scripts/apply-account-deletion-migration.sh            PREFLIGHT ONLY: read only checks, changes nothing
#   scripts/apply-account-deletion-migration.sh --apply    the same checks, then (after you type the confirmation phrase) applies the migration
#                                                          in ONE transaction to the linked production project
#
# Nothing is applied unless EVERY check passes: the exact file revision (sha256 pinned below), the working tree, the linked Supabase project, and live
# read only identity checks of the production database. Re-run is refused once the pipeline exists.
set -uo pipefail

EXPECTED_REF="uggusbbswybyplypkbxz"
MIGRATION="supabase/migrations/20261008d_account_deletion_pipeline.sql"
EXPECTED_SHA256="2bbaf34acb5d21a323a27524bf347d76055ea2699be060e17009e907145967f0"
EXPECTED_MARKER="STATUS 2026-10-08 (rev 4)"
CONFIRM_PHRASE="APPLY ACCOUNT DELETION REV4"

fail() { echo "PREFLIGHT FAILED: $*" >&2; exit 1; }
ok()   { echo "  ok  $*"; }
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1

cd "$(git rev-parse --show-toplevel)" || fail "not inside the repository"
command -v supabase >/dev/null || fail "supabase CLI not found"
# The project link (supabase/.temp, gitignored) lives in the main checkout; a worktree may not have it.
MAIN_CHECKOUT="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
LINK_DIR="$PWD"; [ -f "$LINK_DIR/supabase/.temp/project-ref" ] || LINK_DIR="$MAIN_CHECKOUT"
sdb() { supabase --workdir "$LINK_DIR" db query "$@"; }

echo "== 1. Migration file revision"
git ls-files --error-unmatch "$MIGRATION" >/dev/null 2>&1 || fail "$MIGRATION is not tracked by git"
git diff --quiet HEAD -- "$MIGRATION" || fail "$MIGRATION differs from the committed version (uncommitted edits)"
ACTUAL_SHA256="$(shasum -a 256 "$MIGRATION" | cut -d' ' -f1)"
[ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ] || fail "sha256 is $ACTUAL_SHA256, expected $EXPECTED_SHA256 (not the reviewed final file)"
head -1 "$MIGRATION" | grep -q "$EXPECTED_MARKER" || fail "first line is not the rev 4 marker"
ok "branch $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD), file sha256 $ACTUAL_SHA256, marker rev 4"

echo "== 2. Linked Supabase project"
LINKED_REF="$(cat "$LINK_DIR/supabase/.temp/project-ref" 2>/dev/null || true)"
[ "$LINKED_REF" = "$EXPECTED_REF" ] || fail "linked project is '$LINKED_REF', expected '$EXPECTED_REF' (the CheckOff production project)"
grep -q "https://${EXPECTED_REF}.supabase.co" "$MIGRATION" || fail "the migration does not target https://${EXPECTED_REF}.supabase.co"
ok "linked project ($LINK_DIR/supabase/.temp/project-ref) = $LINKED_REF and the migration's Storage API base URL points at the same project"

echo "== 3. Live production identity (read only)"
# The CLI's default output depends on who is running it: a human terminal gets a TABLE, an AI agent gets a JSON envelope. So ask for JSON explicitly
# (--agent=no -o json = a bare JSON array) and validate the shape. stdout, stderr and the exit status are captured separately: the CLI's notices
# ("Initialising login role...", update hints) go to stderr and never touch stdout.
SQL="select (select count(*) from storage.buckets where id in ('checkin-photos','submission-photos','checkoff-images')) as buckets,
            (select count(*) from pg_extension where extname in ('pg_net','pg_cron','supabase_vault')) as extensions,
            (select count(*) from vault.decrypted_secrets where name = 'service_role_key') as service_key_in_vault,
            (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'delete_my_account') as old_function,
            coalesce((select pg_get_function_result(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'delete_my_account' and p.pronargs = 0), 'missing') as old_function_result,
            (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('delete_my_account_v2', 'account_deletion_process')) as new_functions,
            ((to_regclass('public.account_deletion_requests') is not null) or (to_regclass('public.anonymous_completion_counts') is not null)
              or (to_regclass('public.retained_checkin_photos') is not null)) as already_applied,
            (select count(*) from public.items) as items, (select count(*) from public.users) as users"
OUT_F="$(mktemp -t acct_del_out.XXXXXX)"; ERR_F="$(mktemp -t acct_del_err.XXXXXX)"
trap 'rm -f "$OUT_F" "$ERR_F" "${TMP:-}"' EXIT

# Redacts anything that looks like a credential, token, connection string, long hex id or email before it is shown.
redact() {
  sed -E 's/eyJ[A-Za-z0-9_.-]{10,}/<jwt>/g; s/(sbp_|sb_secret_|sb_publishable_)[A-Za-z0-9_]+/\1<redacted>/g; s#(postgres(ql)?://)[^[:space:]]+#\1<redacted>#g; s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<email>/g; s/[0-9a-fA-F]{24,}/<hex>/g' | cut -c1-200
}

sdb --agent=no -o json "$SQL" --linked >"$OUT_F" 2>"$ERR_F"
CLI_EXIT=$?
if [ "$CLI_EXIT" -ne 0 ]; then
  echo "  CLASS A: the Supabase CLI itself failed (authentication, network or query error). The database identity was NOT checked." >&2
  echo "  exit status: $CLI_EXIT | stdout bytes: $(wc -c <"$OUT_F" | tr -d ' ') | stderr bytes: $(wc -c <"$ERR_F" | tr -d ' ')" >&2
  echo "  stderr (redacted, first 6 lines):" >&2; head -6 "$ERR_F" | redact | sed 's/^/    /' >&2
  fail "CLI/authentication/network/query failure (not a database mismatch). Try: supabase login ; supabase link --project-ref $EXPECTED_REF ; then rerun."
fi

# Validate the ACTUAL shape. Accepts the two documented JSON shapes: a bare array (--agent=no) or the agent envelope {"rows": [...]}. Anything else is class B.
python3 - "$OUT_F" <<'PY'
import sys, json
path = sys.argv[1]
raw = open(path, 'rb').read()
def b_fail(why):
    head = raw.split(b'\n', 1)[0]
    kind = 'table' if b'\xe2\x94' in raw else 'csv' if (b',' in head and raw.lstrip()[:1] not in (b'{', b'[')) else 'empty' if not raw.strip() else 'other'
    print("  CLASS B: the CLI exited 0 but its output is not the expected JSON. The database identity was NOT checked.")
    print(f"  reason: {why} | stdout bytes: {len(raw)} | looks like: {kind} | first byte: {raw[:1]!r}")
    sys.exit(3)
try:
    doc = json.loads(raw.decode('utf-8'))
except Exception as e:
    b_fail(f"not valid JSON ({type(e).__name__})")
rows = doc.get('rows') if isinstance(doc, dict) else doc
if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
    b_fail("expected exactly one row object; got " + (f"{type(rows).__name__} of {len(rows)}" if isinstance(rows, list) else type(rows).__name__))
r = rows[0]
want = {"buckets": int, "extensions": int, "service_key_in_vault": int, "old_function": int, "old_function_result": str, "new_functions": int, "already_applied": bool, "items": int, "users": int}
bad_shape = [k for k, t in want.items() if k not in r or isinstance(r[k], bool) != (t is bool) or not isinstance(r[k], t)]
if bad_shape or set(r) - set(want):
    b_fail("row keys or types differ from the query: " + ", ".join(bad_shape or sorted(set(r) - set(want))))
print("  live:", r)
bad = []
if r["buckets"] != 3: bad.append("expected the 3 CheckOff storage buckets, found %d" % r["buckets"])
if r["extensions"] != 3: bad.append("pg_net, pg_cron and supabase_vault must all be installed (found %d of 3)" % r["extensions"])
if r["service_key_in_vault"] != 1: bad.append("service_role_key is not in vault")
if r["old_function"] != 1: bad.append("public.delete_my_account() not found: this is not the expected database")
if r["old_function_result"] != "void": bad.append("delete_my_account() returns %r, not void: installed clients depend on that contract and this migration is built around it" % r["old_function_result"])
if r["already_applied"] or r["new_functions"] != 0: bad.append("part of the pipeline already exists (tables or functions): the pipeline is already applied")
if r["items"] < 100 or r["users"] < 10: bad.append("item and user counts do not look like production (items %d, users %d)" % (r["items"], r["users"]))
if bad:
    print("  CLASS C: the query ran and the output is valid, but this database failed the identity checks:")
    for b in bad: print("    - " + b)
    sys.exit(4)
PY
PY_EXIT=$?
case "$PY_EXIT" in
  0) ;;
  3) fail "unexpected CLI output (not a database mismatch); the identity check could not run" ;;
  4) fail "the live database does not match what this migration expects" ;;
  *) fail "internal error while validating the CLI output (exit $PY_EXIT)" ;;
esac
ok "this is the CheckOff production database and the pipeline is not applied yet"

if [ "$APPLY" -ne 1 ]; then
  echo
  echo "PREFLIGHT PASSED. Nothing was changed. To apply, run:  $0 --apply"
  exit 0
fi

echo
echo "About to apply $MIGRATION (sha256 ${ACTUAL_SHA256:0:12}...) to PRODUCTION project $LINKED_REF in one transaction."
read -r -p "Type exactly '$CONFIRM_PHRASE' to continue: " ANSWER
[ "$ANSWER" = "$CONFIRM_PHRASE" ] || fail "confirmation phrase did not match; nothing was applied"

TMP="$(mktemp -t account_deletion_apply.XXXXXX)"
{ echo "begin;"; cat "$MIGRATION"; echo; echo "commit;"; } > "$TMP"
sdb -f "$TMP" --linked || fail "the migration failed; the transaction was not committed"

echo "== Post apply check (read only)"
sdb --agent=no -o json "select
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('delete_my_account','delete_my_account_v2','account_deletion_process','account_deletion_delete_data','account_deletion_retain_inventory','account_deletion_inventory')) as functions,
  pg_get_function_result('public.delete_my_account()'::regprocedure) as old_function_result,
  pg_get_function_result('public.delete_my_account_v2()'::regprocedure) as v2_result,
  (to_regclass('public.account_deletion_requests') is not null) as requests_table, (to_regclass('public.anonymous_completion_counts') is not null) as counts_table,
  (to_regclass('public.retained_checkin_photos') is not null) as retained_table,
  (select count(*) from cron.job where jobname = 'process-account-deletions' and active) as cron_job,
  has_function_privilege('anon','public.account_deletion_process()','EXECUTE') as anon_can_run_processor,
  has_function_privilege('authenticated','public.account_deletion_delete_data(uuid)','EXECUTE') as client_can_run_delete_data,
  has_function_privilege('authenticated','public.delete_my_account()','EXECUTE') as client_can_call_old_rpc,
  has_function_privilege('authenticated','public.delete_my_account_v2()','EXECUTE') as client_can_call_v2" --linked
echo "Applied. Expect: functions=6, old_function_result=void, v2_result=jsonb, all three tables true, cron_job=1, anon_can_run_processor=false, client_can_run_delete_data=false, both client RPCs true."
echo "Next: run the disposable account test BEFORE publishing the website pages or any client update."
