// Remembers (per device + user) that an item's reveal has already played, so a
// previously unlocked item opens directly in its settled state. This is ONLY an
// animation decision: it never grants an unlock. Eligibility is still the live
// distance check against the item's configured radius on every visit.
const key = (userId, itemId) => `secret_reveal_seen:${userId ?? 'guest'}:${itemId}`

async function defaultStorage() {
  return (await import('@react-native-async-storage/async-storage')).default
}

export async function hasSeenReveal({ userId, itemId, storage }) {
  try {
    if (!itemId) return false
    const s = storage ?? await defaultStorage()
    return (await s.getItem(key(userId, itemId))) === '1'
  } catch { return false }
}

export async function markRevealSeen({ userId, itemId, storage }) {
  try {
    if (!itemId) return
    const s = storage ?? await defaultStorage()
    await s.setItem(key(userId, itemId), '1')
  } catch {}
}
