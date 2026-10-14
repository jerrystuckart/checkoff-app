// Optional admin-managed REVEAL background for a secret item: items.secret_reveal_image_storage_path
// (portrait, shown full-screen behind the unlocked Secret card). Written only by the admin tool; never
// derived from user submissions (pending/rejected candidates can't reach it). Requested only after the
// unlock. Optional admin crop focus (0..100 per axis) rides along. Absent column (migration 20261009a not applied yet), no row, an unsignable path, or any error
// -> null, and the screen falls back to the approved cover, then the business photo, then branded art.

async function resolveClient(client) {
  if (client) return client
  const mod = await import('./supabase')
  return mod.supabase
}

/** @returns {Promise<{url: string, focus: {x:number,y:number}|null}|null>} */
export async function fetchSecretRevealImage({ itemId, client, expiresInSeconds = 3600 }) {
  try {
    if (!itemId) return null
    const activeClient = await resolveClient(client)
    const { data: row, error } = await activeClient
      .from('items')
      .select('secret_reveal_image_storage_path, secret_reveal_image_focus_x, secret_reveal_image_focus_y')
      .eq('id', itemId)
      .maybeSingle()
    const path = row?.secret_reveal_image_storage_path
    if (error || typeof path !== 'string' || !path.trim()) return null
    const { data, error: signErr } = await activeClient.storage
      .from('submission-photos')
      .createSignedUrl(path, expiresInSeconds)
    if (signErr || !data?.signedUrl) return null
    const fx = row.secret_reveal_image_focus_x, fy = row.secret_reveal_image_focus_y
    const focus = fx == null && fy == null ? null : { x: fx, y: fy }
    return { url: data.signedUrl, focus }
  } catch {
    return null
  }
}
