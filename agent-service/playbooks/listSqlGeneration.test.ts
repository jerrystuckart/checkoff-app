import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sqlQuote,
  sqlDollarQuote,
  resolveListItemsPreflight,
  generateListMembershipSql,
  generateNewListCreationSql,
  generateItemBodyRepairSql,
  type ListSqlItemResolution,
} from './listSqlGeneration'

// ---------------------------------------------------------------------------
// Real apostrophe regression cases — Pusser's New York Bar and Schumann's
// Bar, from calibration-analysis/13-list-sql-generation-safeguards.md.
// ---------------------------------------------------------------------------

test('sqlDollarQuote: real Schumann\'s Bar case — the apostrophe is preserved literally, never doubled', () => {
  const body = "Show up after midnight, when 'Schumann's Bar' says it truly becomes a bar."
  const quoted = sqlDollarQuote(body, 'body')
  assert.ok(quoted.includes("Schumann's Bar"), 'the single apostrophe must survive exactly as written')
  assert.equal(quoted.includes("Schumann''s"), false, 'doubling is the WRONG escape inside dollar-quoting — it must never appear')
  assert.equal(quoted, `$body$${body}$body$`)
})

test('sqlDollarQuote: real Pusser\'s New York Bar case — same discipline, apostrophe never doubled', () => {
  const body = "Order the Painkiller beneath the ship-style fittings at 'Pusser's New York Bar'."
  const quoted = sqlDollarQuote(body, 'body')
  assert.ok(quoted.includes("Pusser's New York Bar"))
  assert.equal(quoted.includes("Pusser''s"), false)
})

test('sqlQuote vs sqlDollarQuote: the two styles use genuinely DIFFERENT, non-interchangeable escaping rules for the same apostrophe-bearing text — encodes the exact bug class (applying one style\'s escape inside the other\'s quoting)', () => {
  const body = "Schumann's Bar"
  const ordinary = sqlQuote(body)
  const dollar = sqlDollarQuote(body, 'b')
  assert.equal(ordinary, "'Schumann''s Bar'", 'ordinary single-quoted literals correctly DOUBLE the apostrophe')
  assert.equal(dollar, '$b$Schumann\'s Bar$b$', 'dollar-quoted literals correctly do NOT double it')
  assert.notEqual(ordinary.replace(/^'|'$/g, ''), dollar.replace(/^\$b\$|\$b\$$/g, ''), 'the two escaped forms are literally different strings for the same input — proves they are not interchangeable')
})

test('sqlDollarQuote: picks a non-colliding tag if the text itself contains the preferred tag boundary', () => {
  const text = 'Contains a literal $b$ sequence.'
  const quoted = sqlDollarQuote(text, 'b')
  assert.equal(quoted.startsWith('$b1$') || quoted.startsWith('$b2$'), true, 'must not reuse a tag that would prematurely close the literal')
})

// ---------------------------------------------------------------------------
// Preflight resolution — exactly-one-match required; zero and multiple
// matches both fail closed before any mutation.
// ---------------------------------------------------------------------------

test('resolveListItemsPreflight: zero matches fails closed with a clear error, never silently skips the row', () => {
  const resolutions: ListSqlItemResolution[] = [{ intendedBody: "Order the Painkiller beneath the ship-style fittings at 'Pusser\\'s New York Bar'.", sortOrder: 1, matchedItemIds: [] }]
  const result = resolveListItemsPreflight(resolutions)
  assert.equal(result.ok, false)
  assert.equal(result.resolved.length, 0)
  assert.match(result.errors[0]!, /matches=0/)
})

test('resolveListItemsPreflight: multiple matches (ambiguous) fails closed', () => {
  const resolutions: ListSqlItemResolution[] = [{ intendedBody: 'Some ambiguous body', sortOrder: 1, matchedItemIds: ['id-a', 'id-b'] }]
  const result = resolveListItemsPreflight(resolutions)
  assert.equal(result.ok, false)
  assert.match(result.errors[0]!, /matches=2/)
})

test('resolveListItemsPreflight: partial-resolution failure (one good row, one bad row) fails the WHOLE preflight closed — never applies the good rows while dropping the bad one', () => {
  const resolutions: ListSqlItemResolution[] = [
    { intendedBody: 'Good row', sortOrder: 1, matchedItemIds: ['00000000-0000-0000-0000-000000000001'] },
    { intendedBody: 'Bad row', sortOrder: 2, matchedItemIds: [] },
  ]
  const result = resolveListItemsPreflight(resolutions)
  assert.equal(result.ok, false)
  assert.equal(result.resolved.length, 0, 'the whole preflight must fail closed — a partial resolution never partially proceeds')
})

test('resolveListItemsPreflight: a clean, fully-resolved set passes', () => {
  const resolutions: ListSqlItemResolution[] = [
    { intendedBody: 'A', sortOrder: 2, matchedItemIds: ['00000000-0000-0000-0000-000000000001'] },
    { intendedBody: 'B', sortOrder: 1, matchedItemIds: ['00000000-0000-0000-0000-000000000002'] },
  ]
  const result = resolveListItemsPreflight(resolutions)
  assert.equal(result.ok, true)
  assert.equal(result.resolved.length, 2)
})

// ---------------------------------------------------------------------------
// generateListMembershipSql — the real safeguards, end to end.
// ---------------------------------------------------------------------------

function goodResolutions(): ListSqlItemResolution[] {
  return [
    { intendedBody: "Order the Painkiller beneath the ship-style fittings at 'Pusser's New York Bar'.", sortOrder: 1, matchedItemIds: ['11111111-1111-1111-1111-111111111111'] },
    { intendedBody: "Show up after midnight, when 'Schumann's Bar' says it truly becomes a bar.", sortOrder: 2, matchedItemIds: ['22222222-2222-2222-2222-222222222222'] },
  ]
}

test('generateListMembershipSql: a clean preflight generates transactional, UUID-keyed, preflight-verified SQL', () => {
  const result = generateListMembershipSql({ metroSlug: 'munich', listTitle: 'Munich After Dark', resolutions: goodResolutions() })
  assert.equal(result.ok, true)
  assert.equal(result.expectedMembershipCount, 2)
  assert.ok(result.sql)
  assert.match(result.sql!, /^BEGIN;/)
  assert.match(result.sql!, /COMMIT;$/)
  assert.match(result.sql!, /11111111-1111-1111-1111-111111111111/)
  assert.match(result.sql!, /22222222-2222-2222-2222-222222222222/)
  assert.match(result.sql!, /ON CONFLICT \(list_id, item_id\) DO NOTHING/)
})

test('generateListMembershipSql: NEVER embeds raw body text into the mutation — item resolution is UUID-only, structurally eliminating the apostrophe/dollar-quoting failure class for membership SQL', () => {
  const result = generateListMembershipSql({ metroSlug: 'munich', listTitle: 'Munich After Dark', resolutions: goodResolutions() })
  assert.equal(result.sql!.includes('Pusser'), false, 'the generated membership SQL must never contain the raw body text at all')
  assert.equal(result.sql!.includes('Schumann'), false)
})

test('generateListMembershipSql: zero matches on any row refuses to generate ANY SQL — preflight completion required before any delete/replace', () => {
  const result = generateListMembershipSql({ metroSlug: 'munich', listTitle: 'Munich After Dark', resolutions: [{ intendedBody: 'Missing item', sortOrder: 1, matchedItemIds: [] }] })
  assert.equal(result.ok, false)
  assert.equal(result.sql, null)
})

test('generateListMembershipSql: multiple matches on any row refuses to generate ANY SQL', () => {
  const result = generateListMembershipSql({ metroSlug: 'munich', listTitle: 'Munich After Dark', resolutions: [{ intendedBody: 'Ambiguous item', sortOrder: 1, matchedItemIds: ['a', 'b'] }] })
  assert.equal(result.ok, false)
  assert.equal(result.sql, null)
})

test('generateListMembershipSql: a partial-resolution failure (mix of good and bad rows) refuses ALL generation, not just the bad row\'s', () => {
  const result = generateListMembershipSql({
    metroSlug: 'munich',
    listTitle: 'Munich After Dark',
    resolutions: [{ intendedBody: 'Good', sortOrder: 1, matchedItemIds: ['00000000-0000-0000-0000-000000000009'] }, { intendedBody: 'Bad', sortOrder: 2, matchedItemIds: [] }],
  })
  assert.equal(result.ok, false)
  assert.equal(result.sql, null)
})

test('generateListMembershipSql: no temp-table dependency anywhere in the generated SQL — every value needed is resolved once in TypeScript before any SQL string is built', () => {
  const result = generateListMembershipSql({ metroSlug: 'munich', listTitle: 'Munich After Dark', resolutions: goodResolutions() })
  assert.equal(/temp table/i.test(result.sql!), false)
  assert.equal(/create\s+table/i.test(result.sql!), false)
})

test('generateListMembershipSql: duplicate-membership prevention — a resolution that (however it happened) maps two intended rows to the SAME item id is de-duplicated before generation, never producing two VALUES rows for one (list_id, item_id) pair', () => {
  const resolutions: ListSqlItemResolution[] = [
    { intendedBody: 'Row A wording', sortOrder: 1, matchedItemIds: ['33333333-3333-3333-3333-333333333333'] },
    { intendedBody: 'Row B wording, same real item', sortOrder: 2, matchedItemIds: ['33333333-3333-3333-3333-333333333333'] },
  ]
  const result = generateListMembershipSql({ metroSlug: 'munich', listTitle: 'Hidden Gems', resolutions })
  assert.equal(result.ok, true)
  assert.equal(result.expectedMembershipCount, 1, 'de-duplicated to one real membership, not two')
  const occurrences = (result.sql!.match(/33333333-3333-3333-3333-333333333333/g) ?? []).length
  assert.equal(occurrences, 1, 'the UUID must appear exactly once in the generated VALUES list')
})

test('generateListMembershipSql: preserves unrelated metros and lists by construction — every write is scoped by metro slug -> v_metro_id and list title -> v_list_id, never a bare list_items write', () => {
  const result = generateListMembershipSql({ metroSlug: 'munich', listTitle: 'Munich After Dark', resolutions: goodResolutions() })
  assert.match(result.sql!, /WHERE slug = 'munich'/)
  assert.match(result.sql!, /WHERE metro_id = v_metro_id AND title = 'Munich After Dark'/)
  assert.match(result.sql!, /DELETE FROM public\.list_items WHERE list_id = v_list_id;/)
})

test('generateListMembershipSql: an empty resolved set (a list legitimately reduced to zero members) still generates valid, safe SQL — DELETE runs, no INSERT block, postflight expects 0', () => {
  const result = generateListMembershipSql({ metroSlug: 'munich', listTitle: 'Some List', resolutions: [] })
  assert.equal(result.ok, true)
  assert.equal(result.expectedMembershipCount, 0)
  assert.equal(result.sql!.includes('INSERT INTO public.list_items'), false)
  assert.match(result.sql!, /IF v_count <> 0 THEN/)
})

test('generateListMembershipSql: idempotency by construction — regenerating from the SAME resolved input produces byte-identical SQL', () => {
  const a = generateListMembershipSql({ metroSlug: 'munich', listTitle: 'Munich After Dark', resolutions: goodResolutions() })
  const b = generateListMembershipSql({ metroSlug: 'munich', listTitle: 'Munich After Dark', resolutions: goodResolutions() })
  assert.equal(a.sql, b.sql)
})

// ---------------------------------------------------------------------------
// generateNewListCreationSql — M9 ENFORCED Session 4 (corrected): the
// idempotent CREATE-list counterpart to generateListMembershipSql,
// identified by a caller-supplied DETERMINISTIC UUID (never title/metro
// natural-key lookup — see this module's own doc for why that was
// rejected and corrected).
// ---------------------------------------------------------------------------

const CREATOR_ID = '99999999-9999-9999-9999-999999999999'
const LIST_ID = 'a1b2c3d4-e5f6-5a1b-8c2d-3e4f5a6b7c8d'
const OTHER_LIST_ID = 'f0e0d0c0-b0a0-5000-8000-0000000000ff'

test('generateNewListCreationSql: a clean preflight generates transactional, UUID-keyed SQL using the caller-supplied deterministic list id', () => {
  const result = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Beer Gardens, Breweries & Bavarian Rituals', creatorId: CREATOR_ID, resolutions: goodResolutions() })
  assert.equal(result.ok, true)
  assert.equal(result.expectedMembershipCount, 2)
  assert.ok(result.sql)
  assert.match(result.sql!, /^BEGIN;/)
  assert.match(result.sql!, /COMMIT;$/)
  assert.match(result.sql!, new RegExp(`v_list_id uuid := '${LIST_ID}'::uuid;`))
  assert.match(result.sql!, /INSERT INTO public\.lists \(id, metro_id, title, is_official, is_public, creator_id, is_featured_eligible\)/)
  assert.match(result.sql!, /ON CONFLICT \(id\) DO UPDATE SET title = EXCLUDED\.title;/)
  assert.match(result.sql!, /11111111-1111-1111-1111-111111111111/)
  assert.match(result.sql!, /22222222-2222-2222-2222-222222222222/)
  assert.match(result.sql!, /ON CONFLICT \(list_id, item_id\) DO NOTHING/)
})

test('generateNewListCreationSql: a malformed listId is refused outright — never generates SQL with an invalid identity', () => {
  const result = generateNewListCreationSql({ metroSlug: 'munich', listId: 'not-a-uuid', listTitle: 'Day Trips & Big Adventures', creatorId: CREATOR_ID, resolutions: goodResolutions() })
  assert.equal(result.ok, false)
  assert.equal(result.sql, null)
  assert.ok(result.errors.some((e) => e.includes('not a well-formed UUID')))
})

test('generateNewListCreationSql: never creates a public.items row — only public.lists and public.list_items are ever written', () => {
  const result = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Day Trips & Big Adventures', creatorId: CREATOR_ID, resolutions: goodResolutions() })
  assert.equal(/INSERT INTO public\.items/i.test(result.sql!), false)
})

test('generateNewListCreationSql: NEVER embeds raw body text into the mutation — same UUID-only discipline as generateListMembershipSql', () => {
  const result = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Day Trips & Big Adventures', creatorId: CREATOR_ID, resolutions: goodResolutions() })
  assert.equal(result.sql!.includes('Pusser'), false)
  assert.equal(result.sql!.includes('Schumann'), false)
})

test('generateNewListCreationSql: zero matches on any row refuses to generate ANY SQL — same fail-closed preflight as membership SQL', () => {
  const result = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Day Trips & Big Adventures', creatorId: CREATOR_ID, resolutions: [{ intendedBody: 'Missing item', sortOrder: 1, matchedItemIds: [] }] })
  assert.equal(result.ok, false)
  assert.equal(result.sql, null)
})

test('generateNewListCreationSql: multiple matches on any row refuses to generate ANY SQL', () => {
  const result = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Day Trips & Big Adventures', creatorId: CREATOR_ID, resolutions: [{ intendedBody: 'Ambiguous item', sortOrder: 1, matchedItemIds: ['a', 'b'] }] })
  assert.equal(result.ok, false)
  assert.equal(result.sql, null)
})

test('generateNewListCreationSql: preserves unrelated metros and lists by construction — scoped by metro slug -> v_metro_id, and the exact target id -> v_list_id, never a bare public.lists/list_items write', () => {
  const result = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Day Trips & Big Adventures', creatorId: CREATOR_ID, resolutions: goodResolutions() })
  assert.match(result.sql!, /WHERE slug = 'munich'/)
  assert.match(result.sql!, new RegExp(`v_list_id uuid := '${LIST_ID}'::uuid;`))
  assert.match(result.sql!, /DELETE FROM public\.list_items WHERE list_id = v_list_id;/)
  assert.equal(result.sql!.includes(OTHER_LIST_ID), false, 'must never reference any other list id')
})

test('generateNewListCreationSql: an unrelated-metro conflict at the SAME deterministic id RAISE EXCEPTIONs inside the transaction — defense in depth alongside the caller\'s own TypeScript-level pre-check', () => {
  const result = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Day Trips & Big Adventures', creatorId: CREATOR_ID, resolutions: goodResolutions() })
  assert.match(result.sql!, /SELECT metro_id INTO v_existing_metro_id FROM public\.lists WHERE id = v_list_id;/)
  assert.match(result.sql!, /IF v_existing_metro_id IS NOT NULL AND v_existing_metro_id <> v_metro_id THEN/)
  assert.match(result.sql!, /RAISE EXCEPTION 'deterministic list id % already belongs to a different metro/)
})

test('generateNewListCreationSql: idempotency by construction — regenerating from the SAME conceptId-derived input produces byte-identical SQL (no random/generated UUID, no timestamp)', () => {
  const a = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Day Trips & Big Adventures', creatorId: CREATOR_ID, resolutions: goodResolutions() })
  const b = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Day Trips & Big Adventures', creatorId: CREATOR_ID, resolutions: goodResolutions() })
  assert.equal(a.sql, b.sql, 'rerunning must never produce a second, different list-creation statement for the same input — a real rerun against the same DB state converges on the SAME row via ON CONFLICT (id)')
})

test('generateNewListCreationSql: the SAME listId with a CHANGED title still targets the SAME row — a title change updates in place via ON CONFLICT (id), never a second row', () => {
  const renamed = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Day Trips & Epic Adventures (renamed)', creatorId: CREATOR_ID, resolutions: goodResolutions() })
  assert.equal(renamed.ok, true)
  assert.match(renamed.sql!, new RegExp(`v_list_id uuid := '${LIST_ID}'::uuid;`), 'the id is completely unaffected by the title change')
  assert.match(renamed.sql!, /ON CONFLICT \(id\) DO UPDATE SET title = EXCLUDED\.title;/, 'the renamed title is applied via an explicit, in-place UPDATE on the SAME row, never a new INSERT')
})

test('generateNewListCreationSql: the SAME listId with CHANGED membership still targets the SAME row', () => {
  const changedMembership = generateNewListCreationSql({
    metroSlug: 'munich',
    listId: LIST_ID,
    listTitle: 'Day Trips & Big Adventures',
    creatorId: CREATOR_ID,
    resolutions: [{ intendedBody: 'A brand-new third member', sortOrder: 3, matchedItemIds: ['33333333-3333-3333-3333-333333333333'] }, ...goodResolutions()],
  })
  assert.equal(changedMembership.ok, true)
  assert.equal(changedMembership.expectedMembershipCount, 3)
  assert.match(changedMembership.sql!, new RegExp(`v_list_id uuid := '${LIST_ID}'::uuid;`))
})

test('generateNewListCreationSql: two DIFFERENT listIds (as two different conceptIds would derive) never collide, even with the identical title', () => {
  const a = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Day Trips & Big Adventures', creatorId: CREATOR_ID, resolutions: goodResolutions() })
  const b = generateNewListCreationSql({ metroSlug: 'munich', listId: OTHER_LIST_ID, listTitle: 'Day Trips & Big Adventures', creatorId: CREATOR_ID, resolutions: goodResolutions() })
  assert.notEqual(a.sql, b.sql)
  assert.match(a.sql!, new RegExp(LIST_ID))
  assert.match(b.sql!, new RegExp(OTHER_LIST_ID))
  assert.equal(a.sql!.includes(OTHER_LIST_ID), false)
  assert.equal(b.sql!.includes(LIST_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), false)
})

test('generateNewListCreationSql: real Pusser\'s New York Bar / Schumann\'s apostrophes in the TITLE are safely handled via sqlQuote doubling, never dollar-quote mismatched', () => {
  const result = generateNewListCreationSql({
    metroSlug: 'munich',
    listId: LIST_ID,
    listTitle: "Pusser's & Schumann's After Dark",
    creatorId: CREATOR_ID,
    resolutions: goodResolutions(),
  })
  assert.equal(result.ok, true)
  assert.match(result.sql!, /'Pusser''s & Schumann''s After Dark'/, 'apostrophes in the title are doubled, the correct escape for ordinary single-quoted literals')
  assert.equal(result.sql!.includes("Pusser's"), false, 'an UNDOUBLED apostrophe must never appear — that would be the exact quoting-mismatch bug class this module exists to prevent')
})

test('generateNewListCreationSql: an apostrophe in creatorId (a defensive, unrealistic but never-trusted input) is also safely doubled, never breaks the literal', () => {
  const result = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Day Trips & Big Adventures', creatorId: "o'brien-service-account", resolutions: goodResolutions() })
  assert.equal(result.ok, true)
  assert.match(result.sql!, /VALUES \(v_list_id, v_metro_id, 'Day Trips & Big Adventures', true, true, 'o''brien-service-account', false\)/)
})

test('generateNewListCreationSql: an empty resolved set still generates valid, safe SQL — list creation runs, no INSERT into list_items, postflight expects 0', () => {
  const result = generateNewListCreationSql({ metroSlug: 'munich', listId: LIST_ID, listTitle: 'Day Trips & Big Adventures', creatorId: CREATOR_ID, resolutions: [] })
  assert.equal(result.ok, true)
  assert.equal(result.expectedMembershipCount, 0)
  assert.equal(result.sql!.includes('INSERT INTO public.list_items'), false)
  assert.match(result.sql!, /IF v_count <> 0 THEN/)
})

// ---------------------------------------------------------------------------
// generateItemBodyRepairSql — the one legitimate remaining literal-body-text
// use case, modeled on the real Schumann's Bar inline repair.
// ---------------------------------------------------------------------------

test('generateItemBodyRepairSql: real Schumann\'s Bar repair, correctly dollar-quoted and idempotent (previousBody only matches the corrupted form, so a second run is a safe no-op)', () => {
  const sql = generateItemBodyRepairSql({
    mapsQuery: 'Schumann\'s Bar, Odeonsplatz 6-7, 80539 München, Germany',
    correctedBody: "Show up after midnight, when 'Schumann's Bar' says it truly becomes a bar.",
    previousBody: "Show up after midnight, when 'Schumann''s Bar' says it truly becomes a bar.",
  })
  assert.match(sql, /^BEGIN;/)
  assert.match(sql, /COMMIT;$/)
  assert.ok(sql.includes("Schumann's Bar"))
  // The corrected body's dollar-quoted form must not contain a doubled apostrophe.
  const correctedSegment = sql.split('WHERE')[0]!
  assert.equal(/Schumann''s Bar's says/.test(correctedSegment), false)
})
