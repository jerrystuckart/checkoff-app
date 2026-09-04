// Add Cover Candidate Review Into Existing Admin Images Area (2026-09-03).
//
// The reusable, Chief-ready operations behind Cover Candidate moderation —
// list / approve / reject / mark cover eligible / select as cover. This is
// the ONE place the status-transition rules live; the admin HTML's Images
// tab calls the equivalent REST operations against the SAME table using
// the SAME rules (documented there as intentionally mirroring this file —
// the admin tool is a static HTML file with no module system to import
// this from directly, so the logic is duplicated by necessity, not by
// accident. Any future change to these rules must be made in both places).
//
// Scope: public.item_cover_candidates / public.items.active_cover_candidate_id
// only — NOT agent.* (see mutations.ts's own header for why that file is
// scoped to agent.* exclusively; this is a deliberate sibling module, not
// an extension of it). Needs the grants added in
// supabase/migrations/20260903_agent_service_cover_candidate_grants.sql —
// agent_service had zero privileges on the public schema before that.
//
// "Do not give Chief autonomous approval authority yet" is enforced at the
// APPLICATION layer: nothing in this codebase currently calls these
// functions except a human driving the admin UI. Making them exist and be
// independently testable is what "Chief-ready" means here — not that
// Chief calls them today.
//
// Every mutation is dependency-injectable (optional `deps` param,
// defaulting to the real agent-service db.ts pool) — same DI convention
// already used successfully in lib/coverCandidates.js for the mobile app.
// This is what makes the test suite pure-unit (fully mocked, zero live
// database writes) rather than requiring the live-DB + explicit-env-gate
// pattern mutations.test.ts uses — safer for a table with no dedicated
// test-fixture isolation or DELETE grant to clean up after itself.

import { query as realQuery, withWriteTransaction as realWithWriteTransaction } from './db'
import type { PoolClient } from 'pg'

export type CoverCandidateStatus =
  | 'pending'
  | 'automated_rejected'
  | 'needs_review'
  | 'approved'
  | 'cover_eligible'
  | 'selected'
  | 'rejected'

export type CoverCandidateSource = 'community' | 'business_submission'

export interface CoverCandidateSummary {
  id: string
  itemId: string
  itemBody: string
  metroName: string | null
  status: CoverCandidateStatus
  source: CoverCandidateSource
  storagePath: string
  submittedAt: string
  reviewedByUserId: string | null
  reviewedAt: string | null
  selectedAsCoverAt: string | null
  rejectionReason: string | null
  /** The item's CURRENT selected cover candidate id, if any — may differ from `id` above. */
  activeCoverCandidateId: string | null
  /** Multi-Image Rotation (2026-09-03) additive fields — see the migration's header for why these are distinct from `status`. */
  displayEligible: boolean
  isPrimary: boolean
  displayWeight: number
}

/** One entry in an item's display-eligible image pool — see listItemImagePool. */
export interface ItemImagePoolEntry {
  id: string
  storagePath: string
  source: CoverCandidateSource
  isPrimary: boolean
  displayWeight: number
}

export interface ModerationDeps {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>
  withWriteTransaction: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>
}

const defaultDeps: ModerationDeps = { query: realQuery, withWriteTransaction: realWithWriteTransaction }

export class CoverCandidateModerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class CandidateNotFoundError extends CoverCandidateModerationError {
  constructor(public readonly candidateId: string) {
    super(`Cover candidate not found: ${candidateId}`)
  }
}

export class InvalidCandidateTransitionError extends CoverCandidateModerationError {
  constructor(
    public readonly candidateId: string,
    public readonly fromStatus: CoverCandidateStatus,
    public readonly toStatus: CoverCandidateStatus
  ) {
    super(`Cover candidate ${candidateId}: ${fromStatus} -> ${toStatus} is not an allowed transition`)
  }
}

/**
 * The item already has a DIFFERENT selected cover. selectAsCover refuses
 * to proceed unless the caller explicitly passes { allowReplace: true } —
 * this is the one enforcement point for "do not silently replace a
 * cover," shared by both the reusable operation and, transitively, every
 * caller of it (the admin UI's "Make Cover" vs "Replace Current Cover"
 * buttons are just two call sites with allowReplace false/true).
 */
export class CoverAlreadySelectedError extends CoverCandidateModerationError {
  constructor(
    public readonly itemId: string,
    public readonly currentCandidateId: string,
    public readonly attemptedCandidateId: string
  ) {
    super(
      `Item ${itemId} already has a selected cover (${currentCandidateId}) — pass allowReplace: true to replace it with ${attemptedCandidateId}`
    )
  }
}

/** Same "explicit confirmation to replace" contract as CoverAlreadySelectedError, for the new is_primary column rather than status='selected'. */
/**
 * Secret Item Protection (2026-09-03) — every generic moderation/rotation
 * write in this file refuses when the candidate's item is secret. No
 * override mechanism exists (deliberately not added — see the release
 * task this shipped under); a future secret-item-aware flow would need
 * its own explicit, separately-reviewed operation, never a bypass of
 * this check.
 */
export class SecretItemProtectedError extends CoverCandidateModerationError {
  constructor(
    public readonly candidateId: string,
    public readonly itemId: string
  ) {
    super(`Cover candidate ${candidateId}: item ${itemId} is a secret/spoiler item — refused`)
  }
}

export class PrimaryAlreadySetError extends CoverCandidateModerationError {
  constructor(
    public readonly itemId: string,
    public readonly currentPrimaryCandidateId: string,
    public readonly attemptedCandidateId: string
  ) {
    super(
      `Item ${itemId} already has a primary image (${currentPrimaryCandidateId}) — pass allowReplace: true to replace it with ${attemptedCandidateId}`
    )
  }
}

const CANDIDATE_SELECT = `
  select
    c.id, c.item_id, i.body as item_body,
    n.name as neighborhood_name, m.name as metro_name,
    c.status, c.source, c.storage_path, c.submitted_at,
    c.reviewed_by_user_id, c.reviewed_at, c.selected_as_cover_at, c.rejection_reason,
    c.display_eligible, c.is_primary, c.display_weight,
    i.active_cover_candidate_id
  from item_cover_candidates c
  join items i on i.id = c.item_id
  left join neighborhoods n on n.id = i.neighborhood_id
  left join metro_areas m on m.id = n.metro_id
`

function mapRow(row: Record<string, unknown>): CoverCandidateSummary {
  return {
    id: row.id as string,
    itemId: row.item_id as string,
    itemBody: row.item_body as string,
    metroName: (row.metro_name as string | null) ?? null,
    status: row.status as CoverCandidateStatus,
    source: row.source as CoverCandidateSource,
    storagePath: row.storage_path as string,
    submittedAt: row.submitted_at as string,
    reviewedByUserId: (row.reviewed_by_user_id as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    selectedAsCoverAt: (row.selected_as_cover_at as string | null) ?? null,
    rejectionReason: (row.rejection_reason as string | null) ?? null,
    activeCoverCandidateId: (row.active_cover_candidate_id as string | null) ?? null,
    displayEligible: Boolean(row.display_eligible),
    isPrimary: Boolean(row.is_primary),
    displayWeight: (row.display_weight as number | null) ?? 1,
  }
}

/**
 * @param filters.status  omit for all statuses
 * @param filters.source  omit for both sources
 */
export async function listCoverCandidates(
  filters: { status?: CoverCandidateStatus; source?: CoverCandidateSource } = {},
  deps: ModerationDeps = defaultDeps
): Promise<CoverCandidateSummary[]> {
  const clauses: string[] = []
  const params: unknown[] = []
  if (filters.status) {
    params.push(filters.status)
    clauses.push(`c.status = $${params.length}`)
  }
  if (filters.source) {
    params.push(filters.source)
    clauses.push(`c.source = $${params.length}`)
  }
  const where = clauses.length ? `where ${clauses.join(' and ')}` : ''
  const rows = await deps.query(`${CANDIDATE_SELECT} ${where} order by c.submitted_at desc`, params)
  return rows.map(mapRow)
}

async function fetchCandidateForUpdate(
  client: PoolClient,
  candidateId: string
): Promise<{ id: string; itemId: string; status: CoverCandidateStatus; displayEligible: boolean; isPrimary: boolean }> {
  // Secret Item Protection (2026-09-03): joins items.is_secret here, in
  // the ONE helper every write operation in this file calls first
  // (approve/reject/markCoverEligible/selectAsCover/addToRotation/
  // removeFromRotation/setPrimaryImage all start with this), so a single
  // check protects all of them — a secret item's candidate can never be
  // moderated or put into rotation through any of these generic
  // operations. In practice a secret item should never even HAVE a
  // candidate row (blocked at creation — see lib/coverCandidates.js and
  // the DB trigger in 20260903_secret_item_cover_protection.sql), but
  // this makes every write operation independently safe rather than
  // relying solely on "it could never get here."
  const result = await client.query<{
    id: string
    item_id: string
    status: CoverCandidateStatus
    display_eligible: boolean
    is_primary: boolean
    is_secret: boolean
  }>(
    `select c.id, c.item_id, c.status, c.display_eligible, c.is_primary, i.is_secret
     from item_cover_candidates c
     join items i on i.id = c.item_id
     where c.id = $1
     for update of c`,
    [candidateId]
  )
  if (result.rows.length === 0) throw new CandidateNotFoundError(candidateId)
  const row = result.rows[0]
  if (row.is_secret) throw new SecretItemProtectedError(candidateId, row.item_id)
  return { id: row.id, itemId: row.item_id, status: row.status, displayEligible: row.display_eligible, isPrimary: row.is_primary }
}

/** needs_review -> approved. Refuses from any other status (use rejectCandidate for a reject, selectAsCover advances an already-approved candidate further on its own). */
export async function approveCandidate(
  candidateId: string,
  reviewerOwnerUserId: string,
  deps: ModerationDeps = defaultDeps
): Promise<CoverCandidateSummary> {
  return deps.withWriteTransaction(async (client) => {
    const current = await fetchCandidateForUpdate(client, candidateId)
    if (current.status !== 'needs_review') {
      throw new InvalidCandidateTransitionError(candidateId, current.status, 'approved')
    }
    await client.query(
      `update item_cover_candidates set status = 'approved', reviewed_by_user_id = $2, reviewed_at = now() where id = $1`,
      [candidateId, reviewerOwnerUserId]
    )
    const result = await client.query(CANDIDATE_SELECT + ' where c.id = $1', [candidateId])
    return mapRow(result.rows[0])
  })
}

/** Any non-terminal status -> rejected. Terminal (already selected/rejected) refuses — a selected cover must go through selectAsCover's replace path, never a silent reject. */
export async function rejectCandidate(
  candidateId: string,
  reviewerOwnerUserId: string,
  reason: string | null,
  deps: ModerationDeps = defaultDeps
): Promise<CoverCandidateSummary> {
  return deps.withWriteTransaction(async (client) => {
    const current = await fetchCandidateForUpdate(client, candidateId)
    if (current.status === 'selected' || current.status === 'rejected') {
      throw new InvalidCandidateTransitionError(candidateId, current.status, 'rejected')
    }
    await client.query(
      `update item_cover_candidates set status = 'rejected', reviewed_by_user_id = $2, reviewed_at = now(), rejection_reason = $3 where id = $1`,
      [candidateId, reviewerOwnerUserId, reason]
    )
    const result = await client.query(CANDIDATE_SELECT + ' where c.id = $1', [candidateId])
    return mapRow(result.rows[0])
  })
}

/** approved -> cover_eligible. Exposed as its own reusable operation (Chief-ready list requirement) even though the admin UI's "Make Cover" button drives it implicitly via selectAsCover. */
export async function markCoverEligible(
  candidateId: string,
  deps: ModerationDeps = defaultDeps
): Promise<CoverCandidateSummary> {
  return deps.withWriteTransaction(async (client) => {
    const current = await fetchCandidateForUpdate(client, candidateId)
    if (current.status !== 'approved') {
      throw new InvalidCandidateTransitionError(candidateId, current.status, 'cover_eligible')
    }
    await client.query(`update item_cover_candidates set status = 'cover_eligible' where id = $1`, [candidateId])
    const result = await client.query(CANDIDATE_SELECT + ' where c.id = $1', [candidateId])
    return mapRow(result.rows[0])
  })
}

/**
 * The single operation behind BOTH "Make Cover" and "Replace Current
 * Cover" — advances the candidate through approved/cover_eligible to
 * selected as needed (auto-advancing rather than requiring 3 separate
 * calls for one admin action), points items.active_cover_candidate_id at
 * it, and — only when a DIFFERENT candidate was previously active — demotes
 * that previous candidate back to 'approved' (still safe/publishable, just
 * no longer the active cover; never left claiming 'selected' once it no
 * longer is, which would leave two rows both asserting they're the active
 * cover for the same item).
 *
 * Refuses (CoverAlreadySelectedError) if a different candidate is already
 * selected and `allowReplace` isn't explicitly true — this is the one
 * enforcement point for "do not silently replace a cover." The admin UI's
 * "Make Cover" button calls this with allowReplace:false; "Replace Current
 * Cover" is the same call with allowReplace:true after the admin has seen
 * the current image and explicitly confirmed.
 */
export async function selectAsCover(
  candidateId: string,
  options: { allowReplace?: boolean } = {},
  deps: ModerationDeps = defaultDeps
): Promise<{ candidate: CoverCandidateSummary; replacedCandidateId: string | null }> {
  return deps.withWriteTransaction(async (client) => {
    const current = await fetchCandidateForUpdate(client, candidateId)
    if (current.status === 'rejected') {
      throw new InvalidCandidateTransitionError(candidateId, current.status, 'selected')
    }

    const itemResult = await client.query<{ active_cover_candidate_id: string | null }>(
      'select active_cover_candidate_id from items where id = $1 for update',
      [current.itemId]
    )
    const existingActiveId = itemResult.rows[0]?.active_cover_candidate_id ?? null

    if (existingActiveId && existingActiveId !== candidateId && !options.allowReplace) {
      throw new CoverAlreadySelectedError(current.itemId, existingActiveId, candidateId)
    }

    // Auto-advance through the intermediate states rather than requiring
    // the caller to invoke approveCandidate/markCoverEligible first — a
    // single admin action ("Make Cover") should not be 3 separate clicks.
    // Every state this candidate passes through is still written, in
    // order, in the same transaction — not skipped, just not separately
    // confirmed by a human at each step.
    if (current.status === 'needs_review' || current.status === 'pending' || current.status === 'automated_rejected') {
      await client.query(`update item_cover_candidates set status = 'approved', reviewed_at = now() where id = $1`, [candidateId])
    }
    await client.query(`update item_cover_candidates set status = 'cover_eligible' where id = $1 and status <> 'cover_eligible'`, [candidateId])
    await client.query(
      `update item_cover_candidates set status = 'selected', selected_as_cover_at = now() where id = $1`,
      [candidateId]
    )

    if (existingActiveId && existingActiveId !== candidateId) {
      await client.query(
        `update item_cover_candidates set status = 'approved' where id = $1 and status = 'selected'`,
        [existingActiveId]
      )
    }

    await client.query('update items set active_cover_candidate_id = $2 where id = $1', [current.itemId, candidateId])

    const result = await client.query(CANDIDATE_SELECT + ' where c.id = $1', [candidateId])
    return { candidate: mapRow(result.rows[0]), replacedCandidateId: existingActiveId && existingActiveId !== candidateId ? existingActiveId : null }
  })
}

// ---------------------------------------------------------------------------
// Multi-Image Rotation for Item Covers (2026-09-03) — the 4 new reusable
// operations behind Admin -> Images -> Cover Candidates' Add to
// Rotation / Remove from Rotation / Set as Primary controls and the
// per-item "Current Image Pool" view. Same Chief-ready-but-not-Chief-
// callable convention as everything above: nothing in this codebase
// invokes these except a human driving the admin UI.
// ---------------------------------------------------------------------------

/**
 * approved/cover_eligible/selected -> display_eligible = true. Refuses a
 * rejected candidate (never publicly displayable) and a still-pending/
 * needs_review one (approval is a distinct, prior gate — "approved does
 * NOT automatically mean display eligible," but the converse must also
 * hold: nothing may enter the display pool before it's approved). Does
 * NOT touch is_primary — adding a second image to rotation never
 * silently promotes it over an existing primary.
 */
export async function addToRotation(candidateId: string, deps: ModerationDeps = defaultDeps): Promise<CoverCandidateSummary> {
  return deps.withWriteTransaction(async (client) => {
    const current = await fetchCandidateForUpdate(client, candidateId)
    if (current.status === 'rejected' || current.status === 'pending' || current.status === 'needs_review' || current.status === 'automated_rejected') {
      throw new InvalidCandidateTransitionError(candidateId, current.status, 'approved')
    }
    await client.query(`update item_cover_candidates set display_eligible = true where id = $1`, [candidateId])
    const result = await client.query(CANDIDATE_SELECT + ' where c.id = $1', [candidateId])
    return mapRow(result.rows[0])
  })
}

/**
 * display_eligible = false. Never deletes the row — moderation history
 * (status/source/reviewer) is preserved, it simply stops being part of
 * the public pool. If this candidate was the primary, primary is cleared
 * too (the DB CHECK constraint forbids is_primary without
 * display_eligible, so this isn't optional) and, when it was also the
 * item's active_cover_candidate_id, that pointer is cleared to null —
 * removing the one-and-only cover from rotation must never leave a
 * dangling pointer to a now-private image.
 */
export async function removeFromRotation(candidateId: string, deps: ModerationDeps = defaultDeps): Promise<CoverCandidateSummary> {
  return deps.withWriteTransaction(async (client) => {
    const current = await fetchCandidateForUpdate(client, candidateId)
    await client.query(`update item_cover_candidates set display_eligible = false, is_primary = false where id = $1`, [candidateId])
    if (current.isPrimary) {
      await client.query(`update items set active_cover_candidate_id = null where id = $1 and active_cover_candidate_id = $2`, [
        current.itemId,
        candidateId,
      ])
    }
    const result = await client.query(CANDIDATE_SELECT + ' where c.id = $1', [candidateId])
    return mapRow(result.rows[0])
  })
}

/**
 * The single operation behind "Set as Primary" — mirrors selectAsCover's
 * shape (auto-advance, explicit-confirmation-to-replace, demote-not-
 * delete) but for the new is_primary/display_eligible columns rather
 * than status. A candidate not yet in the rotation pool is auto-added to
 * it (display_eligible -> true) as part of becoming primary, the same
 * "one admin action, not three separate clicks" reasoning selectAsCover
 * already uses for approved/cover_eligible/selected. Refuses
 * (PrimaryAlreadySetError) when a DIFFERENT candidate is already primary
 * for this item unless `allowReplace` is explicitly true; the prior
 * primary is demoted (is_primary = false) but stays display_eligible —
 * it remains in the rotation pool, just no longer preferred. Keeps
 * items.active_cover_candidate_id pointed at the primary in the same
 * transaction, per the schema migration's documented sync policy.
 */
export async function setPrimaryImage(
  candidateId: string,
  options: { allowReplace?: boolean } = {},
  deps: ModerationDeps = defaultDeps
): Promise<{ candidate: CoverCandidateSummary; demotedCandidateId: string | null }> {
  return deps.withWriteTransaction(async (client) => {
    const current = await fetchCandidateForUpdate(client, candidateId)
    if (current.status === 'rejected') {
      throw new InvalidCandidateTransitionError(candidateId, current.status, 'approved')
    }

    const existingPrimaryResult = await client.query<{ id: string }>(
      `select id from item_cover_candidates where item_id = $1 and is_primary = true and id <> $2 for update`,
      [current.itemId, candidateId]
    )
    const existingPrimaryId = existingPrimaryResult.rows[0]?.id ?? null

    if (existingPrimaryId && !options.allowReplace) {
      throw new PrimaryAlreadySetError(current.itemId, existingPrimaryId, candidateId)
    }

    if (existingPrimaryId) {
      await client.query(`update item_cover_candidates set is_primary = false where id = $1`, [existingPrimaryId])
    }
    await client.query(`update item_cover_candidates set display_eligible = true, is_primary = true where id = $1`, [candidateId])
    await client.query(`update items set active_cover_candidate_id = $2 where id = $1`, [current.itemId, candidateId])

    const result = await client.query(CANDIDATE_SELECT + ' where c.id = $1', [candidateId])
    return { candidate: mapRow(result.rows[0]), demotedCandidateId: existingPrimaryId }
  })
}

/**
 * The item-level "Current Image Pool" read — every display_eligible
 * candidate for one item, primary first. Read-only (no transaction/lock
 * needed) — uses deps.query like listCoverCandidates, not
 * withWriteTransaction.
 */
export async function listItemImagePool(itemId: string, deps: ModerationDeps = defaultDeps): Promise<ItemImagePoolEntry[]> {
  const rows = await deps.query<{
    id: string
    storage_path: string
    source: CoverCandidateSource
    is_primary: boolean
    display_weight: number
  }>(
    `select id, storage_path, source, is_primary, display_weight
     from item_cover_candidates
     where item_id = $1 and display_eligible = true
     order by is_primary desc, display_weight desc, submitted_at asc`,
    [itemId]
  )
  return rows.map((row) => ({
    id: row.id,
    storagePath: row.storage_path,
    source: row.source,
    isPrimary: Boolean(row.is_primary),
    displayWeight: row.display_weight ?? 1,
  }))
}
