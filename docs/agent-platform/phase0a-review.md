# CheckOff Agent Platform — Phase 0A Review Package

Operational data layer for the future Chief of Staff / Agent Platform.
Schema only. No Chief agent, no LLM/SDK integration, no Open Brain
integration, no schedulers, no production execution. Not applied to the
linked project — Jerry reviews and runs it manually.

## 1. Repository inspection summary

Inspected `supabase/migrations/*.sql` (40+ files), `supabase/config.toml`,
`supabase/functions/*/index.ts`, and app code referencing Supabase.

- **Migrations**: `supabase/migrations/YYYYMMDD_description.sql`, wrapped in
  `BEGIN; … COMMIT;`, idempotent via `IF NOT EXISTS` / `IF EXISTS` /
  `ON CONFLICT DO NOTHING`, narrative header comments explaining *why* (not
  just what), and larger migrations end with a `DO $$ … RAISE EXCEPTION`
  postflight guard (e.g. `20260828_visit_detection_phase1.sql`). Multiple
  files can share a date. A separate `docs/<feature>/review_only_*.sql`
  convention exists for SQL that must be reviewed but is explicitly *not* a
  migration (`docs/visit-detection/review_only_visit_profile_mapping_suggestion.sql`).
- **UUIDs**: `gen_random_uuid()` is the standard everywhere (10+ tables) — no
  `uuid_generate_v4()`. Confirmed appropriate to reuse.
- **`updated_at`**: no reusable trigger function exists anywhere in the repo.
  Every `updated_at` column is `timestamptz NOT NULL DEFAULT now()` and is
  set manually by application/RPC code on update — there is no trigger-based
  convention to reuse or conflict with.
- **Status/type conventions**: `text` columns with `CHECK (col IN (...))`
  everywhere; zero `CREATE TYPE ... AS ENUM` in the whole migration history.
  Confirmed as the established convention.
- **Non-public schemas**: none exist. `agent` would be the first schema
  beyond `public`/`graphql_public` in this project.
- **Supabase/PostgREST schema exposure**: `supabase/config.toml` has no
  `[api]` schemas override — it only overrides `functions.stripe-webhook`.
  Exposed-schema configuration for this project lives in the hosted
  Supabase dashboard (Studio → API Settings), not in this repo. Nothing in
  the repo currently requests exposure of any schema beyond the Supabase
  default (`public`, `graphql_public`), so `agent` is not exposed today and
  creating it does not expose it.
- **Server-side auth pattern**: the *only* privileged-access pattern found is
  the Supabase `service_role` key — used directly in Edge Functions
  (`Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`) and by the local admin tool
  (`checkoff_admin.html`). `service_role` bypasses RLS entirely and has
  standing broad access to `public.*`. There is **no dedicated least-
  privilege Postgres role anywhere in this repo** — zero `CREATE ROLE`
  statements in migration history.
- **RLS/grant conventions**: new tables get `ALTER TABLE ... ENABLE ROW
  LEVEL SECURITY` plus explicit per-operation policies (`*_select_own`,
  `*_admin_write` checking `users.is_admin`). Admin/internal-only tables
  (`city_partnerships`, `destination_partners`) use RLS-enabled **with zero
  policies**, so only `service_role` (which bypasses RLS) can reach them —
  this is the repo's established "service-role-only" table pattern.
  Column-level `REVOKE`/`GRANT` is used where a table is otherwise readable
  but a specific column must stay locked down (`public.users` + the
  `20260829` grant-fix migration).
- **Least-privilege role precedent**: none.
- **Migration guard patterns**: `IF NOT EXISTS`/`IF EXISTS` idempotency
  throughout; postflight `DO $$ RAISE EXCEPTION` blocks in larger/riskier
  migrations validate row counts or object existence before `COMMIT`.
- **Repo-specific rules worth matching**: the most recent migrations
  (Denver, visit detection) favor multiple small, named `CHECK` constraints
  over one large `CASE` expression, and use column `COMMENT`s to document a
  deliberate current limitation (e.g. "no dependency graph modeled here")
  rather than leaving it undocumented. Both patterns are followed in the
  Phase 0A migration.

## 2. Architecture compatibility findings

The locked Phase 0A design is compatible with the real repo. Two
implementation-level (not architectural) calls were made where the spec
left the value open or asked for repo-informed judgment:

- **`event_type` on `agent.task_events`**: this repo's normal convention for
  a status/type-like column is `text` + `CHECK` (see
  `geofence_debug_events.event_type`, which needed a dedicated follow-up
  migration — `20260830_geofence_debug_events_exit_verification.sql` —
  just to add one new value). The Phase 0A spec explicitly overrides that
  general convention for this one column, requiring it to accept new event
  types without a schema migration. Implemented as plain `NOT NULL text`,
  no `CHECK`, with a comment explaining the deliberate deviation.
- **Enumerated values**: `projects.status`, `runs.status`, and
  `interactions.direction` are now locked per Jerry's explicit instruction:
  - `projects.status`: `PLANNED`, `ACTIVE`, `ON_HOLD`, `COMPLETED`, `CANCELED`
    (default `PLANNED` — a project starts planned, then becomes active)
  - `runs.status`: `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELED`
  - `interactions.direction`: nullable, `INBOUND` / `OUTBOUND` only
  - `project_type`, `priority` (projects/tasks), `contact_type`,
    `relationship_status`, `channel`, `source_type` remain unconstrained
    `text` — no value set was specified for these, and inventing one risks
    blocking Phase 0B's real data from fitting.
- Task status invariants (WAITING/BLOCKED/NEEDS_JERRY/IN_PROGRESS/DONE) are
  fully expressible as same-row `CHECK` constraints and are enforced at the
  DB layer, per the spec's preference. The one invariant that genuinely
  cannot be a `CHECK` — CANCELED requiring a matching `task_events` note —
  is cross-table and is correctly left to the future `transition_task()`
  service primitive, exactly as the spec anticipated.
- **`requires_jerry` is a true biconditional with `status`**, per Jerry's
  correction: `requires_jerry = (status = 'NEEDS_JERRY')`, not just a
  one-way implication. The earlier version only enforced `NEEDS_JERRY ⇒
  requires_jerry`, which left `status='READY' AND requires_jerry=true` legal
  — two contradictory answers to "does this need Jerry?" No counter-case was
  found for a task needing `requires_jerry=true` outside `NEEDS_JERRY`.
- **`task_events.from_status`/`to_status` are now constrained** to the same
  8-value task status vocabulary (nullable, but no typo'd values) — these
  two columns describe the fixed `agent.tasks` state machine, unlike
  `event_type`, which stays deliberately open per the point above.

No other deviations. All eight tables, all listed columns, all listed
indexes/uniques, and the "no product-schema coupling" / "no seed data"
requirements are implemented as specified.

## 3. Security / access recommendation

**Problem**: this repo's only existing backend-privileged pattern is the
`service_role` key, which bypasses RLS and grants standing broad access to
`public.*`. Reusing it for the future TS Chief service would violate Phase
0A's explicit requirement that the agent backend not gain unrestricted
authority over `public.*`.

### 3.1 The RLS contradiction — found and corrected

An earlier version of this package enabled RLS on every `agent.*` table with
**zero policies**, copying this repo's `city_partnerships` /
`destination_partners` pattern. Jerry caught the flaw: that pattern only
works because those tables are reachable exclusively by `service_role`,
which **bypasses RLS entirely** — so an empty policy set correctly means
"only `service_role` gets in." `agent_service` is an ordinary role with no
`BYPASSRLS`. `GRANT` and RLS are independent gates in Postgres: with RLS
enabled and no applicable policy, an ordinary granted role still sees and
writes **zero rows**. The original design would have made `agent_service`
unable to do anything despite its grants — a bug that invites exactly the
wrong fix later (reaching for `BYPASSRLS`).

**Corrected model**:

- RLS stays enabled on all eight tables.
- `agent_service` is created with `NOLOGIN NOBYPASSRLS` and is never granted
  `BYPASSRLS`.
- `agent_service` does **not** own these tables. Table ownership belongs to
  whichever role runs the migration (`postgres` or Jerry's admin role via
  `supabase db query --linked`) — RLS is not enforced against a table's
  owner by default (only `BYPASSRLS` or `FORCE ROW LEVEL SECURITY` change
  that), so this had to be confirmed rather than assumed. The migration's
  postflight guard and the validation script both assert
  `pg_tables.tableowner <> 'agent_service'` for every `agent.*` table.
  `FORCE ROW LEVEL SECURITY` is *not* added — it would be needed if
  `agent_service` were ever the owner, which it deliberately isn't.
- `agent_service` gets an explicit `CREATE POLICY ... TO agent_service
  USING (true) [WITH CHECK (true)]` for every action its grants allow, per
  table (see §3.2) — plain role gates, not row-level predicates. There's no
  JWT/session context on a direct Postgres connection to write a row-owner
  check against, so "row-level security" here means "let this one role in,
  per allowed action, per table," not multi-tenant isolation. No policy
  targets `anon`, `authenticated`, or `public`.
- Both layers (GRANT and RLS policy) enforce the same least-privilege set,
  so removing either one independently still leaves the other blocking
  unintended access.

### 3.2 Least-privilege grant/policy model (per table, not identical everywhere)

Rather than the same `SELECT/INSERT/UPDATE` on all eight tables, tables are
split by what they represent:

| Table | Privileges | Why |
| --- | --- | --- |
| `owners` | `SELECT` only | Registry not yet bootstrapped — Phase 0B's real owner rows are created by an admin role, not the service. INSERT/UPDATE can be added later, narrowly, once there's a concrete need (e.g. registering a new specialist agent). |
| `projects`, `contacts`, `tasks`, `runs` | `SELECT, INSERT, UPDATE` | Current-state tables the service both creates and updates as work progresses (a run moves `RUNNING` → `SUCCEEDED`, a task's status/owner changes in place, etc). |
| `task_events`, `decisions` | `SELECT, INSERT` only | Append-only historical fact tables — a fact is recorded once and never rewritten; a correction is a new row (`decisions.supersedes_decision_id`), not an edit. `task_events` being append-only was explicit in the spec; `decisions` (a decision record) is the same shape of data and gets the same treatment, per "historical data should be more restrictive where appropriate." |
| `interactions` | `SELECT, INSERT` (whole table) + `UPDATE` on **only** `summary, outcome, requires_action, metadata` | **Corrected — not append-only.** A message can be ingested (`INSERT`) before it's classified, and the partial unique index on `(channel, source_ref)` forecloses "insert a corrected copy" the way it works for `task_events`/`decisions` — so enrichment has to land on the same row. The `UPDATE` is scoped with a genuine column-level `GRANT UPDATE (summary, outcome, requires_action, metadata) ON agent.interactions`, not just a comment: `occurred_at`, `channel`, `source_ref`, and the `contact_id`/`project_id`/`task_id` links stay immutable after insert. RLS can't enforce a column boundary (documented elsewhere in this repo — `candidate_visits_update_own` in `20260828_visit_detection_phase1.sql` notes the same limitation), so the column-level `GRANT` is the actual enforcement; the RLS `UPDATE` policy is still required as the row/role gate. |

No `DELETE` grant or policy exists anywhere in the schema, for any table.

### 3.3 Is the direct-Postgres-connection approach actually viable here?

This still needs verification against the specific project's plan/pooler
configuration — it can't be confirmed by inspecting the repo, and nothing
was connected to remotely to test it. What can be said with confidence about
how Supabase's connection paths work in general:

- **Direct connection** (`db.<project-ref>.supabase.co:5432`): full Postgres
  wire protocol, works with any role that has `LOGIN` + a password,
  including a custom one like `agent_service` — this is ordinary Postgres,
  not something Supabase restricts to `anon`/`authenticated`/`service_role`.
  The caveat: Supabase's direct connection is **IPv6 by default**; reaching
  it from an IPv4-only environment (many serverless/edge runtimes, some CI)
  requires either that platform having IPv6 egress or purchasing Supabase's
  IPv4 add-on for the project. Whether the future TS service's host supports
  this needs to be checked against wherever it actually runs.
- **Supavisor pooler, session mode** (`*.pooler.supabase.com:5432`):
  IPv4-reachable, behaves like a direct per-session connection (prepared
  statements, session GUCs, etc. work normally). This is the most likely
  right choice for a long-running Node service that isn't IPv6-capable.
- **Supavisor pooler, transaction mode** (`*.pooler.supabase.com:6543`):
  IPv4-reachable, optimized for many short-lived/serverless connections, but
  does **not** reliably support session-level features (prepared statements,
  `SET ROLE`, session GUCs) across pooled connections — a poor fit if the
  future service uses an ORM/driver that relies on those.
- Custom roles are a standard, supported Supabase feature (`CREATE ROLE` via
  SQL or the dashboard's Database → Roles UI) and are not limited to
  `anon`/`authenticated`/`service_role` — Supavisor authenticates against
  real Postgres role credentials, not a fixed role allowlist. That said,
  pooler/role interaction has had version-specific quirks across Postgres
  proxy implementations historically, so this migration does not assume it
  will "just work" on Jerry's specific project/plan without a manual check.

**Recommended verification step** (manual, after this migration is reviewed
and applied — not part of it): `ALTER ROLE agent_service LOGIN PASSWORD
'<temporary>';`, then attempt a connection with `psql` (or the `pg` /
`postgres.js` driver the TS service will actually use) against the session-
mode pooler host, confirm `SELECT`/`INSERT` against a scratch row in
`agent.projects` behaves as expected, then rotate the password before
handing it to the real service. This is a Jerry decision/action — see §8.

This keeps `agent.*` reachable only by a role that has *no* standing access
to `public.*`, keeps the existing `service_role`/admin-tool/Edge Function
access pattern to `public.*` completely untouched, and does **not** expose
`agent` through PostgREST at any point.

### 3.4 Schema hardening and effective isolation from `public.*`

Two follow-up concerns Jerry raised, both about the gap between "no direct
grant" and "no actual access":

**Explicit `PUBLIC` revokes (defense-in-depth, not a fix for observed
behavior).** Verified against Postgres's actual defaults rather than
assumed: a newly created schema other than the one literally named
`public`, and a newly created table, do **not** grant anything to `PUBLIC`
on creation — so `REVOKE ALL ON SCHEMA agent FROM PUBLIC` and
`REVOKE ALL ON ALL TABLES IN SCHEMA agent FROM PUBLIC` are no-ops against
current state. They're in the migration anyway, right after `CREATE SCHEMA`
and once all 8 tables exist, so the "PUBLIC gets nothing here" posture is
explicit and self-reasserting rather than relying on an absence that was
never enforced. Functions are different: Postgres **does** grant `EXECUTE`
on a new function to `PUBLIC` by default, so `agent.set_updated_at()` picks
that up on creation. Verified against Postgres's trigger semantics (not
assumed): a trigger function is invoked internally by the executor as a
side effect of table DML — the invoking role's `EXECUTE` privilege on the
trigger function itself is never checked, only the ordinary DML privilege
on the table. So `REVOKE ALL ON FUNCTION agent.set_updated_at() FROM PUBLIC`
is safe and does not affect trigger firing; it only closes the unrelated
ability to `CALL agent.set_updated_at()` directly.

**Effective isolation from `public.*` (not just absence of a direct
grant).** `GRANT`/`REVOKE` rows in `information_schema.role_table_grants`
don't capture privilege a role holds via the `PUBLIC` pseudo-role or via
membership in another role — both are real paths to privilege in Postgres
that a raw grant-row check misses. The validation script now checks the
*effective* privilege directly:
- `has_schema_privilege('agent_service', 'agent', 'USAGE'/'CREATE')` —
  exactly `USAGE`, not `CREATE`.
- `agent_service` is not a member of any other role (`pg_auth_members`) —
  the actual mechanism by which it could inherit privilege beyond `agent.*`.
- `agent_service` has none of `rolsuper`/`rolcreatedb`/`rolcreaterole`.
- `has_table_privilege('agent_service', ..., 'SELECT'/'INSERT'/'UPDATE'/'DELETE')`
  is false for **every** table currently in `public` (not a sample) —
  this is the actual "effective authority" check, not "no explicit grant."
- Any baseline privilege `PUBLIC` itself holds on `public.*` is **reported**
  (`RAISE NOTICE`), never revoked — per Jerry's instruction not to make a
  destructive blanket change to existing production grants without explicit
  approval. What can and can't be validated about `service_role` is stated
  explicitly rather than glossed over: its own `BYPASSRLS` attribute and
  whatever default-privilege behavior Supabase's project bootstrap may have
  given it on `public.*` is Supabase platform configuration, invisible to
  and untouched by this migration — what *is* verified is that
  `service_role` has no grant, schema `USAGE`, or role-membership path into
  `agent.*` specifically.

## 4. Migration file

[`supabase/migrations/20260830_agent_operational_schema_phase0a.sql`](../../supabase/migrations/20260830_agent_operational_schema_phase0a.sql)
— NOT applied. Run manually via:

```bash
supabase db query -f supabase/migrations/20260830_agent_operational_schema_phase0a.sql --linked
```

## 5. Validation / postflight file

[`docs/agent-platform/review_only_phase0a_validation.sql`](review_only_phase0a_validation.sql)
— read-only, run after applying the migration. Not itself a migration (kept
out of `supabase/migrations/` deliberately, matching the existing
`review_only_*.sql` precedent in `docs/visit-detection/`).

## 6. File change summary

### Round 2 (this correction — interactions, task invariants, validation rigor, `public.*` isolation)

Same three files, edited in place again:

| File | Change |
| --- | --- |
| `supabase/migrations/20260830_agent_operational_schema_phase0a.sql` | **(1)** `REVOKE ALL ON SCHEMA agent FROM PUBLIC` added right after `CREATE SCHEMA`; `REVOKE ALL ON FUNCTION agent.set_updated_at() FROM PUBLIC` added right after that function is created; `REVOKE ALL ON ALL TABLES IN SCHEMA agent FROM PUBLIC` added once all 8 tables exist — all three are defense-in-depth no-ops against current Postgres defaults, explained inline (item 8). **(2)** `agent.tasks` gained `CONSTRAINT tasks_requires_jerry_matches_status CHECK (requires_jerry = (status = 'NEEDS_JERRY'))`; `tasks_needs_jerry_requires_request` simplified since the `requires_jerry AND` clause is now redundant with the new constraint (item 3). **(3)** `agent.task_events.from_status`/`to_status` gained `CHECK (... IS NULL OR ... IN (<8 status values>))` (item 2). **(4)** `agent.interactions`' grant/policy section rewritten: table-level `GRANT SELECT, INSERT` (unchanged) plus a new `GRANT UPDATE (summary, outcome, requires_action, metadata) ON agent.interactions TO agent_service`, and a new `agent_service_update` RLS policy (`FOR UPDATE ... USING (true) WITH CHECK (true)`) — interactions is no longer grouped with the append-only tables (item 1). **(5)** The per-table grant comment block rewritten to explain interactions' ingest-then-enrich model separately from the append-only group. **(6)** The migration's own postflight no-seed check extended from 5 tables (`owners, projects, tasks, contacts, decisions`) to all 8 (item 6). |
| `docs/agent-platform/review_only_phase0a_validation.sql` | **(1)** Check 8a's table groupings updated: `interactions` moved into the SELECT+INSERT+UPDATE group (policy-level check only — RLS can't see columns); the append-only group is now just `task_events`, `decisions`. **(2)** Check 8e rewritten to assert the *exact* table-level grant set per table in both directions (missing AND extra), using sorted-array comparison against `information_schema.role_table_grants` — not just "nothing extra" as before; also documents that column-level grants never appear in that view (item 4). **(3)** New check 8g: verifies `agent_service`'s `UPDATE` on `interactions` is granted on *exactly* `metadata, outcome, requires_action, summary` via `information_schema.column_privileges`, no more, no fewer (items 1 + 4). **(4)** New checks 10a (the `requires_jerry`/`status` biconditional is present, not just the one-way implication) and 10b (`task_events.from_status`/`to_status` CHECK constraints exist) (items 2 + 3). **(5)** Checks 11 and 12 rewritten: the old `IF EXISTS (... AND is_nullable = 'NO')` pattern was a false-positive trap — vacuously true (check passes) if the column doesn't exist at all — replaced with an explicit "count exists = N" assertion followed by a separate "count nullable = N" assertion (item 5). **(6)** New checks 15a–15f: `has_schema_privilege` for exact schema-level access (`agent_service`=USAGE-only; `anon`/`authenticated`/`service_role`=none), `agent_service` has no role memberships and no elevated attributes, `has_table_privilege` proves zero *effective* DML access to every `public.*` table (not just "no explicit grant"), and any baseline `PUBLIC` grant found on `public.*` is reported via `RAISE NOTICE` rather than failed on or revoked (items 7 + 9). **(7)** New check 16 addition already covered locked status values from round 1; unchanged this round except renumbering doesn't apply — checks 16/17 kept their numbers. |
| `docs/agent-platform/phase0a-review.md` | §2 gained two bullets (the `requires_jerry` biconditional, `task_events` status constraints). §3.2's table updated — `interactions` no longer listed with the append-only group, now has its own row describing the column-scoped `UPDATE`. New §3.4 covers the `PUBLIC`-revoke reasoning (schema/table no-ops vs. function `EXECUTE`, which is a real default) and the effective-isolation checks. This section and §7/§8 below updated to match. |

### Round 1 (previous correction — the RLS/BYPASSRLS/ownership fix)

| File | Change |
| --- | --- |
| `supabase/migrations/20260830_agent_operational_schema_phase0a.sql` | Header comment rewritten to describe the corrected RLS/ownership model instead of the flawed "zero policies" one. `projects.status` CHECK gained `PLANNED` and its default changed from `ACTIVE` to `PLANNED`. The entire RLS/grants block was replaced: `agent_service` created `NOLOGIN NOBYPASSRLS` (was `NOLOGIN`); the old single `GRANT SELECT, INSERT, UPDATE ON <all 8 tables>` replaced by per-table grants; 19 `CREATE POLICY` statements added (each preceded by `DROP POLICY IF EXISTS`); the blanket `ALTER DEFAULT PRIVILEGES` statement removed. Postflight guard gained BYPASSRLS and ownership checks. |
| `docs/agent-platform/review_only_phase0a_validation.sql` | Check #8 fixed; six new checks (8a–8f) added covering policy correctness, ownership, BYPASSRLS, exact grant sets, no-DELETE; new check for locked status values. |
| `docs/agent-platform/phase0a-review.md` | New §3.1–3.3, updated checklist/open-questions. |

No other files touched, in either round. No `public.*` object modified. No
existing production privilege revoked or altered — the new effective-access
checks are read-only reporting, per Jerry's explicit instruction not to make
a destructive blanket change without approval. Nothing was applied or
connected to remotely at any point in either correction.

## 7. Review checklist

- [x] Eight tables created: `owners`, `projects`, `contacts`, `tasks`,
      `task_events`, `interactions`, `decisions`, `runs`
- [x] Constraints: FK, UNIQUE, and per-status `CHECK` invariants on `tasks`
- [x] Indexes: every index the spec listed, plus `tasks.parent_task_id` /
      `tasks.blocked_by_task_id` (explained in §2/migration comments)
- [x] RLS enabled on all 8 tables, **with explicit `agent_service`-scoped
      policies matching its least-privilege grants** (corrected from the
      earlier zero-policies design — see §3.1)
- [x] `agent_service` has no `BYPASSRLS` and does not own any `agent.*` table
- [x] Grants and policies are least-privilege per table, not identical
      SELECT/INSERT/UPDATE everywhere (see §3.2)
- [x] No `DELETE` grant or policy anywhere in the schema
- [x] `task_events` and `decisions` are append-only from `agent_service`'s
      perspective (SELECT+INSERT only, no UPDATE/DELETE at either the grant
      or policy layer); `interactions` allows `UPDATE` scoped to exactly
      `summary, outcome, requires_action, metadata` via a column-level
      `GRANT` (not append-only, by design — see §3.2)
- [x] `requires_jerry = (status = 'NEEDS_JERRY')` enforced as a true
      biconditional, not a one-way implication
- [x] `task_events.from_status`/`to_status` constrained to the task status
      vocabulary (nullable, no typo'd values); `event_type` stays free text
- [x] `agent` schema, its tables (once created), and `agent.set_updated_at()`
      have no `PUBLIC` grants (schema/table revokes are defense-in-depth
      no-ops; the function `EXECUTE` revoke is a real default reversed)
- [x] `agent_service` has zero *effective* DML privilege on every `public.*`
      table (verified via `has_table_privilege`, not just absent grant rows),
      no role memberships, and no elevated role attributes
- [x] No policy targets `anon`/`authenticated`/`public`
- [x] Every FK has an explicit `ON DELETE RESTRICT`
- [x] Partial unique index: `interactions (channel, source_ref) WHERE
      source_ref IS NOT NULL`
- [x] `projects.status`, `runs.status`, `interactions.direction` match the
      locked value sets
- [x] No seed data
- [x] No FK from `agent.*` into any `public.*` product table
- [x] `agent` not exposed through PostgREST/Supabase's exposed-schemas list
- [x] Not applied to the linked project; no production/config change made;
      nothing connected to remotely

## 8. Open questions / Jerry decisions

Only genuine decisions the repo can't answer on its own:

1. **`agent_service` credentials**: the role is created `NOLOGIN` with no
   password. Jerry needs to decide/perform: enable login, set a password
   (ideally via Supabase's connection-pooling/direct-connection UI, stored
   in whatever secret manager the future TS service will use), and confirm
   the direct-connection string/port to hand to that service. This can't be
   resolved by inspecting the repo — it's new infrastructure.
2. **Verify the connection path actually works on this project** (§3.3):
   confirm whether the future TS service's host has IPv6 egress (for a
   direct connection) or should use the Supavisor session-mode pooler
   instead, and do a one-time manual `psql`/driver connection test with
   `agent_service` before wiring the real service. This depends on Jerry's
   specific Supabase plan and the TS service's eventual hosting, neither of
   which is visible from this repo.
3. **Confirm exposed-schemas stays untouched**: the recommendation depends
   on `agent` never being added to Supabase Studio → API Settings →
   "Exposed schemas". This is a dashboard setting outside this repo — worth
   a one-time manual confirmation after applying the migration (the
   validation script's check #17 is a reminder, not an automated check,
   since Postgres itself can't see that setting).
4. **`owners` INSERT/UPDATE timing**: `agent_service` is SELECT-only on
   `owners` for now (§3.2). If Phase 0B's bootstrap should instead be
   performed *by* the service rather than by an admin role directly, that's
   a small follow-up migration adding the INSERT/UPDATE grant + policy —
   flag if that's the intended flow.
