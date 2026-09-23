# Trip Mode — server-enforcement regression test plan

**Status (v2, 2026-09-23): design/spec only, still NOT executed against any database.** A prior round of this task explicitly required "Run the migration and enforcement tests against a disposable local Supabase database or isolated rollback-safe test database, never production." I checked this environment for that capability and it is genuinely unavailable here: no `docker` binary, no local `psql`/`postgres`/`pg_ctl`/`initdb` binary of any kind (all checked directly, all absent). `supabase start` requires Docker and cannot run without it. I did not attempt a workaround against the linked/production database (e.g. a manually-rolled-back transaction) because the migration includes `ALTER TABLE`/`CREATE OR REPLACE FUNCTION` DDL against `check_ins`, a live, actively-written production table — even wrapped in an explicit transaction that is never committed, DDL of this kind can require a brief `ACCESS EXCLUSIVE`-class lock that would contend with real concurrent traffic, which is a genuine production-affecting action, not merely a "logic test." This reads as squarely inside "never production," so I did not do it without explicit sign-off. **This is a real, unresolved gap in this release's own required deliverables** — flagged prominently in the final report, not glossed over. Options for closing it are listed at the end of this file.

The 19 tests in `lib/tripMode.test.js`, 15 in `lib/tripModeCheckOffFlow.test.js`, and 6 in `lib/tripModeAttachment.test.js` (40 total) cover every piece of PURE client-side logic this feature has, including the exact real structural shape of the target list (personal/non-official, confirmed live). Everything below requires an actual Postgres instance because it exercises RLS + the `prevent_expired_list_checkins()` trigger, which cannot be meaningfully unit-tested in plain JS.

## Prerequisites to run this plan for real
1. Apply `20260923_trip_mode_retroactive_completion_NOT_APPLIED.sql` to a **local** Supabase instance only (`supabase db reset` after moving/copying it into `supabase/migrations/` with a real timestamp prefix — do not do this against `--linked`/production).
2. Seed two test users (`user_a`, `user_b`), two lists (`list_enabled` with `trip_mode_enabled=true` and realistic `starts_at`/`ends_at`, `list_other` with `trip_mode_enabled=false`), list items on each, and `list_members` rows making `user_a` a member of `list_enabled` only.
3. Run each query below as the relevant role via `SET request.jwt.claims` / `SET ROLE authenticated` with `auth.uid()` set appropriately (standard Supabase local RLS-testing pattern), or via pgTAP if this project adopts it later.

## Required tests, mapped to the exact SQL that proves each one

### 1. Enabled-list member succeeds remotely
```sql
-- as user_a, member of list_enabled
INSERT INTO check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at)
VALUES (auth.uid(), :list_enabled_item_id, :item_id, 'tap', 'trip_list_retroactive', current_date);
-- EXPECT: success, one row inserted, points_awarded/badges/streak triggers fire same as any check-in.
```

### 2. Nonmember rejected
```sql
-- as user_b, NOT a member of list_enabled
INSERT INTO check_ins (...) VALUES (auth.uid(), :list_enabled_item_id, ..., 'trip_list_retroactive', current_date);
-- EXPECT: RAISE EXCEPTION 'Only members of this list can use Trip Mode for it.'
```

### 3. Different list rejected (cross-list forgery)
```sql
-- as user_a (member of list_enabled only), attempt against a list_item_id belonging to list_other
INSERT INTO check_ins (...) VALUES (auth.uid(), :list_other_item_id, ..., 'trip_list_retroactive', current_date);
-- EXPECT: rejected -- either "Trip Mode is not enabled for this list" (if list_other has it off)
-- or "Only members" (if list_other has it on but user_a isn't a member) -- proves list_id is
-- resolved server-side from list_item_id's own FK chain, never trusted from the client.
```

### 4. Disabled Trip Mode rejected
```sql
-- as a member of list_other (trip_mode_enabled = false)
INSERT INTO check_ins (...) VALUES (auth.uid(), :list_other_item_id, ..., 'trip_list_retroactive', current_date);
-- EXPECT: RAISE EXCEPTION 'Trip Mode is not enabled for this list.'
```

### 5. Live completion unchanged
```sql
-- as user_a, a normal live check-in (verification_method NULL or 'live_location'), on ANY list/date
INSERT INTO check_ins (user_id, list_item_id, item_id, checkin_method, points_awarded)
VALUES (auth.uid(), :any_list_item_id, :item_id, 'tap', 3);
-- EXPECT: identical behavior to production today -- only the pre-existing starts_at/ends_at/
-- item-active/partnership-active checks apply; the new Trip Mode branch never executes because
-- verification_method != 'trip_list_retroactive'. Diff the trigger source against the live
-- production definition captured this session to confirm byte-identical fallthrough logic.
```

### 6. Date inside trip window accepted
See `lib/tripMode.test.js`'s `'date inside trip window accepted...'` for the client-side mirror; server-side, same INSERT as test 1 with `experienced_at` set to a mid-trip date.

### 7. Date outside allowed window rejected
```sql
INSERT INTO check_ins (..., experienced_at) VALUES (..., :date_before_trip_starts);
-- EXPECT: RAISE EXCEPTION 'That date is before this trip started.'
```

### 8. Grace period accepted through day seven
```sql
-- "now" (wall clock at INSERT time) set to exactly ends_at + 7 days, experienced_at = ends_at
INSERT INTO check_ins (..., experienced_at) VALUES (..., :list_ends_at);
-- EXPECT: success.
```

### 9. Expired attempt rejected
```sql
-- "now" set to ends_at + 8 days (one day past grace)
INSERT INTO check_ins (..., experienced_at) VALUES (..., :list_ends_at);
-- EXPECT: RAISE EXCEPTION 'The Trip Mode window for this list has closed.'
```

### 10. Duplicate submission rejected
```sql
-- Same (user_id, list_item_id) as test 1, submitted again
INSERT INTO check_ins (...) VALUES (auth.uid(), :list_enabled_item_id, ...);
-- EXPECT: 23505 unique_violation on check_ins_user_id_list_item_id_key -- the SAME pre-existing
-- constraint that already protects live completions today, no new mechanism needed. Confirm the
-- app's existing 23505-absorption handling (ItemDetailScreen.jsx/PhotoCheckInScreen.jsx) treats
-- this as success-equivalent, same as it already does for live completions.
```

### 11. Points awarded once
```sql
SELECT count(*), sum(points_awarded) FROM check_ins WHERE user_id = :user_a AND list_item_id = :list_enabled_item_id;
-- EXPECT: count = 1 (enforced by the same unique constraint as test 10) -- users.lifetime_points
-- (via the sync_lifetime_points trigger) reflects exactly one award, not zero, not two.
SELECT lifetime_points FROM users WHERE id = :user_a;
```

### 12. Memory remains private
```sql
-- as user_b (not user_a), attempt to read user_a's Trip Mode check-in row directly
SELECT * FROM check_ins WHERE id = :trip_mode_checkin_id;
-- EXPECT: RLS "check_ins: read own" / "check_ins: read if list member" apply UNCHANGED --
-- user_b can see it ONLY if user_b is also a member of list_enabled (existing list-member-read
-- policy), never based on verification_method. No new SELECT policy was added by this migration
-- -- confirm the diff of pg_policies before/after shows zero changes to check_ins SELECT rules.
```

### 13. Catalog item works
Covered by test 1 (the standard case: a real `items` row reachable via `list_items`).

### 14. Private list item works
```sql
-- list_enabled has is_public = false (matches the real target list, confirmed this session)
-- as user_a, a member (membership is independent of is_public)
-- EXPECT: identical success to test 1 -- is_list_member() checks list_members only, never lists.is_public.
```

### 15. Existing completion is recognized
```sql
-- After test 1's successful insert, check the app-level "already done" state
SELECT id FROM check_ins WHERE user_id = :user_a AND list_item_id = :list_enabled_item_id;
-- EXPECT: one row found -- this is what ItemDetailScreen.jsx's existing `checked` state derivation
-- already keys off (unchanged by this feature); Trip Mode does not need new "is this done" logic.
```

### 16. User cannot forge another user/list/item
```sql
-- (a) forge user_id: as user_a, attempt user_id = user_b's id
INSERT INTO check_ins (user_id, ...) VALUES (:user_b_id, ...);
-- EXPECT: RLS "check_ins: owner insert" WITH CHECK (auth.uid() = user_id) rejects before the
-- trigger even runs -- proves this is enforced at the RLS layer, not merely the trigger.

-- (b) forge list identity: covered by test 3 (list_id is always server-resolved from
-- list_item_id, there is no client-suppliable list_id column on check_ins at all).

-- (c) forge item identity: as user_a, list_item_id = a real item of list_enabled, but
-- item_id set to a DIFFERENT, unrelated item's id
INSERT INTO check_ins (user_id, list_item_id, item_id, ...) VALUES (auth.uid(), :list_enabled_item_id, :unrelated_item_id, ...);
-- EXPECT: RAISE EXCEPTION 'item_id does not match this list item.'
```

### 17. Timezone behavior is deterministic
Fully covered client-side by `lib/tripMode.test.js` (9 dedicated timezone/date-boundary tests, including a near-midnight Europe/Berlin case). Server-side, the trigger uses the exact same `resolve_metro_timezone(list_metro_id)` + `(now() AT TIME ZONE list_tz)::date` pattern the pre-existing `prevent_expired_list_checkins()` logic already used for `starts_at`/`ends_at` checks (confirmed live, unchanged) — no new timezone mechanism was introduced, so this inherits the same determinism guarantee the original function already had in production. `experienced_at` itself never crosses a timezone boundary at all (it's a plain `date`, compared date-to-date against `lists.starts_at`/`ends_at`, also plain `date` columns) — see `docs/trip-mode/20260923_trip_mode_retroactive_completion_NOT_APPLIED.sql`'s section 2 comment for the full "why this can never shift a day while traveling" reasoning.

### 18. Target-list member/catalog item succeeds (v2, real structural shape — NOT an official-list fixture)
```sql
-- Using the ACTUAL target list, confirmed live this session: id
-- 692cb6bc-cbeb-4740-af6f-5f1833673a0f, is_official = FALSE (a genuine
-- personal/user-created list), with a real catalog list_items row, e.g.
-- list_items.id = '7ac62514-3d0a-4285-b4f5-11b26ea06202' (-> items.id
-- '2cfddc3d-7eaf-4d7c-b786-dc6cada76bbc'). As a real member of this list:
INSERT INTO check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at)
VALUES (auth.uid(), '7ac62514-3d0a-4285-b4f5-11b26ea06202', '2cfddc3d-7eaf-4d7c-b786-dc6cada76bbc', 'tap', 'trip_list_retroactive', current_date);
-- EXPECT: success. This is the specific case that was BROKEN before the
-- v2 client fix (lib/tripModeAttachment.js) -- the trigger itself never
-- depended on is_official at all, so this was always going to succeed at
-- the DB layer; the bug was 100% client-side (the sheet never even
-- attempted the insert because lib/checkOffAttachment.js's shared
-- resolver nulled listItemId for this exact list shape before reaching
-- Supabase).
```

### 19. Forged points rejected/overwritten
```sql
-- As a real member of list_enabled, attempt to insert with an absurd
-- client-supplied points_awarded
INSERT INTO check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at, points_awarded)
VALUES (auth.uid(), :list_enabled_item_id, :item_id, 'tap', 'trip_list_retroactive', current_date, 999999);
SELECT points_awarded FROM check_ins WHERE user_id = auth.uid() AND list_item_id = :list_enabled_item_id;
-- EXPECT: points_awarded is NOT 999999 -- it is round(items.difficulty * list_items.point_multiplier),
-- overwritten unconditionally by the trigger's points-derivation block,
-- regardless of what the client sent. Also test NULL and 0 as the
-- client-supplied value -- both must resolve to the same correct
-- server-derived number, never NULL/0/the forged value.

-- SCOPE CORRECTION (v3): historical_visit_confirmed is explicitly
-- excluded from this fix per an explicit instruction ("Do not change
-- historical_visit_confirmed") -- its points_awarded remains fully
-- client-trusted, exactly like every other pre-existing verification_method.
-- See test 22 below for the equivalent proof, and
-- run_pg_temp_only_tests.sql's test 20 for the executed version of this
-- exact assertion (verified: inserting with points_awarded=999999 under
-- 'historical_visit_confirmed' persists 999999 unchanged).
```

### 20. Points awarded exactly once (through the existing constraint, not a new one)
```sql
-- After test 18's successful insert, users.lifetime_points via the
-- pre-existing sync_lifetime_points trigger must reflect exactly one
-- award (round(difficulty * point_multiplier)), not zero, not a
-- double-count from a retried/duplicate submission (see test 10).
SELECT lifetime_points FROM users WHERE id = auth.uid();
```

### 21. UPDATE cannot be used to bypass Trip Mode validation
```sql
-- (a) After a valid Trip Mode row exists (test 18), attempt to UPDATE
-- ONLY experienced_at to a date outside the window -- this specifically
-- targets the v1 bug where an UPDATE touching only experienced_at (not
-- in the "benign update" field list) skipped validation entirely.
UPDATE check_ins SET experienced_at = '2020-01-01' WHERE id = :the_row_id AND user_id = auth.uid();
-- EXPECT: RAISE EXCEPTION (date outside window) -- the v2 trigger fix adds
-- experienced_at to the "must be unchanged to skip validation" list, so
-- this UPDATE now falls through to full re-validation instead of a silent no-op success.

-- (b) Attempt to UPDATE ONLY points_awarded to a forged value on an
-- existing valid row.
UPDATE check_ins SET points_awarded = 999999 WHERE id = :the_row_id AND user_id = auth.uid();
-- EXPECT: the points-derivation block re-fires (points_awarded is in the
-- original "must be unchanged" list, so a real change to it never
-- early-returns) and overwrites it back to the correct server-derived value.

-- (c) Attempt to UPDATE verification_method itself (e.g. from
-- 'trip_list_retroactive' to NULL, trying to "launder" a row past
-- Trip Mode's own checks after the fact).
UPDATE check_ins SET verification_method = NULL WHERE id = :the_row_id AND user_id = auth.uid();
-- EXPECT: falls through to full re-validation (verification_method is
-- now in the "must be unchanged" list too) -- the ORIGINAL function body
-- (list_item_id resolution, ends_at check, etc.) applies to the row as
-- rewritten, and points derivation is skipped for this UPDATE since the
-- NEW verification_method no longer matches either of the two values
-- that block fires for -- points_awarded is simply left as whatever it
-- already was (untouched), which is the already-correct, already-derived
-- value from the original insert.
```

### 22. Unrelated verification methods retain existing behavior
```sql
-- verification_method = 'qr_scan'/'photo'/'admin'/'legacy'/'historical_visit_confirmed'
-- (or any value other than 'trip_list_retroactive') -- EXPECT:
-- points_awarded is exactly whatever the client sent, completely
-- untouched by the new points-derivation block (which per the v3 scope
-- correction fires ONLY for verification_method = 'trip_list_retroactive'),
-- and every other pre-existing check (starts_at/ends_at/item-active/
-- partnership-active) applies exactly as it did before this migration.
```

### 23. Private item is explicitly unsupported (not silently broken)
```sql
-- user_suggestion_list_items has NO relationship to check_ins at all --
-- confirmed via its FK list (user_suggestion_list_items_list_id_fkey,
-- _suggestion_id_fkey, _user_id_fkey -- none reference check_ins/items).
-- There is nothing to test at the check_ins/trigger layer for private
-- items, because Trip Mode never attempts to write one for them -- the
-- client-side exclusion (Trip Mode only ever reachable from
-- ItemDetailScreen, which private items never route through) is the
-- actual mechanism, verifiable by code inspection, not a SQL test. This
-- entry documents that the omission is deliberate and complete, not an
-- untested gap.
```

## What this plan deliberately does not attempt
- Load/concurrency testing of the trigger.
- Testing `matched_candidate_visit_id` population (client-side, best-effort, tester-only — not a server authorization concern, see the UI implementation notes instead).
- Testing the notification MVP (deferred entirely per explicit instruction — not implemented in this pass).

## Closing the "not executed" gap — options, not yet chosen
1. **You run it locally.** If Docker is available on your own machine, `supabase start` + `supabase db reset` (after copying the draft migration into `supabase/migrations/` with a real timestamp) replays the full schema locally, then this plan's 23 scenarios can be run for real. I can produce a single runnable `.sql` test script (turning every scenario above into an actual `DO $$ ... $$` block with `RAISE EXCEPTION`-on-failure assertions) if that would help — not yet written, since it depends on which path you pick.
2. **Explicit, scoped authorization to test against the linked database inside a transaction that is always rolled back**, with the understood risk (brief lock contention on `check_ins` during the DDL portion). I would not do this without you explicitly choosing it, given the lock-on-a-live-table risk.
3. **Ship on the strength of the code-level tracing alone** (this plan's SQL is precise and was checked statement-by-statement against confirmed live schema/constraints/functions, and 40 client-side tests pass), accepting that the trigger's SQL correctness has been reasoned through but not executed. This is the weakest option evidentially, listed for completeness, not as a recommendation.
