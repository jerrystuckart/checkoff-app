# Applied migrations: Willcox Champion workflow

These ten migrations are **already applied to production**. They were applied as SQL (`supabase db query --linked -f`, or the SQL editor),
not with `supabase db push`, so Supabase's own `schema_migrations` table has no record of them (it records 1 row for the whole project).
This file and git are the record. **Do not re-run them, rename them, or `migration repair` them without a decision.**

Apply order matters and must be preserved. All statements are idempotent, but 20261011c is superseded by 20261012b and the
promotion function in 20261012 is superseded by the one in 20261013.

| # | File | Purpose | Applied |
|---|------|---------|---------|
| 1 | 20261005_destination_item_feedback.sql | partner/Chamber submissions, decisions, champions | 2026-10-05 (earlier session, time not recorded) |
| 2 | 20261006_destination_item_verification_owner.sql | verification ownership model | 2026-10-06 (earlier session) |
| 3 | 20261006b_destination_item_candidates.sql | proposed-experience candidate layer | 2026-10-06 (earlier session) |
| 4 | 20261007_candidate_review_ux.sql | Chamber review fields | 2026-10-07 (earlier session) |
| 5 | 20261011_champion_membership_rule.sql | decision_source, membership_set_by/at | 2026-10-11 |
| 6 | 20261011b_destination_visibility_log.sql | audit trail for visibility changes | 2026-10-11 |
| 7 | 20261011c_neighborhood_sweep_active_items.sql | interim badge change, **superseded by #9** | 2026-10-11 |
| 8 | 20261012_destination_candidate_promotion.sql | atomic `promote_destination_candidate()`, promotion columns | 2026-10-11 |
| 9 | 20261012b_list_completion_active_items.sql | list / secret / neighborhood completion ignore inactive items a user has not checked | 2026-10-11 |
| 10 | 20261013_champion_permissions_and_suggestion_intake.sql | suggestion intake queue, candidate guard trigger, admin guard on `update_item_location` and `create_seasonal_list`, stricter promotion function | 2026-10-11 |

The numeric prefixes of #5 to #10 are ahead of the calendar on purpose (they sort after the earlier Willcox migrations); they were all applied on 2026-10-11.

## Verification (2026-10-11)
Replaying all ten files in this order inside a transaction that was rolled back left a catalog fingerprint
(columns, constraints, triggers, indexes, policies, RLS flags, function bodies and execute privileges of the Champion tables and functions)
**identical** to production's: `d7b1a482751a8c4470073ad5c0ee66ef`. So the files match what is applied. Nothing was reapplied.

## Notes
- Letter-suffixed versions (`20261006b`, `20261011b`, `20261011c`, `20261012b`) and three files sharing `20261011` cannot be distinct versions to the Supabase CLI.
  This is true of 22 migrations in this folder, which is why tracking was never adopted. A mirror of these ten files also lives in
  `getcheckoff-site/supabase/willcox-champion/` (read-only copy; this folder is canonical).
- Business-logic decisions behind these changes (Champion permissions, suggestion intake, visibility enforcement) are in the Willcox launch docs and the site README.
