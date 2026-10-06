# Willcox business self-service + Champion review

Site repo `getcheckoff-site`. Routes: `/willcox/partners` (public), `/willcox/champion` (authenticated). `/featured`, `/partner-welcome`, `/willcox`, `/willcox/willcox-pitch.html` are untouched.

- Config: `lib/destinationConfig.js` (add an entry + 4 rewrites in `vercel.json` for another Hub).
- Willcox inventory: `destination_lists` (active) -> `list_items`, UNION items in neighborhood `e35e8947-...`. Public lookup keeps active + approved items whose body (or, for secret items, `secret_reveal_text`) names a place in quotes. Secret items are searchable by name only: the page shows a hidden-experience message and the API never returns their body, address or website. Ids are replaced by opaque HMAC refs.
- Data: migration `supabase/migrations/20261005_destination_item_feedback.sql` (APPLIED to production 2026-10-05, verified column/constraint/index match): `destination_item_submissions`, `destination_champions`, `destination_item_decisions`, extra `landing_events` event types + `item_id`. RLS on, no policies (service role only).
- Auth: Supabase magic link; `/api/destination-champion` verifies the token, then requires `users.is_admin` or a row in `destination_champions`.
- Handout QR: `/willcox/partners?utm_source=business_owner_handout&utm_medium=qr&utm_campaign=willcox_launch_2026`.
- Add Champions (emails must be lowercase):
  `insert into destination_champions (destination_id, email, display_name) values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639', lower('name@example.com'), 'Name');`
- Pause a Champion: `update destination_champions set is_active = false where email = 'name@example.com';`
- Remove: `delete from destination_champions where email = 'name@example.com';`
- Sign-in needs `https://getcheckoff.com/willcox/champion` in Supabase Auth, URL Configuration, Redirect URLs (it was missing on 2026-10-05).
- Gated sign-in (account created only for listed Champions): site branch `feat/champion-login-gated`, not yet deployed.

## Launch pass (2026-10-05)
See `docs/willcox-launch/` (readiness report, reconciliation, DRAFT inventory SQL that has NOT been run), `docs/willcox-launch-analytics.sql`, `docs/willcox-chamber-launch-report.sql`, `docs/willcox-wine-festival-launch-checklist.md`.
- Phase 2: panel in checkoff_admin.html for the queue, apply-change tooling, outreach status, Champion metrics by channel.
