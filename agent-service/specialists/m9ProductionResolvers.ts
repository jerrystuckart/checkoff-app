// agent-service/specialists/m9ProductionResolvers.ts
//
// M9 wiring, Session 5 — the real, read-only production resolvers behind
// MetroDriverDeps.resolveM9ProductionItems / resolveM9ProductionLists /
// resolveM9DeterministicListIds, which have defaulted to "resolve nothing"
// since Session 3. Same conventions as the two existing real read paths in
// this directory (homeListReadPath.ts, existingInventoryReadPath.ts):
//   - imports `query` from '../db' (the ONE Postgres client this codebase
//     uses for agent_service reads — a raw `pg.Pool`, never supabase-js;
//     see db.ts's own header doc for why). No second client is introduced.
//   - every exported function takes an injectable `queryFn: QueryFn = realQuery`
//     as its last parameter, so tests can supply a fake without touching a
//     live database, while production leaves it as the real default.
//   - a genuine query failure is NEVER caught and converted into an empty
//     result — it propagates (throws), exactly like existingInventoryReadPath.ts's
//     functions and db.ts's own `query()`. This is deliberate: every
//     contract this module fills (M9ReusedItemResolution[],
//     M9ExistingListLookup[], M9DeterministicListIdLookup[]) is a plain
//     array with no top-level {failed,reason} slot, and `matchedItemIds: []`
//     / `existingList: null` / `existingRowAtId: null` already mean a real,
//     legitimate "not found" — silently reusing that same shape for "the
//     query broke" would make a system failure indistinguishable from an
//     honest negative result, which is exactly what the task requires
//     never happens. A caller (metroLaunchDriver.ts) that awaits these
//     without a try/catch (matching the existing fetchExistingProductionInventoryForReconciliation
//     call site's own convention) simply lets the exception stop the run
//     before any SQL is generated — "stop before executable SQL" by the
//     same mechanism already established for infra failures in this
//     codebase, not a new one.
//
// SCHEMA CAVEAT (read before extending): `public.lists` has NO `status`/
// `is_active`/`is_completed` column in any migration or the live schema
// audit (docs/metro-launch-audit/01_current_schema_and_relationships.md) —
// confirmed by homeListReadPath.ts's own real query, which never selects
// one. "ACTIVE" vs "COMPLETED" is therefore DERIVED here from the two real
// columns that exist (`starts_at`/`ends_at`, already read by
// homeListReadPath.ts): a list whose `ends_at` is in the past is treated
// as COMPLETED, everything else (including no end date at all) as ACTIVE.
// This is a real, transparent business-rule derivation over confirmed real
// columns, not an invented schema field — but it IS a judgment call, not a
// literal database fact, and is called out here explicitly rather than
// silently baked in. Similarly, there is no dedicated "canonical venue" or
// "duplicate identity" column on `public.items` — venue identity for the
// item resolver is the certified item's own body text (the same exact-match
// discipline LEGACY's buildHomeListSqlPatch and existingInventoryReadPath.ts
// already use), scoped by metro.

import { query as realQuery } from '../db'
import type { QueryResultRow } from 'pg'
import type { M9ReusedItemResolution } from './m9ReusedItemValidation'
import type { M9ExistingListLookup } from './m9CompletedListResolution'
import type { M9DeterministicListIdLookup } from './m9SafeSqlIntegration'

export type QueryFn = <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<T[]>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(s: string): boolean {
  return UUID_PATTERN.test(s)
}

// ---------------------------------------------------------------------------
// Read-only guard — a keyword-based static check, never itself a substitute
// for db.ts's real, DB-level `SET default_transaction_read_only = on`
// enforcement (that remains the actual backstop). This exists so this
// module's own tests can assert, directly and mechanically, that (a) every
// query string these resolvers actually issue is a plain SELECT, and (b)
// the guard itself genuinely rejects the kind of statement it's meant to —
// specifically listSqlGeneration.ts's own generated new-list/membership SQL
// (a `BEGIN; ... INSERT/DELETE ... COMMIT;` block Jerry runs manually), so
// there is a mechanical, testable proof that this module's read-only
// resolvers and that generated, write-shaped SQL are never the same thing.
// ---------------------------------------------------------------------------

const FORBIDDEN_STATEMENT_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'BEGIN', 'COMMIT', 'GRANT', 'REVOKE'] as const

export function isReadOnlySelectStatement(sql: string): boolean {
  const normalized = sql.toUpperCase()
  if (!/^\s*SELECT\b/.test(normalized)) return false
  return !FORBIDDEN_STATEMENT_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`).test(normalized))
}

// ---------------------------------------------------------------------------
// Item resolution — UUID-keyed primitive first (bullet 1's own framing:
// "accepts the requested item UUIDs"), then the candidateName-keyed
// resolver MetroDriverDeps actually calls, built ON TOP of the primitive.
// ---------------------------------------------------------------------------

export interface ProductionItemRecord {
  itemId: string
  /** The real metro_areas.id this item currently belongs to (joined through neighborhoods — public.items has no direct metro_id column). */
  metroId: string
  active: boolean
  /** The item's real, confirmed venue-identity field — public.items has no "canonical venue"/"duplicate identity" column; google_place_id is the one real identity field this codebase's own venue-dedup logic (candidateMerge.ts) already keys off. Null when the item genuinely has none on file. */
  googlePlaceId: string | null
}

export interface FetchProductionItemsByIdsResult {
  /** True only when every requested id was well-formed — a malformed id never silently drops out unnoticed. */
  ok: boolean
  /** itemId -> record, present ONLY for well-formed ids the query actually found. A well-formed id absent here is a genuine NOT_FOUND, never conflated with a malformed one. */
  byId: ReadonlyMap<string, ProductionItemRecord>
  /** Requested ids that were not well-formed UUIDs — never sent to the database at all. */
  malformedIds: readonly string[]
}

interface RealItemByIdRow {
  id: string
  is_active: boolean
  metro_id: string
  google_place_id: string | null
}

/**
 * The real, UUID-keyed production item fetch. Validates and deduplicates
 * requested ids BEFORE querying (malformed ids are rejected outright, never
 * sent to Postgres), scopes the query to exactly the requested ids
 * (`WHERE i.id = ANY($1::uuid[])` — no other row can ever be returned), and
 * preserves both active and inactive rows (never filters out an inactive
 * item — the caller decides what an inactive result means).
 */
export async function fetchProductionItemsByIds(itemIds: readonly string[], queryFn: QueryFn = realQuery): Promise<FetchProductionItemsByIdsResult> {
  const malformedIds = itemIds.filter((id) => !isValidUuid(id))
  const validIds = [...new Set(itemIds.filter(isValidUuid))]
  const byId = new Map<string, ProductionItemRecord>()
  if (validIds.length > 0) {
    const rows = await queryFn<RealItemByIdRow>(
      `SELECT i.id, i.is_active, n.metro_id, i.google_place_id
       FROM public.items i
       JOIN public.neighborhoods n ON n.id = i.neighborhood_id
       WHERE i.id = ANY($1::uuid[])`,
      [validIds]
    )
    for (const r of rows) byId.set(r.id, { itemId: r.id, metroId: r.metro_id, active: r.is_active, googlePlaceId: r.google_place_id })
  }
  return { ok: malformedIds.length === 0, byId, malformedIds }
}

export interface ResolveM9ProductionItemsRealInput {
  items: readonly { candidateName: string; conceptId: string }[]
  metroSlug: string
}

interface RealItemByBodyRow {
  id: string
  body: string
}

/**
 * The real implementation behind MetroDriverDeps.resolveM9ProductionItems.
 * candidateName is never itself a stable production identity (two
 * candidates can share a name across metros/runs) — the real identity
 * mechanism, matching LEGACY's own buildHomeListSqlPatch and
 * existingInventoryReadPath.ts, is the certified item's own EXACT body
 * text, scoped to the metro. `itemBodyByCandidateName` is the SAME map the
 * driver already builds from this run's own certified items (never a
 * second, independently-derived source) — the caller (metroLaunchDriver.ts)
 * supplies it via closure at the wiring site.
 *
 * Composes fetchProductionItemsByIds for the actual active/metro
 * verification of whatever ids the body match finds — one real, shared
 * "given ids, tell me their real state" primitive, not two independently
 * maintained queries.
 */
export async function resolveM9ProductionItemsReal(
  input: ResolveM9ProductionItemsRealInput,
  itemBodyByCandidateName: ReadonlyMap<string, string>,
  queryFn: QueryFn = realQuery
): Promise<M9ReusedItemResolution[]> {
  const bodiesNeeded = [...new Set(input.items.map((it) => itemBodyByCandidateName.get(it.candidateName)).filter((b): b is string => typeof b === 'string' && b.length > 0))]
  const idsByBody = new Map<string, string[]>()
  if (bodiesNeeded.length > 0) {
    const rows = await queryFn<RealItemByBodyRow>(
      `SELECT i.id, i.body
       FROM public.items i
       JOIN public.neighborhoods n ON n.id = i.neighborhood_id
       JOIN public.metro_areas m ON m.id = n.metro_id
       WHERE m.slug = $1 AND i.body = ANY($2::text[])`,
      [input.metroSlug, bodiesNeeded]
    )
    for (const r of rows) idsByBody.set(r.body, [...(idsByBody.get(r.body) ?? []), r.id])
  }
  const allMatchedIds = [...new Set([...idsByBody.values()].flat())]
  const fetched = await fetchProductionItemsByIds(allMatchedIds, queryFn)

  return input.items.map((item) => {
    const body = itemBodyByCandidateName.get(item.candidateName)
    if (!body) return { candidateName: item.candidateName, conceptId: item.conceptId, matchedItemIds: [] }
    const matchedItemIds = idsByBody.get(body) ?? []
    const single = matchedItemIds.length === 1 ? fetched.byId.get(matchedItemIds[0]!) : undefined
    return { candidateName: item.candidateName, conceptId: item.conceptId, matchedItemIds, active: single?.active, metroId: single?.metroId }
  })
}

// ---------------------------------------------------------------------------
// List resolution — the title-keyed REUSE-vs-CREATE lookup
// (resolveM9ProductionLists) and the UUID-keyed deterministic-id conflict
// check (resolveM9DeterministicListIds), both built on one shared
// UUID-keyed list-fetch primitive.
// ---------------------------------------------------------------------------

export interface ProductionListRecord {
  listId: string
  metroSlug: string
  title: string
  isOfficial: boolean
  /** Derived, not a raw column — see this module's own header doc. */
  status: 'ACTIVE' | 'COMPLETED'
  memberItemIds: readonly string[]
}

interface RealListByIdRow {
  id: string
  title: string
  is_official: boolean
  ends_at: string | null
  metro_slug: string
}

function deriveListStatus(endsAt: string | null, nowIso: string): 'ACTIVE' | 'COMPLETED' {
  if (!endsAt) return 'ACTIVE'
  return Date.parse(endsAt) < Date.parse(nowIso) ? 'COMPLETED' : 'ACTIVE'
}

async function fetchListMembershipByIds(listIds: readonly string[], queryFn: QueryFn): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (listIds.length === 0) return result
  const rows = await queryFn<{ list_id: string; item_id: string }>(`SELECT list_id, item_id FROM public.list_items WHERE list_id = ANY($1::uuid[])`, [listIds])
  for (const r of rows) result.set(r.list_id, [...(result.get(r.list_id) ?? []), r.item_id])
  return result
}

export interface FetchProductionListsByIdsResult {
  ok: boolean
  byId: ReadonlyMap<string, ProductionListRecord>
  malformedIds: readonly string[]
}

/**
 * The real, UUID-keyed production list fetch — the shared primitive behind
 * both resolveM9ProductionListsReal (via id, once titles resolve to one)
 * and resolveM9DeterministicListIdsReal (directly, since its input IS
 * already the deterministic UUID). Same discipline as
 * fetchProductionItemsByIds: malformed ids rejected before querying,
 * deduplicated, scoped strictly to the requested ids.
 */
export async function fetchProductionListsByIds(listIds: readonly string[], queryFn: QueryFn = realQuery, now: () => string = () => new Date().toISOString()): Promise<FetchProductionListsByIdsResult> {
  const malformedIds = listIds.filter((id) => !isValidUuid(id))
  const validIds = [...new Set(listIds.filter(isValidUuid))]
  const byId = new Map<string, ProductionListRecord>()
  if (validIds.length > 0) {
    const rows = await queryFn<RealListByIdRow>(
      `SELECT l.id, l.title, l.is_official, l.ends_at::text, m.slug AS metro_slug
       FROM public.lists l
       JOIN public.metro_areas m ON m.id = l.metro_id
       WHERE l.id = ANY($1::uuid[])`,
      [validIds]
    )
    const membershipByListId = await fetchListMembershipByIds(
      rows.map((r) => r.id),
      queryFn
    )
    const nowIso = now()
    for (const r of rows) {
      byId.set(r.id, {
        listId: r.id,
        metroSlug: r.metro_slug,
        title: r.title,
        isOfficial: r.is_official,
        status: deriveListStatus(r.ends_at, nowIso),
        memberItemIds: membershipByListId.get(r.id) ?? [],
      })
    }
  }
  return { ok: malformedIds.length === 0, byId, malformedIds }
}

export interface ResolveM9ProductionListsRealInput {
  concepts: readonly { conceptId: string; proposedTitle: string }[]
  metroSlug: string
}

interface RealListByTitleRow {
  id: string
  title: string
}

/**
 * The real implementation behind MetroDriverDeps.resolveM9ProductionLists —
 * "does a production list already exist under this concept's proposed
 * title, in this metro?" Title is the only identity available for this
 * specific question (a genuinely new concept has no UUID yet to look up by
 * — that's exactly the question this resolver answers). This is a
 * DIFFERENT, pre-existing concern from new-list creation's own identity
 * (computeM9ListId/resolveM9DeterministicListIdsReal below), which never
 * uses title as identity — see m9SafeSqlIntegration.ts's own doc for why
 * both exist side by side.
 */
export async function resolveM9ProductionListsReal(input: ResolveM9ProductionListsRealInput, queryFn: QueryFn = realQuery, now: () => string = () => new Date().toISOString()): Promise<M9ExistingListLookup[]> {
  const titles = [...new Set(input.concepts.map((c) => c.proposedTitle))]
  const rows =
    titles.length > 0
      ? await queryFn<RealListByTitleRow>(
          `SELECT l.id, l.title
           FROM public.lists l
           JOIN public.metro_areas m ON m.id = l.metro_id
           WHERE m.slug = $1 AND l.title = ANY($2::text[])`,
          [input.metroSlug, titles]
        )
      : []
  const idByTitle = new Map(rows.map((r) => [r.title, r.id]))
  const fetched = await fetchProductionListsByIds([...new Set(rows.map((r) => r.id))], queryFn, now)

  return input.concepts.map((c) => {
    const listId = idByTitle.get(c.proposedTitle)
    if (!listId) return { conceptId: c.conceptId, existingList: null }
    const real = fetched.byId.get(listId)
    if (!real) return { conceptId: c.conceptId, existingList: null }
    return { conceptId: c.conceptId, existingList: { listId: real.listId, title: real.title, status: real.status, memberItemIds: real.memberItemIds } }
  })
}

export interface ResolveM9DeterministicListIdsRealInput {
  concepts: readonly { conceptId: string; listId: string }[]
  metroSlug: string
}

/**
 * The real implementation behind MetroDriverDeps.resolveM9DeterministicListIds
 * — "does a production list already exist at this concept's OWN
 * deterministic UUID (computeM9ListId(conceptId))?" Directly UUID-keyed
 * (the caller always supplies a real computeM9ListId output, never a
 * user-typed value), so a malformed id here is a genuine internal bug —
 * this throws rather than silently reporting "not found" for it, which
 * would let m9SafeSqlIntegration.ts's own conflict gate wrongly treat a
 * broken identity computation as a clear id.
 */
export async function resolveM9DeterministicListIdsReal(input: ResolveM9DeterministicListIdsRealInput, queryFn: QueryFn = realQuery, now: () => string = () => new Date().toISOString()): Promise<M9DeterministicListIdLookup[]> {
  const listIds = input.concepts.map((c) => c.listId)
  const fetched = await fetchProductionListsByIds(listIds, queryFn, now)
  if (!fetched.ok) {
    throw new Error(`resolveM9DeterministicListIdsReal: received malformed deterministic list id(s), which should be structurally impossible (every listId must be a real computeM9ListId output): ${fetched.malformedIds.join(', ')}`)
  }
  return input.concepts.map((c) => {
    const real = fetched.byId.get(c.listId)
    if (!real) return { conceptId: c.conceptId, existingRowAtId: null }
    return { conceptId: c.conceptId, existingRowAtId: { metroSlug: real.metroSlug, title: real.title, isOfficial: real.isOfficial } }
  })
}
