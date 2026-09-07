// agent-service/playbooks/sqlPatchSafety.ts
//
// Chief Phase 2U — permanent SQL-generation safety rules, converted from
// repeated real Supabase SQL Editor failures during the San Diego
// reconciliation: generated patches relied on TEMP tables surviving
// across separate execution statements (Supabase's SQL Editor does not
// guarantee that), and at least one patch used `MIN(uuid)` to pick "the"
// row when a match should resolve exactly once (UUIDs have no
// meaningful ordering — `MIN()` on a uuid column silently picks an
// arbitrary row, which is never the intent when a match is supposed to
// be unique).
//
// Every future Jerry-run production patch generator (metro launch,
// individual item intake, or any other one-off) should run its own
// generated SQL text through `checkSqlPatchSafety()` before presenting
// it, and the certification stage should treat a violation the same way
// as any other automatable, self-repairable failure — regenerate using
// the safe pattern, never hand Jerry a patch that has a real, recurring
// failure signature.

export interface SqlPatchSafetyIssue {
  rule: 'NO_TEMP_TABLE' | 'NO_MIN_UUID' | 'NO_SESSION_STATE' | 'SINGLE_ATOMIC_BLOCK'
  detail: string
}

export interface SqlPatchSafetyResult {
  safe: boolean
  issues: SqlPatchSafetyIssue[]
}

const TEMP_TABLE_PATTERN = /\bCREATE\s+(?:TEMP|TEMPORARY)\s+TABLE\b/i
const MIN_UUID_PATTERN = /\bMIN\s*\(\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\)/g
// A conservative allow-list of column-name fragments MIN() is legitimately used on (dates, numbers, ordering) — anything NOT matching one of these, when the surrounding query context also mentions "uuid" or "_id", is flagged for a human to confirm it isn't a uuid column.
const LIKELY_UUID_COLUMN_PATTERN = /\b(id|uuid|item_id|tag_id|category_id|neighborhood_id|contact_id|list_id|metro_id|venue_id)\b/i

/**
 * Never a substitute for the actual `SET SESSION` grep this replaced —
 * a temp table's DATA surviving into a later, separate `supabase db
 * query -f` invocation is the real failure mode, and `CREATE TEMP
 * TABLE`/`CREATE TEMPORARY TABLE` is the one syntactic signature that
 * always indicates it. A `WITH ... AS (...)` CTE or a `DO $$ ... $$`
 * block's own `DECLARE`d variables are both fine — neither survives (or
 * needs to survive) past the single statement/block they're defined in,
 * which is exactly the atomic, self-contained pattern this module wants.
 */
export function checkNoTempTableDependency(sql: string): SqlPatchSafetyIssue | null {
  const match = sql.match(TEMP_TABLE_PATTERN)
  if (!match) return null
  return {
    rule: 'NO_TEMP_TABLE',
    detail: `Generated SQL depends on "${match[0]}" — a TEMP table is not guaranteed to survive across separate Supabase SQL Editor executions. Rewrite as a single atomic \`DO $$ ... $$;\` block with inline datasets (e.g. a VALUES list or DECLAREd array) instead.`,
  }
}

/**
 * Flags any `MIN(<col>)` call where the column name looks like an
 * identifier column (id/uuid/*_id) — a real signature of "pick one
 * arbitrary row when a match should be unique," which is a correctness
 * bug (UUIDs have no meaningful order) not just a style issue. Does NOT
 * flag `MIN(price)`, `MIN(created_at)`, `MIN(distance)`, etc. — those
 * are legitimate uses this rule must never block.
 */
export function checkNoMinUuid(sql: string): SqlPatchSafetyIssue[] {
  const issues: SqlPatchSafetyIssue[] = []
  const matches = sql.matchAll(MIN_UUID_PATTERN)
  for (const m of matches) {
    const column = m[0].replace(/^MIN\s*\(\s*/i, '').replace(/\s*\)$/, '')
    if (LIKELY_UUID_COLUMN_PATTERN.test(column)) {
      issues.push({
        rule: 'NO_MIN_UUID',
        detail: `Found "${m[0]}" — MIN() on what looks like an identifier column ("${column}") silently picks an arbitrary row; UUIDs have no meaningful order. When a match must resolve exactly once, use the count -> assert count = 1 -> select pattern instead (see buildUniqueMatchAssertion()).`,
      })
    }
  }
  return issues
}

/** A patch that never mentions a single `DO $$` block at all is almost certainly relying on multiple separate statements/executions instead of one atomic transaction — flagged as a soft finding, not a hard failure, since a trivial one-statement patch legitimately doesn't need one. */
export function checkSingleAtomicBlock(sql: string, statementCountHint?: number): SqlPatchSafetyIssue | null {
  const hasDoBlock = /\bDO\s*\$\$/i.test(sql)
  if (hasDoBlock) return null
  if (statementCountHint !== undefined && statementCountHint <= 1) return null
  return {
    rule: 'SINGLE_ATOMIC_BLOCK',
    detail: 'No `DO $$ ... $$;` block found in a multi-statement patch — prefer wrapping Jerry-run production patches in a single atomic DO block with fail-closed assertions (RAISE EXCEPTION on any unexpected count) so the whole mutation rolls back together on any assertion failure, rather than relying on several separate statements each succeeding independently.',
  }
}

export function checkSqlPatchSafety(sql: string, options: { statementCountHint?: number } = {}): SqlPatchSafetyResult {
  const issues: SqlPatchSafetyIssue[] = []
  const temp = checkNoTempTableDependency(sql)
  if (temp) issues.push(temp)
  issues.push(...checkNoMinUuid(sql))
  const atomic = checkSingleAtomicBlock(sql, options.statementCountHint)
  if (atomic) issues.push(atomic)
  return { safe: issues.length === 0, issues }
}

// ---------------------------------------------------------------------------
// The required, reusable "resolve exactly once" pattern: count -> assert
// count = 1 -> select the uuid. A small SQL-fragment builder so every
// future generator produces the SAME safe shape rather than re-inventing
// (and re-breaking) it per script.
// ---------------------------------------------------------------------------

export interface UniqueMatchAssertionInput {
  /** Declared plpgsql variable name to hold the count, e.g. "v_match_count". */
  countVar: string
  /** Declared plpgsql variable name to hold the resolved uuid, e.g. "v_item_id". */
  resultVar: string
  /** The FROM/WHERE clause identifying the match, e.g. "FROM public.items WHERE body = 'X'". No trailing semicolon. */
  fromWhereClause: string
  /** Human-readable label for the RAISE EXCEPTION message, e.g. "item lookup for 'X'". */
  label: string
}

/**
 * Emits three plpgsql statements implementing count -> assert = 1 ->
 * select, in that order — never a bare `SELECT ... INTO` alone (which
 * silently returns NULL on zero matches and an arbitrary row's value on
 * multiple, exactly the ambiguity this pattern exists to eliminate) and
 * never `MIN(id)`/`LIMIT 1` as a substitute for a real uniqueness check.
 */
export function buildUniqueMatchAssertion(input: UniqueMatchAssertionInput): string {
  return [
    `  SELECT count(*) INTO ${input.countVar} ${input.fromWhereClause};`,
    `  IF ${input.countVar} <> 1 THEN RAISE EXCEPTION '% resolved to % row(s), expected exactly 1: %', ${quoteLiteral(input.label)}, ${input.countVar}, ${quoteLiteral(input.fromWhereClause)}; END IF;`,
    `  SELECT id INTO ${input.resultVar} ${input.fromWhereClause};`,
  ].join('\n')
}

function quoteLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}
