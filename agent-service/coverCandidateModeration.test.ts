// Pure unit tests — fully mocked in-memory fake, zero live database
// writes. See coverCandidateModeration.ts's module doc for why this table
// gets DI-based unit tests rather than mutations.test.ts's live-DB +
// env-gate pattern: no test-fixture isolation convention and no DELETE
// grant exist for item_cover_candidates, so a live-write test suite would
// leave permanent debris in production tables with no way to clean up.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  listCoverCandidates,
  approveCandidate,
  rejectCandidate,
  markCoverEligible,
  selectAsCover,
  addToRotation,
  removeFromRotation,
  setPrimaryImage,
  listItemImagePool,
  CandidateNotFoundError,
  InvalidCandidateTransitionError,
  CoverAlreadySelectedError,
  PrimaryAlreadySetError,
  SecretItemProtectedError,
  type CoverCandidateStatus,
  type ModerationDeps,
} from './coverCandidateModeration'

interface FakeCandidate {
  id: string
  item_id: string
  status: CoverCandidateStatus
  source: 'community' | 'business_submission'
  storage_path: string
  submitted_at: string
  reviewed_by_user_id: string | null
  reviewed_at: string | null
  selected_as_cover_at: string | null
  rejection_reason: string | null
  display_eligible: boolean
  is_primary: boolean
  display_weight: number
}
interface FakeItem {
  id: string
  body: string
  active_cover_candidate_id: string | null
  is_secret?: boolean
}

function makeFakeDb(candidates: FakeCandidate[], items: FakeItem[]): ModerationDeps {
  const candidateSelectRe = /^\s*select\s+c\.id, c\.item_id, i\.body as item_body/i
  const query: ModerationDeps['query'] = async (text, params = []) => {
    if (candidateSelectRe.test(text)) {
      let rows = candidates
      const whereStatus = text.match(/c\.status = \$(\d+)/)
      const whereSource = text.match(/c\.source = \$(\d+)/)
      const whereId = text.match(/c\.id = \$(\d+)/)
      if (whereStatus) rows = rows.filter((c) => c.status === (params as unknown[])[Number(whereStatus[1]) - 1])
      if (whereSource) rows = rows.filter((c) => c.source === (params as unknown[])[Number(whereSource[1]) - 1])
      if (whereId) rows = rows.filter((c) => c.id === (params as unknown[])[Number(whereId[1]) - 1])
      return rows.map((c) => {
        const item = items.find((i) => i.id === c.item_id)!
        return {
          id: c.id,
          item_id: c.item_id,
          item_body: item.body,
          neighborhood_name: null,
          metro_name: null,
          status: c.status,
          source: c.source,
          storage_path: c.storage_path,
          submitted_at: c.submitted_at,
          reviewed_by_user_id: c.reviewed_by_user_id,
          reviewed_at: c.reviewed_at,
          selected_as_cover_at: c.selected_as_cover_at,
          rejection_reason: c.rejection_reason,
          display_eligible: c.display_eligible,
          is_primary: c.is_primary,
          display_weight: c.display_weight,
          active_cover_candidate_id: item.active_cover_candidate_id,
        } as unknown as Record<string, unknown>
      }) as never
    }
    if (/^\s*select id, storage_path, source, is_primary, display_weight\s+from item_cover_candidates/i.test(text)) {
      const itemId = (params as unknown[])[0]
      const rows = candidates
        .filter((c) => c.item_id === itemId && c.display_eligible)
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || b.display_weight - a.display_weight)
      return rows.map((c) => ({
        id: c.id,
        storage_path: c.storage_path,
        source: c.source,
        is_primary: c.is_primary,
        display_weight: c.display_weight,
      })) as never
    }
    throw new Error(`fake query(): unhandled top-level query: ${text}`)
  }

  const withWriteTransaction: ModerationDeps['withWriteTransaction'] = async (fn) => {
    const fakeClient = {
      query: async (text: string, params: unknown[] = []) => {
        if (/select c\.id, c\.item_id, c\.status, c\.display_eligible, c\.is_primary, i\.is_secret\s+from item_cover_candidates c\s+join items i on i\.id = c\.item_id\s+where c\.id = \$1/i.test(text)) {
          const c = candidates.find((x) => x.id === params[0])
          const item = c ? items.find((x) => x.id === c.item_id) : undefined
          return {
            rows: c
              ? [{ id: c.id, item_id: c.item_id, status: c.status, display_eligible: c.display_eligible, is_primary: c.is_primary, is_secret: Boolean(item?.is_secret) }]
              : [],
          }
        }
        if (/select active_cover_candidate_id from items where id = \$1 for update/i.test(text)) {
          const item = items.find((x) => x.id === params[0])
          return { rows: item ? [{ active_cover_candidate_id: item.active_cover_candidate_id }] : [] }
        }
        if (/update item_cover_candidates set status = 'approved', reviewed_by_user_id/i.test(text)) {
          const c = candidates.find((x) => x.id === params[0])!
          c.status = 'approved'
          c.reviewed_by_user_id = params[1] as string
          c.reviewed_at = new Date().toISOString()
          return { rows: [] }
        }
        if (/update item_cover_candidates set status = 'approved', reviewed_at = now\(\) where id = \$1/i.test(text)) {
          const c = candidates.find((x) => x.id === params[0])!
          c.status = 'approved'
          c.reviewed_at = new Date().toISOString()
          return { rows: [] }
        }
        if (/update item_cover_candidates set status = 'rejected'/i.test(text)) {
          const c = candidates.find((x) => x.id === params[0])!
          c.status = 'rejected'
          c.reviewed_by_user_id = params[1] as string
          c.reviewed_at = new Date().toISOString()
          c.rejection_reason = params[2] as string | null
          return { rows: [] }
        }
        if (/update item_cover_candidates set status = 'cover_eligible' where id = \$1 and status/i.test(text)) {
          const c = candidates.find((x) => x.id === params[0])!
          if (c.status !== 'cover_eligible') c.status = 'cover_eligible'
          return { rows: [] }
        }
        if (/update item_cover_candidates set status = 'cover_eligible' where id = \$1$/i.test(text)) {
          const c = candidates.find((x) => x.id === params[0])!
          c.status = 'cover_eligible'
          return { rows: [] }
        }
        if (/update item_cover_candidates set status = 'selected', selected_as_cover_at/i.test(text)) {
          const c = candidates.find((x) => x.id === params[0])!
          c.status = 'selected'
          c.selected_as_cover_at = new Date().toISOString()
          return { rows: [] }
        }
        if (/update item_cover_candidates set status = 'approved' where id = \$1 and status = 'selected'/i.test(text)) {
          const c = candidates.find((x) => x.id === params[0])
          if (c && c.status === 'selected') c.status = 'approved'
          return { rows: [] }
        }
        if (/update items set active_cover_candidate_id = \$2 where id = \$1/i.test(text)) {
          const item = items.find((x) => x.id === params[0])!
          item.active_cover_candidate_id = params[1] as string
          return { rows: [] }
        }
        if (/update item_cover_candidates set display_eligible = true where id = \$1/i.test(text)) {
          const c = candidates.find((x) => x.id === params[0])!
          c.display_eligible = true
          return { rows: [] }
        }
        if (/update item_cover_candidates set display_eligible = false, is_primary = false where id = \$1/i.test(text)) {
          const c = candidates.find((x) => x.id === params[0])!
          c.display_eligible = false
          c.is_primary = false
          return { rows: [] }
        }
        if (/update items set active_cover_candidate_id = null where id = \$1 and active_cover_candidate_id = \$2/i.test(text)) {
          const item = items.find((x) => x.id === params[0])
          if (item && item.active_cover_candidate_id === params[1]) item.active_cover_candidate_id = null
          return { rows: [] }
        }
        if (/select id from item_cover_candidates where item_id = \$1 and is_primary = true and id <> \$2 for update/i.test(text)) {
          const c = candidates.find((x) => x.item_id === params[0] && x.is_primary && x.id !== params[1])
          return { rows: c ? [{ id: c.id }] : [] }
        }
        if (/update item_cover_candidates set is_primary = false where id = \$1/i.test(text)) {
          const c = candidates.find((x) => x.id === params[0])!
          c.is_primary = false
          return { rows: [] }
        }
        if (/update item_cover_candidates set display_eligible = true, is_primary = true where id = \$1/i.test(text)) {
          const c = candidates.find((x) => x.id === params[0])!
          c.display_eligible = true
          c.is_primary = true
          return { rows: [] }
        }
        if (candidateSelectRe.test(text)) {
          return { rows: (await query(text, params)) as unknown[] }
        }
        throw new Error(`fake client.query(): unhandled write-tx query: ${text}`)
      },
    }
    return fn(fakeClient as never)
  }

  return { query, withWriteTransaction }
}

function fixture() {
  const items: FakeItem[] = [
    { id: 'item-1', body: "Order the wings at 'Red Zone'", active_cover_candidate_id: null },
    { id: 'item-2', body: "Browse Mahjong at '85 Local'", active_cover_candidate_id: 'cand-existing' },
    // Secret Item Protection (2026-09-03) — in the real DB, a candidate
    // row for a secret item can never be created (blocked by both
    // lib/coverCandidates.js and the DB trigger in
    // 20260903_secret_item_cover_protection.sql). This fixture row
    // exists purely to prove the app-layer guard in
    // coverCandidateModeration.ts independently rejects it too, rather
    // than relying solely on "it could never get here."
    { id: 'item-secret', body: "Try the Secret Item at 'Somewhere'", active_cover_candidate_id: null, is_secret: true },
  ]
  const candidates: FakeCandidate[] = [
    { id: 'cand-1', item_id: 'item-1', status: 'needs_review', source: 'community', storage_path: 'p1.jpg', submitted_at: '2026-09-03T00:00:00Z', reviewed_by_user_id: null, reviewed_at: null, selected_as_cover_at: null, rejection_reason: null, display_eligible: false, is_primary: false, display_weight: 1 },
    { id: 'cand-existing', item_id: 'item-2', status: 'selected', source: 'business_submission', storage_path: 'p2.jpg', submitted_at: '2026-09-01T00:00:00Z', reviewed_by_user_id: 'owner-1', reviewed_at: '2026-09-01T00:00:00Z', selected_as_cover_at: '2026-09-01T00:00:00Z', rejection_reason: null, display_eligible: true, is_primary: true, display_weight: 1 },
    { id: 'cand-new', item_id: 'item-2', status: 'needs_review', source: 'community', storage_path: 'p3.jpg', submitted_at: '2026-09-03T00:00:00Z', reviewed_by_user_id: null, reviewed_at: null, selected_as_cover_at: null, rejection_reason: null, display_eligible: false, is_primary: false, display_weight: 1 },
    { id: 'cand-approved', item_id: 'item-2', status: 'approved', source: 'community', storage_path: 'p4.jpg', submitted_at: '2026-09-02T00:00:00Z', reviewed_by_user_id: 'owner-1', reviewed_at: '2026-09-02T00:00:00Z', selected_as_cover_at: null, rejection_reason: null, display_eligible: false, is_primary: false, display_weight: 1 },
    { id: 'cand-secret', item_id: 'item-secret', status: 'needs_review', source: 'community', storage_path: 'p5.jpg', submitted_at: '2026-09-03T00:00:00Z', reviewed_by_user_id: null, reviewed_at: null, selected_as_cover_at: null, rejection_reason: null, display_eligible: false, is_primary: false, display_weight: 1 },
  ]
  return { deps: makeFakeDb(candidates, items), candidates, items }
}

test('listCoverCandidates: no filters returns everything', async () => {
  const { deps } = fixture()
  const rows = await listCoverCandidates({}, deps)
  assert.equal(rows.length, 5)
})

test('listCoverCandidates: filters by status', async () => {
  const { deps } = fixture()
  const rows = await listCoverCandidates({ status: 'needs_review' }, deps)
  assert.deepEqual(rows.map((r) => r.id).sort(), ['cand-1', 'cand-new', 'cand-secret'])
})

test('listCoverCandidates: filters by source', async () => {
  const { deps } = fixture()
  const rows = await listCoverCandidates({ source: 'business_submission' }, deps)
  assert.deepEqual(rows.map((r) => r.id), ['cand-existing'])
})

test('listCoverCandidates: exposes the item current active cover id, distinct from row id', async () => {
  const { deps } = fixture()
  const rows = await listCoverCandidates({ status: 'needs_review' }, deps)
  const candNew = rows.find((r) => r.id === 'cand-new')!
  assert.equal(candNew.activeCoverCandidateId, 'cand-existing')
})

test('approveCandidate: needs_review -> approved', async () => {
  const { deps, candidates } = fixture()
  const result = await approveCandidate('cand-1', 'owner-1', deps)
  assert.equal(result.status, 'approved')
  assert.equal(candidates.find((c) => c.id === 'cand-1')!.reviewed_by_user_id, 'owner-1')
})

test('approveCandidate: refuses from any status other than needs_review', async () => {
  const { deps } = fixture()
  await assert.rejects(() => approveCandidate('cand-existing', 'owner-1', deps), InvalidCandidateTransitionError)
})

test('approveCandidate: unknown id throws CandidateNotFoundError', async () => {
  const { deps } = fixture()
  await assert.rejects(() => approveCandidate('nope', 'owner-1', deps), CandidateNotFoundError)
})

test('rejectCandidate: needs_review -> rejected, with reason', async () => {
  const { deps, candidates } = fixture()
  const result = await rejectCandidate('cand-1', 'owner-1', 'blurry', deps)
  assert.equal(result.status, 'rejected')
  assert.equal(candidates.find((c) => c.id === 'cand-1')!.rejection_reason, 'blurry')
})

test('rejectCandidate: refuses on an already-selected candidate (must go through selectAsCover replace, never a silent reject)', async () => {
  const { deps } = fixture()
  await assert.rejects(() => rejectCandidate('cand-existing', 'owner-1', null, deps), InvalidCandidateTransitionError)
})

test('markCoverEligible: approved -> cover_eligible', async () => {
  const { deps, candidates } = fixture()
  candidates.find((c) => c.id === 'cand-1')!.status = 'approved'
  const result = await markCoverEligible('cand-1', deps)
  assert.equal(result.status, 'cover_eligible')
})

test('markCoverEligible: refuses from needs_review directly', async () => {
  const { deps } = fixture()
  await assert.rejects(() => markCoverEligible('cand-1', deps), InvalidCandidateTransitionError)
})

test('selectAsCover: no existing cover — auto-advances needs_review straight to selected, sets items.active_cover_candidate_id', async () => {
  const { deps, items } = fixture()
  const { candidate, replacedCandidateId } = await selectAsCover('cand-1', {}, deps)
  assert.equal(candidate.status, 'selected')
  assert.equal(replacedCandidateId, null)
  assert.equal(items.find((i) => i.id === 'item-1')!.active_cover_candidate_id, 'cand-1')
})

test('selectAsCover: a different cover is already selected — refuses without allowReplace (never a silent replace)', async () => {
  const { deps } = fixture()
  await assert.rejects(() => selectAsCover('cand-new', {}, deps), CoverAlreadySelectedError)
})

test('selectAsCover: allowReplace true — demotes the previous cover to approved, promotes the new one, updates the pointer', async () => {
  const { deps, candidates, items } = fixture()
  const { candidate, replacedCandidateId } = await selectAsCover('cand-new', { allowReplace: true }, deps)
  assert.equal(candidate.status, 'selected')
  assert.equal(replacedCandidateId, 'cand-existing')
  assert.equal(candidates.find((c) => c.id === 'cand-existing')!.status, 'approved')
  assert.equal(items.find((i) => i.id === 'item-2')!.active_cover_candidate_id, 'cand-new')
})

test('selectAsCover: re-selecting the item\'s own already-active candidate is a no-op replace (not itself demoted)', async () => {
  const { deps, candidates, items } = fixture()
  const { candidate, replacedCandidateId } = await selectAsCover('cand-existing', {}, deps)
  assert.equal(candidate.status, 'selected')
  assert.equal(replacedCandidateId, null)
  assert.equal(candidates.find((c) => c.id === 'cand-existing')!.status, 'selected')
  assert.equal(items.find((i) => i.id === 'item-2')!.active_cover_candidate_id, 'cand-existing')
})

test('selectAsCover: refuses a rejected candidate', async () => {
  const { deps, candidates } = fixture()
  candidates.find((c) => c.id === 'cand-1')!.status = 'rejected'
  await assert.rejects(() => selectAsCover('cand-1', {}, deps), InvalidCandidateTransitionError)
})

// ---------------------------------------------------------------------------
// Multi-Image Rotation for Item Covers (2026-09-03)
// ---------------------------------------------------------------------------

test('addToRotation: approved -> display_eligible true, is_primary untouched', async () => {
  const { deps, candidates } = fixture()
  const result = await addToRotation('cand-approved', deps)
  assert.equal(result.displayEligible, true)
  assert.equal(result.isPrimary, false)
  assert.equal(candidates.find((c) => c.id === 'cand-approved')!.display_eligible, true)
})

test('addToRotation: refuses a needs_review candidate (approval is a distinct, prior gate)', async () => {
  const { deps } = fixture()
  await assert.rejects(() => addToRotation('cand-1', deps), InvalidCandidateTransitionError)
})

test('addToRotation: refuses a rejected candidate', async () => {
  const { deps, candidates } = fixture()
  candidates.find((c) => c.id === 'cand-approved')!.status = 'rejected'
  await assert.rejects(() => addToRotation('cand-approved', deps), InvalidCandidateTransitionError)
})

test('removeFromRotation: display_eligible -> false, never deletes the row', async () => {
  const { deps, candidates } = fixture()
  const result = await removeFromRotation('cand-existing', deps)
  assert.equal(result.displayEligible, false)
  assert.ok(candidates.find((c) => c.id === 'cand-existing'), 'row still exists')
})

test('removeFromRotation: clears is_primary and the item pointer when removing the primary', async () => {
  const { deps, candidates, items } = fixture()
  await removeFromRotation('cand-existing', deps)
  assert.equal(candidates.find((c) => c.id === 'cand-existing')!.is_primary, false)
  assert.equal(items.find((i) => i.id === 'item-2')!.active_cover_candidate_id, null)
})

test('removeFromRotation: a non-primary pool image only loses display_eligible, item pointer untouched', async () => {
  const { deps, candidates, items } = fixture()
  candidates.find((c) => c.id === 'cand-new')!.display_eligible = true // second, non-primary pool image
  await removeFromRotation('cand-new', deps)
  assert.equal(items.find((i) => i.id === 'item-2')!.active_cover_candidate_id, 'cand-existing')
})

test('setPrimaryImage: no existing primary — auto-adds to rotation, becomes primary, updates item pointer', async () => {
  const { deps, candidates, items } = fixture()
  const { candidate, demotedCandidateId } = await setPrimaryImage('cand-1', {}, deps)
  assert.equal(candidate.isPrimary, true)
  assert.equal(candidate.displayEligible, true)
  assert.equal(demotedCandidateId, null)
  assert.equal(candidates.find((c) => c.id === 'cand-1')!.display_eligible, true)
  assert.equal(items.find((i) => i.id === 'item-1')!.active_cover_candidate_id, 'cand-1')
})

test('setPrimaryImage: a different primary already exists — refuses without allowReplace', async () => {
  const { deps } = fixture()
  await assert.rejects(() => setPrimaryImage('cand-approved', {}, deps), PrimaryAlreadySetError)
})

test('setPrimaryImage: allowReplace true — demotes the previous primary (stays display_eligible, in rotation) but never deletes it', async () => {
  const { deps, candidates, items } = fixture()
  const { candidate, demotedCandidateId } = await setPrimaryImage('cand-approved', { allowReplace: true }, deps)
  assert.equal(candidate.isPrimary, true)
  assert.equal(demotedCandidateId, 'cand-existing')
  const demoted = candidates.find((c) => c.id === 'cand-existing')!
  assert.equal(demoted.is_primary, false)
  assert.equal(demoted.display_eligible, true, 'demoted candidate stays in rotation, only loses primary status')
  assert.equal(items.find((i) => i.id === 'item-2')!.active_cover_candidate_id, 'cand-approved')
})

test('setPrimaryImage: refuses a rejected candidate', async () => {
  const { deps, candidates } = fixture()
  candidates.find((c) => c.id === 'cand-approved')!.status = 'rejected'
  await assert.rejects(() => setPrimaryImage('cand-approved', {}, deps), InvalidCandidateTransitionError)
})

test('listItemImagePool: returns only display_eligible rows for the item, primary first', async () => {
  const { deps, candidates } = fixture()
  candidates.find((c) => c.id === 'cand-new')!.display_eligible = true // item-2 now has 2 pool images
  const pool = await listItemImagePool('item-2', deps)
  assert.deepEqual(pool.map((p) => p.id), ['cand-existing', 'cand-new'])
  assert.equal(pool[0].isPrimary, true)
})

test('listItemImagePool: an item with no display_eligible rows returns an empty pool', async () => {
  const { deps } = fixture()
  const pool = await listItemImagePool('item-1', deps)
  assert.deepEqual(pool, [])
})

// ---------------------------------------------------------------------------
// Secret Item Protection (2026-09-03) — CheckOff Release Candidate
// ---------------------------------------------------------------------------

test('approveCandidate: refuses a candidate belonging to a secret item', async () => {
  const { deps } = fixture()
  await assert.rejects(() => approveCandidate('cand-secret', 'owner-1', deps), SecretItemProtectedError)
})

test('rejectCandidate: refuses a candidate belonging to a secret item', async () => {
  const { deps } = fixture()
  await assert.rejects(() => rejectCandidate('cand-secret', 'owner-1', null, deps), SecretItemProtectedError)
})

test('markCoverEligible: refuses a candidate belonging to a secret item', async () => {
  const { deps, candidates } = fixture()
  candidates.find((c) => c.id === 'cand-secret')!.status = 'approved'
  await assert.rejects(() => markCoverEligible('cand-secret', deps), SecretItemProtectedError)
})

test('selectAsCover: refuses a candidate belonging to a secret item — no generic Cover Candidate association for secret items', async () => {
  const { deps } = fixture()
  await assert.rejects(() => selectAsCover('cand-secret', {}, deps), SecretItemProtectedError)
})

test('addToRotation: refuses a candidate belonging to a secret item — no generic Add to Rotation', async () => {
  const { deps, candidates } = fixture()
  candidates.find((c) => c.id === 'cand-secret')!.status = 'approved'
  await assert.rejects(() => addToRotation('cand-secret', deps), SecretItemProtectedError)
})

test('removeFromRotation: refuses a candidate belonging to a secret item (even one somehow already in rotation)', async () => {
  const { deps, candidates } = fixture()
  candidates.find((c) => c.id === 'cand-secret')!.display_eligible = true
  await assert.rejects(() => removeFromRotation('cand-secret', deps), SecretItemProtectedError)
})

test('setPrimaryImage: refuses a candidate belonging to a secret item — no generic Set Primary / Replace Primary', async () => {
  const { deps } = fixture()
  await assert.rejects(() => setPrimaryImage('cand-secret', {}, deps), SecretItemProtectedError)
})

test('setPrimaryImage with allowReplace: still refuses for a secret item — allowReplace cannot bypass the secret-item check', async () => {
  const { deps } = fixture()
  await assert.rejects(() => setPrimaryImage('cand-secret', { allowReplace: true }, deps), SecretItemProtectedError)
})

test('Secret Item Protection never touches a non-secret item\'s ordinary write operations', async () => {
  const { deps } = fixture()
  const result = await approveCandidate('cand-1', 'owner-1', deps)
  assert.equal(result.status, 'approved')
})
