// Photo-admin client helpers. These only decide what UI to show and which server call to
// make; the SERVER is the authority: is_photo_admin() / admin_publish_item_photo() verify
// auth.uid() against the photo_admins table (see
// supabase/migrations/20261008_photo_admin_publish.sql). A modified client that calls
// admin_publish_item_photo without being in photo_admins is rejected by the database.

async function resolveClient(client) {
  if (client) return client
  const mod = await import('./supabase')
  return mod.supabase
}

let cachedUserId = null
let cachedValue = null

export function resetPhotoAdminCache() {
  cachedUserId = null
  cachedValue = null
}

/**
 * Asks the server whether the signed-in user is a photo admin. Any failure -> false.
 * Cached per signed-in user for the session (the answer only changes by a server-side grant).
 * @param {{client?: object, userId?: string|null}} [params]
 * @returns {Promise<boolean>}
 */
export async function fetchIsPhotoAdmin({ client, userId } = {}) {
  try {
    if (!userId) return false
    if (cachedUserId === userId && cachedValue !== null) return cachedValue
    const activeClient = await resolveClient(client)
    const { data, error } = await activeClient.rpc('is_photo_admin')
    const value = !error && data === true
    cachedUserId = userId
    cachedValue = value
    return value
  } catch {
    return false
  }
}

/**
 * The single privileged publish call. The database re-verifies the caller.
 * @returns {Promise<{candidateId: string, becameCover: boolean}>}
 */
export async function publishPhotoAsAdmin({ itemId, storagePath, moderationMetadata, client }) {
  const activeClient = await resolveClient(client)
  const { data, error } = await activeClient.rpc('admin_publish_item_photo', {
    p_item_id: itemId,
    p_storage_path: storagePath,
    p_moderation: moderationMetadata ?? {},
  })
  if (error) throw new Error(`Photo publish failed: ${error.message}`)
  return { candidateId: data?.candidate_id ?? null, becameCover: data?.became_cover === true }
}

export function photoAdminSuccessMessage(becameCover) {
  return becameCover
    ? 'Photo is live and is now the cover'
    : 'Photo is live and was added to the rotation'
}
