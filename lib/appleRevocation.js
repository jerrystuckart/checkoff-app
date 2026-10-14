// Best effort Sign in with Apple token revocation at account deletion. It NEVER throws and NEVER blocks deletion: if the revoke-apple-token function is
// not deployed or not configured (preflight says so), the user is not even prompted; if Apple or the user declines, deletion proceeds and the user can
// disconnect CheckOff in Apple ID settings. Pure with injected dependencies so it is testable under plain node.

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

export function hasAppleIdentity(user) {
  if (!user) return false
  const providers = user.app_metadata?.providers ?? []
  return user.app_metadata?.provider === 'apple' || providers.includes('apple') || (user.identities ?? []).some((i) => i.provider === 'apple')
}

/** @returns {Promise<{attempted: boolean, revoked: boolean, reason: string}>} */
export async function revokeAppleTokenIfPossible({ supabase, platformOS, AppleAuthentication, timeoutMs = 8000 }) {
  try {
    if (platformOS !== 'ios') return { attempted: false, revoked: false, reason: 'not_ios' }
    const { data: { user } } = await supabase.auth.getUser()
    if (!hasAppleIdentity(user)) return { attempted: false, revoked: false, reason: 'not_apple' }

    // Preflight first: no Apple sheet is shown unless the server side can actually revoke.
    const pre = await withTimeout(supabase.functions.invoke('revoke-apple-token', { body: { preflight: true } }), timeoutMs)
    if (pre.error || !pre.data?.available || !pre.data?.apple) return { attempted: false, revoked: false, reason: 'unavailable' }

    let code = null
    try {
      const cred = await AppleAuthentication.signInAsync({ requestedScopes: [] })
      code = cred?.authorizationCode ?? null
    } catch { /* cancelled or failed: continue without revocation */ }
    if (!code) return { attempted: true, revoked: false, reason: 'no_code' }

    const res = await withTimeout(supabase.functions.invoke('revoke-apple-token', { body: { authorization_code: code } }), timeoutMs)
    return { attempted: true, revoked: res.data?.revoked === true, reason: res.data?.reason ?? (res.error ? 'error' : 'unknown') }
  } catch {
    return { attempted: true, revoked: false, reason: 'error' }
  }
}
