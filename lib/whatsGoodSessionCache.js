// What's Good V1 — lightweight client-side session persistence for the
// currently-displayed 3-item recommendation set. Uses this app's existing
// AsyncStorage convention directly (see lib/ThemeContext.js,
// lib/useOnboarding.js, lib/trackEvent.js) — no new storage abstraction.
//
// IMPLEMENTATION DEFAULT, NOT A PRODUCT DECISION: BACKGROUND_PRESERVE_MS_DEFAULT
// below is a conservative starting value for "how long counts as a short
// interruption." The exact threshold was explicitly left unrecorded as a
// product decision (see Decision Area 5, still JERRY_DECISION, in
// docs/whats-good-widget/product-discovery.md) — centralized here as one
// named constant specifically so it's easy to tune later without touching
// call sites.

const STORAGE_KEY = 'whats_good_session_v1'

/** IMPLEMENTATION DEFAULT — 5 minutes. Not a recorded product decision. */
export const BACKGROUND_PRESERVE_MS_DEFAULT = 5 * 60 * 1000

async function resolveStorage(storage) {
  if (storage) return storage
  const mod = await import('@react-native-async-storage/async-storage')
  return mod.default
}

/**
 * @param {{itemIds: string[], generatedAt: Date, fingerprint: string, location: {latitude: number, longitude: number}|null}} session
 * @param {object} [storage]  Injected storage (getItem/setItem); defaults to AsyncStorage.
 */
export async function saveWhatsGoodSession(session, storage) {
  const activeStorage = await resolveStorage(storage)
  const payload = JSON.stringify({
    itemIds: session.itemIds,
    generatedAt: session.generatedAt.toISOString(),
    fingerprint: session.fingerprint,
    location: session.location,
  })
  await activeStorage.setItem(STORAGE_KEY, payload)
}

/**
 * @param {object} [storage]
 * @returns {Promise<{itemIds: string[], generatedAt: Date, fingerprint: string|null, location: object|null}|null>}
 *   null for missing OR corrupt/malformed cached state — this function
 *   never throws for bad cache content, it just treats it as "no cache."
 */
export async function loadWhatsGoodSession(storage) {
  const activeStorage = await resolveStorage(storage)
  let raw
  try {
    raw = await activeStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.itemIds) || typeof parsed.generatedAt !== 'string') return null
    const generatedAt = new Date(parsed.generatedAt)
    if (Number.isNaN(generatedAt.getTime())) return null
    return {
      itemIds: parsed.itemIds,
      generatedAt,
      fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : null,
      location: parsed.location ?? null,
    }
  } catch {
    return null // malformed JSON -> no cache, never throw
  }
}

/**
 * Pure decision function: should the cached session be kept as-is (true),
 * or is a fresh selection allowed (false)? Never mutates its inputs.
 *
 * Priority, per the approved behavior:
 *   1. A short interruption (age <= backgroundPreserveMs) ALWAYS preserves
 *      the displayed 3, regardless of context — this is the unconditional
 *      stability guarantee ("short background -> foreground preserves the
 *      displayed 3").
 *   2. Beyond that window, the cached set is preserved only if the current
 *      context fingerprint still matches the one it was generated from —
 *      otherwise a fresh selection is ALLOWED (not forced; a fresh
 *      selection may still land on largely the same items, since exposure
 *      rotation is itself gradual).
 *
 * @param {{itemIds: string[], generatedAt: Date, fingerprint: string|null}|null} session
 * @param {{now: Date, currentFingerprint: string|null, backgroundPreserveMs?: number}} options
 * @returns {boolean}
 */
export function shouldPreserveSession(session, { now, currentFingerprint, backgroundPreserveMs = BACKGROUND_PRESERVE_MS_DEFAULT }) {
  if (!session) return false

  const ageMs = now.getTime() - session.generatedAt.getTime()
  if (ageMs >= 0 && ageMs <= backgroundPreserveMs) return true

  return session.fingerprint != null && currentFingerprint != null && session.fingerprint === currentFingerprint
}

export async function clearWhatsGoodSession(storage) {
  const activeStorage = await resolveStorage(storage)
  await activeStorage.removeItem(STORAGE_KEY)
}
