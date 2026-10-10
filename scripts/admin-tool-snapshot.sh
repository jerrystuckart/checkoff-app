#!/bin/bash
# Saves a credential-free copy of the local admin tool (~/Downloads/checkoff_admin.html) into the repo.
#   scripts/admin-tool-snapshot.sh [path-to-live-admin-html]
# The live file embeds the Supabase anon key and the legacy service_role key as literals (see
# docs/security/ADMIN_TOOL_SERVICE_KEY_DEPENDENCY.md). The snapshot replaces every JWT literal with a lookup on window.*,
# which checkoff_admin_secrets.js (local, never committed) may define, and refuses to write if any 'eyJ' token survives.
# The name is deliberately NOT checkoff_admin.html: .gitignore / .easignore list that exact name, and editing those files
# changes the native runtime fingerprint.
set -euo pipefail
SRC="${1:-$HOME/Downloads/checkoff_admin.html}"
cd "$(git rev-parse --show-toplevel)"
OUT="tools/admin/checkoff_admin.sanitized.html"
python3 - "$SRC" "$OUT" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
names = {'SUPABASE_KEY': 'CHECKOFF_SUPABASE_ANON_KEY', 'SERVICE_KEY': 'CHECKOFF_SERVICE_KEY'}
for const, win in names.items():
    s, n = re.subn(r"(const %s\s*=\s*)'eyJ[A-Za-z0-9_\-\.]+'" % const, r"\1(typeof window !== 'undefined' && window.%s) || ''" % win, s)
    if n != 1:
        sys.exit('expected exactly one %s literal, found %d' % (const, n))
if re.search(r'eyJ[A-Za-z0-9_\-]{10,}', s):
    sys.exit('a JWT-like literal is still present: refusing to write')
header = ("<!-- SANITIZED SNAPSHOT: no credentials. Define window.CHECKOFF_SUPABASE_ANON_KEY and window.CHECKOFF_SERVICE_KEY in "
          "checkoff_admin_secrets.js (local only) to run it, or paste the keys into a private copy. Regenerate with scripts/admin-tool-snapshot.sh. -->\n")
open(out, 'w', encoding='utf-8').write(header + s)
print('wrote', out, len(s), 'bytes')
PY
grep -c "eyJ" "$OUT" | sed 's/^/remaining eyJ occurrences: /'
