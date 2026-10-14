#!/bin/bash
# Fills the two admin secrets into the existing private admin configuration file (~/Downloads/checkoff_admin_secrets.js, loaded by checkoff_admin.html)
# from their private sources, WITHOUT printing them, without putting them in shell history, arguments or the browser console.
#   ADMIN_SECRET           <- ~/.config/checkoff/admin-secret            (read by admin-partner-link, admin-creator-link, send-confirmation-request-link)
#   CAMPAIGN_ADMIN_SECRET  <- ~/.config/checkoff/campaign-admin-secret   (x-campaign-secret for the email and notification functions)
# Usage: scripts/admin-secrets-setup.sh [path-to-checkoff_admin_secrets.js]     (idempotent: replaces its own two lines, leaves everything else alone)
# After running it, reload checkoff_admin.html. Values never leave your machine except in the calls the tool makes to the functions.
set -uo pipefail
TARGET="${1:-$HOME/Downloads/checkoff_admin_secrets.js}"
fail() { echo "STOPPED: $*" >&2; exit 1; }
for f in "$HOME/.config/checkoff/admin-secret" "$HOME/.config/checkoff/campaign-admin-secret"; do
  [ -r "$f" ] || fail "$f is missing"
  [ "$(stat -f %Lp "$f" 2>/dev/null || stat -c %a "$f")" = "600" ] || fail "$f must be mode 600"
done
[ -f "$TARGET" ] || fail "$TARGET not found (it is the file checkoff_admin.html loads with a script tag)"
python3 - "$TARGET" <<'PY'
import os, sys, re
t = sys.argv[1]
home = os.path.expanduser('~/.config/checkoff')
adm = open(f'{home}/admin-secret').read().strip(); camp = open(f'{home}/campaign-admin-secret').read().strip()
assert adm and camp and adm != camp, 'secrets missing or identical'
assert "'" not in adm and "'" not in camp and '\\' not in adm and '\\' not in camp
s = open(t).read()
s = re.sub(r"^window\.CHECKOFF_(ADMIN|CAMPAIGN)_SECRET = .*\n?", "", s, flags=re.M)
if not s.endswith("\n"): s += "\n"
s += f"window.CHECKOFF_ADMIN_SECRET = '{adm}'\nwindow.CHECKOFF_CAMPAIGN_SECRET = '{camp}'\n"
fd = os.open(t, os.O_WRONLY | os.O_TRUNC); os.write(fd, s.encode()); os.close(fd)
os.chmod(t, 0o600)
print('OK: wrote CHECKOFF_ADMIN_SECRET and CHECKOFF_CAMPAIGN_SECRET into', t, '(mode 600). Values not shown.')
PY
