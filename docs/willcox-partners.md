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

## Verification ownership (2026-10-06, DEPLOYED, site commit bd84203)
Ownership is separate from visibility. See the readiness report section 6. Migration 20261006 applied and the pilot seed run (26 items: 13 business, 11 checkoff, 1 chamber, 1 destination_partner). Champion sign-in is now the server-gated flow; Supabase redirect allow-list includes /willcox/champion. Uncertain owner: Warren Earp grave (checkoff until the Pioneer Cemetery manager is confirmed).

## Candidate review layer (2026-10-06, DEPLOYED, site commit 7329ff1)
Proposed experiences live in `destination_item_candidates` (migration `20261006b`, applied), never in `items`. `/willcox/champion` shows LIVE + PROPOSED. Research summary: `docs/willcox-launch/willcox-research-pass-summary.md`. Promotion of a candidate to a production item is a manual CheckOff-admin step and has not been done. Rows imported from `docs/willcox-launch/import-candidates.sql`.

## Champion review UX final (2026-10-07, DEPLOYED, site commit de6199d)
CheckOff's recommendation (read-only) is separate from the Chamber's actual decision (Not Reviewed until a Champion acts). Migration `20261007_candidate_review_ux.sql` applied (chamber_question, availability_type, body_provisional). 83 of 84 candidates have bodies; Willcox Art League is the intentional blank (Exclude / Not Included). Final bodies applied via `docs/willcox-launch/research/apply_final_bodies.py`; questions via `gen_questions.py`. Event-only (8), pop-up (2) and lodging-only (5) candidates are tagged. Nothing promoted to items; Chamber decisions are zero at handoff.

## Chamber Review Mode (2026-10-07, DEPLOYED, site commit cdb2a6c)
Champions see only: place, proposed CheckOff, CheckOff's recommendation, membership (set once per business), one Chamber question, the Chamber decision, and a collapsed "Questions & details". Content status, verification owner, list placement, research and technical fields are not sent to Champions at all (API strips them). Admins keep full controls and get a "View as Chamber" preview toggle. One global "Suggest a missing place or experience" action sits at the top.

## Chamber polish (2026-10-07, DEPLOYED)
73 Chamber-facing recommendation notes (53 candidate, 20 live) made membership-neutral via `docs/willcox-launch/research/neutral_notes.py` (old text in `recommendation-notes-before-neutral.json`). Chamber cards now lead with the CheckOff sentence. Internal notes, bodies, recommendations, statuses, owners and lists unchanged.

## Willcox Activation Kit (2026-10-07, DEPLOYED, site commit 8c87216)
Public page https://getcheckoff.com/willcox/kit. Assets in `public/downloads/willcox/kit/` (13 PNG, 3 SVG QR, 5 lossless print PDFs, 10 preview thumbnails). The 24x36 Wine Festival poster was replaced with the corrected 4096 x 6144 file after the original's QR failed ZXing. All 13 QR-bearing PNGs and 3 SVGs decode (Apple Vision + ZXing) to /willcox?utm_source={business|general|wine_festival}&utm_medium=qr&utm_campaign=willcox_launch_2026. Champion nav now: Willcox Activation Kit, Visitor Page, Chamber Pitch, Sign Out (Business Page admin-only; generic Featured Kit no longer linked).
