// Locked Secret CheckOff screen photo — business photo ONLY.
//
// Source: items.secret_business_photo_storage_path, uploaded by the admin
// Business Photo Intake (a storefront/venue image that is safe to show
// without spoiling the secret). The normal approved cover / active cover /
// display-eligible pool, legacy item/venue image fields and fallback art are
// deliberately NEVER used while locked: they may depict the secret itself.
// No business photo -> null -> the screen keeps its purple/dark design.
// Unlocked screens are unaffected (they keep the normal item photo behavior).

async function resolveClient(client) {
  if (client) return client
  const mod = await import('./supabase')
  return mod.supabase
}

/**
 * @param {object} params
 * @param {string|null} params.itemId
 * @param {object} [params.client]
 * @param {number} [params.expiresInSeconds]
 * @returns {Promise<string|null>} signed URL, or null on any failure/absence
 */
export async function fetchSecretBusinessPhotoUrl({ itemId, client, expiresInSeconds = 3600 }) {
  try {
    if (!itemId) return null
    const activeClient = await resolveClient(client)
    const { data: row, error } = await activeClient
      .from('items')
      .select('secret_business_photo_storage_path')
      .eq('id', itemId)
      .maybeSingle()
    const path = row?.secret_business_photo_storage_path
    if (error || typeof path !== 'string' || !path.trim()) return null
    const { data, error: signErr } = await activeClient.storage
      .from('submission-photos')
      .createSignedUrl(path, expiresInSeconds)
    if (signErr || !data?.signedUrl) return null
    return data.signedUrl
  } catch {
    return null
  }
}
