import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GoogleCredentialProvider, GoogleAuthNotConfiguredError, GoogleAuthRevokedError, GOOGLE_OAUTH_SCOPES } from './googleCredentialProvider'

function fakeTokenFetch(overrides: { status?: number; accessToken?: string; expiresIn?: number; errorBody?: string } = {}) {
  const calls: Array<{ url: string; body: string }> = []
  const fetchImpl = (async (url: unknown, init?: { body?: string }) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') })
    if (overrides.status && overrides.status >= 400) {
      return new Response(overrides.errorBody ?? '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}', { status: overrides.status })
    }
    return new Response(JSON.stringify({ access_token: overrides.accessToken ?? 'access-token-1', expires_in: overrides.expiresIn ?? 3600, token_type: 'Bearer' }), { status: 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

test('GoogleCredentialProvider: isConfigured() is false unless client id, secret, AND refresh token are all set', () => {
  assert.equal(new GoogleCredentialProvider({}).isConfigured(), false)
  assert.equal(new GoogleCredentialProvider({ clientId: 'id' }).isConfigured(), false)
  assert.equal(new GoogleCredentialProvider({ clientId: 'id', clientSecret: 'secret' }).isConfigured(), false)
  assert.equal(new GoogleCredentialProvider({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' }).isConfigured(), true)
})

test('GoogleCredentialProvider: getAccessToken() throws GoogleAuthNotConfiguredError when unconfigured, never silently returns a fake token', async () => {
  const provider = new GoogleCredentialProvider({})
  await assert.rejects(() => provider.getAccessToken(), GoogleAuthNotConfiguredError)
})

test('GoogleCredentialProvider: fetches a real access token via the refresh_token grant on first use', async () => {
  const { fetchImpl, calls } = fakeTokenFetch({ accessToken: 'fresh-token' })
  const provider = new GoogleCredentialProvider({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', fetchImpl })
  const token = await provider.getAccessToken()
  assert.equal(token, 'fresh-token')
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /oauth2\.googleapis\.com\/token/)
  assert.match(calls[0].body, /grant_type=refresh_token/)
})

test('GoogleCredentialProvider: caches the access token and does NOT refresh again before expiry', async () => {
  const { fetchImpl, calls } = fakeTokenFetch({ expiresIn: 3600 })
  const provider = new GoogleCredentialProvider({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', fetchImpl })
  let now = 1_000_000
  await provider.getAccessToken(() => now)
  now += 60_000 // 1 minute later — nowhere near the 1-hour expiry
  await provider.getAccessToken(() => now)
  assert.equal(calls.length, 1, 'a still-valid cached token must never trigger a second refresh call')
})

test('GoogleCredentialProvider: refreshes again once the cached token is near/at expiry', async () => {
  const { fetchImpl, calls } = fakeTokenFetch({ expiresIn: 3600 })
  const provider = new GoogleCredentialProvider({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', fetchImpl })
  let now = 1_000_000
  await provider.getAccessToken(() => now)
  now += 3600 * 1000 // exactly at expiry
  await provider.getAccessToken(() => now)
  assert.equal(calls.length, 2, 'an expired token must trigger a fresh refresh call')
})

test('GoogleCredentialProvider: a revoked/expired refresh token throws GoogleAuthRevokedError, distinct from a generic failure', async () => {
  const { fetchImpl } = fakeTokenFetch({ status: 400 })
  const provider = new GoogleCredentialProvider({ clientId: 'id', clientSecret: 'secret', refreshToken: 'bad-refresh', fetchImpl })
  await assert.rejects(() => provider.getAccessToken(), GoogleAuthRevokedError)
})

test('GoogleCredentialProvider: a transient 5xx failure is a generic Error, not GoogleAuthRevokedError — it should be retried, not require re-authorization', async () => {
  const { fetchImpl } = fakeTokenFetch({ status: 503, errorBody: 'Service Unavailable' })
  const provider = new GoogleCredentialProvider({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', fetchImpl })
  await assert.rejects(
    () => provider.getAccessToken(),
    (err: Error) => {
      assert.ok(!(err instanceof GoogleAuthRevokedError))
      return true
    }
  )
})

test('GoogleCredentialProvider: never includes the client secret or refresh token in a thrown error message', async () => {
  const { fetchImpl } = fakeTokenFetch({ status: 400 })
  const provider = new GoogleCredentialProvider({ clientId: 'id', clientSecret: 'super-secret-value', refreshToken: 'super-secret-refresh-token', fetchImpl })
  try {
    await provider.getAccessToken()
    assert.fail('expected getAccessToken to throw')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    assert.doesNotMatch(message, /super-secret-value/)
    assert.doesNotMatch(message, /super-secret-refresh-token/)
  }
})

test('GoogleCredentialProvider: onTokenRefreshed is called with ONLY the expiry, never the access token or secrets', async () => {
  const { fetchImpl } = fakeTokenFetch({ accessToken: 'super-secret-access-token' })
  let captured: unknown = null
  const provider = new GoogleCredentialProvider({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', fetchImpl, onTokenRefreshed: (info) => { captured = info } })
  await provider.getAccessToken()
  assert.ok(captured)
  const json = JSON.stringify(captured)
  assert.doesNotMatch(json, /super-secret-access-token/)
  assert.match(json, /expiresAtIso/)
})

test('GoogleCredentialProvider: concurrent getAccessToken() calls during a refresh coalesce into ONE HTTP request', async () => {
  const { fetchImpl, calls } = fakeTokenFetch({})
  const provider = new GoogleCredentialProvider({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', fetchImpl })
  const [a, b, c] = await Promise.all([provider.getAccessToken(), provider.getAccessToken(), provider.getAccessToken()])
  assert.equal(a, b)
  assert.equal(b, c)
  assert.equal(calls.length, 1)
})

test('GOOGLE_OAUTH_SCOPES: requests only the scopes each real capability actually needs — never Drive or a broad account scope', () => {
  assert.ok(GOOGLE_OAUTH_SCOPES.includes('https://www.googleapis.com/auth/gmail.readonly'))
  assert.ok(GOOGLE_OAUTH_SCOPES.includes('https://www.googleapis.com/auth/gmail.compose'))
  assert.ok(GOOGLE_OAUTH_SCOPES.includes('https://www.googleapis.com/auth/gmail.send'))
  assert.ok(GOOGLE_OAUTH_SCOPES.includes('https://www.googleapis.com/auth/contacts.readonly'))
  assert.ok(GOOGLE_OAUTH_SCOPES.includes('https://www.googleapis.com/auth/calendar.freebusy'))
  assert.ok(GOOGLE_OAUTH_SCOPES.includes('https://www.googleapis.com/auth/calendar.events'))
  assert.ok(!GOOGLE_OAUTH_SCOPES.some((s) => s.includes('drive')))
  assert.ok(!GOOGLE_OAUTH_SCOPES.some((s) => s.includes('gmail.modify') || s === 'https://www.googleapis.com/auth/gmail'))
})
