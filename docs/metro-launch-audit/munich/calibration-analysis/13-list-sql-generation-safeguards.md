# List SQL Generation — Execution Lessons & Reusable Safeguards (Part 5)

## Failure 1: the apostrophe/dollar-quoting bug — traced exactly

`munich_lists_rebuild_no_temp_tables.sql` (lines 32-36) contains a self-documenting repair:

```sql
UPDATE public.items
SET body = $body$Show up after midnight, when 'Schumann's Bar' says it truly becomes a bar.$body$
WHERE maps_query = $mq$Schumann's Bar, Odeonsplatz 6-7, 80539 München, Germany$mq$
  AND body = $old$Show up after midnight, when 'Schumann''s Bar' says it truly becomes a bar.$old$;
```

**Mechanism, traced precisely:** Postgres dollar-quoting (`$tag$...$tag$`) treats everything between the two identical tags as a completely literal string — **no character inside it is special, including a single apostrophe (`'`)**. This is the entire point of dollar-quoting: it exists specifically so you never have to escape apostrophes inside it. The bug (visible in the `$old$...$old$` value, which is the corrupted body being searched for and replaced) came from treating the apostrophe as if it were inside an ordinary `'...'`-quoted string literal, where a literal apostrophe must be escaped by doubling it (`''`). Someone (or some generation step) applied SQL standard-string escaping rules (`Schumann''s`) to text that was actually going to be embedded inside a dollar-quoted literal (`$body$Schumann's$body$`), where that same doubled apostrophe is not an escape sequence at all — it is two literal apostrophes, rendering as `Schumann''s Bar` (visibly wrong, doubled) in the stored body text and, more importantly, in every future query that tries to match it as a plain string via ordinary `'...'` literals.

**Why this specific bug was so damaging in this codebase's own list SQL:** the rest of the rebuild SQL matches items by exact `body = $b$...$b$` comparison (see below). A body containing a doubled apostrophe from the dollar-quoting mistake would **never match** a plan entry written with the correct single apostrophe (or vice versa) — this is exactly the item-resolution failure class the preflight `HAVING count(i.id) <> 1` guards exist to catch (it would surface as `[matches=0]`), and exactly why this repair had to run *before* the After Dark list's `DO $list4$` block, which references the corrected body directly (`'Show up after midnight, when 'Schumann's Bar' says it truly becomes a bar.'` — single apostrophe, matching the repaired form).

**The related, not-directly-visible Pusser's failure:** "Pusser's New York Bar" appears in the final After Dark list (`'Order the Painkiller beneath the ship-style fittings at 'Pusser's New York Bar'.'`, live-confirmed). Its live body correctly contains a **single** apostrophe (confirmed via direct query: `body = "Order the Painkiller beneath the ship-style fittings at 'Pusser's New York Bar'."`, no doubling). Because this SQL's own `VALUES` list for Pusser's uses the same `$b$...$b$` dollar-quoting as every other row in the same `VALUES(...)` block, and the live item's body was already correct by the time this SQL ran, this SQL did not need to (and did not) re-repair Pusser's — but the task's own framing ("an item-resolution failure involving the apostrophe in Pusser's New York Bar" preceded this final version) means an **earlier**, now-superseded version of this SQL-generation process almost certainly hit the exact same doubled-apostrophe mistake on Pusser's that this SQL's own comment documents having hit on Schumann's, and that earlier failure is what taught the SQL author (or generator) to standardize on dollar-quoting with a consistent `$b$` tag across every `VALUES` row in this file — which is why this final version has zero apostrophe-related preflight failures anywhere in its six list blocks, including the two lists (Munich After Dark, ×2 apostrophe-bearing venues) that would have been most exposed to a recurrence.

**Rule, stated precisely for reuse:** when a literal string will be embedded inside a `$tag$...$tag$` dollar-quoted block, apostrophes inside it must be written exactly as they appear in the real text — **never doubled**. Doubling is the correct (and only) escape mechanism for apostrophes inside an ordinary single-quoted `'...'` string literal; it is actively wrong inside dollar-quoting, where it produces two literal apostrophes in the stored data. A safe SQL-generation pipeline should pick exactly one of these two quoting styles for all generated literals and never mix escaping rules from the other style into it.

## Failure 2: the missing-temp-table failure — inferred from the file's own structure

The file's name, `munich_lists_rebuild_no_temp_tables.sql`, and its actual structure (every list body is built via `(VALUES (...), (...), ...) AS plan(item_body, sort_order)` — an inline derived table, scoped entirely to the single `SELECT`/`INSERT` statement that references it, never a `CREATE TEMP TABLE`) together confirm the fix directly: an earlier version of this generation process depended on a `CREATE TEMP TABLE tmp_munich_list_plan (...)` populated in one SQL editor execution and then referenced in a **later, separate** execution — which fails, because a session-scoped temp table does not survive across separate statements submitted as distinct executions in a typical SQL-editor workflow (each "Run" can open a new session, or the temp table can be dropped at the end of an implicit transaction depending on the editor/driver). This produced exactly the error the task names: `tmp_munich_list_plan did not exist`.

**Rule, stated precisely for reuse:** never depend on a temp table (or any other session-scoped object) surviving between separate SQL-editor executions. The inline `(VALUES (...)) AS plan(...)` pattern used throughout this file's six list blocks is the correct, portable replacement — it exists only for the lifetime of the single statement that declares it, so there is no cross-execution survival to depend on in the first place, and it works identically whether the whole file is run as one paste or split into pieces (the only requirement is that the `DO $listN$` block and its internal `VALUES` both live inside the same statement, which they do here).

## Duplicate-prevention: `ON CONFLICT (list_id, item_id) DO NOTHING` — evaluated

Every list's `INSERT INTO public.list_items` ends with `ON CONFLICT (list_id, item_id) DO NOTHING`. Combined with the `DELETE FROM public.list_items WHERE list_id = v_list_id` immediately preceding each list's insert, this guard is **sufficient for this SQL's actual design** (a full replace-then-insert per list) but **not sufficient on its own** as a general duplicate-prevention pattern — it only prevents the same `(list_id, item_id)` pair from being inserted twice *within the same INSERT statement* (e.g. if the same body string appeared twice in one list's `VALUES` block, which none of the six lists' blocks do — checked directly, no `VALUES` block in this file repeats a body). It does nothing to prevent a same-venue-different-wording near-duplicate — Kunst Oase and Vereinsheim's real cross-wave duplication problem (`02-new-item-contributions.md`) — because those are two entirely different `item_id`s with two entirely different `body` values; `ON CONFLICT` never sees them as the same key. This SQL's `list_items` layer inherits, not solves, the item-level duplicate-detection gap that is `seedDuplicateNormalization.ts`'s job upstream.

## Preflight/postflight pattern — documented as a reusable template

Every one of the six list `DO` blocks in this file follows the identical, reusable shape:

```sql
DO $listN$
DECLARE
  v_metro_id uuid;
  v_list_id uuid;
  v_bad text;
  v_count integer;
BEGIN
  -- 1. Resolve the metro and list rows; RAISE EXCEPTION if either is missing.
  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = 'munich';
  SELECT id INTO v_list_id FROM public.lists WHERE metro_id = v_metro_id AND title = $title$...$title$ LIMIT 1;
  IF v_list_id IS NULL THEN RAISE EXCEPTION '...'; END IF;

  -- 2. PREFLIGHT: for every planned (item_body, sort_order), LEFT JOIN against
  --    public.items ON body match, GROUP BY the plan row, HAVING count(i.id) <> 1.
  --    This single HAVING clause catches BOTH zero-match (not found) and
  --    multi-match (ambiguous/duplicate body) failures in one pass, and
  --    string_aggs every failing row into one readable exception message.
  SELECT string_agg(p.item_body || ' [matches=' || p.match_count || ']', E'\n' ORDER BY p.sort_order)
  INTO v_bad
  FROM ( SELECT plan.item_body, plan.sort_order, count(i.id) AS match_count
         FROM (VALUES (...), (...)) AS plan(item_body, sort_order)
         LEFT JOIN public.items i ON i.body = plan.item_body AND i.is_active = true AND i.is_approved = true
         GROUP BY plan.item_body, plan.sort_order
         HAVING count(i.id) <> 1 ) p;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION E'... item-resolution failure:\n%', v_bad; END IF;

  -- 3. Only after preflight passes: DELETE existing memberships, then INSERT fresh ones.
  DELETE FROM public.list_items WHERE list_id = v_list_id;
  INSERT INTO public.list_items (list_id, item_id)
  SELECT v_list_id, i.id FROM (VALUES (...)) AS plan(item_body, sort_order)
  JOIN public.items i ON i.body = plan.item_body AND i.is_active = true AND i.is_approved = true
  ORDER BY plan.sort_order
  ON CONFLICT (list_id, item_id) DO NOTHING;

  -- 4. POSTFLIGHT: assert the final count matches what was planned.
  SELECT count(*) INTO v_count FROM public.list_items WHERE list_id = v_list_id;
  IF v_count <> N THEN RAISE EXCEPTION '...: expected % memberships, found %', N, v_count; END IF;
END
$listN$;
```

This is a genuinely good, reusable template for **any** future stage that writes list membership (or similar many-to-many linking) from a body of "planned" rows: it fails before mutating anything if resolution is incomplete (step 2, before step 3's `DELETE`), and it re-verifies its own result independently after writing (step 4) rather than trusting the write to have gone as intended. The one improvement this document recommends (see below) is resolving to UUIDs once, in a separate step, rather than repeating the same fragile body-match join in both the preflight and the real `INSERT`.

## Never use loose body matching when a stable UUID is available — the single biggest reusable lesson

**This SQL violates this principle throughout — all 138 item resolutions, across all six lists, are done by exact `body = '...'` text match, never by `item.id`.** This is disclosed plainly rather than softened, because it is the most important single finding of this part: even though every preflight guard passed on this specific run (zero item-resolution failures occurred in the version actually `COMMIT`ed), the design itself carries real, avoidable risk that a UUID-based design would not:

- **Rerun safety is not guaranteed independent of body-text stability.** If any of the 95 items referenced by these six lists' bodies is edited even slightly by a future catalog-voice pass (M8.75), a future item-level correction, or a future de-duplication merge — none of which this SQL, or any list-membership SQL like it, has any way to know about — a rerun of this exact file would fail its own preflight guard (correctly, loudly) rather than silently doing the wrong thing. That's the right failure mode given the design, but it means this file is now a **live liability**: rerunning it after any of those 95 item bodies changes requires manually re-deriving a new, updated `VALUES` block per affected list, rather than just re-running against stable identifiers.
- **A UUID-based version of this same file would be shorter, faster, and immune to the entire apostrophe/dollar-quoting failure class described above** — a UUID literal has no escaping hazard at all. The correct design once every item has been resolved once (as this SQL effectively did, successfully) is: run the body-match resolution ONE time, capture the resulting `item_id`s, and write a **second**, UUID-keyed version of the list SQL for actual production application (and for any future rerun) — never re-resolve by body text on every subsequent run.
- **Every other safeguard in this file (the preflight guard, the dollar-quoting fix, the temp-table elimination) is, in effect, damage control for the consequences of choosing body-text matching in the first place.** A UUID-keyed design would not need most of them.

## Is this SQL idempotent on a second run? Traced through

**Mostly yes, with one caveat.** Tracing each block:

- `$setup$`: the list-shell `INSERT ... WHERE NOT EXISTS` and the flag `UPDATE` are both naturally idempotent (re-running finds the lists already present/correctly flagged and does nothing new). The Schumann's Bar repair `UPDATE` is idempotent by construction — its own `WHERE body = $old$...$old$` clause only matches the corrupted (doubled-apostrophe) form, which no longer exists after the first successful run, so a second run's `UPDATE` matches zero rows and is a safe no-op. The old-After-Dark-shell cleanup is idempotent (branches on `v_old_id`/`v_new_id` presence, both `NULL` after the first run so nothing happens).
- Each `DO $listN$` block: the `DELETE FROM list_items WHERE list_id = v_list_id` followed by a fresh `INSERT ... ON CONFLICT DO NOTHING` is idempotent **as long as the preflight guard still passes** — i.e., as long as the same 20-30 body strings per list still resolve to exactly one live item each. If they do, a second run deletes and immediately re-inserts the identical membership set, a functional no-op with a brief unobserved gap. **The caveat:** this is idempotent in *result*, not fully safe in *execution* — because the whole file is one `BEGIN...COMMIT` transaction, a second run either fully succeeds (same result) or fully fails and rolls back (if any list's preflight guard now fails, e.g. because a body was edited in the interim) — there is no partial-application risk within a single execution, which is the important safety property, but a second run is not a true no-op at the row level (it does delete and recreate every row, not skip already-correct rows), meaning `updated_at`/audit-trail-style columns on `list_items` (if any exist) would be disturbed by a "successful" no-op rerun. This was not independently checked against `public.list_items`'s actual schema in this task (out of scope) and is flagged as a minor, not urgent, gap.

## Preserving unrelated lists and metros

Confirmed safe by construction: every query in this file is scoped by `WHERE metro_id = v_metro_id` (Munich only) and, within that, by `WHERE list_id = v_list_id` (one specific list at a time) or `WHERE title IN (<the six canonical titles>)`. No query in this file could touch another metro's data, and the six-title `IN` list in `$setup$`'s flag-update and duplicate-check queries means even a same-metro list with a different title (were one to exist) is untouched.

## Regression fixtures for this failure class (data only, per the task's instruction — not wired into any test)

```ts
// Proposed data-only fixtures for a future SQL-generation safeguard test.
// NOT implemented as an actual test in this task.

const SQL_GENERATION_REGRESSION_FIXTURES = [
  {
    label: 'Apostrophe inside dollar-quoting — must not be doubled',
    wrongForm: `$body$Show up after midnight, when 'Schumann''s Bar' says it truly becomes a bar.$body$`,
    correctForm: `$body$Show up after midnight, when 'Schumann's Bar' says it truly becomes a bar.$body$`,
    rule: 'A literal apostrophe inside a $tag$...$tag$ dollar-quoted string must be written exactly as it appears in the source text — doubling it (the correct escape for an ordinary \'...\' string literal) produces two literal apostrophes inside dollar-quoting, corrupting the stored value.',
    realIncident: 'Schumann\'s Bar body corruption, repaired inline in munich_lists_rebuild_no_temp_tables.sql lines 32-36; the same class of bug is inferred (not directly observed) to have hit Pusser\'s New York Bar in an earlier, superseded generation pass per the task\'s own framing.',
  },
  {
    label: 'Cross-execution temp table dependency',
    wrongForm: 'CREATE TEMP TABLE tmp_munich_list_plan (...); -- (separate execution) --; INSERT INTO ... SELECT ... FROM tmp_munich_list_plan;',
    correctForm: 'INSERT INTO public.list_items (list_id, item_id) SELECT v_list_id, i.id FROM (VALUES (...), (...)) AS plan(item_body, sort_order) JOIN public.items i ON i.body = plan.item_body ...;',
    rule: 'Never depend on a temp table (or any session-scoped object) surviving between separate SQL-editor executions. Use an inline VALUES-derived table scoped to the single statement that needs it.',
    realIncident: 'File is explicitly named munich_lists_rebuild_no_temp_tables.sql, and its structure uses only inline VALUES tables — confirms this fix was applied after an earlier failure whose error was literally "tmp_munich_list_plan did not exist."',
  },
  {
    label: 'Body-text resolution instead of UUID resolution (the systemic lesson, not a single bug)',
    wrongForm: `JOIN public.items i ON i.body = plan.item_body AND i.is_active = true AND i.is_approved = true`,
    correctForm: `JOIN public.items i ON i.id = plan.item_id  -- plan carries a resolved production UUID, captured once via a prior body-match pass and never re-derived`,
    rule: 'Once an item has been resolved by any means (name, body, or other fuzzy match), capture its production UUID and use ONLY the UUID for every subsequent reference (list SQL, reruns, related patches). Never re-run a body-text match as the operational resolution mechanism for a system already holding the UUID.',
    realIncident: 'All 138 item resolutions across all six of this SQL\'s lists use body-text matching exclusively — zero UUID-based resolutions anywhere in the file, despite every one of those items already existing in production with a stable id by the time this SQL ran.',
  },
]
```
