#!/bin/bash
# Preflight and apply for the FINAL account deletion migration (rev 3).
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
EXPECTED_SHA256="1e3ca1d67b548e9d106740f54dd23b43c72125d32f1de3c25cfa0d41a8441072"
EXPECTED_MARKER="STATUS 2026-10-08 (rev 3)"
CONFIRM_PHRASE="APPLY ACCOUNT DELETION REV3"

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
head -1 "$MIGRATION" | grep -q "$EXPECTED_MARKER" || fail "first line is not the rev 3 marker"
ok "branch $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD), file sha256 $ACTUAL_SHA256, marker rev 3"

echo "== 2. Linked Supabase project"
LINKED_REF="$(cat "$LINK_DIR/supabase/.temp/project-ref" 2>/dev/null || true)"
[ "$LINKED_REF" = "$EXPECTED_REF" ] || fail "linked project is '$LINKED_REF', expected '$EXPECTED_REF' (the CheckOff production project)"
grep -q "https://${EXPECTED_REF}.supabase.co" "$MIGRATION" || fail "the migration does not target https://${EXPECTED_REF}.supabase.co"
ok "linked project ($LINK_DIR/supabase/.temp/project-ref) = $LINKED_REF and the migration's Storage API base URL points at the same project"

echo "== 3. Live production identity (read only)"
SQL="select (select count(*) from storage.buckets where id in ('checkin-photos','submission-photos','checkoff-images')) as buckets,
            (select count(*) from pg_extension where extname in ('pg_net','pg_cron','supabase_vault')) as extensions,
            (select count(*) from vault.decrypted_secrets where name = 'service_role_key') as service_key_in_vault,
            (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'delete_my_account') as old_function,
            (to_regclass('public.account_deletion_requests') is not null) as already_applied,
            (select count(*) from public.items) as items, (select count(*) from public.users) as users"
OUT="$(sdb "$SQL" --linked 2>/dev/null)" || fail "could not query the linked database"
echo "$OUT" | python3 -c '
import sys, json
t = sys.stdin.read()
r = json.loads(t[t.find("{"):t.rfind("}") + 1])["rows"][0]
print("  live:", r)
bad = []
if r["buckets"] != 3: bad.append("expected the 3 CheckOff storage buckets")
if r["extensions"] != 3: bad.append("pg_net, pg_cron and supabase_vault must all be installed")
if r["service_key_in_vault"] != 1: bad.append("service_role_key is not in vault")
if r["old_function"] != 1: bad.append("public.delete_my_account() not found: this is not the expected database")
if r["already_applied"]: bad.append("account_deletion_requests already exists: the pipeline is already applied")
if int(r["items"]) < 100 or int(r["users"]) < 10: bad.append("item and user counts do not look like production")
if bad:
    print("  PROBLEM: " + "; ".join(bad)); sys.exit(1)
' || fail "the live database does not match what this migration expects"
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
trap 'rm -f "$TMP"' EXIT
{ echo "begin;"; cat "$MIGRATION"; echo; echo "commit;"; } > "$TMP"
sdb -f "$TMP" --linked || fail "the migration failed; the transaction was not committed"

echo "== Post apply check (read only)"
sdb "select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('delete_my_account','account_deletion_process','account_deletion_delete_data','account_deletion_retain_inventory','account_deletion_inventory')) as functions,
  (to_regclass('public.account_deletion_requests') is not null) as requests_table, (to_regclass('public.anonymous_completion_counts') is not null) as counts_table,
  (to_regclass('public.retained_checkin_photos') is not null) as retained_table,
  (select count(*) from cron.job where jobname = 'process-account-deletions' and active) as cron_job,
  has_function_privilege('anon','public.account_deletion_process()','EXECUTE') as anon_can_run_processor,
  has_function_privilege('authenticated','public.account_deletion_delete_data(uuid)','EXECUTE') as client_can_run_delete_data,
  has_function_privilege('authenticated','public.delete_my_account()','EXECUTE') as client_can_call_delete_my_account" --linked
echo "Applied. Expect functions=5, all three tables true, cron_job=1, anon_can_run_processor=false, client_can_run_delete_data=false, client_can_call_delete_my_account=true."
echo "Next: run the disposable account test BEFORE publishing the website pages or any client update."
