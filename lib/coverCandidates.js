// Community Cover Photos V1 — Supabase access for Cover Candidates.
// Dependency-injection pattern matches the rest of lib/ (see
// whatsGoodDataAdapter.js): `client` is always optional, defaulting to a
// lazy import of the real supabase client, so this is unit-testable under
// plain Node without pulling in React Native.

async function resolveClient(client) {
  if (client) return client
  const mod = await import('./supabase')
  return mod.supabase
}

/**
 * "Already submitted a pending cover candidate for this item recently" —
 * V1's definition of "recently" is simply "still unresolved": a row exists
 * with status IN ('pending', 'needs_review'). No arbitrary time window is
 * introduced — once a submission is resolved (approved/rejected/etc.),
 * this stops blocking a future submission on its own; the caller also
 * checks whether the item already has an approved image separately (see
 * lib/coverCandidateEligibility.js).
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.itemId
 * @param {object} [params.client]
 * @returns {Promise<boolean>}
 */
export async function hasPendingCoverCandidate({ userId, itemId, client }) {
  const activeClient = await resolveClient(client)
  const { data, error } = await activeClient
    .from('item_cover_candidates')
    .select('id')
    .eq('submitted_by_user_id', userId)
    .eq('item_id', itemId)
    .in('status', ['pending', 'needs_review'])
    .limit(1)
  if (error) return false // fail open on a read error -- never block eligibility on a transient query failure; the DB's own dedup story is the submission itself, not this pre-check
  return (data?.length ?? 0) > 0
}

/**
 * Inserts one Cover Candidate row. consent_ack must be true (RLS also
 * enforces this at the database level — see the migration's INSERT
 * policy) — the caller is responsible for only calling this after the
 * user has explicitly confirmed the "Great shot. Share it with CheckOff?"
 * prompt.
 *
 * Secret Item Protection (2026-09-03): refuses up front for a secret item
 * rather than letting the insert reach the database — the UI-level CTA
 * (lib/coverCandidateEligibility.js) already excludes secret items, so
 * this should never actually fire, but the real backstop is a DB trigger
 * (see supabase/migrations/20260903_secret_item_cover_protection.sql)
 * that rejects the insert regardless of what any client-side code
 * checked or didn't. This check exists only to fail with a clear message
 * instead of a raw Postgres error.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.itemId
 * @param {string} params.storagePath  path within the private submission-photos bucket -- never a public URL
 * @param {string} params.status  from lib/coverModeration/moderationAdapter.js's initialStatusFromAssessment
 * @param {object} params.moderationMetadata
 * @param {object} [params.client]
 */
export async function submitCoverCandidate({ userId, itemId, storagePath, status, moderationMetadata, client }) {
  const activeClient = await resolveClient(client)

  const { data: itemRow, error: itemError } = await activeClient
    .from('items')
    .select('is_secret')
    .eq('id', itemId)
    .maybeSingle()
  if (!itemError && itemRow?.is_secret) {
    throw new Error('Cover candidate submission refused: this item is a secret/spoiler item')
  }

  const { data, error } = await activeClient
    .from('item_cover_candidates')
    .insert({
      item_id: itemId,
      submitted_by_user_id: userId,
      storage_path: storagePath,
      status,
      moderation_metadata: moderationMetadata ?? {},
      consent_ack: true,
    })
    .select('id, status')
    .single()
  if (error) throw new Error(`Cover candidate submission failed: ${error.message}`)
  return data
}

/**
 * Resolves the currently-selected cover image for an item, if any, as a
 * short-lived SIGNED url — never a public url, and never generated unless
 * the item actually has an active_cover_candidate_id set by an admin.
 *
 * @param {object} params
 * @param {string|null} params.activeCoverCandidateId  item.active_cover_candidate_id
 * @param {object} [params.client]
 * @param {number} [params.expiresInSeconds]
 * @returns {Promise<string|null>}
 */
export async function resolveActiveCoverUrl({ activeCoverCandidateId, client, expiresInSeconds = 3600 }) {
  if (!activeCoverCandidateId) return null
  const activeClient = await resolveClient(client)

  const { data: candidate, error } = await activeClient
    .from('item_cover_candidates')
    .select('storage_path, status')
    .eq('id', activeCoverCandidateId)
    .eq('status', 'selected') // defense in depth: never serve a candidate whose status isn't actually 'selected', even if the item's pointer is somehow stale
    .maybeSingle()
  if (error || !candidate) return null

  const { data: signed, error: signErr } = await activeClient.storage
    .from('submission-photos')
    .createSignedUrl(candidate.storage_path, expiresInSeconds)
  if (signErr || !signed?.signedUrl) return null

  return signed.signedUrl
}

/**
 * Final UI Pass Before Build 144 — item 3: Item Detail must resolve the
 * SAME selected cover regardless of which screen navigated to it. Home's
 * item-mapping path (attachActiveCoverImages, above) only enriches items
 * that flow through HomeScreen.jsx's own query — Near You/Nearby, Lists,
 * and Profile/history navigate to ItemDetail with items shaped by their
 * own, separate queries that were never taught about
 * active_cover_candidate_id. Rather than duplicate that plumbing into
 * every entry point (screen-specific image state, exactly what this task
 * says not to do), ItemDetailScreen fetches directly by item id — one
 * network round-trip, one source of truth
 * (lib/whatsGoodImageSource.js's resolvedItemImage still makes the final
 * image-or-null decision either way).
 *
 * @param {object} params
 * @param {string} params.itemId
 * @param {object} [params.client]
 * @returns {Promise<string|null>}
 */
export async function fetchActiveCoverImageUrl({ itemId, client }) {
  const activeClient = await resolveClient(client)
  const { data: itemRow, error } = await activeClient
    .from('items')
    .select('active_cover_candidate_id')
    .eq('id', itemId)
    .maybeSingle()
  if (error || !itemRow?.active_cover_candidate_id) return null
  return resolveActiveCoverUrl({ activeCoverCandidateId: itemRow.active_cover_candidate_id, client })
}

/**
 * Multi-Image Rotation (2026-09-03) — fetches and signs the FULL
 * display-eligible pool for one item (not just the primary), shaped for
 * lib/whatsGoodImageSource.js's resolvedItemImages(). Deliberately a
 * sibling to resolveActiveCoverUrl, not a modification of it —
 * resolveActiveCoverUrl's `.eq('status', 'selected')` defense-in-depth
 * filter stays exactly as-is for the single-primary code paths that still
 * call it directly; this function is the only place that reads the new
 * `display_eligible` gate.
 *
 * @param {object} params
 * @param {string} params.itemId
 * @param {object} [params.client]
 * @param {number} [params.expiresInSeconds]
 * @returns {Promise<{url: string, isPrimary: boolean, weight: number, candidateId: string}[]>}
 */
export async function fetchDisplayEligibleImagePool({ itemId, client, expiresInSeconds = 3600 }) {
  const activeClient = await resolveClient(client)

  const { data: rows, error } = await activeClient
    .from('item_cover_candidates')
    .select('id, storage_path, is_primary, display_weight')
    .eq('item_id', itemId)
    .eq('display_eligible', true)
  if (error || !rows?.length) return []

  const signed = await Promise.all(
    rows.map(async (row) => {
      const { data, error: signErr } = await activeClient.storage
        .from('submission-photos')
        .createSignedUrl(row.storage_path, expiresInSeconds)
      if (signErr || !data?.signedUrl) return null
      return {
        url: data.signedUrl,
        isPrimary: Boolean(row.is_primary),
        weight: row.display_weight ?? 1,
        candidateId: row.id,
      }
    })
  )
  return signed.filter(Boolean)
}

/**
 * Batch version of fetchDisplayEligibleImagePool — attaches
 * `displayEligibleImages` to every item in `items` that has a truthy
 * `activeCoverCandidateId` (the existing proxy for "this item has ever
 * had a cover selected"; items with none skip the pool query entirely,
 * same short-circuit as attachActiveCoverImages below). Items with no
 * pool result keep their existing reference (no unnecessary re-render).
 *
 * @param {object[]} items  mapped rail items (see HomeScreen.jsx's mapRailItem)
 * @param {object} [client]
 * @returns {Promise<object[]>}
 */
export async function attachDisplayEligibleImagePools(items, client) {
  const candidates = (items ?? []).filter(i => i.activeCoverCandidateId)
  if (candidates.length === 0) return items

  const poolById = new Map()
  await Promise.all(
    candidates.map(async (item) => {
      const pool = await fetchDisplayEligibleImagePool({ itemId: item.id, client })
      if (pool.length > 0) poolById.set(item.id, pool)
    })
  )
  if (poolById.size === 0) return items

  return items.map(item =>
    poolById.has(item.id) ? { ...item, displayEligibleImages: poolById.get(item.id) } : item
  )
}

/**
 * Real-device follow-up (2026-09-03) — attaches `activeCoverImageUrl` to
 * every item in `items` that has a truthy `activeCoverCandidateId`, so
 * lib/whatsGoodImageSource.js's resolvedItemImage() can find it (it's the
 * FIRST priority in that resolver — a selected community cover always
 * wins over a business photo_url). Items with no active cover are
 * returned unchanged (same object reference — no unnecessary re-render).
 * Resolution runs in parallel; a failed/null resolution for one item
 * never blocks the others.
 *
 * @param {object[]} items  mapped rail items (see HomeScreen.jsx's mapRailItem)
 * @param {object} [client]
 * @returns {Promise<object[]>}
 */
export async function attachActiveCoverImages(items, client) {
  const withCovers = (items ?? []).filter(i => i.activeCoverCandidateId)
  if (withCovers.length === 0) return items

  const urlById = new Map()
  await Promise.all(
    withCovers.map(async (item) => {
      const url = await resolveActiveCoverUrl({ activeCoverCandidateId: item.activeCoverCandidateId, client })
      if (url) urlById.set(item.id, url)
    })
  )
  if (urlById.size === 0) return items

  return items.map(item =>
    urlById.has(item.id) ? { ...item, activeCoverImageUrl: urlById.get(item.id) } : item
  )
}
