# Willcox business self-service + Champion review

Site repo `getcheckoff-site`. Routes: `/willcox/partners` (public), `/willcox/champion` (authenticated). `/featured`, `/partner-welcome`, `/willcox`, `/willcox/willcox-pitch.html` are untouched.

- Config: `lib/destinationConfig.js` (add an entry + 4 rewrites in `vercel.json` for another Hub).
- Willcox inventory: `destination_lists` (active) -> `list_items`, UNION items in neighborhood `e35e8947-...`. Public lookup keeps active + approved items whose body (or, for secret items, `secret_reveal_text`) names a place in quotes. Secret items are searchable by name only: the page shows a hidden-experience message and the API never returns their body, address or website. Ids are replaced by opaque HMAC refs.
- Data: migration `supabase/migrations/20261005_destination_item_feedback.sql` (APPLIED to production 2026-10-05, verified column/constraint/index match): `destination_item_submissions`, `destination_champions`, `destination_item_decisions`, extra `landing_events` event types + `item_id`. RLS on, no policies (service role only).
- Auth: Supabase magic link; `/api/destination-champion` verifies the token, then requires `users.is_admin` or a row in `destination_champions`.
- Handout QR: `/willcox/partners?utm_source=business_owner_handout&utm_medium=qr&utm_campaign=willcox_launch_2026`.
- Add a Chamber login: `insert into destination_champions (destination_id, email) values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639', 'lowercase@email');`
- Phase 2: panel in checkoff_admin.html for the queue, apply-change tooling, outreach status, Champion metrics by channel.
