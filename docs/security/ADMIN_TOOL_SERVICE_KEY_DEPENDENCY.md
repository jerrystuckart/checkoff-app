# Local admin tool: remaining service role key dependency (security follow-up, 2026-10-09)

Status: OPEN, accepted for now. The local admin tool (`~/Downloads/checkoff_admin.html`, plus `checkoff_admin_secrets.js`) keeps working.

## What it depends on
- It embeds the live Supabase LEGACY service role key as a literal (`SERVICE_KEY`) and uses it as its session token (`sessionToken = SERVICE_KEY`) for admin database operations, plus as Bearer for a few direct REST calls and for the partner renewal call. It therefore bypasses RLS for everything it does.
- It also embeds the public anon key (not sensitive).
- It no longer embeds a Resend key (removed 2026-10-09) and no longer embeds `ADMIN_SECRET` or `CAMPAIGN_ADMIN_SECRET`: both come from `checkoff_admin_secrets.js` (filled by `scripts/admin-secrets-setup.sh`).
- The old backup copy that still held the key was deleted.

## Where it is and is not
- The tool and its secrets file live in `~/Downloads`, which is not a git repository and is outside both the app repo and the website repo. They are therefore not in git, not in EAS build archives (the archive root is the app repo) and not in the website deployment (`public/` has no admin file; the only JWT literal in tracked site files is the public anon key).
- Existing rules: `.gitignore` and `.easignore` in the app repo list `checkoff_admin.html`. Do NOT edit those two files casually: `.gitignore` is part of the runtime fingerprint (adding two lines changed the iOS runtime 86ac0036 to fd1f87d3 and the Android runtime 53ba13b5 to e31ae7c8; reverted). `checkoff_admin_secrets.js` is covered by `~/Downloads/.gitignore`, and cannot reach the repo because it is outside it.

## Why the service key is NOT rotated yet
The key is shared by consumers that have not all been inventoried: this tool, the Vault entry `service_role_jwt` (account deletion pipeline), `store-service-role-jwt.sh`, any local scripts, and the website/Vercel environment (`SUPABASE_SERVICE_ROLE_KEY`). Rotating it before a complete inventory would break the deletion pipeline and the site. The edge function environment value of `SUPABASE_SERVICE_ROLE_KEY` is a separate value that matches no project API key (see EDGE_FUNCTION_CALLERS.md).

## Recommended path (separate task, not started)
1. Inventory every consumer of the legacy service key (Vault, Vercel env, local scripts, `.env` files, the admin tool, CI).
2. Replace the tool's direct service key use with an admin only RPC or an Edge Function gated by `ADMIN_SECRET` (or a real admin session), so the browser no longer holds a key that bypasses RLS.
3. Then rotate the legacy key and update every consumer in one coordinated step, verifying the deletion pipeline afterwards.
