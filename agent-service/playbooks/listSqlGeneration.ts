// agent-service/playbooks/listSqlGeneration.ts
//
// Safe list-membership SQL generation — Munich calibration Phase 4 (commit
// 4/7). Pure, no I/O, never executes anything itself. Implements the
// safeguards validated in
// docs/metro-launch-audit/munich/calibration-analysis/13-list-sql-generation-safeguards.md
// against the REAL, already-executed `munich_lists_rebuild_no_temp_tables.sql`
// — that file worked (zero discrepancy found in production), but its own
// analysis names one systemic risk running through all 138 of its item
// resolutions: EVERY one was done by exact `body = '...'` text match, never
// by a stable production UUID, which is a live liability on any future
// rerun after even a small body edit (a catalog-voice pass, a
// de-duplication merge, an item correction).
//
// The fix this module encodes: resolve every item to its production UUID
// ONCE (the caller's own one-time body-match preflight query — this module
// never invents or guesses a resolution, it only VALIDATES one the caller
// supplies), then generate membership SQL keyed ONLY by that UUID — never
// re-deriving a body-text match as the operational mechanism inside the
// generated SQL itself. A UUID literal has no escaping hazard at all, which
// also structurally eliminates the apostrophe/dollar-quoting failure class
// documented below for MEMBERSHIP sql; a SEPARATE, correctly-dollar-quoted
// helper is provided for the one operation that legitimately still needs to
// write literal body text (an item body repair).

// ---------------------------------------------------------------------------
// Quoting — the two REAL failure classes from 13-list-sql-generation-safeguards.md,
// encoded as two deliberately different, non-interchangeable functions so a
// future caller can never apply the wrong style's escaping rule to the
// other's quoting mechanism (the exact mistake that corrupted Schumann's Bar
// in production: an ordinary `'...'`-literal's doubled-apostrophe escape
// applied to text that was actually going inside `$tag$...$tag$`
// dollar-quoting, where doubling produces two literal apostrophes instead of
// one).
// ---------------------------------------------------------------------------

/**
 * Ordinary SQL single-quoted string literal — apostrophes doubled, the
 * correct (and ONLY correct) escape for THIS quoting style. Mirrors
 * metroLaunchDriver.ts's own private `sqlQuote` helper exactly (same
 * algorithm) — that function lives in specialists/, which this playbooks/
 * module cannot import from (this codebase's own established one-way
 * specialists -> playbooks dependency direction), so the identical,
 * well-understood one-line algorithm is reproduced here rather than
 * reinvented differently.
 */
export function sqlQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * Dollar-quoted SQL string literal — apostrophes NEVER doubled; everything
 * between the two identical `$tag$` markers is completely literal. Picks a
 * tag that does not itself occur as `$tag$` inside the text (vanishingly
 * unlikely for real CheckOff body text, but checked rather than assumed) so
 * the literal can never be prematurely closed.
 */
export function sqlDollarQuote(text: string, preferredTag = 'b'): string {
  let tag = preferredTag
  let n = 0
  while (text.includes(`$${tag}$`)) {
    n += 1
    tag = `${preferredTag}${n}`
  }
  return `$${tag}$${text}$${tag}$`
}

// ---------------------------------------------------------------------------
// Preflight resolution — "exactly-one-resolved-record-per-intended-membership"
// and "preflight completion required before any delete/replace." The
// ACTUAL body-match (or Place-ID-match, or any other resolution mechanism)
// query is the caller's own responsibility (a real DB read this pure module
// cannot perform) — this function only validates the caller's resolution
// result and fails CLOSED, before generating any mutating SQL, on either a
// zero-match or a multi-match row. This is the same two-sided
// `HAVING count(i.id) <> 1` discipline the real, analyzed
// munich_lists_rebuild_no_temp_tables.sql already used correctly in its own
// preflight — this module keeps that discipline but moves the resolution
// itself out of repeated, fragile body-text SQL and into a one-time
// TypeScript-side step.
// ---------------------------------------------------------------------------

export interface ListSqlItemResolution {
  /** The intended membership's identifying text — typically the certified item body, exactly as a one-time preflight query matched it. Never re-used as the SQL's own resolution mechanism (see generateListMembershipSql). */
  intendedBody: string
  sortOrder: number
  /** Every production item id the caller's own one-time resolution query found for this intended membership. Zero -> not found; 2+ -> ambiguous. Both fail preflight closed. */
  matchedItemIds: readonly string[]
}

export interface ListSqlPreflightResult {
  ok: boolean
  resolved: { itemId: string; sortOrder: number; intendedBody: string }[]
  errors: string[]
}

export function resolveListItemsPreflight(resolutions: readonly ListSqlItemResolution[]): ListSqlPreflightResult {
  const errors: string[] = []
  const resolved: { itemId: string; sortOrder: number; intendedBody: string }[] = []
  for (const r of resolutions) {
    if (r.matchedItemIds.length === 0) {
      errors.push(`[matches=0] "${r.intendedBody}" — no production item resolved this intended membership; preflight fails closed before any mutation.`)
    } else if (r.matchedItemIds.length > 1) {
      errors.push(`[matches=${r.matchedItemIds.length}] "${r.intendedBody}" — ambiguous, more than one production item resolved this intended membership; preflight fails closed before any mutation.`)
    } else {
      resolved.push({ itemId: r.matchedItemIds[0]!, sortOrder: r.sortOrder, intendedBody: r.intendedBody })
    }
  }
  return { ok: errors.length === 0, resolved: errors.length === 0 ? resolved : [], errors }
}

// ---------------------------------------------------------------------------
// Membership SQL generation — UUID-keyed throughout, never a temp table
// (this module has no cross-execution state at all — every value needed is
// either a literal or resolved once in TypeScript before any SQL string is
// built), transactional (one BEGIN...COMMIT), preflight-before-mutation,
// postflight-count-verified, `ON CONFLICT (list_id, item_id) DO NOTHING`
// for duplicate-membership prevention (matching and confirmed sufficient
// against the real analyzed SQL's own design — a full replace-then-insert
// per list, so ON CONFLICT only needs to guard within-statement repeats,
// which the explicit de-dup below also independently prevents), and scoped
// by metro_id + list title so no other metro or list can ever be touched.
// ---------------------------------------------------------------------------

export interface ListSqlGenerationInput {
  metroSlug: string
  listTitle: string
  resolutions: readonly ListSqlItemResolution[]
}

export interface ListSqlGenerationResult {
  ok: boolean
  sql: string | null
  errors: string[]
  /** How many distinct production item ids the generated SQL will link — after de-duplication, even if the same item id somehow resolved from two different intended-membership rows. */
  expectedMembershipCount: number
}

export function generateListMembershipSql(input: ListSqlGenerationInput): ListSqlGenerationResult {
  const preflight = resolveListItemsPreflight(input.resolutions)
  if (!preflight.ok) {
    return {
      ok: false,
      sql: null,
      errors: [`Preflight failed for list "${input.listTitle}" — item resolution must be complete (exactly one match per intended membership) before ANY delete/replace is generated:`, ...preflight.errors],
      expectedMembershipCount: 0,
    }
  }

  // De-duplicate by item id — defense in depth alongside ON CONFLICT, and
  // the only way a genuinely duplicate resolution (two intended-membership
  // rows resolving to the same real item) never produces two VALUES rows
  // for one (list_id, item_id) pair in the first place.
  const seen = new Set<string>()
  const deduped = preflight.resolved.filter((r) => {
    if (seen.has(r.itemId)) return false
    seen.add(r.itemId)
    return true
  })
  const ordered = [...deduped].sort((a, b) => a.sortOrder - b.sortOrder)

  const lines: string[] = []
  lines.push('BEGIN;')
  lines.push('DO $$')
  lines.push('DECLARE')
  lines.push('  v_metro_id uuid;')
  lines.push('  v_list_id uuid;')
  lines.push('  v_count integer;')
  lines.push('BEGIN')
  lines.push(`  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = ${sqlQuote(input.metroSlug)};`)
  lines.push(`  IF v_metro_id IS NULL THEN RAISE EXCEPTION 'metro_areas row for slug % not found', ${sqlQuote(input.metroSlug)}; END IF;`)
  lines.push(`  SELECT id INTO v_list_id FROM public.lists WHERE metro_id = v_metro_id AND title = ${sqlQuote(input.listTitle)} LIMIT 1;`)
  lines.push(`  IF v_list_id IS NULL THEN RAISE EXCEPTION 'lists row for title % (metro %) not found', ${sqlQuote(input.listTitle)}, ${sqlQuote(input.metroSlug)}; END IF;`)
  lines.push('  DELETE FROM public.list_items WHERE list_id = v_list_id;')
  if (ordered.length > 0) {
    lines.push('  INSERT INTO public.list_items (list_id, item_id)')
    const values = ordered.map((r) => `    (v_list_id, ${sqlQuote(r.itemId)}::uuid)`).join(',\n')
    lines.push('  VALUES')
    lines.push(values)
    lines.push('  ON CONFLICT (list_id, item_id) DO NOTHING;')
  }
  lines.push('  SELECT count(*) INTO v_count FROM public.list_items WHERE list_id = v_list_id;')
  lines.push(`  IF v_count <> ${ordered.length} THEN RAISE EXCEPTION 'postflight: expected % membership(s) for list %, found %', ${ordered.length}, ${sqlQuote(input.listTitle)}, v_count; END IF;`)
  lines.push('END $$;')
  lines.push('COMMIT;')

  return { ok: true, sql: lines.join('\n'), errors: [], expectedMembershipCount: ordered.length }
}

// ---------------------------------------------------------------------------
// New-list creation — M9 ENFORCED, Session 4 (corrected). UUID-keyed
// throughout, same discipline as generateListMembershipSql
// (preflight-before-mutation, postflight-count-verified, ON CONFLICT DO
// NOTHING, one BEGIN...COMMIT), with ONE addition: an idempotent "create
// the list row if it doesn't already exist" step ahead of membership
// linking.
//
// IDENTITY CORRECTION (read before changing): the first cut of this
// function used a `(metro_id, title)` natural-key lookup as its
// idempotency mechanism — this was rejected: title is mutable
// presentation text (an operator can rename a list), so a rename could
// silently create a SECOND list, and two unrelated concepts proposing the
// same title could collide. The caller (m9SafeSqlIntegration.ts) now
// derives `listId` deterministically from the concept's own durable
// conceptId (m9EnforcedTypes.ts's computeM9ListId, RFC 4122 UUIDv5) BEFORE
// calling this function — this module never derives, guesses, or looks up
// an identity itself; `listId` is a plain, already-decided input, exactly
// like `resolutions[].matchedItemIds`. The generated SQL uses that exact
// id as the row's real, explicit primary key (`INSERT INTO public.lists
// (id, ...) VALUES ($listId, ...)`) — no schema change is required for
// this: `public.lists.id` is an ordinary insertable uuid primary key
// column (Postgres only auto-generates it when the INSERT omits it), so
// supplying it explicitly is standard, unprivileged SQL.
//
// Idempotency/atomicity: `ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title`
// means the SAME conceptId (hence the SAME listId) always converges to
// ONE row — a rerun with an unchanged title is a no-op update; a rerun
// after an approved title change (still the SAME conceptId) updates the
// title IN PLACE, never creating a second row; this happens ONLY through
// this function's own generated SQL (i.e. only through a fresh, gated
// buildM9SafeSqlPlan call), never as an out-of-band raw title edit — the
// "explicit approved path" the correction requires. An UNRELATED-metro
// conflict (the deterministic id already belongs to a different metro's
// list — astronomically unlikely for UUIDv5, but checked, never assumed)
// RAISE EXCEPTIONs inside the transaction as defense in depth; the
// caller's own TypeScript-level check (m9SafeSqlIntegration.ts's
// deterministicListIdLookups) is the PRIMARY gate that refuses to even
// generate this SQL for that case — see its own doc for why both layers
// exist. No temp table. Title/creatorId both go through sqlQuote so
// apostrophes are always safely doubled-escaped, never a dollar-quoting
// mismatch.
//
// SCOPE: never creates a public.items row (member ids are always
// caller-resolved, pre-existing production UUIDs, exactly like
// generateListMembershipSql) and never touches any list other than the
// single row at `listId` — every DELETE/INSERT below is scoped to
// v_list_id, which can only ever be that one row.
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface NewListCreationSqlInput {
  metroSlug: string
  /** The list's real, durable primary-key identity — a deterministic UUID the caller derived from the concept's own conceptId (never title, never this module's own guess). Must already be a well-formed UUID string. */
  listId: string
  listTitle: string
  /** Real production creator_id (a user/service-account UUID) to attribute as the creator of the new public.lists row — never invented here. */
  creatorId: string
  resolutions: readonly ListSqlItemResolution[]
}

export interface NewListCreationSqlResult {
  ok: boolean
  sql: string | null
  errors: string[]
  expectedMembershipCount: number
}

/**
 * Generates the safe, idempotent SQL to create a brand-new public.lists
 * row (only if one doesn't already exist at `input.listId` — a
 * deterministic, conceptId-derived identity the caller supplies) and link
 * its initial membership — the CREATE-list counterpart to
 * generateListMembershipSql, which only ever links membership into an
 * ALREADY-EXISTING list looked up by title. Reuses resolveListItemsPreflight
 * (same zero-match/ambiguous-match fail-closed discipline) rather than a
 * second resolution mechanism.
 */
export function generateNewListCreationSql(input: NewListCreationSqlInput): NewListCreationSqlResult {
  if (!UUID_PATTERN.test(input.listId)) {
    return { ok: false, sql: null, errors: [`listId "${input.listId}" is not a well-formed UUID — refusing to generate list-creation SQL with a malformed identity.`], expectedMembershipCount: 0 }
  }

  const preflight = resolveListItemsPreflight(input.resolutions)
  if (!preflight.ok) {
    return {
      ok: false,
      sql: null,
      errors: [`Preflight failed for new list "${input.listTitle}" (id ${input.listId}) — item resolution must be complete (exactly one match per intended membership) before ANY list creation is generated:`, ...preflight.errors],
      expectedMembershipCount: 0,
    }
  }

  const seen = new Set<string>()
  const deduped = preflight.resolved.filter((r) => {
    if (seen.has(r.itemId)) return false
    seen.add(r.itemId)
    return true
  })
  const ordered = [...deduped].sort((a, b) => a.sortOrder - b.sortOrder)

  const lines: string[] = []
  lines.push('BEGIN;')
  lines.push('DO $$')
  lines.push('DECLARE')
  lines.push('  v_metro_id uuid;')
  lines.push(`  v_list_id uuid := ${sqlQuote(input.listId)}::uuid;`)
  lines.push('  v_existing_metro_id uuid;')
  lines.push('  v_count integer;')
  lines.push('BEGIN')
  lines.push(`  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = ${sqlQuote(input.metroSlug)};`)
  lines.push(`  IF v_metro_id IS NULL THEN RAISE EXCEPTION 'metro_areas row for slug % not found', ${sqlQuote(input.metroSlug)}; END IF;`)
  lines.push('  SELECT metro_id INTO v_existing_metro_id FROM public.lists WHERE id = v_list_id;')
  lines.push('  IF v_existing_metro_id IS NOT NULL AND v_existing_metro_id <> v_metro_id THEN')
  lines.push(`    RAISE EXCEPTION 'deterministic list id % already belongs to a different metro (%) than the intended metro % — refusing to repoint an existing list', v_list_id, v_existing_metro_id, v_metro_id;`)
  lines.push('  END IF;')
  lines.push('  INSERT INTO public.lists (id, metro_id, title, is_official, is_public, creator_id, is_featured_eligible)')
  lines.push(`  VALUES (v_list_id, v_metro_id, ${sqlQuote(input.listTitle)}, true, true, ${sqlQuote(input.creatorId)}, false)`)
  lines.push('  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title;')
  lines.push('  DELETE FROM public.list_items WHERE list_id = v_list_id;')
  if (ordered.length > 0) {
    lines.push('  INSERT INTO public.list_items (list_id, item_id)')
    const values = ordered.map((r) => `    (v_list_id, ${sqlQuote(r.itemId)}::uuid)`).join(',\n')
    lines.push('  VALUES')
    lines.push(values)
    lines.push('  ON CONFLICT (list_id, item_id) DO NOTHING;')
  }
  lines.push('  SELECT count(*) INTO v_count FROM public.list_items WHERE list_id = v_list_id;')
  lines.push(`  IF v_count <> ${ordered.length} THEN RAISE EXCEPTION 'postflight: expected % membership(s) for list %, found %', ${ordered.length}, ${sqlQuote(input.listTitle)}, v_count; END IF;`)
  lines.push('END $$;')
  lines.push('COMMIT;')

  return { ok: true, sql: lines.join('\n'), errors: [], expectedMembershipCount: ordered.length }
}

// ---------------------------------------------------------------------------
// Item body repair — the one legitimate remaining use of literal body text
// in generated SQL (correcting a corrupted/incorrect body in place). Uses
// sqlDollarQuote correctly (never sqlQuote's doubled-apostrophe rule) —
// this is the exact fix `munich_lists_rebuild_no_temp_tables.sql` applied
// inline for the real Schumann's Bar corruption, generalized into a reusable,
// tested function instead of a one-off inline repair.
// ---------------------------------------------------------------------------

export interface ItemBodyRepairInput {
  mapsQuery: string
  correctedBody: string
  /** When supplied, the UPDATE only matches a row whose CURRENT body is exactly this (the corrupted form) — idempotent by construction: a second run finds zero matching rows and is a safe no-op, exactly like the real analyzed repair. */
  previousBody?: string
}

export function generateItemBodyRepairSql(input: ItemBodyRepairInput): string {
  const lines: string[] = []
  lines.push('BEGIN;')
  const whereClause = input.previousBody
    ? `WHERE maps_query = ${sqlDollarQuote(input.mapsQuery, 'mq')} AND body = ${sqlDollarQuote(input.previousBody, 'old')}`
    : `WHERE maps_query = ${sqlDollarQuote(input.mapsQuery, 'mq')}`
  lines.push(`UPDATE public.items SET body = ${sqlDollarQuote(input.correctedBody, 'body')} ${whereClause};`)
  lines.push('COMMIT;')
  return lines.join('\n')
}
