import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { buildAuthorizationUrl, exchangeCodeForTokens, loadEnvFile } from './googleAuthorize'
import { GOOGLE_OAUTH_SCOPES } from './specialists/googleCredentialProvider'

// ---------------------------------------------------------------------------
// loadEnvFile — regression coverage for a real bug: googleAuthorize.ts is a
// standalone entrypoint (no dependency on db.ts, whose import loads .env as
// a side effect for every other script in this repo), so it must load
// .env itself or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET set correctly in
// the project-root .env are invisible to it.
// ---------------------------------------------------------------------------

test('loadEnvFile: populates process.env from a .env-shaped file, relative to the project root', () => {
  const fixtureRelPath = `.env.googleAuthorize.test-fixture-${process.pid}`
  const fixtureAbsPath = join(__dirname, '..', fixtureRelPath)
  const varName = `CHIEF_TEST_LOAD_ENV_${process.pid}`
  delete process.env[varName]
  writeFileSync(fixtureAbsPath, `${varName}=detected-value\n# a comment\n\nOTHER_VAR="quoted value"\n`, 'utf8')
  try {
    loadEnvFile(fixtureRelPath)
    assert.equal(process.env[varName], 'detected-value')
    assert.equal(process.env.OTHER_VAR, 'quoted value')
  } finally {
    delete process.env[varName]
    delete process.env.OTHER_VAR
    rmSync(fixtureAbsPath, { force: true })
  }
})

test('loadEnvFile: never overwrites a value already present in process.env (e.g. exported by the shell)', () => {
  const fixtureRelPath = `.env.googleAuthorize.test-fixture-overwrite-${process.pid}`
  const fixtureAbsPath = join(__dirname, '..', fixtureRelPath)
  const varName = `CHIEF_TEST_NO_OVERWRITE_${process.pid}`
  process.env[varName] = 'already-set-by-shell'
  writeFileSync(fixtureAbsPath, `${varName}=from-dot-env-file\n`, 'utf8')
  try {
    loadEnvFile(fixtureRelPath)
    assert.equal(process.env[varName], 'already-set-by-shell')
  } finally {
    delete process.env[varName]
    rmSync(fixtureAbsPath, { force: true })
  }
})

test('loadEnvFile: a missing file is a no-op, never throws', () => {
  assert.doesNotThrow(() => loadEnvFile(`.env.definitely-does-not-exist-${process.pid}`))
})

test('buildAuthorizationUrl: requests offline access + forces consent, so a refresh token is actually returned', () => {
  const url = buildAuthorizationUrl('client-123', 'http://localhost:8721/oauth2callback')
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('access_type'), 'offline')
  assert.equal(parsed.searchParams.get('prompt'), 'consent')
  assert.equal(parsed.searchParams.get('client_id'), 'client-123')
  assert.equal(parsed.searchParams.get('redirect_uri'), 'http://localhost:8721/oauth2callback')
})

test('buildAuthorizationUrl: requests exactly the minimum scope set — never more', () => {
  const url = buildAuthorizationUrl('client-123', 'http://localhost:8721/oauth2callback')
  const parsed = new URL(url)
  const requestedScopes = (parsed.searchParams.get('scope') ?? '').split(' ')
  assert.deepEqual(new Set(requestedScopes), new Set(GOOGLE_OAUTH_SCOPES))
})

test('exchangeCodeForTokens: posts the authorization_code grant and returns the refresh token', async () => {
  let capturedBody = ''
  const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
    capturedBody = String(init?.body ?? '')
    return new Response(JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }), { status: 200 })
  }) as unknown as typeof fetch

  const result = await exchangeCodeForTokens({ code: 'auth-code-1', clientId: 'client-123', clientSecret: 'secret-123', redirectUri: 'http://localhost:8721/oauth2callback', fetchImpl })
  assert.equal(result.accessToken, 'access-1')
  assert.equal(result.refreshToken, 'refresh-1')
  assert.match(capturedBody, /grant_type=authorization_code/)
  assert.match(capturedBody, /code=auth-code-1/)
})

test('exchangeCodeForTokens: returns refreshToken: null (never fabricated) when Google omits it', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ access_token: 'access-1', expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch
  const result = await exchangeCodeForTokens({ code: 'auth-code-1', clientId: 'client-123', clientSecret: 'secret-123', redirectUri: 'http://localhost:8721/oauth2callback', fetchImpl })
  assert.equal(result.refreshToken, null)
})

test('exchangeCodeForTokens: a failed exchange throws with Google\'s error, never the client secret', async () => {
  const fetchImpl = (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch
  await assert.rejects(
    () => exchangeCodeForTokens({ code: 'bad-code', clientId: 'client-123', clientSecret: 'super-secret-value', redirectUri: 'http://localhost:8721/oauth2callback', fetchImpl }),
    (err: Error) => {
      assert.doesNotMatch(err.message, /super-secret-value/)
      assert.match(err.message, /invalid_grant/)
      return true
    }
  )
})
