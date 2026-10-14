# Security hardening — deployed 2026-10-08

## What was found (both proven with rolled-back production tests)
1. **Self-admin**: any signed-in user could `UPDATE users SET is_admin = true` on their own row (table-level UPDATE grant +
   owner policy with no column limits). ~25 tables' RLS policies and `admin_recent_signups()` (returns every user's email) key on `users.is_admin`.
   Production had exactly one admin; no evidence of exploitation, but there is no audit log.
2. **Pre-published photos**: any signed-in user could INSERT an `item_cover_candidates` row already `selected` / `is_primary` / `display_eligible`.

## Deployed (in order, each verified against production before the next)
- `20261008a_lock_users_protected_columns` — clients lose INSERT/DELETE/TRUNCATE/REFERENCES/TRIGGER on `users`; UPDATE only on the allowlist
  (display_name, avatar_url, city_id, neighborhood_id, pref_show_alcohol, notif_check_ins, notif_invites, notif_nudges, share_channels,
  app_version, build_number, platform, last_app_open_at, last_version_check_at, lifetime_points, referred_by).
- `20261008b_lock_cover_candidate_insert` — column allowlist for client INSERT + status policy (pending / needs_review / automated_rejected).
- `20261008c_photo_admin_publish` — `photo_admins` (no client access), `is_photo_admin()`, `admin_publish_item_photo()`.
- Operator grant (manual, service role): one row, the owner's account. See `supabase/manual/grant_photo_admin.sql`.

## Rollback (only if shipped-app behavior breaks)
```sql
-- 08a: restore previous (vulnerable) table-level grants
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.users TO anon, authenticated;
-- 08b: restore previous insert privilege + policy
GRANT INSERT ON public.item_cover_candidates TO authenticated;
DROP POLICY item_cover_candidates_insert_own ON public.item_cover_candidates;
CREATE POLICY item_cover_candidates_insert_own ON public.item_cover_candidates FOR INSERT
  WITH CHECK (submitted_by_user_id = auth.uid() AND consent_ack = true);
```

## Backlog (deliberately NOT part of this deployment)
- **Points are client-authoritative**: the shipped app writes `users.lifetime_points` (lib/points.js, lib/referral.js) and users can insert
  their own `check_ins` rows with `points_awarded` (policy "Users manage own check-ins"). Moving points server-side needs an app release.
- `users: public read` + column SELECT grants expose `is_admin`, `lifetime_points`, `is_pro` etc. to `anon`.
- `referred_by` is client-writable (needed by lib/referral.js).
- Other tables use owner-ALL policies (`check_ins`, `saved_crew`, `push_tokens`, `user_suggestions`, ...): audit sensitive columns the same way.
- `user_suggestions` admin policy trusts `auth.jwt() ->> 'email'` instead of a role.
- Admin "Make Cover" (checkoff_admin.html) is five non-atomic writes; the photo-admin path is atomic, the Admin tool is not.
- Public `getcheckoff.com/submit` optional photo upload no longer works for anonymous visitors (storage insert restricted 2026-10-07).
- `checkoff_admin.html` embeds the service-role key in plain text.
- Site business-confirmation flow and old Admin intake still refuse secret items (`isItemSecret`).
