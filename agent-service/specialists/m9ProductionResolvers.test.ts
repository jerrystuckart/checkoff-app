// agent-service/specialists/m9ProductionResolvers.test.ts
//
// M9 wiring, Session 5 — real, read-only production resolvers behind
// resolveM9ProductionItems/resolveM9ProductionLists/resolveM9DeterministicListIds.
// Every test here uses an injected fake QueryFn (same discipline as
// existingInventoryReadPath.test.ts) — no test in this repo's suite ever
// touches a real database.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchProductionItemsByIds,
  fetchProductionListsByIds,
  resolveM9ProductionItemsReal,
  resolveM9ProductionListsReal,
  resolveM9DeterministicListIdsReal,
  isValidUuid,
  isReadOnlySelectStatement,
  type QueryFn,
} from './m9ProductionResolvers'
import { generateNewListCreationSql, generateListMembershipSql } from '../playbooks/listSqlGeneration'

const ITEM_1 = '11111111-1111-1111-1111-111111111111'
const ITEM_2 = '22222222-2222-2222-2222-222222222222'
const ITEM_INACTIVE = '33333333-3333-3333-3333-333333333333'
const ITEM_OTHER_METRO = '44444444-4444-4444-4444-444444444444'
const LIST_1 = 'a1b2c3d4-e5f6-5a1b-8c2d-3e4f5a6b7c8d'
const LIST_COMPLETED = 'b1b2c3d4-e5f6-5a1b-8c2d-3e4f5a6b7c8e'
const LIST_OTHER_METRO = 'c1b2c3d4-e5f6-5a1b-8c2d-3e4f5a6b7c8f'
const METRO_MUNICH = '99999999-0000-0000-0000-000000000001'
const METRO_DENVER = '99999999-0000-0000-0000-000000000002'

// ---------------------------------------------------------------------------
// isValidUuid / isReadOnlySelectStatement — the two small guards everything
// else here relies on.
// ---------------------------------------------------------------------------

test('isValidUuid: accepts well-formed UUIDs, rejects malformed ones', () => {
  assert.equal(isValidUuid(ITEM_1), true)
  assert.equal(isValidUuid('not-a-uuid'), false)
  assert.equal(isValidUuid(''), false)
  assert.equal(isValidUuid('11111111-1111-1111-1111-11111111111'), false, 'one hex digit short')
  assert.equal(isValidUuid("11111111-1111-1111-1111-11111111111'; DROP TABLE public.items; --"), false)
})

test('isReadOnlySelectStatement: accepts a plain SELECT, rejects write/transactional statements — including the ACTUAL generated new-list SQL', () => {
  assert.equal(isReadOnlySelectStatement('SELECT id FROM public.items WHERE id = ANY($1::uuid[])'), true)
  assert.equal(isReadOnlySelectStatement('INSERT INTO public.items (body) VALUES (1)'), false)
  assert.equal(isReadOnlySelectStatement('UPDATE public.lists SET title = 1'), false)
  assert.equal(isReadOnlySelectStatement('DELETE FROM public.list_items'), false)
  assert.equal(isReadOnlySelectStatement('DROP TABLE public.items'), false)
  assert.equal(isReadOnlySelectStatement('TRUNCATE public.items'), false)

  // The real, actual generated SQL this codebase produces for new-list
  // creation — mechanical proof that the guard genuinely rejects it, not
  // just a hand-written INSERT string.
  const generated = generateNewListCreationSql({
    metroSlug: 'munich',
    listId: LIST_1,
    listTitle: 'Beer Gardens, Breweries & Bavarian Rituals',
    creatorId: '99999999-9999-9999-9999-999999999999',
    resolutions: [{ intendedBody: 'x', sortOrder: 0, matchedItemIds: [ITEM_1] }],
  })
  assert.equal(generated.ok, true)
  assert.equal(isReadOnlySelectStatement(generated.sql!), false, 'the real generated CREATE-list SQL must be rejected by the read-only guard — it is a BEGIN;...INSERT...COMMIT; block, never a SELECT')

  const membership = generateListMembershipSql({ metroSlug: 'munich', listTitle: 'Existing List', resolutions: [{ intendedBody: 'x', sortOrder: 0, matchedItemIds: [ITEM_1] }] })
  assert.equal(isReadOnlySelectStatement(membership.sql!), false, 'the real generated membership SQL must also be rejected — same BEGIN;...COMMIT; shape')
})

// ---------------------------------------------------------------------------
// fetchProductionItemsByIds — the UUID-keyed primitive.
// ---------------------------------------------------------------------------

interface FakeItemRow {
  id: string
  is_active: boolean
  metro_id: string
  google_place_id: string | null
}

function fakeItemsQuery(rows: FakeItemRow[], recorder?: { calls: { text: string; params: unknown[] }[] }): QueryFn {
  return (async (text: string, params: unknown[] = []) => {
    recorder?.calls.push({ text, params })
    const requested = new Set(params[0] as string[])
    return rows.filter((r) => requested.has(r.id)) as unknown[]
  }) as QueryFn
}

test('fetchProductionItemsByIds: successful resolution returns exactly the requested, found records — active and metro preserved', async () => {
  const q = fakeItemsQuery([
    { id: ITEM_1, is_active: true, metro_id: METRO_MUNICH, google_place_id: 'place-1' },
    { id: ITEM_2, is_active: true, metro_id: METRO_MUNICH, google_place_id: 'place-2' },
  ])
  const result = await fetchProductionItemsByIds([ITEM_1, ITEM_2], q)
  assert.equal(result.ok, true)
  assert.equal(result.byId.size, 2)
  assert.deepEqual(result.byId.get(ITEM_1), { itemId: ITEM_1, metroId: METRO_MUNICH, active: true, googlePlaceId: 'place-1' })
})

test('fetchProductionItemsByIds: a requested id the query genuinely does not find is absent from byId — NOT_FOUND, never fabricated', async () => {
  const q = fakeItemsQuery([{ id: ITEM_1, is_active: true, metro_id: METRO_MUNICH, google_place_id: null }])
  const result = await fetchProductionItemsByIds([ITEM_1, ITEM_2], q)
  assert.equal(result.ok, true)
  assert.equal(result.byId.has(ITEM_1), true)
  assert.equal(result.byId.has(ITEM_2), false)
})

test('fetchProductionItemsByIds: an INACTIVE item is returned, not filtered out — active:false is preserved, never silently dropped', async () => {
  const q = fakeItemsQuery([{ id: ITEM_INACTIVE, is_active: false, metro_id: METRO_MUNICH, google_place_id: null }])
  const result = await fetchProductionItemsByIds([ITEM_INACTIVE], q)
  assert.equal(result.byId.get(ITEM_INACTIVE)?.active, false)
})

test('fetchProductionItemsByIds: an item belonging to a DIFFERENT metro is returned with its real metroId, not filtered or rewritten — the caller decides what out-of-metro means', async () => {
  const q = fakeItemsQuery([{ id: ITEM_OTHER_METRO, is_active: true, metro_id: METRO_DENVER, google_place_id: null }])
  const result = await fetchProductionItemsByIds([ITEM_OTHER_METRO], q)
  assert.equal(result.byId.get(ITEM_OTHER_METRO)?.metroId, METRO_DENVER)
})

test('fetchProductionItemsByIds: a malformed UUID is rejected BEFORE querying — never sent to the database, reported separately from NOT_FOUND', async () => {
  const calls: { text: string; params: unknown[] }[] = []
  const recorder = { calls }
  const q = fakeItemsQuery([{ id: ITEM_1, is_active: true, metro_id: METRO_MUNICH, google_place_id: null }], recorder)
  const result = await fetchProductionItemsByIds(['not-a-uuid', ITEM_1], q)
  assert.equal(result.ok, false)
  assert.deepEqual(result.malformedIds, ['not-a-uuid'])
  assert.equal(result.byId.has(ITEM_1), true, 'the one well-formed id alongside it is still resolved normally')
  assert.equal((calls[0]!.params[0] as string[]).includes('not-a-uuid'), false, 'the malformed id must never appear in the actual query parameters sent')
})

test('fetchProductionItemsByIds: duplicate requested ids are de-duplicated before querying — issued exactly once', async () => {
  const calls: { text: string; params: unknown[] }[] = []
  const q = fakeItemsQuery([{ id: ITEM_1, is_active: true, metro_id: METRO_MUNICH, google_place_id: null }], { calls })
  await fetchProductionItemsByIds([ITEM_1, ITEM_1, ITEM_1], q)
  assert.equal((calls[0]!.params[0] as string[]).length, 1, 'the duplicate id must be collapsed to one before the query is built')
})

test('fetchProductionItemsByIds: scopes results to exactly the requested ids — an id never requested is never returned even if the fake DB "has" it', async () => {
  const q = fakeItemsQuery([
    { id: ITEM_1, is_active: true, metro_id: METRO_MUNICH, google_place_id: null },
    { id: ITEM_2, is_active: true, metro_id: METRO_MUNICH, google_place_id: null },
  ])
  const result = await fetchProductionItemsByIds([ITEM_1], q)
  assert.equal(result.byId.has(ITEM_2), false)
})

test('fetchProductionItemsByIds: a genuine query/database failure propagates — NEVER converted into an empty successful result', async () => {
  const q: QueryFn = (async () => {
    throw new Error('connection terminated unexpectedly')
  }) as QueryFn
  await assert.rejects(() => fetchProductionItemsByIds([ITEM_1], q), /connection terminated/)
})

test('fetchProductionItemsByIds: a configured resolver returning PARTIAL results (fewer rows than requested) is handled correctly — found ones resolve, the rest are genuine NOT_FOUND, no crash', async () => {
  const q = fakeItemsQuery([{ id: ITEM_1, is_active: true, metro_id: METRO_MUNICH, google_place_id: null }])
  const result = await fetchProductionItemsByIds([ITEM_1, ITEM_2, ITEM_INACTIVE], q)
  assert.equal(result.ok, true)
  assert.equal(result.byId.size, 1)
  assert.equal(result.byId.has(ITEM_2), false)
  assert.equal(result.byId.has(ITEM_INACTIVE), false)
})

test('fetchProductionItemsByIds: every issued query is a plain read-only SELECT', async () => {
  const calls: { text: string; params: unknown[] }[] = []
  const q = fakeItemsQuery([{ id: ITEM_1, is_active: true, metro_id: METRO_MUNICH, google_place_id: null }], { calls })
  await fetchProductionItemsByIds([ITEM_1], q)
  assert.ok(calls.length > 0)
  for (const call of calls) assert.equal(isReadOnlySelectStatement(call.text), true, `query must be a plain SELECT: ${call.text}`)
})

// ---------------------------------------------------------------------------
// resolveM9ProductionItemsReal — the candidateName-keyed resolver
// MetroDriverDeps.resolveM9ProductionItems actually calls.
// ---------------------------------------------------------------------------

function fakeItemsByBodyQuery(bodyRows: { id: string; body: string }[], idRows: FakeItemRow[]): QueryFn {
  return (async (text: string, params: unknown[] = []) => {
    if (text.includes('i.body = ANY')) {
      const [metroSlug, bodies] = params as [string, string[]]
      return bodyRows.filter((r) => bodies.includes(r.body) && metroSlug === 'munich') as unknown[]
    }
    const requested = new Set(params[0] as string[])
    return idRows.filter((r) => requested.has(r.id)) as unknown[]
  }) as QueryFn
}

test('resolveM9ProductionItemsReal: successful resolution — matches by exact certified body text, scoped to the metro, then verifies active/metro via the shared id-keyed primitive', async () => {
  const bodyByCandidateName = new Map([["Pusser's New York Bar", "Order the Painkiller at 'Pusser's New York Bar'."]])
  const q = fakeItemsByBodyQuery(
    [{ id: ITEM_1, body: "Order the Painkiller at 'Pusser's New York Bar'." }],
    [{ id: ITEM_1, is_active: true, metro_id: METRO_MUNICH, google_place_id: null }]
  )
  const result = await resolveM9ProductionItemsReal({ items: [{ candidateName: "Pusser's New York Bar", conceptId: 'c1' }], metroSlug: 'munich' }, bodyByCandidateName, q)
  assert.deepEqual(result, [{ candidateName: "Pusser's New York Bar", conceptId: 'c1', matchedItemIds: [ITEM_1], active: true, metroId: METRO_MUNICH }])
})

test('resolveM9ProductionItemsReal: a candidate with no certified body on file at all resolves to NOT_FOUND (zero matches), never a guess', async () => {
  const result = await resolveM9ProductionItemsReal({ items: [{ candidateName: 'Unknown Candidate', conceptId: 'c1' }], metroSlug: 'munich' }, new Map(), fakeItemsByBodyQuery([], []))
  assert.deepEqual(result, [{ candidateName: 'Unknown Candidate', conceptId: 'c1', matchedItemIds: [] }])
})

test('resolveM9ProductionItemsReal: a genuine query failure propagates, never silently returns matchedItemIds: []', async () => {
  const bodyByCandidateName = new Map([['X', 'body-x']])
  const q: QueryFn = (async () => {
    throw new Error('timeout')
  }) as QueryFn
  await assert.rejects(() => resolveM9ProductionItemsReal({ items: [{ candidateName: 'X', conceptId: 'c1' }], metroSlug: 'munich' }, bodyByCandidateName, q), /timeout/)
})

// ---------------------------------------------------------------------------
// fetchProductionListsByIds / resolveM9ProductionListsReal / resolveM9DeterministicListIdsReal
// ---------------------------------------------------------------------------

interface FakeListRow {
  id: string
  title: string
  is_official: boolean
  ends_at: string | null
  metro_slug: string
}

function fakeListsQuery(listRows: FakeListRow[], membershipByListId: Record<string, string[]> = {}, byTitle = false): QueryFn {
  return (async (text: string, params: unknown[] = []) => {
    if (text.includes('FROM public.list_items')) {
      const requested = params[0] as string[]
      return requested.flatMap((listId) => (membershipByListId[listId] ?? []).map((itemId) => ({ list_id: listId, item_id: itemId }))) as unknown[]
    }
    if (byTitle && text.includes('l.title = ANY')) {
      const [metroSlug, titles] = params as [string, string[]]
      return listRows.filter((r) => r.metro_slug === metroSlug && titles.includes(r.title)).map((r) => ({ id: r.id, title: r.title })) as unknown[]
    }
    const requested = new Set(params[0] as string[])
    return listRows.filter((r) => requested.has(r.id)) as unknown[]
  }) as QueryFn
}

test('fetchProductionListsByIds: successful resolution — real title, metro, official flag, and derived status', async () => {
  const q = fakeListsQuery([{ id: LIST_1, title: 'After Dark', is_official: true, ends_at: null, metro_slug: 'munich' }])
  const result = await fetchProductionListsByIds([LIST_1], q)
  assert.equal(result.ok, true)
  assert.deepEqual(result.byId.get(LIST_1), { listId: LIST_1, metroSlug: 'munich', title: 'After Dark', isOfficial: true, status: 'ACTIVE', memberItemIds: [] })
})

test('fetchProductionListsByIds: a list whose ends_at is in the past is derived as COMPLETED; one still in the future (or absent) is ACTIVE', async () => {
  const q = fakeListsQuery([
    { id: LIST_COMPLETED, title: 'Summer 2020', is_official: true, ends_at: '2020-01-01T00:00:00.000Z', metro_slug: 'munich' },
    { id: LIST_1, title: 'After Dark', is_official: true, ends_at: null, metro_slug: 'munich' },
  ])
  const result = await fetchProductionListsByIds([LIST_COMPLETED, LIST_1], q, () => '2026-09-17T00:00:00.000Z')
  assert.equal(result.byId.get(LIST_COMPLETED)?.status, 'COMPLETED')
  assert.equal(result.byId.get(LIST_1)?.status, 'ACTIVE')
})

test('fetchProductionListsByIds: a missing list is absent from byId — genuine NOT_FOUND', async () => {
  const q = fakeListsQuery([])
  const result = await fetchProductionListsByIds([LIST_1], q)
  assert.equal(result.byId.has(LIST_1), false)
})

test('fetchProductionListsByIds: an existing list in an UNRELATED metro is returned with its real metroSlug, never filtered/rewritten', async () => {
  const q = fakeListsQuery([{ id: LIST_OTHER_METRO, title: 'Denver Only List', is_official: true, ends_at: null, metro_slug: 'denver' }])
  const result = await fetchProductionListsByIds([LIST_OTHER_METRO], q)
  assert.equal(result.byId.get(LIST_OTHER_METRO)?.metroSlug, 'denver')
})

test('fetchProductionListsByIds: a malformed list UUID is rejected before querying', async () => {
  const q = fakeListsQuery([{ id: LIST_1, title: 'After Dark', is_official: true, ends_at: null, metro_slug: 'munich' }])
  const result = await fetchProductionListsByIds(['not-a-uuid', LIST_1], q)
  assert.equal(result.ok, false)
  assert.deepEqual(result.malformedIds, ['not-a-uuid'])
})

test('fetchProductionListsByIds: duplicate requested ids are de-duplicated', async () => {
  const calls: unknown[][] = []
  const base = fakeListsQuery([{ id: LIST_1, title: 'After Dark', is_official: true, ends_at: null, metro_slug: 'munich' }])
  const q: QueryFn = (async (text, params = []) => {
    if (text.includes('FROM public.lists')) calls.push(params)
    return base(text, params)
  }) as QueryFn
  await fetchProductionListsByIds([LIST_1, LIST_1], q)
  assert.equal((calls[0]![0] as string[]).length, 1)
})

test('fetchProductionListsByIds: current membership UUIDs are returned when the list has members', async () => {
  const q = fakeListsQuery([{ id: LIST_1, title: 'After Dark', is_official: true, ends_at: null, metro_slug: 'munich' }], { [LIST_1]: [ITEM_1, ITEM_2] })
  const result = await fetchProductionListsByIds([LIST_1], q)
  assert.deepEqual([...result.byId.get(LIST_1)!.memberItemIds].sort(), [ITEM_1, ITEM_2].sort())
})

test('fetchProductionListsByIds: a genuine query failure propagates, never an empty success', async () => {
  const q: QueryFn = (async () => {
    throw new Error('permission denied for table lists')
  }) as QueryFn
  await assert.rejects(() => fetchProductionListsByIds([LIST_1], q), /permission denied/)
})

test('fetchProductionListsByIds: every issued query is a plain read-only SELECT', async () => {
  const calls: { text: string }[] = []
  const base = fakeListsQuery([{ id: LIST_1, title: 'After Dark', is_official: true, ends_at: null, metro_slug: 'munich' }], { [LIST_1]: [ITEM_1] })
  const q: QueryFn = (async (text, params = []) => {
    calls.push({ text })
    return base(text, params)
  }) as QueryFn
  await fetchProductionListsByIds([LIST_1], q)
  for (const call of calls) assert.equal(isReadOnlySelectStatement(call.text), true, `query must be read-only: ${call.text}`)
})

test('resolveM9ProductionListsReal: successful title-based resolution (REUSE-vs-CREATE routing input)', async () => {
  const q = fakeListsQuery([{ id: LIST_1, title: 'After Dark', is_official: true, ends_at: null, metro_slug: 'munich' }], {}, true)
  const result = await resolveM9ProductionListsReal({ concepts: [{ conceptId: 'c1', proposedTitle: 'After Dark' }], metroSlug: 'munich' }, q)
  assert.deepEqual(result, [{ conceptId: 'c1', existingList: { listId: LIST_1, title: 'After Dark', status: 'ACTIVE', memberItemIds: [] } }])
})

test('resolveM9ProductionListsReal: a genuinely new concept (no title match) resolves to existingList: null', async () => {
  const q = fakeListsQuery([], {}, true)
  const result = await resolveM9ProductionListsReal({ concepts: [{ conceptId: 'c1', proposedTitle: 'Beer Gardens, Breweries & Bavarian Rituals' }], metroSlug: 'munich' }, q)
  assert.deepEqual(result, [{ conceptId: 'c1', existingList: null }])
})

// ---------------------------------------------------------------------------
// resolveM9DeterministicListIdsReal — the deterministic-UUID conflict check.
// ---------------------------------------------------------------------------

test('resolveM9DeterministicListIdsReal: existing deterministic UUID in the CORRECT metro resolves to the real row — safe to reconcile', async () => {
  const q = fakeListsQuery([{ id: LIST_1, title: 'Beer Gardens, Breweries & Bavarian Rituals', is_official: true, ends_at: null, metro_slug: 'munich' }])
  const result = await resolveM9DeterministicListIdsReal({ concepts: [{ conceptId: 'c1', listId: LIST_1 }], metroSlug: 'munich' }, q)
  assert.deepEqual(result, [{ conceptId: 'c1', existingRowAtId: { metroSlug: 'munich', title: 'Beer Gardens, Breweries & Bavarian Rituals', isOfficial: true } }])
})

test('resolveM9DeterministicListIdsReal: existing deterministic UUID in the WRONG metro is reported exactly as found — the CALLER (buildM9SafeSqlPlan) is what blocks, this resolver just reports real facts', async () => {
  const q = fakeListsQuery([{ id: LIST_1, title: 'Some Denver List', is_official: true, ends_at: null, metro_slug: 'denver' }])
  const result = await resolveM9DeterministicListIdsReal({ concepts: [{ conceptId: 'c1', listId: LIST_1 }], metroSlug: 'munich' }, q)
  assert.deepEqual(result, [{ conceptId: 'c1', existingRowAtId: { metroSlug: 'denver', title: 'Some Denver List', isOfficial: true } }])
})

test('resolveM9DeterministicListIdsReal: no existing row at the deterministic id resolves to null — the ordinary, expected case for a genuinely new concept', async () => {
  const q = fakeListsQuery([])
  const result = await resolveM9DeterministicListIdsReal({ concepts: [{ conceptId: 'c1', listId: LIST_1 }], metroSlug: 'munich' }, q)
  assert.deepEqual(result, [{ conceptId: 'c1', existingRowAtId: null }])
})

test('resolveM9DeterministicListIdsReal: a genuine query failure propagates, never silently reports "not found"', async () => {
  const q: QueryFn = (async () => {
    throw new Error('connection reset')
  }) as QueryFn
  await assert.rejects(() => resolveM9DeterministicListIdsReal({ concepts: [{ conceptId: 'c1', listId: LIST_1 }], metroSlug: 'munich' }, q), /connection reset/)
})
