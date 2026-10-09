#!/bin/bash
# Read only check of an App Review / Play reviewer account you created in the Supabase dashboard (no password is read, printed or stored).
#   scripts/verify-reviewer-account.sh appreview@example.com
# Passes when: the auth user exists and is email confirmed, has a profile row, is NOT an admin, photo admin or visit tester, is not banned, has no deletion request,
# and the master recovery flag is on for everyone (so the reviewer sees the recovery card). Run from a checkout whose supabase/.temp points at the production project
# (the main checkout), or pass SUPABASE_WORKDIR.
set -uo pipefail
EMAIL="${1:-}"; [ -n "$EMAIL" ] || { echo "usage: $0 reviewer@example.com"; exit 2; }
case "$EMAIL" in *"'"*) echo "bad address"; exit 2;; esac
WD="${SUPABASE_WORKDIR:-$(git rev-parse --show-toplevel)}"
q() { supabase --workdir "$WD" db query --linked --agent=no -o json "$1" 2>/dev/null; }
python3 - "$EMAIL" "$(q "select u.id, u.email_confirmed_at is not null as confirmed, (u.banned_until is not null and u.banned_until > now()) as banned, p.id is not null as has_profile, coalesce(p.is_admin,false) as is_admin, coalesce(p.visit_detection_tester,false) as tester, exists(select 1 from photo_admins a where a.user_id=u.id) as photo_admin, exists(select 1 from account_deletion_requests r where r.user_id=u.id) as deletion_requested from auth.users u left join public.users p on p.id=u.id where lower(u.email)=lower('$EMAIL')")" "$(q "select enabled_globally from feature_flags where key='candidate_visit_detection'")" <<'PY'
import sys, json
email = sys.argv[1]
def load(t):
    try: return json.loads(t[t.index('['):t.rindex(']') + 1])
    except Exception: return []
rows, flag = load(sys.argv[2]), load(sys.argv[3])
if not rows: print(f'FAIL: no auth user for {email}'); sys.exit(1)
r = rows[0]; bad = []
if not r['confirmed']: bad.append('email is not confirmed (tick "Auto Confirm User" when creating it)')
if r['banned']: bad.append('user is banned')
if not r['has_profile']: bad.append('no profile row yet: sign in once in the app, then rerun')
if r['is_admin']: bad.append('account is an ADMIN: use a plain account')
if r['photo_admin']: bad.append('account is a photo admin')
if r['tester']: bad.append('account is a visit detection tester')
if r['deletion_requested']: bad.append('a deletion request exists')
if not (flag and flag[0].get('enabled_globally')): bad.append('master recovery flag candidate_visit_detection is OFF')
print('PASS: reviewer account is confirmed, plain (no admin, photo admin or tester flags), not banned, no deletion request, recovery flag on.' if not bad else 'FAIL:\n  - ' + '\n  - '.join(bad))
sys.exit(1 if bad else 0)
PY
