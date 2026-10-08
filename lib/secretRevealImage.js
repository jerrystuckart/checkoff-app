// Optional admin-managed REVEAL background for a secret item: items.secret_reveal_image_storage_path
// (portrait, shown full-screen behind the unlocked Secret card). Written only by the admin tool; never
// derived from user submissions (pending/rejected candidates can't reach it). Requested only after the
// unlock. Absent column (migration 20261009a not applied yet), no row, an unsignable path, or any error
// -> null, and the screen falls back to the approved cover, then the business photo, then branded art.

async function resolveClient(client) {
  if (client) return client
  const mod = await import('./supabase')
  return mod.supabase
}

export async function fetchSecretRevealImageUrl({ itemId, client, expiresInSeconds = 3600 }) {
  try {
    if (!itemId) return null
    const activeClient = await resolveClient(client)
    const { data: row, error } = await activeClient
      .from('items')
      .select('secret_reveal_image_storage_path')
      .eq('id', itemId)
      .maybeSingle()
    const path = row?.secret_reveal_image_storage_path
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
