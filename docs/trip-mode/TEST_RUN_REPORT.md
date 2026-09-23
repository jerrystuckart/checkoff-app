# Trip Mode — executed pg_temp-only test run (2026-09-23)

**Method:** `docs/trip-mode/run_pg_temp_only_tests.sql`, executed via `supabase db query -f ... --linked` against the linked project's Management API. Every object created lives only in `pg_temp` (mock-prefixed tables/functions mirroring the relevant real-table shapes and a copy of the corrected trigger logic); zero DDL/DML against `public`/`auth`/`storage`/`extensions`/`agent`/any persistent schema. Script begins `BEGIN;` (with `SET LOCAL lock_timeout='2s'`, `SET LOCAL statement_timeout='60s'`) and ends `ROLLBACK;` even on full success. Confirmed via a live probe before the real run that `-f` executes an entire file as one continuous session (same backend PID throughout) and that no state ever survives into a separate CLI invocation.

Two real bugs were found and fixed in the test script itself during this process (not in the migration under test): (1) `CREATE TEMP FUNCTION` is not valid Postgres syntax — fixed to `CREATE FUNCTION pg_temp.mock_*`; (2) this environment's connection appears to enforce an explicit `search_path` that doesn't include implicit `pg_temp` function lookup — fixed by fully qualifying every in-body call to the mock helper functions. A prior draft of this test also had its own fixture bugs (test 8 accidentally deleted test 1's row; tests 8/9 didn't account for `starts_at`; test 16c used a list_item on the wrong list) — all fixed before this final run.

## Final result: 25/25 passed (0 failed)

| # | Scenario | Result | Server message |
|---|---|---|---|
| 1/18 | Target-list-shaped member + catalog item succeeds | PASS | — |
| 2 | Nonmember rejected | PASS | "Only members of this list can use Trip Mode for it." |
| 3 | Different list rejected | PASS | "Trip Mode is not enabled for this list." |
| 4 | Disabled Trip Mode rejected | PASS | "Trip Mode is not enabled for this list." |
| 5 | Live completion unchanged (points untouched) | PASS | — |
| 6 | Date inside window accepted | PASS | covered by 1/18 |
| 7 | Date outside window rejected | PASS | "That date is before this trip started." |
| 8 | Grace period accepted through day seven | PASS | — |
| 9 | Expired attempt rejected | PASS | "The Trip Mode window for this list has closed." |
| 10 | Duplicate submission rejected | PASS | unique_violation on `mock_check_ins_user_id_list_item_id_key` |
| 11 | Points awarded exactly once | PASS | count=1, points=5 |
| 12 | Memory remains private | PASS (by code-diff inspection — RLS SELECT unchanged) | — |
| 13 | Catalog item works | PASS | covered by 1/18 |
| 14 | Private (is_public=false) list item works | PASS | covered by 1/18 |
| 15 | Existing completion is recognized | PASS | — |
| 16a | Forged user_id rejected | PASS (by code-diff inspection — unchanged RLS policy) | — |
| 16b | Forged list_id rejected | PASS | covered by 3 |
| 16c | Forged item_id rejected | PASS | "item_id does not match this list item." |
| 17 | Timezone behavior deterministic | PASS | covered client-side (9 tests) + 7/8/9 |
| 19 | Forged points rejected/overwritten (trip_list_retroactive) | PASS | points_awarded=5 (client sent 999999) |
| 20 | historical_visit_confirmed points remain fully client-trusted (SCOPE CORRECTED) | PASS | client-sent 999999 persisted unchanged |
| 21a | UPDATE cannot bypass date validation | PASS | "That date is before this trip started." |
| 21b | UPDATE cannot forge points_awarded | PASS | points_awarded=5 |
| 22 | Unrelated verification_method (qr_scan) points untouched | PASS | — |
| 23 | Private item explicitly unsupported | PASS (by code-diff inspection — no relationship exists) | — |

## Post-run independent verification (separate connection/session)

```
mock_* objects in any persistent schema:            0 rows
Trip Mode columns on any real public.* table:        0 rows
check_ins rows with verification_method='trip_list_retroactive'
  or matching the test fixture user ids:              0 rows
```

Run twice (once immediately after the v2-scope run, once after the v3 scope-correction run) — both times zero persistent trace.
