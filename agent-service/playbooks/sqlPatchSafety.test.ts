import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkNoTempTableDependency, checkNoMinUuid, checkSingleAtomicBlock, checkSqlPatchSafety, buildUniqueMatchAssertion } from './sqlPatchSafety'

test('no TEMP-table dependency in generated Jerry-run patches — CREATE TEMP TABLE is flagged', () => {
  const sql = 'CREATE TEMP TABLE staging (id uuid); INSERT INTO staging SELECT gen_random_uuid();'
  const issue = checkNoTempTableDependency(sql)
  assert.ok(issue)
  assert.equal(issue!.rule, 'NO_TEMP_TABLE')
})

test('CREATE TEMPORARY TABLE (the long-form keyword) is also flagged', () => {
  const issue = checkNoTempTableDependency('CREATE TEMPORARY TABLE staging (id uuid);')
  assert.ok(issue)
})

test('a clean DO $$ block with no temp table passes', () => {
  const sql = "DO $$ DECLARE v_item_id uuid; BEGIN SELECT id INTO v_item_id FROM public.items WHERE body = 'x'; END $$;"
  assert.equal(checkNoTempTableDependency(sql), null)
})

test('no MIN(uuid) dependency — MIN() on an identifier-shaped column is flagged', () => {
  const sql = 'SELECT MIN(item_id) FROM public.items WHERE body = $1;'
  const issues = checkNoMinUuid(sql)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].rule, 'NO_MIN_UUID')
  assert.match(issues[0].detail, /item_id/)
})

test('MIN(id) is flagged the same way as MIN(item_id)', () => {
  assert.equal(checkNoMinUuid('SELECT MIN(id) FROM public.tags;').length, 1)
})

test('MIN() on a legitimate non-identifier column (price, created_at) is never flagged', () => {
  assert.equal(checkNoMinUuid('SELECT MIN(price) FROM public.items;').length, 0)
  assert.equal(checkNoMinUuid('SELECT MIN(created_at) FROM public.items;').length, 0)
  assert.equal(checkNoMinUuid('SELECT MIN(distance_m) FROM public.neighborhoods;').length, 0)
})

test('checkSingleAtomicBlock: a multi-statement patch with no DO block is flagged', () => {
  const issue = checkSingleAtomicBlock('INSERT INTO a VALUES (1); INSERT INTO b VALUES (2); INSERT INTO c VALUES (3);', 3)
  assert.ok(issue)
  assert.equal(issue!.rule, 'SINGLE_ATOMIC_BLOCK')
})

test('checkSingleAtomicBlock: a single trivial statement is exempt', () => {
  assert.equal(checkSingleAtomicBlock('SELECT 1;', 1), null)
})

test('checkSingleAtomicBlock: a patch that already uses DO $$ passes regardless of statement count', () => {
  assert.equal(checkSingleAtomicBlock('DO $$ BEGIN NULL; END $$;', 5), null)
})

test('checkSqlPatchSafety: a fully compliant single atomic DO block with count/assert/select passes with zero issues', () => {
  const sql = [
    'BEGIN;',
    'DO $$',
    'DECLARE',
    '  v_count int;',
    '  v_item_id uuid;',
    'BEGIN',
    buildUniqueMatchAssertion({ countVar: 'v_count', resultVar: 'v_item_id', fromWhereClause: "FROM public.items WHERE body = 'x'", label: 'item lookup' }),
    'END $$;',
    'COMMIT;',
  ].join('\n')
  const result = checkSqlPatchSafety(sql)
  assert.equal(result.safe, true)
  assert.deepEqual(result.issues, [])
})

test('checkSqlPatchSafety: a patch combining both violations reports both', () => {
  const sql = 'CREATE TEMP TABLE staging (id uuid); SELECT MIN(item_id) FROM staging;'
  const result = checkSqlPatchSafety(sql, { statementCountHint: 1 }) // isolate the two violations under test; SINGLE_ATOMIC_BLOCK is covered separately above
  assert.equal(result.safe, false)
  assert.equal(result.issues.length, 2)
  assert.ok(result.issues.some((i) => i.rule === 'NO_TEMP_TABLE'))
  assert.ok(result.issues.some((i) => i.rule === 'NO_MIN_UUID'))
})

test('buildUniqueMatchAssertion: emits count -> assert count = 1 -> select, never a bare SELECT INTO or MIN()/LIMIT 1', () => {
  const fragment = buildUniqueMatchAssertion({ countVar: 'v_count', resultVar: 'v_tag_id', fromWhereClause: "FROM public.tags WHERE name = 'cocktails'", label: 'tag lookup for cocktails' })
  assert.match(fragment, /SELECT count\(\*\) INTO v_count/)
  assert.match(fragment, /IF v_count <> 1 THEN RAISE EXCEPTION/)
  assert.match(fragment, /SELECT id INTO v_tag_id/)
  assert.doesNotMatch(fragment, /MIN\(/)
  assert.doesNotMatch(fragment, /LIMIT 1/)
})
